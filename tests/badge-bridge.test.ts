import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { eq } from 'drizzle-orm';

import type { WebsiteBacklink } from '../src/config/db/schema';

const directory = await mkdtemp(join(tmpdir(), 'badge-bridge-'));
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${directory}/test.db`,
  CONFIG_ENCRYPTION_KEY: 'isolated-bridge-encryption-test',
  AUTH_SECRET: 'isolated-test-only',
  BACKLINK_BADGE_ALLOWED_HOSTS: 'product.example.test,other.example.test',
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
let dispose: (() => Promise<void>) | undefined;
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
  dispose = proxy.dispose;
}
const { db } = await import('../src/core/db');
const s = await import('../src/config/db/schema');
const {
  connectBadges,
  disconnectBadges,
  badgeConnectionStatus,
  installBadgeForTask,
} = await import('../src/server/backlinks/badge-bridge');
const { badgeConnectionKey } =
  await import('../src/modules/badge-connections/service');
const { getAdminConfigs, getCustomConfigs, replaceCustomConfigs, saveConfigs } =
  await import('../src/modules/config/service');
const { startTask } = await import('../src/modules/backlinks/tasks');
const { retryBadgeBlockedRecords } =
  await import('../src/modules/backlinks/records');
const { parseOfficialBadge, badgeIsPublic } =
  await import('../src/server/backlinks/badge-markup');
const { allowedBadgeOrigin } = await import('../src/lib/badge-bridge-policy');
after(async () => {
  await dispose?.();
  await rm(directory, { recursive: true, force: true });
});
const token = 'bbg_' + 'a'.repeat(43);
const html =
  '<a href="https://directory.example.test/?a=1&amp;b=2" data-proof="required">Official badge</a>';
let seq = 0;
async function fixture() {
  const id = `bridge-${++seq}`;
  await db()
    .insert(s.user)
    .values({ id, email: `${id}@example.test`, name: id });
  await db().insert(s.website).values({
    id,
    userId: id,
    name: id,
    url: 'https://product.example.test',
    shortDesc: 'A test product',
  });
  await db().insert(s.websiteBacklink).values({
    id,
    userId: id,
    websiteId: id,
    sourceUrl: 'https://product.example.test',
    sourceDomain: 'product.example.test',
    targetUrl: 'https://directory.example.test/',
    targetDomain: 'directory.example.test',
  });
  const task = (
    await startTask(id, {
      worker_id: id,
      website_id: id,
      task_scope: 'all_eligible',
    })
  ).task!;
  return { id, task, body: { worker_id: id, lease_id: task.lease_id, html } };
}
function remote(publicHtml = html) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/api/integrations/footer-badges')) {
      const body = JSON.parse(String(init?.body));
      return Response.json({
        code: 0,
        data: {
          protocol: 'backlora-badges-v1',
          scope: 'footer_badges:add',
          site_origin: new URL(url).origin,
          ...(body.action === 'add'
            ? { installed: true, href: body.badge.href }
            : {}),
        },
      });
    }
    return new Response(publicHtml, {
      headers: { 'content-type': 'text/html' },
    });
  };
  return { calls, fetcher };
}

test('parses official metadata and checks actual public HTML, not script/template lookalikes', () => {
  const badge = parseOfficialBadge(html);
  assert.equal(badge.attributes?.['data-proof'], 'required');
  assert.ok(badgeIsPublic(html, badge, 'https://product.example.test'));
  for (const fake of [
    `<script>${html}</script>`,
    `<template>${html}</template>`,
    `<div hidden>${html}</div>`,
    html.replace('data-proof="required"', ''),
  ])
    assert.equal(
      badgeIsPublic(fake, badge, 'https://product.example.test'),
      false
    );
  for (const unsafe of [
    '<script>alert(1)</script>' + html,
    '<a href="javascript:alert(1)">bad</a>',
    '<a href="https://directory.example.test" onclick="alert(1)">bad</a>',
  ])
    assert.throws(() => parseOfficialBadge(unsafe));
});

test('host allowlist rejects userinfo, non-HTTPS, private hosts and alternate ports', () => {
  for (const url of [
    'http://product.example.test',
    'https://product.example.test:444',
    'https://user:pass@product.example.test',
    'https://127.0.0.1',
    'https://product.example.test.evil.test',
  ])
    assert.throws(() => allowedBadgeOrigin(url, 'product.example.test'));
});

test('connection is encrypted, write-only and isolated from other users and custom settings', async () => {
  const { id } = await fixture();
  const mock = remote();
  await assert.rejects(
    connectBadges('other-user', id, token, mock.fetcher),
    (e: any) => e.status === 404
  );
  assert.equal(mock.calls.length, 0);
  await connectBadges(id, id, token, mock.fetcher);
  const key = badgeConnectionKey(id);
  const row = (
    await db().select().from(s.config).where(eq(s.config.name, key))
  )[0];
  assert.ok(row.value.startsWith('enc:v1:'));
  assert.ok(!row.value.includes(token));
  assert.ok(
    !JSON.stringify(await badgeConnectionStatus(id, id)).includes(token)
  );
  assert.equal((await getAdminConfigs())[key], undefined);
  assert.ok(!(await getCustomConfigs()).some((r) => r.key === key));
  await saveConfigs({ [key]: 'attempted-overwrite' });
  await replaceCustomConfigs([]);
  assert.equal((await badgeConnectionStatus(id, id)).ready, true);
  await assert.rejects(
    disconnectBadges('other-user', id),
    (e: any) => e.status === 404
  );
  await disconnectBadges(id, id);
  assert.equal((await badgeConnectionStatus(id, id)).configured, false);
});

test('connect fails closed without encryption or a matching site capability', async () => {
  const { id } = await fixture();
  const key = process.env.CONFIG_ENCRYPTION_KEY;
  delete process.env.CONFIG_ENCRYPTION_KEY;
  try {
    await assert.rejects(
      connectBadges(id, id, token, remote().fetcher),
      /encryption/
    );
  } finally {
    process.env.CONFIG_ENCRYPTION_KEY = key;
  }
  await assert.rejects(
    connectBadges(id, id, token, async () =>
      Response.json({ code: 0, data: { site_origin: 'https://evil.test' } })
    ),
    /capability/
  );
  assert.equal((await badgeConnectionStatus(id, id)).configured, false);
});

test('installation requires the correct live lease and does not forward secrets during public verification', async () => {
  const { id, task, body } = await fixture();
  const mock = remote();
  await connectBadges(id, id, token, mock.fetcher);
  mock.calls.length = 0;
  await assert.rejects(
    installBadgeForTask('other-user', task.id, body, mock.fetcher)
  );
  await assert.rejects(
    installBadgeForTask(
      id,
      task.id,
      { ...body, lease_id: 'wrong' },
      mock.fetcher
    )
  );
  assert.equal(mock.calls.length, 0);
  const result = await installBadgeForTask(id, task.id, body, mock.fetcher);
  assert.equal(result.publicly_verified, true);
  assert.ok(!JSON.stringify(result).includes(token));
  assert.equal(
    new Headers(mock.calls[0].init?.headers).get('authorization'),
    `Bearer ${token}`
  );
  assert.equal(
    new Headers(mock.calls[1].init?.headers).get('authorization'),
    null
  );
  await db()
    .update(s.websiteBacklink)
    .set({ leaseExpiresAt: new Date(0) })
    .where(eq(s.websiteBacklink.id, task.id));
  const before = mock.calls.length;
  await assert.rejects(
    installBadgeForTask(id, task.id, body, mock.fetcher),
    (e: any) => e.status === 409
  );
  assert.equal(mock.calls.length, before);
});

test('changing website origin or redirecting the endpoint cannot leak a saved credential', async () => {
  const { id, task, body } = await fixture();
  const mock = remote();
  await connectBadges(id, id, token, mock.fetcher);
  await db()
    .update(s.website)
    .set({ url: 'https://other.example.test' })
    .where(eq(s.website.id, id));
  mock.calls.length = 0;
  await assert.rejects(
    installBadgeForTask(id, task.id, body, mock.fetcher),
    /origin changed/
  );
  assert.equal(mock.calls.length, 0);
  await db()
    .update(s.website)
    .set({ url: 'https://product.example.test' })
    .where(eq(s.website.id, id));
  let calls = 0;
  await assert.rejects(
    installBadgeForTask(id, task.id, body, async (_url, init) => {
      calls++;
      assert.equal(init?.redirect, 'manual');
      return new Response(null, {
        status: 302,
        headers: { location: 'https://evil.test/' },
      });
    }),
    /redirected/
  );
  assert.equal(calls, 1);
});

test('saved but not publicly rendered is not reported as verified', async () => {
  const { id, task, body } = await fixture();
  const mock = remote(`<script type="application/json">${html}</script>`);
  await connectBadges(id, id, token, mock.fetcher);
  const result = await installBadgeForTask(id, task.id, body, mock.fetcher);
  assert.equal(result.installed, true);
  assert.equal(result.publicly_verified, false);
  assert.equal(result.stage, 'saved_not_public');
});

test('concurrent connection writes remain encrypted and preserve a valid connection', async () => {
  const { id } = await fixture();
  const mock = remote();
  await Promise.all(
    Array.from({ length: 4 }, () => connectBadges(id, id, token, mock.fetcher))
  );
  assert.equal((await badgeConnectionStatus(id, id)).ready, true);
  const rows = await db()
    .select()
    .from(s.config)
    .where(eq(s.config.name, badgeConnectionKey(id)));
  assert.equal(rows.length, 1);
  assert.ok(rows[0].value.startsWith('enc:v1:'));
});

test('delayed public rendering can be rechecked without another write or credential transmission', async () => {
  const { id, task, body } = await fixture();
  const mock = remote('Not rendered yet');
  await connectBadges(id, id, token, mock.fetcher);
  const saved = await installBadgeForTask(id, task.id, body, mock.fetcher);
  assert.equal(saved.stage, 'saved_not_public');
  mock.calls.length = 0;
  const missing = await installBadgeForTask(
    id,
    task.id,
    { ...body, verify_only: true },
    mock.fetcher
  );
  assert.equal(missing.stage, 'not_public');
  assert.equal(missing.installed, false);
  const visible = remote();
  const found = await installBadgeForTask(
    id,
    task.id,
    { ...body, verify_only: true },
    visible.fetcher
  );
  assert.equal(found.installed, true);
  assert.equal(found.publicly_verified, true);
  for (const call of [...mock.calls, ...visible.calls]) {
    assert.equal(call.url, 'https://product.example.test/');
    assert.equal(new Headers(call.init?.headers).get('authorization'), null);
    assert.equal(call.init?.body, undefined);
  }
});

test('API rejects foreign origins and malformed bodies and returns recoverable failure stages', async () => {
  const { badgeApi, requireSameOrigin, readBadgeRequest } =
    await import('../src/server/backlinks/badge-api');
  const { BadgeBridgeError } = await import('../src/lib/badge-bridge-policy');
  assert.throws(() =>
    requireSameOrigin(
      new Request('https://backlora.example.test/api/connect', {
        headers: { Origin: 'https://evil.test' },
      })
    )
  );
  requireSameOrigin(
    new Request('https://backlora.example.test/api/connect', {
      headers: { Origin: 'https://backlora.example.test' },
    })
  );
  for (const body of [
    'null',
    '[]',
    '{broken',
    JSON.stringify({ html: 'x'.repeat(30_000) }),
  ]) {
    const response = await badgeApi(() =>
      readBadgeRequest(
        new Request('https://backlora.example.test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        })
      )
    );
    assert.equal(response.status, 400);
  }
  const response = await badgeApi(async () => {
    throw new BadgeBridgeError('credential', 'Reconnect website');
  });
  assert.equal((await response.json()).data.stage, 'credential');
  const limited = await badgeApi(
    async () => new Response('Rate limited', { status: 429 })
  );
  assert.equal(limited.status, 429);
  const hidden = await badgeApi(async () => {
    throw new Error('SQL credentials ' + token);
  });
  assert.equal(hidden.status, 500);
  assert.ok(!(await hidden.text()).includes(token));
});

test('verified connection requeues only its reciprocal blockers and preserves prior submission evidence', async () => {
  const { id } = await fixture();
  const proof =
    'Listing already received; finish the required badge check without resubmitting.';
  await db()
    .update(s.websiteBacklink)
    .set({
      operationStatus: 'needs_user',
      failureReason: 'reciprocal',
      proof,
      resultUrl: 'https://directory.example.test/review',
      needsUser: 'Old badge access blocker',
      leaseExpiresAt: null,
    })
    .where(eq(s.websiteBacklink.id, id));
  for (const [suffix, status, reason] of [
    ['captcha', 'needs_user', 'captcha'],
    ['submitted', 'submitted', 'reciprocal'],
    ['running', 'in_progress', 'reciprocal'],
  ] as const) {
    await db()
      .insert(s.websiteBacklink)
      .values({
        id: `${id}-${suffix}`,
        userId: id,
        websiteId: id,
        sourceUrl: 'https://product.example.test',
        sourceDomain: 'product.example.test',
        targetUrl: `https://${suffix}.example.test/`,
        targetDomain: `${suffix}.example.test`,
        operationStatus: status,
        failureReason: reason,
      });
  }
  await assert.rejects(
    connectBadges(id, id, token, async () => new Response('', { status: 503 }))
  );
  assert.equal(
    (
      await db()
        .select()
        .from(s.websiteBacklink)
        .where(eq(s.websiteBacklink.id, id))
    )[0].operationStatus,
    'needs_user'
  );
  const result = await connectBadges(id, id, token, remote().fetcher);
  assert.equal(result.requeued_tasks, 1);
  const rows: WebsiteBacklink[] = await db()
    .select()
    .from(s.websiteBacklink)
    .where(eq(s.websiteBacklink.websiteId, id));
  const recovered = rows.find((r) => r.id === id)!;
  assert.equal(recovered.operationStatus, 'pending');
  assert.equal(recovered.proof, proof);
  assert.equal(recovered.resultUrl, 'https://directory.example.test/review');
  assert.equal(recovered.needsUser, 'Old badge access blocker');
  assert.equal(recovered.claimedBy, null);
  assert.equal(recovered.leaseId, null);
  assert.equal(
    rows.find((r) => r.id === `${id}-captcha`)!.operationStatus,
    'needs_user'
  );
  assert.equal(
    rows.find((r) => r.id === `${id}-submitted`)!.operationStatus,
    'submitted'
  );
  assert.equal(
    rows.find((r) => r.id === `${id}-running`)!.operationStatus,
    'in_progress'
  );
});

