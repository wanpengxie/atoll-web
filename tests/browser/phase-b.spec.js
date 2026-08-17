import { expect, test } from '@playwright/test';

async function reset(request, scenario = 'multi-channel', seed = 81) {
  const response = await request.post('http://127.0.0.1:8832/mock/control/reset', { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function action(request, data) {
  const response = await request.post('http://127.0.0.1:8832/mock/control/action', { data });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function login(page) {
  await page.goto('/');
  await page.getByLabel('邮箱').fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.getByRole('navigation', { name: '频道' })).toBeVisible();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
}

async function send(page, text) {
  await page.getByLabel('消息').fill(text);
  await page.getByRole('button', { name: /发送/ }).click();
}

async function clearProductCache(page) {
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key !== 'atoll.principal') localStorage.removeItem(key);
    }
  });
}

test('B-BR-01 频道事实分组、lobby 与内部 Actor 隔离', async ({ page, request }) => {
  await reset(request);
  await login(page);
  const rail = page.locator('.channel-rail');
  await expect(rail.getByText('c0', { exact: true })).toBeVisible();
  await expect(rail.getByText('c0.project', { exact: true })).toBeVisible();
  await expect(rail.getByText('c0.public', { exact: true })).toBeVisible();
  await expect(rail.getByText(/lobby/i)).toHaveCount(0);
  await expect(page.locator('.roster-panel').getByText('system', { exact: true })).toHaveCount(0);
  await expect(page.locator('.roster-panel').getByText('registrar', { exact: true })).toHaveCount(0);
  await expect(page.locator('.roster-panel').getByText('svcactor', { exact: true })).toHaveCount(0);
});

test('B-BR-02 断线时进入 stale、保留账本并在重连后恢复', async ({ page, request, context }) => {
  await reset(request);
  await login(page);
  await expect(page.getByText(/c0 history 1/)).toBeVisible();
  await context.setOffline(true);
  await action(request, { type: 'drop' });
  await expect(page.getByText('RECONNECTING', { exact: true })).toBeVisible();
  await expect(page.getByText(/当前显示本地缓存/)).toBeVisible();
  await expect(page.getByText(/c0 history 1/)).toBeVisible();
  await expect(page.getByLabel('消息')).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel('消息')).toBeEnabled();
});

test('B-BR-03 unavailable、partial OBS、权限撤销和退役分别收敛', async ({ page, request }) => {
  await reset(request);
  await login(page);
  await page.getByRole('button', { name: /c0\.project/ }).click();
  await action(request, { type: 'set_channel_open', channel_id: 'c0.project', open: false });
  await expect(page.getByText('暂不可用', { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/频道暂不可用，历史记录仍可查看/)).toBeVisible();
  await expect(page.getByLabel('消息')).toBeDisabled();

  await action(request, { type: 'set_channel_open', channel_id: 'c0.project', open: true });
  await expect(page.getByLabel('消息')).toBeEnabled({ timeout: 5_000 });
  await action(request, { type: 'set_obs_complete', complete: false });
  await action(request, { type: 'retire_channel', channel_id: 'c0.project' });
  await page.waitForTimeout(1_700);
  await expect(page.locator('.channel-rail').getByText('c0.project', { exact: true })).toBeVisible();
  await action(request, { type: 'set_obs_complete', complete: true });
  await expect(page.locator('.channel-rail').getByText('c0.project', { exact: true })).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByText(/c0\.project 已退役/)).toBeVisible();

  await reset(request);
  await clearProductCache(page);
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /c0\.project/ }).click();
  await action(request, { type: 'revoke_membership', channel_id: 'c0.project' });
  await expect(page.getByText(/频道访问权限已被撤销/)).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.channel-rail').getByText('无权访问', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('加入频道后才能发送消息')).toBeDisabled();

  await reset(request);
});

test('B-BR-04 真实后端形态下不猜 self，发送 feed 后自动识别', async ({ page, request }) => {
  await reset(request, 'real-backend-shape');
  await login(page);
  await expect(page.getByText(/正在确认你在本频道中的 Actor 身份/)).toBeVisible();
  await expect(page.locator('.roster-panel').getByText('我', { exact: true })).toHaveCount(0);
  const message = `self-map-${Date.now()}`;
  await send(page, message);
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(page.locator('.roster-panel').getByText('我', { exact: true })).toBeVisible();
  await expect(page.getByText(/正在确认你在本频道中的 Actor 身份/)).toHaveCount(0);
});

