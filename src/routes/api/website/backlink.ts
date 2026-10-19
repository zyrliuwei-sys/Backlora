import { createFileRoute } from '@tanstack/react-router';
import { readJson, withSession } from '@/server/backlinks/auth';

import { createRecord } from '@/modules/backlinks/records';
import { respData } from '@/lib/resp';

const POST = withSession(async ({ request, userId }) =>
  respData(await createRecord(userId, await readJson(request)))
);

export const Route = createFileRoute('/api/website/backlink')({
  server: { handlers: { POST } },
});
