import { expect, test } from '@playwright/test';

const UNSUPPORTED_UPDATE = '当前版本不支持安全升级，请刷新或联系管理员/手动升级';

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号' }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

test('AD-202/203 unavailable node update is explicit, read-only, and network-free', async ({ page }) => {
  let updateRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/update') updateRequests += 1;
  });
  await login(page);

  const action = page.getByRole('button', { name: UNSUPPORTED_UPDATE });
  await expect(action).toHaveCount(1);
  await expect(action).toBeDisabled();
  await expect(page.getByLabel('当前版本（只读）')).toHaveText('当前版本：未提供（只读）');
  expect(updateRequests).toBe(0);
});
