import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  notExists,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';

import { db } from '@/core/db';
import { atomic, AtomicGuardError, guard } from '@/core/db/atomic';
import {
  BACKLINK_CATEGORIES,
  DATA_SOURCES,
  domainOf,
  FAILURE_REASONS,
  LEASE_MS,
  oneOf,
  RESULT_STATUSES,
  TASK_SCOPES,
  type DataSource,
  type TaskScope,
} from '@/config/backlinks';
import {
  backlink,
  user,
  userBacklink,
  website,
  websiteBacklink,
  type Backlink,
  type Website,
  type WebsiteBacklink,
} from '@/config/db/schema';
import { getUuid } from '@/lib/hash';

import {
  getVisibleBacklink,
  libraryNotes,
  planFailureReason,
  planMarkProven,
  viewBacklink,
} from './library';
import { BacklinkError, isHttpUrl, str, strOrNull } from './shared';
import { agentPassword, productOf, requireWebsite } from './websites';

const FINAL = ['submitted', 'live', 'duplicate'] as const;

// ─── Task view ──────────────────────────────────────────────────────────────

async function taskView(userId: string, r: WebsiteBacklink) {
  const w = await requireWebsite(userId, r.websiteId);
  const b: Backlink | null = r.backlinkId
    ? await getVisibleBacklink(userId, r.backlinkId)
    : null;
  const entry = b ? viewBacklink(b) : null;
  return {
    id: r.id,
    website_id: r.websiteId,
    status: r.operationStatus,
    link_status: r.linkStatus,
    claimed_by: r.claimedBy,
    lease_id: r.leaseId,
    lease_expires_at: r.leaseExpiresAt
      ? new Date(r.leaseExpiresAt).toISOString()
      : null,
    attempt_count: r.attemptCount,
    description: r.description || null,
    user_notes: r.userNotes || null,
    library_notes: r.backlinkId
      ? await libraryNotes(userId, r.backlinkId)
      : null,
    result_url: r.resultUrl,
    proof: r.proof,
    needs_user: r.needsUser,
    last_error: r.lastError,
    failure_reason: r.failureReason,
    is_retry:
      r.attemptCount > 1 ||
      !!(r.proof || r.resultUrl || r.needsUser || r.lastError),
    submitted_at: r.submittedAt ? new Date(r.submittedAt).toISOString() : null,
    created_at: new Date(r.createdAt).toISOString(),
    updated_at: new Date(r.updatedAt).toISOString(),
    product: {
      ...productOf(w),
      registration_password: await agentPassword(w.id),
    },
    opportunity: {
      id: r.backlinkId,
      name: entry?.name ?? r.targetDomain,
      domain: r.targetDomain,
      submission_url: r.targetUrl,
      category: entry?.category ?? null,
      link_type: entry?.linkType ?? null,
      cost_type: entry?.costType ?? null,
      language: entry?.language || null,
      dr: entry?.dr ?? null,
      organic_traffic: entry?.organicTraffic ?? null,
      tags: entry?.tags ?? [],
      requirements: {
        category: entry?.category ?? null,
        details: entry?.details || null,
        tips: entry?.tips || null,
      },
    },
  };
}

async function recordOf(userId: string, id: string) {
  const [row]: WebsiteBacklink[] = await db()
    .select()
    .from(websiteBacklink)
    .where(and(eq(websiteBacklink.id, id), eq(websiteBacklink.userId, userId)))
    .limit(1);
  if (!row) throw new BacklinkError('Task not found', 404);
  return row;
}

export async function getTask(userId: string, id: string) {
  await expireLeases(userId);
  return taskView(userId, await recordOf(userId, id));
}

// ─── Eligibility ────────────────────────────────────────────────────────────

function eligibility(
  scope: TaskScope,
  category?: string,
  includePaid = false
): SQL[] {
  const c: SQL[] = [ne(backlink.status, 'rejected')];
  if (!includePaid) c.push(ne(backlink.costType, 'paid'));
  if (scope === 'recommended') {
    c.push(
      eq(backlink.status, 'approved'),
      inArray(backlink.costType, ['free', 'freemium']),
      inArray(backlink.confidence, ['observed', 'verified'])
    );
  }
  if (category) c.push(eq(backlink.category, category));
  return c;
}

function newLease(workerId: string) {
  return {
    operationStatus: 'in_progress',
    claimedBy: workerId,
    leaseId: getUuid(),
    leaseExpiresAt: new Date(Date.now() + LEASE_MS),
  };
}

