import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildAgentInstructions,
  buildApiDoc,
  buildBadgeCopyInstructions,
  buildPrimaryPrompt,
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
