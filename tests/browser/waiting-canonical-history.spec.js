import { expect, test } from '@playwright/test';

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.getByRole('region', { name: '频道动态' })).toBeVisible();
}

test('loading completed history never invents a visible waiting task', async ({ page, request }) => {
  test.slow();
  const reset = await request.post('/mock/control/reset', {
    data: { scenario: 'long-running-history', seed: 0x92_17_01 },
  });
  expect(reset.ok()).toBe(true);
  await login(page);

  const timeline = page.getByRole('region', { name: '频道动态' });
  await expect(page.getByRole('region', { name: '等待区' })).toHaveCount(0);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  await timeline.hover();
  for (let step = 0; step < 10; step += 1) {
    await page.mouse.wheel(0, -4_000);
    await page.waitForTimeout(120);
    await expect(page.getByRole('region', { name: '等待区' })).toHaveCount(0);
  }

  await expect(page.locator('[data-presentation-row-id]:visible').first()).toContainText('c0 history');
});
