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

test('each generated command uses its selected task scope and adds a category only when selected', () => {
  const scopes = ['recommended', 'all_eligible'] as const;
  for (const taskScope of scopes) {
    for (const category of ['all', 'directory']) {
      const primary = buildPrimaryPrompt({ ...options, taskScope, category });
      const copied = buildAgentInstructions({ baseUrl, primary, custom: '' });
      const example = copied.match(
        /POST \/api\/v1\/backlink-tasks\/start[^\n]*\n\n```json\n([\s\S]*?)\n```/
      )?.[1];
      assert.ok(example);
      assert.deepEqual(JSON.parse(example), {
        worker_id: 'codex-<uuid>',
        website_id: options.websiteId,
        data_source: options.dataSource,
        task_scope: taskScope,
        include_paid: false,
        ...(category === 'all' ? {} : { category }),
      });
      assert.equal(copied.match(/"task_scope":/g)?.length, 1);
    }
  }
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
        `【注册身份与公开联系邮箱】\n本网站复制命令时的 Google 登录邮箱为 \`${googleLoginEmail}\``
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

test('copying a command uses one project Google email for all login and verification steps', () => {
  const googleLoginEmail = 'project-login@gmail.com';
  const account = {
    websiteId: options.websiteId,
    googleLoginEmail,
  };
  const copied = buildAgentInstructions({
    baseUrl,
    primary: buildPrimaryPrompt({ ...options, ...account }),
    custom: '',
    ...account,
  });
  assert.match(
    copied.split('\n')[1],
    /project-login@gmail\.com.*用于注册、登录和查收验证码/
  );
  assert.equal(copied.split(googleLoginEmail).length - 1, 1);
  assert.match(
    copied,
    /login_email、google_login_email 和 verification_inbox_email 必须是同一个已配置的地址/
  );
  assert.match(copied, /自动选择模式由服务端筛选已填 Google 邮箱的项目/);
  assert.match(copied, /missing_google_login_email/);
  assert.ok(!buildApiDoc(baseUrl).includes(googleLoginEmail));
  assert.doesNotMatch(copied, /Outlook|verification_method=outlook/);
});

test('Google login selects the configured signed-in account and handles the actual OAuth page', () => {
  const instructions = buildSubmissionIdentityInstructions();
  assert.match(
    instructions,
    /只支持 Google，或普通邮箱入口要求密码且无可用凭据时/
  );
  assert.match(
    instructions,
    /打开头像菜单，等列表加载后检查所有已登录账号.*与 google_login_email 完全一致.*核对切换后的页面或新标签页/
  );
  assert.match(instructions, /默认账号不同不能直接判定无会话/);
  assert.match(instructions, /菜单持续加载记录为会话检查超时/);
  assert.match(
    instructions,
    /点外站 Google 按钮前先 POST google_login_path.*核对返回邮箱/
  );
  assert.match(
    instructions,
    /同时检查原标签页跳转和新弹出的 Google 账号选择页/
  );
  assert.match(instructions, /返回外站后核实站内账号邮箱/);
  assert.match(instructions, /没有发起授权且无既有提交时.*再试一次/);
  assert.match(instructions, /外站旧会话、绑定拒绝、授权页未打开或回跳失败/);
  assert.match(instructions, /回传成功且未达到上限时，下一步直接调用 start/);
});

test('Gmail preflight verifies the visible active address before falling back to the account menu', () => {
  const instructions = buildSubmissionIdentityInstructions();
  const match = instructions.match(
    /await gmail\.waitForFunction\((.+), account_policy\.google_login_email, \{ timeout: 15000 \}\)/
  );
  assert.ok(match);
  assert.match(
    instructions,
    /先在当前 Ego 任务空间用 account_policy\.mailbox_url 直达指定邮箱/
  );
  assert.ok(
    instructions.indexOf(match[0]) <
      instructions.indexOf('https://myaccount.google.com/')
  );

  const compileCheck = new Function(
    'document',
    'location',
    `return ${match[1]};`
  );
  const badge = (label: string, visible = true) => ({
    getAttribute: () => label,
    getClientRects: () => (visible ? [1] : []),
  });
  const check = (
    nodes: ReturnType<typeof badge>[],
    origin = 'https://mail.google.com'
  ) =>
    compileCheck(
      { querySelectorAll: () => nodes },
      { origin }
    )('team@gmail.com');

  assert.equal(check([badge('Google 账号： Team (TEAM@gmail.com)')]), true);
  assert.equal(
    check([badge('Google Account: Different (newteam@gmail.com)')]),
    false
  );
  assert.equal(
    check([badge('Google Account: Team (team@gmail.com)', false)]),
    false
  );
  assert.equal(check([badge('Message from team@gmail.com')]), false);
  assert.equal(
    check(
      [badge('Google Account: Team (team@gmail.com)')],
      'https://example.test'
    ),
    false
  );
});

test('a stale target session is checked for an official switch without logging out other accounts', () => {
  const instructions = buildSubmissionIdentityInstructions();
  assert.match(instructions, /站内账户页核对完整邮箱.*官方“切换账号”/);
  assert.match(
    instructions,
    /若只能注销旧账号后切换.*保留外站及 Google 的现有会话/
  );
});

test('Gmail account readiness is checked before requesting a code and has a bounded recovery', () => {
  const instructions = buildSubmissionIdentityInstructions();
  assert.match(
    instructions,
    /用 mailbox_url 直达 Gmail 并核对完整邮箱与 verification_inbox_email 一致/
  );
  assert.match(
    instructions,
    /从头像菜单选择已登录的匹配邮箱，并核对切换后的页面/
  );
  assert.match(instructions, /最多等 30 秒.*同一会话刷新一次/);
  assert.match(
    instructions,
    /查收件箱和垃圾邮件，按目标站发件方、收件地址和请求时间匹配/
  );
  assert.match(instructions, /目标站表单标签页一直保留/);
  assert.match(instructions, /搜索结果持续加载.*查看收件箱和垃圾邮件/);
  assert.match(instructions, /最多约 3 分钟，避免重复请求验证码/);
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
      assert.ok(instructions.includes('下一步直接调用 start 领取下一条'));
      assert.ok(
        instructions.includes(
          '不要要求用户登录 Google、交接浏览器或等待用户回复'
        )
      );
      assert.ok(
        instructions.includes('submission_identity_review_required=true')
      );
      assert.ok(instructions.startsWith(buildSubmissionIdentityInstructions()));
      assert.ok(instructions.includes('unavailable'));
      assert.ok(instructions.includes('无需登录或支持普通邮箱的免费入口'));
      assert.doesNotMatch(instructions, /wldesign1983|共享 Gmail/i);
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
  assert.ok(updated.includes('保留外站及 Google 的现有会话'));
  assert.equal(upgradeSubmissionIdentityPrompt(updated), updated);
});

test('saved jobs replace obsolete Google API directions and keep following sections', () => {
  const old =
    '## 使用已授权的 Google 账号\n\n只支持 Google 登录的站点。\n请始终选默认账号。\n\n## 查询任务\n\n保留原任务查询说明。';
  const updated = upgradeSubmissionIdentityPrompt(old);
  assert.doesNotMatch(updated, /请始终选默认账号/);
  assert.match(
    updated,
    /## 使用已授权的 Google 账号\n\n按“注册身份与公开联系邮箱”/
  );
  assert.match(updated, /## 查询任务\n\n保留原任务查询说明/);
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
    'blocked/no_entry',
    'skipped/forbidden',
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
