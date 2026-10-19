import { createFileRoute } from '@tanstack/react-router';
import { pageParams, readJson, withSession } from '@/server/backlinks/auth';

import { createLog, listLogs } from '@/modules/backlinks/logs';
import { respData } from '@/lib/resp';

const GET = withSession(async ({ request, userId }) => {
  const { sp, page, pageSize, search } = pageParams(request, 10);
  const { list, total } = await listLogs(userId, {
    page,
    pageSize,
    search,
    action: sp.get('action') || undefined,
    status: sp.get('status') || undefined,
    visibility: sp.get('visibility') || undefined,
    websiteId: sp.get('websiteId') || undefined,
  });
  return respData({ list, pagination: { page, pageSize, total } });
});

const POST = withSession(async ({ request, userId }) =>
  respData(await createLog(userId, await readJson(request)))
);

export const Route = createFileRoute('/api/backlink-logs')({
  server: { handlers: { GET, POST } },
});
