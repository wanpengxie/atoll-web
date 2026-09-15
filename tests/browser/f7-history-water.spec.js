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
  // The final 24px is the bottom zone so subpixel layout changes cannot
  // incorrectly disable realtime follow.
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
    await viewport.hover();
    await page.mouse.wheel(0, -100_000);
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

test('F7 continuous upward scrolling does not fight history prepend anchoring', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'mixed-height-history', seed: 1713 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const viewport = page.locator('.timeline-message-list');
  await expect(viewport).toHaveCSS('overflow-anchor', 'auto');
  const samplesPromise = page.evaluate(async () => {
    const node = document.querySelector('.timeline-message-list');
    const samples = [];
    for (let frame = 0; frame < 180; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const viewportRect = node.getBoundingClientRect();
      const positions = {};
      for (const entry of node.querySelectorAll('.timeline-entry')) {
        const rect = entry.getBoundingClientRect();
        if (rect.bottom > viewportRect.top && rect.top < viewportRect.bottom) {
          positions[entry.dataset.entryId || ''] = rect.top - viewportRect.top;
        }
      }
      samples.push({
        frame,
        top: Math.round(node.scrollTop),
        height: Math.round(node.scrollHeight),
        transform: node.querySelector('[data-testid="virtuoso-item-list"]')?.style.transform || '',
        positions,
      });
    }
    return samples;
  });
  await viewport.hover();
  // Keep producing real upward input while the first historical batch arrives.
  // The list owns anchor compensation; application code must not overwrite the
  // reader's wheel momentum with an absolute scrollTop from another frame.
  for (let step = 0; step < 40; step += 1) {
    await page.mouse.wheel(0, -360);
    await page.waitForTimeout(18);
    if (await viewport.evaluate((node) => node.scrollTop <= 1)) break;
  }
  const samples = await samplesPromise;
  const historySatisfied = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .some((entry) => entry.event === 'history.intent_satisfied'));
  expect(historySatisfied).toBe(true);
  const screenMotion = [];
  const motionFrames = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const shared = Object.keys(previous.positions).filter((id) => id && id in current.positions);
    if (!shared.length) continue;
    const movements = shared
      .map((id) => current.positions[id] - previous.positions[id])
      .sort((left, right) => left - right);
    const itemMovement = movements[Math.floor(movements.length / 2)];
    screenMotion.push(itemMovement);
    if (Math.abs(itemMovement) > 600 || itemMovement < -80) {
      motionFrames.push({ previous: { ...previous, positions: undefined }, current: { ...current, positions: undefined }, itemMovement });
    }
  }
  // Upward wheel input moves content down; native prepend anchoring keeps the
  // current reading row still. A large leap means another scrollTop controller
  // is fighting the reader's gesture.
  expect(Math.max(...screenMotion), JSON.stringify(motionFrames)).toBeLessThanOrEqual(600);
  expect(Math.min(...screenMotion), JSON.stringify(motionFrames)).toBeGreaterThanOrEqual(-80);
});

test('F7 reader can reverse direction immediately after a history prepend', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'mixed-height-history', seed: 1715 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  await page.mouse.wheel(0, -100_000);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .some((entry) => entry.event === 'history.intent_satisfied'))).toBe(true);

  // The prepend can still be receiving late ResizeObserver corrections here.
  // A downward gesture is nevertheless authoritative and must not be undone
  // by the old anchor transaction.
  const beforeReverse = await viewport.evaluate((node) => node.scrollTop);
  await page.mouse.wheel(0, 640);
  await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(beforeReverse + 20);
});

test('F7 oldest-history boundary stays inert under repeated upward input', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1716 } });
  expect(reset.ok()).toBe(true);
  await login(page);

  const viewport = page.locator('.timeline-message-list');
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  for (let step = 0; step < 30; step += 1) {
    await viewport.hover();
    await page.mouse.wheel(0, -100_000);
    await page.waitForTimeout(30);
  }
  await expect(page.getByText('c0 history 1: ask steward for PONG', { exact: true })).toBeVisible();
  await viewport.hover();
  await page.mouse.wheel(0, -100_000);
  await expect.poll(() => viewport.evaluate((node) => Math.round(node.scrollTop))).toBe(0);

  const before = await page.evaluate(() => {
    const node = document.querySelector('.timeline-message-list');
    const first = node.querySelector('[data-presentation-row-id]');
    return {
      top: node.scrollTop,
      rowID: first?.dataset.presentationRowId || '',
      rowTop: first?.getBoundingClientRect().top - node.getBoundingClientRect().top,
      starts: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event === 'history.intent_started').length,
    };
  });
  for (let step = 0; step < 12; step += 1) await page.mouse.wheel(0, -720);
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => {
    const node = document.querySelector('.timeline-message-list');
    const first = node.querySelector('[data-presentation-row-id]');
    return {
      top: node.scrollTop,
      rowID: first?.dataset.presentationRowId || '',
      rowTop: first?.getBoundingClientRect().top - node.getBoundingClientRect().top,
      starts: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event === 'history.intent_started').length,
    };
  });
  expect(after.top).toBe(0);
  expect(after.rowID).toBe(before.rowID);
  expect(Math.abs(after.rowTop - before.rowTop)).toBeLessThanOrEqual(1);
  expect(after.starts).toBe(before.starts);
});

