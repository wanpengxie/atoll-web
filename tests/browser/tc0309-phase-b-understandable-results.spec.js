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

test('TC-0309 B-BR-09 renders structured, empty-success, failed, and redacted results understandably', async ({ page, request }) => {
  await reset(request, 'message-structured-success', 3091);
  await login(page);
  await send(page, `tc0309-structured-${Date.now()}`);

  const structured = page.locator('.structured-result-details').filter({ hasText: '结构化结果' }).first();
  await expect(structured).toBeVisible();
  await expect(structured.getByText('instance_id', { exact: true })).toBeHidden();
  await structured.locator(':scope > summary').click();
  await expect(structured.getByText('instance_id', { exact: true })).toBeVisible();
  await expect(structured.getByText('已隐藏', { exact: true })).toBeVisible();
  const rows = structured.locator('.structured-array').first();
  await expect(rows.locator(':scope > p').getByText('25 项', { exact: true })).toBeVisible();
  await expect(rows.locator(':scope > .structured-array-item')).toHaveCount(20);

  await reset(request, 'message-empty-success', 3092);
  await clearProductCache(page);
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  await send(page, `tc0309-empty-${Date.now()}`);
  await expect(page.locator('.completion-ack')).toContainText('已完成');

  await reset(request, 'message-failed', 3093);
  await clearProductCache(page);
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  await send(page, `tc0309-failure-${Date.now()}`);
  await expect(page.getByText('接收方不支持这个操作', { exact: true })).toBeVisible();
  await expect(page.getByText('type_unsupported', { exact: true })).toBeVisible();
  await expect(page.getByText(/mock failure requested/).first()).toBeVisible();
});
