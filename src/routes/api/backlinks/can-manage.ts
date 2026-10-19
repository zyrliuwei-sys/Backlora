import { createFileRoute } from '@tanstack/react-router';
import { PLAZA_WRITE_PERMISSION, withSession } from '@/server/backlinks/auth';

import { hasPermission } from '@/modules/rbac/service';
import { respData } from '@/lib/resp';

const GET = withSession(async ({ userId }) =>
  respData({ canManage: await hasPermission(userId, PLAZA_WRITE_PERMISSION) })
);

export const Route = createFileRoute('/api/backlinks/can-manage')({
  server: { handlers: { GET } },
});
