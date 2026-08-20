import { expect, test } from '@playwright/test';

test('WebSocket OPEN 后不会周期轮询频道与成员 OBS', async ({ page, request }) => {
  const reset = await request.post('http://127.0.0.1:8832/mock/control/reset', { data: { scenario: 'multi-channel', seed: 1601 } });
  expect(reset.ok()).toBe(true);
  const observationRequests = [];
  page.on('request', (entry) => {
    const path = new URL(entry.url()).pathname;
    if (path.startsWith('/obs/space/channels') || path === '/obs/space/memberships' || /\/obs\/channel\/[^/]+\/actors$/.test(path)) {
      observationRequests.push({ path, at: Date.now() });
    }
  });
  await page.goto('/');
  await page.getByLabel('邮箱').fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  await expect(page.getByText('c0.project', { exact: true })).toBeVisible();

  // 初始化 OBS 与首批 WS feed 完成后清空观测窗口；旧实现会在此窗口内至少
  // 再跑一轮 1.5 秒全树扫描。
  await page.waitForTimeout(1_000);
  observationRequests.length = 0;
  await page.waitForTimeout(2_200);
  expect(observationRequests).toEqual([]);
});
