import { createFileRoute } from '@tanstack/react-router';
import { idList, readJson, withSession } from '@/server/backlinks/auth';

import { batchRemoveMine } from '@/modules/backlinks/library';
import { BacklinkError } from '@/modules/backlinks/shared';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respData } from '@/lib/resp';

const deleteBatch = withSession(async ({ request, userId }) => {
  const limited = enforceMinIntervalRateLimit(request, {
    intervalMs: 500,
    keyPrefix: 'delete-library-batch-user',
    extraKey: userId,
  });
  if (limited) return limited;

  const body = await readJson(request);
  const [batchId] = idList([body?.batchId], 1);
  if (!batchId) throw new BacklinkError('Select a batch');
  if (body.mode === 'selected')
    return respData(await batchRemoveMine(userId, batchId, idList(body.ids)));
  if (body.mode === 'batch' && body.ids === undefined)
    return respData(await batchRemoveMine(userId, batchId));
  throw new BacklinkError('Invalid removal mode');
});

function POST(ctx: Parameters<typeof deleteBatch>[0]) {
  return (
    enforceMinIntervalRateLimit(ctx.request, {
      intervalMs: 500,
      keyPrefix: 'delete-library-batch-ip',
    }) ?? deleteBatch(ctx)
  );
}

export const Route = createFileRoute('/api/my-backlinks/batch-delete')({
  server: { handlers: { POST } },
});
