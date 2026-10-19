import { createFileRoute } from '@tanstack/react-router';
import { idList, readJson, withSession } from '@/server/backlinks/auth';

import { batchEditRecords } from '@/modules/backlinks/records';
import { respData } from '@/lib/resp';

const POST = withSession(async ({ request, userId }) => {
  const body = await readJson(request);
  return respData(await batchEditRecords(userId, idList(body.ids), body));
});

export const Route = createFileRoute('/api/website/backlinks/batch-edit')({
  server: { handlers: { POST } },
});
