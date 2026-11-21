import { createFileRoute } from '@tanstack/react-router';
import { readJson, withApiKey } from '@/server/backlinks/auth';

import { readVerificationMail } from '@/modules/backlinks/verification-mail';
import { respData } from '@/lib/resp';

const POST = withApiKey(async ({ request, params, userId }) => {
  const verification = await readVerificationMail(
    userId,
    params.id,
    await readJson(request)
  );
  const response = respData(verification);
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

export const Route = createFileRoute(
  '/api/v1/backlink-tasks/$id/verification-email'
)({
  server: { handlers: { POST } },
});
