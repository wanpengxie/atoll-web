import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request, seed = 190101) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'file-reference', seed },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page).toHaveTitle(/Atoll/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

test('NR19-01 absolute Markdown path opens in the Atoll artifact owner', async ({ page, request }) => {
  await reset(request);
  await login(page);

  const before = page.url();
  const link = page.getByRole('link', { name: 'path-preview-demo.go 第 4 行', exact: true });
  await expect(link).toBeVisible({ timeout: 15_000 });
  await expect(link).not.toHaveAttribute('target', '_blank');

  await link.click();

  const detail = page.getByRole('complementary', { name: '文件详情' });
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('path-preview-demo.go');
  await expect(detail.locator('[data-line="4"]')).toContainText('这行来自 Agent 返回的宿主绝对路径');
  await expect(page).toHaveURL(before);
});
