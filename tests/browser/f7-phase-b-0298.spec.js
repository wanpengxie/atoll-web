import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'multi-channel', seed: 811 },
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

test('B-BR-02b 慢 OBS 不阻塞缓存首屏，档案补全不重建消息连接', async ({ page, request }) => {
  await reset(request);
  await login(page);
  await expect(page.getByText(/c0 history 1/)).toBeVisible();

  const fault = await request.post(`${MOCK}/mock/control/fault`, {
    data: { target: 'obs', mode: 'delay', delay_ms: 2_500, count: 20 },
  });
  expect(fault.ok()).toBe(true);

  const sockets = [];
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname === '/ws') sockets.push(socket.url());
  });

  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/, { timeout: 1_500 });
  await expect(page.getByText(/c0 history 1/)).toBeVisible({ timeout: 1_500 });

  await page.waitForTimeout(2_700);
  expect(sockets).toHaveLength(1);
  await expect(page.getByText(/c0 history 1/)).toBeVisible();
});
