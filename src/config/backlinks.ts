/**
 * Backlink workflow vocabulary, shared by the server (validation) and the
 * browser (filters, labels). Values are stored as-is and shown raw where
 * the UI shows raw values (statuses), labelled through messages elsewhere.
 */

/** Opportunity category of a backlink (外链广场 → 分类). */
export const BACKLINK_CATEGORIES = [
  'directory',
  'blog_comment',
  'forum_community',
  'content_submission',
  'profile',
  'review_platform',
  'other',
] as const;
export type BacklinkCategory = (typeof BACKLINK_CATEGORIES)[number];

/** Moderation status of a library entry. */
export const BACKLINK_STATUSES = [
  'pending',
  'reviewing',
  'approved',
  'rejected',
] as const;
export type BacklinkStatus = (typeof BACKLINK_STATUSES)[number];

export const COST_TYPES = ['unknown', 'free', 'freemium', 'paid'] as const;
export type CostType = (typeof COST_TYPES)[number];

export const LINK_TYPES = ['unknown', 'dofollow', 'nofollow'] as const;
export type LinkType = (typeof LINK_TYPES)[number];

/** Quality: library-wide on the plaza, personal rating in my library. */
export const QUALITIES = ['unrated', 'good', 'normal', 'bad'] as const;
export type Quality = (typeof QUALITIES)[number];

/** How well a library entry has been checked. */
export const CONFIDENCES = ['unknown', 'observed', 'verified'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

/** Submission record → 操作状态. */
export const OPERATION_STATUSES = [
  'pending',
  'in_progress',
  'submitted',
  'live',
  'needs_user',
  'blocked',
  'duplicate',
  'skipped',
] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

/** 进行中 / 已完成 / 失败 on the website list, and the operation statuses each covers. */
export const PROGRESS_STATUSES = ['doing', 'done', 'failed'] as const;
export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];
export const PROGRESS_BUCKETS: Record<
  ProgressStatus,
  readonly OperationStatus[]
> = {
  doing: ['in_progress', 'needs_user'],
  done: ['submitted', 'live', 'duplicate'],
  failed: ['blocked', 'skipped'],
};

/** Final statuses an agent reports through the result API. */
export const RESULT_STATUSES = [
  'submitted',
  'live',
  'duplicate',
  'needs_user',
  'blocked',
  'skipped',
] as const satisfies readonly OperationStatus[];
export type ResultStatus = (typeof RESULT_STATUSES)[number];

/** Submission record → 链接状态 (whether the placed link still works). */
export const LINK_STATUSES = [
  'unknown',
  'valid',
  'missing',
  'nofollow',
  'redirected',
  'http_4xx',
  'http_5xx',
  'noindex',
] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

/** Where `start` takes tasks from. */
export const DATA_SOURCES = ['website', 'plaza', 'personal'] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

export const TASK_SCOPES = ['recommended', 'all_eligible'] as const;
export type TaskScope = (typeof TASK_SCOPES)[number];

export const PRICE_MODELS = [
  'free',
  'freemium',
  'paid',
  'subscription',
  'one_time',
  'open_source',
] as const;

export const LOG_ACTIONS = ['comment', 'up', 'down'] as const;
export type LogAction = (typeof LOG_ACTIONS)[number];
export const LOG_VISIBILITIES = ['private', 'public'] as const;

/** Browser automation the generated prompt tells the agent to use. */
export const AUTOMATION_CONTAINERS = [
  'ego-browser',
  'chrome-devtools-mcp',
  'playwright',
  'codex-browser',
] as const;
export type AutomationContainer = (typeof AUTOMATION_CONTAINERS)[number];

/** Agent lease length; heartbeat extends it by the same amount. */
export const LEASE_MS = 15 * 60 * 1000;

/** Most records one "add a set" action may create. */
export const MAX_ADD_BATCH = 3000;

export function oneOf<T extends string>(
  v: unknown,
  allowed: readonly T[]
): v is T {
  return allowed.includes(v as T);
}

/** "Recommended" = free/freemium directory listings someone has checked. */
export function isRecommended(b: {
  category: string;
  costType: string;
  confidence: string;
  status: string;
}) {
  return (
    b.status === 'approved' &&
    b.category === 'directory' &&
    (b.costType === 'free' || b.costType === 'freemium') &&
    (b.confidence === 'observed' || b.confidence === 'verified')
  );
}

/**
 * Canonical form of a URL: https assumed, lowercase host, no hash.
 * Returns null for anything that isn't an http(s) URL.
 */
export function normalizeUrl(input: string): string | null {
  let raw = input.trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.')) return null;
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    return u.toString();
  } catch {
    return null;
  }
}

/** Host without `www.` — the "domain" columns. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
