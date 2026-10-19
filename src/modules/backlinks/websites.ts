import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  like,
  or,
  type SQL,
} from 'drizzle-orm';

import { db } from '@/core/db';
import { atomic } from '@/core/db/atomic';
import { normalizeUrl, PRICE_MODELS } from '@/config/backlinks';
import {
  website,
  websiteBacklink,
  type NewWebsite,
  type Website,
} from '@/config/db/schema';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { getUuid } from '@/lib/hash';

import {
  BacklinkError,
  chunk,
  IN_CHUNK,
  isEmail,
  isHttpUrl,
  parseJson,
  str,
  stringList,
} from './shared';

export const SOCIAL_KEYS = [
  'facebook',
  'twitter',
  'linkedin',
  'instagram',
  'youtube',
  'github',
  'demoVideo',
  'explainerVideo',
] as const;
export const LOCATION_KEYS = [
  'country',
  'state',
  'city',
  'zip',
  'address',
] as const;

type Anchor = { name: string; url: string };
type Meta = { key: string; value: string };

export type WebsiteView = Omit<
  Website,
  | 'screenshotUrls'
  | 'categories'
  | 'tags'
  | 'links'
  | 'socialLinks'
  | 'location'
  | 'metadata'
  | 'registrationPassword'
> & {
  hasRegistrationPassword: boolean;
  screenshotUrls: string[];
  categories: string[];
  tags: string[];
  links: Anchor[];
  socialLinks: Record<(typeof SOCIAL_KEYS)[number], string>;
  location: Record<(typeof LOCATION_KEYS)[number], string>;
  metadata: Meta[];
};

function pick<K extends string>(keys: readonly K[], src: any, max: number) {
  return Object.fromEntries(keys.map((k) => [k, str(src?.[k], max)])) as Record<
    K,
    string
  >;
}

/** The registration password never leaves the server; see agentPassword. */
export function viewWebsite({
  registrationPassword,
  ...w
}: Website): WebsiteView {
  return {
    ...w,
    hasRegistrationPassword: !!registrationPassword,
    screenshotUrls: parseJson<string[]>(w.screenshotUrls, []),
    categories: parseJson<string[]>(w.categories, []),
    tags: parseJson<string[]>(w.tags, []),
    links: parseJson<Anchor[]>(w.links, []),
    socialLinks: pick(SOCIAL_KEYS, parseJson(w.socialLinks, {}), 500),
    location: pick(LOCATION_KEYS, parseJson(w.location, {}), 300),
    metadata: parseJson<Meta[]>(w.metadata, []),
  };
}

/** Create/update body → row. Only `url` is required to create one. */
export function sanitizeWebsiteInput(
  body: any
): Omit<NewWebsite, 'id' | 'userId'> {
  const url = normalizeUrl(str(body?.url, 1000));
  if (!url) throw new BacklinkError('Invalid URL');
  const anchors: Anchor[] = (Array.isArray(body?.links) ? body.links : [])
    .map((a: any) => ({ name: str(a?.name, 200), url: str(a?.url, 1000) }))
    .filter((a: Anchor) => a.name || a.url)
    .slice(0, 20);
  const metadata: Meta[] = (Array.isArray(body?.metadata) ? body.metadata : [])
    .map((m: any) => ({ key: str(m?.key, 100), value: str(m?.value, 2000) }))
    .filter((m: Meta) => m.key)
    .slice(0, 50);
  return {
    name: str(body?.name, 200) || new URL(url).hostname.replace(/^www\./, ''),
    url,
    status: body?.status === 'disabled' ? 'disabled' : 'enabled',
    internalNote: str(body?.internalNote, 2000),
    email: str(body?.email, 200),
    launchDate: str(body?.launchDate, 20),
    iconUrl: str(body?.iconUrl, 2000),
    screenshotUrls: JSON.stringify(stringList(body?.screenshotUrls, 5, 2000)),
    shortDesc: str(body?.shortDesc, 1000),
    longDesc: str(body?.longDesc, 10000),
    tagline: str(body?.tagline, 300),
    slogan: str(body?.slogan, 300),
    categories: JSON.stringify(stringList(body?.categories, 20, 80)),
    tags: JSON.stringify(stringList(body?.tags, 30, 80)),
    priceModel: str(body?.priceModel, 40),
    lowestPrice: str(body?.lowestPrice, 40),
    links: JSON.stringify(anchors),
    backlinkManagementUrl: str(body?.backlinkManagementUrl, 2000),
    emailManagementUrl: str(body?.emailManagementUrl, 2000),
    autoBacklinkEnabled:
      body?.autoBacklinkEnabled === undefined
        ? true
        : Boolean(body.autoBacklinkEnabled),
    agentSubmissionNote: str(body?.agentSubmissionNote, 4000),
    ownerAvatarUrl: str(body?.ownerAvatarUrl, 2000),
    ownerFirstName: str(body?.ownerFirstName, 100),
    ownerLastName: str(body?.ownerLastName, 100),
    ownerEmail: str(body?.ownerEmail, 200),
    ownerTwitter: str(body?.ownerTwitter, 300),
    socialLinks: JSON.stringify(pick(SOCIAL_KEYS, body?.socialLinks, 500)),
    location: JSON.stringify(pick(LOCATION_KEYS, body?.location, 300)),
    metadata: JSON.stringify(metadata),
  };
}