/** Records whose lease ran out become needs_user (see the API doc). */
async function expireLeases(userId: string) {
  await db()
    .update(websiteBacklink)
    .set({
      operationStatus: 'needs_user',
      needsUser:
        'Lease expired before a result was reported. Verify the external outcome before retrying.',
      failureReason: 'lease_expired',
      leaseExpiresAt: null,
    })
    .where(
      and(
        eq(websiteBacklink.userId, userId),
        eq(websiteBacklink.operationStatus, 'in_progress'),
        or(
          isNull(websiteBacklink.leaseExpiresAt),
          lte(websiteBacklink.leaseExpiresAt, new Date())
        )
      )
    );
}

function claimGuards(userId: string, workerId: string, websiteId: string) {
  return [
    // Lock the user before checking for a running task. The separate check
    // sees the preceding claimant's commit on Postgres as well as D1 batch.
    guard({
      table: user,
      column: 'id',
      where: eq(user.id, userId),
      require: sql`1 = 1`,
      message: 'Claim lock',
    }),
    guard({
      table: website,
      column: 'id',
      where: eq(website.id, websiteId),
      require: and(
        eq(website.userId, userId),
        isNull(website.deletedAt),
        eq(website.status, 'enabled'),
        eq(website.autoBacklinkEnabled, true),
        sql`not exists (select 1 from ${websiteBacklink} where ${websiteBacklink.userId} = ${userId} and ${websiteBacklink.claimedBy} = ${workerId} and ${websiteBacklink.operationStatus} = 'in_progress' and ${gt(websiteBacklink.leaseExpiresAt, new Date())})`
      )!,
      message: 'Worker busy or website disabled',
    }),
  ];
}

async function activeTask(
  userId: string,
  workerId: string,
  websiteId?: string
) {
  const [mine]: WebsiteBacklink[] = await db()
    .select()
    .from(websiteBacklink)
    .where(
      and(
        eq(websiteBacklink.userId, userId),
        eq(websiteBacklink.claimedBy, workerId),
        eq(websiteBacklink.operationStatus, 'in_progress'),
        gt(websiteBacklink.leaseExpiresAt, new Date())
      )
    )
    .limit(1);
  if (!mine) return null;
  if (websiteId && mine.websiteId !== websiteId)
    throw new BacklinkError(
      'Worker already has a task for another website',
      409
    );
  const w = await requireWebsite(userId, mine.websiteId);
  if (!w.autoBacklinkEnabled || w.status !== 'enabled')
    throw new BacklinkError('Auto backlinks are off for this website', 409);
  return mine;
}

function sourceConditions(userId: string, source: DataSource): SQL[] {
  if (source === 'plaza') return [eq(backlink.visibility, 'public')];
  if (source === 'personal')
    return [
      or(eq(backlink.visibility, 'public'), eq(backlink.ownerUserId, userId))!,
      sql`exists (select 1 from ${userBacklink} where ${userBacklink.backlinkId} = ${backlink.id} and ${userBacklink.userId} = ${userId} and ${userBacklink.enabled} = 1)`,
    ];
  return [
    or(
      isNull(backlink.id),
      eq(backlink.visibility, 'public'),
      eq(backlink.ownerUserId, userId)
    )!,
  ];
}

/** Claim one existing pending record of the website. */
async function claimExisting(
  userId: string,
  w: Website,
  workerId: string,
  source: DataSource,
  scope: TaskScope,
  category?: string,
  includePaid = false
): Promise<WebsiteBacklink | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const [candidate]: { id: string }[] = await db()
      .select({ id: websiteBacklink.id })
      .from(websiteBacklink)
      .leftJoin(backlink, eq(backlink.id, websiteBacklink.backlinkId))
      .where(
        and(
          eq(websiteBacklink.userId, userId),
          eq(websiteBacklink.websiteId, w.id),
          eq(websiteBacklink.operationStatus, 'pending'),
          // Turned off in the user's library: stop working it everywhere.
          sql`not exists (select 1 from ${userBacklink} where ${userBacklink.backlinkId} = ${websiteBacklink.backlinkId} and ${userBacklink.userId} = ${userId} and ${userBacklink.enabled} = 0)`,
          ...sourceConditions(userId, source),
          // Records added by hand have no library entry, so nothing is known
          // about their category or cost: only all_eligible without a
          // category filter takes them.
          source === 'website' && scope === 'all_eligible' && !category
            ? or(
                isNull(websiteBacklink.backlinkId),
                and(...eligibility(scope, undefined, includePaid))
              )
            : and(...eligibility(scope, category, includePaid))
        )
      )
      .orderBy(
        sql`case when ${backlink.status} = 'approved' and ${backlink.costType} in ('free', 'freemium') and ${backlink.confidence} in ('observed', 'verified') then 0 else 1 end`,
        sql`${backlink.dr} is null`,
        desc(backlink.dr),
        asc(websiteBacklink.createdAt)
      )
      .limit(1);
    if (!candidate) return null;
    const lease = newLease(workerId);
    try {
      await atomic((q) => [
        ...claimGuards(userId, workerId, w.id),
        q
          .update(websiteBacklink)
          .set({
            ...lease,
            attemptCount: sql`${websiteBacklink.attemptCount} + 1`,
          })
          .where(
            and(
              eq(websiteBacklink.id, candidate.id),
              // Lost the race if another worker took it in between.
              eq(websiteBacklink.operationStatus, 'pending')
            )
          ),
      ]);
    } catch (error) {
      if (error instanceof AtomicGuardError) return null;
      throw error;
    }
    const [row]: WebsiteBacklink[] = await db()
      .select()
      .from(websiteBacklink)
      .where(
        and(
          eq(websiteBacklink.id, candidate.id),
          eq(websiteBacklink.leaseId, lease.leaseId)
        )
      );
    if (row) return row;
  }
  return null;
}

