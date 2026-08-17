import { expect, test } from '@playwright/test';

async function reset(request, scenario = 'multi-channel', seed = 31) {
  const response = await request.post('http://127.0.0.1:8832/mock/control/reset', { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByLabel('邮箱').fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.getByRole('navigation', { name: '频道' })).toBeVisible();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
}

test('A-BR-01/02/03 登录恢复、频道分组和 lobby 隐藏', async ({ page, request }) => {
  await reset(request);
  await login(page);

  const rail = page.locator('.channel-rail');
  await expect(rail.locator('.rail-caption').filter({ hasText: '我的频道' })).toBeVisible();
  await expect(rail.locator('.rail-caption').filter({ hasText: '空间' })).toBeVisible();
  await expect(rail.getByText('c0', { exact: true })).toBeVisible();
  await expect(rail.getByText('c0.project', { exact: true })).toBeVisible();
  await expect(rail.getByText('c0.public', { exact: true })).toBeVisible();
  await expect(page.getByText(/lobby/i)).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('navigation', { name: '频道' })).toBeVisible();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
});

test('A-BR-04/05/06/07 多频道隔离、消息终态、审批与系统 Actor 隐藏', async ({ page, request }) => {
  await reset(request);
  await login(page);

  await page.getByRole('button', { name: /c0\.project/ }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.getByText(/c0\.project history 1/)).toBeVisible();
  await expect(page.locator('main').getByText(/^c0 history 1/)).toHaveCount(0);

  const roster = page.locator('.roster-panel');
  await expect(roster.getByText('project-agent', { exact: true })).toBeVisible();
  await expect(roster.getByText('system', { exact: true })).toHaveCount(0);
  await expect(roster.getByText('registrar', { exact: true })).toHaveCount(0);
  await expect(roster.getByText('svcactor', { exact: true })).toHaveCount(0);

  const message = `阶段A浏览器自动化-${Date.now()}`;
  await page.getByLabel('消息').fill(message);
  await page.getByRole('button', { name: /发送/ }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(page.getByText('PONG', { exact: true }).last()).toBeVisible();

  const approval = page.locator('.approval-card').first();
  await expect(approval.getByText('需要你的决定', { exact: true })).toBeVisible();
  await approval.getByRole('button', { name: '批准' }).click();
  await expect(approval.getByText('已回执', { exact: true })).toBeVisible();
  await expect(approval.getByText(/COMPLETED/)).toBeVisible();

  await request.post('http://127.0.0.1:8832/mock/control/action', { data: { type: 'pulse' } });
  await request.post('http://127.0.0.1:8832/mock/control/action', { data: { type: 'pulse' } });
  await expect(page.getByText(/project 动态 #2/)).toBeVisible();
  await expect(page.locator('main').getByText(/c0 动态 #1/)).toHaveCount(0);
});

test('A-BR-08/09 断线、权限撤销和频道退役后界面收敛', async ({ page, request }) => {
  await reset(request);
  await login(page);

  await page.getByRole('button', { name: /c0\.project/ }).click();
  await expect(page.getByLabel('消息')).toBeEnabled();

  await request.post('http://127.0.0.1:8832/mock/control/action', { data: { type: 'drop' } });
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();

  await request.post('http://127.0.0.1:8832/mock/control/action', {
    data: { type: 'revoke_membership', channel_id: 'c0.project' },
  });
  await expect(page.getByPlaceholder('加入频道后才能发送消息')).toBeDisabled();
  await expect(page.locator('.channel-rail').getByText('c0.project', { exact: true })).toBeVisible();

  await request.post('http://127.0.0.1:8832/mock/control/action', {
    data: { type: 'retire_channel', channel_id: 'c0.project' },
  });
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.locator('.channel-rail').getByText('c0.project', { exact: true })).toHaveCount(0);
});

test('A-BR-10 首次登录场景不伪造成员频道', async ({ page, request }) => {
  await reset(request, 'first-login', 32);
  await login(page);

  const rail = page.locator('.channel-rail');
  await expect(rail.getByText('还没有加入频道', { exact: true })).toBeVisible();
  await expect(page.getByLabel('消息')).toBeDisabled();
  await expect(page.getByLabel('消息')).toHaveAttribute('placeholder', '加入频道后才能发送消息');
  await expect(page.getByText(/lobby/i)).toHaveCount(0);
});
