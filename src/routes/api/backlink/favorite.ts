import { createFileRoute } from '@tanstack/react-router';
import { readJson, withSession } from '@/server/backlinks/auth';

import { toggleFavorite } from '@/modules/backlinks/library';
import { respData, respErr } from '@/lib/resp';

/** Add a plaza entry to my library, or take it out again. */
const POST = withSession(async ({ request, userId }) => {
  const { backlinkId } = await readJson(request);
  if (typeof backlinkId !== 'string' || !backlinkId)
    return respErr('backlinkId is required');
  return respData(await toggleFavorite(userId, backlinkId));
});

export const Route = createFileRoute('/api/backlink/favorite')({
  server: { handlers: { POST } },
});
