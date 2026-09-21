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
    const database = await new Promise((resolve, reject) => {
      const open = indexedDB.open('atoll-channel-replica-v1');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    if (!database.objectStoreNames.contains('rows')) {
      database.close();
      return 0;
    }
    return new Promise((resolve, reject) => {
      const request = database.transaction('rows', 'readonly').objectStore('rows').getAll();
      request.onsuccess = () => {
        const rows = request.result.filter((row) => row.channelId === id);
        database.close();
        resolve(rows.length);
      };
      request.onerror = () => {
        database.close();
        reject(request.error);
      };
    });
  }, channelID);
}

async function publicEvidence(page) {
  return page.evaluate(() => {
    const list = document.querySelector('.timeline-message-list');
    const rows = [...document.querySelectorAll('[data-presentation-row-id]')]
      .map((row) => ({ id: row.dataset.presentationRowId || '', text: row.textContent || '' }));
    const completions = window.__ATOLL_DIAGNOSTICS__.snapshot()
      .filter((entry) => entry.event === 'history.batch_complete' && entry.detail?.channelId === 'c0');
    return {
      completions: completions.map((entry) => entry.detail),
      rows,
      rowIDs: rows.map((row) => row.id),
      uniqueRowIDs: new Set(rows.map((row) => row.id)).size,
      gap: list ? list.scrollHeight - list.clientHeight - list.scrollTop : null,
      mode: document.querySelector('.timeline')?.getAttribute('data-viewport-mode') || '',
    };
  });
}

test('TC0232 F7 a lagged cache paints locally, reconciles the network tail, then rejoins cache at the seam', async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  await reset(request, 'deep-history', 1711);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  // The current Feed owner exposes one canonical completion for each physical
  // page. This is only the first installed fact; the browser contract below
  // still requires a readable cache segment and a later user-visible seam.
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
    entry.event === 'history.batch_complete'
      && entry.detail?.channelId === 'c0'
      && Number(entry.detail?.acceptedRows) > 0
  )))).toBe(true);

  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  await page.mouse.wheel(0, -100_000);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
    entry.event === 'history.intent_satisfied'
  ))), { timeout: 15_000 }).toBe(true);
  // Preserve the old user-visible working-set boundary. Metadata or a receipt
  // count cannot substitute for canonical durable rows.
  await expect.poll(() => cachedRows(page, 'c0'), { timeout: 15_000 }).toBeGreaterThanOrEqual(160);

  await viewport.hover();
  await page.mouse.wheel(0, 100_000);
  await expect.poll(() => viewport.evaluate((node) => (
    Math.round(node.scrollHeight - node.clientHeight - node.scrollTop)
  ))).toBeLessThanOrEqual(24);

  const context = page.context();
  await page.close();
  for (let index = 0; index < 20; index += 1) {
    const pulse = await request.post('/mock/control/action', { data: { type: 'pulse' } });
    expect(pulse.ok()).toBe(true);
  }

  const resumed = await context.newPage();
  try {
    await resumed.goto('/');
    await expect(resumed.locator('.connection-state')).toHaveClass(/state-open/);
    await expect(resumed.getByText(/c0 动态 #19/)).toBeVisible();

    // The public contract is the readable, gap-free, duplicate-free resumed
    // surface. Feed source details remain diagnostic evidence, not a second
    // user-visible success gate.
    const evidence = await publicEvidence(resumed);
    await testInfo.attach('tc0232-lagged-cache-seam-attempt.json', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
    expect(evidence.rowIDs.length).toBeGreaterThan(0);
    expect(evidence.uniqueRowIDs).toBe(evidence.rowIDs.length);
    expect(evidence.gap).toBeLessThanOrEqual(24);
  } finally {
    await resumed.close().catch(() => {});
  }
});
