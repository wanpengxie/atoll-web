import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

test('R30 cleanup: logout retires the feed owner without an uncaught teardown error', async ({ page, request }) => {
  const reset = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'multi-channel', seed: 3001 },
  });
  expect(reset.ok()).toBe(true);

  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号' }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);

  await page.getByRole('button', { name: '退出' }).click();
  await expect(page.getByRole('textbox', { name: '账号' })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
