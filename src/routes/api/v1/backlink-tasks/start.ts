import { createFileRoute } from '@tanstack/react-router';
import { readJson, withApiKey } from '@/server/backlinks/auth';

import { startTask } from '@/modules/backlinks/tasks';
import { respData } from '@/lib/resp';

const POST = withApiKey(async ({ request, userId }) =>
  respData(await startTask(userId, await readJson(request)))
);

export const Route = createFileRoute('/api/v1/backlink-tasks/start')({
  server: { handlers: { POST } },
});
