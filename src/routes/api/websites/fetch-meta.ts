import { createFileRoute } from '@tanstack/react-router';
import { readJson, withSession } from '@/server/backlinks/auth';
import { fetchSiteMeta } from '@/server/backlinks/fetch-meta';

import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respData } from '@/lib/resp';

const POST = withSession(async ({ request, userId }) => {
  const limited = enforceMinIntervalRateLimit(request, {
    intervalMs: 2_000,
    keyPrefix: 'website-fetch-meta',
    extraKey: userId,
  });
  if (limited) return limited;
  const { url } = await readJson(request);
  return respData(await fetchSiteMeta(String(url ?? '')));
});

export const Route = createFileRoute('/api/websites/fetch-meta')({
  server: { handlers: { POST } },
});
