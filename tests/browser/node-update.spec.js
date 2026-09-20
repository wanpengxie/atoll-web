import { expect, test } from '@playwright/test';

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号' }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

test('AD-202/203 root sees one confirmed update action and the real progress/version projection', async ({ page }) => {
  test.setTimeout(20_000);
  let starts = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/update') starts += 1;
  });
  await login(page);

  const action = page.getByRole('button', { name: '升级到 v0.07' });
  await expect(action).toHaveCount(1);
  await expect(action).toBeEnabled();
  await expect(page.getByLabel('当前版本（只读）')).toHaveText('当前版本：v0.06（只读）');

  page.once('dialog', (dialog) => dialog.accept());
  await action.click();
  await expect(page.getByRole('button', { name: /正在下载|正在重启/ })).toBeDisabled();
  await expect.poll(() => starts).toBe(1);
  await expect(page.getByLabel('当前版本（只读）')).toHaveText('当前版本：v0.07（只读）', { timeout: 8_000 });
  await expect(page.getByRole('button', { name: /升级到|正在|升级失败/ })).toHaveCount(0);
});

test('AD-202/203 HTTP 503 and development build are explicit unavailable states', async ({ page }) => {
  await page.route('**/api/update*', async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'unavailable', detail: 'automatic update unavailable' }),
    });
  });
  await login(page);
  const unavailable = page.getByRole('button', { name: 'automatic update unavailable' });
  await expect(unavailable).toHaveCount(1);
  await expect(unavailable).toBeDisabled();

  await page.unroute('**/api/update*');
  await page.route('**/api/update*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ current_version: 'dev', available: false, status: 'idle', detail: '开发版不执行自动升级' }),
    });
  });
  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  const development = page.getByRole('button', { name: '开发版不执行自动升级' });
  await expect(development).toHaveCount(1);
  await expect(development).toBeDisabled();
  await expect(page.getByLabel('当前版本（只读）')).toHaveText('当前版本：dev（只读）');
});
