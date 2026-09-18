import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const SOURCE_PATHS = [
  'src/ui/Timeline.jsx',
  'src/ui/timeline/FollowingTailList.jsx',
  'src/ui/timeline/HistoryStartBoundary.jsx',
  'src/ui/timeline/LegendMessageList.jsx',
  'src/styles/timeline.css',
];

const INSTALL_ERROR_PROBE = () => {
  window.__HISTORY_BOUNDARY_ERRORS__ = [];
  window.__HISTORY_BOUNDARY_STAGE__ = 'boot';
  window.addEventListener('error', (event) => {
    if (/ResizeObserver loop/.test(String(event.message || ''))) {
      window.__HISTORY_BOUNDARY_ERRORS__.push({
        message: String(event.message),
        stage: window.__HISTORY_BOUNDARY_STAGE__,
        boundaryCount: document.querySelectorAll('.timeline-history-boundary').length,
        oldestPresent: [...document.querySelectorAll('[data-presentation-row-id]')]
          .some((node) => node.textContent?.includes('c0 history 1: ask steward for PONG')),
        mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
      });
    }
  });
};

async function sourceDigest() {
  const hash = createHash('sha256');
  for (const path of SOURCE_PATHS) hash.update(path).update('\0').update(await readFile(path));
  return hash.digest('hex');
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('.timeline-reading-layer.is-active .timeline-message-list')).toBeVisible();
}

async function wheel(page, inputList, deltaY, count) {
  await inputList.hover();
  for (let index = 0; index < count; index += 1) {
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(30);
  }
}

async function boundaryInViewport(boundary) {
  return boundary.evaluate((node) => {
    const list = node.closest('.timeline-message-list');
    const rect = node.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    return rect.bottom >= listRect.top + 1 && rect.top <= listRect.bottom - 1;
  }).catch(() => false);
}

