import { createFileRoute } from '@tanstack/react-router';
import {
  PLAZA_WRITE_PERMISSION,
  readJson,
  withPermission,
  withSession,
} from '@/server/backlinks/auth';

import {
  deletePublicBacklink,
  getVisibleBacklink,
  updatePublicBacklink,
  viewBacklink,
} from '@/modules/backlinks/library';
import { respData, respErr, respOk } from '@/lib/resp';

const GET = withSession(async ({ params, userId }) => {
  const row = await getVisibleBacklink(userId, params.id);
  return row
    ? respData(viewBacklink(row))
    : respErr('Not found', { status: 404 });
});

const PUT = withPermission(
  PLAZA_WRITE_PERMISSION,
  async ({ request, params }) =>
    respData(await updatePublicBacklink(params.id, await readJson(request)))
);

const DELETE = withPermission(PLAZA_WRITE_PERMISSION, async ({ params }) => {
  await deletePublicBacklink(params.id);
  return respOk();
});

export const Route = createFileRoute('/api/backlinks/$id')({
  server: { handlers: { GET, PUT, DELETE } },
});
