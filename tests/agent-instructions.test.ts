import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildAgentInstructions,
  buildApiDoc,
  buildBadgeCopyInstructions,
  buildPrimaryPrompt,
  buildSubmissionIdentityInstructions,
  buildSubmissionRecoveryInstructions,
  upgradeSubmissionIdentityPrompt,
  upgradeSubmissionRecoveryPrompt,
} from '../src/routes/dashboard/-agent-prompt';

const baseUrl = 'https://backlora.example';
const options = {
  baseUrl,
  apiKey: 'test-only-key',
  websiteId: 'new-project-with-no-existing-schedule',
  dataSource: 'website' as const,
  category: 'all',
  num: 10,
  taskScope: 'recommended' as const,
  container: 'ego-browser' as const,
};

function assertBadgeFlow(text: string, origin = baseUrl) {
  assert.equal(text.split('【徽章代码获取：无需剪贴板权限】').length - 1, 1);
  assert.ok(text.includes(`${origin}/agent/badge-embed.mjs`));
  assert.ok(text.includes('禁止调用 navigator.clipboard.readText()/read()'));
  assert.ok(text.includes('page.evaluate(captureBadgeEmbed'));
  assert.ok(text.includes('POST /api/v1/backlink-tasks/{task_id}/badge'));
  assert.ok(text.includes('publicly_verified'));
  assert.ok(text.includes('不能换空间、改权限或自动夺回控制'));
}

test('new project and auto-selected project receive the badge flow in every runner', () => {
  for (const container of [
    'ego-browser',
    'chrome-devtools-mcp',
    'playwright',
    'codex-browser',
  ] as const) {
    for (const websiteId of [options.websiteId, null]) {
      const primary = buildPrimaryPrompt({ ...options, container, websiteId });
      const full = buildAgentInstructions({
        baseUrl,
        primary,
        custom: '只处理免费机会。',
      });
      assertBadgeFlow(full);
      assert.ok(full.includes('只处理免费机会。'));
      assert.ok(
        full.includes(websiteId ?? '自动选择（调用 start 时省略 website_id）')
      );
    }
  }
});

test('old, manually edited and empty primary prompts still include the current procedure', () => {
  for (const primary of [
    '旧模板：处理我的新项目。',
    '自定义主提示词：使用现有邮箱登录。',
    '',
  ]) {
    const full = buildAgentInstructions({
      baseUrl,
      primary,
      custom: '保留产品说明。',
    });
    assertBadgeFlow(full);
    assert.ok(full.includes(primary));
    assert.ok(full.includes('保留产品说明。'));
  }
});

test('standalone API contract includes the same complete procedure without credentials', () => {
  const doc = buildApiDoc(baseUrl);
  assertBadgeFlow(doc);
  assert.ok(doc.includes(buildBadgeCopyInstructions(baseUrl)));
  assert.ok(!doc.includes(options.apiKey));
});

test('a selected project includes its configured Google address in the copied identity section', () => {
  const googleLoginEmail = 'work@example.test';
  const account = { websiteId: options.websiteId, googleLoginEmail };
  const primary = buildPrimaryPrompt({ ...options, ...account });
  assert.ok(primary.includes(googleLoginEmail));
  for (const text of [primary, '手动编辑的主命令']) {
    const copied = buildAgentInstructions({
      baseUrl,
      primary: text,
      custom: '',
      ...account,
    });
    assert.ok(
      copied.startsWith(
        `【注册身份与公开联系邮箱】\n本网站授权的 Google 登录账号为 \`${googleLoginEmail}\``
      )
    );
    assert.equal(copied.split(googleLoginEmail).length - 1, 1);
  }
  assert.ok(!buildApiDoc(baseUrl).includes(googleLoginEmail));
  assert.ok(
    !buildPrimaryPrompt({ ...options, ...account, websiteId: null }).includes(
      googleLoginEmail
    )
  );
});

