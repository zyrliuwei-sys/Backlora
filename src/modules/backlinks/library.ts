import {
  and,
  count,
  desc,
  eq,
  inArray,
  like,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import { db } from '@/core/db';
import { atomic } from '@/core/db/atomic';
import {
  BACKLINK_CATEGORIES,
  BACKLINK_STATUSES,
  CONFIDENCES,
  COST_TYPES,
  domainOf,
  LINK_TYPES,
  MAX_ADD_BATCH,
  normalizeUrl,
  oneOf,
  QUALITIES,
  type BacklinkCategory,
} from '@/config/backlinks';
import {
  backlink,
  userBacklink,
  type Backlink,
  type NewBacklink,
} from '@/config/db/schema';
import { parseCsv } from '@/lib/csv';
import { getUuid } from '@/lib/hash';

import {
  BacklinkError,
  chunk,
  IN_CHUNK,
  numOrNull,
  pageOf,
  parseJson,
  str,
  stringList,
} from './shared';

export type BacklinkView = Omit<Backlink, 'tags'> & { tags: string[] };

export function viewBacklink(b: Backlink): BacklinkView {
  return { ...b, tags: parseJson<string[]>(b.tags, []) };
}

/** Library-wide fields of an entry (create/update body → row). */
export function sanitizeBacklinkInput(
  body: any
): Omit<NewBacklink, 'id' | 'ownerUserId' | 'visibility'> {
  const link = normalizeUrl(str(body?.link, 1000));
  if (!link) throw new BacklinkError('Invalid submission URL');
  return {
    name: str(body?.name, 200) || domainOf(link),
    link,
    domain: domainOf(link),
    tags: JSON.stringify(stringList(body?.tags)),
    category: oneOf(body?.category, BACKLINK_CATEGORIES)
      ? body.category
      : 'other',
    costType: oneOf(body?.costType, COST_TYPES) ? body.costType : 'unknown',
    linkType: oneOf(body?.linkType, LINK_TYPES) ? body.linkType : 'unknown',
    language: str(body?.language, 20),
    details: str(body?.details, 4000),
    tips: str(body?.tips, 4000),
    dr: numOrNull(body?.dr),
    organicTraffic:
      numOrNull(body?.organicTraffic) == null
        ? null
        : Math.round(Number(body.organicTraffic)),
    status: oneOf(body?.status, BACKLINK_STATUSES) ? body.status : 'approved',
    quality: oneOf(body?.quality, QUALITIES) ? body.quality : 'unrated',
    confidence: oneOf(body?.confidence, CONFIDENCES)
      ? body.confidence
      : 'unknown',
  };
}

export type LibraryFilter = {
  search?: string;
  tag?: string;
  category?: string;
  status?: string;
  costType?: string;
};

function filterConditions(f: LibraryFilter): SQL[] {
  const c: SQL[] = [];
  if (f.search) {
    const q = `%${f.search}%`;
    c.push(
      or(
        like(backlink.name, q),
        like(backlink.link, q),
        like(backlink.category, q),
        like(backlink.details, q)
      )!
    );
  }
  if (f.tag) c.push(like(backlink.tags, `%${JSON.stringify(f.tag)}%`));
  if (oneOf(f.category, BACKLINK_CATEGORIES))
    c.push(eq(backlink.category, f.category));
  if (oneOf(f.status, BACKLINK_STATUSES)) c.push(eq(backlink.status, f.status));
  if (oneOf(f.costType, COST_TYPES)) c.push(eq(backlink.costType, f.costType));
  return c;
}

const publicOnly = eq(backlink.visibility, 'public');

// ─── Plaza (public library) ─────────────────────────────────────────────────

export async function listPlaza(
  f: LibraryFilter & { page: number; pageSize: number }
) {
  const where = and(publicOnly, ...filterConditions(f));
  const [{ total }] = await db()
    .select({ total: count() })
    .from(backlink)
    .where(where);
  const rows: Backlink[] = await db()
    .select()
    .from(backlink)
    .where(where)
    .orderBy(
      sql`${backlink.dr} is null`,
      desc(backlink.dr),
      desc(backlink.createdAt)
    )
    .limit(f.pageSize)
    .offset((f.page - 1) * f.pageSize);
  return { list: rows.map(viewBacklink), total };
}

export async function getBacklink(id: string): Promise<Backlink | null> {
  const [row]: Backlink[] = await db()
    .select()
    .from(backlink)
    .where(eq(backlink.id, id))
    .limit(1);
  return row ?? null;
}

/** An entry the user may see: public, or their own private one. */
export async function getVisibleBacklink(userId: string, id: string) {
  const row = await getBacklink(id);
  if (!row) return null;
  if (row.visibility !== 'public' && row.ownerUserId !== userId) return null;
  return row;
}

export async function createPublicBacklink(body: any) {
  const input = sanitizeBacklinkInput(body);
  const [row]: Backlink[] = await db()
    .insert(backlink)
    .values({
      id: getUuid(),
      visibility: 'public',
      ownerUserId: null,
      ...input,
    })
    .returning();
  return viewBacklink(row);
}

export async function updatePublicBacklink(id: string, body: any) {
  const input = sanitizeBacklinkInput(body);
  const [row]: Backlink[] = await db()
    .update(backlink)
    .set(input)
    .where(and(eq(backlink.id, id), publicOnly))
    .returning();
  if (!row) throw new BacklinkError('Not found', 404);
  return viewBacklink(row);
}

export async function deletePublicBacklink(id: string) {
  await db()
    .delete(backlink)
    .where(and(eq(backlink.id, id), publicOnly));
}

const IMPORT_COLUMNS: Record<string, string> = {
  name: 'name',
  名称: 'name',
  link: 'link',
  url: 'link',
  submit_url: 'link',
  submission_url: 'link',
  网址: 'link',
  提交网址: 'link',
  tags: 'tags',
  标签: 'tags',
  category: 'category',
  分类: 'category',
  cost: 'costType',
  cost_type: 'costType',
  费用: 'costType',
  link_type: 'linkType',
  rel: 'linkType',
  language: 'language',
  语言: 'language',
  details: 'details',
  说明: 'details',
  tips: 'tips',
  提示: 'tips',
  dr: 'dr',
  traffic: 'organicTraffic',
  organic_traffic: 'organicTraffic',
  月流量: 'organicTraffic',
  status: 'status',
  quality: 'quality',
  confidence: 'confidence',
};

/** CSV with a header row, or one URL per line. */
export function parseLibraryCsv(text: string) {
  const table = parseCsv(text);
  if (!table.length) return { rows: [] as any[], invalid: 0 };
  const header = table[0].map((h) => h.toLowerCase().replace(/[\s-]+/g, '_'));
  const hasHeader = header.some((h) => IMPORT_COLUMNS[h] === 'link');
  const rows: ReturnType<typeof sanitizeBacklinkInput>[] = [];
  let invalid = 0;
  for (const cells of (hasHeader ? table.slice(1) : table).slice(0, 10000)) {
    const raw: Record<string, string> = {};
    if (hasHeader) {
      header.forEach((h, i) => {
        const k = IMPORT_COLUMNS[h];
        if (k && cells[i] !== undefined) raw[k] = cells[i];
      });
    } else {
      [raw.link, raw.name, raw.category] = cells;
    }
    try {
      rows.push(sanitizeBacklinkInput(raw));
    } catch {
      invalid++;
    }
  }
  return { rows, invalid };
}

/** Bulk-add public entries; links already in the plaza are skipped. */
export async function importPlaza(text: string) {
  const { rows, invalid } = parseLibraryCsv(text);
  const unique = new Map(rows.map((r) => [r.link, r]));
  const existing = new Set<string>();
  for (const part of chunk([...unique.keys()], IN_CHUNK)) {
    const found: { link: string }[] = await db()
      .select({ link: backlink.link })
      .from(backlink)
      .where(and(publicOnly, inArray(backlink.link, part)));
    for (const f of found) existing.add(f.link);
  }
  const fresh = [...unique.values()].filter((r) => !existing.has(r.link));
  // ~19 columns per row → 4 rows per statement keeps under 100 params.
  for (const part of chunk(fresh, 4)) {
    await db()
      .insert(backlink)
      .values(
        part.map((r) => ({
          id: getUuid(),
          visibility: 'public',
          ownerUserId: null,
          ...r,
        }))
      );
  }
  return {
    created: fresh.length,
    skipped: rows.length - fresh.length,
    invalid,
  };
}

export async function allPlaza(): Promise<BacklinkView[]> {
  const rows: Backlink[] = await db()
    .select()
    .from(backlink)
    .where(publicOnly)
    .orderBy(backlink.category, backlink.name);
  return rows.map(viewBacklink);
}

// ─── Sets (推荐外链套餐) ─────────────────────────────────────────────────────

export type LibraryScope = 'plaza' | 'personal';
export type SetSpec =
  | { kind: 'recommended' }
  | { kind: 'category'; value: string }
  | { kind: 'tag'; value: string };

const recommendedSql = and(
  eq(backlink.status, 'approved'),
  eq(backlink.category, 'directory'),
  inArray(backlink.costType, ['free', 'freemium']),
  inArray(backlink.confidence, ['observed', 'verified'])
)!;

function setCondition(set: SetSpec): SQL {
  if (set.kind === 'recommended') return recommendedSql;
  if (set.kind === 'category') {
    if (!oneOf(set.value, BACKLINK_CATEGORIES))
      throw new BacklinkError('Invalid category');
    return eq(backlink.category, set.value);
  }
  const tag = str(set.value, 60);
  if (!tag) throw new BacklinkError('Tag is required');
  return like(backlink.tags, `%${JSON.stringify(tag)}%`);
}

/** Ids of entries in a set, from the plaza or the user's enabled library. */
export async function resolveSet(
  userId: string,
  scope: LibraryScope,
  set: SetSpec
): Promise<string[]> {
  if (scope === 'plaza') {
    const rows: { id: string }[] = await db()
      .select({ id: backlink.id })
      .from(backlink)
      .where(and(publicOnly, setCondition(set)))
      .limit(MAX_ADD_BATCH);
    return rows.map((r) => r.id);
  }
  const rows: { id: string }[] = await db()
    .select({ id: backlink.id })
    .from(userBacklink)
    .innerJoin(backlink, eq(backlink.id, userBacklink.backlinkId))
    .where(
      and(
        eq(userBacklink.userId, userId),
        eq(userBacklink.enabled, true),
        setCondition(set)
      )
    )
    .limit(MAX_ADD_BATCH);
  return rows.map((r) => r.id);
}

/** Counts behind the set picker: recommended, per category, top tags. */
export async function setFacets(userId: string, scope: LibraryScope) {
  const base =
    scope === 'plaza'
      ? db()
          .select({
            id: backlink.id,
            category: backlink.category,
            tags: backlink.tags,
            status: backlink.status,
            costType: backlink.costType,
            confidence: backlink.confidence,
          })
          .from(backlink)
          .where(publicOnly)
      : db()
          .select({
            id: backlink.id,
            category: backlink.category,
            tags: backlink.tags,
            status: backlink.status,
            costType: backlink.costType,
            confidence: backlink.confidence,
          })
          .from(userBacklink)
          .innerJoin(backlink, eq(backlink.id, userBacklink.backlinkId))
          .where(
            and(eq(userBacklink.userId, userId), eq(userBacklink.enabled, true))
          );
  const rows: {
    category: string;
    tags: string;
    status: string;
    costType: string;
    confidence: string;
  }[] = await base;

  const categories = Object.fromEntries(
    BACKLINK_CATEGORIES.map((c) => [c, 0])
  ) as Record<BacklinkCategory, number>;
  const tags = new Map<string, number>();
  let recommended = 0;
  for (const r of rows) {
    if (r.category in categories) categories[r.category as BacklinkCategory]++;
    for (const t of parseJson<string[]>(r.tags, []))
      tags.set(t, (tags.get(t) ?? 0) + 1);
    if (
      r.status === 'approved' &&
      r.category === 'directory' &&
      (r.costType === 'free' || r.costType === 'freemium') &&
      (r.confidence === 'observed' || r.confidence === 'verified')
    )
      recommended++;
  }
  return {
    total: rows.length,
    recommended,
    categories,
    tags: [...tags.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tag, n]) => ({ tag, count: n })),
  };
}

