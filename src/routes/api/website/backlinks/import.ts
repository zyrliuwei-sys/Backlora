import { createFileRoute } from '@tanstack/react-router';
import { readJson, withSession } from '@/server/backlinks/auth';

import { importRecords } from '@/modules/backlinks/records';
import { respData, respErr } from '@/lib/resp';

const POST = withSession(async ({ request, userId }) => {
  const { text, websiteId } = await readJson(request);
  if (typeof text !== 'string' || !text.trim())
    return respErr('Nothing to import');
  if (text.length > 5_000_000) return respErr('File is too large (max 5 MB)');
  return respData(
    await importRecords(
      userId,
      text,
      typeof websiteId === 'string' ? websiteId : undefined
    )
  );
});

export const Route = createFileRoute('/api/website/backlinks/import')({
  server: { handlers: { POST } },
});
