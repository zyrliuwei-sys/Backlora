import { createFileRoute } from '@tanstack/react-router';
import {
  pageParams,
  recordFilters,
  withSession,
} from '@/server/backlinks/auth';

import { listRecords } from '@/modules/backlinks/records';
import { respData } from '@/lib/resp';

const GET = withSession(async ({ request, userId }) => {
  const { sp, page, pageSize } = pageParams(request);
  const { list, total, statusCounts } = await listRecords(userId, {
    page,
    pageSize,
    ...recordFilters(sp),
  });
  return respData({
    list,
    pagination: { page, pageSize, total },
    statusCounts,
  });
});

export const Route = createFileRoute('/api/website/backlinks')({
  server: { handlers: { GET } },
});
