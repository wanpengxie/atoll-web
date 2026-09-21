import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'multi-channel', seed: 31 },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.getByRole('navigation', { name: '频道' })).toBeVisible();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

test('TC0291 login restores the root channel while the lobby stays hidden', async ({ page, request }) => {
  await reset(request);
  await login(page);

  const rail = page.locator('.channel-rail');
  await expect(rail.locator('.rail-caption').filter({ hasText: '我的频道' })).toBeVisible();
  await expect(rail.locator('.rail-caption').filter({ hasText: '空间' })).toBeVisible();
  await expect(rail.getByText('c0', { exact: true })).toBeVisible();
  await expect(rail.getByText('c0.project', { exact: true })).toBeVisible();
  await expect(rail.getByText('c0.public', { exact: true })).toBeVisible();
  await expect(page.getByText(/lobby/i)).toHaveCount(0);
  await expect(page.locator('main h1')).toHaveText('c0');

  await page.reload();
  await expect(page.getByRole('navigation', { name: '频道' })).toBeVisible();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(rail.getByText('c0', { exact: true })).toBeVisible();
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.getByText(/lobby/i)).toHaveCount(0);
});