// ─── My library (个人外链库) ──────────────────────────────────────────────────

export async function favoriteIds(userId: string): Promise<string[]> {
  const rows: { id: string }[] = await db()
    .select({ id: userBacklink.backlinkId })
    .from(userBacklink)
    .where(eq(userBacklink.userId, userId));
  return rows.map((r) => r.id);
}

export async function listMine(
  userId: string,
  f: {
    page: number;
    pageSize: number;
    search?: string;
    quality?: string;
    enabled?: string;
  }
) {
  const c: SQL[] = [eq(userBacklink.userId, userId)];
  if (f.search) {
    const q = `%${f.search}%`;
    c.push(
      or(
        like(backlink.name, q),
        like(backlink.link, q),
        like(backlink.category, q),
        like(userBacklink.notes, q)
      )!
    );
  }
  if (oneOf(f.quality, QUALITIES)) c.push(eq(userBacklink.quality, f.quality));
  if (f.enabled === 'enabled') c.push(eq(userBacklink.enabled, true));
  if (f.enabled === 'disabled') c.push(eq(userBacklink.enabled, false));
  const where = and(...c);

  const [{ total }] = await db()
    .select({ total: count() })
    .from(userBacklink)
    .innerJoin(backlink, eq(backlink.id, userBacklink.backlinkId))
    .where(where);
  const { limit, offset } = pageOf(f.page, f.pageSize);
  const rows: { b: Backlink; u: typeof userBacklink.$inferSelect }[] =
    await db()
      .select({ b: backlink, u: userBacklink })
      .from(userBacklink)
      .innerJoin(backlink, eq(backlink.id, userBacklink.backlinkId))
      .where(where)
      .orderBy(desc(userBacklink.createdAt))
      .limit(limit)
      .offset(offset);
  return {
    list: rows.map(({ b, u }) => ({
      ...viewBacklink(b),
      libraryId: u.id,
      source: u.source,
      personalQuality: u.quality,
      notes: u.notes,
      enabled: u.enabled,
      isOwner: b.ownerUserId === userId,
      libraryCreatedAt: u.createdAt,
    })),
    total,
  };
}

