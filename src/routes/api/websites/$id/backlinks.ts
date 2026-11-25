import { createFileRoute } from '@tanstack/react-router';
import {
  idList,
  pageParams,
  readJson,
  urlList,
  withSession,
} from '@/server/backlinks/auth';

import {
  addToWebsite,
  listSuccessfulTargets,
} from '@/modules/backlinks/records';
import { respData } from '@/lib/resp';

const GET = withSession(async ({ request, params, userId }) => {
  const { page, pageSize, search } = pageParams(request);
  const { list, total } = await listSuccessfulTargets(userId, params.id, {
    page,
    pageSize,
    search: search?.slice(0, 200),
  });
  return respData({ list, pagination: { page, pageSize, total } });
});

/**
 * 添加外链. Body: `{ scope: 'plaza'|'personal', set }`, `{ ids }` or
 * `{ urls, batchName? }`, `{ batchIds }`, or `{ successfulTargets: string[] | 'all' }`.
 * Targets the website already has are skipped.
 */
const POST = withSession(async ({ request, params, userId }) => {
  const body = await readJson(request);
  return respData(
    await addToWebsite(userId, params.id, {
      scope: body.scope === 'personal' ? 'personal' : 'plaza',
      set: body.set,
      ids: body.ids ? idList(body.ids) : undefined,
      batchIds: body.batchIds ? idList(body.batchIds) : undefined,
      successfulTargets:
        body.successfulTargets === 'all'
          ? 'all'
          : Array.isArray(body.successfulTargets)
            ? urlList(body.successfulTargets)
            : undefined,
      urls: body.urls ? urlList(body.urls) : undefined,
      batchName: body.batchName,
    })
  );
});

export const Route = createFileRoute('/api/websites/$id/backlinks')({
  server: { handlers: { GET, POST } },
});
