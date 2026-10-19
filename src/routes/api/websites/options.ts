import { createFileRoute } from '@tanstack/react-router';
import { withSession } from '@/server/backlinks/auth';

import { websiteOptions } from '@/modules/backlinks/websites';
import { respData } from '@/lib/resp';

const GET = withSession(async ({ userId }) =>
  respData(await websiteOptions(userId))
);

export const Route = createFileRoute('/api/websites/options')({
  server: { handlers: { GET } },
});
