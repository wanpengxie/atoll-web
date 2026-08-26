import { expect, test } from '@playwright/test';

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

test('F7 deep history starts at the tail, reveals upward automatically, and keeps realtime live', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1707 } });
  expect(reset.ok()).toBe(true);
  await login(page);

  const viewport = page.locator('.timeline-message-list');
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  // Virtuoso treats the final 24px as the bottom zone so late dynamic-height
  // measurement cannot incorrectly disable realtime follow.
  await expect.poll(() => viewport.evaluate((node) => Math.round(node.scrollHeight - node.clientHeight - node.scrollTop))).toBeLessThanOrEqual(24);
  const samples = await page.evaluate(async () => {
    const node = document.querySelector('.timeline-message-list');
    const values = [];
    for (let index = 0; index < 6; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      values.push(Math.round(node.scrollHeight - node.clientHeight - node.scrollTop));
    }
    return values;
  });
  expect(samples.every((distance) => Math.abs(distance) <= 24), JSON.stringify(samples)).toBe(true);

  // No button and no network wait: real scroll events claim the already-prefetched
  // reservoir in small anchored batches until the oldest turn becomes visible.
  for (let index = 0; index < 30; index += 1) {
    await viewport.evaluate((node) => {
      node.scrollTop = 0;
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await page.waitForTimeout(30);
  }
  await expect(page.getByText('c0 history 1: ask steward for PONG', { exact: true })).toBeVisible();
  const invalidTopDispatches = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => (
    entry.event === 'timeline.history_top_observed' && Number(entry.detail?.scrollTop) > 1
  )));
  expect(invalidTopDispatches).toEqual([]);

  await request.post('/mock/control/action', { data: { type: 'pulse' } });
  await expect(page.getByRole('button', { name: /条新动态/ })).toBeVisible();
  await page.getByRole('button', { name: /条新动态/ }).click();
  await expect(page.getByText(/c0 动态 #1/)).toBeVisible();

  const cachedRows = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const open = indexedDB.open('atoll-feed-v8');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return new Promise((resolve, reject) => {
      const tx = database.transaction('rows', 'readonly');
      const count = tx.objectStore('rows').count(IDBKeyRange.bound(['c0', 0], ['c0', Number.MAX_SAFE_INTEGER]));
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => reject(count.error);
    });
  });
  expect(cachedRows).toBeLessThanOrEqual(5_000);
});

test('F7 mobile keeps realtime delivery while the reader is browsing history', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1708 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const viewport = page.locator('.timeline-message-list');
  for (let index = 0; index < 5; index += 1) {
    await viewport.evaluate((node) => {
      node.scrollTop = 0;
      node.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await page.waitForTimeout(40);
  }
  await request.post('/mock/control/action', { data: { type: 'pulse' } });
  const jump = page.getByRole('button', { name: /条新动态/ });
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(page.getByText(/c0 动态 #1/)).toBeVisible();
});

test('F7 100k ledger keeps bounded initial DOM and reveals older rows on upward demand', async ({ page, request }) => {
  test.setTimeout(45_000);
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'huge-history', seed: 1709 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await page.waitForFunction(() => {
    const node = document.querySelector('.timeline-message-list');
    return node && node.scrollHeight > node.clientHeight && document.querySelector('.request-text');
  });

  const viewport = page.locator('.timeline-message-list');
  expect(await page.locator('.timeline-virtual-item').count()).toBeLessThan(100);
  // Exactly one gesture. Depending on machine speed the prefetched batch may
  // already be in the reservoir or still in flight; both paths must reveal an
  // older row without a second gesture.
  await viewport.hover();
  await page.mouse.wheel(0, -100_000);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .some((entry) => entry.event === 'history.intent_started'))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
	entry.event === 'history.intent_satisfied'
  ))), { timeout: 5_000 }).toBe(true);
  expect(await page.locator('.timeline-virtual-item').count()).toBeLessThan(100);
});

test('F7 a 5000-row warm cache survives reload and satisfies one physical top demand', async ({ page, request }) => {
  test.setTimeout(60_000);
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'huge-history', seed: 1710 } });
  expect(reset.ok()).toBe(true);
  await login(page);

  const cachedRows = () => page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const open = indexedDB.open('atoll-feed-v8');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return new Promise((resolve, reject) => {
      const tx = database.transaction('rows', 'readonly');
      const count = tx.objectStore('rows').count(IDBKeyRange.bound(['c0', 0], ['c0', Number.MAX_SAFE_INTEGER]));
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => reject(count.error);
    });
  });
  await expect.poll(cachedRows, { timeout: 30_000 }).toBe(5_000);

  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  const viewport = page.locator('.timeline-message-list');
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());

  await viewport.evaluate((node) => {
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
	entry.event === 'history.intent_started'
  )))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
	entry.event === 'history.intent_satisfied'
  )))).toBe(true);

  const operations = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => (
	entry.event === 'history.intent_started'
  )));
  expect(operations).toHaveLength(1);
});

