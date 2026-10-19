import { createFileRoute } from '@tanstack/react-router';
import { readJson, withApiKey } from '@/server/backlinks/auth';

import { heartbeat } from '@/modules/backlinks/tasks';
import { respData } from '@/lib/resp';

const POST = withApiKey(async ({ request, params, userId }) =>
  respData(await heartbeat(userId, params.id, await readJson(request)))
);

export const Route = createFileRoute('/api/v1/backlink-tasks/$id/heartbeat')({
  server: { handlers: { POST } },
});
