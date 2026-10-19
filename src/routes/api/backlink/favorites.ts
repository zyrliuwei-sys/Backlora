import { createFileRoute } from '@tanstack/react-router';
import { withSession } from '@/server/backlinks/auth';

import { favoriteIds } from '@/modules/backlinks/library';
import { respData } from '@/lib/resp';

const GET = withSession(async ({ userId }) =>
  respData(await favoriteIds(userId))
);

export const Route = createFileRoute('/api/backlink/favorites')({
  server: { handlers: { GET } },
});
