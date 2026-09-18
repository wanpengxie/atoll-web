import path from 'node:path';
import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

const UPLOAD = path.resolve('tests/fixtures/phase-e-upload.txt');

async function reset(request, scenario = 'space-administration', seed = 301) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  await expect(page.locator('main h1')).toHaveText('c0');
}

async function openSpace(page, tab = 'Actor 模板') {
  await page.getByRole('button', { name: '空间管理' }).click();
  const panel = page.getByRole('complementary', { name: '空间管理' });
  await expect(panel).toBeVisible();
  if (tab !== 'Actor 模板') await panel.getByRole('tab', { name: tab, exact: true }).click();
  return panel;
}

async function openResources(page, tab = 'KV') {
  await page.getByRole('button', { name: '频道操作' }).click();
  await page.getByRole('menuitem', { name: '高级资源工具' }).click();
  const panel = page.getByRole('complementary', { name: '频道资源' });
  await expect(panel).toBeVisible();
  await panel.getByRole('tab', { name: tab, exact: true }).click();
  return panel;
}

async function runLedgerAction(panel, action) {
  const status = panel.locator('.operation-state');
  const previous = await status.count() ? await status.getAttribute('data-request-id') : null;
  await action();
  await expect.poll(async () => await status.count() ? status.getAttribute('data-request-id') : null).not.toBe(previous);
  await expect(status).toHaveText('账本已完成');
  return status.getAttribute('data-request-id');
}

function captureSentFrames(page) {
  const frames = [];
  page.on('websocket', (socket) => socket.on('framesent', ({ payload }) => {
    try { frames.push(JSON.parse(String(payload))); } catch { /* binary/non-JSON frame */ }
  }));
  return frames;
}

async function expectSubmit(frames, type, payload) {
  await expect.poll(() => [...frames].reverse().find((frame) => (
    frame.frame_type === 'submit' && frame.payload?.msg_type === type
  )) || null).toMatchObject({ payload: { msg_type: type, payload } });
}

async function closeContextAndRevealLatest(page) {
  const host = page.locator('.context-host');
  const close = host.locator('.context-pane button[aria-label^="关闭"]').first();
  if (await close.isVisible().catch(() => false)) await close.click();
  await expect(host).toHaveCount(0);
  const latest = page.getByRole('button', { name: /条新动态/ });
  if (await latest.isVisible().catch(() => false)) await latest.click();
}

test('E-BR-01 Actor 模板完整 CRUD，系统声明受保护', async ({ page, request }) => {
  const sentFrames = captureSentFrames(page);
  await reset(request, 'space-administration', 301); await login(page);
  const panel = await openSpace(page);
  await runLedgerAction(panel, () => panel.getByRole('button', { name: '从 Registrar 读取' }).click());
  await expect(panel.getByRole('button', { name: /Steward mock:steward/ })).toBeVisible();
  await panel.getByLabel('Actor 声明 ID').fill('browser:assistant');
  await panel.getByLabel('Actor 模板名称').fill('browser-assistant');
  await panel.getByLabel('Actor Class').fill('codex');
  await panel.getByLabel('Actor Config JSON').fill('{"model":"mock"}');
  await runLedgerAction(panel, () => panel.getByRole('button', { name: '登记', exact: true }).click());
  await expectSubmit(sentFrames, 'system.actor.template.create', expect.objectContaining({
    id: 'browser:assistant', name: 'browser-assistant', class: 'codex', config: { model: 'mock' },
  }));
  await runLedgerAction(panel, () => panel.getByRole('button', { name: '从 Registrar 读取' }).click());
  await expect(panel.getByRole('button', { name: /browser-assistant.*browser:assistant/ })).toBeVisible();
  await panel.getByRole('button', { name: /browser-assistant.*browser:assistant/ }).click();
  await panel.getByLabel('Actor 模板说明').fill('edited');
  await runLedgerAction(panel, () => panel.getByRole('button', { name: '保存编辑' }).click());
  await expectSubmit(sentFrames, 'system.actor.template.set', expect.objectContaining({ id: 'browser:assistant', description: 'edited' }));
  await runLedgerAction(panel, () => panel.getByRole('button', { name: '从 Registrar 读取' }).click());
  await panel.getByRole('button', { name: /browser-assistant.*browser:assistant/ }).click();
  await expect(panel.getByLabel('Actor 模板说明')).toHaveValue('edited');
  await runLedgerAction(panel, () => panel.getByRole('button', { name: '撤销' }).click());
  await expectSubmit(sentFrames, 'system.actor.template.delete', { id: 'browser:assistant' });
  await runLedgerAction(panel, () => panel.getByRole('button', { name: '从 Registrar 读取' }).click());
  await expect(panel.getByRole('button', { name: /browser:assistant/ })).toHaveCount(0);
  await panel.getByRole('button', { name: /Service Actor/ }).click();
  await expect(panel.getByRole('button', { name: '保存编辑' })).toBeDisabled();
  await expect(panel.getByRole('button', { name: '撤销' })).toBeDisabled();
  await closeContextAndRevealLatest(page);
  await expect(page.locator('.turn-card[data-request-type="system.actor.template.delete"]')).toContainText('revoked');
});

