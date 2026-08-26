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
      const open = indexedDB.open('atoll-feed-v7');
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
    .some((entry) => ['timeline.history_demand_waiting', 'timeline.history_revealed'].includes(entry.event)))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
    (entry.event === 'timeline.history_revealed' && Number(entry.detail?.released) > 0)
    || (entry.event === 'history.batch_complete' && entry.detail?.purpose === 'hydrate' && Number(entry.detail?.demandReleased) > 0)
  ))), { timeout: 5_000 }).toBe(true);
  expect(await page.locator('.timeline-virtual-item').count()).toBeLessThan(100);
});

test('F7 a 5000-row warm cache survives reload and satisfies one physical top demand', async ({ page, request }) => {
  test.setTimeout(45_000);
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'huge-history', seed: 1710 } });
  expect(reset.ok()).toBe(true);
  await login(page);

  const cachedRows = () => page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const open = indexedDB.open('atoll-feed-v7');
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
  await expect.poll(cachedRows, { timeout: 20_000 }).toBe(5_000);

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
    entry.event === 'history.demand_taken'
    && Number(entry.detail?.before?.reservoir) > 0
    && Number(entry.detail?.released) > 0
  )))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
    entry.event === 'timeline.history_demand_satisfied'
  )))).toBe(true);

  const operations = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => (
    entry.event === 'history.demand_taken'
  )));
  expect(operations).toHaveLength(1);
});