/**
 * `registrationPassword` in a create/update body: a non-empty string sets it,
 * `clearRegistrationPassword: true` empties it, anything else keeps it.
 */
async function passwordFields(
  body: any
): Promise<Pick<NewWebsite, 'registrationPassword'>> {
  if (body?.clearRegistrationPassword === true)
    return { registrationPassword: '' };
  const plain =
    typeof body?.registrationPassword === 'string'
      ? body.registrationPassword.slice(0, 200)
      : '';
  if (!plain.trim()) return {};
  if (plain.length < 8)
    throw new BacklinkError('Registration password needs 8+ characters');
  return { registrationPassword: await encryptSecret(plain) };
}

/** Plain registration password for agent task payloads only. */
export async function agentPassword(websiteId: string): Promise<string | null> {
  const [row]: { p: string }[] = await db()
    .select({ p: website.registrationPassword })
    .from(website)
    .where(eq(website.id, websiteId))
    .limit(1);
  return row?.p ? await decryptSecret(row.p) : null;
}

// ─── Submission readiness ───────────────────────────────────────────────────

export type Readiness = {
  ready: boolean;
  blocking_fields: string[];
  missing_fields: string[];
  invalid_fields: string[];
};

/** Field names follow the form: name, url, shortDesc, icon, userAvatar … */
export function submissionReadiness(w: WebsiteView): Readiness {
  const blocking: string[] = [];
  const missing: string[] = [];
  const invalid: string[] = [];
  const url = (field: string, v: string, required = false) => {
    if (!v) return required ? missing.push(field) : undefined;
    if (!isHttpUrl(v)) invalid.push(field);
  };

  if (!w.name) blocking.push('name');
  if (!w.url || !isHttpUrl(w.url)) blocking.push('url');
  if (!w.shortDesc) blocking.push('shortDesc');

  const email = w.email || w.ownerEmail;
  if (!email) missing.push('email');
  else if (!isEmail(email)) invalid.push('email');
  if (!w.longDesc) missing.push('longDesc');
  if (!w.tagline) missing.push('tagline');
  url('icon', w.iconUrl, true);
  if (!w.screenshotUrls.length) missing.push('screenshots');
  w.screenshotUrls.forEach((s, i) => url(`screenshot${i + 1}`, s));
  if (!w.priceModel) missing.push('priceModel');
  else if (!PRICE_MODELS.includes(w.priceModel as any))
    invalid.push('priceModel');
  if (!w.categories.length) missing.push('categories');
  url('userAvatar', w.ownerAvatarUrl);
  url('backlinkManagementUrl', w.backlinkManagementUrl);
  url('emailManagementUrl', w.emailManagementUrl);
  for (const k of SOCIAL_KEYS) url(k, w.socialLinks[k]);

  return {
    ready: blocking.length === 0,
    blocking_fields: blocking,
    missing_fields: missing,
    invalid_fields: invalid,
  };
}