/** Create a record on demand from the plaza or the user's library. */
async function claimFromLibrary(
  userId: string,
  w: Website,
  workerId: string,
  source: 'plaza' | 'personal',
  scope: TaskScope,
  category?: string,
  includePaid = false
): Promise<WebsiteBacklink | null> {
  const notYetRecorded = notExists(
    db()
      .select({ one: sql`1` })
      .from(websiteBacklink)
      .where(
        and(
          eq(websiteBacklink.websiteId, w.id),
          eq(websiteBacklink.targetUrl, backlink.link)
        )
      )
  );
  for (let attempt = 0; attempt < 5; attempt++) {
    const [b]: Backlink[] = await db()
      .select()
      .from(backlink)
      .where(
        and(
          ...sourceConditions(userId, source),
          ...eligibility(scope, category, includePaid),
          notYetRecorded,
          sql`not exists (select 1 from ${userBacklink} where ${userBacklink.backlinkId} = ${backlink.id} and ${userBacklink.userId} = ${userId} and ${userBacklink.enabled} = 0)`
        )
      )
      .orderBy(
        sql`case when ${backlink.status} = 'approved' and ${backlink.costType} in ('free', 'freemium') and ${backlink.confidence} in ('observed', 'verified') then 0 else 1 end`,
        sql`${backlink.dr} is null`,
        desc(backlink.dr),
        asc(backlink.createdAt)
      )
      .limit(1);
    if (!b) return null;
    const lease = newLease(workerId);
    const id = getUuid();
    try {
      await atomic((q) => [
        ...claimGuards(userId, workerId, w.id),
        q
          .insert(websiteBacklink)
          .values({
            id,
            userId,
            websiteId: w.id,
            backlinkId: b.id,
            sourceDomain: domainOf(w.url),
            sourceUrl: w.url,
            targetDomain: domainOf(b.link),
            targetUrl: b.link,
            attemptCount: 1,
            ...lease,
          })
          .onConflictDoNothing(),
      ]);
    } catch (error) {
      if (error instanceof AtomicGuardError) return null;
      throw error;
    }
    const [row]: WebsiteBacklink[] = await db()
      .select()
      .from(websiteBacklink)
      .where(eq(websiteBacklink.id, id));
    if (row) return row;
  }
  return null;
}

export type StartBody = {
  worker_id?: unknown;
  website_id?: unknown;
  data_source?: unknown;
  task_scope?: unknown;
  category?: unknown;
  include_paid?: unknown;
  continue_after_result_failure?: {
    task_id?: unknown;
    lease_id?: unknown;
    note?: unknown;
  };
};

function workerIdOf(v: unknown): string {
  const id = str(v, 120);
  if (!id) throw new BacklinkError('worker_id is required');
  return id;
}

/**
 * POST /api/v1/backlink-tasks/start — resume this worker's unexpired task,
 * else lease a new one. Returns null when nothing is left.
 */
