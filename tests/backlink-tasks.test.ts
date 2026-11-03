import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { eq } from 'drizzle-orm';

const directory = await mkdtemp(join(tmpdir(), 'backlora-tasks-'));
Object.assign(process.env, {
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${directory}/test.db`,
  AUTH_SECRET: 'isolated-backlink-tests-not-a-real-secret',
  NODE_ENV: 'test',
});
execFileSync(
  process.execPath,
  [
    'node_modules/drizzle-kit/bin.cjs',
    'push',
    '--dialect=sqlite',
    '--schema=./src/config/db/schema.sqlite.ts',
    `--url=${process.env.DATABASE_URL}`,
    '--force',
  ],
  { stdio: 'pipe' }
);
let disposeD1: (() => Promise<void>) | undefined;
if (process.env.BACKLINK_D1 === '1') {
  const { createClient } = await import('@libsql/client');
  const sqlite = createClient({ url: process.env.DATABASE_URL! });
  const ddl = (
    await sqlite.execute(
      "select sql from sqlite_master where sql is not null and name not like 'sqlite_%' and name not like '__drizzle%' order by type = 'index'"
    )
  ).rows.map((r) => String(r.sql));
  sqlite.close();
  const { getPlatformProxy } = await import('wrangler');
  const proxy = await getPlatformProxy<{ DB: any }>({
    configPath: 'wrangler.jsonc',
    persist: { path: join(directory, 'd1') },
  });
  for (const statement of ddl) await proxy.env.DB.prepare(statement).run();
  (globalThis as any).__CF_ENV__ = proxy.env;
  process.env.DATABASE_PROVIDER = 'd1';
  disposeD1 = proxy.dispose;
}
const { db } = await import('../src/core/db');
const { user, website, backlink, userBacklink, websiteBacklink } =
  await import('../src/config/db/schema');
const { startTask, reportResult, heartbeat, getTask } =
  await import('../src/modules/backlinks/tasks');
const { retryRecords } = await import('../src/modules/backlinks/records');
const { applyFailureReason } = await import('../src/modules/backlinks/library');
after(async () => {
  await disposeD1?.();
  await rm(directory, { recursive: true, force: true });
});
let n = 0;
async function fixture(costType = 'free') {
  const id = `f${++n}`;
  await db()
    .insert(user)
    .values({ id, name: id, email: `${id}@example.test` });
  await db()
    .insert(website)
    .values([
      {
        id,
        userId: id,
        name: id,
        url: `https://${id}.example.test`,
        shortDesc: 'A test product',
      },
      {
        id: `${id}-other`,
        userId: id,
        name: id,
        url: `https://other-${id}.example.test`,
        shortDesc: 'Other test product',
      },
    ]);
  await db()
    .insert(backlink)
    .values({
      id,
      ownerUserId: id,
      visibility: 'private',
      name: 'Directory',
      link: `https://directory.example.test/${id}`,
      domain: 'directory.example.test',
      status: 'approved',
      confidence: 'observed',
      costType,
    });
  await db().insert(userBacklink).values({ id, userId: id, backlinkId: id });
  return id;
}
async function record(
  id: string,
  suffix: string,
  status: string,
  fields: object = {}
) {
  await db()
    .insert(websiteBacklink)
    .values({
      id: `${id}-${suffix}`,
      userId: id,
      websiteId: id,
      backlinkId: id,
      sourceDomain: `${id}.example.test`,
      sourceUrl: `https://${id}.example.test`,
      targetDomain: 'directory.example.test',
      targetUrl: `https://directory.example.test/${id}/${suffix}`,
      operationStatus: status,
      ...fields,
    });
}
const claim = (id: string, extra = {}) =>
  startTask(id, {
    worker_id: `${id}-worker`,
    website_id: id,
    data_source: 'personal',
    task_scope: 'all_eligible',
    ...extra,
  });

test('known paid targets are excluded by default, opt-in is explicit', async () => {
  const id = await fixture('paid');
  assert.equal((await claim(id)).task, null);
  assert.ok((await claim(id, { include_paid: true })).task);
  await assert.rejects(claim(id, { include_paid: 'false' }), /boolean/);
});

