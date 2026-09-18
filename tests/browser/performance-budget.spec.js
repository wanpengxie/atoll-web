import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

async function attachJSON(testInfo, name, value) {
  const path = testInfo.outputPath(name);
  await writeFile(path, JSON.stringify(value, null, 2));
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

async function heapMetrics(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  const metrics = await cdp.send('Performance.getMetrics');
  await cdp.detach();
  return Object.fromEntries(metrics.metrics.map((entry) => [entry.name, entry.value]));
}

async function cacheMetrics(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const open = indexedDB.open('atoll-feed-v8');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const rows = await new Promise((resolve, reject) => {
      const tx = database.transaction('rows', 'readonly');
      const request = tx.objectStore('rows').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return {
      rows: rows.length,
      encodedBytes: rows.reduce((sum, row) => sum + Number(row.bytes || 0), 0),
      channelRows: rows.filter((row) => row.channelId === 'c0').length,
    };
  });
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

async function installPageProbe(page) {
  await page.addInitScript(() => {
    const state = { longTasks: [], firstRowAt: null, navigationStart: performance.now() };
    window.__PERF_BUDGET_PROBE__ = state;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch { /* longtask is Chromium-only. */ }
    const inspect = () => {
      if (state.firstRowAt == null && document.querySelector('[data-presentation-row-id]')) state.firstRowAt = performance.now();
    };
    document.addEventListener('DOMContentLoaded', () => {
      new MutationObserver(inspect).observe(document.documentElement, { childList: true, subtree: true });
      inspect();
    }, { once: true });
  });
}

test('PERF production adapter materializes, paints, and selects a bounded window from 100k rows', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.goto('/tests/browser/fixtures/production-perf.html?target=50000');
  await page.waitForFunction(() => window.productionPerf);
  const before = await heapMetrics(page);
  const mounted = await page.evaluate(() => window.productionPerf.mount(100_000));
  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  // The production adapter initially restores the persisted semantic target,
  // then a trusted wheel input proves that the materialized range is live.
  // No synthetic scrollTop jump or sliced data source is used.
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(250);
  const older = await page.evaluate(() => window.productionPerf.summary());
  const after = await heapMetrics(page);
  const evidence = {
    profile: { viewport: page.viewportSize(), userAgent: await page.evaluate(() => navigator.userAgent) },
    mounted,
    older,
    heap: {
      beforeBytes: before.JSHeapUsedSize,
      afterBytes: after.JSHeapUsedSize,
      deltaBytes: after.JSHeapUsedSize - before.JSHeapUsedSize,
    },
  };
  await page.locator('.timeline-message-list').screenshot({ path: testInfo.outputPath('100k-nontail.png') });
  await attachJSON(testInfo, '100k-production-adapter.json', evidence);

  expect(mounted.summary.logicalRows).toBe(100_000);
  expect(mounted.summary.fixtureTargetIndex).toBe(50_000);
  expect(mounted.immediate.seededReading.bookmark.messageID).toBe('perf-row-50000');
  expect(mounted.immediate.readingBookmark.messageID).toBe('perf-row-50000');
  expect(mounted.summary.readingMode).toBe('browsing');
  expect(mounted.summary.materializedRows).toBeLessThan(100);
  expect(older.materializedRows).toBeLessThan(100);
  expect(older.visible.length).toBeGreaterThan(0);
  expect(older.hitRowID).toBe('perf-row-50000');
  expect(older.selected.textLength).toBeGreaterThan(20);
  expect(older.selected.rects).toBeGreaterThan(0);
  expect(older.visible.some((row) => row.id === 'perf-row-50000')).toBe(true);
  expect(older.readingBookmark.messageID).toBe('perf-row-50000');
  expect(mounted.mount.synchronousMs).toBeLessThan(5_000);
  expect(Math.max(0, ...older.longTasks.map((entry) => entry.duration))).toBeLessThan(500);
  expect(evidence.heap.deltaBytes).toBeLessThan(160 * 1024 * 1024);
});

test('PERF 100k-character Markdown stays selectable through the production adapter', async ({ page, context }, testInfo) => {
  test.setTimeout(60_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/tests/browser/fixtures/production-perf.html');
  await page.waitForFunction(() => window.productionPerf);
  const result = await page.evaluate(() => window.productionPerf.mount(2_000, {
    longTailCharacters: 100_000,
    longTailBlocks: 320,
  }));
  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(250);
  const postInput = await page.evaluate(() => window.productionPerf.summary());
  const drag = await page.evaluate(() => {
    const viewportNode = document.querySelector('.timeline-message-list');
    const viewportBounds = viewportNode?.getBoundingClientRect();
    const paragraph = [...viewportNode?.querySelectorAll('[data-reading-block-id] p') || []]
      .find((candidate) => {
        const bounds = candidate.getBoundingClientRect();
        return bounds.top >= viewportBounds.top && bounds.bottom <= viewportBounds.bottom;
      });
    let textNode = null;
    const walker = paragraph ? document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT) : null;
    for (let candidate = walker?.nextNode(); candidate; candidate = walker.nextNode()) {
      if (!candidate.textContent?.startsWith('Long Markdown block ')) continue;
      textNode = candidate;
      break;
    }
    if (!viewportNode || !viewportBounds || !paragraph || !textNode) return null;
    const endOffset = textNode.textContent.indexOf('with');
    if (endOffset <= 0) return null;
    const pointAt = (offset) => {
      const range = document.createRange();
      range.setStart(textNode, offset);
      range.collapse(true);
      const bounds = range.getBoundingClientRect();
      const x = bounds.left;
      const y = bounds.top + bounds.height / 2;
      const hit = document.elementFromPoint(x, y);
      const caret = document.caretPositionFromPoint?.(x, y);
      return {
        x,
        y,
        hitTag: hit?.tagName || '',
        hitRowID: hit?.closest?.('[data-presentation-row-id]')?.dataset.presentationRowId || '',
        hitBlockID: hit?.closest?.('[data-reading-block-id]')?.dataset.readingBlockId || '',
        caretOffset: caret?.offset ?? null,
        caretRowID: caret?.offsetNode?.parentElement?.closest?.('[data-presentation-row-id]')?.dataset.presentationRowId || '',
        caretBlockID: caret?.offsetNode?.parentElement?.closest?.('[data-reading-block-id]')?.dataset.readingBlockId || '',
      };
    };
    getSelection()?.removeAllRanges();
    return {
      expectedText: textNode.textContent.slice(0, endOffset),
      rowID: paragraph.closest('[data-presentation-row-id]')?.dataset.presentationRowId || '',
      blockID: paragraph.closest('[data-reading-block-id]')?.dataset.readingBlockId || '',
      startOffset: 0,
      endOffset,
      start: pointAt(0),
      end: pointAt(endOffset),
    };
  });
  expect(drag).not.toBeNull();
  await page.mouse.move(drag.start.x, drag.start.y);
  await page.mouse.down();
  await page.mouse.move(drag.end.x, drag.end.y, { steps: 12 });
  await page.mouse.up();
  const readSelectionState = () => page.evaluate(() => {
    const selection = getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const endpointElement = (node) => (node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement);
    const endpointFact = (node) => {
      const element = endpointElement(node);
      return {
        connected: node?.isConnected === true,
        rowID: element?.closest?.('[data-presentation-row-id]')?.dataset.presentationRowId || '',
        blockID: element?.closest?.('[data-reading-block-id]')?.dataset.readingBlockId || '',
      };
    };
    return {
      text: selection?.toString() || '',
      rangeText: range?.toString() || '',
      rangeCount: selection?.rangeCount || 0,
      isCollapsed: selection?.isCollapsed ?? true,
      rects: range?.getClientRects().length || 0,
      anchor: endpointFact(selection?.anchorNode),
      focus: endpointFact(selection?.focusNode),
      longRowConnected: document.querySelector('[data-presentation-row-id="perf-row-2000"]')?.isConnected === true,
    };
  });
  const afterDrag = await readSelectionState();
  await page.keyboard.press('Control+C');
  const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  await viewport.hover();
  await page.mouse.wheel(0, -240);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const afterMaterializedScroll = await readSelectionState();
  const evidence = {
    result,
    postInput,
    drag,
    afterDrag,
    clipboardText,
    afterMaterializedScroll,
    maxLongTaskMs: Math.max(0, ...postInput.longTasks.map((entry) => entry.duration)),
  };
  await viewport.screenshot({ path: testInfo.outputPath('long-markdown-selection.png') });
  await attachJSON(testInfo, 'long-markdown-production-adapter.json', evidence);
  expect(result.summary.logicalRows).toBe(2_000);
  expect(postInput.materializedRows).toBeLessThan(100);
  expect(postInput.visible.length).toBeGreaterThan(0);
  expect(postInput.hitRowID).toBeTruthy();
  expect(drag).toMatchObject({
    rowID: 'perf-row-2000',
    startOffset: 0,
    start: { hitTag: 'P', hitRowID: 'perf-row-2000', caretOffset: 0, caretRowID: 'perf-row-2000' },
    end: { hitTag: 'P', hitRowID: 'perf-row-2000', caretRowID: 'perf-row-2000' },
  });
  expect(drag.end.caretOffset).toBe(drag.endOffset);
  expect(drag.start.hitBlockID).toBe(drag.blockID);
  expect(drag.end.hitBlockID).toBe(drag.blockID);
  expect(drag.start.caretBlockID).toBe(drag.blockID);
  expect(drag.end.caretBlockID).toBe(drag.blockID);
  expect(drag.expectedText).toMatch(/^Long Markdown block \d+ $/);
  expect(afterDrag).toMatchObject({
    text: drag.expectedText,
    rangeText: drag.expectedText,
    rangeCount: 1,
    isCollapsed: false,
    longRowConnected: true,
    anchor: { connected: true, rowID: drag.rowID, blockID: drag.blockID },
    focus: { connected: true, rowID: drag.rowID, blockID: drag.blockID },
  });
  expect(afterDrag.rects).toBeGreaterThan(0);
  expect(clipboardText).toBe(drag.expectedText);
  expect(afterMaterializedScroll).toEqual(afterDrag);
  expect(result.mount.synchronousMs).toBeLessThan(5_000);
  expect(evidence.maxLongTaskMs).toBeLessThan(2_000);
});

test('PERF huge ledger cold and warm first-content paths keep cache and DOM bounded', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'huge-history', seed: 98101 } });
  expect(reset.ok()).toBe(true);
  await installPageProbe(page);
  await login(page);
  await expect(page.getByText('c0 history 14286: ask steward for PONG', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__PERF_BUDGET_PROBE__.firstRowAt)).not.toBeNull();
  const cold = await page.evaluate(() => ({
    ...window.__PERF_BUDGET_PROBE__,
    elapsedMs: window.__PERF_BUDGET_PROBE__.firstRowAt - window.__PERF_BUDGET_PROBE__.navigationStart,
    domRows: document.querySelectorAll('[data-presentation-row-id]').length,
  }));
  await expect.poll(async () => (await cacheMetrics(page)).channelRows, { timeout: 30_000 }).toBeGreaterThanOrEqual(128);
  const coldCache = await cacheMetrics(page);
  const coldHeap = await heapMetrics(page);

  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect.poll(() => page.evaluate(() => window.__PERF_BUDGET_PROBE__.firstRowAt)).not.toBeNull();
  const warm = await page.evaluate(() => ({
    ...window.__PERF_BUDGET_PROBE__,
    elapsedMs: window.__PERF_BUDGET_PROBE__.firstRowAt - window.__PERF_BUDGET_PROBE__.navigationStart,
    domRows: document.querySelectorAll('[data-presentation-row-id]').length,
  }));
  const warmCache = await cacheMetrics(page);
  const warmHeap = await heapMetrics(page);
  const evidence = { cold, warm, coldCache, warmCache, coldHeapBytes: coldHeap.JSHeapUsedSize, warmHeapBytes: warmHeap.JSHeapUsedSize };
  await attachJSON(testInfo, 'cold-warm-huge-ledger.json', evidence);

  expect(cold.domRows).toBeLessThan(100);
  expect(warm.domRows).toBeLessThan(100);
  expect(cold.elapsedMs).toBeLessThan(15_000);
  expect(warm.elapsedMs).toBeLessThan(8_000);
  expect(warmCache.channelRows).toBeLessThanOrEqual(5_000);
  expect(warmCache.encodedBytes).toBeLessThan(256 * 1024 * 1024);
  expect(warmHeap.JSHeapUsedSize).toBeLessThan(192 * 1024 * 1024);
});

