import { createFileRoute } from '@tanstack/react-router';
import { withSession } from '@/server/backlinks/auth';

import { setFacets } from '@/modules/backlinks/library';
import { respData } from '@/lib/resp';

/** Counts for the set picker. `?scope=plaza|personal`. */
const GET = withSession(async ({ request, userId }) => {
  const scope =
    new URL(request.url).searchParams.get('scope') === 'personal'
      ? 'personal'
      : 'plaza';
  return respData(await setFacets(userId, scope));
});

export const Route = createFileRoute('/api/backlinks/facets')({
  server: { handlers: { GET } },
});
