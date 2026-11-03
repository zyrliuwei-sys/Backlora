import { createFileRoute } from '@tanstack/react-router';
import { withApiKey } from '@/server/backlinks/auth';
import { badgeApi, readBadgeRequest } from '@/server/backlinks/badge-api';
import { installBadgeForTask } from '@/server/backlinks/badge-bridge';

import { recordEvent } from '@/modules/events/service';

const POST = withApiKey(({ request, params, userId }) =>
  badgeApi(async () => {
    const result = await installBadgeForTask(
      userId,
      params.id,
      await readBadgeRequest(request)
    );
    await recordEvent({
      userId,
      kind: 'badge_installation',
      detail: {
        task_id: params.id,
        stage: result.stage,
        target_host: new URL(result.href).hostname.slice(0, 180),
      },
    });
    return result;
  })
);

export const Route = createFileRoute('/api/v1/backlink-tasks/$id/badge')({
  server: { handlers: { POST } },
});
