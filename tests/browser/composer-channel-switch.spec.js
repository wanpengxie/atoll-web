import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', { data: { scenario: 'multi-channel', seed: 0x4e_02 } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.locator('.composer-richtext')).toBeVisible();
}

test('channel replacement keeps the Composer mounted through the EditorView handoff', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await reset(request);
  await login(page);

  await page.getByRole('button', { name: '# c0.project', exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.locator('.composer-richtext')).toBeVisible();

  await page.getByRole('button', { name: '# c0', exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.locator('.composer-richtext')).toBeVisible();
  expect(errors.filter((line) => /editor view is not available|Cannot read properties of null/.test(line))).toEqual([]);
});