/** Add public entries to the user's library (already-saved ones are kept). */
export async function addToMine(userId: string, backlinkIds: string[]) {
  const ids = [...new Set(backlinkIds)].slice(0, MAX_ADD_BATCH);
  let added = 0;
  for (const part of chunk(ids, IN_CHUNK)) {
    const visible: { id: string }[] = await db()
      .select({ id: backlink.id })
      .from(backlink)
      .where(
        and(
          inArray(backlink.id, part),
          or(publicOnly, eq(backlink.ownerUserId, userId))
        )
      );
    const saved = new Set(
      (
        (await db()
          .select({ id: userBacklink.backlinkId })
          .from(userBacklink)
          .where(
            and(
              eq(userBacklink.userId, userId),
              inArray(userBacklink.backlinkId, part)
            )
          )) as { id: string }[]
      ).map((r) => r.id)
    );
    const fresh = visible.filter((v) => !saved.has(v.id));
    // 7 bound params per row (column defaults are bound too) → 14 rows keeps
    // under D1's 100.
    for (const rows of chunk(fresh, 14)) {
      await db()
        .insert(userBacklink)
        .values(
          rows.map((r) => ({
            id: getUuid(),
            userId,
            backlinkId: r.id,
            source: 'favorite',
          }))
        )
        .onConflictDoNothing();
    }
    added += fresh.length;
  }
  return { added };
}

