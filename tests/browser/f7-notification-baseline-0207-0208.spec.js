import { expect, test } from '@playwright/test';

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

async function chooseSteward(page) {
  const choose = page.getByRole('button', { name: '选择 Agent' });
  await expect(choose).toBeVisible();
  await choose.click();
  await page.getByRole('menu', { name: '选择目标 Agent' })
    .getByRole('menuitem', { name: 'steward' }).click();
}

async function startLongTask(page, text) {
  const editor = page.getByRole('textbox', { name: '消息', exact: true });
  await chooseSteward(page);
  await editor.fill(text);
  await editor.press('Enter');
  await expect(page.locator('.channel-agent-timer')).toHaveCount(1);
}

async function advanceComputation(request, count = 1) {
  for (let index = 0; index < count; index += 1) {
    const advanced = await request.post('/mock/control/advance', {
      data: { ms: 0, compute: { channel_id: 'c0' } },
    });
    expect(advanced.ok()).toBe(true);
  }
}

test('TC0207 F7 mobile channel drawer keeps Agent activity visible, bounded, and actionable', async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'long-running', seed: 2615 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await startLongTask(page, '移动端跨频道活动通知');

  const steward = page.locator('.timeline-actor-filter').getByRole('button', { name: 'steward', exact: true });
  await expect(steward).toHaveClass(/activity-active/);
  await page.getByRole('button', { name: '打开频道列表' }).click();
  const timer = page.locator('.channel-agent-timer');
  await expect(timer).toHaveCount(1);
  await expect(timer).toBeVisible();
  const activeGeometry = await page.evaluate(() => {
    const item = document.querySelector('.channel-item');
    const timerNode = document.querySelector('.channel-agent-timer');
    const itemBox = item.getBoundingClientRect();
    const timerBox = timerNode.getBoundingClientRect();
    return {
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      item: { left: itemBox.left, right: itemBox.right, height: itemBox.height },
      timer: { left: timerBox.left, right: timerBox.right },
    };
  });
  expect(activeGeometry.documentWidth).toBeLessThanOrEqual(activeGeometry.viewport);
  expect(activeGeometry.item.left).toBeGreaterThanOrEqual(0);
  expect(activeGeometry.item.right).toBeLessThanOrEqual(activeGeometry.viewport);
  expect(activeGeometry.item.height).toBeGreaterThanOrEqual(44);
  expect(activeGeometry.timer.left).toBeGreaterThanOrEqual(activeGeometry.item.left);
  expect(activeGeometry.timer.right).toBeLessThanOrEqual(activeGeometry.item.right);

  await page.setViewportSize({ width: 390, height: 844 });
  const regularMobileGeometry = await page.evaluate(() => ({
    viewport: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    timerRight: document.querySelector('.channel-agent-timer').getBoundingClientRect().right,
  }));
  expect(regularMobileGeometry.documentWidth).toBeLessThanOrEqual(regularMobileGeometry.viewport);
  expect(regularMobileGeometry.timerRight).toBeLessThanOrEqual(regularMobileGeometry.viewport);
  await page.setViewportSize({ width: 320, height: 720 });

  // Selecting the current channel closes the full-screen rail on mobile.
  await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0$/ }) }).click();
  await advanceComputation(request, 3);
  await expect(steward).toHaveClass(/activity-settled/);
  await steward.click();
  await expect(steward).toHaveAttribute('aria-pressed', 'true');
  await expect(steward.locator('.agent-activity-dot')).toHaveCount(0);
  const finalWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(finalWidth).toBeLessThanOrEqual(320);
});

test.describe('TC0208 F7 touch Agent filters', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('mobile Agent filter visually clears after the second tap', async ({ page, request }) => {
    const reset = await request.post('/mock/control/reset', { data: { scenario: 'multi-channel', seed: 2616 } });
    expect(reset.ok()).toBe(true);
    await login(page);

    const filter = page.locator('.timeline-actor-filter button').first();
    await expect(filter).toBeVisible();
    const idleBackground = await filter.evaluate((node) => getComputedStyle(node).backgroundColor);

    await filter.tap();
    await expect(filter).toHaveAttribute('aria-pressed', 'true');
    const selectedBackground = await filter.evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(selectedBackground).not.toBe(idleBackground);

    await filter.tap();
    await expect(filter).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => filter.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(idleBackground);
  });
});