test('authoritative history start is an ordinary scrolling item without disabling list anchoring', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  await page.addInitScript(INSTALL_ERROR_PROBE);
  await page.setViewportSize({ width: 1120, height: 420 });
  const reset = await request.post('/mock/control/reset', {
    data: { scenario: 'history-boundary', seed: 0x92_48_01 },
  });
  expect(reset.ok()).toBe(true);
  await login(page);

  const following = page.locator('.timeline-reading-layer.is-active .timeline-following-tail');
  await following.hover();
  await page.mouse.wheel(0, -220);
  await page.waitForTimeout(12);
  await page.mouse.wheel(0, -220);
  await expect.poll(() => page.locator('.timeline-reading-stack').getAttribute('data-handoff-ready'))
    .toBe('true');

  const activeList = page.locator('.timeline-reading-layer.is-active .timeline-message-list');
  const activeBoundary = activeList.locator('.timeline-history-boundary[data-phase="exhausted"]');
  const visibleBoundary = page.locator(
    '.timeline-reading-layer:is(.is-active, .is-outgoing) .timeline-history-boundary[data-phase="exhausted"]',
  );
  await expect(page.getByText('c0 history 22: ask steward for PONG', { exact: true })).toBeVisible();
  await page.evaluate(() => { window.__HISTORY_BOUNDARY_STAGE__ = 'loading-history'; });
  const boundaryRoleBefore = await activeList.evaluate((root) => {
    const slot = root.querySelector('.timeline-history-boundary-slot');
    const row = slot?.parentElement?.querySelector('[data-presentation-row-id]');
    return { ownerID: row?.dataset.presentationRowId || 'c0-history-request-5' };
  });
  expect(boundaryRoleBefore.ownerID).not.toBe('');
  await page.evaluate((ownerID) => {
    const frames = [];
    let running = true;
    const sample = () => {
      if (!running) return;
      const root = document.querySelector('.timeline-reading-layer.is-active .timeline-message-list');
      const slot = root?.querySelector('.timeline-history-boundary-slot');
      const slotItem = slot?.closest('[data-item-index]');
      const slotRow = slotItem?.querySelector('[data-presentation-row-id]');
      const oldRow = root?.querySelector(`[data-presentation-row-id="${CSS.escape(ownerID)}"]`);
      const oldItem = oldRow?.closest('[data-item-index]');
      const rootRect = root?.getBoundingClientRect();
      frames.push({
        at: performance.now(),
        roleOwnerID: slotRow?.dataset.presentationRowId || '',
        boundaryCount: root?.querySelectorAll('.timeline-history-boundary').length || 0,
        oldOwnerConnected: Boolean(oldRow?.isConnected),
        oldOwnerContentTop: oldRow && rootRect ? oldRow.getBoundingClientRect().top - rootRect.top : null,
        oldOwnerItemHeight: oldItem?.offsetHeight ?? null,
        oldOwnerKnownSize: oldItem?.getAttribute('data-known-size') || '',
        scrollTop: Number(root?.scrollTop || 0),
      });
      requestAnimationFrame(sample);
    };
    window.__HISTORY_BOUNDARY_EOF_TRANSFER__ = {
      stop() { running = false; return frames; },
    };
    requestAnimationFrame(sample);
  }, boundaryRoleBefore.ownerID);

  await activeList.focus();
  for (let round = 0; round < 4; round += 1) {
    await page.keyboard.press('Home');
    await page.waitForTimeout(120);
    if (await boundaryInViewport(activeBoundary)) break;
  }
  await expect(activeBoundary).toBeInViewport();
  await expect(activeList.getByText('c0 history 1: ask steward for PONG', { exact: true })).toBeVisible();
  await page.waitForTimeout(200);
  const eofTransferFrames = await page.evaluate(() => window.__HISTORY_BOUNDARY_EOF_TRANSFER__.stop());
  await page.evaluate(() => { window.__HISTORY_BOUNDARY_STAGE__ = 'at-boundary'; });

  const atStart = await activeBoundary.evaluate((node) => {
    const list = node.closest('.timeline-message-list');
    const rect = node.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const item = node.parentElement;
    const firstMessage = list.querySelector('[data-presentation-row-id]');
    return {
      position: getComputedStyle(node).position,
      top: rect.top,
      bottom: rect.bottom,
      listTop: listRect.top,
      listBottom: listRect.bottom,
      scrollTop: list.scrollTop,
      itemIndex: item?.getAttribute('data-item-index') || item?.getAttribute('data-index') || '',
      beforeFirstMessage: Boolean(firstMessage
        && (node.compareDocumentPosition(firstMessage) & Node.DOCUMENT_POSITION_FOLLOWING)),
    };
  });
  expect(['absolute', 'fixed', 'sticky']).not.toContain(atStart.position);
  expect(atStart.beforeFirstMessage).toBe(true);

  await page.evaluate(() => { window.__HISTORY_BOUNDARY_STAGE__ = 'down'; });
  await wheel(page, activeList, 5_000, 1);
  await page.waitForTimeout(250);
  await expect.poll(() => activeList.evaluate((list) => {
    const node = list.querySelector('.timeline-history-boundary');
    return !node || node.getBoundingClientRect().bottom < list.getBoundingClientRect().top;
  })).toBe(true);
  const afterDown = await activeList.evaluate((list) => {
    const node = list.querySelector('.timeline-history-boundary');
    return {
      present: Boolean(node),
      top: node?.getBoundingClientRect().top ?? null,
      scrollTop: list.scrollTop,
    };
  });

  await page.evaluate(() => { window.__HISTORY_BOUNDARY_STAGE__ = 'up'; });
  await activeList.hover();
  await page.mouse.wheel(0, -5_000);
  await page.waitForTimeout(250);
  await expect(visibleBoundary).toBeInViewport();
  const afterReturn = await visibleBoundary.evaluate((node) => ({
    top: node.getBoundingClientRect().top,
    scrollTop: node.closest('.timeline-message-list').scrollTop,
  }));

  await page.evaluate(() => { window.__HISTORY_BOUNDARY_STAGE__ = 'settle'; });
  await page.waitForTimeout(300);
  const runtime = await page.evaluate(() => ({
    resizeObserverErrors: [...(window.__HISTORY_BOUNDARY_ERRORS__ || [])],
    resizeObserverDiagnostics: (window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || [])
      .filter((entry) => entry.event === 'window.resize_observer_loop'),
    mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
    activeLayerCount: document.querySelectorAll('.timeline-reading-layer.is-active').length,
    visibleOwnerCount: document.querySelectorAll(
      '.timeline-reading-layer.is-active, .timeline-reading-layer.is-outgoing',
    ).length,
    boundaryCount: document.querySelectorAll('.timeline-history-boundary').length,
  }));
  const roleTransferIndex = eofTransferFrames.findIndex((frame) => (
    frame.roleOwnerID && frame.roleOwnerID !== boundaryRoleBefore.ownerID
  ));
  const priorOwnerIndex = eofTransferFrames
    .slice(0, roleTransferIndex)
    .findLastIndex((frame) => frame.roleOwnerID === boundaryRoleBefore.ownerID);
  const artifact = {
    capturedAt: new Date().toISOString(),
    sourceDigest: await sourceDigest(),
    atStart,
    afterDown,
    afterReturn,
    boundaryRoleBefore,
    priorOwnerIndex,
    roleTransferIndex,
    eofTransferFrames,
    runtime,
  };
  const artifactPath = testInfo.outputPath('history-start-boundary.json');
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  await testInfo.attach('history-start-boundary.json', { path: artifactPath, contentType: 'application/json' });

  expect(runtime.visibleOwnerCount).toBe(1);
  expect(runtime.resizeObserverErrors).toEqual([]);
  expect(runtime.resizeObserverDiagnostics).toEqual([]);
  expect(roleTransferIndex).toBeGreaterThan(0);
  expect(eofTransferFrames[roleTransferIndex].roleOwnerID).toBe('c0-history-request-1');
  if (priorOwnerIndex >= 0) {
    expect(eofTransferFrames[roleTransferIndex].oldOwnerItemHeight).toBeLessThan(
      eofTransferFrames[priorOwnerIndex].oldOwnerItemHeight,
    );
    expect(Number(eofTransferFrames[roleTransferIndex].oldOwnerContentTop))
      .toBeGreaterThanOrEqual(Number(eofTransferFrames[priorOwnerIndex].oldOwnerContentTop) - 2);
  }
  expect(afterReturn.top).toBeGreaterThanOrEqual(atStart.listTop - 2);
  expect(afterReturn.top).toBeLessThan(atStart.listBottom);
});

