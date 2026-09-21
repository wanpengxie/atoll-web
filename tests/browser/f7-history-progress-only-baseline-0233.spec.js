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

async function replicaSnapshot(page, channelID) {
  return page.evaluate(async (id) => {
    const database = await new Promise((resolve, reject) => {
      const open = indexedDB.open('atoll-channel-replica-v1');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const readStore = (storeName) => new Promise((resolve, reject) => {
      if (!database.objectStoreNames.contains(storeName)) {
        resolve([]);
        return;
      }
      const request = database.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const [meta, rows] = await Promise.all([readStore('meta'), readStore('rows')]);
      const selected = meta.find((entry) => entry.channelId === id);
      return {
        meta: selected?.value || null,
        rows: rows.filter((entry) => entry.channelId === id).map((entry) => entry.row),
      };
    } finally {
      database.close();
    }
  }, channelID);
}

async function publicRestoreEvidence(page) {
  return page.evaluate(() => ({
    rootVisible: [...document.querySelectorAll('[data-presentation-row-id]')]
      .some((row) => row.textContent?.includes('dense progress request (640)')),
    demandPhase: document.querySelector('.timeline-history-demand')?.getAttribute('data-phase') || 'idle',
    historyStatus: [...document.querySelectorAll('.timeline-history-status')]
      .map((node) => node.textContent || '')
      .filter(Boolean),
    presentationRows: [...document.querySelectorAll('[data-presentation-row-id]')]
      .map((row) => row.dataset.presentationRowId || ''),
    viewportMode: document.querySelector('.timeline')?.getAttribute('data-viewport-mode') || '',
  }));
}

async function diagnosticReplicaSnapshot(page, channelID) {
  try {
    return await Promise.race([
      replicaSnapshot(page, channelID),
      new Promise((resolve) => setTimeout(() => resolve({ skipped: 'cache snapshot timed out' }), 2_000)),
    ]);
  } catch (error) {
    return { skipped: String(error?.message || error) };
  }
}

test('TC0233 F7 cached progress-only ranges never stall restoration of the visible root turn', async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  await reset(request, 'deep-history', 1712);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const dense = await request.post('/mock/control/action', {
    data: { type: 'dense_progress', channel_id: 'c0', count: 640 },
  });
  expect(dense.ok()).toBe(true);
  const detail = await dense.json();

  // This is the user-visible live-ingress seam.  Cache rows/meta are retained
  // below only as diagnostic evidence; they are not an oracle for this case.
  await expect(page.getByText('dense progress request (640)', { exact: true })).toBeVisible({ timeout: 15_000 });
  const warmSnapshot = await diagnosticReplicaSnapshot(page, 'c0');
  await testInfo.attach('tc0233-progress-only-cache-diagnostic.json', {
    body: JSON.stringify({ detail, snapshot: warmSnapshot }, null, 2),
    contentType: 'application/json',
  });

  const context = page.context();
  await page.close();
  const resumed = await context.newPage();
  try {
    await resumed.goto('/');
    await expect(resumed.locator('.connection-state')).toHaveClass(/state-open/);
    await expect(resumed.getByText('dense progress request (640)', { exact: true })).toBeVisible({ timeout: 15_000 });

    const evidence = await publicRestoreEvidence(resumed);
    await testInfo.attach('tc0233-progress-only-restore.json', {
      body: JSON.stringify({ detail, snapshot: warmSnapshot, evidence }, null, 2),
      contentType: 'application/json',
    });
    expect(evidence.rootVisible).toBe(true);
    expect(evidence.demandPhase).toBe('idle');
    expect(evidence.historyStatus.some((text) => text.includes('确认频道内容'))).toBe(false);
    expect(evidence.presentationRows).toContain(detail.request_id);
  } finally {
    await resumed.close().catch(() => {});
  }
});
