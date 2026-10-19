import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  like,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import { db } from '@/core/db';
import {
  domainOf,
  LINK_STATUSES,
  MAX_ADD_BATCH,
  normalizeUrl,
  oneOf,
  OPERATION_STATUSES,
  PROGRESS_BUCKETS,
  PROGRESS_STATUSES,
  type LinkStatus,
  type OperationStatus,
} from '@/config/backlinks';
import {
  backlink,
  website,
  websiteBacklink,
  type WebsiteBacklink,
} from '@/config/db/schema';
import { parseCsv } from '@/lib/csv';
import { getUuid } from '@/lib/hash';

import {
  ensureEntriesForUrls,
  resolveSet,
  type LibraryScope,
  type SetSpec,
} from './library';
import { BacklinkError, chunk, IN_CHUNK, str, strOrNull } from './shared';
import { requireWebsite, websiteOptions } from './websites';

export type RecordFilter = {
  websiteId?: string;
  operationStatus?: string;
  progressStatus?: string;
  linkStatus?: string;
  search?: string;
  sourceDomain?: string;
  targetDomain?: string;
  agentOnly?: boolean;
  page: number;
  pageSize: number;
};

/** Records of a soft-deleted website stay hidden until it is restored. */
const websiteNotDeleted = sql`not exists (select 1 from ${website} where ${website.id} = ${websiteBacklink.websiteId} and ${website.deletedAt} is not null)`;

function conditions(
  userId: string,
  f: Omit<RecordFilter, 'page' | 'pageSize'>
) {
  const c: SQL[] = [eq(websiteBacklink.userId, userId), websiteNotDeleted];
  if (f.websiteId) c.push(eq(websiteBacklink.websiteId, f.websiteId));
  if (oneOf(f.operationStatus, OPERATION_STATUSES))
    c.push(eq(websiteBacklink.operationStatus, f.operationStatus));
  else if (oneOf(f.progressStatus, PROGRESS_STATUSES))
    c.push(
      inArray(websiteBacklink.operationStatus, [
        ...PROGRESS_BUCKETS[f.progressStatus],
      ])
    );
  if (f.sourceDomain)
    c.push(like(websiteBacklink.sourceDomain, `%${f.sourceDomain}%`));
  if (f.targetDomain)
    c.push(like(websiteBacklink.targetDomain, `%${f.targetDomain}%`));
  if (oneOf(f.linkStatus, LINK_STATUSES))
    c.push(eq(websiteBacklink.linkStatus, f.linkStatus));
  if (f.agentOnly) c.push(isNotNull(websiteBacklink.claimedBy));
  if (f.search) {
    const q = `%${f.search}%`;
    c.push(
      or(
        like(websiteBacklink.targetUrl, q),
        like(websiteBacklink.targetDomain, q),
        like(websiteBacklink.sourceDomain, q),
        like(websiteBacklink.description, q),
        like(websiteBacklink.userNotes, q)
      )!
    );
  }
  return c;
}

export async function listRecords(userId: string, f: RecordFilter) {
  const where = and(...conditions(userId, f));
  const [{ total }] = await db()
    .select({ total: count() })
    .from(websiteBacklink)
    .where(where);
  const list: (WebsiteBacklink & { websiteName: string | null })[] = await db()
    .select({
      ...getTableColumns(websiteBacklink),
      websiteName: website.name,
    })
    .from(websiteBacklink)
    .leftJoin(website, eq(website.id, websiteBacklink.websiteId))
    .where(where)
    .orderBy(desc(websiteBacklink.updatedAt))
    .limit(f.pageSize)
    .offset((f.page - 1) * f.pageSize);

  // Status counts ignore the status filter itself, like the tabs above a list.
  const countRows: { status: string; n: number }[] = await db()
    .select({ status: websiteBacklink.operationStatus, n: count() })
    .from(websiteBacklink)
    .where(
      and(
        ...conditions(userId, {
          ...f,
          operationStatus: undefined,
          progressStatus: undefined,
        })
      )
    )
    .groupBy(websiteBacklink.operationStatus);
  const statusCounts = Object.fromEntries(
    countRows.map((r) => [r.status, r.n])
  ) as Partial<Record<OperationStatus, number>>;

  return { list, total, statusCounts };
}

