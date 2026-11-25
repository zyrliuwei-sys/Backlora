import { and, eq, gt, isNull } from 'drizzle-orm';
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import PostalMime from 'postal-mime';

import { db } from '@/core/db';
import { website, websiteBacklink } from '@/config/db/schema';
import {
  canReceiveSubmissionEmail,
  mailBindings,
  submissionSiteForRecipient,
  supportMailboxForRecipient,
} from '@/config/submission-account';
import { decryptSecret, encryptSecret, isEncryptedSecret } from '@/lib/crypto';

import { BacklinkError } from './shared';

const TTL_SECONDS = 600;
const MAX_BYTES = 256 * 1024;
const NO_MATCH = { status: 'waiting' as const };

type IncomingMail = Pick<
  Awaited<ReturnType<typeof PostalMime.parse>>,
  'subject' | 'text' | 'html'
>;

function sameSite(host: string, target: string) {
  const domain = target.toLowerCase().replace(/^www\./, '');
  return !!domain && (host === domain || host.endsWith('.' + domain));
}

function htmlContent(html: string) {
  const links: string[] = [];
  const text: string[] = [];
  const nodes: DefaultTreeAdapterTypes.ChildNode[] = [
    ...parseFragment(html).childNodes.reverse(),
  ];
  while (nodes.length) {
    const node = nodes.pop()!;
    if ('value' in node) text.push(node.value);
    if (!('tagName' in node) || ['script', 'style'].includes(node.tagName))
      continue;
    if (node.tagName === 'a') {
      const href = node.attrs.find((attr) => attr.name === 'href')?.value;
      if (href) links.push(href);
    }
    for (let i = node.childNodes.length - 1; i >= 0; i--) {
      nodes.push(node.childNodes[i]);
    }
  }
  return { text: text.join(' '), links };
}

