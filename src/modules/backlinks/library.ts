import {
  and,
  count,
  desc,
  eq,
  exists,
  getTableColumns,
  inArray,
  isNull,
  like,
  ne,
  notExists,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';

import { db } from '@/core/db';
import { atomic, AtomicGuardError, guard } from '@/core/db/atomic';
import {
  BACKLINK_CATEGORIES,
  BACKLINK_STATUSES,
  CONFIDENCES,
  COST_TYPES,
  domainOf,
  LINK_TYPES,
  MAX_ADD_BATCH,
  MAX_BATCH_NAME_LENGTH,
  normalizeUrl,
  oneOf,
  QUALITIES,
  type BacklinkCategory,
  type FailureReason,
} from '@/config/backlinks';
import {
  backlink,
  backlinkImportBatch,
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
  writeBatched,
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

async function uniqueBacklinkWrite<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    for (
      let cause: unknown = error;
      cause instanceof Error;
      cause = cause.cause
    ) {
      if (
        cause instanceof AtomicGuardError ||
        /UNIQUE constraint failed: (?:backlink\.owner_user_id, )?backlink\.link\b/.test(
          cause.message
        )
      ) {
        throw new BacklinkError('This URL is already saved', 409);
      }
    }
    throw error;
  }
}

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
    .onConflictDoNothing()
    .returning();
  if (!row) throw new BacklinkError('This URL is already saved', 409);
  return viewBacklink(row);
}

