import { createFileRoute } from '@tanstack/react-router';
import { pageParams, readJson, withSession } from '@/server/backlinks/auth';

import { createOwn, listMine } from '@/modules/backlinks/library';
import { respData } from '@/lib/resp';

const GET = withSession(async ({ request, userId }) => {
  const { sp, page, pageSize, search } = pageParams(request);
  const { list, total } = await listMine(userId, {
    page,
    pageSize,
    search,
    quality: sp.get('quality') || undefined,
    enabled: sp.get('enabled') || undefined,
  });
  return respData({ list, pagination: { page, pageSize, total } });
});

const POST = withSession(async ({ request, userId }) =>
  respData(await createOwn(userId, await readJson(request)))
);

export const Route = createFileRoute('/api/my-backlinks')({
  server: { handlers: { GET, POST } },
});