/** Toggle a plaza entry in/out of the user's library. */
export async function toggleFavorite(userId: string, backlinkId: string) {
  const [row] = await db()
    .select({ id: userBacklink.id })
    .from(userBacklink)
    .where(
      and(
        eq(userBacklink.userId, userId),
        eq(userBacklink.backlinkId, backlinkId)
      )
    )
    .limit(1);
  if (row) {
    await removeMine(userId, backlinkId);
    return { favorited: false };
  }
  await addToMine(userId, [backlinkId]);
  return { favorited: true };
}

function personalFields(body: any) {
  return {
    quality: oneOf(body?.personalQuality, QUALITIES)
      ? body.personalQuality
      : 'unrated',
    notes: str(body?.notes, 2000),
    enabled: body?.enabled === undefined ? true : Boolean(body.enabled),
  };
}

/** A private entry only this user sees, saved straight into their library. */
export async function createOwn(userId: string, body: any) {
  const input = sanitizeBacklinkInput({ ...body, status: 'pending' });
  const id = getUuid();
  await atomic((q) => [
    q.insert(backlink).values({
      id,
      ownerUserId: userId,
      visibility: 'private',
      ...input,
    }),
    q.insert(userBacklink).values({
      id: getUuid(),
      userId,
      backlinkId: id,
      source: 'own',
      ...personalFields(body),
    }),
  ]);
  return { id };
}