export function verificationOf(mail: IncomingMail, target: string) {
  const html = htmlContent(mail.html ?? '');
  const text = [mail.subject, mail.text, html.text].join('\n');
  // Password resets and email changes use a different, user-led workflow.
  if (
    /password reset|reset (?:your )?password|change (?:your )?(?:password|email)|重置密码|更改邮箱/i.test(
      text
    )
  )
    return null;

  const links = new Set<string>();
  for (const candidate of [
    ...html.links,
    ...text.matchAll(/https:\/\/[^\s<>"']+/gi),
  ].map(String)) {
    if (candidate.length > 2048) continue;
    try {
      const url = new URL(candidate);
      if (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        !url.port &&
        sameSite(url.hostname, target) &&
        /\b(?:verify|verification|confirm|activate|magic[-_]?link)\b/i.test(
          url.pathname + url.search
        ) &&
        (url.search.length > 1 ||
          url.pathname.split('/').filter(Boolean).length > 1)
      )
        links.add(url.href);
    } catch {
      continue;
    }
  }
  const codes = new Set<string>();
  const contextualCode =
    /(?:verification code|security code|sign[- ]?in code|login code|one[- ]time (?:code|passcode|password)|验证码|校验码)(?:\s+is)?[\s:：–-]{0,20}(\d{4,8})(?!\d)|(\d{4,8})\s+is your (?:verification|security|sign[- ]?in|login|one[- ]time) code/gi;
  for (const match of text.matchAll(contextualCode))
    codes.add(match[1] ?? match[2]);
  // A generic "your code" only counts in an email whose subject is about sign-in or verification.
  if (
    /verify|verification|sign[- ]?in|log[- ]?in|验证码/i.test(
      mail.subject ?? ''
    )
  ) {
    for (const match of text.matchAll(
      /(?:your code is|your code:)[\s:：]{0,20}(\d{4,8})(?!\d)/gi
    ))
      codes.add(match[1]);
  }
  const code = codes.size === 1 ? [...codes][0] : null;
  const link = links.size === 1 ? [...links][0] : null;
  return code || link ? { code, link } : null;
}

type EmailEvent = {
  to: string;
  headers: Headers;
  raw: ReadableStream<Uint8Array>;
  rawSize: number;
};

export async function routeIncomingMail(
  message: EmailEvent & { forward(to: string): Promise<unknown> }
) {
  const supportMailbox = supportMailboxForRecipient(message.to.toLowerCase());
  if (!supportMailbox) return receiveVerificationMail(message);

  try {
    await receiveVerificationMail(message);
  } catch {
    // Keep support mail delivery independent of verification storage.
    console.error('Backlora verification mail processing failed');
  }
  await message.forward(supportMailbox.forwardTo);
}

function authenticatedSender(headers: Headers, address: string) {
  const host = address.split('@').pop()?.toLowerCase();
  // Cloudflare prepends its own authentication result before any existing headers.
  const auth = headers.get('authentication-results')?.split(',')[0] ?? '';
  if (!host || !/^mx\.cloudflare\.net\s*;/i.test(auth)) return null;
  const from = /;\s*dmarc=pass\b[^;]*\bheader\.from=([a-z0-9.-]+)/i.exec(
    auth
  )?.[1];
  return from?.toLowerCase() === host ? host : null;
}

function mailboxKey(taskId: string, leaseId: string) {
  return `task/${taskId}/${leaseId}`;
}

const activeClaim = (now: Date) =>
  and(
    eq(websiteBacklink.operationStatus, 'in_progress'),
    gt(websiteBacklink.leaseExpiresAt, now),
    isNull(websiteBacklink.submissionAuthProvider),
    eq(website.status, 'enabled'),
    eq(website.autoBacklinkEnabled, true),
    isNull(website.deletedAt)
  );

export async function receiveVerificationMail(message: EmailEvent) {
  const env = mailBindings();
  const recipient = message.to.toLowerCase();
  const siteId = submissionSiteForRecipient(recipient, env);
  if (
    !env.VERIFICATION_MAIL ||
    !siteId ||
    !process.env.CONFIG_ENCRYPTION_KEY ||
    message.rawSize > MAX_BYTES
  )
    return;

  const now = new Date();
  const candidates: {
    id: string;
    leaseId: string | null;
    target: string;
    site: { id: string; url: string; email: string | null };
  }[] = await db()
    .select({
      id: websiteBacklink.id,
      leaseId: websiteBacklink.leaseId,
      target: websiteBacklink.targetDomain,
      site: { id: website.id, url: website.url, email: website.email },
    })
    .from(websiteBacklink)
    .innerJoin(
      website,
      and(
        eq(website.id, websiteBacklink.websiteId),
        eq(website.userId, websiteBacklink.userId)
      )
    )
    .where(
      and(
        activeClaim(now),
        eq(website.id, siteId),
        eq(websiteBacklink.submissionEmail, recipient)
      )
    );
  if (candidates.length === 0) return;
  const mail = await PostalMime.parse(message.raw);
  const sender = authenticatedSender(message.headers, mail.from?.address ?? '');
  if (!sender) return;

  const matches = candidates.filter((task) => sameSite(sender, task.target));
  if (matches.length !== 1) return;
  const [task] = matches;
  if (!task.leaseId || !canReceiveSubmissionEmail(task.site, recipient, env))
    return;

  const verification = verificationOf(mail, task.target);
  if (!verification) return;
  const sealed = await encryptSecret(
    JSON.stringify({
      ...verification,
      received_at: now.toISOString(),
    })
  );
  if (!isEncryptedSecret(sealed)) return;
  await env.VERIFICATION_MAIL.put(mailboxKey(task.id, task.leaseId), sealed, {
    expirationTtl: TTL_SECONDS,
  });
}

export async function readVerificationMail(
  userId: string,
  taskId: string,
  input: {
    worker_id?: unknown;
    lease_id?: unknown;
    requested_after?: unknown;
  } | null
) {
  const now = new Date();
  const { worker_id, lease_id, requested_after } = input ?? {};
  const since =
    typeof requested_after === 'string' ? Date.parse(requested_after) : NaN;
  if (
    typeof worker_id !== 'string' ||
    !worker_id ||
    worker_id.length > 100 ||
    typeof lease_id !== 'string' ||
    !lease_id ||
    lease_id.length > 100 ||
    !Number.isFinite(since) ||
    since < +now - TTL_SECONDS * 1000 ||
    since > +now + 30_000
  )
    throw new BacklinkError(
      'worker_id, lease_id and recent requested_after are required'
    );

  const env = mailBindings();
  if (!env.VERIFICATION_MAIL || !process.env.CONFIG_ENCRYPTION_KEY)
    throw new BacklinkError(
      'Backlora verification mailbox is unavailable',
      503
    );

  async function ownsLease() {
    const [site] = await db()
      .select({
        id: website.id,
        url: website.url,
        email: website.email,
        submissionEmail: websiteBacklink.submissionEmail,
      })
      .from(websiteBacklink)
      .innerJoin(
        website,
        and(
          eq(website.id, websiteBacklink.websiteId),
          eq(website.userId, websiteBacklink.userId)
        )
      )
      .where(
        and(
          activeClaim(new Date()),
          eq(websiteBacklink.id, taskId),
          eq(websiteBacklink.userId, userId),
          eq(websiteBacklink.claimedBy, worker_id as string),
          eq(websiteBacklink.leaseId, lease_id as string)
        )
      )
      .limit(1);
    return (
      !!site?.submissionEmail &&
      canReceiveSubmissionEmail(site, site.submissionEmail, env)
    );
  }
  if (!(await ownsLease()))
    throw new BacklinkError(
      'Verification mailbox unavailable for this task lease',
      409
    );

  const sealed = await env.VERIFICATION_MAIL.get(mailboxKey(taskId, lease_id), {
    cacheTtl: 60,
  });
  if (!sealed || !isEncryptedSecret(sealed)) return NO_MATCH;
  const decrypted = await decryptSecret(sealed);
  if (!decrypted) return NO_MATCH;
  const message = JSON.parse(decrypted) as NonNullable<
    ReturnType<typeof verificationOf>
  > & {
    received_at: string;
  };
  const receivedAt = Date.parse(message.received_at);
  if (
    !Number.isFinite(receivedAt) ||
    receivedAt < since ||
    receivedAt < Date.now() - TTL_SECONDS * 1000
  )
    return NO_MATCH;
  if (!(await ownsLease()))
    throw new BacklinkError(
      'Verification mailbox unavailable for this task lease',
      409
    );
  return { status: 'received' as const, ...message };
}