test('a product-specific blocked result cannot hide the target from another website', async () => {
  const id = await fixture();
  await record(id, 'blocked', 'blocked', {
    websiteId: `${id}-other`,
    targetUrl: `https://directory.example.test/${id}`,
    failureReason: 'forbidden',
  });
  assert.ok((await claim(id)).task);
});

test('captcha and rejection preserve enabled entries; explicit disabling is respected', async () => {
  const id = await fixture();
  await applyFailureReason(id, id, 'captcha');
  await applyFailureReason(id, id, 'forbidden');
  assert.equal(
    (await db().select().from(userBacklink).where(eq(userBacklink.id, id)))[0]
      .enabled,
    true
  );
  await db()
    .update(userBacklink)
    .set({ enabled: false })
    .where(eq(userBacklink.id, id));
  assert.equal((await claim(id)).task, null);
});

test('exploration prioritizes checked free targets over unknown high-DR targets', async () => {
  const id = await fixture();
  await db()
    .insert(backlink)
    .values({
      id: `${id}-unknown`,
      ownerUserId: id,
      visibility: 'private',
      name: 'Unknown',
      link: 'https://unknown.example.test',
      domain: 'unknown.example.test',
      status: 'pending',
      dr: 99,
    });
  await db()
    .insert(userBacklink)
    .values({ id: `${id}-unknown`, userId: id, backlinkId: `${id}-unknown` });
  assert.equal((await claim(id)).task?.opportunity.id, id);
});

test('requeue is guarded, concurrent-safe, owner-scoped and preserves evidence', async () => {
  const id = await fixture();
  for (const status of [
    'needs_user',
    'blocked',
    'skipped',
    'submitted',
    'live',
    'duplicate',
    'in_progress',
  ])
    await record(id, status, status, {
      attemptCount: 1,
      proof: 'Previous receipt',
      resultUrl: 'https://directory.example.test/draft',
    });
  const ids = [
    'needs_user',
    'blocked',
    'skipped',
    'submitted',
    'live',
    'duplicate',
    'in_progress',
  ].map((s) => `${id}-${s}`);
  assert.equal((await retryRecords('someone-else', ids)).updated, 0);
  const outcomes = await Promise.all([
    retryRecords(id, ids),
    retryRecords(id, ids),
  ]);
  assert.equal(
    outcomes.reduce((sum, r) => sum + r.updated, 0),
    3
  );
  const rows = await db()
    .select()
    .from(websiteBacklink)
    .where(eq(websiteBacklink.userId, id));
  assert.equal(
    rows.filter((r: any) => r.operationStatus === 'pending').length,
    3
  );
  assert.ok(rows.every((r: any) => r.proof === 'Previous receipt'));
  const task = (await claim(id)).task!;
  assert.equal(task.is_retry, true);
  assert.equal(task.proof, 'Previous receipt');
  assert.equal(task.result_url, 'https://directory.example.test/draft');
});

test('failed reports require a reason, while identical successful retries are idempotent', async () => {
  const id = await fixture();
  const task = (await claim(id)).task!;
  const lease = { worker_id: `${id}-worker`, lease_id: task.lease_id };
  await assert.rejects(
    reportResult(id, task.id, {
      ...lease,
      status: 'needs_user',
      needs_user: 'Needs login',
    }),
    /require reason/
  );
  const report = {
    ...lease,
    status: 'submitted',
    proof: 'Explicit receipt 123',
  };
  assert.equal((await reportResult(id, task.id, report)).status, 'submitted');
  assert.equal((await reportResult(id, task.id, report)).status, 'submitted');
  assert.equal((await retryRecords(id, [task.id])).updated, 0);
});

test('lease expiry remains reviewable and is never blindly retried', async () => {
  const id = await fixture();
  const task = (await claim(id)).task!;
  await db()
    .update(websiteBacklink)
    .set({ leaseExpiresAt: new Date(0) })
    .where(eq(websiteBacklink.id, task.id));
  assert.equal((await claim(id)).task, null);
  const row = (
    await db()
      .select()
      .from(websiteBacklink)
      .where(eq(websiteBacklink.id, task.id))
  )[0];
  assert.equal(row.operationStatus, 'needs_user');
  assert.equal(row.failureReason, 'lease_expired');
});

