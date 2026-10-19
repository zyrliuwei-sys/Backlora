import { createFileRoute } from '@tanstack/react-router';
import {
  readJson,
  withSession,
  withSessionOrApiKey,
} from '@/server/backlinks/auth';

import {
  deleteWebsite,
  emptyCounts,
  patchWebsite,
  productOf,
  purgeWebsite,
  requireWebsite,
  submissionReadiness,
  updateWebsite,
  websiteCounts,
} from '@/modules/backlinks/websites';
import { respData, respOk } from '@/lib/resp';

/** Dashboard and agents (API key) both read a website's profile here. */
const GET = withSessionOrApiKey(async ({ params, userId }) => {
  const w = await requireWebsite(userId, params.id);
  const counts =
    (await websiteCounts(userId, [w.id])).get(w.id) ?? emptyCounts();
  return respData({
    ...w,
    counts,
    submission_readiness: submissionReadiness(w),
    user_avatar_url: w.ownerAvatarUrl || null,
    product: productOf(w),
  });
});

const PUT = withSession(async ({ request, params, userId }) =>
  respData(await updateWebsite(userId, params.id, await readJson(request)))
);

/** Switches: `{ autoBacklinkEnabled }` or `{ status }`. */
const PATCH = withSession(async ({ request, params, userId }) =>
  respData(await patchWebsite(userId, params.id, await readJson(request)))
);

/** Soft delete; `?permanent=1` purges an already deleted website. */
const DELETE = withSession(async ({ request, params, userId }) => {
  if (new URL(request.url).searchParams.get('permanent') === '1')
    await purgeWebsite(userId, params.id);
  else await deleteWebsite(userId, params.id);
  return respOk();
});

export const Route = createFileRoute('/api/websites/$id')({
  server: { handlers: { GET, PUT, PATCH, DELETE } },
});
