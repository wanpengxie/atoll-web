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

test('F7 channel notifications baseline history, count roots, and acknowledge only exact visible identities', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'multi-channel', seed: 2608 } });
  expect(reset.ok()).toBe(true);
  await login(page);

  const channel = page.locator('.channel-item').filter({ hasText: 'c0.project' });
  const related = channel.locator('.unread-related');
  const other = channel.locator('.unread-total');
  await expect(related).toHaveCount(0);
  await expect(other).toHaveCount(0);

  // Keep the two roots physically above the initial tail viewport. The old
  // three-turn fixture now fits in one viewport, which would correctly exact-
  // acknowledge both roots immediately and no longer exercise this boundary.
  const tail = await request.post('/mock/control/action', {
    data: { type: 'notification_lifecycle', channel_id: 'c0.project', phase: 'tail', count: 24 },
  });
  expect(tail.ok()).toBe(true);

  const terminal = async (index) => {
    const response = await request.post('/mock/control/action', {
      data: {
        type: 'push_terminal',
        channel_id: 'c0.project',
        request_id: `c0.project-history-request-${index}`,
        payload: { text: `answer ${index}` },
      },
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
  // `mine` is a filtered semantic view: entering may acknowledge a root that
  // is physically visible at the restored boundary, but must retain every root
  // still above the viewport. Exact font metrics decide whether one is already
  // exposed here.
  await expect.poll(async () => (
    await related.count() ? Number(await related.textContent()) : 0
  )).toBeGreaterThan(0);
  const remainingOnEntry = Number(await related.textContent());
  expect(remainingOnEntry).toBeLessThanOrEqual(2);

  const viewport = page.locator('.timeline-message-list');
  // Use a physical gesture: the timeline intentionally distinguishes user
  // scrolling from the virtualizer's own anchor compensation.
  await viewport.hover();
  await page.mouse.wheel(0, -100_000);
  await expect.poll(() => viewport.evaluate((node) => (
    node.scrollHeight - node.clientHeight - node.scrollTop
  ))).toBeGreaterThan(24);
  // The first viewport can expose one or both roots depending on exact font
  // metrics. Every root actually seen must clear; if one sits under the
  // floating controls, reveal that exact still-unread identity next.
  expect(await related.count()).toBeLessThanOrEqual(1);
  if (await related.count()) {
    const unreadID = await page.evaluate(() => (
      window.__ATOLL_DIAGNOSTICS__?.rail?.snapshot?.('c0.project')?.channels?.[0]?.rows
        ?.find((row) => row.ackReason === 'counted_related')?.id || ''
    ));
    expect(unreadID).toBeTruthy();
    await page.locator(`[data-entry-id="${unreadID}"]`).evaluate((node) => node.scrollIntoView({ block: 'center' }));
    await expect(related).toHaveCount(0);
  }
  await terminal(3);
  // Root 3 is already exposed in this viewport. Its later final revision is
  // real answer content, but it is acknowledged immediately by that exact
  // visible root+seq evidence rather than flashing a badge.
  await expect(related).toHaveCount(0);

  await page.mouse.wheel(0, 100_000);
  await expect.poll(() => viewport.evaluate((node) => (
    node.scrollHeight - node.clientHeight - node.scrollTop
  ))).toBeLessThanOrEqual(24);
  // Reaching the physical bottom does not itself grant a filtered view
  // authority over other identities. The now-visible root is nevertheless
  // acknowledged exactly even if the reader has not reclaimed following.
  await expect(related).toHaveCount(0);
});

test('F7 inactive-channel business and core progress never create rail or new-dynamic counts', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'multi-channel', seed: 2620 } });
  expect(reset.ok()).toBe(true);
  await login(page);

  const project = page.locator('.channel-item').filter({ hasText: 'c0.project' });
  for (let index = 0; index < 20; index += 1) {
    const response = await request.post('/mock/control/action', {
      data: {
        type: 'push_provisional', channel_id: 'c0.project',
        request_id: `c0.project-history-request-${index % 2 + 1}`,
        status: 'provider.waiting', payload: { step: index + 1 },
      },
    });
    expect(response.ok()).toBe(true);
  }
  const dense = await request.post('/mock/control/action', {
    data: { type: 'dense_progress', channel_id: 'c0.project', count: 40 },
  });
  expect(dense.ok()).toBe(true);

  await expect(project.locator('.unread-related')).toHaveCount(0);
  await expect(project.locator('.unread-total')).toHaveCount(0);
  await project.click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.getByRole('button', { name: /条新动态/ })).toHaveCount(0);
  await expect(project.locator('.unread-related')).toHaveCount(0);
  await expect(project.locator('.unread-total')).toHaveCount(0);
});

test('F7 channel rail exposes live Agent timers and the member filter acknowledges completion', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'long-running', seed: 2610 } });
  expect(reset.ok()).toBe(true);
  await login(page);

  await startLongTask(page, '验证跨频道运行通知');

  const home = page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0$/ }) });
  await expect(home.locator('.channel-agent-timer')).toHaveCount(1);
  await expect(page.locator('.timeline-actor-filter').getByRole('button', { name: 'steward', exact: true })).toHaveClass(/activity-active/);

  const project = page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0\.project$/ }) });
  await project.click();
  await expect(home.locator('.channel-agent-timer')).toHaveCount(1);
  await home.click();

  await advanceComputation(request, 3);
  await expect(home.locator('.channel-agent-timer')).toHaveCount(0);
  const steward = page.locator('.timeline-actor-filter').getByRole('button', { name: 'steward', exact: true });
  await expect(steward).toHaveClass(/activity-settled/);
  await steward.click();
  await expect(steward).toHaveAttribute('aria-pressed', 'true');
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
  await expect(page.locator('.timeline-actor-filter').getByRole('button', { name: 'steward', exact: true })).toHaveClass(/activity-active/);
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
  const steward = page.locator('.timeline-actor-filter').getByRole('button', { name: 'steward', exact: true });
  await expect(steward).toHaveClass(/activity-settled/);
  await expect(steward).not.toHaveClass(/activity-active/);
});

test('F7 mobile channel drawer keeps Agent activity visible, bounded, and actionable', async ({ page, request }) => {
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
