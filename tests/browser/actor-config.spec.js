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

const DEEPSEEK_FAILED = '成员 deepseek构建失败（第 1 次尝试，下次巡检会再试）：member deepseek: its business did not start: missing global resource global/deepseek_prod';

const sha256 = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('actor layers: a stuck member names its layer and reason; a ready row stays thin', async ({ page, request }) => {
  const submits = captureSubmits(page);
  await reset(request, 2901);
  await login(page);
  await enterProject(page);
  await page.getByRole('button', { name: '成员', exact: true }).first().click();
  const roster = page.getByRole('complementary', { name: '频道成员' });
  const stuck = roster.getByRole('button', { name: /deepseek/ });
  await expect(stuck).toContainText('卡住');
  await expect(stuck).toContainText('业务层卡住：missing global resource global/deepseek_prod');
  await expect(stuck).toContainText('actor deepseek@1');
  await expect(roster.getByRole('button', { name: /search-tool/ })).toContainText('业务层重试中：dial tcp 127.0.0.1:9000: connection refused');
  const ready = roster.getByRole('button', { name: /project-agent/ });
  await expect(ready).toContainText('已绑定');
  await expect(ready.locator('.member-layer-issue')).toHaveCount(0);
  // writer 的占位没填、构建失败：它不在名册上。
  await expect(roster.getByRole('button', { name: /writer/ })).toHaveCount(0);

  await stuck.click();
  const detail = page.getByRole('complementary', { name: 'Actor 详情' });
  const layers = detail.getByRole('region', { name: '运行状态' });
  await expect(layers.locator('[data-layer="standard"]')).toContainText('就绪');
  await expect(layers.locator('[data-layer="business"]')).toContainText('卡住');
  await expect(layers.locator('[data-layer="business"]')).toContainText('missing global resource global/deepseek_prod');

  // 各层按需读（手动挡）：打开详情不发 member.get。读到的是引用不是值。
  expect(submits.filter((payload) => payload.msg_type === 'system.member.get')).toHaveLength(0);
  await detail.getByRole('button', { name: '读取配置' }).click();
  await expect(detail.locator('.member-config-facts')).toContainText('Actor 描述 deepseek@1');
  await expect(detail.locator('.member-build')).toContainText('失败');
  await expect(detail.locator('.member-build')).toContainText('missing global resource global/deepseek_prod');
  expect((await sourceTable(detail)).api_key).toEqual(['$global.deepseek_prod', 'Actor 描述']);
  await expect(detail.getByText(/\$global\. 开头的是对 global\/<名称> 的引用/)).toBeVisible();

  // 这一台的配置：插入全局 key 引用把缺的 key 换掉。值写进去时不检查，构建会说
  // 它行不行：温度 9 被 class 拒绝。
  await detail.getByRole('button', { name: '编辑配置' }).click();
  const editor = detail.getByRole('form', { name: '编辑成员配置' });
  await expect(editor.getByRole('option', { name: 'openai_prod' })).toBeAttached();
  await editor.getByLabel('成员配置 JSON').fill('{"temperature":9,"api_key":}');
  await editor.getByLabel('成员配置 JSON').evaluate((element) => element.setSelectionRange(element.value.length - 1, element.value.length - 1));
  await editor.getByLabel('选择全局 key').selectOption('openai_prod');
  await editor.getByRole('button', { name: '插入引用' }).click();
  await expect(editor.getByLabel('成员配置 JSON')).toHaveValue('{"temperature":9,"api_key":"$global.openai_prod"}');
  await editor.getByRole('button', { name: '保存配置' }).click();
  await expect(detail.getByText(/这一台的配置已保存（第 1 版）/)).toBeVisible();
  await expect(detail.locator('.member-build')).toContainText('config refused by deepseek-agent: temperature must be a number between 0 and 2');
  await expect(layers.locator('[data-layer="business"]')).toContainText('卡住');

  // 温度改回合法值：只发变了的键（合并补丁），构建成功，业务层就绪。
  await detail.getByRole('button', { name: '编辑配置' }).click();
  await editor.getByLabel('成员配置 JSON').fill('{"temperature":0.5,"api_key":"$global.openai_prod"}');
  await editor.getByRole('button', { name: '保存配置' }).click();
  await expect(detail.getByText(/这一台的配置已保存（第 2 版）/)).toBeVisible();
  await expect(detail.locator('.member-build')).toContainText('成功');
  await expect(layers.locator('[data-layer="business"]')).toContainText('就绪');
  expect((await sourceTable(detail)).api_key).toEqual(['$global.openai_prod', '这一台的配置']);
  const sets = submits.filter((payload) => payload.msg_type === 'system.member.config.set');
  expect(sets.map((payload) => payload.payload.values)).toEqual([{ temperature: 9, api_key: '$global.openai_prod' }, { temperature: 0.5 }]);
  const state = await mockState(request);
  expect(state.member_configs.find((row) => row.channel_id === 'c0.project' && row.member === 'deepseek')).toMatchObject({
    values: { temperature: 0.5, api_key: '$global.openai_prod' },
    revision: 2,
  });
});

