import { createFileRoute } from '@tanstack/react-router';
import { withSession } from '@/server/backlinks/auth';

import { createDemoWebsite } from '@/modules/backlinks/websites';
import { respData } from '@/lib/resp';

const POST = withSession(async ({ userId }) =>
  respData(await createDemoWebsite(userId))
);

export const Route = createFileRoute('/api/websites/demo')({
  server: { handlers: { POST } },
});