test('expired leases cannot write a result even before another start call', async () => {
  const id = await fixture();
  const task = (await claim(id)).task!;
  await db()
    .update(websiteBacklink)
    .set({ leaseExpiresAt: new Date(0) })
    .where(eq(websiteBacklink.id, task.id));
  await assert.rejects(
    reportResult(id, task.id, {
      worker_id: `${id}-worker`,
      lease_id: task.lease_id,
      status: 'submitted',
      proof: 'Late receipt',
    }),
    (e: any) => e.status === 409
  );
  assert.equal((await getTask(id, task.id)).status, 'needs_user');
});

test('same-worker concurrent starts return the same lease, leaving other tasks pending', async () => {
  const id = await fixture();
  for (let i = 0; i < 6; i++) await record(id, `pending-${i}`, 'pending');
  const results = await Promise.all(Array.from({ length: 6 }, () => claim(id)));
  assert.equal(new Set(results.map((r) => r.task?.id)).size, 1);
  const rows = await db()
    .select()
    .from(websiteBacklink)
    .where(eq(websiteBacklink.userId, id));
  assert.equal(
    rows.filter((r: any) => r.operationStatus === 'in_progress').length,
    1
  );
});

test('a worker cannot resume a disabled site or claim a different site while busy', async () => {
  const id = await fixture();
  const task = (await claim(id)).task!;
  await assert.rejects(
    claim(id, { website_id: `${id}-other` }),
    (e: any) => e.status === 409
  );
  await db()
    .update(website)
    .set({ autoBacklinkEnabled: false })
    .where(eq(website.id, id));
  await assert.rejects(
    claim(id, { website_id: undefined }),
    (e: any) => e.status === 409
  );
  await assert.rejects(
    heartbeat(id, task.id, {
      worker_id: `${id}-worker`,
      lease_id: task.lease_id,
    }),
    (e: any) => e.status === 409
  );
});

test('conflicting payloads are not acknowledged as an idempotent report', async () => {
  const id = await fixture();
  const task = (await claim(id)).task!;
  const report = {
    worker_id: `${id}-worker`,
    lease_id: task.lease_id,
    status: 'submitted',
    proof: 'Receipt A',
  };
  await reportResult(id, task.id, report);
  await assert.rejects(
    reportResult(id, task.id, { ...report, proof: 'Receipt B' }),
    (e: any) => e.status === 409
  );
});

test('on-demand claims are serialized for the same worker', async () => {
  const id = await fixture();
  for (let i = 0; i < 4; i++) {
    const bid = `${id}-extra-${i}`;
    await db()
      .insert(backlink)
      .values({
        id: bid,
        ownerUserId: id,
        visibility: 'private',
        name: bid,
        link: `https://directory.example.test/${bid}`,
        domain: 'directory.example.test',
        status: 'approved',
        confidence: 'observed',
        costType: 'free',
      });
    await db()
      .insert(userBacklink)
      .values({ id: bid, userId: id, backlinkId: bid });
  }
  const results = await Promise.all(Array.from({ length: 4 }, () => claim(id)));
  assert.equal(new Set(results.map((r) => r.task?.id)).size, 1);
  assert.ok(results.every((r) => r.task));
});

test('different workers cannot claim the same task', async () => {
  const id = await fixture();
  const results = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      claim(id, { worker_id: `${id}-worker-${i}` })
    )
  );
  assert.equal(results.filter((r) => r.task).length, 1);
});

test('result and library evidence roll back together when a library update fails', async () => {
  const id = await fixture('unknown');
  const task = (await claim(id)).task!;
  const { sql } = await import('drizzle-orm');
  await db().run(
    sql.raw(
      "CREATE TRIGGER fail_backlink_proof BEFORE UPDATE ON backlink WHEN OLD.id = '" +
        id +
        "' BEGIN SELECT RAISE(ABORT, 'proof write failure'); END"
    )
  );
  try {
    await assert.rejects(
      reportResult(id, task.id, {
        worker_id: `${id}-worker`,
        lease_id: task.lease_id,
        status: 'submitted',
        proof: 'Receipt',
      })
    );
    assert.equal((await getTask(id, task.id)).status, 'in_progress');
  } finally {
    await db().run(sql.raw('DROP TRIGGER fail_backlink_proof'));
  }
  await reportResult(id, task.id, {
    worker_id: `${id}-worker`,
    lease_id: task.lease_id,
    status: 'submitted',
    proof: 'Receipt',
  });
  assert.equal((await getTask(id, task.id)).status, 'submitted');
});
