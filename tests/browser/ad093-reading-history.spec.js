import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function login(page, request, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'multi-channel', seed },
  });
  expect(response.ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

for (const [width, label] of [[1280, 'desktop'], [320, 'mobile']]) {
  test(`AD-093 ${label} 从频道边缘打开最近阅读并返回原入口焦点`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 720 });
    await login(page, request, width === 1280 ? 3093 : 3094);
    const opener = page.getByRole('button', { name: '打开最近阅读' });
    await expect(opener).toBeVisible();
    await opener.focus();
    await opener.click();

    const panel = page.getByRole('complementary', { name: '最近阅读' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: '最近阅读' })).toBeVisible();
    await panel.getByRole('button', { name: '关闭最近阅读' }).click();
    await expect(opener).toBeFocused();
  });
}
