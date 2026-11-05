import { envConfigs } from '@/config';
import { retryBadgeBlockedRecords } from '@/modules/backlinks/records';
import { authorizeTaskBadge } from '@/modules/backlinks/tasks';
import {
  badgeConnectionKey,
  ownedBadgeWebsite,
  readBadgeConnection,
  type BadgeConnection,
} from '@/modules/badge-connections/service';
import { saveConfigs } from '@/modules/config/service';
import {
  allowedBadgeOrigin,
  BadgeBridgeError,
  readLimitedResponse,
} from '@/lib/badge-bridge-policy';
import type { FooterBadge } from '@/lib/footer-badge-data';

import { badgeIsPublic, parseOfficialBadge } from './badge-markup';

const integrationPath = '/api/integrations/footer-badges';

async function owned(userId: string, id: string) {
  const site = await ownedBadgeWebsite(userId, id);
  if (!site) throw new BadgeBridgeError('website', 'Website not found', 404);
  return site;
}

export async function badgeConnectionStatus(userId: string, id: string) {
  const site = await owned(userId, id);
  const saved = await readBadgeConnection(id);
  let origin: string | null = null;
  try {
    origin = allowedBadgeOrigin(
      site.url,
      envConfigs.backlink_badge_allowed_hosts
    );
  } catch {
    /* disabled host */
  }
  return {
    configured: !!saved,
    ready: !!saved && origin === saved.origin,
    origin,
    scope: 'footer_badges:add',
  };
}

async function callSite(
  connection: BadgeConnection,
  body: object,
  fetcher: typeof fetch
) {
  let response: Response;
  try {
    response = await fetcher(connection.origin + integrationPath, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(12_000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${connection.token}`,
        'X-Backlora-Site': connection.origin,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new BadgeBridgeError(
      'connection',
      'Badge endpoint did not respond. Retry the same badge; do not assume it was not saved.'
    );
  }
  if (response.status >= 300 && response.status < 400)
    throw new BadgeBridgeError(
      'connection',
      'Badge endpoint redirected; credentials were not forwarded'
    );
  if ([401, 403].includes(response.status))
    throw new BadgeBridgeError(
      'credential',
      'Site rejected the badge credential. Reconnect this website.'
    );
  if (response.status === 503)
    throw new BadgeBridgeError(
      'configuration',
      'Site badge integration is not enabled'
    );
  if (!response.ok)
    throw new BadgeBridgeError(
      'save',
      `Site could not save the badge (HTTP ${response.status}); retry the same badge`
    );
  let result: any;
  try {
    result = JSON.parse(await readLimitedResponse(response, 20_000));
  } catch {
    throw new BadgeBridgeError(
      'response',
      'Site returned an invalid badge response'
    );
  }
  if (
    result.code !== 0 ||
    result.data?.protocol !== 'backlora-badges-v1' ||
    result.data?.scope !== 'footer_badges:add' ||
    result.data?.site_origin !== connection.origin
  )
    throw new BadgeBridgeError(
      'response',
      'Site badge capability or origin could not be verified'
    );
  return result.data;
}

export async function connectBadges(
  userId: string,
  id: string,
  token: unknown,
  fetcher: typeof fetch = fetch
) {
  const site = await owned(userId, id);
  const origin = allowedBadgeOrigin(
    site.url,
    envConfigs.backlink_badge_allowed_hosts
  );
  if (typeof token !== 'string' || !/^bbg_[A-Za-z0-9_-]{43}$/.test(token))
    throw new BadgeBridgeError(
      'credential',
      'A dedicated badge token is required',
      400
    );
  if (!process.env.CONFIG_ENCRYPTION_KEY)
    throw new BadgeBridgeError(
      'configuration',
      'Server encryption must be configured before connecting a website'
    );
  const connection: BadgeConnection = { version: 1, origin, token };
  await callSite(connection, { action: 'check' }, fetcher);
  // The destination is sealed with the secret. Editing website.url cannot
  // redirect a saved credential; connecting a new origin requires a new token.
  await saveConfigs(
    { [badgeConnectionKey(id)]: JSON.stringify(connection) },
    { internal: true }
  );
  const requeuedTasks = await retryBadgeBlockedRecords(userId, id);
  return {
    ...(await badgeConnectionStatus(userId, id)),
    requeued_tasks: requeuedTasks,
  };
}

export async function disconnectBadges(userId: string, id: string) {
  await owned(userId, id);
  await saveConfigs({ [badgeConnectionKey(id)]: '' }, { internal: true });
  return { configured: false, ready: false };
}

async function verifyPublic(
  origin: string,
  badge: FooterBadge,
  fetcher: typeof fetch
) {
  let url = origin + '/';
  for (let hop = 0; hop < 4; hop++) {
    const response = await fetcher(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: 'text/html', 'Cache-Control': 'no-cache' },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return false;
      const next = new URL(location, url);
      if (next.origin !== origin) return false;
      url = next.href;
      continue;
    }
    if (
      !response.ok ||
      !response.headers.get('content-type')?.includes('text/html')
    )
      return false;
    return badgeIsPublic(
      await readLimitedResponse(response, 2_000_000),
      badge,
      url
    );
  }
  return false;
}

export async function installTaskBadge(
  userId: string,
  websiteId: string,
  html: unknown,
  fetcher: typeof fetch = fetch,
  verifyOnly = false
) {
  const site = await owned(userId, websiteId);
  if (!site.enabled || site.status !== 'enabled')
    throw new BadgeBridgeError(
      'website',
      'Auto backlinks are off for this website'
    );
  const origin = allowedBadgeOrigin(
    site.url,
    envConfigs.backlink_badge_allowed_hosts
  );
  const connection = await readBadgeConnection(websiteId);
  if (!connection)
    throw new BadgeBridgeError(
      'configuration',
      'Connect a dedicated badge credential for this website first'
    );
  if (connection.origin !== origin)
    throw new BadgeBridgeError(
      'configuration',
      'Website origin changed. Reconnect it before installing badges.'
    );
  const badge = parseOfficialBadge(html);
  if (!verifyOnly) {
    const response = await callSite(
      connection,
      { action: 'add', badge },
      fetcher
    );
    if (response.installed !== true || response.href !== badge.href)
      throw new BadgeBridgeError('save', 'Site did not acknowledge this badge');
  }
  let verified = false;
  try {
    verified = await verifyPublic(origin, badge, fetcher);
  } catch {
    /* saved, verification is recoverable */
  }
  return {
    installed: !verifyOnly || verified,
    publicly_verified: verified,
    stage: verified
      ? 'verified'
      : verifyOnly
        ? 'not_public'
        : 'saved_not_public',
    verification_url: origin + '/',
    href: badge.href,
  };
}

export async function installBadgeForTask(
  userId: string,
  taskId: string,
  body: any,
  fetcher: typeof fetch = fetch
) {
  if (body?.verify_only !== undefined && typeof body.verify_only !== 'boolean')
    throw new BadgeBridgeError('request', 'verify_only must be a boolean', 400);
  const websiteId = await authorizeTaskBadge(userId, taskId, body);
  return installTaskBadge(
    userId,
    websiteId,
    body?.html,
    fetcher,
    body?.verify_only === true
  );
}
