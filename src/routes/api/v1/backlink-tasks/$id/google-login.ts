import { createFileRoute } from '@tanstack/react-router';
import { readJson, withApiKey } from '@/server/backlinks/auth';

import { bindTaskGoogleLogin } from '@/modules/backlinks/tasks';
import { respData } from '@/lib/resp';

const POST = withApiKey(async ({ request, params, userId }) =>
  respData(
    await bindTaskGoogleLogin(userId, params.id, await readJson(request))
  )
);

export const Route = createFileRoute('/api/v1/backlink-tasks/$id/google-login')(
  {
    server: { handlers: { POST } },
  }
);
