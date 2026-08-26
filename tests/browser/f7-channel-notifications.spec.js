import { expect, test } from '@playwright/test';

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

async function startLongTask(page, text) {
  const editor = page.getByLabel('消息');
  await editor.fill('@st');
  await page.getByRole('option', { name: /steward/ }).click();
  await editor.press('End');
  await editor.pressSequentially(text);
  await page.getByRole('button', { name: /发送/ }).click();
  await expect(page.locator('.channel-agent-timer')).toHaveCount(1);
}

async function advanceComputation(request, count = 1) {
  for (let index = 0; index < count; index += 1) {
    const advanced = await request.post('/mock/control/advance', { data: { ms: 0, compute: { channel_id: 'c0' } } });
    expect(advanced.ok()).toBe(true);
  }
}

test('F7 channel notifications baseline history, count root turns, and clear only at the visible tail', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'multi-channel', seed: 2608 } });
  expect(reset.ok()).toBe(true);
  await login(page);

  const channel = page.locator('.channel-item').filter({ hasText: 'c0.project' });
  const related = channel.locator('.unread-related');
  const other = channel.locator('.unread-total');
  await expect(related).toHaveCount(0);
  await expect(other).toHaveCount(0);

  const terminal = async (index) => {
    const response = await request.post('/mock/control/action', {
      data: { type: 'push_terminal', channel_id: 'c0.project', request_id: `c0.project-history-request-${index}` },
    });
    expect(response.ok()).toBe(true);
  };

  await terminal(1);
  await expect(related).toHaveText('1');
  await expect(other).toHaveCount(0);

  // Several settled frames in one root turn remain one notification.
  await terminal(1);
  await expect(related).toHaveText('1');
  await terminal(2);
  await expect(related).toHaveText('2');

  await channel.click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(related).toHaveCount(0);

  const viewport = page.locator('.timeline-message-list');
  await viewport.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await terminal(3);
  await expect(related).toHaveText('1');

  await viewport.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
    node.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect(related).toHaveCount(0);
});

test('F7 channel rail exposes live Agent timers and Agent buttons acknowledge completion', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'long-running', seed: 2610 } });
  expect(reset.ok()).toBe(true);
  await login(page);

  await startLongTask(page, '验证跨频道运行通知');

  const home = page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0$/ }) });
  await expect(home.locator('.channel-agent-timer')).toHaveCount(1);
  await expect(page.locator('.timeline-actor-filter').getByRole('button', { name: 'steward' })).toHaveClass(/activity-active/);

  const project = page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0\.project$/ }) });
  await project.click();
  await expect(home.locator('.channel-agent-timer')).toHaveCount(1);
  await home.click();

  await advanceComputation(request, 3);
  await expect(home.locator('.channel-agent-timer')).toHaveCount(0);
  const steward = page.locator('.timeline-actor-filter').getByRole('button', { name: 'steward' });
  await expect(steward).toHaveClass(/activity-settled/);
  await steward.click();
  await expect(steward).not.toHaveClass(/activity-settled/);
  await expect(steward.locator('.agent-activity-dot')).toHaveCount(0);
});

test('F7 server boot change cannot leave a zombie Agent timer', async ({ page, request }) => {
  let response = await request.post('/mock/control/reset', { data: { scenario: 'long-running', seed: 2611 } });
  expect(response.ok()).toBe(true);
  await login(page);
  await startLongTask(page, '后端重启前的长任务');

  response = await request.post('/mock/control/reset', { data: { scenario: 'multi-channel', seed: 2612 } });
  expect(response.ok()).toBe(true);
  response = await request.post('/mock/control/action', { data: { type: 'drop' } });
  expect(response.ok()).toBe(true);
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/, { timeout: 15_000 });
  await expect(page.locator('.channel-agent-timer')).toHaveCount(0);
  await expect(page.locator('.timeline-actor-filter .agent-activity-dot')).toHaveCount(0);
});

test('F7 unresolved history after a same-boot reload stays quiet until fresh live progress', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'long-running', seed: 2613 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await startLongTask(page, '刷新前保持运行但不制造僵尸');

  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('.channel-agent-timer')).toHaveCount(0);
  await expect(page.locator('.timeline-actor-filter .agent-activity-dot')).toHaveCount(0);

  // The task really is still alive: one new live progress frame confirms the
  // current generation and restores both timer and green Agent dot.
  await advanceComputation(request);
  await expect(page.locator('.channel-agent-timer')).toHaveCount(1);
  await expect(page.locator('.timeline-actor-filter').getByRole('button', { name: 'steward' })).toHaveClass(/activity-active/);
});

test('F7 completion during a same-boot disconnect reconciles to red, never zombie green', async ({ page, request }) => {
  let response = await request.post('/mock/control/reset', { data: { scenario: 'long-running', seed: 2614 } });
  expect(response.ok()).toBe(true);
  await login(page);
  await startLongTask(page, '断线期间完成的任务');

  response = await request.post('/mock/control/action', { data: { type: 'drop' } });
  expect(response.ok()).toBe(true);
  await expect(page.locator('.connection-state')).toHaveClass(/state-reconnecting/);
  await advanceComputation(request, 3);
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/, { timeout: 15_000 });
  await expect(page.locator('.channel-agent-timer')).toHaveCount(0);
  const steward = page.locator('.timeline-actor-filter').getByRole('button', { name: 'steward' });
  await expect(steward).toHaveClass(/activity-settled/);
  await expect(steward).not.toHaveClass(/activity-active/);
});

test('F7 mobile channel drawer keeps Agent activity visible, bounded, and actionable', async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'long-running', seed: 2615 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await startLongTask(page, '移动端跨频道活动通知');

  const steward = page.locator('.timeline-actor-filter').getByRole('button', { name: 'steward' });
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
  await expect(steward.locator('.agent-activity-dot')).toHaveCount(0);
  const finalWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(finalWidth).toBeLessThanOrEqual(320);
});

test.describe('touch Agent filters', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('F7 mobile Agent filter visually clears after the second tap', async ({ page, request }) => {
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
