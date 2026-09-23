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
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1120, height: 620 });
  const reset = await request.post('/mock/control/reset', {
    data: { scenario: 'deep-history', seed: 0x92_48_02 },
  });
  expect(reset.ok()).toBe(true);
  await login(page);
  const viewport = list(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  await viewport.hover();
  // Move into history with ordinary wheel input. scrollTop is not a measure
  // of "how far up": a prepend raises it by the prepended height while the
  // screen holds still. What moved is read from the rows themselves.
  const newestOnScreen = () => viewport.evaluate((root) => {
    const rect = root.getBoundingClientRect();
    const ids = [...root.querySelectorAll('[data-presentation-row-id]')]
      .filter((node) => { const r = node.getBoundingClientRect(); return r.bottom > rect.top && r.top < rect.bottom; })
      .map((node) => Number(node.dataset.presentationRowId?.match(/history-request-(\d+)$/)?.[1]))
      .filter(Number.isFinite);
    return ids.length ? Math.max(...ids) : Infinity;
  });
  for (let notch = 0; notch < 20 && await newestOnScreen() >= 118; notch += 1) {
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(120);
  }
  await expect.poll(newestOnScreen).toBeLessThan(118);
  // The row at the top of the screen right before each notch is the anchor:
  // on the notch that prepends an older page, that row must move by exactly
  // the reader's own notch — the prepended height must not show.
  const topRow = () => viewport.evaluate((root) => {
    const rootRect = root.getBoundingClientRect();
    const row = [...root.querySelectorAll('[data-presentation-row-id]')]
      .find((candidate) => { const r = candidate.getBoundingClientRect(); return r.top >= rootRect.top - 1 && r.top < rootRect.bottom && getComputedStyle(candidate).visibility !== 'hidden'; });
    const rect = row?.getBoundingClientRect();
    return { id: row?.dataset.presentationRowId || '', top: rect ? rect.top - rootRect.top : null, height: rect?.height || 0, scrollHeight: root.scrollHeight, firstID: root.querySelector('[data-presentation-row-id]')?.dataset.presentationRowId || '' };
  });
  const rowAt = (id) => viewport.evaluate((root, rowID) => {
    const row = root.querySelector(`[data-presentation-row-id="${CSS.escape(rowID)}"]`);
    const rect = row?.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    return { connected: Boolean(row?.isConnected), top: rect ? rect.top - rootRect.top : null, height: rect?.height || 0, scrollHeight: root.scrollHeight, firstID: root.querySelector('[data-presentation-row-id]')?.dataset.presentationRowId || '', boundaryCount: root.querySelectorAll('.timeline-history-boundary').length };
  }, id);
  let prepend = null;
  for (let notch = 0; notch < 30 && !prepend; notch += 1) {
    const before = await topRow();
    expect(before.id).not.toBe('');
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(160);
    const after = await rowAt(before.id);
    if (after.scrollHeight > before.scrollHeight) prepend = { before, after };
  }
  expect(prepend, 'reading upward reaches an older page').not.toBeNull();
  const { before, after } = prepend;
  expect(after.connected).toBe(true);
  expect(after.height).toBe(before.height);
  expect(after.firstID).not.toBe(before.firstID);
  // Wheel up 300: the anchor moves down by the notch, not by the page.
  expect(Math.abs(Number(after.top) - Number(before.top) - 300)).toBeLessThanOrEqual(32);
  expect(after.boundaryCount).toBe(0);
});
