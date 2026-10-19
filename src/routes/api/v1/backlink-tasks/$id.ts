import { createFileRoute } from '@tanstack/react-router';
import { withApiKey } from '@/server/backlinks/auth';

import { getTask } from '@/modules/backlinks/tasks';
import { respData } from '@/lib/resp';

const GET = withApiKey(async ({ params, userId }) =>
  respData({ task: await getTask(userId, params.id) })
);

export const Route = createFileRoute('/api/v1/backlink-tasks/$id')({
  server: { handlers: { GET } },
});
