import { createFileRoute } from '@tanstack/react-router';
import { withSession } from '@/server/backlinks/auth';

import { duplicateWebsite } from '@/modules/backlinks/websites';
import { respData } from '@/lib/resp';

const POST = withSession(async ({ params, userId }) =>
  respData(await duplicateWebsite(userId, params.id))
);

export const Route = createFileRoute('/api/websites/$id/duplicate')({
  server: { handlers: { POST } },
});
