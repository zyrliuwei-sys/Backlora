import { createFileRoute } from '@tanstack/react-router';
import {
  PLAZA_WRITE_PERMISSION,
  readJson,
  withPermission,
} from '@/server/backlinks/auth';

import { importPlaza } from '@/modules/backlinks/library';
import { respData, respErr } from '@/lib/resp';

const POST = withPermission(PLAZA_WRITE_PERMISSION, async ({ request }) => {
  const { text } = await readJson(request);
  if (typeof text !== 'string' || !text.trim())
    return respErr('Nothing to import');
  if (text.length > 5_000_000) return respErr('File is too large (max 5 MB)');
  return respData(await importPlaza(text));
});

export const Route = createFileRoute('/api/backlinks/import')({
  server: { handlers: { POST } },
});
