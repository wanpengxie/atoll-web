import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'receipt-lost-feed-landed', seed: 3061 },
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

async function send(page, message) {
  const chooseAgent = page.getByRole('button', { name: '选择 Agent' });
  const recipient = page.getByRole('status', { name: '收件人' });
  // Preserve the legacy contract's public recipient admission step.  Initial
  // OBS may expose the composer before a default target; wait for either the
  // chooser or a derived recipient rather than clicking Send without a
  // target.
  await expect.poll(async () => (
    await chooseAgent.isVisible().catch(() => false)
      || !/无收件人/.test(await recipient.textContent().catch(() => '无收件人'))
  )).toBe(true);
  if (await chooseAgent.isVisible().catch(() => false)) {
    const opened = await chooseAgent.click({ timeout: 1_000 }).then(() => true).catch(() => false);
    if (opened) {
      const menu = page.getByRole('menu', { name: '选择目标 Agent' });
      const steward = menu.getByRole('menuitem', { name: 'steward' });
      if (await steward.count()) await steward.click();
      else await menu.getByRole('menuitem').first().click();
    }
  }
  const editor = page.getByLabel('消息');
  await expect(editor).toBeEnabled();
  await editor.fill(message);
  await page.getByRole('button', { name: '发送', exact: true }).click();
}

test('TC-0306 B-BR-07 reconciles a lost receipt from the landed feed as one public terminal message', async ({ page, request }) => {
  await reset(request);
  await login(page);

  const message = `receipt-lost-${Date.now()}`;
  await send(page, message);

  // The receipt is intentionally dropped by the public mock, while the feed
  // lands immediately.  The user-facing ledger fact must still settle once.
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible({ timeout: 10_000 });
  const timeline = page.getByRole('region', { name: '频道动态', exact: true });
  await expect(timeline).toBeVisible();
  await expect(timeline.getByText(message, { exact: true })).toHaveCount(1);
  await expect(page.getByText('PONG', { exact: true })).toBeVisible();
  await expect(page.locator('.composer-status.state-uncertain')).toHaveCount(0);
});
