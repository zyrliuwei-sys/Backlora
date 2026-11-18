import { createFileRoute } from '@tanstack/react-router';
import {
  idList,
  readJson,
  urlList,
  withSession,
} from '@/server/backlinks/auth';

import { importToMine } from '@/modules/backlinks/library';
import { respData } from '@/lib/resp';

/** Body: a legacy set or list of IDs, or URLs with an optional batch name. */
const POST = withSession(async ({ request, userId }) => {
  const body = await readJson(request);
  return respData(
    await importToMine(userId, {
      set: body.set,
      ids: body.ids ? idList(body.ids) : undefined,
      urls: body.urls ? urlList(body.urls) : undefined,
      batchName: body.batchName,
    })
  );
});

export const Route = createFileRoute('/api/my-backlinks/batch-import')({
  server: { handlers: { POST } },
});
