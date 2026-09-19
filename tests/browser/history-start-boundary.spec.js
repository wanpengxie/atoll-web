import { expect, test } from '@playwright/test';

// The history-start marker is part of the production conversation surface.
// Keep this contract on App -> ConversationSurface -> VendorListExecutor;
// fixture-only Virtuoso probes were retired with the old dual-list owner.

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('.timeline-reading-layer.is-active .timeline-message-list')).toBeVisible();
}

function list(page) {
  return page.locator('.timeline-reading-layer.is-active .timeline-message-list');
}

async function wheel(page, viewport, deltaY, count = 1) {
  await viewport.hover();
  for (let index = 0; index < count; index += 1) {
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(40);
  }
}

test('authoritative history start is an ordinary scrolling item', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1120, height: 420 });
  const reset = await request.post('/mock/control/reset', {
    data: { scenario: 'history-boundary', seed: 0x92_48_01 },
  });
  expect(reset.ok()).toBe(true);
  await login(page);
  const viewport = list(page);
  await expect(page.getByText('c0 history 22: ask steward for PONG', { exact: true })).toBeVisible();

  await wheel(page, viewport, -2_000, 8);
  const boundary = viewport.locator('.timeline-history-boundary[data-phase="exhausted"]');
  await expect(boundary).toBeVisible();
  await expect(page.getByText('c0 history 1: ask steward for PONG', { exact: true })).toBeVisible();

  const atStart = await boundary.evaluate((node) => {
    const root = node.closest('.timeline-message-list');
    const rootRect = root.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    const first = root.querySelector('[data-presentation-row-id]');
    return {
      position: getComputedStyle(node).position,
      top: rect.top,
      listTop: rootRect.top,
      listBottom: rootRect.bottom,
      scrollTop: root.scrollTop,
      beforeFirstMessage: Boolean(first && (node.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING)),
    };
  });
  expect(['absolute', 'fixed', 'sticky']).not.toContain(atStart.position);
  expect(atStart.beforeFirstMessage).toBe(true);
  expect(atStart.top).toBeGreaterThanOrEqual(atStart.listTop - 2);
  expect(atStart.top).toBeLessThan(atStart.listBottom + 2);

  await wheel(page, viewport, 5_000);
  await expect.poll(() => boundary.evaluate((node) => {
    const root = node.closest('.timeline-message-list');
    return node.getBoundingClientRect().bottom < root.getBoundingClientRect().top;
  })).toBe(true);
  await wheel(page, viewport, -5_000);
  await expect.poll(() => boundary.evaluate((node) => {
    const root = node.closest('.timeline-message-list');
    const rect = node.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    return rect.bottom >= rootRect.top - 1 && rect.top <= rootRect.bottom + 1;
  })).toBe(true);

  const evidence = await page.evaluate(() => ({
    mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
    boundaryCount: document.querySelectorAll('.timeline-history-boundary').length,
    resizeObserverLoops: (window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || [])
      .filter((entry) => entry.event === 'window.resize_observer_loop'),
  }));
  await testInfo.attach('history-start-boundary.json', {
    body: JSON.stringify({ atStart, ...evidence }, null, 2), contentType: 'application/json',
  });
  expect(evidence.boundaryCount).toBe(1);
  expect(evidence.resizeObserverLoops).toEqual([]);
});

test('an open history frontier prepends without moving the existing row geometry', async ({ page, request }) => {
  await page.setViewportSize({ width: 1120, height: 620 });
  const reset = await request.post('/mock/control/reset', {
    data: { scenario: 'deep-history', seed: 0x92_48_02 },
  });
  expect(reset.ok()).toBe(true);
  await login(page);
  const viewport = list(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  await viewport.evaluate((root) => { root.scrollTop = root.clientHeight + 160; });
  await page.waitForTimeout(100);
  const before = await viewport.evaluate((root) => {
    const row = root.querySelector('[data-presentation-row-id]');
    const rect = row?.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    return { id: row?.dataset.presentationRowId || '', top: rect ? rect.top - rootRect.top : null, height: row?.getBoundingClientRect().height || 0 };
  });
  expect(before.id).not.toBe('');
  await wheel(page, viewport, -5_000);
  await page.waitForTimeout(500);
  const after = await viewport.evaluate((root, id) => {
    const row = root.querySelector(`[data-presentation-row-id="${CSS.escape(id)}"]`);
    const rect = row?.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    return { connected: Boolean(row?.isConnected), top: rect ? rect.top - rootRect.top : null, height: row?.getBoundingClientRect().height || 0, boundaryCount: root.querySelectorAll('.timeline-history-boundary').length };
  }, before.id);
  expect(after.connected).toBe(true);
  expect(after.height).toBe(before.height);
  expect(after.boundaryCount).toBe(0);
});
