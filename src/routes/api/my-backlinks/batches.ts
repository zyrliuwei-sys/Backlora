import { createFileRoute } from '@tanstack/react-router';
import { pageParams, withSession } from '@/server/backlinks/auth';

import { listImportBatches } from '@/modules/backlinks/library';
import { respData } from '@/lib/resp';

const GET = withSession(async ({ request, userId }) => {
  const { sp, page, pageSize } = pageParams(request, 10);
  const { list, total, unbatched } = await listImportBatches(
    userId,
    page,
    pageSize,
    sp.get('enabled') === 'enabled'
  );
  return respData({ list, unbatched, pagination: { page, pageSize, total } });
});

export const Route = createFileRoute('/api/my-backlinks/batches')({
  server: { handlers: { GET } },
});