test('an open history frontier prepends without transferring boundary geometry between rows', async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  await page.addInitScript(INSTALL_ERROR_PROBE);
  await page.setViewportSize({ width: 1120, height: 620 });
  const reset = await request.post('/mock/control/reset', {
    data: { scenario: 'deep-history', seed: 0x92_48_02 },
  });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const following = page.locator('.timeline-reading-layer.is-active .timeline-following-tail');
  await following.hover();
  await page.mouse.wheel(0, -220);
  await page.waitForTimeout(12);
  await page.mouse.wheel(0, -220);
  await expect.poll(() => page.locator('.timeline-reading-stack').getAttribute('data-handoff-ready'))
    .toBe('true');

  const activeList = page.locator('.timeline-reading-layer.is-active .timeline-message-list');
  await activeList.focus();
  await activeList.evaluate((root) => {
    // Put the current data frontier inside Virtuoso's 900px overscan without
    // entering the one-viewport history runway. The following trusted Home is
    // still the only navigation transaction that requests the prepend.
    root.scrollTop = Number(root.clientHeight || 0) + 160;
  });
  await expect(activeList.locator('.timeline-history-boundary')).toHaveCount(0);
  await page.waitForTimeout(100);
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());
  const before = await activeList.evaluate((root) => {
    const items = [...root.querySelectorAll('[data-item-index]')]
      .filter((node) => Number.isFinite(Number(node.getAttribute('data-item-index'))))
      .sort((left, right) => Number(left.getAttribute('data-item-index'))
        - Number(right.getAttribute('data-item-index')));
    const item = items[0];
    const row = item?.querySelector('[data-presentation-row-id]');
    const rootRect = root.getBoundingClientRect();
    return {
      frontierID: row?.dataset.presentationRowId || '',
      frontierIndex: item?.getAttribute('data-item-index') || '',
      frontierContentTop: row ? row.getBoundingClientRect().top - rootRect.top : null,
      itemHeight: item?.offsetHeight ?? null,
      knownSize: item?.getAttribute('data-known-size') || '',
      scrollTop: root.scrollTop,
      boundaryCount: root.querySelectorAll('.timeline-history-boundary').length,
    };
  });
  expect(before.frontierID).not.toBe('');
  expect(before.boundaryCount).toBe(0);

  await page.evaluate((frontierID) => {
    const frames = [];
    let running = true;
    const sample = () => {
      if (!running) return;
      const root = document.querySelector('.timeline-reading-layer.is-active .timeline-message-list');
      const items = [...(root?.querySelectorAll('[data-item-index]') || [])]
        .filter((node) => Number.isFinite(Number(node.getAttribute('data-item-index'))))
        .sort((left, right) => Number(left.getAttribute('data-item-index'))
          - Number(right.getAttribute('data-item-index')));
      const frontierItem = items[0];
      const frontierRow = frontierItem?.querySelector('[data-presentation-row-id]');
      const oldRow = root?.querySelector(`[data-presentation-row-id="${CSS.escape(frontierID)}"]`);
      const oldItem = oldRow?.closest('[data-item-index]');
      const rootRect = root?.getBoundingClientRect();
      frames.push({
        at: performance.now(),
        frontierID: frontierRow?.dataset.presentationRowId || '',
        frontierIndex: frontierItem?.getAttribute('data-item-index') || '',
        oldFrontierConnected: Boolean(oldRow?.isConnected),
        oldFrontierContentTop: oldRow && rootRect ? oldRow.getBoundingClientRect().top - rootRect.top : null,
        oldFrontierItemHeight: oldItem?.offsetHeight ?? null,
        oldFrontierKnownSize: oldItem?.getAttribute('data-known-size') || '',
        boundaryCount: root?.querySelectorAll('.timeline-history-boundary').length || 0,
        scrollTop: Number(root?.scrollTop || 0),
      });
      requestAnimationFrame(sample);
    };
    window.__HISTORY_BOUNDARY_PREPEND__ = {
      stop() { running = false; return frames; },
    };
    requestAnimationFrame(sample);
  }, before.frontierID);

  await page.keyboard.press('Home');
  await expect.poll(() => activeList.evaluate((root, frontierID) => {
    const firstItem = [...root.querySelectorAll('[data-item-index]')]
      .filter((node) => Number.isFinite(Number(node.getAttribute('data-item-index'))))
      .sort((left, right) => Number(left.getAttribute('data-item-index'))
        - Number(right.getAttribute('data-item-index')))[0];
    const currentID = firstItem?.querySelector('[data-presentation-row-id]')?.dataset.presentationRowId || '';
    return Boolean(currentID && currentID !== frontierID);
  }, before.frontierID)).toBe(true);
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => ({
    frames: window.__HISTORY_BOUNDARY_PREPEND__.stop(),
    errors: [...(window.__HISTORY_BOUNDARY_ERRORS__ || [])],
    diagnostics: window.__ATOLL_DIAGNOSTICS__.snapshot()
      .filter((entry) => entry.event === 'window.resize_observer_loop'
        || entry.event.startsWith('history.intent_')),
  }));
  const transitionIndex = result.frames.findIndex((frame) => (
    frame.frontierID && frame.frontierID !== before.frontierID
  ));
  expect(transitionIndex).toBeGreaterThan(0);
  const immediatelyBefore = result.frames[transitionIndex - 1];
  const immediatelyAfter = result.frames[transitionIndex];
  const artifact = {
    capturedAt: new Date().toISOString(),
    sourceDigest: await sourceDigest(),
    before,
    transitionIndex,
    immediatelyBefore,
    immediatelyAfter,
    errors: result.errors,
    diagnostics: result.diagnostics,
    frames: result.frames,
  };
  const artifactPath = testInfo.outputPath('history-start-prepend.json');
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  await testInfo.attach('history-start-prepend.json', { path: artifactPath, contentType: 'application/json' });

  expect(result.errors).toEqual([]);
  expect(result.diagnostics.filter((entry) => entry.event === 'window.resize_observer_loop')).toEqual([]);
  expect(result.frames.every((frame) => frame.boundaryCount === 0)).toBe(true);
  expect(immediatelyBefore.oldFrontierConnected).toBe(true);
  expect(immediatelyAfter.oldFrontierConnected).toBe(true);
  expect(immediatelyAfter.oldFrontierItemHeight).toBe(immediatelyBefore.oldFrontierItemHeight);
  expect(immediatelyAfter.oldFrontierKnownSize).toBe(immediatelyBefore.oldFrontierKnownSize);
  // Home may already advance the viewport toward older content in this same
  // frame. That authorized motion is positive in this coordinate; the old
  // slot-transfer bug was the opposite signed -35px jump.
  expect(Number(immediatelyAfter.oldFrontierContentTop)
    - Number(immediatelyBefore.oldFrontierContentTop))
    .toBeGreaterThanOrEqual(-2);
});