test('all runners and edited prompts retain separate login, inbox and public-contact rules', () => {
  for (const container of [
    'ego-browser',
    'chrome-devtools-mcp',
    'playwright',
    'codex-browser',
  ] as const) {
    const primary = buildPrimaryPrompt({ ...options, container });
    for (const prompt of [primary, '旧模板：用产品邮箱登录。', '']) {
      const instructions = buildAgentInstructions({
        baseUrl,
        primary: prompt,
        custom: '',
      });
      assert.equal(
        instructions.split('【注册身份与公开联系邮箱】').length - 1,
        1
      );
      assert.ok(instructions.includes(buildSubmissionIdentityInstructions()));
      assert.ok(instructions.includes('product.contact_email'));
      assert.ok(instructions.includes('product.submission_email'));
      assert.ok(instructions.includes('verification_inbox_email'));
      assert.ok(instructions.includes('google_login_path'));
      assert.ok(
        instructions.includes('submission_identity_review_required=true')
      );
      assert.ok(instructions.startsWith(buildSubmissionIdentityInstructions()));
      assert.ok(instructions.includes('unavailable'));
      assert.ok(instructions.includes('无需登录和邮箱验证'));
      assert.doesNotMatch(
        instructions,
        /wldesign1983|mail\.google\.com|共享 Gmail/i
      );
    }
  }
});

test('saved-job upgrade removes conflicting account rules and preserves credentials and limits', () => {
  const old = `VectorMint\n- API Key: test-only-placeholder\n最多处理 7 个任务\n4. 目标站登录前核对当前账号邮箱；只有产品邮箱没有 Google 身份时记录 account。\n4. 在目标站登录和注册只能用 product.email 这一个邮箱；账号不一致时注销。\n保留草稿和结果证据。`;
  const updated = upgradeSubmissionIdentityPrompt(old);
  assert.ok(!updated.includes('只能用 product.email'));
  assert.ok(!updated.includes('账号不一致时注销'));
  assert.ok(!updated.includes('产品邮箱没有 Google 身份'));
  assert.ok(updated.includes('test-only-placeholder'));
  assert.ok(updated.includes('最多处理 7 个任务'));
  assert.ok(updated.includes('Gravatar'));
  assert.ok(updated.includes('保留现有会话并记录 account'));
  assert.equal(upgradeSubmissionIdentityPrompt(updated), updated);
});

test('failure recovery distinguishes official partner badges, eligibility, free queues and remote database errors', () => {
  const original = buildAgentInstructions({
    baseUrl,
    primary: '最多处理 10 个任务；不得付款。',
    custom: '',
  });
  const updated = upgradeSubmissionRecoveryPrompt(original);
  assert.equal(upgradeSubmissionRecoveryPrompt(updated), updated);
  assert.equal(updated.split('【提交预检与失败恢复】').length - 1, 1);
  assert.equal(updated.split('【注册身份与公开联系邮箱】').length - 1, 1);
  assert.ok(updated.includes(buildSubmissionRecoveryInstructions()));
  assert.ok(
    buildApiDoc(baseUrl).includes(buildSubmissionRecoveryInstructions())
  );
  for (const requirement of [
    'confirmed_no_prior_account',
    'product.metadata.company_founded_year',
    '不能随机生成地址',
    'British Columbia',
    'https://dokeyai.com/submit',
    'queue_full',
    'RLS',
    '不重新发送',
  ]) {
    assert.ok(updated.includes(requirement));
  }
  assert.ok(updated.includes('最多处理 10 个任务；不得付款。'));
});

test('server-rendered dialog can generate instructions before the browser origin exists', () => {
  const primary = buildPrimaryPrompt({ ...options, baseUrl: '' });
  const full = buildAgentInstructions({ baseUrl: '', primary, custom: '' });
  assertBadgeFlow(full, '');
  assert.ok(!full.includes('undefined'));
});

test('separate deployments generate their own helper URL and keep the current procedure once', () => {
  const origin = 'https://another-backlora.example';
  const primary = buildPrimaryPrompt({ ...options, baseUrl: origin });
  const full = buildAgentInstructions({ baseUrl: origin, primary, custom: '' });
  assertBadgeFlow(full, origin);
  assert.ok(!full.includes(baseUrl));
});