test('B-BR-05 完整 provisional、命名空间状态和第一终态权威性', async ({ page, request }) => {
  await reset(request, 'business-provisional');
  await login(page);
  await send(page, `business-status-${Date.now()}`);
  await expect(page.locator('.provisional-business code').filter({ hasText: 'provider.waiting' })).toBeVisible();
  await expect(page.getByText('PONG', { exact: true })).toBeVisible();

  await reset(request, 'terminal-conflict');
  await clearProductCache(page);
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  await send(page, `terminal-first-${Date.now()}`);
  await expect(page.getByText('PONG', { exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  const latestTurn = page.locator('.turn-card').last();
  await expect(latestTurn.getByText('PONG', { exact: true })).toBeVisible();
  await expect(latestTurn.getByText('FAILED', { exact: true })).toHaveCount(0);
});

test('B-BR-06 receipt 先到与 feed 先到都只产生一个请求', async ({ page, request }) => {
  await reset(request, 'feed-delayed');
  await login(page);
  const delayed = `feed-delayed-${Date.now()}`;
  await send(page, delayed);
  await expect(page.getByText('已受理，等待入账', { exact: true })).toBeVisible();
  await expect(page.getByText(delayed, { exact: true })).toHaveCount(1);
  await expect(page.getByText('PONG', { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(delayed, { exact: true })).toHaveCount(1);

  await reset(request, 'receipt-delayed');
  await clearProductCache(page);
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  const receiptDelayed = `receipt-delayed-${Date.now()}`;
  await send(page, receiptDelayed);
  await expect(page.locator('.turn-card').getByText(receiptDelayed, { exact: true })).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(page.locator('.timeline').getByText(receiptDelayed, { exact: true })).toHaveCount(1);
});

test('B-BR-07 receipt 丢失时先显示 uncertain，再由重连 feed 对账', async ({ page, request }) => {
  await reset(request, 'receipt-lost-feed-landed');
  await login(page);
  const message = `uncertain-${Date.now()}`;
  await send(page, message);
  await expect(page.getByText(/发送结果待确认/).first()).toBeVisible();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(message, { exact: true })).toHaveCount(1);
  await expect(page.getByText('PONG', { exact: true })).toBeVisible();
});

test('B-BR-08 切频道不改变 pending 所属频道', async ({ page, request }) => {
  await reset(request, 'feed-delayed');
  await login(page);
  const message = `channel-bound-${Date.now()}`;
  await send(page, message);
  await page.getByRole('button', { name: /c0\.project/ }).click();
  await expect(page.locator('main').getByText(message, { exact: true })).toHaveCount(0);
  await page.waitForTimeout(1_000);
  await expect(page.locator('main').getByText(message, { exact: true })).toHaveCount(0);
  await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0$/ }) }).click();
  await expect(page.getByText(message, { exact: true })).toHaveCount(1);

  await reset(request);
  await clearProductCache(page);
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  const homeApproval = page.locator('.approval-card').first();
  await homeApproval.getByRole('button', { name: '批准' }).click();
  await page.getByRole('button', { name: /c0\.project/ }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.locator('.approval-card').first().getByText('已回执', { exact: true })).toHaveCount(0);
  await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0$/ }) }).click();
  await expect(page.locator('.approval-card').first().getByText('已回执', { exact: true })).toBeVisible();
});

test('B-BR-09 结构化、空成功、失败与敏感字段都有可理解结果', async ({ page, request }) => {
  await reset(request, 'message-structured-success');
  await login(page);
  await send(page, `structured-${Date.now()}`);
  await expect(page.getByText('结构化结果', { exact: true })).toBeVisible();
  await expect(page.getByText('instance_id', { exact: true })).toBeVisible();
  await expect(page.getByText('已隐藏', { exact: true })).toBeVisible();
  await expect(page.getByText('25 项，先显示 20 项', { exact: true })).toBeVisible();

  await reset(request, 'message-empty-success');
  await clearProductCache(page);
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  await send(page, `empty-${Date.now()}`);
  await expect(page.locator('.completion-ack')).toContainText('已完成');

  await reset(request, 'message-failed');
  await clearProductCache(page);
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  await send(page, `failure-${Date.now()}`);
  await expect(page.getByText('接收方不支持这个操作', { exact: true })).toBeVisible();
  await expect(page.getByText('type_unsupported', { exact: true })).toBeVisible();
  await expect(page.getByText(/mock failure requested/).first()).toBeVisible();

  await reset(request, 'actor-capability');
  await clearProductCache(page);
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  const describe = page.locator('.actor-describe-result');
  await expect(describe.getByRole('strong').filter({ hasText: 'Mock 协作 Agent' })).toBeVisible();
  await expect(describe.getByText('human.text', { exact: true }).first()).toBeVisible();
});

test('B-BR-10 普通频道通过 decl_id 解析 coreactor 并展示 channel.list', async ({ page, request }) => {
  await reset(request);
  await login(page);
  await page.getByRole('button', { name: /c0\.project/ }).click();
  await page.getByLabel('消息').fill('/channels');
  await page.getByRole('button', { name: /发送/ }).click();
  await expect(page.getByText('channel.list', { exact: true })).toBeVisible();
  await expect(page.locator('.structured-table').getByText('c0.public', { exact: true }).first()).toBeVisible();
});
