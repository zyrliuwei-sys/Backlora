export interface VerificationMailbox {
  get(key: string, options: { cacheTtl: number }): Promise<string | null>;
  put(
    key: string,
    value: string,
    options: { expirationTtl: number }
  ): Promise<void>;
}

type MailBindings = {
  BACKLORA_MAIL_WEBSITE_ID?: string;
  BACKLORA_SUBMISSION_DOMAINS?: string;
  BACKLORA_SUPPORT_MAILBOXES?: string;
  BACKLORA_SUPPORT_MAIL_FORWARD_TO?: string;
  BACKLORA_OUTLOOK_WEBSITE_OWNER_ID?: string;
  BACKLORA_OUTLOOK_INBOX?: string;
  VERIFICATION_MAIL?: VerificationMailbox;
};

type SubmissionSite = { id: string; url: string; email: string | null };

export function mailBindings(): MailBindings {
  return (globalThis as { __CF_ENV__?: MailBindings }).__CF_ENV__ ?? {};
}

const SUPPORT_ADDRESS = /^support@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

export function usesOutlookForSupport(
  site: { userId: string },
  env = mailBindings()
) {
  return site.userId === env.BACKLORA_OUTLOOK_WEBSITE_OWNER_ID;
}

export function outlookSubmissionAccount(
  site: { userId: string; email: string | null },
  env = mailBindings()
) {
  if (!usesOutlookForSupport(site, env)) return null;
  const email = site.email?.trim().toLowerCase();
  const inbox = env.BACKLORA_OUTLOOK_INBOX?.trim().toLowerCase();
  if (
    !email ||
    !SUPPORT_ADDRESS.test(email) ||
    !inbox ||
    !/^[^\s@]+@outlook\.com$/.test(inbox)
  )
    return null;
  return { email, inbox, mailboxUrl: 'https://outlook.live.com/mail/' };
}

function parseMailboxMapping(value: string): Record<string, unknown> {
  try {
    const configured: unknown = JSON.parse(value);
    if (
      configured &&
      typeof configured === 'object' &&
      !Array.isArray(configured)
    )
      return configured as Record<string, unknown>;
  } catch {
    return {};
  }
  return {};
}

function submissionDomains(env: MailBindings): Record<string, string> {
  if (!env.VERIFICATION_MAIL) return {};
  if (!env.BACKLORA_SUBMISSION_DOMAINS)
    return env.BACKLORA_MAIL_WEBSITE_ID
      ? { [env.BACKLORA_MAIL_WEBSITE_ID]: 'pavoai.net' }
      : {};
  return Object.fromEntries(
    Object.entries(parseMailboxMapping(env.BACKLORA_SUBMISSION_DOMAINS)).filter(
      ([, domain]) =>
        typeof domain === 'string' &&
        /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain)
    )
  );
}

export function supportMailboxForRecipient(
  email: string,
  env = mailBindings()
) {
  if (!SUPPORT_ADDRESS.test(email)) return null;
  const mapping = parseMailboxMapping(env.BACKLORA_SUPPORT_MAILBOXES ?? '');
  const siteId = mapping[email];
  const forwardTo = env.BACKLORA_SUPPORT_MAIL_FORWARD_TO?.trim().toLowerCase();
  if (
    typeof siteId !== 'string' ||
    !siteId ||
    !forwardTo ||
    !/^[^\s@]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(forwardTo) ||
    Object.hasOwn(mapping, forwardTo)
  )
    return null;
  return { siteId, forwardTo };
}

export function submissionSiteForRecipient(
  email: string,
  env = mailBindings()
) {
  if (!env.VERIFICATION_MAIL) return null;
  const supportMailbox = supportMailboxForRecipient(email, env);
  if (supportMailbox) return supportMailbox.siteId;
  const matches = Object.entries(submissionDomains(env)).filter(
    ([, domain]) => email === `submit@${domain}`
  );
  return matches.length === 1 ? matches[0][0] : null;
}

function legacySubmissionEmailOf(site: SubmissionSite, env: MailBindings) {
  try {
    const domain = new URL(site.url).hostname.replace(/^www\./, '');
    const email = `submit@${domain}`;
    return submissionSiteForRecipient(email, env) === site.id ? email : null;
  } catch {
    return null;
  }
}

function supportSubmissionEmailOf(site: SubmissionSite, env: MailBindings) {
  if (!env.VERIFICATION_MAIL) return null;
  const email = site.email?.trim().toLowerCase();
  return email && supportMailboxForRecipient(email, env)?.siteId === site.id
    ? email
    : null;
}

export function directSubmissionEmailOf(
  site: SubmissionSite,
  env = mailBindings()
) {
  return (
    supportSubmissionEmailOf(site, env) ?? legacySubmissionEmailOf(site, env)
  );
}

export function canReceiveSubmissionEmail(
  site: SubmissionSite,
  email: string,
  env = mailBindings()
) {
  // A lease created before the support mailbox was enabled can still receive mail.
  return (
    supportSubmissionEmailOf(site, env) === email ||
    legacySubmissionEmailOf(site, env) === email
  );
}