/** The `product` object handed to agents (snake_case, see the API doc). */
export function productOf(w: WebsiteView) {
  return {
    id: w.id,
    product_name: w.name,
    product_url: w.url,
    owner: {
      first_name: w.ownerFirstName || null,
      last_name: w.ownerLastName || null,
      email: w.ownerEmail || null,
      twitter: w.ownerTwitter || null,
      avatar_url: w.ownerAvatarUrl || null,
    },
    email: w.email || w.ownerEmail || null,
    short_description: w.shortDesc || null,
    long_description: w.longDesc || null,
    tagline: w.tagline || null,
    slogan: w.slogan || null,
    assets: {
      icon_url: w.iconUrl || null,
      screenshot_urls: w.screenshotUrls,
      demo_video_url: w.socialLinks.demoVideo || null,
      explainer_video_url: w.socialLinks.explainerVideo || null,
    },
    categories: w.categories,
    tags: w.tags,
    price_model: w.priceModel || null,
    lowest_price: w.lowestPrice || null,
    launch_date: w.launchDate || null,
    social_links: {
      facebook: w.socialLinks.facebook || null,
      twitter: w.socialLinks.twitter || null,
      linkedin: w.socialLinks.linkedin || null,
      instagram: w.socialLinks.instagram || null,
      youtube: w.socialLinks.youtube || null,
      github: w.socialLinks.github || null,
    },
    location: Object.fromEntries(
      LOCATION_KEYS.map((k) => [k, w.location[k] || null])
    ),
    metadata: Object.fromEntries(w.metadata.map((m) => [m.key, m.value])),
    links: w.links,
    auto_backlink_enabled: w.autoBacklinkEnabled,
    agent_submission_note: w.agentSubmissionNote || null,
    backlink_management_url: w.backlinkManagementUrl || null,
    email_management_url: w.emailManagementUrl || null,
    submission_readiness: submissionReadiness(w),
  };
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export type WebsiteCounts = {
  total: number;
  inProgress: number;
  done: number;
  failed: number;
  pending: number;
};

export function emptyCounts(): WebsiteCounts {
  return { total: 0, inProgress: 0, done: 0, failed: 0, pending: 0 };
}

/** 总数 / 进行中 / 已完成 / 失败 as the website list shows them. */
export function bucketOf(status: string): keyof WebsiteCounts {
  if (status === 'in_progress' || status === 'needs_user') return 'inProgress';
  if (status === 'submitted' || status === 'live' || status === 'duplicate')
    return 'done';
  if (status === 'blocked' || status === 'skipped') return 'failed';
  return 'pending';
}

export async function websiteCounts(
  userId: string,
  ids: string[]
): Promise<Map<string, WebsiteCounts>> {
  const map = new Map<string, WebsiteCounts>();
  for (const part of chunk(ids, IN_CHUNK)) {
    const rows: { websiteId: string; status: string; n: number }[] = await db()
      .select({
        websiteId: websiteBacklink.websiteId,
        status: websiteBacklink.operationStatus,
        n: count(),
      })
      .from(websiteBacklink)
      .where(
        and(
          eq(websiteBacklink.userId, userId),
          inArray(websiteBacklink.websiteId, part)
        )
      )
      .groupBy(websiteBacklink.websiteId, websiteBacklink.operationStatus);
    for (const r of rows) {
      const c = map.get(r.websiteId) ?? emptyCounts();
      c[bucketOf(r.status)] += r.n;
      c.total += r.n;
      map.set(r.websiteId, c);
    }
  }
  return map;
}

export async function listWebsites(
  userId: string,
  f: { search?: string; status?: string; page: number; pageSize: number }
) {
  const c: SQL[] = [
    eq(website.userId, userId),
    f.status === 'deleted'
      ? isNotNull(website.deletedAt)
      : isNull(website.deletedAt),
  ];
  if (f.status === 'enabled' || f.status === 'disabled')
    c.push(eq(website.status, f.status));
  if (f.search) {
    const q = `%${f.search}%`;
    c.push(
      or(
        like(website.name, q),
        like(website.url, q),
        like(website.tags, q),
        like(website.categories, q),
        like(website.shortDesc, q)
      )!
    );
  }
  const where = and(...c);
  const [{ total }] = await db()
    .select({ total: count() })
    .from(website)
    .where(where);
  const rows: Website[] = await db()
    .select()
    .from(website)
    .where(where)
    .orderBy(desc(website.updatedAt))
    .limit(f.pageSize)
    .offset((f.page - 1) * f.pageSize);
  const counts = await websiteCounts(
    userId,
    rows.map((r) => r.id)
  );
  return {
    list: rows.map((r) => ({
      ...viewWebsite(r),
      counts: counts.get(r.id) ?? emptyCounts(),
    })),
    total,
  };
}

/** Names and ids for pickers. */
export async function websiteOptions(userId: string) {
  return (await db()
    .select({ id: website.id, name: website.name, url: website.url })
    .from(website)
    .where(and(eq(website.userId, userId), isNull(website.deletedAt)))
    .orderBy(desc(website.updatedAt))) as {
    id: string;
    name: string;
    url: string;
  }[];
}

export async function getWebsite(
  userId: string,
  id: string
): Promise<WebsiteView | null> {
  const [row]: Website[] = await db()
    .select()
    .from(website)
    .where(
      and(
        eq(website.id, id),
        eq(website.userId, userId),
        isNull(website.deletedAt)
      )
    )
    .limit(1);
  return row ? viewWebsite(row) : null;
}

export async function requireWebsite(userId: string, id: string) {
  const w = await getWebsite(userId, id);
  if (!w) throw new BacklinkError('Website not found', 404);
  return w;
}

export async function createWebsite(userId: string, body: any) {
  const [row]: Website[] = await db()
    .insert(website)
    .values({
      id: getUuid(),
      userId,
      ...sanitizeWebsiteInput(body),
      ...(await passwordFields(body)),
    })
    .returning();
  return viewWebsite(row);
}

export async function updateWebsite(userId: string, id: string, body: any) {
  const [row]: Website[] = await db()
    .update(website)
    .set({ ...sanitizeWebsiteInput(body), ...(await passwordFields(body)) })
    .where(
      and(
        eq(website.id, id),
        eq(website.userId, userId),
        isNull(website.deletedAt)
      )
    )
    .returning();
  if (!row) throw new BacklinkError('Website not found', 404);
  return viewWebsite(row);
}

/** Toggle switches from the list (自动外链, 启用). */
export async function patchWebsite(
  userId: string,
  id: string,
  body: { autoBacklinkEnabled?: unknown; status?: unknown }
) {
  const set: Partial<Website> = {};
  if (typeof body.autoBacklinkEnabled === 'boolean')
    set.autoBacklinkEnabled = body.autoBacklinkEnabled;
  if (body.status === 'enabled' || body.status === 'disabled')
    set.status = body.status;
  if (!Object.keys(set).length) throw new BacklinkError('Nothing to update');
  const [row]: Website[] = await db()
    .update(website)
    .set(set)
    .where(
      and(
        eq(website.id, id),
        eq(website.userId, userId),
        isNull(website.deletedAt)
      )
    )
    .returning();
  if (!row) throw new BacklinkError('Website not found', 404);
  return viewWebsite(row);
}

/**
 * 示例网站: a filled-in profile to explore the dashboard with. Auto backlinks
 * stay off so an agent never submits the sample to real sites.
 */
export async function createDemoWebsite(userId: string) {
  const [existing] = await db()
    .select({ id: website.id })
    .from(website)
    .where(and(eq(website.userId, userId), isNull(website.deletedAt)))
    .limit(1);
  if (existing)
    throw new BacklinkError('Demo is only for an empty website list', 409);
  return createWebsite(userId, {
    name: 'Demo Website',
    url: 'https://example.com/',
    internalNote: 'Sample profile. Edit it or delete it.',
    email: 'hello@example.com',
    shortDesc:
      'A sample product profile that shows every field a directory form may ask for.',
    longDesc:
      'Demo Website is a placeholder product. Replace this text with your own product description: what it does, who it is for and what makes it different.',
    tagline: 'Your product, one sentence',
    slogan: 'Ship it, then list it',
    categories: ['Productivity', 'SaaS'],
    tags: ['demo', 'sample'],
    priceModel: 'freemium',
    lowestPrice: '$9/month',
    links: [{ name: 'Demo Website', url: 'https://example.com/' }],
    autoBacklinkEnabled: false,
    ownerFirstName: 'Alex',
    ownerLastName: 'Morgan',
    ownerEmail: 'alex@example.com',
    location: {
      country: 'United States',
      state: 'CA',
      city: 'San Francisco',
      zip: '94105',
      address: '1 Market St',
    },
    metadata: [{ key: 'Founded', value: '2024' }],
  });
}

/** 复制: same profile, no submission records. */
export async function duplicateWebsite(userId: string, id: string) {
  const w = await requireWebsite(userId, id);
  return createWebsite(userId, { ...w, name: `${w.name} (copy)` });
}

/** 删除: soft delete, so the website and its records can be restored. */
export async function deleteWebsite(userId: string, id: string) {
  const [row] = await db()
    .update(website)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(website.id, id),
        eq(website.userId, userId),
        isNull(website.deletedAt)
      )
    )
    .returning({ id: website.id });
  if (!row) throw new BacklinkError('Website not found', 404);
}

export async function restoreWebsite(userId: string, id: string) {
  const [row] = await db()
    .update(website)
    .set({ deletedAt: null })
    .where(
      and(
        eq(website.id, id),
        eq(website.userId, userId),
        isNotNull(website.deletedAt)
      )
    )
    .returning({ id: website.id });
  if (!row) throw new BacklinkError('Website not found', 404);
}

/** 彻底删除: only a soft-deleted website, together with its records. */
export async function purgeWebsite(userId: string, id: string) {
  const [row] = await db()
    .select({ id: website.id })
    .from(website)
    .where(
      and(
        eq(website.id, id),
        eq(website.userId, userId),
        isNotNull(website.deletedAt)
      )
    )
    .limit(1);
  if (!row) throw new BacklinkError('Delete the website first', 409);
  await atomic((q) => [
    q
      .delete(websiteBacklink)
      .where(
        and(
          eq(websiteBacklink.userId, userId),
          eq(websiteBacklink.websiteId, id)
        )
      ),
    q
      .delete(website)
      .where(
        and(
          eq(website.id, id),
          eq(website.userId, userId),
          isNotNull(website.deletedAt)
        )
      ),
  ]);
}
