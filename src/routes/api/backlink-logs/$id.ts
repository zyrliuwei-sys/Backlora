import { createFileRoute } from '@tanstack/react-router';
import { withSession } from '@/server/backlinks/auth';

import { deleteLog } from '@/modules/backlinks/logs';
import { respOk } from '@/lib/resp';

const DELETE = withSession(async ({ params, userId }) => {
  await deleteLog(userId, params.id);
  return respOk();
});

export const Route = createFileRoute('/api/backlink-logs/$id')({
  server: { handlers: { DELETE } },
});
