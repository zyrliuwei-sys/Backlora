import { createFileRoute } from '@tanstack/react-router';
import {
  idList,
  readJson,
  urlList,
  withSession,
} from '@/server/backlinks/auth';

import { addToWebsite } from '@/modules/backlinks/records';
import { respData } from '@/lib/resp';

/**
 * 添加外链. Body: `{ scope: 'plaza'|'personal', set }`, `{ ids }` or
 * `{ urls }`. Targets the website already has are skipped.
 */
const POST = withSession(async ({ request, params, userId }) => {
  const body = await readJson(request);
  return respData(
    await addToWebsite(userId, params.id, {
      scope: body.scope === 'personal' ? 'personal' : 'plaza',
      set: body.set,
      ids: body.ids ? idList(body.ids) : undefined,
      urls: body.urls ? urlList(body.urls) : undefined,
    })
  );
});

export const Route = createFileRoute('/api/websites/$id/backlinks')({
  server: { handlers: { POST } },
});
