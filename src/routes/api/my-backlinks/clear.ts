import { createFileRoute } from '@tanstack/react-router';
import { withSession } from '@/server/backlinks/auth';

import { clearMine } from '@/modules/backlinks/library';
import { respOk } from '@/lib/resp';

const POST = withSession(async ({ userId }) => {
  await clearMine(userId);
  return respOk();
});

export const Route = createFileRoute('/api/my-backlinks/clear')({
  server: { handlers: { POST } },
});