test('占位显示与填写: writer\'s unfilled placeholder is shown, filling it builds writer into the roster', async ({ page, request }) => {
  const submits = captureSubmits(page);
  await reset(request, 2904);
  await login(page);
  await enterProject(page);
  await page.getByRole('button', { name: '频道操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '频道详情', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '频道治理' });
  await panel.getByRole('tab', { name: '设置', exact: true }).click();
  // 频道状态按需读：一次点击一条 system.channel.get。
  await panel.getByRole('button', { name: '读取', exact: true }).click();
  const builds = panel.locator('.member-builds');
  const writerBuild = builds.locator('[data-build-name="writer"]');
  await expect(writerBuild).toContainText('失败');
  await expect(writerBuild).toContainText('已停止：改描述或配置后才会再构建');
  await expect(writerBuild).toContainText('第 4 次尝试');
  await expect(writerBuild).toContainText('service.api_key is a placeholder still unfilled (写作服务的 API key)');
  expect(submits.find((payload) => payload.msg_type === 'system.channel.get')?.payload).toEqual({ channel_id: 'c0.project' });

  // writer 不在名册上，从构建摘要打开它的详情。
  await builds.getByRole('button', { name: '查看成员 writer', exact: true }).click();
  const detail = page.getByRole('complementary', { name: 'Actor 详情' });
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: '读取配置' }).click();
  expect(submits.filter((payload) => payload.msg_type === 'system.member.get').at(-1)?.payload).toEqual({ member: 'writer' });
  const missing = detail.getByRole('group', { name: '还没填的占位' });
  await expect(missing).toContainText('还缺 1 个值');
  const row = missing.locator('[data-key="service.api_key"]');
  await expect(row).toContainText('写作服务的 API key');
  expect((await sourceTable(detail))['service.api_key']).toEqual(['$required:写作服务的 API key', 'Actor 描述']);

  await row.getByLabel('填写 service.api_key').fill('$global.openai_prod');
  await row.getByRole('button', { name: '填入', exact: true }).click();
  await expect(detail.getByText(/已填 service\.api_key（配置第 1 版）/)).toBeVisible();
  const set = submits.filter((payload) => payload.msg_type === 'system.member.config.set').at(-1);
  expect(set?.payload).toEqual({ member: 'writer', values: { service: { api_key: '$global.openai_prod' } } });
  await expect(detail.getByRole('group', { name: '还没填的占位' })).toHaveCount(0);
  await expect(detail.locator('.member-build')).toContainText('成功');
  // 填的值盖在描述的占位上，同一个对象里的兄弟键照旧来自 Actor 描述。
  const table = await sourceTable(detail);
  expect(table['service.api_key']).toEqual(['$global.openai_prod', '这一台的配置']);
  expect(table['service.region']).toEqual(['cn', 'Actor 描述']);

  // 构建成功，writer 出现在名册上。
  await detail.getByRole('button', { name: '关闭writer', exact: true }).click();
  await page.getByRole('button', { name: '成员', exact: true }).first().click();
  const roster = page.getByRole('complementary', { name: '频道成员' });
  await expect(roster.getByRole('button', { name: /writer/ })).toContainText('actor writer@1');
  expect((await mockState(request)).builds.find((row) => row.object.channel === 'c0.project' && row.object.name === 'writer')).toMatchObject({ result: 'ok', state: 'ready' });
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
  await expect(entryEditor.getByLabel('成员 Actor 描述')).toHaveValue('search@1');
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
  await expect(detail.getByText(/这一台的配置已保存（第 1 版）/)).toBeVisible();
  const configSet = submits.filter((payload) => payload.msg_type === 'system.member.config.set');
  expect(configSet).toHaveLength(1);
  expect(configSet[0].payload).toEqual({ member: expect.stringMatching(/^tool:search-tool:/), values: { timeout_ms: 900 } });
  expect(submits.filter((payload) => payload.msg_type === 'system.member.set')).toHaveLength(1);

  // 重新读回：两块各是各的值，合成表说出每个键来自哪一层。
  await expect(entry.getByLabel('当前 params')).toContainText('"timeout_ms": 5000');
  await expect(own.getByLabel('当前配置')).toContainText('"timeout_ms": 900');
  await expect(own).toContainText('第 1 版');
  const table = await sourceTable(detail);
  expect(table.endpoint).toEqual(['http://127.0.0.1:9100/mcp', '成员条目']);
  expect(table.timeout_ms).toEqual(['900', '这一台的配置']);
  // 端点换掉了死端口：构建成功、不再重试。
  await expect(detail.locator('.member-build')).toContainText('成功');

  const state = await mockState(request);
  expect(state.descriptions['c0.project'].body.members.find((row) => row.name === 'search-tool')).toEqual({
    name: 'search-tool',
    body: { actor: 'search@1' },
    params: { endpoint: 'http://127.0.0.1:9100/mcp', timeout_ms: 5000 },
  });
  expect(state.member_configs.find((row) => row.channel_id === 'c0.project' && row.member === 'search-tool')).toMatchObject({ values: { timeout_ms: 900 }, revision: 1 });
});

