import { createFileRoute } from '@tanstack/react-router';
import { readJson, withSession } from '@/server/backlinks/auth';

import { removeMine, updateMine } from '@/modules/backlinks/library';
import { respOk } from '@/lib/resp';

/** `:id` is the backlink id. */
const PUT = withSession(async ({ request, params, userId }) => {
  await updateMine(userId, params.id, await readJson(request));
  return respOk();
});

const DELETE = withSession(async ({ params, userId }) => {
  await removeMine(userId, params.id);
  return respOk();
});

export const Route = createFileRoute('/api/my-backlinks/$id')({
  server: { handlers: { PUT, DELETE } },
});
