import { createFileRoute } from '@tanstack/react-router';
import {
  pageParams,
  recordFilters,
  withSession,
} from '@/server/backlinks/auth';

import {
  listRecords,
  listSuccessfulTargets,
} from '@/modules/backlinks/records';
import { respData } from '@/lib/resp';

const GET = withSession(async ({ request, userId }) => {
  const { sp, page, pageSize } = pageParams(request);
  if (sp.get('view') === 'successful-targets') {
    const { list, total } = await listSuccessfulTargets(userId, undefined, {
      page,
      pageSize,
      search: sp.get('search')?.trim().slice(0, 200),
    });
    return respData({ list, pagination: { page, pageSize, total } });
  }
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
