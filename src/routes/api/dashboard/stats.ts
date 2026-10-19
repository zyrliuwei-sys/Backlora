import { createFileRoute } from '@tanstack/react-router';
import { withSession } from '@/server/backlinks/auth';

import { dashboardStats } from '@/modules/backlinks/records';
import { listWebsites } from '@/modules/backlinks/websites';
import { respData } from '@/lib/resp';

const GET = withSession(async ({ userId }) => {
  const [stats, recent] = await Promise.all([
    dashboardStats(userId),
    listWebsites(userId, { page: 1, pageSize: 5 }),
  ]);
  return respData({ ...stats, recentWebsites: recent.list });
});

export const Route = createFileRoute('/api/dashboard/stats')({
  server: { handlers: { GET } },
});