export async function startTask(userId: string, body: StartBody) {
  const workerId = workerIdOf(body.worker_id);
  if (body.include_paid !== undefined && typeof body.include_paid !== 'boolean')
    throw new BacklinkError('include_paid must be a boolean');
  const includePaid = body.include_paid === true;
  const dataSource: DataSource = oneOf(body.data_source, DATA_SOURCES)
    ? body.data_source
    : 'website';
  const scope: TaskScope = oneOf(body.task_scope, TASK_SCOPES)
    ? body.task_scope
    : 'recommended';
  let category: string | undefined;
  if (body.category != null && body.category !== '') {
    if (!oneOf(body.category, BACKLINK_CATEGORIES))
      throw new BacklinkError('Invalid category');
    category = body.category;
  }
  const websiteId = str(body.website_id, 100) || undefined;

  // A result the agent could not report: park that task for the user.
  const cont = body.continue_after_result_failure;
  if (cont) {
    const taskId = str(cont.task_id, 100);
    const leaseId = str(cont.lease_id, 100);
    if (taskId && leaseId) {
      await db()
        .update(websiteBacklink)
        .set({
          operationStatus: 'needs_user',
          needsUser:
            str(cont.note, 4000) ||
            'Result could not be reported by the agent.',
          failureReason: 'result_unknown',
          leaseExpiresAt: null,
        })
        .where(
          and(
            eq(websiteBacklink.id, taskId),
            eq(websiteBacklink.userId, userId),
            eq(websiteBacklink.operationStatus, 'in_progress'),
            eq(websiteBacklink.claimedBy, workerId),
            eq(websiteBacklink.leaseId, leaseId)
          )
        );
    }
  }

  await expireLeases(userId);

  // Websites to draw from.
  let sites: Website[];
  if (websiteId) {
    const w = await requireWebsite(userId, websiteId);
    if (!w.autoBacklinkEnabled || w.status !== 'enabled')
      throw new BacklinkError('Auto backlinks are off for this website', 409);
    const [row]: Website[] = await db()
      .select()
      .from(website)
      .where(eq(website.id, w.id));
    sites = [row];
  } else {
    sites = await db()
      .select()
      .from(website)
      .where(
        and(
          eq(website.userId, userId),
          isNull(website.deletedAt),
          eq(website.autoBacklinkEnabled, true),
          eq(website.status, 'enabled')
        )
      )
      .orderBy(
        sql`${website.lastClaimedAt} is not null`,
        asc(website.lastClaimedAt)
      );
  }

  // Resume this worker's own unexpired task first.
  const mine = await activeTask(userId, workerId, websiteId);
  if (mine) return { task: await taskView(userId, mine) };

  for (const w of sites) {
    // Existing pending records first; plaza/personal then create on demand.
    const row =
      (await claimExisting(
        userId,
        w,
        workerId,
        dataSource,
        scope,
        category,
        includePaid
      )) ??
      (dataSource === 'website'
        ? null
        : await claimFromLibrary(
            userId,
            w,
            workerId,
            dataSource,
            scope,
            category,
            includePaid
          ));
    if (row) {
      await db()
        .update(website)
        .set({ lastClaimedAt: new Date() })
        .where(eq(website.id, w.id));
      return { task: await taskView(userId, row) };
    }
  }
  // A concurrent start may have won the claim. Return its lease rather than
  // reporting exhaustion or abandoning a second task.
  const concurrent = await activeTask(userId, workerId, websiteId);
  return { task: concurrent ? await taskView(userId, concurrent) : null };
}

async function conflict(userId: string, id: string): Promise<never> {
  const r = await recordOf(userId, id);
  throw new BacklinkError(
    `Lease or status conflict (task is ${r.operationStatus})`,
    409
  );
}

/** POST /api/v1/backlink-tasks/{id}/heartbeat */
export async function heartbeat(userId: string, id: string, body: any) {
  const workerId = workerIdOf(body?.worker_id);
  const leaseId = str(body?.lease_id, 100);
  if (!leaseId) throw new BacklinkError('lease_id is required');
  // Turning auto backlinks off stops the agent at its next heartbeat.
  const w = await requireWebsite(
    userId,
    (await recordOf(userId, id)).websiteId
  );
  if (!w.autoBacklinkEnabled || w.status !== 'enabled')
    throw new BacklinkError('Auto backlinks are off for this website', 409);
  const [row]: WebsiteBacklink[] = await db()
    .update(websiteBacklink)
    .set({ leaseExpiresAt: new Date(Date.now() + LEASE_MS) })
    .where(
      and(
        eq(websiteBacklink.id, id),
        eq(websiteBacklink.userId, userId),
        eq(websiteBacklink.operationStatus, 'in_progress'),
        eq(websiteBacklink.claimedBy, workerId),
        eq(websiteBacklink.leaseId, leaseId),
        gt(websiteBacklink.leaseExpiresAt, new Date())
      )
    )
    .returning();
  if (!row) return conflict(userId, id);
  return {
    id: row.id,
    lease_id: row.leaseId,
    lease_expires_at: new Date(row.leaseExpiresAt!).toISOString(),
  };
}

