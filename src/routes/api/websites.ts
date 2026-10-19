import { createFileRoute } from '@tanstack/react-router';
import { pageParams, readJson, withSession } from '@/server/backlinks/auth';

import { createWebsite, listWebsites } from '@/modules/backlinks/websites';
import { respData } from '@/lib/resp';

const GET = withSession(async ({ request, userId }) => {
  const { sp, page, pageSize, search } = pageParams(request, 100);
  const { list, total } = await listWebsites(userId, {
    page,
    pageSize,
    search,
    status: sp.get('status') || undefined,
  });
  return respData({ list, pagination: { page, pageSize, total } });
});

const POST = withSession(async ({ request, userId }) =>
  respData(await createWebsite(userId, await readJson(request)))
);

export const Route = createFileRoute('/api/websites')({
  server: { handlers: { GET, POST } },
});
