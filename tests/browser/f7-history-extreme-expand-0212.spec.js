import { expect, test } from '@playwright/test';

async function reset(request, scenario, seed) {
  const response = await request.post('/mock/control/reset', { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

test('TC0212 public extreme history row enters the list and expands', async ({ page, request }) => {
  await reset(request, 'extreme-height-history', 1731);
  await login(page);
  const viewport = page.locator('.timeline-message-list');
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const active = page.locator('.timeline-reading-layer.is-active');
  const row = active.locator('[data-presentation-row-id="c0-history-request-104"]');
  for (let step = 0; step < 100 && await row.count() === 0; step += 1) {
    await viewport.hover();
    await page.mouse.wheel(0, -480);
    await page.waitForTimeout(20);
  }
  await expect(row).toHaveCount(1);
  await expect(row).toBeVisible();
  await expect(row).toContainText('c0 PONG 104');

  const toggle = row.getByRole('button', { name: /展开全文/ }).first();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(row.getByRole('button', { name: '收起', exact: true }).first()).toHaveAttribute('aria-expanded', 'true');
  await expect(row).toContainText('超长历史回复第 180 行');
});
