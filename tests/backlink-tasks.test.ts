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
const {
  user,
  website,
  backlink,
  backlinkImportBatch,
  userBacklink,
  websiteBacklink,
} = await import('../src/config/db/schema');
const { startTask, reportResult, heartbeat, getTask, bindTaskGoogleLogin } =
  await import('../src/modules/backlinks/tasks');
const {
  addToWebsite,
  importRecords,
  retryRecords,
  createRecord,
  listRecords,
  listSuccessfulTargets,
} = await import('../src/modules/backlinks/records');
const {
  addToMine,
  batchRemoveMine,
  applyFailureReason,
  createOwn,
  createPublicBacklink,
  deletePublicBacklink,
  importLibraryCsv,
  importToMine,
  listImportBatches,
  listMine,
  removeMine,
} = await import('../src/modules/backlinks/library');
const {
  sanitizeWebsiteInput,
  requireWebsite,
  productOf,
  updateWebsite,
  createWebsite,
  websiteOptions,
} = await import('../src/modules/backlinks/websites');
const { readVerificationMail, routeIncomingMail, verificationOf } =
  await import('../src/modules/backlinks/verification-mail');
const { COMPANY_FOUNDED_YEAR_KEY } = await import('../src/config/backlinks');
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
        googleLoginEmail: `${id}@gmail.com`,
      },
      {
        id: `${id}-other`,
        userId: id,
        name: id,
        url: `https://other-${id}.example.test`,
        shortDesc: 'Other test product',
        googleLoginEmail: `${id}-other@gmail.com`,
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

test('bulk library removal stays inside the current account and group', async () => {
  const id = await fixture();
  const other = await fixture();
  await importToMine(id, {
    batchName: 'Saved targets',
    urls: ['https://batch.example.test/a', 'https://batch.example.test/b'],
  });
  await importToMine(other, {
    batchName: 'Other owner',
    urls: ['https://batch.example.test/a'],
  });
  const [batch] = (await listImportBatches(id, 1, 10)).list;
  const [foreign] = (await listImportBatches(other, 1, 10)).list;
  const links = await listMine(id, { batch: batch.id, page: 1, pageSize: 10 });
  const selected = links.list[0];
  await addToWebsite(id, id, { ids: [selected.id] });

  assert.deepEqual(await batchRemoveMine(id, foreign.id), { deleted: 0 });
  await assert.rejects(batchRemoveMine(id, batch.id, []), /Select/);
  const attempts = await Promise.all([
    batchRemoveMine(id, batch.id, [selected.id, id, other]),
    batchRemoveMine(id, batch.id, [selected.id]),
  ]);
  assert.equal(
    attempts.reduce((sum, result) => sum + result.deleted, 0),
    1
  );
  assert.equal((await listImportBatches(id, 1, 10)).unbatched, 1);
  assert.deepEqual(await batchRemoveMine(id, batch.id), { deleted: 1 });
  assert.deepEqual(await batchRemoveMine(id, 'unbatched'), { deleted: 1 });
  assert.equal((await listMine(id, { page: 1, pageSize: 10 })).total, 0);
  assert.equal((await listImportBatches(other, 1, 10)).list[0].count, 1);
  assert.equal((await listImportBatches(other, 1, 10)).unbatched, 1);
  const history = await listRecords(id, {
    websiteId: id,
    page: 1,
    pageSize: 10,
  });
  assert.equal(history.list[0].targetUrl, selected.link);
  assert.equal(history.list[0].backlinkId, selected.id);
});

test('successful history includes submitted and public records even after removal from the library', async () => {
  const id = await fixture();
  const other = await fixture();
  await record(id, 'receipt', 'submitted');
  await record(id, 'public', 'live');
  await record(id, 'duplicate', 'duplicate');
  await record(id, 'blocked', 'blocked');
  await record(id, 'deleted', 'live', { websiteId: `${id}-other` });
  await db()
    .update(website)
    .set({ deletedAt: new Date() })
    .where(eq(website.id, `${id}-other`));
  await record(other, 'other', 'live');
  await batchRemoveMine(id, 'unbatched');

  const filter = { successfulOnly: true, page: 1, pageSize: 10 };
  const results = await listRecords(id, filter);
  assert.equal(results.total, 2);
  assert.deepEqual(
    new Set(results.list.map((row) => row.id)),
    new Set([`${id}-receipt`, `${id}-public`])
  );
  assert.equal(
    (await listRecords(id, { ...filter, websiteId: other })).total,
    0
  );
});

test('successful targets use original entry URLs and create fresh destination tasks', async () => {
  const owner = await fixture();
  const other = await fixture();
  const destination = `${owner}-other`;
  const known = `https://directory.example.test/${owner}`;
  const confirmed = `https://directory.example.test/${owner}/listing`;
  const submitted = `https://directory.example.test/${owner}/receipt`;
  const existing = `https://directory.example.test/${owner}/existing`;
  const paid = `https://directory.example.test/${owner}/paid`;
  await db()
    .insert(website)
    .values({
      id: `${owner}-history`,
      userId: owner,
      name: 'Another project',
      url: `https://history-${owner}.example.test`,
    });
  await record(owner, 'visible-success', 'live', {
    targetUrl: known,
    resultUrl: confirmed,
    updatedAt: new Date('2026-11-24T12:00:00Z'),
  });
  await record(owner, 'same-url', 'submitted', {
    websiteId: `${owner}-history`,
    targetUrl: known,
    updatedAt: new Date('2026-11-24T13:00:00Z'),
  });
  await record(owner, 'manual-success', 'submitted', {
    backlinkId: null,
    targetUrl: submitted,
    updatedAt: new Date('2026-11-24T14:00:00Z'),
  });
  await record(owner, 'was-paid', 'live', { targetUrl: paid });
  await record(owner, 'paid-evidence', 'needs_user', {
    targetUrl: paid,
    websiteId: `${owner}-history`,
    failureReason: 'paid',
  });
  await record(owner, 'existing-success', 'live', { targetUrl: existing });
  await record(owner, 'already-in-destination', 'pending', {
    targetUrl: existing,
    websiteId: destination,
  });
  await record(other, 'private-success', 'live');
  await removeMine(owner, owner);

  const page = { page: 1, pageSize: 10 };
  const library = await listSuccessfulTargets(owner, undefined, page);
  assert.equal(library.total, 3);
  assert.ok(library.list.some((row) => row.url === existing));
  assert.deepEqual(
    library.list.filter((row) => row.url !== existing),
    [
      { url: submitted, status: 'submitted' },
      { url: known, status: 'live' },
    ]
  );
  assert.deepEqual(
    await listSuccessfulTargets(owner, undefined, {
      ...page,
      search: 'receipt',
    }),
    { list: [{ url: submitted, status: 'submitted' }], total: 1 }
  );
  assert.deepEqual(await listSuccessfulTargets(owner, destination, page), {
    list: [
      { url: known, status: 'live' },
      { url: submitted, status: 'submitted' },
    ],
    total: 2,
  });
  await assert.rejects(
    listSuccessfulTargets(other, destination, page),
    /Website not found/
  );
  const additions = await Promise.all([
    addToWebsite(owner, destination, {
      successfulTargets: [known, paid, confirmed, existing],
    }),
    addToWebsite(owner, destination, { successfulTargets: [known] }),
  ]);
  assert.equal(
    additions.reduce((total, item) => total + item.added, 0),
    1
  );
  assert.deepEqual(
    await addToWebsite(owner, destination, { successfulTargets: 'all' }),
    { added: 1, skipped: 0 }
  );
  assert.deepEqual(await listSuccessfulTargets(owner, destination, page), {
    list: [],
    total: 0,
  });
  const tasks = await listRecords(owner, { ...page, websiteId: destination });
  assert.equal(tasks.total, 3);
  const copy = tasks.list.find((row) => row.targetUrl === known);
  assert.equal(copy?.backlinkId, owner);
  assert.equal(copy?.operationStatus, 'pending');
  assert.equal(copy?.resultUrl, null);
  assert.equal(copy?.proof, null);
});

test('a new successful submission is reusable without a library entry', async () => {
  const owner = await fixture();
  const destination = `${owner}-other`;
  const url = `https://directory.example.test/${owner}/new-success`;
  const page = { page: 1, pageSize: 10 };
  await record(owner, 'new-success', 'pending', { backlinkId: null });
  assert.equal((await listSuccessfulTargets(owner, undefined, page)).total, 0);

  const queue = { data_source: 'website' };
  const source = (await claim(owner, queue)).task!;
  await reportResult(owner, source.id, {
    worker_id: `${owner}-worker`,
    lease_id: source.lease_id,
    status: 'submitted',
    proof: 'Received by the directory',
  });
  assert.deepEqual(await listSuccessfulTargets(owner, undefined, page), {
    list: [{ url, status: 'submitted' }],
    total: 1,
  });

  assert.deepEqual(
    await addToWebsite(owner, destination, { successfulTargets: 'all' }),
    {
      added: 1,
      skipped: 0,
    }
  );
  const next = (await claim(owner, { ...queue, website_id: destination }))
    .task!;
  assert.equal(next.opportunity.submission_url, url);
  assert.equal(next.website_id, destination);
  assert.equal(next.attempt_count, 1);
  assert.equal(next.proof, null);
});

test('legacy project support mail still forwards and stays scoped to the original project and lease', async () => {
  const id = await fixture();
  const other = await fixture();
  const grid = await fixture();
  const pavoEmail = 'support@pavoai.net';
  const gridEmail = 'support@gridcraft.me';
  const inbox = 'shared-inbox@example.test';
  await db()
    .update(website)
    .set({
      url: 'https://pavoai.net/',
      email: pavoEmail,
    })
    .where(eq(website.id, id));
  await db()
    .update(website)
    .set({ url: 'https://pavoai.net/', email: pavoEmail })
    .where(eq(website.id, other));
  await db()
    .update(website)
    .set({ url: 'https://gridcraft.me/', email: gridEmail })
    .where(eq(website.id, grid));

  const runtime = globalThis as { __CF_ENV__?: Record<string, unknown> };
  const original = runtime.__CF_ENV__;
  const key = process.env.CONFIG_ENCRYPTION_KEY;
  const stored = new Map<string, string>();
  const forwarded: string[] = [];
  let storageDown = false;
  process.env.CONFIG_ENCRYPTION_KEY = 'isolated-mail-test-key';
  runtime.__CF_ENV__ = {
    ...original,
    BACKLORA_SUBMISSION_DOMAINS: JSON.stringify({
      [id]: 'pavoai.net',
    }),
    BACKLORA_SUPPORT_MAILBOXES: JSON.stringify({
      [pavoEmail]: id,
      [gridEmail]: grid,
    }),
    BACKLORA_SUPPORT_MAIL_FORWARD_TO: inbox,
    VERIFICATION_MAIL: {
      get: async (name: string) => stored.get(name) ?? null,
      put: async (
        name: string,
        value: string,
        options: { expirationTtl: number }
      ) => {
        if (storageDown) throw new Error('KV unavailable');
        assert.equal(options.expirationTtl, 600);
        stored.set(name, value);
      },
    },
  };
  try {
    const { task } = await claim(id);
    assert.ok(task?.lease_id);
    assert.equal(task.product.submission_email, `${id}@gmail.com`);
    assert.equal(task.product.contact_email, pavoEmail);
    const gridTask = (await claim(grid)).task!;
    const request = {
      worker_id: `${id}-worker`,
      lease_id: task.lease_id,
      requested_after: new Date(Date.now() - 1000).toISOString(),
    };
    await assert.rejects(readVerificationMail(id, task.id, request), {
      status: 409,
    });
    // Simulate leases issued before switching to Gmail.
    await db()
      .update(websiteBacklink)
      .set({ submissionEmail: pavoEmail })
      .where(eq(websiteBacklink.id, task.id));
    await db()
      .update(websiteBacklink)
      .set({ submissionEmail: gridEmail })
      .where(eq(websiteBacklink.id, gridTask.id));
    const receive = (
      host: string,
      dmarc: string,
      to = pavoEmail,
      body = 'Your verification code is 321789'
    ) => {
      const raw = new Response(
        `From: Verify <noreply@${host}>\r\nSubject: Account message\r\n\r\n${body}\r\n`
      ).body!;
      return routeIncomingMail({
        to,
        raw,
        rawSize: 150,
        forward: async (destination) => {
          forwarded.push(destination);
        },
        headers: new Headers({
          'authentication-results': `mx.cloudflare.net; dmarc=${dmarc} header.from=${host}`,
        }),
      });
    };
    await receive('directory.example.test', 'fail');
    await receive('directory.example.test.attacker.test', 'pass');
    await receive(
      'directory.example.test',
      'pass',
      pavoEmail,
      'A support question'
    );
    await receive(
      'directory.example.test',
      'pass',
      'support@unconfigured.test'
    );
    assert.deepEqual(forwarded, [inbox, inbox, inbox]);
    assert.deepEqual(await readVerificationMail(id, task.id, request), {
      status: 'waiting',
    });

    await receive('mail.directory.example.test', 'pass', gridEmail);
    assert.deepEqual(await readVerificationMail(id, task.id, request), {
      status: 'waiting',
    });
    assert.equal(
      (
        await readVerificationMail(grid, gridTask.id, {
          worker_id: `${grid}-worker`,
          lease_id: gridTask.lease_id,
          requested_after: request.requested_after,
        })
      ).status,
      'received'
    );

    await receive('mail.directory.example.test', 'pass');
    assert.deepEqual(forwarded, [inbox, inbox, inbox, inbox, inbox]);
    assert.equal(stored.size, 2);
    assert.match([...stored.values()][0], /^enc:v1:/);
    const received = await readVerificationMail(id, task.id, request);
    assert.equal(received.status, 'received');
    if (received.status === 'received') assert.equal(received.code, '321789');
    storageDown = true;
    await receive('directory.example.test', 'pass', gridEmail);
    assert.equal(forwarded.length, 6);
    assert.equal(forwarded.at(-1), inbox);
    assert.equal(stored.size, 2);
    assert.deepEqual(
      await readVerificationMail(id, task.id, {
        ...request,
        requested_after: new Date(Date.now() + 1000).toISOString(),
      }),
      { status: 'waiting' }
    );
    await assert.rejects(readVerificationMail(other, task.id, request), {
      status: 409,
    });
    await assert.rejects(
      readVerificationMail(id, task.id, { ...request, lease_id: 'wrong' }),
      { status: 409 }
    );
    await db()
      .update(websiteBacklink)
      .set({ leaseExpiresAt: new Date(0) })
      .where(eq(websiteBacklink.id, task.id));
    await assert.rejects(readVerificationMail(id, task.id, request), {
      status: 409,
    });
  } finally {
    runtime.__CF_ENV__ = original;
    if (key === undefined) delete process.env.CONFIG_ENCRYPTION_KEY;
    else process.env.CONFIG_ENCRYPTION_KEY = key;
  }
});

test('new tasks require a Google login email and keep public contact separate', async () => {
  const id = await fixture();
  const outsider = await fixture();
  await db()
    .update(website)
    .set({
      email: 'support@one.example.test',
      googleLoginEmail: null,
    })
    .where(eq(website.id, id));

  await record(id, 'requires-google', 'pending');
  const profile = await requireWebsite(id, id);
  assert.equal(productOf(profile).registration_email, null);
  assert.deepEqual(productOf(profile).submission_readiness.blocking_fields, [
    'googleLoginEmail',
  ]);
  assert.equal(
    (await websiteOptions(id)).find((site) => site.id === id)?.canRunBacklinks,
    false
  );
  await assert.rejects(claim(id), { status: 409 });
  assert.equal((await getTask(id, `${id}-requires-google`)).status, 'pending');
  await db()
    .update(website)
    .set({ googleLoginEmail: null })
    .where(eq(website.id, `${id}-other`));
  const empty = await claim(id, { website_id: undefined });
  assert.equal(empty.task, null);
  assert.equal(empty.queue?.reason, 'missing_google_login_email');

  const email = 'project-account@gmail.com';
  await updateWebsite(id, profile.id, { ...profile, googleLoginEmail: email });
  assert.equal(
    (await websiteOptions(id)).find((site) => site.id === id)?.canRunBacklinks,
    true
  );
  const task = (await claim(id, { website_id: undefined })).task!;
  assert.equal(task.website_id, id);
  assert.equal(task.product.contact_email, 'support@one.example.test');
  assert.equal(task.product.submission_email, email);
  assert.equal(task.product.email_capability, 'receive_only');
  assert.equal(task.account_policy.login_email, email);
  assert.equal(task.account_policy.google_login_email, email);
  assert.equal(task.account_policy.verification_method, 'gmail');
  assert.equal(task.account_policy.verification_inbox_email, email);
  assert.equal(
    task.account_policy.mailbox_url,
    'https://mail.google.com/mail/?authuser=project-account%40gmail.com#inbox'
  );
  assert.equal(task.account_policy.verification_path, null);
  assert.equal(
    (await claim(outsider)).task?.account_policy.login_email,
    `${outsider}@gmail.com`
  );
});

test('the per-project Google setting can be set or cleared and pins a task to the approved account', async () => {
  const id = await fixture();
  const other = await fixture();
  const inbox = 'gridcraft-project@gmail.com';
  await db()
    .update(website)
    .set({ url: 'https://gridcraft.me/' })
    .where(eq(website.id, id));
  await db()
    .update(website)
    .set({ url: 'https://gridcraft.me/' })
    .where(eq(website.id, other));
  const email = inbox;
  const profile = await requireWebsite(id, id);
  await assert.rejects(
    updateWebsite(id, id, { ...profile, googleLoginEmail: 'invalid address' }),
    /Invalid Google login email/
  );
  assert.equal(
    (
      await updateWebsite(id, id, {
        ...profile,
        googleLoginEmail: ' GridCraft-Project@Gmail.Com ',
      })
    ).googleLoginEmail,
    email
  );
  const { googleLoginEmail: _google, ...olderProfile } = profile;
  assert.equal(
    (await updateWebsite(id, id, olderProfile)).googleLoginEmail,
    email
  );
  {
    const { task } = await claim(id);
    assert.ok(task?.lease_id);
    assert.equal(task.account_policy.google_login_email, email);
    assert.equal(task.product.submission_email, inbox);
    assert.equal(task.account_policy.login_provider, 'email');
    assert.ok(task.account_policy.google_login_path);
    assert.equal(task.account_policy.verification_method, 'gmail');
    assert.equal(
      (await claim(other)).task?.account_policy.google_login_email,
      `${other}@gmail.com`
    );
    const auth = { worker_id: `${id}-worker`, lease_id: task.lease_id };
    await assert.rejects(bindTaskGoogleLogin(other, task.id, auth), {
      status: 404,
    });
    await assert.rejects(
      bindTaskGoogleLogin(id, task.id, { ...auth, lease_id: 'bad' }),
      { status: 409 }
    );
    assert.equal((await getTask(id, task.id)).product.submission_email, inbox);
    assert.equal(
      (await bindTaskGoogleLogin(id, task.id, auth)).google_login_email,
      email
    );
    const bound = await getTask(id, task.id);
    assert.equal(bound.product.submission_email, email);
    assert.equal(bound.account_policy.login_provider, 'google');
    assert.equal(bound.account_policy.verification_method, 'gmail');
    assert.equal(bound.account_policy.verification_inbox_email, email);
    assert.equal(bound.account_policy.requires_account_review, false);
    assert.equal(bound.account_policy.verification_path, null);
    assert.equal(
      (await bindTaskGoogleLogin(id, task.id, auth)).google_login_email,
      email
    );
    await updateWebsite(id, id, { ...profile, googleLoginEmail: '' });
    const cleared = await getTask(id, task.id);
    assert.equal(cleared.account_policy.google_login_email, null);
    assert.equal(cleared.account_policy.google_login_path, null);
    assert.equal(cleared.product.submission_email, email);
    assert.equal(cleared.account_policy.requires_account_review, true);
    await assert.rejects(claim(id), { status: 409 });
    await assert.rejects(bindTaskGoogleLogin(id, task.id, auth), {
      status: 409,
    });
  }
});

test('verification links must stay on the target domain and password-reset mail is ignored', () => {
  assert.deepEqual(
    verificationOf(
      {
        subject: 'Activate your account',
        html: '<a href="https://directory.example.test/verify?k=token&amp;flow=signup">Verify</a>',
      },
      'directory.example.test'
    ),
    {
      code: null,
      link: 'https://directory.example.test/verify?k=token&flow=signup',
    }
  );
  assert.equal(
    verificationOf(
      {
        text: 'Verify: https://directory.example.test.attacker.test/verify?k=token',
      },
      'directory.example.test'
    ),
    null
  );
  assert.equal(
    verificationOf(
      {
        subject: 'Reset your password',
        text: 'Your verification code is 321789',
      },
      'directory.example.test'
    ),
    null
  );
});

test('named library imports count unique new links and allow removing them without unlinking websites', async () => {
  const id = await fixture();
  const other = await fixture();
  const first = 'https://batch.example.test/first';
  const second = 'https://batch.example.test/second';
  const result = await importToMine(id, {
    batchName: 'New directories',
    urls: [first, second, first, 'bad'],
  });
  assert.deepEqual(result, { added: 2, invalid: 1, skipped: 1 });
  const batches = await listImportBatches(id, 1, 10);
  assert.equal(batches.total, 1);
  assert.equal(batches.unbatched, 1);
  const [batch] = batches.list;
  assert.equal(batch.name, 'New directories');
  assert.equal(batch.count, 2);
  const query = {
    pageSize: 1,
    batch: batch.id,
    enabled: 'enabled',
    category: 'other',
  };
  const page1 = await listMine(id, { ...query, page: 1 });
  const page2 = await listMine(id, { ...query, page: 2 });
  assert.equal(page1.total, 2);
  assert.deepEqual(
    new Set([...page1.list, ...page2.list].map((link) => link.link)),
    new Set([first, second])
  );
  assert.equal((await listMine(other, { ...query, page: 1 })).total, 0);
  assert.equal((await listImportBatches(other, 1, 10)).total, 0);

  const [{ id: backlinkId }] = page1.list;
  await addToWebsite(id, id, { ids: [backlinkId] });
  await removeMine(other, backlinkId);
  assert.equal((await listImportBatches(id, 1, 10)).list[0].count, 2);
  await removeMine(id, backlinkId);
  assert.equal((await listImportBatches(id, 1, 10)).list[0].count, 1);
  const [record] = await db()
    .select()
    .from(websiteBacklink)
    .where(eq(websiteBacklink.websiteId, id));
  assert.equal(record.backlinkId, backlinkId);
});

test('website URL and CSV imports save target URLs to the personal library', async () => {
  const id = await fixture();
  const other = await fixture();
  const fromWebsite = 'https://website-import.example.test/target';
  const fromHistory = 'https://tracking-import.example.test/target';
  const fromLegacy = 'https://library-import.example.test/target';
  await assert.rejects(
    addToWebsite(id, other, { urls: [fromWebsite] }),
    /Website not found/
  );
  assert.equal(
    (await listMine(id, { page: 1, pageSize: 10, search: fromWebsite })).total,
    0
  );
  assert.equal((await addToWebsite(id, id, { urls: [fromWebsite] })).added, 1);
  assert.equal(
    (
      await importRecords(
        id,
        `target_url,operation_status\n${fromHistory},live`,
        id
      )
    ).created,
    1
  );
  assert.equal(
    (await importLibraryCsv(id, `name,url\nDirectory,${fromLegacy}`)).created,
    1
  );
  const { list } = await listMine(id, {
    page: 1,
    pageSize: 10,
    batch: 'unbatched',
  });
  assert.deepEqual(
    new Set(list.map((link) => link.link)),
    new Set([
      `https://directory.example.test/${id}`,
      fromWebsite,
      fromHistory,
      fromLegacy,
    ])
  );
  assert.ok(list.every((link) => link.visibility === 'private'));
});

test('simultaneous named imports of the same URL add it to the library once', async () => {
  const id = await fixture();
  const urls = ['https://batch.example.test/shared'];
  const results = await Promise.all([
    importToMine(id, { batchName: 'Batch A', urls }),
    importToMine(id, { batchName: 'Batch B', urls }),
  ]);
  assert.deepEqual(results.map((result) => result.added).sort(), [0, 1]);
  const { list } = await listImportBatches(id, 1, 10);
  assert.equal(list.length, 1);
  assert.equal(list[0].count, 1);
});

test('website batch imports share library naming, URL deduplication, and retry behavior', async () => {
  const id = await fixture();
  const other = await fixture();
  const existing = 'https://shared-library.example.test/existing';
  const unbatched = `https://directory.example.test/${id}`;
  const fresh = 'https://shared-library.example.test/new';
  await importToMine(id, { batchName: 'Previous', urls: [existing] });
  await addToWebsite(id, id, { urls: [existing] });
  const payload = {
    batchName: '  Website batch  ',
    urls: [existing, unbatched, fresh, `${fresh}#repeat`, 'invalid'],
  };
  await assert.rejects(addToWebsite(id, other, payload), /Website not found/);
  await assert.rejects(
    addToWebsite(id, id, { ...payload, batchName: ' ' }),
    /Invalid batch name/
  );
  assert.equal((await listImportBatches(id, 1, 10)).total, 1);

  const result = await addToWebsite(id, id, payload);
  assert.deepEqual(result, {
    added: 2,
    skipped: 2,
    invalid: 1,
    libraryAdded: 2,
  });
  const batches = await listImportBatches(id, 1, 10);
  assert.equal(batches.total, 2);
  assert.equal(batches.unbatched, 0);
  const batch = batches.list.find((item) => item.name === 'Website batch')!;
  assert.equal(batch.count, 2);
  assert.equal(batches.list.find((item) => item.name === 'Previous')?.count, 1);
  assert.deepEqual(await addToWebsite(id, id, payload), {
    added: 0,
    skipped: 4,
    invalid: 1,
    libraryAdded: 0,
  });
  assert.equal((await listImportBatches(id, 1, 10)).total, 2);

  // The same batch is now available as a library selection for other sites.
  assert.deepEqual(
    await addToWebsite(id, `${id}-other`, { batchIds: [batch.id] }),
    { added: 2, skipped: 0 }
  );
  const records = await db()
    .select({ targetUrl: websiteBacklink.targetUrl })
    .from(websiteBacklink)
    .where(eq(websiteBacklink.websiteId, id));
  assert.deepEqual(
    new Set(records.map((record: { targetUrl: string }) => record.targetUrl)),
    new Set([existing, unbatched, fresh])
  );
});

test('new imports deduplicate normalized URLs without dropping other paths or query parameters', async () => {
  const id = await fixture();
  const base = 'https://dedupe.example.test/submit';
  assert.deepEqual(
    await importToMine(id, { batchName: 'Original', urls: [`${base}#old`] }),
    { added: 1, skipped: 0, invalid: 0 }
  );
  assert.deepEqual(
    await importToMine(id, {
      batchName: 'Next',
      urls: [
        'https://DEDUPE.example.test:443/submit#new',
        'dedupe.example.test/another',
        `${base}?plan=free`,
        'https://dedupe.example.test/another#duplicate',
      ],
    }),
    { added: 2, skipped: 2, invalid: 0 }
  );
  const links = await listMine(id, { page: 1, pageSize: 10, search: 'dedupe' });
  assert.deepEqual(
    new Set(links.list.map((item) => item.link)),
    new Set([base, 'https://dedupe.example.test/another', `${base}?plan=free`])
  );
  assert.deepEqual(
    await addToWebsite(id, id, { urls: [base, `${base}#copy`] }),
    {
      added: 1,
      skipped: 1,
      invalid: 0,
    }
  );
  assert.deepEqual(
    await addToWebsite(id, id, { urls: [base, `${base}#copy`] }),
    {
      added: 0,
      skipped: 2,
      invalid: 0,
    }
  );
});

test('catalog IDs with the same URL do not add a second copy to a personal library', async (t) => {
  const id = await fixture();
  const other = await fixture();
  const link = `https://directory.example.test/${id}`;
  const shared = await createPublicBacklink({ link });
  t.after(() => deletePublicBacklink(shared.id));
  assert.deepEqual(await addToMine(id, [shared.id, id]), { added: 0 });
  assert.equal(
    (await listMine(id, { page: 1, pageSize: 10, search: link })).total,
    1
  );
  await assert.rejects(createOwn(id, { link }), /URL is already saved/);
  await assert.rejects(createPublicBacklink({ link }), /URL is already saved/);

  await createOwn(other, { link });
  assert.deepEqual(await addToMine(other, [shared.id]), { added: 0 });
  assert.equal(
    (await listMine(other, { page: 1, pageSize: 10, search: link })).total,
    1
  );
});

test('reimporting an existing unbatched URL fills the matching empty batch', async (t) => {
  const id = await fixture();
  const link = `https://directory.example.test/${id}`;
  const batchId = `${id}-empty`;
  await db()
    .insert(backlinkImportBatch)
    .values({ id: batchId, userId: id, name: 'Saved links' });
  await db()
    .update(userBacklink)
    .set({ notes: 'Kept from the old library', enabled: false })
    .where(eq(userBacklink.backlinkId, id));
  const publicId = `00-public-${id}`;
  await db().insert(backlink).values({
    id: publicId,
    visibility: 'public',
    name: 'Same URL in the public catalog',
    link,
    domain: 'directory.example.test',
  });
  t.after(async () => {
    await db().delete(backlink).where(eq(backlink.id, publicId));
  });

  const result = await importToMine(id, {
    batchName: 'Saved links',
    urls: [link],
  });
  assert.deepEqual(result, { added: 1, skipped: 0, invalid: 0 });
  const batches = await listImportBatches(id, 1, 10);
  assert.deepEqual(batches.list, [
    { id: batchId, name: 'Saved links', count: 1 },
  ]);
  assert.equal(batches.unbatched, 0);
  const {
    list: [entry],
    total,
  } = await listMine(id, { page: 1, pageSize: 10 });
  assert.equal(total, 1);
  assert.equal(entry.id, id);
  assert.equal(entry.enabled, false);
  assert.equal(entry.notes, 'Kept from the old library');

  assert.deepEqual(
    await importToMine(id, { batchName: 'Another batch', urls: [link] }),
    {
      added: 0,
      skipped: 1,
      invalid: 0,
    }
  );
  assert.equal((await listImportBatches(id, 1, 10)).total, 1);
});

test('adding selected batches uses enabled personal links and skips website duplicates', async () => {
  const id = await fixture();
  const other = await fixture();
  await importToMine(id, {
    batchName: 'Local',
    urls: [
      'https://batch.example.test/enabled',
      'https://batch.example.test/disabled',
    ],
  });
  await importToMine(other, {
    batchName: 'Foreign',
    urls: ['https://batch.example.test/foreign'],
  });
  const {
    list: [batch],
  } = await listImportBatches(id, 1, 10);
  const {
    list: [foreign],
  } = await listImportBatches(other, 1, 10);
  const {
    list: [disabled],
  } = await listMine(id, {
    batch: batch.id,
    search: '/disabled',
    page: 1,
    pageSize: 10,
  });
  await db()
    .update(userBacklink)
    .set({ enabled: false })
    .where(eq(userBacklink.id, disabled.libraryId));
  const available = await listImportBatches(id, 1, 10, true);
  assert.equal(available.list[0].count, 1);
  assert.equal(available.unbatched, 1);
  const payload = { batchIds: [batch.id, 'unbatched', foreign.id, batch.id] };
  assert.deepEqual(await addToWebsite(id, id, payload), {
    added: 2,
    skipped: 0,
  });
  assert.deepEqual(await addToWebsite(id, id, payload), {
    added: 0,
    skipped: 2,
  });
  const records = await db()
    .select()
    .from(websiteBacklink)
    .where(eq(websiteBacklink.websiteId, id));
  assert.deepEqual(
    new Set(records.map((record: { targetUrl: string }) => record.targetUrl)),
    new Set([
      `https://directory.example.test/${id}`,
      'https://batch.example.test/enabled',
    ])
  );
});

test('known paid targets are excluded by default, opt-in is explicit', async () => {
  const id = await fixture('paid');
  assert.equal((await claim(id)).task, null);
  assert.ok((await claim(id, { include_paid: true })).task);
  await assert.rejects(claim(id, { include_paid: 'false' }), /boolean/);
});

test('legacy website commands claim recommended entries first and continue into eligible pending work', async () => {
  const id = await fixture('unknown');
  const preferredId = `${id}-approved-free`;
  await db()
    .insert(backlink)
    .values({
      id: preferredId,
      ownerUserId: id,
      visibility: 'private',
      name: 'Verified free directory',
      link: `https://directory.example.test/${preferredId}`,
      domain: 'directory.example.test',
      status: 'approved',
      confidence: 'verified',
      costType: 'free',
    });
  await record(id, 'unknown-cost', 'pending');
  await record(id, 'free', 'pending', { backlinkId: preferredId });

  const args = { data_source: 'website', task_scope: 'recommended' };
  assert.equal((await claim(id, args)).task?.id, `${id}-free`);
  const next = await claim(id, { ...args, worker_id: `${id}-next-worker` });
  assert.equal(next.task?.id, `${id}-unknown-cost`);
});

test('free website claims use the owner’s accepted URLs and put repeated technical failures last', async () => {
  const id = await fixture();
  const foreignOwner = await fixture();
  const third = `${id}-third`;
  await db()
    .insert(website)
    .values({
      id: third,
      userId: id,
      name: third,
      url: `https://${third}.example.test`,
    });
  const accepted = `https://directory.example.test/${id}/accepted`;
  const unavailable = `https://directory.example.test/${id}/unavailable`;
  await record(foreignOwner, 'foreign-success', 'live', {
    targetUrl: unavailable,
  });
  await record(id, 'old-success', 'submitted', {
    websiteId: `${id}-other`,
    targetUrl: accepted,
  });
  await record(id, 'broken-one', 'blocked', {
    websiteId: `${id}-other`,
    failureReason: 'site_down',
    targetUrl: unavailable,
  });
  await record(id, 'broken-two', 'blocked', {
    websiteId: third,
    failureReason: 'no_entry',
    targetUrl: unavailable,
  });
  await record(id, 'unlikely', 'pending', { targetUrl: unavailable });
  await record(id, 'unknown', 'pending', { backlinkId: null });
  await record(id, 'proven', 'pending', {
    backlinkId: null,
    targetUrl: accepted,
  });
  const take = (worker: string) =>
    claim(id, { data_source: 'website', worker_id: `${id}-${worker}` });
  assert.equal((await take('one')).task?.id, `${id}-proven`);
  assert.equal((await take('two')).task?.id, `${id}-unknown`);
  assert.equal((await take('three')).task?.id, `${id}-unlikely`);
});

test('free website claims use an unused accepted personal entry before exploring unknown URLs', async () => {
  const id = await fixture('unknown');
  const accepted = `https://directory.example.test/${id}`;
  await record(id, 'other-success', 'live', {
    websiteId: `${id}-other`,
    targetUrl: accepted,
  });
  await record(id, 'unknown', 'pending', { backlinkId: null });
  const first = await claim(id, { data_source: 'website' });
  assert.equal(first.task?.opportunity.submission_url, accepted);
  const next = await claim(id, {
    data_source: 'website',
    worker_id: `${id}-next`,
  });
  assert.equal(next.task?.id, `${id}-unknown`);
});

test('a paid-only website queue can claim a fresh recommended personal entry exactly once', async () => {
  const id = await fixture();
  const paidUrl = `https://directory.example.test/${id}/known-paid`;
  await record(id, 'paid-pending', 'pending', {
    backlinkId: null,
    targetUrl: paidUrl,
  });
  await record(id, 'paid-history', 'needs_user', {
    websiteId: `${id}-other`,
    failureReason: 'paid',
    targetUrl: paidUrl,
  });
  const args = { data_source: 'website', task_scope: 'recommended' };
  const [first, resumed] = await Promise.all([
    claim(id, args),
    claim(id, args),
  ]);
  assert.equal(first.task?.product.id, id);
  assert.equal(
    first.task?.opportunity.submission_url,
    `https://directory.example.test/${id}`
  );
  assert.equal(first.task?.lease_id, resumed.task?.lease_id);
  assert.ok(
    [first.queue, resumed.queue].some(
      (queue) => queue && 'source' in queue && queue.source === 'personal'
    )
  );

  const exhausted = await claim(id, {
    ...args,
    worker_id: `${id}-next-worker`,
  });
  assert.equal(exhausted.task, null);
  assert.deepEqual(exhausted.queue, {
    reason: 'no_eligible_website_tasks',
    pending: 1,
    excluded_paid: 1,
    requested_scope: 'recommended',
    effective_scope: 'all_eligible',
    checked_personal_library: true,
  });
  const paid = await getTask(id, `${id}-paid-pending`);
  assert.equal(paid.status, 'pending');
});

test('a historical support-email identity requires review without changing the shared login', async () => {
  const id = await fixture();
  await db()
    .update(website)
    .set({
      email: 'support@product.example',
      emailCapability: 'receive_only',
      registrationEmail: 'support@product.example',
      registrationEmailCapability: 'receive_only',
      emailManagementUrl: 'https://mail.google.com/mail/u/0/#inbox',
    })
    .where(eq(website.id, id));
  await record(id, 'legacy-email', 'pending', {
    submissionEmail: 'support@product.example',
    attemptCount: 1,
  });
  const task = (await claim(id)).task!;
  assert.equal(task.product.email, `${id}@gmail.com`);
  assert.equal(task.product.submission_email, 'support@product.example');
  assert.equal(task.product.email_capability, 'receive_only');
  assert.equal(task.product.submission_identity_review_required, true);
  assert.equal(task.account_policy.allow_logout, false);
  assert.equal(task.account_policy.login_email, `${id}@gmail.com`);
  assert.equal(task.account_policy.verification_method, 'gmail');
  assert.equal(task.account_policy.google_login_path, null);
  assert.equal(
    task.account_policy.previous_submission_email,
    'support@product.example'
  );

  await db()
    .update(website)
    .set({
      registrationEmail: 'login@example.test',
      registrationEmailCapability: 'send_capable',
    })
    .where(eq(website.id, id));
  const oldIdentity = (await getTask(id, task.id)).product;
  assert.equal(oldIdentity.email, `${id}@gmail.com`);
  assert.equal(oldIdentity.email_capability, 'receive_only');

  const lease = { worker_id: `${id}-worker`, lease_id: task.lease_id };
  const parked = await reportResult(id, task.id, {
    ...lease,
    status: 'needs_user',
    reason: 'email_send',
    needs_user: 'This mailbox cannot send or reply as the product address.',
  });
  assert.equal(parked.status, 'needs_user');
});

test('changing Gmail preserves the prior identity across claims and retries', async () => {
  const id = await fixture();
  await db()
    .update(website)
    .set({
      email: 'support@product.example',
      emailCapability: 'receive_only',
      registrationEmail: 'owner@gmail.com',
      registrationEmailCapability: 'send_capable',
      verificationInboxEmail: 'owner@gmail.com',
      emailManagementUrl:
        'https://mail.google.com/mail/?authuser=owner%40gmail.com',
    })
    .where(eq(website.id, id));
  const claims = await Promise.all([claim(id), claim(id)]);
  assert.equal(claims[0].task?.id, claims[1].task?.id);
  const task = claims[0].task!;
  assert.equal(task.product.contact_email, 'support@product.example');
  assert.equal(task.product.contact_email_capability, 'receive_only');
  assert.equal(task.product.submission_email, `${id}@gmail.com`);
  assert.equal(task.product.registration_email, `${id}@gmail.com`);
  assert.equal(task.product.email, `${id}@gmail.com`);
  assert.equal(task.product.verification_inbox_email, `${id}@gmail.com`);
  assert.equal(task.product.email_capability, 'receive_only');
  assert.equal(task.product.registration_password, null);
  assert.equal(task.product.submission_identity_review_required, false);
  await reportResult(id, task.id, {
    worker_id: `${id}-worker`,
    lease_id: task.lease_id,
    status: 'needs_user',
    reason: 'captcha',
    needs_user: 'A CAPTCHA needs attention.',
  });
  await db()
    .update(website)
    .set({ googleLoginEmail: 'new-login@gmail.com' })
    .where(eq(website.id, id));
  await retryRecords(id, [task.id]);
  const retried = (await claim(id)).task!;
  assert.equal(retried.product.submission_email, `${id}@gmail.com`);
  assert.equal(retried.product.registration_email, 'new-login@gmail.com');
  assert.equal(retried.account_policy.requires_account_review, true);
  assert.equal(retried.account_policy.google_login_path, null);
  assert.equal(retried.product.contact_email, 'support@product.example');
});

test('public and legacy mailbox fields cannot replace a missing Google email', async () => {
  const id = await fixture();
  await db()
    .update(website)
    .set({
      email: 'support@first.example',
      emailCapability: 'receive_only',
      googleLoginEmail: null,
    })
    .where(eq(website.id, id));
  await db()
    .update(website)
    .set({
      email: 'hello@second.example',
      registrationEmail: 'support@second.example',
      registrationEmailCapability: 'receive_only',
      verificationInboxEmail: 'stale-inbox@example.test',
      emailManagementUrl: 'https://mail.example.test/old',
      googleLoginEmail: null,
    })
    .where(eq(website.id, `${id}-other`));
  const first = productOf(await requireWebsite(id, id));
  const second = productOf(await requireWebsite(id, `${id}-other`));
  for (const product of [first, second]) {
    assert.equal(product.registration_email, null);
    assert.equal(product.verification_method, 'unavailable');
    assert.equal(product.verification_inbox_email, null);
    assert.equal(product.email_management_url, null);
    assert.equal(product.email_capability, 'unknown');
  }
  assert.equal(first.contact_email, 'support@first.example');
  assert.equal(second.contact_email, 'hello@second.example');
  await assert.rejects(claim(id), { status: 409 });

  const fresh = await createWebsite(id, {
    url: 'https://third.example',
    shortDesc: 'New project',
    ownerEmail: 'owner@example.test',
  });
  assert.equal(fresh.email, '');
  assert.equal(productOf(fresh).contact_email, null);
  assert.ok(
    productOf(fresh).submission_readiness.missing_fields.includes('email')
  );
  assert.equal(fresh.registrationEmail, '');
  assert.equal(fresh.verificationInboxEmail, '');
  const saved = await updateWebsite(id, fresh.id, {
    ...fresh,
    email: 'team@third.example',
  });
  assert.equal(saved.email, 'team@third.example');
  assert.equal(productOf(saved).registration_email, null);
});

test('fresh tasks pin Gmail while unknown legacy identities require review', async () => {
  const id = await fixture();
  await db()
    .update(website)
    .set({
      email: 'support@product.example',
      registrationEmail: 'owner@gmail.com',
      verificationInboxEmail: 'forwarded@gmail.com',
    })
    .where(eq(website.id, id));
  await record(id, 'fresh', 'pending');
  const fresh = (await claim(id, { data_source: 'website' })).task!;
  assert.equal(fresh.product.submission_email, `${id}@gmail.com`);
  assert.equal(fresh.product.verification_inbox_email, `${id}@gmail.com`);
  await reportResult(id, fresh.id, {
    worker_id: `${id}-worker`,
    lease_id: fresh.lease_id,
    status: 'submitted',
    proof: 'Receipt for fresh listing',
  });
  await record(id, 'legacy', 'pending', {
    attemptCount: 1,
    proof: 'Existing support account draft',
  });
  const legacy = (await claim(id, { data_source: 'website' })).task!;
  assert.equal(legacy.product.submission_identity_review_required, true);
  assert.equal(legacy.product.submission_email, null);
  assert.equal(legacy.product.registration_email, `${id}@gmail.com`);
  assert.equal(legacy.product.email, `${id}@gmail.com`);
  assert.equal(legacy.account_policy.requires_account_review, true);
  assert.equal(legacy.account_policy.allow_logout, false);
  assert.equal(legacy.product.contact_email, 'support@product.example');
  assert.equal(legacy.proof, 'Existing support account draft');
});

test('mailbox settings reject invalid identities and survive older profile updates', async () => {
  const id = await fixture();
  const settings = {
    registrationEmail: 'owner@gmail.com',
    verificationInboxEmail: 'forwarded@gmail.com',
    registrationEmailCapability: 'send_capable',
  };
  for (const field of ['registrationEmail', 'verificationInboxEmail']) {
    assert.throws(
      () =>
        sanitizeWebsiteInput({
          url: 'https://product.example',
          [field]: 'not-an-email',
        }),
      /Invalid/
    );
  }
  assert.throws(
    () =>
      sanitizeWebsiteInput({
        url: 'https://product.example',
        registrationEmailCapability: 'yes',
      }),
    /Invalid/
  );
  await db().update(website).set(settings).where(eq(website.id, id));
  const w = await requireWebsite(id, id);
  const {
    registrationEmail: _a,
    verificationInboxEmail: _b,
    registrationEmailCapability: _c,
    ...oldBody
  } = w;
  const saved = await updateWebsite(id, id, oldBody);
  assert.equal(saved.registrationEmail, `${id}@gmail.com`);
  assert.equal(saved.verificationInboxEmail, `${id}@gmail.com`);
  const [stored] = await db().select().from(website).where(eq(website.id, id));
  assert.equal(stored.registrationEmail, settings.registrationEmail);
  assert.equal(stored.verificationInboxEmail, settings.verificationInboxEmail);
  assert.equal(productOf(saved).email_capability, 'receive_only');
  await assert.rejects(
    updateWebsite('someone-else', id, {
      ...w,
      registrationEmail: 'other@gmail.com',
    }),
    /not found/
  );
  assert.equal(
    (await requireWebsite(id, id)).registrationEmail,
    `${id}@gmail.com`
  );
});

test('company founding facts are optional, validated, and never inferred from product launch dates', async () => {
  const id = await fixture();
  const w = await requireWebsite(id, id);
  const launchOnly = await updateWebsite(id, id, {
    ...w,
    launchDate: '2026-11-17',
  });
  assert.equal(productOf(launchOnly).company.founded_year, null);
  assert.equal(productOf(launchOnly).company.headquarters.address, null);
  const updated = await updateWebsite(id, id, {
    ...launchOnly,
    metadata: [{ key: COMPANY_FOUNDED_YEAR_KEY, value: '2021' }],
    location: {
      country: 'United States',
      state: 'Washington',
      city: 'Seattle',
      address: 'User-provided real headquarters',
      zip: '98101',
    },
  });
  assert.equal(productOf(updated).company.founded_year, 2021);
  assert.equal(productOf(updated).company.headquarters.city, 'Seattle');
  assert.equal((await claim(id)).task?.product.company.founded_year, 2021);
  for (const value of [
    'unknown',
    '2026-11-17',
    String(new Date().getFullYear() + 1),
  ]) {
    assert.throws(
      () =>
        sanitizeWebsiteInput({
          ...updated,
          metadata: [{ key: COMPANY_FOUNDED_YEAR_KEY, value }],
        }),
      /founded year/
    );
  }
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

test('account blockers, full free queues and site errors preserve free enabled entries', async () => {
  const id = await fixture();
  for (const reason of [
    'captcha',
    'forbidden',
    'account',
    'missing_info',
    'reciprocal',
    'queue_full',
    'site_down',
  ] as const)
    await applyFailureReason(id, id, reason);
  assert.equal(
    (await db().select().from(backlink).where(eq(backlink.id, id)))[0].costType,
    'free'
  );
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

test('manual records cannot attach another user private entry or invent a running lease', async () => {
  const owner = await fixture();
  const other = await fixture();
  await assert.rejects(
    createRecord(other, {
      websiteId: other,
      targetUrl: 'https://directory.example.test/private',
      backlinkId: owner,
    }),
    (e: any) => e.status === 404
  );
  await assert.rejects(
    createRecord(other, {
      websiteId: other,
      targetUrl: 'https://directory.example.test/manual',
      operationStatus: 'in_progress',
    }),
    /lease/
  );
});

test('legacy orphaned running records become reviewable and heartbeat cannot resurrect them', async () => {
  const id = await fixture();
  await record(id, 'orphan', 'in_progress', {
    claimedBy: `${id}-worker`,
    leaseId: 'orphan',
    leaseExpiresAt: null,
  });
  assert.equal(
    (await getTask(id, `${id}-orphan`)).failure_reason,
    'lease_expired'
  );
  await assert.rejects(
    heartbeat(id, `${id}-orphan`, {
      worker_id: `${id}-worker`,
      lease_id: 'orphan',
    }),
    (e: any) => e.status === 409
  );
});

test('paid evidence from a public target filters that user only, with explicit opt-in', async () => {
  const id = await fixture('unknown');
  const other = await fixture();
  await db()
    .update(backlink)
    .set({ visibility: 'public', ownerUserId: null })
    .where(eq(backlink.id, id));
  await record(id, 'paid', 'needs_user', {
    websiteId: `${id}-other`,
    targetUrl: `https://directory.example.test/${id}`,
    failureReason: 'paid',
  });
  assert.equal((await claim(id, { data_source: 'plaza' })).task, null);
  assert.ok(
    (await claim(id, { data_source: 'plaza', include_paid: true })).task
  );
  assert.ok((await claim(other, { data_source: 'plaza' })).task);
  assert.equal(
    (await db().select().from(backlink).where(eq(backlink.id, id)))[0].costType,
    'unknown'
  );
});

for (const manual of [false, true]) {
  test(`website queue excludes paid history without excluding unrelated targets (${manual ? 'manual' : 'catalog'})`, async () => {
    const id = await fixture('unknown');
    const targetUrl = `https://directory.example.test/${id}/paid-target`;
    await record(id, 'paid-history', 'needs_user', {
      websiteId: `${id}-other`,
      targetUrl,
      failureReason: 'paid',
    });
    await record(id, 'paid-candidate', 'pending', {
      backlinkId: manual ? null : id,
      targetUrl,
      createdAt: new Date(0),
    });
    await record(id, 'free-candidate', 'pending', {
      backlinkId: manual ? null : id,
    });
    const result = await claim(id, { data_source: 'website' });
    assert.equal(result.task?.id, `${id}-free-candidate`);
    const [paid] = await db()
      .select()
      .from(websiteBacklink)
      .where(eq(websiteBacklink.id, `${id}-paid-candidate`));
    assert.equal(paid.operationStatus, 'pending');
    assert.equal(paid.attemptCount, 0);
    const optIn = await claim(id, {
      data_source: 'website',
      worker_id: `${id}-paid-worker`,
      include_paid: true,
    });
    assert.equal(optIn.task?.id, `${id}-paid-candidate`);
  });
}
