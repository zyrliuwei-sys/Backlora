import { createFileRoute } from '@tanstack/react-router';
import {
  idList,
  readJson,
  urlList,
  withSession,
} from '@/server/backlinks/auth';

import { importToMine } from '@/modules/backlinks/library';
import { respData } from '@/lib/resp';

/** Body: `{ set }`, `{ ids }` (plaza ids) or `{ urls }`. */
const POST = withSession(async ({ request, userId }) => {
  const body = await readJson(request);
  return respData(
    await importToMine(userId, {
      set: body.set,
      ids: body.ids ? idList(body.ids) : undefined,
      urls: body.urls ? urlList(body.urls) : undefined,
    })
  );
});

export const Route = createFileRoute('/api/my-backlinks/batch-import')({
  server: { handlers: { POST } },
});