/** POST /api/v1/backlink-tasks/{id}/result — one final result per task. */
export async function reportResult(userId: string, id: string, body: any) {
  const workerId = workerIdOf(body?.worker_id);
  const leaseId = str(body?.lease_id, 100);
  if (!leaseId) throw new BacklinkError('lease_id is required');
  const status = body?.status;
  if (!oneOf(status, RESULT_STATUSES))
    throw new BacklinkError(
      `status must be one of: ${RESULT_STATUSES.join(', ')}`
    );
  const resultUrl = strOrNull(body?.result_url, 2000);
  const proof = strOrNull(body?.proof, 8000);
  const needsUser = strOrNull(body?.needs_user, 4000);
  const lastError = strOrNull(body?.last_error, 4000);
  const failed = !(FINAL as readonly string[]).includes(status);
  const reason = body?.reason ?? null;
  if (failed && reason === null)
    throw new BacklinkError(
      'needs_user, blocked and skipped require reason; use other only when no specific reason applies'
    );
  if (!failed && reason !== null)
    throw new BacklinkError('Successful results must have reason=null');
  if (reason !== null && !oneOf(reason, FAILURE_REASONS))
    throw new BacklinkError(
      `reason must be one of: ${FAILURE_REASONS.join(', ')}`
    );

  if (resultUrl && !isHttpUrl(resultUrl))
    throw new BacklinkError('result_url must be an http(s) URL');
  if ((status === 'submitted' || status === 'duplicate') && !proof)
    throw new BacklinkError(`${status} requires proof`);
  if (status === 'live' && (!resultUrl || !proof))
    throw new BacklinkError('live requires result_url and proof');
  if (status === 'needs_user' && !needsUser)
    throw new BacklinkError('needs_user requires needs_user');
  if ((status === 'blocked' || status === 'skipped') && !proof && !lastError)
    throw new BacklinkError(`${status} requires proof or last_error`);

  let submittedAt: Date | null = null;
  if ((FINAL as readonly string[]).includes(status)) {
    const given = body?.submitted_at ? new Date(body.submitted_at) : null;
    submittedAt = given && !isNaN(given.getTime()) ? given : new Date();
  }

  const previous = await recordOf(userId, id);
  const claimed = and(
    eq(websiteBacklink.id, id),
    eq(websiteBacklink.userId, userId),
    eq(websiteBacklink.operationStatus, 'in_progress'),
    eq(websiteBacklink.claimedBy, workerId),
    eq(websiteBacklink.leaseId, leaseId),
    gt(websiteBacklink.leaseExpiresAt, new Date())
  )!;
  try {
    await atomic((q) => [
      guard({
        table: user,
        column: 'id',
        where: eq(user.id, userId),
        require: sql`1 = 1`,
        message: 'Result lock',
      }),
      guard({
        table: user,
        column: 'id',
        where: eq(user.id, userId),
        require: sql`exists (select 1 from ${websiteBacklink} where ${claimed})`,
        message: 'Lease or status conflict',
      }),
      q
        .update(websiteBacklink)
        .set({
          operationStatus: status,
          resultUrl,
          proof,
          needsUser: status === 'needs_user' ? needsUser : null,
          failureReason: failed ? reason : null,
          lastError,
          submittedAt,
          leaseExpiresAt: null,
          ...(status === 'live' ? { linkStatus: 'valid' } : {}),
        })
        .where(
          and(eq(websiteBacklink.id, id), eq(websiteBacklink.userId, userId))
        ),
      previous.backlinkId &&
        (status === 'submitted' || status === 'live'
          ? planMarkProven(q, userId, previous.backlinkId)
          : reason &&
            planFailureReason(q, userId, previous.backlinkId, reason)),
    ]);
    return { id, status };
  } catch (error) {
    if (!(error instanceof AtomicGuardError)) throw error;
  }

  // A retry of the same report after it already went through is fine.
  const current = await recordOf(userId, id);
  if (
    current.claimedBy === workerId &&
    current.leaseId === leaseId &&
    current.operationStatus === status &&
    current.resultUrl === resultUrl &&
    current.proof === proof &&
    current.needsUser === (status === 'needs_user' ? needsUser : null) &&
    current.lastError === lastError &&
    current.failureReason === reason &&
    (!body?.submitted_at ||
      current.submittedAt?.getTime() === submittedAt?.getTime())
  )
    return { id: current.id, status: current.operationStatus };
  return conflict(userId, id);
}
