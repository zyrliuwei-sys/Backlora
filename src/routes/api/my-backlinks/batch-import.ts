import { createFileRoute } from '@tanstack/react-router';
import {
  idList,
  readJson,
  urlList,
  withSession,
} from '@/server/backlinks/auth';

import { importToMine } from '@/modules/backlinks/library';
import { respData, respErr } from '@/lib/resp';

/** Body: a legacy set or list of IDs, or URLs with an optional batch name. */
const POST = withSession(async ({ request, userId }) => {
  const body = await readJson(request);
  const batchName =
    typeof body.batchName === 'string' ? body.batchName.trim() : '';
  if (body.batchName !== undefined && (!batchName || batchName.length > 100))
    return respErr('Invalid batch name');
  return respData(
    await importToMine(userId, {
      set: body.set,
      ids: body.ids ? idList(body.ids) : undefined,
      urls: body.urls ? urlList(body.urls) : undefined,
      batchName,
    })
  );
});

export const Route = createFileRoute('/api/my-backlinks/batch-import')({
  server: { handlers: { POST } },
});
