import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
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
import {
  agentPassword,
  productOf,
  registrationEmailOf,
  requireWebsite,
} from './websites';

const FINAL = ['submitted', 'live', 'duplicate'] as const;
const AUTO_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
const MISSING_GOOGLE_LOGIN =
  'Set the project Google login email before starting backlink tasks';

// ─── Task view ──────────────────────────────────────────────────────────────

async function taskView(userId: string, r: WebsiteBacklink) {
  const w = await requireWebsite(userId, r.websiteId);
  const b: Backlink | null = r.backlinkId
    ? await getVisibleBacklink(userId, r.backlinkId)
    : null;
  const entry = b ? viewBacklink(b) : null;
  const product = productOf(w);
  // A legacy attempt with no stored identity cannot safely inherit a newly
  // configured login email. Require an account check before using that task.
  const submissionEmail = r.submissionEmail;
  const googleEmail = product.google_login_email;
  const matchesGoogle =
    submissionEmail?.toLowerCase() === googleEmail?.toLowerCase();
  const usesGoogle =
    !!googleEmail && matchesGoogle && r.submissionAuthProvider === 'google';
  const identityReviewRequired = submissionEmail
    ? !matchesGoogle
    : r.attemptCount > 1 ||
      (r.attemptCount > 0 && !!product.registration_email);
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
      ...product,
      // Keep a task tied to the mailbox captured when it was claimed. This
      // prevents changing a website profile from silently switching an old
      // task to a different account.
      email: product.registration_email,
      submission_email: submissionEmail,
      registration_email: product.registration_email,
      email_capability: product.email_capability,
      submission_identity_review_required: identityReviewRequired,
      registration_password:
        product.registration_email && !identityReviewRequired && !usesGoogle
          ? await agentPassword(w.id)
          : null,
    },
    account_policy: {
      login_email: product.registration_email,
      google_login_email: googleEmail,
      google_login_path:
        googleEmail && !identityReviewRequired
          ? `/api/v1/backlink-tasks/${r.id}/google-login`
          : null,
      login_provider: usesGoogle
        ? 'google'
        : product.registration_email
          ? 'email'
          : null,
      verification_inbox_email: product.verification_inbox_email,
      mailbox_url: product.email_management_url,
      verification_method: product.verification_method,
      verification_path: null,
      public_contact_email: product.contact_email,
      allow_logout: false,
      requires_account_review: identityReviewRequired,
      previous_submission_email: r.submissionEmail,
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

function claimGuards(
  userId: string,
  workerId: string,
  websiteId: string,
  loginEmail: string
) {
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
        eq(website.googleLoginEmail, loginEmail),
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
  if (!registrationEmailOf(w))
    throw new BacklinkError(MISSING_GOOGLE_LOGIN, 409);
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

/** Public entries cannot be repriced by one user. Respect that user's paid
 * evidence without changing the shared catalog or other users' eligibility.
 */
function notPreviouslyPaid(userId: string, target: SQL) {
  // Build the user's paid-target set once. A correlated NOT EXISTS scans
  // their history for every candidate and exceeds D1's CPU limit at scale.
  // target_url is NOT NULL, so NOT IN keeps the same exclusion semantics.
  return sql`${target} not in (select paid.target_url from ${websiteBacklink} paid where paid.user_id = ${userId} and paid.failure_reason = 'paid')`;
}

function previouslyAccepted(userId: string, target: SQL) {
  return sql`${target} in (select result.target_url from ${websiteBacklink} result where result.user_id = ${userId} and result.operation_status in ('submitted', 'live'))`;
}

function recentlyUnavailable(userId: string, target: SQL) {
  // Evaluate recent evidence once per URL. A later accepted submission can
  // restore the URL's priority after an outage or a changed entry point.
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const failure = sql`outcome.operation_status in ('blocked', 'needs_user')
    and outcome.failure_reason in ('no_entry', 'site_down')`;
  const accepted = sql`outcome.operation_status in ('submitted', 'live')`;
  return sql`${target} in (
    select outcome.target_url from ${websiteBacklink} outcome
    where outcome.user_id = ${userId} and outcome.updated_at >= ${cutoff}
      and outcome.operation_status in ('blocked', 'needs_user', 'submitted', 'live')
      and ((${failure}) or (${accepted}))
    group by outcome.target_url
    having count(distinct case when ${failure} then outcome.website_id end) >= 2
      and max(case when ${failure} then outcome.updated_at end)
        > coalesce(max(case when ${accepted} then outcome.updated_at end), 0)
  )`;
}

function acceptedAndAvailable(userId: string, target: SQL) {
  return and(
    previouslyAccepted(userId, target),
    sql`not (${recentlyUnavailable(userId, target)})`
  );
}

function claimPriority(userId: string, target: SQL, acceptedOnly: boolean) {
  const recommended = sql`${backlink.status} = 'approved' and ${backlink.costType} in ('free', 'freemium') and ${backlink.confidence} in ('observed', 'verified')`;
  if (acceptedOnly) return sql`case when ${recommended} then 0 else 1 end`;
  return sql`case
    when ${recentlyUnavailable(userId, target)} then 3
    when ${previouslyAccepted(userId, target)} then 0
    when ${recommended} then 1
    else 2 end`;
}

/** Claim one pending record or, after the first pass, one eligible retry. */
async function claimExisting(
  userId: string,
  w: Website,
  workerId: string,
  submissionEmail: string,
  source: DataSource,
  scope: TaskScope,
  category?: string,
  includePaid = false,
  {
    acceptedOnly = false,
    retryBefore,
  }: {
    acceptedOnly?: boolean;
    retryBefore?: Date;
  } = {}
): Promise<WebsiteBacklink | null> {
  const project = and(
    eq(websiteBacklink.userId, userId),
    eq(websiteBacklink.websiteId, w.id)
  );
  const available = and(
    includePaid
      ? undefined
      : notPreviouslyPaid(userId, sql`${websiteBacklink.targetUrl}`),
    // Turned off in the user's library: stop working it everywhere.
    sql`not exists (select 1 from ${userBacklink} where ${userBacklink.backlinkId} = ${websiteBacklink.backlinkId} and ${userBacklink.userId} = ${userId} and ${userBacklink.enabled} = 0)`,
    ...sourceConditions(userId, source),
    // Manually added records have no known category or cost.
    source === 'website' && scope === 'all_eligible' && !category
      ? or(
          isNull(websiteBacklink.backlinkId),
          and(...eligibility(scope, undefined, includePaid))
        )
      : and(...eligibility(scope, category, includePaid))
  );
  const pending = eq(websiteBacklink.operationStatus, 'pending');
  const attemptStatus = retryBefore
    ? and(
        inArray(websiteBacklink.operationStatus, [
          'needs_user',
          'blocked',
          'skipped',
        ]),
        inArray(websiteBacklink.failureReason, ['site_down', 'queue_full']),
        eq(websiteBacklink.attemptCount, 1),
        lte(websiteBacklink.updatedAt, retryBefore),
        isNull(websiteBacklink.resultUrl),
        isNull(websiteBacklink.submittedAt)
      )
    : pending;
  const firstPassFinished = retryBefore
    ? and(
        notExists(
          db()
            .select({ one: sql`1` })
            .from(websiteBacklink)
            .where(
              and(
                project,
                eq(websiteBacklink.operationStatus, 'in_progress'),
                lte(websiteBacklink.attemptCount, 1)
              )
            )
        ),
        notExists(
          db()
            .select({ one: sql`1` })
            .from(websiteBacklink)
            .leftJoin(backlink, eq(backlink.id, websiteBacklink.backlinkId))
            .where(and(project, pending, available))
        )
      )
    : undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    const [candidate]: { id: string }[] = await db()
      .select({ id: websiteBacklink.id })
      .from(websiteBacklink)
      .leftJoin(backlink, eq(backlink.id, websiteBacklink.backlinkId))
      .where(
        and(
          project,
          attemptStatus,
          available,
          firstPassFinished,
          acceptedOnly
            ? acceptedAndAvailable(userId, sql`${websiteBacklink.targetUrl}`)
            : undefined
        )
      )
      .orderBy(
        retryBefore
          ? asc(websiteBacklink.updatedAt)
          : claimPriority(
              userId,
              sql`${websiteBacklink.targetUrl}`,
              acceptedOnly
            ),
        sql`${backlink.dr} is null`,
        desc(backlink.dr),
        asc(websiteBacklink.createdAt)
      )
      .limit(1);
    if (!candidate) return null;
    const lease = newLease(workerId);
    try {
      await atomic((q) => [
        ...claimGuards(userId, workerId, w.id, submissionEmail),
        q
          .update(websiteBacklink)
          .set({
            ...lease,
            attemptCount: sql`${websiteBacklink.attemptCount} + 1`,
            // Preserve old identities, including unknown legacy attempts.
            submissionEmail: sql`case when ${websiteBacklink.attemptCount} = 0 then coalesce(${websiteBacklink.submissionEmail}, ${submissionEmail}) else ${websiteBacklink.submissionEmail} end`,
          })
          .where(
            and(
              eq(websiteBacklink.id, candidate.id),
              // Recheck the retry window and first-pass work under the claim lock.
              attemptStatus,
              firstPassFinished
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
  submissionEmail: string,
  source: 'plaza' | 'personal',
  scope: TaskScope,
  category?: string,
  includePaid = false,
  acceptedOnly = false
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
          acceptedOnly
            ? acceptedAndAvailable(userId, sql`${backlink.link}`)
            : undefined,
          includePaid
            ? undefined
            : notPreviouslyPaid(userId, sql`${backlink.link}`),
          notYetRecorded,
          sql`not exists (select 1 from ${userBacklink} where ${userBacklink.backlinkId} = ${backlink.id} and ${userBacklink.userId} = ${userId} and ${userBacklink.enabled} = 0)`
        )
      )
      .orderBy(
        claimPriority(userId, sql`${backlink.link}`, acceptedOnly),
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
        ...claimGuards(userId, workerId, w.id, submissionEmail),
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
            submissionEmail,
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

async function claimedTask(userId: string, row: WebsiteBacklink) {
  await db()
    .update(website)
    .set({ lastClaimedAt: new Date() })
    .where(eq(website.id, row.websiteId));
  return { task: await taskView(userId, row) };
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
  // Existing website commands may still send `recommended`. The website
  // queue already sorts those entries first, so a wider selection can continue
  // with the same project's other eligible entries in the same query.
  const useWebsiteFallback = dataSource === 'website' && !includePaid;
  const claimScope = useWebsiteFallback ? 'all_eligible' : scope;
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

  const readySites = sites.flatMap((website) => {
    const email = registrationEmailOf(website);
    return email ? [{ website, email }] : [];
  });
  if (websiteId && readySites.length === 0)
    throw new BacklinkError(MISSING_GOOGLE_LOGIN, 409);

  for (const { website: w, email } of readySites) {
    if (useWebsiteFallback) {
      const assigned = await claimExisting(
        userId,
        w,
        workerId,
        email,
        'website',
        claimScope,
        category,
        false,
        { acceptedOnly: true }
      );
      if (assigned) return claimedTask(userId, assigned);
      const personal = await claimFromLibrary(
        userId,
        w,
        workerId,
        email,
        'personal',
        claimScope,
        category,
        false,
        true
      );
      if (personal) {
        return {
          ...(await claimedTask(userId, personal)),
          queue: { source: 'personal', effective_scope: claimScope },
        };
      }
    }

    // Existing pending records first; plaza/personal then create on demand.
    const row =
      (await claimExisting(
        userId,
        w,
        workerId,
        email,
        dataSource,
        claimScope,
        category,
        includePaid
      )) ??
      (dataSource === 'website'
        ? null
        : await claimFromLibrary(
            userId,
            w,
            workerId,
            email,
            dataSource,
            claimScope,
            category,
            includePaid
          ));
    if (row) return claimedTask(userId, row);
  }

  // Fill a gap only from the user's enabled, recommended personal entries.
  // Search assigned work across all selected sites before creating a new row.
  if (useWebsiteFallback) {
    for (const { website: w, email } of readySites) {
      const row = await claimFromLibrary(
        userId,
        w,
        workerId,
        email,
        'personal',
        'recommended',
        category
      );
      if (row) {
        return {
          ...(await claimedTask(userId, row)),
          queue: { source: 'personal', effective_scope: 'recommended' },
        };
      }
    }
  }

  if (useWebsiteFallback && !category) {
    const retryBefore = new Date(Date.now() - AUTO_RETRY_DELAY_MS);
    for (const { website: w, email } of readySites) {
      const row = await claimExisting(
        userId,
        w,
        workerId,
        email,
        'website',
        claimScope,
        undefined,
        false,
        { retryBefore }
      );
      if (row) {
        return {
          ...(await claimedTask(userId, row)),
          queue: { effective_scope: claimScope, automatic_retry: true },
        };
      }
    }
  }
  // A concurrent start may have won the claim. Return its lease rather than
  // reporting exhaustion or abandoning a second task.
  const concurrent = await activeTask(userId, workerId, websiteId);
  if (concurrent) return { task: await taskView(userId, concurrent) };

  let pending: number | null = null;
  let excludedPaid: number | undefined;
  if (dataSource === 'website' && readySites.length > 0) {
    const [result] = await db()
      .select({
        total: count(),
        paid: sql<number>`count(case when ${backlink.costType} = 'paid' or not (${notPreviouslyPaid(userId, sql`${websiteBacklink.targetUrl}`)}) then 1 end)`,
      })
      .from(websiteBacklink)
      .innerJoin(website, eq(website.id, websiteBacklink.websiteId))
      .leftJoin(backlink, eq(backlink.id, websiteBacklink.backlinkId))
      .where(
        and(
          eq(websiteBacklink.userId, userId),
          eq(websiteBacklink.operationStatus, 'pending'),
          eq(website.userId, userId),
          eq(website.status, 'enabled'),
          eq(website.autoBacklinkEnabled, true),
          isNotNull(website.googleLoginEmail),
          isNull(website.deletedAt),
          websiteId ? eq(website.id, websiteId) : undefined
        )
      );
    pending = result?.total ?? 0;
    excludedPaid = includePaid ? undefined : Number(result?.paid ?? 0);
  }

  const reason =
    sites.length === 0
      ? 'no_enabled_websites'
      : readySites.length === 0
        ? 'missing_google_login_email'
        : pending === null
          ? 'no_eligible_library_entries'
          : pending === 0
            ? 'no_pending_website_tasks'
            : 'no_eligible_website_tasks';
  return {
    task: null,
    queue: {
      reason,
      pending,
      ...(excludedPaid ? { excluded_paid: excludedPaid } : {}),
      requested_scope: scope,
      effective_scope: claimScope,
      checked_personal_library: useWebsiteFallback && readySites.length > 0,
    },
  };
}

async function conflict(userId: string, id: string): Promise<never> {
  const r = await recordOf(userId, id);
  throw new BacklinkError(
    `Lease or status conflict (task is ${r.operationStatus})`,
    409
  );
}

/** Bind the authorized Google identity before the agent starts Google sign-in. */
export async function bindTaskGoogleLogin(
  userId: string,
  id: string,
  body: {
    worker_id?: unknown;
    lease_id?: unknown;
    confirmed_no_prior_account?: unknown;
  }
) {
  const workerId = workerIdOf(body?.worker_id);
  const leaseId = str(body?.lease_id, 100);
  if (!leaseId) throw new BacklinkError('lease_id is required');
  const record = await recordOf(userId, id);
  const w = await requireWebsite(userId, record.websiteId);
  const email = registrationEmailOf(w);
  if (!email || !w.autoBacklinkEnabled || w.status !== 'enabled')
    throw new BacklinkError('Google login unavailable for this website', 409);

  // Allow a retry only after the agent confirms an earlier account-only
  // blockage never reached account creation or submission.
  const canBind =
    record.submissionAuthProvider !== 'google' &&
    record.submissionEmail === email &&
    !record.submittedAt &&
    !record.resultUrl &&
    (record.attemptCount === 1 ||
      (record.failureReason === 'account' &&
        body.confirmed_no_prior_account === true));
  const isBound =
    record.submissionEmail === email &&
    record.submissionAuthProvider === 'google';
  if (!isBound && !canBind)
    throw new BacklinkError(
      'Review the prior submission account before using Google login',
      409
    );

  const [row]: { id: string }[] = await db()
    .update(websiteBacklink)
    .set({ submissionEmail: email, submissionAuthProvider: 'google' })
    .where(
      and(
        eq(websiteBacklink.id, id),
        eq(websiteBacklink.userId, userId),
        eq(websiteBacklink.operationStatus, 'in_progress'),
        eq(websiteBacklink.claimedBy, workerId),
        eq(websiteBacklink.leaseId, leaseId),
        eq(websiteBacklink.submissionEmail, email),
        sql`exists (select 1 from ${website} where ${website.id} = ${record.websiteId} and ${website.userId} = ${userId} and ${website.googleLoginEmail} = ${email} and ${website.deletedAt} is null and ${website.status} = 'enabled' and ${website.autoBacklinkEnabled} = 1)`,
        gt(websiteBacklink.leaseExpiresAt, new Date())
      )
    )
    .returning({ id: websiteBacklink.id });
  if (!row) return conflict(userId, id);
  return { google_login_email: email };
}

/** Renew and authorize a badge write for this exact task and worker. */
export async function authorizeTaskBadge(
  userId: string,
  id: string,
  body: any
) {
  await heartbeat(userId, id, body);
  return (await recordOf(userId, id)).websiteId;
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