/**
 * Edit a library item. Personal fields always; the entry's own fields only
 * when the user owns it (public entries stay as the plaza has them).
 */
export async function updateMine(
  userId: string,
  backlinkId: string,
  body: any
) {
  const row = await getBacklink(backlinkId);
  if (!row) throw new BacklinkError('Not found', 404);
  const owner = row.ownerUserId === userId;
  await atomic((q) => [
    owner &&
      q
        .update(backlink)
        .set(sanitizeBacklinkInput({ ...body, status: row.status }))
        .where(eq(backlink.id, backlinkId)),
    q
      .update(userBacklink)
      .set(personalFields(body))
      .where(
        and(
          eq(userBacklink.userId, userId),
          eq(userBacklink.backlinkId, backlinkId)
        )
      ),
  ]);
}

/** Remove from the library; a private entry of the user is deleted too. */
export async function removeMine(userId: string, backlinkId: string) {
  await atomic((q) => [
    q
      .delete(userBacklink)
      .where(
        and(
          eq(userBacklink.userId, userId),
          eq(userBacklink.backlinkId, backlinkId)
        )
      ),
    q
      .delete(backlink)
      .where(
        and(eq(backlink.id, backlinkId), eq(backlink.ownerUserId, userId))
      ),
  ]);
}

export async function clearMine(userId: string) {
  await atomic((q) => [
    q.delete(userBacklink).where(eq(userBacklink.userId, userId)),
    q.delete(backlink).where(eq(backlink.ownerUserId, userId)),
  ]);
}

/**
 * Turn URLs into library entries the user can use: an existing public entry
 * with the same submission URL is saved, anything else becomes a private one.
 */
export async function ensureEntriesForUrls(
  userId: string,
  urls: string[]
): Promise<{ ids: string[]; invalid: number }> {
  const normalized = new Set<string>();
  let invalid = 0;
  for (const u of urls.slice(0, MAX_ADD_BATCH)) {
    const n = normalizeUrl(u);
    if (n) normalized.add(n);
    else if (u.trim()) invalid++;
  }
  const links = [...normalized];
  const byLink = new Map<string, string>();
  for (const part of chunk(links, IN_CHUNK)) {
    const found: { id: string; link: string }[] = await db()
      .select({ id: backlink.id, link: backlink.link })
      .from(backlink)
      .where(
        and(
          inArray(backlink.link, part),
          or(publicOnly, eq(backlink.ownerUserId, userId))
        )
      );
    for (const f of found) if (!byLink.has(f.link)) byLink.set(f.link, f.id);
  }
  const fresh = links.filter((l) => !byLink.has(l));
  for (const part of chunk(fresh, 4)) {
    const values = part.map((link) => ({
      id: getUuid(),
      ownerUserId: userId,
      visibility: 'private',
      ...sanitizeBacklinkInput({ link, status: 'pending' }),
    }));
    await db().insert(backlink).values(values);
    for (const v of values) byLink.set(v.link, v.id);
  }
  return { ids: links.map((l) => byLink.get(l)!), invalid };
}

/** 批量导入: a set from the plaza, picked plaza ids, or pasted URLs. */
export async function importToMine(
  userId: string,
  body: { set?: SetSpec; ids?: string[]; urls?: string[] }
) {
  if (body.set) {
    return addToMine(userId, await resolveSet(userId, 'plaza', body.set));
  }
  if (body.ids) return addToMine(userId, body.ids);
  if (body.urls) {
    const { ids, invalid } = await ensureEntriesForUrls(userId, body.urls);
    return { ...(await addToMine(userId, ids)), invalid };
  }
  throw new BacklinkError('Nothing to import');
}

/** Personal notes for a set of entries (task `library_notes`). */
export async function libraryNotes(
  userId: string,
  backlinkId: string
): Promise<string | null> {
  const [row]: { notes: string }[] = await db()
    .select({ notes: userBacklink.notes })
    .from(userBacklink)
    .where(
      and(
        eq(userBacklink.userId, userId),
        eq(userBacklink.backlinkId, backlinkId)
      )
    )
    .limit(1);
  return row?.notes || null;
}
