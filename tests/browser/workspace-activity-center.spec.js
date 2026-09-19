import { expect, test } from '@playwright/test';

const MOCK_ORIGIN = process.env.ATOLL_MOCK_ORIGIN || '';

async function reset(request, scenario, seed) {
  const response = await request.post(`${MOCK_ORIGIN}/mock/control/reset`, {
    data: { scenario, seed },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号' }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('c0');
}

async function openActivity(page) {
  await page.getByRole('button', { name: '打开活动中心' }).click();
  const panel = page.getByRole('complementary', { name: '全局活动' });
  await expect(panel).toBeVisible();
  return panel;
}

test('Activity Center is composed from the live Workspace Feed and returns to its source', async ({ page, request }) => {
  await reset(request, 'approval-schema', 1414);
  await login(page);

  const panel = await openActivity(page);
  const rows = panel.locator('.activity-list').getByRole('button');
  await expect(rows.first()).toBeVisible();
  await expect(rows.first()).toContainText('c0');

  await rows.first().click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('c0');
  await expect(page.getByRole('tab', { name: '动态', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('Activity Center has a safe unavailable state and does not survive channel ownership changes', async ({ page, request }) => {
  await reset(request, 'multi-channel', 1415);
  await login(page);

  const panel = await openActivity(page);
  await panel.getByRole('button', { name: '关闭活动中心' }).click();
  await expect(panel).toHaveCount(0);
  const projectChannel = page.getByRole('button').filter({ hasText: 'c0.project' }).first();
  await expect(projectChannel).toBeVisible();
  await projectChannel.click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('c0.project');
  await expect(page.getByRole('complementary', { name: '全局活动' })).toHaveCount(0);

  const projectPanel = await openActivity(page);
  await projectPanel.getByRole('tab', { name: '操作', exact: true }).click();
  await expect(projectPanel.getByText('没有进行中的操作', { exact: true })).toBeVisible();

  const dropped = await request.post(`${MOCK_ORIGIN}/mock/control/action`, {
    data: { type: 'drop' },
  });
  expect(dropped.ok()).toBe(true);
  await expect(projectPanel.getByText('当前没有可用的进行中操作快照', { exact: true })).toBeVisible({ timeout: 5_000 });
});
