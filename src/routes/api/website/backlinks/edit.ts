import { createFileRoute } from '@tanstack/react-router';
import { readJson, withSession } from '@/server/backlinks/auth';

import { editRecord } from '@/modules/backlinks/records';
import { respData, respErr } from '@/lib/resp';

/** Body: `{ id, ...fields }`; any subset of the editable fields. */
const POST = withSession(async ({ request, userId }) => {
  const body = await readJson(request);
  if (typeof body.id !== 'string') return respErr('id is required');
  return respData(await editRecord(userId, body.id, body));
});

export const Route = createFileRoute('/api/website/backlinks/edit')({
  server: { handlers: { POST } },
});
