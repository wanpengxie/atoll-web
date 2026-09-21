import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request, scenario, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario, seed },
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

async function clearProductCache(page) {
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key !== 'atoll.principal') localStorage.removeItem(key);
    }
  });
}

async function chooseRecipientIfNeeded(page) {
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
}

async function send(page, text) {
  await chooseRecipientIfNeeded(page);
  await page.getByLabel('消息').fill(text);
  await page.getByRole('button', { name: /发送/ }).click();
}

function channelItem(page, channelName) {
  return page.locator('.channel-item').filter({
    has: page.locator('.channel-name', { hasText: new RegExp(`^${channelName}$`) }),
  });
}

test('TC-0308 B-BR-08 keeps a pending request bound to its originating channel', async ({ page, request }) => {
  await reset(request, 'feed-delayed', 3081);
  await login(page);

  const message = `tc0308-channel-bound-${Date.now()}`;
  await send(page, message);
  await expect(page.getByText(message, { exact: true })).toHaveCount(1);

  await page.getByRole('button', { name: /c0\.project/ }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.locator('main').getByText(message, { exact: true })).toHaveCount(0);
  await page.waitForTimeout(1_000);
  await expect(page.locator('main').getByText(message, { exact: true })).toHaveCount(0);

  await channelItem(page, 'c0').click();
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.getByText(message, { exact: true })).toHaveCount(1);
  await expect(page.getByText('PONG', { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(message, { exact: true })).toHaveCount(1);

  await reset(request, 'approval', 3082);
  await clearProductCache(page);
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  const homeApproval = page.locator('.approval-card').first();
  await expect(homeApproval).toBeVisible();
  await homeApproval.getByRole('button', { name: '批准' }).click();

  await page.getByRole('button', { name: /c0\.project/ }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.locator('.approval-card').first().getByText('已回执', { exact: true })).toHaveCount(0);

  await channelItem(page, 'c0').click();
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.locator('.approval-card').first().getByText('已回执', { exact: true })).toBeVisible();
});
