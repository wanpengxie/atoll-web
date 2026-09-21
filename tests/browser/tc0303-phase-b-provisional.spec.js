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

async function send(page, text) {
  const chooser = page.getByRole('button', { name: '选择 Agent' });
  const recipient = page.getByRole('status', { name: '收件人' });
  await expect.poll(async () => (
    await chooser.isVisible().catch(() => false)
      || !/无收件人/.test(await recipient.textContent().catch(() => '无收件人'))
  )).toBe(true);
  if (await chooser.isVisible().catch(() => false)) {
    const opened = await chooser.click({ timeout: 1_000 }).then(() => true).catch(() => false);
    if (opened) {
      const menu = page.getByRole('menu', { name: '选择目标 Agent' });
      const steward = menu.getByRole('menuitem', { name: 'steward' });
      if (await steward.count()) await steward.click();
      else await menu.getByRole('menuitem').first().click();
    }
  }
  await page.getByLabel('消息').fill(text);
  await page.getByRole('button', { name: /发送/ }).click();
}

test('TC-0303 B-BR-05 keeps provisional state and first terminal authoritative', async ({ page, request }) => {
  await reset(request, 'business-provisional', 3031);
  await login(page);

  const businessText = `tc0303-business-${Date.now()}`;
  await send(page, businessText);
  const businessTurn = page.locator('.turn-card').filter({ hasText: businessText });
  await expect(businessTurn.locator('.agent-turn-bubble')).toBeVisible();
  await expect(page.getByText('PONG', { exact: true })).toBeVisible();

  await reset(request, 'terminal-conflict', 3032);
  await clearProductCache(page);
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();

  const terminalText = `tc0303-terminal-${Date.now()}`;
  await send(page, terminalText);
  await expect(page.getByText('PONG', { exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  const latestTurn = page.locator('.turn-card').last();
  await expect(latestTurn.getByText('PONG', { exact: true })).toBeVisible();
  await expect(latestTurn.getByText('FAILED', { exact: true })).toHaveCount(0);
});