test('E-BR-02 频道模板登记、编辑、读取和撤销都走 Registrar 账本', async ({ page, request }) => {
  const sentFrames = captureSentFrames(page);
  await reset(request, 'space-administration', 302); await login(page);
  const panel = await openSpace(page, '频道模板');
  await runLedgerAction(panel, () => panel.getByRole('button', { name: '从 Registrar 读取' }).click());
  await expect(panel.getByRole('button', { name: /Team channel/ })).toBeVisible();
  await panel.getByLabel('频道模板 ID').fill('browser:channel');
  await panel.getByLabel('频道模板名称').fill('Browser Channel');
  await panel.getByLabel('频道模板 Body JSON').fill('{"declarations":[{"decl_id":"mock:analyst"}]}');
  await runLedgerAction(panel, () => panel.getByRole('button', { name: '登记', exact: true }).click());
  await expectSubmit(sentFrames, 'system.channel.template.create', expect.objectContaining({
    id: 'browser:channel', name: 'Browser Channel',
    body: expect.objectContaining({ declarations: [{ decl_id: 'mock:analyst' }] }),
  }));
  await runLedgerAction(panel, () => panel.getByRole('button', { name: '从 Registrar 读取' }).click());
  await expect(panel.getByRole('button', { name: /Browser Channel.*browser:channel/ })).toBeVisible();
  await panel.getByRole('button', { name: /Browser Channel.*browser:channel/ }).click();
  await panel.getByLabel('频道模板说明').fill('edited template');
  await runLedgerAction(panel, () => panel.getByRole('button', { name: '保存编辑' }).click());
  await expectSubmit(sentFrames, 'system.channel.template.set', expect.objectContaining({ id: 'browser:channel', description: 'edited template' }));
  await runLedgerAction(panel, () => panel.getByRole('button', { name: '从 Registrar 读取' }).click());
  await panel.getByRole('button', { name: /Browser Channel.*browser:channel/ }).click();
  await expect(panel.getByLabel('频道模板说明')).toHaveValue('edited template');
  await runLedgerAction(panel, () => panel.getByRole('button', { name: '读取详情' }).click());
  await expectSubmit(sentFrames, 'system.channel.template.get', { id: 'browser:channel' });
  await runLedgerAction(panel, () => panel.getByRole('button', { name: '撤销' }).click());
  await expectSubmit(sentFrames, 'system.channel.template.delete', { id: 'browser:channel' });
  await runLedgerAction(panel, () => panel.getByRole('button', { name: '从 Registrar 读取' }).click());
  await expect(panel.getByRole('button', { name: /browser:channel/ })).toHaveCount(0);
  await closeContextAndRevealLatest(page);
  await expect(page.locator('.turn-card[data-request-type="system.channel.template.delete"]')).toContainText('revoked');
});

test('E-BR-03/E-BR-04 配置只作用于来源频道并区分账本终态与 OBS 投影', async ({ page, request }) => {
  const sentFrames = captureSentFrames(page);
  await reset(request, 'space-administration', 303); await login(page);
  const panel = await openSpace(page, '频道配置');
  await expect(panel.getByText('配置只作用于来源频道 c0。')).toBeVisible();
  await panel.getByLabel('Overlay 声明 ID').fill('mock:analyst');
  await panel.getByLabel('Overlay Config JSON').fill('{"model":"overlay"}');
  await runLedgerAction(panel, () => panel.getByRole('button', { name: '应用 Overlay' }).click());
  await expectSubmit(sentFrames, 'system.actor.overlay.set', { channel_id: 'c0', decl_id: 'mock:analyst', config: { model: 'overlay' } });
  await runLedgerAction(panel, () => panel.getByRole('button', { name: '清除' }).click());
  await expectSubmit(sentFrames, 'system.actor.overlay.delete', { channel_id: 'c0', decl_id: 'mock:analyst' });
  await panel.getByLabel('Profile 说明').fill('Configured from browser');
  await panel.getByLabel('Profile Serving').fill('1');
  await runLedgerAction(panel, () => panel.getByRole('button', { name: '保存 Profile' }).click());
  await expectSubmit(sentFrames, 'system.channel.set', expect.objectContaining({ channel_id: 'c0', description: 'Configured from browser', serving: 1 }));
  await expect(panel.locator('.observed-runtime')).toContainText('OBS 运行投影');
  await expect(panel.locator('.observed-runtime')).toContainText('服务中');
  await closeContextAndRevealLatest(page);
  await expect(page.locator('.turn-card[data-request-type="system.channel.set"]')).toContainText('Configured from browser');
});

