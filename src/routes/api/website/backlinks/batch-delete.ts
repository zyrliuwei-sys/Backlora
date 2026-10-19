import { createFileRoute } from '@tanstack/react-router';
import { idList, readJson, withSession } from '@/server/backlinks/auth';

import { batchDeleteRecords } from '@/modules/backlinks/records';
import { respData } from '@/lib/resp';

const POST = withSession(async ({ request, userId }) => {
  const body = await readJson(request);
  return respData(await batchDeleteRecords(userId, idList(body.ids)));
});

export const Route = createFileRoute('/api/website/backlinks/batch-delete')({
  server: { handlers: { POST } },
});