test('F7 a lagged cache reads the current network tail first and joins cache only at the exact seam', async ({ page, request }) => {
  test.setTimeout(45_000);
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1711 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
    entry.event === 'history.batch_complete'
      && entry.detail?.channelId === 'c0'
      && entry.detail?.hasOlder === false
  )))).toBe(true);
  await page.waitForTimeout(500);

  const context = page.context();
  await page.close();
  for (let index = 0; index < 20; index += 1) {
    const pulse = await request.post('/mock/control/action', { data: { type: 'pulse' } });
    expect(pulse.ok()).toBe(true);
  }

  const resumed = await context.newPage();
  await resumed.goto('/');
  await expect(resumed.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(resumed.getByText(/c0 动态 #19/)).toBeVisible();
  await expect.poll(() => resumed.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
    entry.event === 'history.segment_requested'
      && entry.detail?.channelId === 'c0'
      && entry.detail?.source === 'indexeddb'
  ))), { timeout: 15_000 }).toBe(true);

  const sources = await resumed.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .filter((entry) => entry.event === 'history.segment_requested' && entry.detail?.channelId === 'c0')
    .map((entry) => ({ source: entry.detail.source, beforeSeq: entry.detail.beforeSeq })));
  expect(sources[0]?.source).toBe('network');
  const cacheIndex = sources.findIndex((entry) => entry.source === 'indexeddb');
  expect(cacheIndex).toBeGreaterThan(0);
  expect(sources[cacheIndex].beforeSeq).toBeLessThan(sources[0].beforeSeq);
});

test('F7 one top operation crosses hundreds of cached progress facts with no visible item', async ({ page, request }) => {
  test.setTimeout(45_000);
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1712 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const dense = await request.post('/mock/control/action', {
    data: { type: 'dense_progress', channel_id: 'c0', count: 640 },
  });
  expect(dense.ok()).toBe(true);
  const detail = await dense.json();
  await expect.poll(() => page.evaluate(async (headSeq) => {
    const database = await new Promise((resolve, reject) => {
      const open = indexedDB.open('atoll-feed-v8');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return new Promise((resolve, reject) => {
      const tx = database.transaction('channelMeta', 'readonly');
      const get = tx.objectStore('channelMeta').get('c0');
      get.onsuccess = () => resolve((get.result?.coverage || []).some((entry) => entry.highSeq >= headSeq));
      get.onerror = () => reject(get.error);
    });
  }, detail.head_seq), { timeout: 15_000 }).toBe(true);

  const context = page.context();
  await page.close();
  const resumed = await context.newPage();
  await resumed.goto('/');
  await expect(resumed.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(resumed.getByText('dense progress request (640)', { exact: true })).toBeVisible({ timeout: 15_000 });

  const diagnostics = await resumed.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot());
  const started = diagnostics.filter((entry) => entry.event === 'history.intent_started');
  const firstOperationId = diagnostics.find((entry) => entry.event === 'history.projection_checked')?.detail?.operationId;
  const invisibleChecks = diagnostics.filter((entry) => (
    entry.event === 'history.projection_checked'
      && entry.detail?.operationId === firstOperationId
      && Number(entry.detail?.released) > 0
      && Number(entry.detail?.firstVisibleSeq) === 0
  ));
  expect(started.length).toBeGreaterThanOrEqual(1);
  expect(new Set(started.map((entry) => entry.detail.epoch)).size).toBe(1);
  expect(invisibleChecks.length).toBeGreaterThanOrEqual(2);
  const firstSatisfied = diagnostics.findIndex((entry) => entry.event === 'history.intent_satisfied');
  const startedIndexes = diagnostics.flatMap((entry, index) => entry.event === 'history.intent_started' ? [index] : []);
  const secondStarted = startedIndexes[1] ?? -1;
  expect(firstSatisfied).toBeGreaterThan(0);
  if (secondStarted >= 0) expect(firstSatisfied).toBeLessThan(secondStarted);
});
