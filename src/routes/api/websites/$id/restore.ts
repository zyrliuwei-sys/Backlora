import { createFileRoute } from '@tanstack/react-router';
import { withSession } from '@/server/backlinks/auth';

import { restoreWebsite } from '@/modules/backlinks/websites';
import { respOk } from '@/lib/resp';

const POST = withSession(async ({ params, userId }) => {
  await restoreWebsite(userId, params.id);
  return respOk();
});

export const Route = createFileRoute('/api/websites/$id/restore')({
  server: { handlers: { POST } },
});