test('PERF waiting layer remains operable with a visible queue', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'long-running', seed: 98102 } });
  expect(reset.ok()).toBe(true);
  await installPageProbe(page);
  await login(page);
  const editor = page.getByLabel('消息');
  await editor.fill('@st');
  await page.getByRole('option', { name: /steward/ }).click();
  await editor.press('End');
  await editor.pressSequentially('performance active task');
  await page.getByRole('button', { name: /发送/ }).click();
  await expect(page.locator('.turn-card').filter({ hasText: 'performance active task' })).toBeVisible();

  const started = await page.evaluate(() => performance.now());
  const waiting = page.getByRole('region', { name: '等待区' });
  for (let index = 1; index <= 8; index += 1) {
    await editor.fill(`performance queued task ${index}`);
    await page.getByRole('button', { name: /发送/ }).click();
  }
  await page.waitForFunction(() => document.querySelectorAll('.agent-wait-item').length === 8, null, { timeout: 10_000 })
    .catch(() => null);
  const reachedCapacity = await waiting.locator('.agent-wait-item').count() === 8;
  let collapsedSummary = '';
  if (reachedCapacity) {
    await waiting.getByRole('button', { name: '收起' }).click();
    collapsedSummary = await waiting.textContent();
    await waiting.getByRole('button', { name: '展开' }).click();
  }
  const evidence = await page.evaluate((start) => ({
    elapsedMs: performance.now() - start,
    waitItems: document.querySelectorAll('.agent-wait-item').length,
    domElements: document.querySelectorAll('*').length,
    maxLongTaskMs: Math.max(0, ...window.__PERF_BUDGET_PROBE__.longTasks.map((entry) => entry.duration)),
    longTasks: window.__PERF_BUDGET_PROBE__.longTasks,
  }), started);
  evidence.collapsedSummary = collapsedSummary;
  await attachJSON(testInfo, 'waiting-layer.json', evidence);
  expect(evidence.waitItems).toBe(8);
  expect(evidence.collapsedSummary).toContain('8 条等待消息');
  expect(evidence.elapsedMs).toBeLessThan(20_000);
  expect(evidence.maxLongTaskMs).toBeLessThan(1_000);
});

