import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN } from './mock-origin.js';

// 成员两层状态、全局 key 页、ui.form 往返：mock 的 actor-config 场景里 c0 有一个缺
// 全局 key 卡住的 agent（deepseek）和一个连不上端点正在重试的 tool（search-tool）。

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

async function mockState(request) {
  const response = await request.get(`${MOCK_ORIGIN}/mock/control/state`);
  expect(response.ok()).toBe(true);
  return response.json();
}

const sha256 = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('actor layers: a stuck member names its layer and reason; a ready row stays thin', async ({ page, request }) => {
  await reset(request, 2901);
  await login(page);
  await page.getByRole('button', { name: '成员', exact: true }).first().click();
  const roster = page.getByRole('complementary', { name: '频道成员' });
  const stuck = roster.getByRole('button', { name: /DeepSeek/ });
  await expect(stuck).toContainText('卡住');
  await expect(stuck).toContainText('业务层卡住：missing global resource global/deepseek_prod');
  await expect(roster.getByRole('button', { name: /Search Tool/ })).toContainText('业务层重试中：dial tcp 127.0.0.1:9000: connection refused');
  const ready = roster.getByRole('button', { name: /steward/ });
  await expect(ready).toContainText('已绑定');
  await expect(ready.locator('.member-layer-issue')).toHaveCount(0);

  await stuck.click();
  const detail = page.getByRole('complementary', { name: 'Actor 详情' });
  const layers = detail.getByRole('region', { name: '运行状态' });
  await expect(layers.locator('[data-layer="standard"]')).toContainText('就绪');
  await expect(layers.locator('[data-layer="business"]')).toContainText('卡住');
  await expect(layers.locator('[data-layer="business"]')).toContainText('missing global resource global/deepseek_prod');

  // 配置按需读（手动挡），读到的是引用不是值；只改变了的顶层键被提交。
  await detail.getByRole('button', { name: '读取配置' }).click();
  await expect(detail.getByLabel('当前配置')).toContainText('"api_key": "$global.deepseek_prod"');
  await expect(detail.getByText('声明 mock:deepseek')).toBeVisible();
  await detail.getByRole('button', { name: '编辑配置' }).click();
  const editor = detail.getByRole('form', { name: '编辑成员配置' });
  await expect(editor.getByRole('option', { name: 'openai_prod' })).toBeAttached();
  await editor.getByLabel('成员配置 JSON').fill('{"model":"deepseek-chat","temperature":9,"api_key":"$global.deepseek_prod"}');
  await editor.getByRole('button', { name: '保存配置' }).click();
  await expect(editor.getByRole('alert')).toContainText('invalid_args：config refused by deepseek-agent: temperature must be a number between 0 and 2');
  await editor.getByLabel('成员配置 JSON').fill('{"model":"deepseek-chat","api_key":}');
  await editor.getByLabel('成员配置 JSON').evaluate((element) => element.setSelectionRange(element.value.length - 1, element.value.length - 1));
  await editor.getByLabel('选择全局 key').selectOption('openai_prod');
  await editor.getByRole('button', { name: '插入引用' }).click();
  await expect(editor.getByLabel('成员配置 JSON')).toHaveValue('{"model":"deepseek-chat","api_key":"$global.openai_prod"}');
  await editor.getByRole('button', { name: '保存配置' }).click();
  await expect(detail.getByText('配置已保存，成员已按新配置重建。')).toBeVisible();
  await expect(layers.locator('[data-layer="business"]')).toContainText('就绪');
  const state = await mockState(request);
  expect(state.member_configs.find((row) => row.member === 'deepseek').config).toEqual({ model: 'deepseek-chat', api_key: '$global.openai_prod' });
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
