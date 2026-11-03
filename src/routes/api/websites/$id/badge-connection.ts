import { createFileRoute } from '@tanstack/react-router';
import { withSession, withSessionOrApiKey } from '@/server/backlinks/auth';
import {
  badgeApi,
  readBadgeRequest,
  requireSameOrigin,
} from '@/server/backlinks/badge-api';
import {
  badgeConnectionStatus,
  connectBadges,
  disconnectBadges,
} from '@/server/backlinks/badge-bridge';

import { recordEvent } from '@/modules/events/service';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';

const GET = withSessionOrApiKey(({ params, userId }) =>
  badgeApi(() => badgeConnectionStatus(userId, params.id))
);

const mutate = withSession(({ request, params, userId }) =>
  badgeApi(async () => {
    requireSameOrigin(request);
    const limited = enforceMinIntervalRateLimit(request, {
      intervalMs: 1_000,
      keyPrefix: 'badge-connect-user',
      extraKey: userId,
    });
    if (limited) return limited;
    const result =
      request.method === 'DELETE'
        ? await disconnectBadges(userId, params.id)
        : await connectBadges(
            userId,
            params.id,
            (await readBadgeRequest(request)).token
          );
    await recordEvent({
      userId,
      kind: 'badge_connection_changed',
      detail: { website_id: params.id, connected: request.method !== 'DELETE' },
    });
    return result;
  })
);

const write: typeof mutate = async (ctx) => {
  const limited = enforceMinIntervalRateLimit(ctx.request, {
    intervalMs: 100,
    keyPrefix: 'badge-connect-ip',
  });
  return limited ?? mutate(ctx);
};

export const Route = createFileRoute('/api/websites/$id/badge-connection')({
  server: { handlers: { GET, POST: write, DELETE: write } },
});
