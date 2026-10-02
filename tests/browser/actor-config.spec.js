import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN } from './mock-origin.js';

// 成员的各层、全局 key 页、ui.form 往返。mock 的 actor-config 场景里 c0.project 有
// 三个成员条目：缺全局 key、业务层卡住的 agent（deepseek）；连不上端点、正在重试
// 的 tool（search-tool）；还有一个占位（service.api_key）没填、构建已停下、所以不
// 在名册上的 agent（writer）。另预置一把全局 key global/openai_prod。
// c0 的成员是平台固定的，成员条目的编辑都在 c0.project 里做。

async function reset(request, seed) {
  const response = await request.post(`${MOCK_ORIGIN}/mock/control/reset`, { data: { scenario: 'actor-config', seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

async function enterProject(page) {
  await page.getByRole('button', { name: /c0\.project/ }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
}

async function mockState(request) {
  const response = await request.get(`${MOCK_ORIGIN}/mock/control/state`);
  expect(response.ok()).toBe(true);
  return response.json();
}

// 按条目的显示名找到它这一台的配置（测试里方便；配置只按配置 id / 条目 id 存）。
function configOf(state, channelId, name) {
  const entry = state.descriptions[channelId].body.members.find((row) => row.name === name);
  return state.member_configs.find((row) => row.channel_id === channelId && row.entry_id === entry?.id);
}

function captureSubmits(page) {
  const submits = [];
  page.on('websocket', (socket) => socket.on('framesent', (event) => {
    try {
      const frame = JSON.parse(String(event.payload));
      if (frame?.frame_type === 'submit' && frame.payload?.msg_type) submits.push(frame.payload);
    } catch { /* not a protocol frame */ }
  }));
  return submits;
}

// 合成后的值表：键 → [值, 来自]。
async function sourceTable(detail) {
  const rows = await detail.getByRole('region', { name: '合成后的值' }).locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())));
  return Object.fromEntries(rows.map(([key, value, from]) => [key, [value, from]]));
}


const sha256 = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('one state: a member that did not start reads unbuilt, with no layer or reason; a built one reads bound', async ({ page, request }) => {
  const submits = captureSubmits(page);
  await reset(request, 2901);
  await login(page);
  await enterProject(page);
  await page.getByRole('button', { name: '成员', exact: true }).first().click();
  const roster = page.getByRole('complementary', { name: '频道成员' });
  // 对外只有"建好了没有"（owner 09-30）：起不来的成员只是没建好，原因在它自己里面。
  const stuck = roster.getByRole('button', { name: /deepseek/ });
  await expect(stuck).toContainText('未绑定');
  await expect(stuck).toContainText('actor d-deepseek@1');
  await expect(stuck).not.toContainText('卡住');
  await expect(stuck).not.toContainText('业务层');
  await expect(roster.getByRole('button', { name: /search-tool/ })).toContainText('未绑定');
  const ready = roster.getByRole('button', { name: /project-agent/ });
  await expect(ready).toContainText('已绑定');
  // writer 的占位没填、构建失败：它不在名册上。
  await expect(roster.getByRole('button', { name: /writer/ })).toHaveCount(0);

  await stuck.click();
  const detail = page.getByRole('complementary', { name: 'Actor 详情' });
  await expect(detail.getByRole('region', { name: '运行状态' })).toHaveCount(0);

  // 各层按需读（手动挡）：打开详情不发 member.get。读到的是引用不是值。
  expect(submits.filter((payload) => payload.msg_type === 'system.member.get')).toHaveLength(0);
  await detail.getByRole('button', { name: '读取配置' }).click();
  await expect(detail.locator('.member-config-facts')).toContainText('Actor 描述 d-deepseek@1');
  // 起不来的那次构建只有"开始"回执，没有失败回执（owner 09-30：不补回执）。
  await expect(detail.locator('.member-build')).toContainText('构建中');
  expect((await sourceTable(detail)).api_key).toEqual(['$global.deepseek_prod', 'Actor 描述']);
  await expect(detail.getByText(/\$global\. 开头的是对 global\/<名称> 的引用/)).toBeVisible();

  // 这一台的配置：插入全局 key 引用把缺的 key 换掉。值写进去时不检查：温度 9
  // 被 class 拒绝，成员还是起不来，对外仍只是没建好。
  await detail.getByRole('button', { name: '编辑配置' }).click();
  const editor = detail.getByRole('form', { name: '编辑成员配置' });
  await expect(editor.getByRole('option', { name: 'openai_prod' })).toBeAttached();
  await editor.getByLabel('成员配置 JSON').fill('{"temperature":9,"api_key":}');
  await editor.getByLabel('成员配置 JSON').evaluate((element) => element.setSelectionRange(element.value.length - 1, element.value.length - 1));
  await editor.getByLabel('选择全局 key').selectOption('openai_prod');
  await editor.getByRole('button', { name: '插入引用' }).click();
  await expect(editor.getByLabel('成员配置 JSON')).toHaveValue('{"temperature":9,"api_key":"$global.openai_prod"}');
  await editor.getByRole('button', { name: '保存配置' }).click();
  await expect(detail.getByText(/这一台的配置已保存（第 2 版）/)).toBeVisible();

  // 温度改回合法值：只发变了的键（合并补丁），构建成功，成员建好。
  await detail.getByRole('button', { name: '编辑配置' }).click();
  await editor.getByLabel('成员配置 JSON').fill('{"temperature":0.5,"api_key":"$global.openai_prod"}');
  await editor.getByRole('button', { name: '保存配置' }).click();
  await expect(detail.getByText(/这一台的配置已保存（第 3 版）/)).toBeVisible();
  // 构建在回复之后完成：按需再读，直到读到这次构建的结果。
  await expect(async () => {
    await detail.getByRole('button', { name: '刷新', exact: true }).click();
    await expect(detail.locator('.member-build')).toContainText('成功', { timeout: 500 });
  }).toPass({ timeout: 5_000 });
  expect((await sourceTable(detail)).api_key).toEqual(['$global.openai_prod', '这一台的配置']);
  const sets = submits.filter((payload) => payload.msg_type === 'system.member.config.set');
  expect(sets.map((payload) => payload.payload.values)).toEqual([{ temperature: 9, api_key: '$global.openai_prod' }, { temperature: 0.5 }]);
  const state = await mockState(request);
  expect(configOf(state, 'c0.project', 'deepseek')).toMatchObject({
    values: { temperature: 0.5, api_key: '$global.openai_prod' },
    revision: 3,
  });
});

test('成员两块编辑: the entry and this member\'s own configuration are edited and sent separately', async ({ page, request }) => {
  const submits = captureSubmits(page);
  await reset(request, 2905);
  await login(page);
  await enterProject(page);
  await page.getByRole('button', { name: '成员', exact: true }).first().click();
  await page.getByRole('complementary', { name: '频道成员' }).getByRole('button', { name: /search-tool/ }).click();
  const detail = page.getByRole('complementary', { name: 'Actor 详情' });
  await detail.getByRole('button', { name: '读取配置' }).click();
  const entry = detail.getByRole('region', { name: '描述条目' });
  const own = detail.getByRole('region', { name: '这一台的配置' });
  await expect(entry.getByLabel('当前 params')).toContainText('"endpoint": "http://127.0.0.1:9000/mcp"');
  await expect(own.getByLabel('当前配置')).toHaveText('{}');
  expect((await sourceTable(detail)).endpoint).toEqual(['http://127.0.0.1:9000/mcp', '成员条目']);

  // 第一块：描述条目的 params（写进 c0 的频道描述，所有这个频道的实例共用）。
  await entry.getByRole('button', { name: '编辑条目', exact: true }).click();
  const entryEditor = detail.getByRole('form', { name: '编辑成员条目' });
  // 没有预览：只有取消和保存。
  await expect(entryEditor.getByRole('button', { name: '检查变更' })).toHaveCount(0);
  await expect(entryEditor.getByLabel('成员 Actor 描述')).toHaveValue('d-search@1');
  await entryEditor.getByLabel('成员 params JSON').fill('{"endpoint":"http://127.0.0.1:9100/mcp","timeout_ms":5000}');
  await entryEditor.getByRole('button', { name: '保存条目', exact: true }).click();
  await expect(detail.getByText(/成员条目已写进频道描述（第 3 版）/)).toBeVisible();
  const memberSet = submits.filter((payload) => payload.msg_type === 'system.member.set');
  expect(memberSet).toHaveLength(1);
  expect(memberSet[0].channel_id).toBe('c0.project');
  // 只发变了的键；body 没换就不发 body。
  expect(memberSet[0].payload).toEqual({ member: expect.stringMatching(/^tool:search-tool:/), params: { endpoint: 'http://127.0.0.1:9100/mcp', timeout_ms: 5000 } });
  expect(submits.filter((payload) => payload.msg_type === 'system.member.config.set')).toHaveLength(0);

  // 第二块：这一台的配置（本频道的库里，只属于这个成员）盖在条目上面。
  await own.getByRole('button', { name: '编辑配置', exact: true }).click();
  const ownEditor = detail.getByRole('form', { name: '编辑成员配置' });
  await expect(ownEditor.getByRole('button', { name: '检查变更' })).toHaveCount(0);
  await expect(ownEditor.getByLabel('成员运行设备')).toHaveValue('');
  await ownEditor.getByLabel('成员配置 JSON').fill('{"timeout_ms":900}');
  await ownEditor.getByRole('button', { name: '保存配置', exact: true }).click();
  await expect(detail.getByText(/这一台的配置已保存（第 2 版）/)).toBeVisible();
  const configSet = submits.filter((payload) => payload.msg_type === 'system.member.config.set');
  expect(configSet).toHaveLength(1);
  expect(configSet[0].payload).toEqual({ member: expect.stringMatching(/^tool:search-tool:/), values: { timeout_ms: 900 } });
  expect(submits.filter((payload) => payload.msg_type === 'system.member.set')).toHaveLength(1);

  // 重新读回：两块各是各的值，合成表说出每个键来自哪一层。
  await expect(entry.getByLabel('当前 params')).toContainText('"timeout_ms": 5000');
  await expect(own.getByLabel('当前配置')).toContainText('"timeout_ms": 900');
  await expect(own).toContainText('第 2 版');
  const table = await sourceTable(detail);
  expect(table.endpoint).toEqual(['http://127.0.0.1:9100/mcp', '成员条目']);
  expect(table.timeout_ms).toEqual(['900', '这一台的配置']);
  // 端点换掉了死端口：构建成功、不再重试。
  await expect(detail.locator('.member-build')).toContainText('成功');

  const state = await mockState(request);
  expect(state.descriptions['c0.project'].body.members.find((row) => row.name === 'search-tool')).toEqual({
    id: expect.any(String),
    name: 'search-tool',
    body: { actor: 'd-search@1' },
    params: { endpoint: 'http://127.0.0.1:9100/mcp', timeout_ms: 5000 },
  });
  expect(configOf(state, 'c0.project', 'search-tool')).toMatchObject({ values: { timeout_ms: 900 }, revision: 2 });
});

// 时间线把 system 事件画在一个 narration 块里。起不来的成员只有"开始"回执（owner
// 09-30：不补失败回执），时间线上也就只有开始那一行。
test('构建记录: a member that does not start shows only its started line', async ({ page, request }) => {
  await reset(request, 2906);
  await login(page);
  await enterProject(page);
  await page.getByRole('button', { name: '频道操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '频道详情', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '频道治理' });
  const row = panel.locator('.managed-actor').filter({ hasText: 'agent:deepseek:' });
  await row.getByRole('button', { name: '重启', exact: true }).click();
  await panel.getByRole('button', { name: '确认操作' }).click();
  const timeline = page.locator('.timeline');
  await expect(timeline.getByText('开始构建成员 deepseek（第 1 次尝试）', { exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(timeline.getByText(/成员 deepseek构建(失败|成功)/)).toHaveCount(0);
});

test('global keys: add, list and delete by name; the page shows each value (owner: needed for debugging)', async ({ page, request }) => {
  await reset(request, 2902);
  await login(page);
  await page.getByRole('button', { name: '空间管理', exact: true }).click();
  const space = page.getByRole('complementary', { name: '空间管理' });
  await space.getByRole('tab', { name: '全局 key' }).click();
  await expect(space.locator('[data-global-key="openai_prod"]')).toContainText('$global.openai_prod');

  const secret = 'sk-browser-shown-4321';
  const add = space.getByRole('form', { name: '添加全局 key' });
  await expect(add.getByLabel('值')).toHaveAttribute('type', 'password');
  await add.getByLabel('名称').fill('deepseek_prod');
  await add.getByLabel('值').fill(secret);
  await add.getByRole('button', { name: '添加' }).click();
  await expect(space.getByText('已添加 global/deepseek_prod。')).toBeVisible();
  await expect(space.locator('[data-global-key]')).toHaveCount(2);
  await expect(space.locator('[data-global-key="deepseek_prod"]')).toBeVisible();
  // 页面显示每把 key 的原值（owner 09-30"现在先显示全部，我需要调试"）；输入框提交后清空。
  await expect(space.locator('[data-global-key="deepseek_prod"]')).toContainText(secret);
  expect(await page.locator('input').evaluateAll((inputs, value) => inputs.some((input) => input.value.includes(value)), secret)).toBe(false);
  const written = (await mockState(request)).globals.find((row) => row.id === 'global/deepseek_prod');
  expect(written?.value_sha256).toBe(sha256(secret));

  await space.getByRole('button', { name: '删除 openai_prod' }).click();
  await space.getByRole('button', { name: '删除', exact: true }).click();
  await expect(space.getByText('已删除 global/openai_prod。')).toBeVisible();
  await expect(space.locator('[data-global-key="openai_prod"]')).toHaveCount(0);
  expect((await mockState(request)).globals.map((row) => row.id)).toEqual(['global/deepseek_prod']);
});

test('ui.form round trip: a secret field is written to global/<name> and the reply carries only its mask', async ({ page, request }) => {
  await reset(request, 2903);
  const sent = [];
  page.on('websocket', (socket) => socket.on('framesent', (event) => {
    try { sent.push(JSON.parse(String(event.payload))); } catch { /* not a protocol frame */ }
  }));
  await login(page);

  const pushed = await request.post(`${MOCK_ORIGIN}/mock/control/action`, { data: { type: 'ui_form', channel_id: 'c0' } });
  expect(pushed.ok()).toBe(true);
  const { id: requestId } = await pushed.json();
  const dialog = page.getByRole('dialog', { name: '填写 DeepSeek key' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('API Key')).toHaveAttribute('type', 'password');
  await expect(dialog.getByText('只写入全局 key')).toContainText('global/deepseek_prod');

  const secret = 'sk-ui-form-secret-7788';
  await dialog.getByLabel('API Key').fill(secret);
  await dialog.getByLabel('模型').selectOption({ label: 'deepseek-reasoner' });
  await dialog.getByRole('button', { name: '提交' }).click();
  await expect(dialog).toBeHidden();

  const resolve = sent.find((frame) => frame.frame_type === 'resolve' && frame.payload?.req_id === requestId);
  expect(resolve?.payload).toEqual({
    channel_id: 'c0',
    req_id: requestId,
    result: {
      values: { model: 'deepseek-reasoner' },
      secret: { api_key: { resource: 'global/deepseek_prod', masked: '****7788' } },
    },
  });
  // 密钥只出现在写 global/deepseek_prod 的 resource 帧里。
  expect(sent.filter((frame) => JSON.stringify(frame).includes(secret)).map((frame) => [frame.frame_type, frame.payload?.op, frame.payload?.resource_id]))
    .toEqual([['resource', 'create', 'global/deepseek_prod']]);
  const written = (await mockState(request)).globals.find((row) => row.id === 'global/deepseek_prod');
  expect(written?.value_sha256).toBe(sha256(secret));

  // 取消回的是 cancelled。
  const second = await (await request.post(`${MOCK_ORIGIN}/mock/control/action`, { data: { type: 'ui_form', channel_id: 'c0', title: '再填一次' } })).json();
  const again = page.getByRole('dialog', { name: '再填一次' });
  await expect(again).toBeVisible();
  await again.getByRole('button', { name: '取消', exact: true }).click();
  await expect(again).toBeHidden();
  const cancelled = sent.find((frame) => frame.frame_type === 'resolve' && frame.payload?.req_id === second.id);
  expect(cancelled?.payload?.error).toEqual({ code: 'cancelled', message: '用户取消了表单' });
});