export async function updatePublicBacklink(id: string, body: any) {
  const input = sanitizeBacklinkInput(body);
  const [row]: Backlink[] = await uniqueBacklinkWrite(async () =>
    db()
      .update(backlink)
      .set(input)
      .where(and(eq(backlink.id, id), publicOnly))
      .returning()
  );
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

/** Import legacy library CSV into the caller's own library. */
export async function importLibraryCsv(userId: string, text: string) {
  const { rows, invalid } = parseLibraryCsv(text);
  const entries = [...new Map(rows.map((r) => [r.link, r])).values()];
  let created = 0;
  for (const part of chunk(entries, MAX_ADD_BATCH)) {
    const ids = await ensureLibraryEntries(userId, part);
    created += (await addToMine(userId, ids)).added;
  }
  return { created, skipped: rows.length - created, invalid };
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
  | { kind: 'all' }
  | { kind: 'recommended' }
  | { kind: 'category'; value: string }
  | { kind: 'tag'; value: string };

const recommendedSql = and(
  eq(backlink.status, 'approved'),
  inArray(backlink.costType, ['free', 'freemium']),
  inArray(backlink.confidence, ['observed', 'verified'])
)!;

function setCondition(set: SetSpec): SQL {
  if (set.kind === 'all') return sql`1 = 1`;
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
    batch?: string;
    category?: string;
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
  if (oneOf(f.category, BACKLINK_CATEGORIES))
    c.push(eq(backlink.category, f.category));
  if (f.enabled === 'enabled') c.push(eq(userBacklink.enabled, true));
  if (f.enabled === 'disabled') c.push(eq(userBacklink.enabled, false));
  if (f.batch === 'unbatched') c.push(isNull(userBacklink.batchId));
  else if (f.batch) c.push(eq(userBacklink.batchId, f.batch));
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
      .orderBy(desc(userBacklink.createdAt), userBacklink.id)
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

export async function listImportBatches(
  userId: string,
  page: number,
  pageSize: number,
  enabledOnly = false
): Promise<{
  list: { id: string; name: string; count: number }[];
  total: number;
  unbatched: number;
}> {
  const owner = eq(backlinkImportBatch.userId, userId);
  const member = and(
    eq(userBacklink.userId, userId),
    enabledOnly ? eq(userBacklink.enabled, true) : undefined
  );
  const { limit, offset } = pageOf(page, pageSize);
  const [list, [{ total }], [{ unbatched }]] = await Promise.all([
    db()
      .select({
        id: backlinkImportBatch.id,
        name: backlinkImportBatch.name,
        count: count(userBacklink.id),
      })
      .from(backlinkImportBatch)
      .leftJoin(
        userBacklink,
        and(eq(userBacklink.batchId, backlinkImportBatch.id), member)
      )
      .where(owner)
      .groupBy(backlinkImportBatch.id)
      .orderBy(
        desc(backlinkImportBatch.createdAt),
        desc(backlinkImportBatch.id)
      )
      .limit(limit)
      .offset(offset),
    db().select({ total: count() }).from(backlinkImportBatch).where(owner),
    db()
      .select({ unbatched: count() })
      .from(userBacklink)
      .where(and(member, isNull(userBacklink.batchId))),
  ]);
  return { list, total, unbatched };
}

/** Resolve whole batches from the caller's currently enabled library. */
export async function resolveImportBatches(userId: string, batchIds: string[]) {
  if (!batchIds.length) throw new BacklinkError('Select at least one batch');
  const named = batchIds.filter((id) => id !== 'unbatched');
  const byName = named.length
    ? sql`${userBacklink.batchId} in (
        select ${backlinkImportBatch.id} from ${backlinkImportBatch}
        where ${backlinkImportBatch.userId} = ${userId}
          and ${backlinkImportBatch.id} in (select value from json_each(${JSON.stringify(named)}))
      )`
    : undefined;
  const group = or(
    byName,
    batchIds.includes('unbatched') ? isNull(userBacklink.batchId) : undefined
  );
  const rows: { id: string }[] = await db()
    .select({ id: userBacklink.backlinkId })
    .from(userBacklink)
    .where(
      and(
        eq(userBacklink.userId, userId),
        eq(userBacklink.enabled, true),
        group
      )
    )
    .limit(MAX_ADD_BATCH + 1);
  if (rows.length > MAX_ADD_BATCH)
    throw new BacklinkError(
      `Selected batches exceed the ${MAX_ADD_BATCH} backlink limit`
    );
  return rows.map((row) => row.id);
}

/** Skip a URL already saved through another catalog entry as well as the same ID. */
function libraryMembershipInsert(
  q: ReturnType<typeof db>,
  userId: string,
  ids: string[],
  batchId: string | null = null
) {
  const saved = alias(backlink, 'saved_backlink');
  const membership = q
    .select({ id: userBacklink.id })
    .from(userBacklink)
    .where(
      and(
        eq(userBacklink.userId, userId),
        eq(userBacklink.backlinkId, saved.id)
      )
    );
  // Find catalog IDs by URL first, then look up their memberships by ID.
  const existing = q
    .select({ id: saved.id })
    .from(saved)
    .where(
      and(
        eq(saved.link, backlink.link),
        // A named import may group the original unbatched membership in place.
        batchId ? ne(saved.id, backlink.id) : undefined,
        exists(membership)
      )
    );
  const now = Date.now();
  return q.insert(userBacklink).select(
    q
      .select({
        id: sql`lower(hex(randomblob(16)))`,
        userId: sql`${userId}`,
        backlinkId: sql`min(${backlink.id})`,
        batchId: sql`${batchId}`,
        source: sql`'favorite'`,
        quality: sql`'unrated'`,
        notes: sql`''`,
        enabled: sql`1`,
        createdAt: sql`${now}`,
        updatedAt: sql`${now}`,
      })
      .from(backlink)
      .where(
        and(
          sql`${backlink.id} in (select value from json_each(${JSON.stringify(ids)}))`,
          or(publicOnly, eq(backlink.ownerUserId, userId)),
          notExists(existing)
        )
      )
      .groupBy(backlink.link)
  );
}

export async function addToMine(userId: string, backlinkIds: string[]) {
  const ids = [...new Set(backlinkIds)].slice(0, MAX_ADD_BATCH);
  if (!ids.length) return { added: 0 };
  const inserted = await libraryMembershipInsert(db(), userId, ids)
    .onConflictDoNothing()
    .returning({ id: userBacklink.id });
  return { added: inserted.length };
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

function requireUnsavedUrl(userId: string, link: string, exceptId?: string) {
  return guard({
    table: userBacklink,
    column: 'userId',
    where: and(
      eq(userBacklink.userId, userId),
      exceptId ? ne(userBacklink.backlinkId, exceptId) : undefined,
      sql`exists (select 1 from ${backlink}
        where ${backlink.id} = ${userBacklink.backlinkId} and ${backlink.link} = ${link})`
    ),
    require: sql`0 = 1`,
    message: 'This URL is already saved',
  });
}

/** A private entry only this user sees, saved straight into their library. */
export async function createOwn(userId: string, body: any) {
  const input = sanitizeBacklinkInput({ ...body, status: 'pending' });
  const id = getUuid();
  await uniqueBacklinkWrite(() =>
    atomic((q) => [
      requireUnsavedUrl(userId, input.link),
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
    ])
  );
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
  const input =
    row.ownerUserId === userId
      ? sanitizeBacklinkInput({ ...body, status: row.status })
      : null;
  await uniqueBacklinkWrite(() =>
    atomic((q) => [
      input &&
        input.link !== row.link &&
        requireUnsavedUrl(userId, input.link, backlinkId),
      input && q.update(backlink).set(input).where(eq(backlink.id, backlinkId)),
      q
        .update(userBacklink)
        .set(personalFields(body))
        .where(
          and(
            eq(userBacklink.userId, userId),
            eq(userBacklink.backlinkId, backlinkId)
          )
        ),
    ])
  );
}

/** Remove the library membership while preserving linked website records. */
export async function removeMine(userId: string, backlinkId: string) {
  await db()
    .delete(userBacklink)
    .where(
      and(
        eq(userBacklink.userId, userId),
        eq(userBacklink.backlinkId, backlinkId)
      )
    );
}

/** Delete memberships in one group, leaving catalog and submission history intact. */
export async function batchRemoveMine(
  userId: string,
  batchId: string,
  backlinkIds?: string[]
) {
  if (!batchId || (backlinkIds && backlinkIds.length === 0))
    throw new BacklinkError('Select a batch and at least one backlink');

  const group =
    batchId === 'unbatched'
      ? isNull(userBacklink.batchId)
      : eq(userBacklink.batchId, batchId);
  const selected = backlinkIds
    ? sql`${userBacklink.backlinkId} in (select value from json_each(${JSON.stringify(backlinkIds)}))`
    : undefined;
  const removed = await db()
    .delete(userBacklink)
    .where(and(eq(userBacklink.userId, userId), group, selected))
    .returning({ id: userBacklink.id });
  return { deleted: removed.length };
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
async function ensureEntriesForUrls(
  userId: string,
  urls: string[]
): Promise<{ ids: string[]; invalid: number; duplicates: number }> {
  const normalized = new Set<string>();
  let invalid = 0;
  let duplicates = 0;
  const lines = urls.slice(0, MAX_ADD_BATCH).map((u) => u.trim());
  for (const u of lines) {
    if (!u) continue;
    const n = normalizeUrl(u);
    if (!n || n.length > 1000) invalid++;
    else if (normalized.has(n)) duplicates++;
    else normalized.add(n);
  }
  const ids = await ensureLibraryEntries(
    userId,
    [...normalized].map((link) =>
      sanitizeBacklinkInput({ link, status: 'pending' })
    )
  );
  return { ids, invalid, duplicates };
}

async function ensureLibraryEntries(
  userId: string,
  inputs: ReturnType<typeof sanitizeBacklinkInput>[]
) {
  const visible = or(publicOnly, eq(backlink.ownerUserId, userId));
  const now = Date.now();
  const fields = sql.join(
    Object.keys(getTableColumns(backlink)).map(
      (key) => sql`json_extract(candidate.value, ${'$.'.concat(key)})`
    ),
    sql`, `
  );
  // The lookup and conditional insert run in the same SQLite statement, so
  // concurrent imports of a new URL reuse the same entry.
  await writeBatched(chunk(inputs, 50), (q, part) => {
    const values = part.map((input) => ({
      ...input,
      id: getUuid(),
      ownerUserId: userId,
      visibility: 'private',
      createdAt: now,
      updatedAt: now,
    }));
    return q.insert(backlink).select(sql`
      select ${fields}
      from json_each(${JSON.stringify(values)}) as candidate
      where not exists (
        select 1 from ${backlink}
        where ${backlink.link} = json_extract(candidate.value, '$.link')
          and ${visible}
      )
    `);
  });

  const links = inputs.map((input) => input.link);
  const byLink = new Map<string, string>();
  for (const part of chunk(links, IN_CHUNK)) {
    const found: { id: string; link: string }[] = await db()
      .select({ id: backlink.id, link: backlink.link })
      .from(backlink)
      .leftJoin(
        userBacklink,
        and(
          eq(userBacklink.userId, userId),
          eq(userBacklink.backlinkId, backlink.id)
        )
      )
      .where(and(inArray(backlink.link, part), visible))
      .orderBy(desc(sql`${userBacklink.id} is not null`), backlink.id);
    for (const f of found) if (!byLink.has(f.link)) byLink.set(f.link, f.id);
  }
  return links.flatMap((link) => {
    const id = byLink.get(link);
    return id ? [id] : [];
  });
}

async function saveNamedImport(userId: string, name: string, ids: string[]) {
  if (!ids.length) return { added: 0 };
  const owner = eq(backlinkImportBatch.userId, userId);
  const noLinks = sql`not exists (
    select 1 from ${userBacklink}
    where ${userBacklink.userId} = ${userId}
      and ${userBacklink.batchId} = ${backlinkImportBatch.id}
  )`;
  const [emptyBatch]: { id: string }[] = await db()
    .select({ id: backlinkImportBatch.id })
    .from(backlinkImportBatch)
    .where(and(owner, eq(backlinkImportBatch.name, name), noLinks))
    .orderBy(desc(backlinkImportBatch.createdAt), desc(backlinkImportBatch.id))
    .limit(1);
  const batchId = emptyBatch?.id ?? getUuid();
  await atomic((q) => [
    !emptyBatch &&
      q.insert(backlinkImportBatch).values({ id: batchId, userId, name }),
    libraryMembershipInsert(q, userId, ids, batchId).onConflictDoUpdate({
      target: [userBacklink.userId, userBacklink.backlinkId],
      set: { batchId },
      setWhere: isNull(userBacklink.batchId),
    }),
    !emptyBatch &&
      q
        .delete(backlinkImportBatch)
        .where(and(owner, eq(backlinkImportBatch.id, batchId), noLinks)),
  ]);
  const [{ added }] = await db()
    .select({ added: count() })
    .from(userBacklink)
    .where(
      and(
        eq(userBacklink.userId, userId),
        eq(userBacklink.batchId, batchId),
        sql`${userBacklink.backlinkId} in (select value from json_each(${JSON.stringify(ids)}))`
      )
    );
  return { added };
}

/** Both personal and website URL import entry points save through this function. */
export async function importUrlsToMine(
  userId: string,
  urls: string[],
  batchName?: unknown
) {
  const name = typeof batchName === 'string' ? batchName.trim() : '';
  if (batchName !== undefined && (!name || name.length > MAX_BATCH_NAME_LENGTH))
    throw new BacklinkError('Invalid batch name');

  const { ids, invalid, duplicates } = await ensureEntriesForUrls(userId, urls);
  const { added } = name
    ? await saveNamedImport(userId, name, ids)
    : await addToMine(userId, ids);
  const submitted = urls
    .slice(0, MAX_ADD_BATCH)
    .filter((url) => url.trim()).length;
  return {
    ids,
    duplicates,
    added,
    invalid,
    skipped: Math.max(0, submitted - invalid - added),
  };
}

/** 批量导入: a set from the plaza, picked plaza ids, or pasted URLs. */
export async function importToMine(
  userId: string,
  body: { set?: SetSpec; ids?: string[]; urls?: string[]; batchName?: unknown }
) {
  if (body.set) {
    return addToMine(userId, await resolveSet(userId, 'plaza', body.set));
  }
  if (body.ids) return addToMine(userId, body.ids);
  if (body.urls) {
    const { added, invalid, skipped } = await importUrlsToMine(
      userId,
      body.urls,
      body.batchName
    );
    return { added, invalid, skipped };
  }
  throw new BacklinkError('Nothing to import');
}

/**
 * A submission went through: the user's own entry is evidently free to submit,
 * so it joins 推荐. Public entries are left to admins.
 */
export function planMarkProven(q: any, userId: string, backlinkId: string) {
  return q
    .update(backlink)
    .set({
      status: 'approved',
      costType: sql`case when ${backlink.costType} = 'unknown' then 'free' else ${backlink.costType} end`,
      confidence: sql`case when ${backlink.confidence} = 'unknown' then 'observed' else ${backlink.confidence} end`,
    })
    .where(
      and(
        eq(backlink.id, backlinkId),
        eq(backlink.ownerUserId, userId),
        eq(backlink.visibility, 'private'),
        ne(backlink.status, 'rejected')
      )
    );
}

/**
 * What a failure says about the user's own entry: paid-only sites leave 推荐,
 * CAPTCHA and product-specific rejection never disable other websites.
 */
export async function applyFailureReason(
  userId: string,
  backlinkId: string,
  reason: FailureReason
) {
  const step = planFailureReason(db(), userId, backlinkId, reason);
  if (step) await step;
}

export function planFailureReason(
  q: any,
  userId: string,
  backlinkId: string,
  reason: FailureReason
) {
  const own = and(
    eq(backlink.id, backlinkId),
    eq(backlink.ownerUserId, userId),
    eq(backlink.visibility, 'private')
  );
  if (reason === 'paid')
    return q.update(backlink).set({ costType: 'paid' }).where(own);
  return false;
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