// 时间线把 system 事件画在一个 narration 块里；后到的 system.build.finished 要让
// 这个块重画（它的 contentRevision 跟着最后一条事件走）。
test('构建记录: the timeline shows a finished build line live, with its reason', async ({ page, request }) => {
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
  await expect(timeline.getByText(DEEPSEEK_FAILED, { exact: true })).toBeVisible({ timeout: 5_000 });
});

test('global keys: add, list and delete by name; the value is never displayed', async ({ page, request }) => {
  await reset(request, 2902);
  await login(page);
  await page.getByRole('button', { name: '空间管理', exact: true }).click();
  const space = page.getByRole('complementary', { name: '空间管理' });
  await space.getByRole('tab', { name: '全局 key' }).click();
  await expect(space.locator('[data-global-key="openai_prod"]')).toContainText('$global.openai_prod');

  const secret = 'sk-browser-never-shown-4321';
  const add = space.getByRole('form', { name: '添加全局 key' });
  await expect(add.getByLabel('值')).toHaveAttribute('type', 'password');
  await add.getByLabel('名称').fill('deepseek_prod');
  await add.getByLabel('值').fill(secret);
  await add.getByRole('button', { name: '添加' }).click();
  await expect(space.getByText('已添加 global/deepseek_prod。')).toBeVisible();
  await expect(space.locator('[data-global-key]')).toHaveCount(2);
  await expect(space.locator('[data-global-key="deepseek_prod"]')).toBeVisible();
  // 值不在页面文字里，也不留在任何输入框里。
  expect(await page.locator('body').innerText()).not.toContain(secret);
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
