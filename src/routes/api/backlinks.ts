import { createFileRoute } from '@tanstack/react-router';
import {
  pageParams,
  PLAZA_WRITE_PERMISSION,
  readJson,
  withPermission,
  withSession,
} from '@/server/backlinks/auth';

import { createPublicBacklink, listPlaza } from '@/modules/backlinks/library';
import { respData } from '@/lib/resp';

const GET = withSession(async ({ request }) => {
  const { sp, page, pageSize, search } = pageParams(request, 10);
  const { list, total } = await listPlaza({
    page,
    pageSize,
    search,
    tag: sp.get('tag') || undefined,
    category: sp.get('category') || undefined,
    status: sp.get('status') || undefined,
    costType: sp.get('costType') || undefined,
  });
  return respData({ list, pagination: { page, pageSize, total } });
});

const POST = withPermission(PLAZA_WRITE_PERMISSION, async ({ request }) =>
  respData(await createPublicBacklink(await readJson(request)))
);

export const Route = createFileRoute('/api/backlinks')({
  server: { handlers: { GET, POST } },
});