test('badge recovery is ownership-scoped, respects disabled projects, and concurrent calls recover once', async () => {
  const { id } = await fixture();
  const other = await fixture();
  await db()
    .update(s.websiteBacklink)
    .set({
      operationStatus: 'needs_user',
      failureReason: 'reciprocal',
      leaseExpiresAt: null,
    })
    .where(eq(s.websiteBacklink.id, id));
  assert.equal(await retryBadgeBlockedRecords(other.id, id), 0);
  await db()
    .update(s.website)
    .set({ autoBacklinkEnabled: false })
    .where(eq(s.website.id, id));
  assert.equal(await retryBadgeBlockedRecords(id, id), 0);
  await db()
    .update(s.website)
    .set({ autoBacklinkEnabled: true })
    .where(eq(s.website.id, id));
  const counts = await Promise.all([
    retryBadgeBlockedRecords(id, id),
    retryBadgeBlockedRecords(id, id),
  ]);
  assert.equal(
    counts.reduce((a, b) => a + b, 0),
    1
  );
  assert.equal(await retryBadgeBlockedRecords(id, id), 0);
});

test('credential generator creates a private file without printing secrets or overwriting credentials', async () => {
  const path = join(directory, 'private-credential.json');
  const args = ['scripts/create-badge-credential.mjs', '--output', path];
  const output = execFileSync(process.execPath, args, { encoding: 'utf8' });
  const content = await readFile(path, 'utf8');
  const value = JSON.parse(content);
  assert.match(value.token, /^bbg_[A-Za-z0-9_-]{43}$/);
  assert.equal(
    value.FOOTER_BADGE_AUTOMATION_TOKEN_HASH,
    createHash('sha256').update(value.token).digest('hex')
  );
  assert.ok(!output.includes(value.token));
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.throws(() => execFileSync(process.execPath, args, { stdio: 'pipe' }));
  assert.equal(await readFile(path, 'utf8'), content);
});
