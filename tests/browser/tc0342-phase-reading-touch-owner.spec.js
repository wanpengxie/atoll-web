import { expect, test } from '@playwright/test';

const SEED = 0x4a_de_37;

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'deep-history-delayed', seed: SEED },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

test('TC-0342 ordinary browsing touch stays on the active reading surface', async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1120, height: 620 });
  await reset(request);
  await login(page);

  await page.locator('button.channel-item').filter({ hasText: 'c0.project' }).first().click();
  await expect(page.locator('main h1')).toHaveText('c0.project');

  const timeline = page.locator('.timeline');
  const active = page.locator('.timeline-reading-layer.is-active .timeline-message-list');
  await expect(active.locator('[data-presentation-row-id]').last()).toBeVisible();
  const readPublicState = () => page.evaluate(() => {
    const timeline = document.querySelector('.timeline');
    const stack = document.querySelector('.timeline-reading-stack');
    const layers = [...document.querySelectorAll('.timeline-reading-layer')];
    const lists = [...document.querySelectorAll('.timeline-reading-layer .timeline-message-list')];
    const list = document.querySelector('.timeline-reading-layer.is-active .timeline-message-list');
    const root = list?.getBoundingClientRect();
    const rows = list ? [...list.querySelectorAll('[data-presentation-row-id]')].map((node) => {
      const rect = node.getBoundingClientRect();
      return { id: node.dataset.presentationRowId || '', top: rect.top - (root?.top || 0), bottom: rect.bottom - (root?.top || 0) };
    }).filter((row) => row.bottom > 0 && row.top < (root?.height || 0)) : [];
    const historyNumbers = rows
      .map((row) => Number(row.id.match(/history-request-(\d+)$/)?.[1]))
      .filter(Number.isFinite);
    return {
      timelineMode: timeline?.dataset.viewportMode || '',
      stackMode: stack?.dataset.readingMode || '',
      stackActivation: stack?.dataset.readingActivation || '',
      activeLayers: layers.filter((layer) => layer.classList.contains('is-active')).length,
      listCount: lists.length,
      activeListCount: list ? 1 : 0,
      listMode: list?.dataset.readingMode || '',
      rootIdentity: list?.dataset.readingRootIdentity || '',
      rows,
      historyNumbers,
    };
  });

  // The contract starts in the public following state.  The same visible
  // row is retained through the first wheel handoff; its geometry is the
  // user-facing anchor oracle, not an implementation scroll offset.
  await expect(timeline).toHaveAttribute('data-viewport-mode', 'following', { timeout: 10_000 });
  await expect(active).toHaveAttribute('data-reading-mode', 'following');
  const beforeWheel = await readPublicState();
  expect(beforeWheel.timelineMode).toBe('following');
  expect(beforeWheel.stackMode).toBe('following');
  expect(beforeWheel.listMode).toBe('following');
  expect(beforeWheel.activeLayers).toBe(1);
  expect(beforeWheel.listCount).toBe(1);
  expect(beforeWheel.activeListCount).toBe(1);
  expect(beforeWheel.rows.length).toBeGreaterThan(0);
  const anchor = beforeWheel.rows.at(-1);
  expect(anchor?.id).toBeTruthy();

  await active.focus();
  await page.mouse.move(560, 300);
  let previousHistoryMinimum = null;
  const wheelDeltas = [-120, -160, -220, -260];
  for (const [index, delta] of wheelDeltas.entries()) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(40);
    const state = await readPublicState();

    // A settled handoff is observable as one active layer/list whose public
    // mode agrees with the timeline and stack, with painted rows present.
    expect(state.timelineMode).toBe('browsing');
    expect(state.stackMode).toBe('browsing');
    expect(state.listMode).toBe('browsing');
    expect(state.activeLayers).toBe(1);
    expect(state.listCount).toBe(1);
    expect(state.activeListCount).toBe(1);
    expect(state.stackActivation).toBe(beforeWheel.stackActivation);
    expect(state.rootIdentity).toBe(beforeWheel.rootIdentity);
    expect(state.rows.length).toBeGreaterThan(0);
    expect(state.historyNumbers.length).toBeGreaterThan(0);

    const historyMinimum = Math.min(...state.historyNumbers);
    if (previousHistoryMinimum != null) {
      expect(historyMinimum).toBeLessThan(previousHistoryMinimum);
    }
    previousHistoryMinimum = historyMinimum;

    if (index === 0) {
      const handoffAnchor = state.rows.find((row) => row.id === anchor.id);
      expect(handoffAnchor).toBeTruthy();
      const movement = Math.abs(handoffAnchor.top - anchor.top);
      // Chromium's real wheel delta is the visible movement budget; allow a
      // small compositor/row-measurement tolerance but reject a handoff jump.
      expect(movement).toBeGreaterThanOrEqual(Math.abs(delta) - 32);
      expect(movement).toBeLessThanOrEqual(Math.abs(delta) + 32);
    }
  }

  const beforeTouch = await readPublicState();
  const beforeTouchHistoryMinimum = Math.min(...beforeTouch.historyNumbers);
  const beforeTouchAnchorRows = new Map(beforeTouch.rows.map((row) => [row.id, row]));
  const box = await active.boundingBox();
  expect(box).not.toBeNull();
  const client = await page.context().newCDPSession(page);
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 7, radiusX: 4, radiusY: 4, force: 1 }],
  });
  for (const offset of [80, 140, 200]) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y + offset, id: 7, radiusX: 4, radiusY: 4, force: 1 }],
    });
    if (offset === 80) {
      await page.waitForTimeout(50);
      const inGesture = await readPublicState();
      expect(inGesture.timelineMode).toBe('browsing');
      expect(inGesture.stackMode).toBe('browsing');
      expect(inGesture.listMode).toBe('browsing');
      expect(inGesture.activeLayers).toBe(1);
      expect(inGesture.listCount).toBe(1);
      expect(inGesture.activeListCount).toBe(1);
      expect(inGesture.stackActivation).toBe(beforeTouch.stackActivation);
      const inGestureRows = new Map(inGesture.rows.map((row) => [row.id, row]));
      const commonAnchors = [...beforeTouchAnchorRows.entries()]
        .filter(([id]) => inGestureRows.has(id));
      expect(commonAnchors.length).toBeGreaterThan(0);
      for (const [id, before] of commonAnchors) {
        const after = inGestureRows.get(id);
        expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(120);
      }
    }
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);

  const afterTouch = await readPublicState();
  expect(afterTouch.timelineMode).toBe('browsing');
  expect(afterTouch.stackMode).toBe('browsing');
  expect(afterTouch.listMode).toBe('browsing');
  expect(afterTouch.activeLayers).toBe(1);
  expect(afterTouch.listCount).toBe(1);
  expect(afterTouch.activeListCount).toBe(1);
  expect(afterTouch.stackActivation).toBe(beforeTouch.stackActivation);
  expect(afterTouch.rootIdentity).toBe(beforeTouch.rootIdentity);
  expect(afterTouch.rows.length).toBeGreaterThan(0);
  expect(Math.min(...afterTouch.historyNumbers)).toBeLessThan(beforeTouchHistoryMinimum);

});
