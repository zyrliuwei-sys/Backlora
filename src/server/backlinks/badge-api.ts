import { BacklinkError } from '@/modules/backlinks/shared';
import {
  BadgeBridgeError,
  readLimitedResponse,
} from '@/lib/badge-bridge-policy';
import { respData, respJson } from '@/lib/resp';

export async function readBadgeRequest(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new BadgeBridgeError('request', 'JSON required', 415);
  try {
    const body = JSON.parse(
      await readLimitedResponse(new Response(request.body), 25_000)
    );
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new Error();
    return body;
  } catch {
    throw new BadgeBridgeError(
      'request',
      'Invalid or oversized badge request',
      400
    );
  }
}

export function requireSameOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin)
    throw new BadgeBridgeError('request', 'Origin mismatch', 403);
}

export async function badgeApi(action: () => Promise<unknown>) {
  try {
    const result = await action();
    return result instanceof Response
      ? result
      : respData(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof BadgeBridgeError || error instanceof BacklinkError)
      return respJson(
        -1,
        error.message,
        { stage: error instanceof BadgeBridgeError ? error.stage : 'task' },
        {
          status: error.status,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    return respJson(
      -1,
      'Badge operation failed. Retry or check the website connection.',
      { stage: 'internal' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
