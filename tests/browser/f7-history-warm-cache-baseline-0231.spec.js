import { expect, test } from '@playwright/test';

async function reset(request, scenario, seed) {
  const response = await request.post('/mock/control/reset', { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

async function cachedRows(page, channelID) {
  return page.evaluate(async (id) => {
    const databaseName = 'atoll-channel-replica-v1';
    const database = await new Promise((resolve, reject) => {
      const open = indexedDB.open(databaseName);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    if (!database.objectStoreNames.contains('rows')) {
      database.close();
      return 0;
    }
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('rows', 'readonly');
      const rows = transaction.objectStore('rows').getAll();
      rows.onsuccess = () => {
        const result = rows.result.filter((row) => row.channelId === id).length;
        database.close();
        resolve(result);
      };
      rows.onerror = () => {
        database.close();
        reject(rows.error);
      };
    });
  }, channelID);
}

test('FAE-1644 F7 bounded warm cache survives reload and satisfies one physical top demand', async ({ page, request }, testInfo) => {
  // Current public persistence owner is channel-replica-v1. This is the
  // current-schema successor of the old atoll-feed-v8 browser contract.
  test.setTimeout(90_000);
  await reset(request, 'huge-history', 1710);
  await login(page);

  // Startup must establish a useful bounded P0 working set without scanning
  // every cold row. Deeper rows remain an on-demand physical top pull.
  let warmRows = null;
  let startupOutstanding = null;
  let startupDiagnostics = [];
  try {
    await expect.poll(() => cachedRows(page, 'c0'), { timeout: 30_000 }).toBeGreaterThanOrEqual(128);
    warmRows = await cachedRows(page, 'c0');
    expect(warmRows).toBeLessThan(1_000);
    startupDiagnostics = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot());
    startupOutstanding = startupDiagnostics.filter((entry) => entry.event === 'history.segment_requested').length
      - startupDiagnostics.filter((entry) => entry.event === 'history.batch_complete').length;
    expect(startupOutstanding).toBe(0);
  } finally {
    warmRows ??= await cachedRows(page, 'c0').catch(() => null);
    startupDiagnostics = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot());
    await testInfo.attach('warm-cache-startup.json', {
      body: JSON.stringify({ warmRows, startupOutstanding, diagnostics: startupDiagnostics }, null, 2),
      contentType: 'application/json',
    });
  }

  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  const viewport = page.locator('.timeline-message-list');
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());

  // One native top gesture must satisfy exactly one physical demand.
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

  // Scroll + scrollend from the first gesture are deduplicated, but the key
  // is not lifetime suppression: a second native gesture owns a new epoch.
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());
  await page.mouse.wheel(0, -100_000);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => (
    entry.event === 'history.intent_started'
  )).length)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
    entry.event === 'history.intent_satisfied'
  ))), { timeout: 30_000 }).toBe(true);
  const continued = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .find((entry) => entry.event === 'history.intent_started'));
  expect(continued.detail.anchorSeq).toBeLessThan(operations[0].detail.anchorSeq);
  await testInfo.attach('warm-cache-demand.json', {
    body: JSON.stringify({
      warmRows,
      operations,
      continued,
      diagnostics: await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()),
    }, null, 2),
    contentType: 'application/json',
  });
});
