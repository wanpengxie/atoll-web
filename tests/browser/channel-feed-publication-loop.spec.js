import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

test('channel feed publication keeps the authenticated App mounted', async ({ page, request }) => {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'multi-channel', seed: 3191 },
  });
  expect(response.ok()).toBe(true);

  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await page.getByRole('textbox', { name: '账号' }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();

  await expect(page.getByRole('navigation', { name: '频道' })).toBeVisible();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  // The bootstrap identity probe is intentionally rejected before login. The
  // loop oracle starts at the authenticated surface and includes every later
  // console/page error, not only React's old depth warning.
  errors.length = 0;
  await page.waitForTimeout(8_000);
  expect(errors).toEqual([]);
});
