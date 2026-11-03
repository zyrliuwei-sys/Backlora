import { createFileRoute } from '@tanstack/react-router';
import { idList, readJson, withSession } from '@/server/backlinks/auth';

import { retryRecords } from '@/modules/backlinks/records';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respData } from '@/lib/resp';

const retry = withSession(async ({ request, userId }) => {
  const limited = enforceMinIntervalRateLimit(request, {
    intervalMs: 1_000,
    keyPrefix: 'records-retry-user',
    extraKey: userId,
  });
  if (limited) return limited;
  const body = await readJson(request);
  return respData(await retryRecords(userId, idList(body.ids, 100)));
});

const POST: typeof retry = async (ctx) => {
  const limited = enforceMinIntervalRateLimit(ctx.request, {
    intervalMs: 100,
    keyPrefix: 'records-retry-ip',
  });
  return limited ?? retry(ctx);
};

export const Route = createFileRoute('/api/website/backlinks/retry')({
  server: { handlers: { POST } },
});
