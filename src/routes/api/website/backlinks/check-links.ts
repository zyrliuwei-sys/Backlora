import { createFileRoute } from '@tanstack/react-router';
import { idList, readJson, withSession } from '@/server/backlinks/auth';
import { checkLink } from '@/server/backlinks/check-link';

import { linkCheckTargets, setLinkStatus } from '@/modules/backlinks/records';
import { BacklinkError } from '@/modules/backlinks/shared';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respData } from '@/lib/resp';

/** Per request; the dashboard sends larger selections in chunks. */
const MAX_IDS = 20;
const CONCURRENCY = 5;

/** 刷新状态: fetch each record's page and update its link status. */
const POST = withSession(async ({ request, userId }) => {
  const limited = enforceMinIntervalRateLimit(request, {
    intervalMs: 1_000,
    keyPrefix: 'records-check-links',
    extraKey: userId,
  });
  if (limited) return limited;
  const ids = idList((await readJson(request)).ids);
  if (ids.length > MAX_IDS)
    throw new BacklinkError(`At most ${MAX_IDS} records per request`);

  const targets = await linkCheckTargets(userId, ids);
  const results: { id: string; linkStatus: string | null }[] = [];
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    results.push(
      ...(await Promise.all(
        targets.slice(i, i + CONCURRENCY).map(async (t) => {
          const linkStatus = await checkLink(t.pageUrl, t.linkUrl);
          if (linkStatus) await setLinkStatus(userId, t.id, linkStatus);
          return { id: t.id, linkStatus };
        })
      ))
    );
  }
  return respData({
    checked: results.filter((r) => r.linkStatus).length,
    failed: results.filter((r) => !r.linkStatus).length,
    results,
  });
});

export const Route = createFileRoute('/api/website/backlinks/check-links')({
  server: { handlers: { POST } },
});
