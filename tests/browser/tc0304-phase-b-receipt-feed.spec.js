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

test('TC-0304 B-BR-06 keeps one visible request for either receipt/feed order', async ({ page, request }) => {
  await reset(request, 'feed-delayed', 3041);
  await login(page);

  const feedDelayed = `tc0304-feed-${Date.now()}`;
  await send(page, feedDelayed);
  await expect(page.getByText(feedDelayed, { exact: true })).toHaveCount(1);
  await expect(page.getByText('PONG', { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(feedDelayed, { exact: true })).toHaveCount(1);

  await reset(request, 'receipt-delayed', 3042);
  await clearProductCache(page);
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();

  const receiptDelayed = `tc0304-receipt-${Date.now()}`;
  await send(page, receiptDelayed);
  await expect(page.locator('.turn-card').getByText(receiptDelayed, { exact: true })).toBeVisible();
  await expect(page.getByText('PONG', { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.timeline').getByText(receiptDelayed, { exact: true })).toHaveCount(1);
});