test('E-BR-05/E-BR-06 设备使用安全 OBS，一次性密钥不进时间线和持久化，操作均需确认', async ({ page, request }) => {
  await reset(request, 'device-governance', 304); await login(page);
  const panel = await openSpace(page, '设备');
  await expect(panel).toContainText('空间列表用于设备身份管理');
  await panel.getByLabel('设备名称').fill('browser-device');
  await panel.getByRole('button', { name: '创建设备' }).click();
  const secretCard = panel.getByText('设备密钥只显示这一次').locator('..');
  await expect(secretCard).toBeVisible();
  const secret = await secretCard.locator('code').innerText();
  expect(secret).toMatch(/^mock-key-/);
  await expect(page.locator('.turn-card[data-request-type="system.device.create"]')).toContainText('已隐藏');
  await secretCard.getByRole('button', { name: '我已保存，关闭' }).click();
  await expect(page.getByText(secret, { exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate((value) => JSON.stringify({ ...localStorage }).includes(value), secret)).toBe(false);
  const row = panel.locator('.device-row').filter({ hasText: 'browser-device' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: '绑定当前频道' }).click();
  await expect(panel.locator('.inline-confirmation')).toContainText('最终运行状态');
  await panel.getByRole('button', { name: '确认操作' }).click();
  await expect(row).toContainText('已绑定');
  await row.getByRole('button', { name: '解绑' }).click();
  await panel.getByRole('button', { name: '确认操作' }).click();
  await expect(row).not.toContainText('已绑定');
  await row.getByRole('button', { name: '退役' }).click();
  await expect(panel.locator('.inline-confirmation')).toContainText('不可由前端恢复');
  await panel.getByRole('button', { name: '确认操作' }).click();
  await expect(row).toHaveCount(0);
});

test('E-BR-07 KV create/read/write/stat/list/delete 完整闭环', async ({ page, request }) => {
  await reset(request, 'resource-workflow', 305); await login(page);
  const panel = await openResources(page);
  await panel.getByRole('button', { name: '列出' }).click();
  await expect(panel.locator('.resource-result')).toContainText('"items": []');
  await panel.getByLabel('KV 资源 ID').fill('kv:browser');
  await panel.getByLabel('KV Args JSON').fill('{"value":1}');
  await panel.getByRole('button', { name: '创建', exact: true }).click();
  await expect(panel.locator('.resource-result')).toContainText('kv:browser');
  await panel.getByLabel('KV Args JSON').fill('{"value":2}');
  await panel.getByRole('button', { name: '写入' }).click();
  await expect(panel.locator('.resource-result')).toContainText('"value": 2');
  await panel.getByRole('button', { name: '读取' }).click();
  await expect(panel.locator('.resource-result')).toContainText('"value": 2');
  await panel.getByRole('button', { name: '状态' }).click();
  await expect(panel.locator('.resource-result')).toContainText('"exists": true');
  await panel.getByRole('button', { name: '删除' }).click();
  await expect(panel.locator('.resource-result')).toContainText('"deleted": true');
});

test('E-BR-08/E-BR-10 文件上传、附件消息卡和下载闭环', async ({ page, request }) => {
  await reset(request, 'resource-workflow', 306); await login(page);
  const panel = await openResources(page, '文件');
  await panel.getByRole('combobox', { name: '文件目标设备' }).click();
  await panel.getByRole('option', { name: /local-device/ }).click();
  await panel.getByLabel('文件资源路径').fill('uploads/phase-e-upload.txt');
  await panel.getByLabel('选择上传文件').setInputFiles(UPLOAD);
  await panel.getByRole('button', { name: '上传', exact: true }).click();
  await expect(panel.getByText('上传完成', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '附加到消息' }).click();
  await expect(page.locator('[aria-label="待发送附件"]')).toContainText('phase-e-upload.txt');
  await page.getByRole('button', { name: /发送/ }).click();
  const card = page.locator('.message-attachments').last();
  await expect(card).toContainText('phase-e-upload.txt');
  const downloadPromise = page.waitForEvent('download');
  await card.getByRole('button', { name: '下载' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('phase-e-upload.txt');
  expect(await download.failure()).toBeNull();
});

test('E-BR-09 ticket 过期保留上下文并可重新获取，不复用旧 PUT', async ({ page, request }) => {
  await reset(request, 'resource-ticket-expired', 307); await login(page);
  let firstPut = true;
  // The transfer endpoint is `/files?…`, not a child path below `/files/`.
  // Match the endpoint itself so the clock advances before the first PUT.
  await page.route(/\/files(?:\?|$)/, async (route) => {
    if (route.request().method() === 'PUT' && firstPut) {
      firstPut = false;
      await request.post(`${MOCK}/mock/control/advance`, { data: { ms: 60_000 } });
    }
    await route.continue();
  });
  const panel = await openResources(page, '文件');
  await panel.getByRole('combobox', { name: '文件目标设备' }).click();
  await panel.getByRole('option', { name: /local-device/ }).click();
  await panel.getByLabel('文件资源路径').fill('uploads/expired.txt');
  await panel.getByLabel('选择上传文件').setInputFiles(UPLOAD);
  await panel.getByRole('button', { name: '上传', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('ticket');
  await expect(panel.getByText('上传失败，可重新获取票据')).toBeVisible();
  await panel.getByRole('button', { name: '上传', exact: true }).click();
  await expect(panel.getByText('上传完成', { exact: true })).toBeVisible();
});

test('E-BR-11/E-BR-12 定时动作是本设备记录，可触发入账并可靠取消', async ({ page, request }) => {
  await reset(request, 'scheduled-action', 308); await login(page);
  await page.getByRole('tab', { name: '任务', exact: true }).click();
  await page.getByRole('button', { name: '安排自动动作' }).click();
  let panel = page.getByRole('complementary', { name: '定时动作' });
  await expect(panel).toContainText('本设备记录');
  await panel.getByLabel('定时延迟毫秒').fill('1000');
  await panel.getByLabel('定时消息类型').fill('browser.timer.notice');
  await panel.getByLabel('定时 Payload JSON').fill('{"text":"浏览器定时消息"}');
  await panel.getByRole('button', { name: '创建定时动作' }).click();
  await expect(panel.getByText('已安排', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('atoll.timers.root'))).toContain('browser.timer.notice');
  await request.post(`${MOCK}/mock/control/advance`, { data: { ms: 1000 } });
  await panel.getByRole('button', { name: '关闭定时动作' }).click();
  await page.getByRole('tab', { name: '动态', exact: true }).click();
  // Timer events are system-authored channel facts, so the default “@我”
  // conversation scope intentionally excludes them. Inspect the full ledger.
  await page.getByRole('group', { name: '动态范围' }).getByRole('button', { name: '@我' }).click();
  await expect(page.getByRole('group', { name: '动态范围' }).getByRole('button', { name: '全部' })).toBeVisible();
  await expect(page.getByText('浏览器定时消息', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '任务', exact: true }).click();
  await page.getByRole('button', { name: '安排自动动作' }).click();
  panel = page.getByRole('complementary', { name: '定时动作' });
  await expect(panel.getByText('已触发', { exact: true })).toBeVisible();
  await panel.getByLabel('定时延迟毫秒').fill('2000');
  await panel.getByLabel('定时消息类型').fill('browser.timer.cancelled');
  await panel.getByLabel('定时 Payload JSON').fill('{"text":"不应出现"}');
  await panel.getByRole('button', { name: '创建定时动作' }).click();
  await panel.getByRole('button', { name: '取消' }).click();
  await expect(panel.getByText('已取消', { exact: true })).toBeVisible();
  await request.post(`${MOCK}/mock/control/advance`, { data: { ms: 2000 } });
  await expect(page.getByText('不应出现', { exact: true })).toHaveCount(0);
});

test('E-BR-13 权限失败保留空间管理输入和账本错误事实', async ({ page, request }) => {
  await reset(request, 'space-administration-denied', 309); await login(page);
  const panel = await openSpace(page);
  await panel.getByLabel('Actor 声明 ID').fill('browser:denied');
  await panel.getByLabel('Actor 模板名称').fill('denied');
  await panel.getByLabel('Actor Class').fill('codex');
  await panel.getByRole('button', { name: '登记', exact: true }).click();
  await expect(panel.getByText(/失败：unauthorized_sender/)).toBeVisible();
  await expect(panel.getByLabel('Actor 声明 ID')).toHaveValue('browser:denied');
  await closeContextAndRevealLatest(page);
  await expect(page.locator('.turn-card[data-request-type="system.actor.template.create"]')).toContainText('unauthorized_sender');
});