test('F7 switching channels restores the saved semantic reading anchor', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1714 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  await page.mouse.wheel(0, -2_400);
  await page.waitForTimeout(150);
  const anchor = await viewport.evaluate((node) => {
    const viewportTop = node.getBoundingClientRect().top;
    const rows = [...node.querySelectorAll('[data-presentation-row-id]')]
      .map((row) => ({ id: row.dataset.presentationRowId, top: row.getBoundingClientRect().top - viewportTop, bottom: row.getBoundingClientRect().bottom - viewportTop }))
      .filter((row) => row.bottom > 0 && row.top < node.clientHeight)
      .sort((left, right) => left.top - right.top);
    return rows[0];
  });
  expect(anchor?.id).toBeTruthy();

  await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0\.project$/ }) }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0$/ }) }).click();
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect.poll(() => viewport.evaluate((node, expected) => {
    const row = [...node.querySelectorAll('[data-presentation-row-id]')]
      .find((candidate) => candidate.dataset.presentationRowId === expected.id);
    return row ? Math.abs((row.getBoundingClientRect().top - node.getBoundingClientRect().top) - expected.top) : Number.POSITIVE_INFINITY;
  }, anchor)).toBeLessThanOrEqual(2);
});

test('F7 mobile keeps realtime delivery while the reader is browsing history', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1708 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const viewport = page.locator('.timeline-message-list');
  for (let index = 0; index < 5; index += 1) {
    await viewport.hover();
    await page.mouse.wheel(0, -100_000);
    await page.waitForTimeout(40);
  }
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeGreaterThan(24);
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

test('F7 a bounded warm cache survives reload and satisfies one physical top demand', async ({ page, request }) => {
  test.setTimeout(90_000);
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
  // Startup establishes a useful P0 working set; it must not scan 5,000 cold
  // rows merely to satisfy an arbitrary cache ceiling. Deeper rows remain an
  // on-demand P2 pull and the warm set remains durable across reload.
  await expect.poll(cachedRows, { timeout: 30_000 }).toBeGreaterThanOrEqual(128);
  expect(await cachedRows()).toBeLessThan(1_000);

  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  const viewport = page.locator('.timeline-message-list');
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());

  await viewport.hover();
  await page.mouse.wheel(0, -100_000);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
	entry.event === 'history.intent_started'
  )))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
	entry.event === 'history.intent_satisfied'
  ))), { timeout: 30_000 }).toBe(true);

  const operations = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => (
	entry.event === 'history.intent_started'
  )));
  expect(operations).toHaveLength(1);
});

test('F7 a lagged cache paints locally, reconciles the network tail, then rejoins cache at the seam', async ({ page, request }) => {
  test.setTimeout(45_000);
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1711 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  // Wait only for the bounded current-tail working set. Exhausting all remote
  // history here would turn ordinary startup prefetch into an unbounded scan.
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
    entry.event === 'history.batch_complete'
      && entry.detail?.channelId === 'c0'
      && Number(entry.detail?.acceptedRows) > 0
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
  await expect.poll(() => resumed.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
    entry.event === 'history.segment_requested'
      && entry.detail?.channelId === 'c0'
      && entry.detail?.source === 'network'
  ))), { timeout: 15_000 }).toBe(true);

  const sources = await resumed.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .filter((entry) => entry.event === 'history.segment_requested' && entry.detail?.channelId === 'c0')
    .map((entry) => ({ source: entry.detail.source, beforeSeq: entry.detail.beforeSeq })));
  // Local decode is allowed to paint before attach. Once attach establishes a
  // newer authoritative head, the scheduler fills that network-only gap and
  // then resumes IndexedDB below the exact covered seam.
  expect(sources[0]?.source).toBe('indexeddb');
  const networkIndex = sources.findIndex((entry) => entry.source === 'network');
  expect(networkIndex).toBeGreaterThan(0);
  const cacheAfterNetwork = sources.findIndex((entry, index) => index > networkIndex && entry.source === 'indexeddb');
  expect(cacheAfterNetwork).toBeGreaterThan(networkIndex);
  expect(sources[cacheAfterNetwork].beforeSeq).toBeLessThan(sources[networkIndex].beforeSeq);
});

test('F7 cached progress-only ranges never stall restoration of the visible root turn', async ({ page, request }) => {
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
  expect(started.length).toBeGreaterThanOrEqual(1);
  expect(new Set(started.map((entry) => entry.detail.epoch)).size).toBe(1);
  const firstSatisfied = diagnostics.findIndex((entry) => entry.event === 'history.intent_satisfied');
  const startedIndexes = diagnostics.flatMap((entry, index) => entry.event === 'history.intent_started' ? [index] : []);
  const secondStarted = startedIndexes[1] ?? -1;
  expect(firstSatisfied).toBeGreaterThan(0);
  // Cache-first startup may already have the root row in the first local
  // segment. Otherwise loadUntilVisible crosses as many progress-only ranges
  // as needed. In both cases one operation owns restoration through its first
  // visible result; no second operation may race it.
  if (secondStarted >= 0) expect(firstSatisfied).toBeLessThan(secondStarted);
});
