import { userFeatureEnabled } from '@/server/user-features';

import { getAuth } from '@/core/auth';
import { validate as validateApiKey } from '@/modules/apikeys/service';
import { BacklinkError } from '@/modules/backlinks/shared';
import { hasPermission } from '@/modules/rbac/service';
import { enforceMinIntervalRateLimit } from '@/lib/rate-limit';
import { respErr } from '@/lib/resp';

type Ctx = { request: Request; params: Record<string, string> };
type Handler = (ctx: Ctx & { userId: string }) => Promise<Response>;

/** Writes to the public plaza (外链广场) need this permission. */
export const PLAZA_WRITE_PERMISSION = 'admin.backlinks.write';

function handleError(error: unknown): Response {
  if (error instanceof BacklinkError)
    return respErr(error.message, { status: error.status });
  console.error('[backlinks]', error);
  return respErr('Internal error', { status: 500 });
}

async function sessionUserId(request: Request): Promise<string | null> {
  const session = await getAuth().api.getSession({ headers: request.headers });
  return session?.user?.id ?? null;
}

/** `Authorization: Bearer sk_…` (or `x-api-key`), a key from API Keys. */
async function apiKeyUserId(request: Request): Promise<string | null> {
  const header = request.headers.get('authorization') ?? '';
  const key =
    header.replace(/^Bearer\s+/i, '').trim() ||
    request.headers.get('x-api-key')?.trim() ||
    '';
  if (!key) return null;
  if (!(await userFeatureEnabled('apikeys_enabled'))) return null;
  return validateApiKey(key);
}

/** Dashboard routes (cookie session). */
export function withSession(handler: Handler) {
  return async (ctx: Ctx) => {
    try {
      const userId = await sessionUserId(ctx.request);
      if (!userId) return respErr('Unauthorized', { status: 401 });
      return await handler({ ...ctx, userId });
    } catch (error) {
      return handleError(error);
    }
  };
}

/** Agent routes (API key only). */
export function withApiKey(handler: Handler) {
  return async (ctx: Ctx) => {
    try {
      const ipLimited = enforceMinIntervalRateLimit(ctx.request, {
        intervalMs: 100,
        keyPrefix: 'agent-ip',
      });
      if (ipLimited) return ipLimited;
      const userId = await apiKeyUserId(ctx.request);
      if (!userId) return respErr('Invalid API key', { status: 401 });
      const userLimited = enforceMinIntervalRateLimit(ctx.request, {
        intervalMs: 500,
        keyPrefix: 'agent-user',
        extraKey: userId,
      });
      if (userLimited) return userLimited;
      return await handler({ ...ctx, userId });
    } catch (error) {
      return handleError(error);
    }
  };
}

/** Routes both the dashboard and agents call (API key wins when sent). */
export function withSessionOrApiKey(handler: Handler) {
  return async (ctx: Ctx) => {
    try {
      const hasKey =
        /^Bearer\s+/i.test(ctx.request.headers.get('authorization') ?? '') ||
        ctx.request.headers.has('x-api-key');
      const userId = hasKey
        ? await apiKeyUserId(ctx.request)
        : await sessionUserId(ctx.request);
      if (!userId)
        return respErr(hasKey ? 'Invalid API key' : 'Unauthorized', {
          status: 401,
        });
      return await handler({ ...ctx, userId });
    } catch (error) {
      return handleError(error);
    }
  };
}

/** Session plus a permission code. */
export function withPermission(code: string, handler: Handler) {
  return withSession(async (ctx) => {
    if (!(await hasPermission(ctx.userId, code)))
      return respErr('Forbidden', { status: 403 });
    return handler(ctx);
  });
}

export async function readJson(request: Request): Promise<any> {
  return request.json().catch(() => ({}));
}

export function pageParams(request: Request, defaultSize = 20) {
  const sp = new URL(request.url).searchParams;
  return {
    sp,
    page: Math.max(1, parseInt(sp.get('page') || '1') || 1),
    pageSize: Math.min(
      100,
      Math.max(
        1,
        parseInt(sp.get('pageSize') || String(defaultSize)) || defaultSize
      )
    ),
    search: sp.get('search')?.trim() || undefined,
  };
}

/** Filters of the submission-record list and its CSV export. */
export function recordFilters(sp: URLSearchParams) {
  const text = (k: string) => sp.get(k)?.trim().slice(0, 200) || undefined;
  return {
    websiteId: text('websiteId'),
    operationStatus: text('operationStatus'),
    progressStatus: text('progressStatus'),
    linkStatus: text('linkStatus'),
    failureReason: text('failureReason'),
    // Submify sends `keyword`; `search` stays accepted.
    search: text('keyword') ?? text('search'),
    sourceDomain: text('sourceDomain'),
    targetDomain: text('targetDomain'),
    agentOnly: sp.get('agentOnly') === '1',
  };
}

export function idList(v: unknown, max = 3000): string[] {
  return Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === 'string' && x.length < 100)
        .slice(0, max)
    : [];
}

export function urlList(v: unknown, max = 3000): string[] {
  const list = Array.isArray(v)
    ? v
    : typeof v === 'string'
      ? v.split(/\r?\n/)
      : [];
  return list
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, max);
}
