import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request, scenario, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

async function clearProductCache(page) {
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key !== 'atoll.principal') localStorage.removeItem(key);
    }
  });
}

test('TC-0305 B-BR-06a preserves an early draft until a target arrives', async ({ page, request }) => {
  await reset(request, 'feed-delayed', 3051);
  await login(page);

  const fault = await request.post(`${MOCK}/mock/control/fault`, {
    data: { target: 'obs', mode: 'delay', delay_ms: 2_500, count: 20 },
  });
  expect(fault.ok()).toBe(true);

  const sentFrames = [];
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      try { sentFrames.push(JSON.parse(String(payload))); } catch { /* binary */ }
    });
  });
  await clearProductCache(page);
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();

  const message = `tc0305-early-${Date.now()}`;
  const editor = page.getByLabel('消息');
  await editor.fill(message);
  await page.getByRole('button', { name: /发送/ }).click();
  await expect(page.getByRole('alert')).toHaveText('请选择收件人或目标 Agent');
  expect(sentFrames.filter((frame) => (
    frame.frame_type === 'submit' && frame.payload?.msg_type === 'agent.ask'
  ))).toHaveLength(0);
  await expect(editor).toHaveText(message);

  const chooser = page.getByRole('button', { name: '选择 Agent' });
  await expect(chooser).toBeVisible();
  await chooser.click();
  const menu = page.getByRole('menu', { name: '选择目标 Agent' });
  await expect(menu.getByRole('menuitem').first()).toBeVisible({ timeout: 6_000 });
  const steward = menu.getByRole('menuitem', { name: 'steward' });
  if (await steward.count()) await steward.click();
  else await menu.getByRole('menuitem').first().click();
  await page.getByRole('button', { name: /发送/ }).click();
  await expect(page.getByText('PONG', { exact: true })).toBeVisible({ timeout: 8_000 });
  expect(sentFrames.filter((frame) => (
    frame.frame_type === 'submit' && frame.payload?.msg_type === 'agent.ask'
  ))).toHaveLength(1);
});