export async function getRecord(userId: string, id: string) {
  const [row]: WebsiteBacklink[] = await db()
    .select()
    .from(websiteBacklink)
    .where(and(eq(websiteBacklink.id, id), eq(websiteBacklink.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * Create pending records for library entries; entries the website already
 * has a record for (same target URL) are skipped.
 */
export async function addRecordsForBacklinks(
  userId: string,
  websiteId: string,
  backlinkIds: string[]
): Promise<{ added: number; skipped: number }> {
  const w = await requireWebsite(userId, websiteId);
  const ids = [...new Set(backlinkIds)].slice(0, MAX_ADD_BATCH);

  const entries: { id: string; link: string }[] = [];
  for (const part of chunk(ids, IN_CHUNK)) {
    entries.push(
      ...((await db()
        .select({ id: backlink.id, link: backlink.link })
        .from(backlink)
        .where(
          and(
            inArray(backlink.id, part),
            or(
              eq(backlink.visibility, 'public'),
              eq(backlink.ownerUserId, userId)
            )
          )
        )) as { id: string; link: string }[])
    );
  }
  const existing = new Set<string>();
  for (const part of chunk(
    entries.map((e) => e.link),
    IN_CHUNK
  )) {
    const rows: { targetUrl: string }[] = await db()
      .select({ targetUrl: websiteBacklink.targetUrl })
      .from(websiteBacklink)
      .where(
        and(
          eq(websiteBacklink.websiteId, websiteId),
          inArray(websiteBacklink.targetUrl, part)
        )
      );
    for (const r of rows) existing.add(r.targetUrl);
  }
  const seen = new Set<string>();
  const fresh = entries.filter((e) => {
    if (existing.has(e.link) || seen.has(e.link)) return false;
    seen.add(e.link);
    return true;
  });
  const sourceDomain = domainOf(w.url);
  // 9 columns per row → 10 rows per statement.
  for (const part of chunk(fresh, 10)) {
    await db()
      .insert(websiteBacklink)
      .values(
        part.map((e) => ({
          id: getUuid(),
          userId,
          websiteId,
          backlinkId: e.id,
          sourceDomain,
          sourceUrl: w.url,
          targetDomain: domainOf(e.link),
          targetUrl: e.link,
          operationStatus: 'pending',
        }))
      )
      .onConflictDoNothing();
  }
  return { added: fresh.length, skipped: ids.length - fresh.length };
}

/** 添加外链: a set, picked ids (plaza or personal) or pasted URLs. */
export async function addToWebsite(
  userId: string,
  websiteId: string,
  body: {
    scope?: LibraryScope;
    set?: SetSpec;
    ids?: string[];
    urls?: string[];
  }
) {
  if (body.set) {
    const ids = await resolveSet(userId, body.scope ?? 'plaza', body.set);
    return addRecordsForBacklinks(userId, websiteId, ids);
  }
  if (body.ids) return addRecordsForBacklinks(userId, websiteId, body.ids);
  if (body.urls) {
    const { ids, invalid } = await ensureEntriesForUrls(userId, body.urls);
    return {
      ...(await addRecordsForBacklinks(userId, websiteId, ids)),
      invalid,
    };
  }
  throw new BacklinkError('Nothing to add');
}

function recordFields(body: any) {
  const set: Partial<WebsiteBacklink> = {};
  if (body.operationStatus !== undefined) {
    if (!oneOf(body.operationStatus, OPERATION_STATUSES))
      throw new BacklinkError('Invalid operation status');
    set.operationStatus = body.operationStatus;
  }
  if (body.linkStatus !== undefined) {
    if (!oneOf(body.linkStatus, LINK_STATUSES))
      throw new BacklinkError('Invalid link status');
    set.linkStatus = body.linkStatus;
  }
  if (body.description !== undefined)
    set.description = str(body.description, 2000);
  if (body.userNotes !== undefined) set.userNotes = str(body.userNotes, 4000);
  if (body.sourceUrl !== undefined) {
    const u = normalizeUrl(str(body.sourceUrl, 2000));
    if (!u) throw new BacklinkError('Invalid source URL');
    set.sourceUrl = u;
    set.sourceDomain = domainOf(u);
  }
  if (body.targetUrl !== undefined) {
    const u = normalizeUrl(str(body.targetUrl, 2000));
    if (!u) throw new BacklinkError('Invalid target URL');
    set.targetUrl = u;
    set.targetDomain = domainOf(u);
  }
  return set;
}

/**
 * Status set by hand: a running agent lease is cut so its late result is
 * refused (409) instead of overwriting the user's choice.
 */
function manualStatusSideEffects(set: Partial<WebsiteBacklink>) {
  if (!set.operationStatus) return set;
  if (set.operationStatus !== 'in_progress') {
    set.leaseId = null;
    set.leaseExpiresAt = null;
  }
  if (
    ['submitted', 'live', 'duplicate'].includes(set.operationStatus) &&
    set.submittedAt === undefined
  )
    set.submittedAt = new Date();
  return set;
}

/** 添加记录: a manual record (never leased) or one tied to a library entry. */
export async function createRecord(userId: string, body: any) {
  const w = await requireWebsite(userId, String(body?.websiteId ?? ''));
  const set = recordFields({
    ...body,
    sourceUrl: body?.sourceUrl || w.url,
  });
  if (!set.targetUrl) throw new BacklinkError('Target URL is required');
  const backlinkId = strOrNull(body?.backlinkId, 100);
  try {
    const [row]: WebsiteBacklink[] = await db()
      .insert(websiteBacklink)
      .values({
        id: getUuid(),
        userId,
        websiteId: w.id,
        backlinkId,
        sourceDomain: set.sourceDomain!,
        sourceUrl: set.sourceUrl!,
        targetDomain: set.targetDomain!,
        targetUrl: set.targetUrl,
        ...manualStatusSideEffects({
          operationStatus: set.operationStatus ?? 'pending',
          linkStatus: set.linkStatus ?? 'unknown',
          description: set.description ?? '',
          userNotes: set.userNotes ?? '',
        }),
      })
      .returning();
    return row;
  } catch (e: any) {
    if (String(e?.message ?? e).includes('UNIQUE'))
      throw new BacklinkError('This website already has a record for that URL');
    throw e;
  }
}

export async function editRecord(userId: string, id: string, body: any) {
  const set = manualStatusSideEffects(recordFields(body));
  if (!Object.keys(set).length) throw new BacklinkError('Nothing to update');
  const [row]: WebsiteBacklink[] = await db()
    .update(websiteBacklink)
    .set(set)
    .where(and(eq(websiteBacklink.id, id), eq(websiteBacklink.userId, userId)))
    .returning();
  if (!row) throw new BacklinkError('Not found', 404);
  return row;
}

export async function batchEditRecords(
  userId: string,
  ids: string[],
  body: any
) {
  const set = manualStatusSideEffects(
    recordFields({
      operationStatus: body?.operationStatus,
      linkStatus: body?.linkStatus,
    })
  );
  if (!Object.keys(set).length) throw new BacklinkError('Nothing to update');
  let updated = 0;
  for (const part of chunk(ids, IN_CHUNK)) {
    const rows = await db()
      .update(websiteBacklink)
      .set(set)
      .where(
        and(
          eq(websiteBacklink.userId, userId),
          inArray(websiteBacklink.id, part)
        )
      )
      .returning({ id: websiteBacklink.id });
    updated += rows.length;
  }
  return { updated };
}

/** Records to re-check: the page holding the link, and where it should point. */
export async function linkCheckTargets(userId: string, ids: string[]) {
  const rows: { id: string; pageUrl: string; linkUrl: string }[] = [];
  for (const part of chunk(ids, IN_CHUNK)) {
    rows.push(
      ...(await db()
        .select({
          id: websiteBacklink.id,
          pageUrl: sql<string>`coalesce(nullif(${websiteBacklink.resultUrl}, ''), ${websiteBacklink.targetUrl})`,
          linkUrl: websiteBacklink.sourceUrl,
        })
        .from(websiteBacklink)
        .innerJoin(website, eq(website.id, websiteBacklink.websiteId))
        .where(
          and(
            eq(websiteBacklink.userId, userId),
            inArray(websiteBacklink.id, part),
            isNull(website.deletedAt)
          )
        ))
    );
  }
  return rows;
}

export async function setLinkStatus(
  userId: string,
  id: string,
  linkStatus: LinkStatus
) {
  await db()
    .update(websiteBacklink)
    .set({ linkStatus })
    .where(and(eq(websiteBacklink.id, id), eq(websiteBacklink.userId, userId)));
}

export async function batchDeleteRecords(userId: string, ids: string[]) {
  for (const part of chunk(ids, IN_CHUNK)) {
    await db()
      .delete(websiteBacklink)
      .where(
        and(
          eq(websiteBacklink.userId, userId),
          inArray(websiteBacklink.id, part)
        )
      );
  }
  return { deleted: ids.length };
}

export const EXPORT_COLUMNS = [
  'website',
  'source_url',
  'target_url',
  'operation_status',
  'link_status',
  'description',
  'user_notes',
  'result_url',
  'proof',
  'needs_user',
  'claimed_by',
  'attempt_count',
  'last_error',
  'submitted_at',
  'updated_at',
] as const;

export async function exportRecords(
  userId: string,
  f: Omit<RecordFilter, 'page' | 'pageSize'>
) {
  const rows: (WebsiteBacklink & { websiteName: string | null })[] = await db()
    .select({ ...getTableColumns(websiteBacklink), websiteName: website.name })
    .from(websiteBacklink)
    .leftJoin(website, eq(website.id, websiteBacklink.websiteId))
    .where(and(...conditions(userId, f)))
    .orderBy(desc(websiteBacklink.updatedAt));
  return rows.map((r) => [
    r.websiteName ?? r.websiteId,
    r.sourceUrl,
    r.targetUrl,
    r.operationStatus,
    r.linkStatus,
    r.description,
    r.userNotes,
    r.resultUrl ?? '',
    r.proof ?? '',
    r.needsUser ?? '',
    r.claimedBy ?? '',
    r.attemptCount,
    r.lastError ?? '',
    r.submittedAt ? new Date(r.submittedAt).toISOString() : '',
    new Date(r.updatedAt).toISOString(),
  ]);
}

/**
 * Import records from CSV (the export format). `website` may be a website
 * name, id or URL; rows without one go to `fallbackWebsiteId`.
 */
export async function importRecords(
  userId: string,
  text: string,
  fallbackWebsiteId?: string
) {
  const table = parseCsv(text);
  if (table.length < 2) throw new BacklinkError('CSV needs a header row');
  const header = table[0].map((h) => h.toLowerCase().trim());
  const col = (name: string) => header.indexOf(name);
  if (col('target_url') < 0)
    throw new BacklinkError('CSV needs a target_url column');

  const sites = await websiteOptions(userId);
  const findSite = (v: string) =>
    sites.find((s) => s.id === v || s.name === v || s.url === normalizeUrl(v));

  let created = 0;
  let skipped = 0;
  let invalid = 0;
  for (const cells of table.slice(1, 5001)) {
    const get = (name: string) =>
      col(name) >= 0 ? cells[col(name)] : undefined;
    const site =
      findSite(get('website') ?? '') ??
      (fallbackWebsiteId
        ? sites.find((s) => s.id === fallbackWebsiteId)
        : undefined);
    if (!site) {
      invalid++;
      continue;
    }
    try {
      await createRecord(userId, {
        websiteId: site.id,
        sourceUrl: get('source_url') || site.url,
        targetUrl: get('target_url'),
        operationStatus: get('operation_status') || 'pending',
        linkStatus: get('link_status') || 'unknown',
        description: get('description') ?? '',
        userNotes: get('user_notes') ?? '',
      });
      created++;
    } catch (e) {
      if (e instanceof BacklinkError && e.message.includes('already'))
        skipped++;
      else invalid++;
    }
  }
  return { created, skipped, invalid };
}

/** Dashboard tiles: websites, records, in progress, done. */
export async function dashboardStats(userId: string) {
  const rows: { status: string; n: number }[] = await db()
    .select({ status: websiteBacklink.operationStatus, n: count() })
    .from(websiteBacklink)
    .where(and(eq(websiteBacklink.userId, userId), websiteNotDeleted))
    .groupBy(websiteBacklink.operationStatus);
  const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Record<
    string,
    number
  >;
  const [{ websites }] = await db()
    .select({ websites: count() })
    .from(website)
    .where(and(eq(website.userId, userId), isNull(website.deletedAt)));
  return {
    websites,
    records: rows.reduce((s, r) => s + r.n, 0),
    inProgress: (by.in_progress ?? 0) + (by.needs_user ?? 0),
    done: (by.submitted ?? 0) + (by.live ?? 0) + (by.duplicate ?? 0),
  };
}