test('PERF mobile profile bounds repeated history DOM and durable cache', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'huge-history', seed: 98103 } });
  expect(reset.ok()).toBe(true);
  await installPageProbe(page);
  await page.goto('/?perf=mobile');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.getByText('c0 history 14286: ask steward for PONG', { exact: true })).toBeVisible();
  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());
  for (let index = 0; index < 45; index += 1) {
    await page.mouse.wheel(0, -100_000);
    await page.waitForTimeout(30);
  }
  await page.mouse.wheel(0, 100_000_000);
  await expect.poll(() => viewport.evaluate((node) => Math.round(node.scrollHeight - node.clientHeight - node.scrollTop))).toBeLessThanOrEqual(24);
  const firstCache = await cacheMetrics(page);
  const firstHeap = await heapMetrics(page);
  await viewport.hover();
  for (let index = 0; index < 30; index += 1) {
    await page.mouse.wheel(0, -100_000);
    await page.waitForTimeout(30);
  }
  await page.mouse.wheel(0, 100_000_000);
  await expect.poll(() => viewport.evaluate((node) => Math.round(node.scrollHeight - node.clientHeight - node.scrollTop))).toBeLessThanOrEqual(24);
  const secondCache = await cacheMetrics(page);
  const secondHeap = await heapMetrics(page);
  const evidence = await page.evaluate(({ firstCacheValue, secondCacheValue, firstHeapBytes, secondHeapBytes }) => ({
    profile: localStorage.getItem('atoll.perf.profile.v1'),
    firstCache: firstCacheValue,
    secondCache: secondCacheValue,
    firstHeapBytes,
    secondHeapBytes,
    historyIntents: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event === 'history.intent_started').length,
    historySatisfied: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event === 'history.intent_satisfied').length,
    domRows: document.querySelectorAll('[data-presentation-row-id]').length,
    domElements: document.querySelectorAll('*').length,
    viewport: { width: innerWidth, height: innerHeight },
    maxLongTaskMs: Math.max(0, ...window.__PERF_BUDGET_PROBE__.longTasks.map((entry) => entry.duration)),
    longTasks: window.__PERF_BUDGET_PROBE__.longTasks,
  }), {
    firstCacheValue: firstCache,
    secondCacheValue: secondCache,
    firstHeapBytes: firstHeap.JSHeapUsedSize,
    secondHeapBytes: secondHeap.JSHeapUsedSize,
  });
  await attachJSON(testInfo, 'mobile-history.json', evidence);
  expect(evidence.profile).toBe('mobile');
  expect(evidence.domRows).toBeLessThan(100);
  expect(secondCache.channelRows).toBeLessThanOrEqual(5_000);
  expect(secondHeap.JSHeapUsedSize).toBeLessThan(160 * 1024 * 1024);
  expect(secondHeap.JSHeapUsedSize - firstHeap.JSHeapUsedSize).toBeLessThan(32 * 1024 * 1024);
  expect(evidence.maxLongTaskMs).toBeLessThan(1_000);
});
