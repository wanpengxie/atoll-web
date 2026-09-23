import { expect, test } from '@playwright/test';

// A reload opens the channel in the address; an address without a channel
// opens the channel this browser was last on — not the first membership
// (the warm-boot path used to pick that from the cached bootstrap).
test('reload and a bare address both return to the last channel', async ({ page, request }) => {
  await request.post('/mock/control/reset', { data: { scenario: 'multi-channel', seed: 1 } });
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0\.project$/ }) }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');

  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0.project');

  await page.goto(page.url().split('#')[0]);
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page).toHaveURL(/#\/channels\/c0\.project\/conversation$/);
});
