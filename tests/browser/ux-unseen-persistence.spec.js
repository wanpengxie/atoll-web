import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

async function attachJSON(testInfo, name, value) {
  const path = testInfo.outputPath(name);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

async function reset(request, seed) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'deep-history', seed },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.locator('.timeline-message-list [data-presentation-row-id]').last()).toBeVisible();
}

async function approval(request) {
  const response = await request.post('/mock/control/action', {
    data: { type: 'approval', channel_id: 'c0' },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function readingState(page) {
  return page.evaluate(() => {
    const storage = JSON.parse(localStorage.getItem('atoll.view-session.v3.root') || 'null');
    const readings = storage?.readings || {};
    const key = Object.keys(readings).find((candidate) => candidate.startsWith('c0\u0000c0:mine:')) || '';
    return { key, value: key ? readings[key] : null };
  });
}

async function evidence(page, stage) {
  return page.evaluate((label) => {
    const viewport = document.querySelector('.timeline-message-list');
    const storage = JSON.parse(localStorage.getItem('atoll.view-session.v3.root') || 'null');
    const readings = storage?.readings || {};
    const key = Object.keys(readings).find((candidate) => candidate.startsWith('c0\u0000c0:mine:')) || '';
    const trace = window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.() || {};
    const entries = trace.entries || [];
    const acks = entries.filter((entry) => entry.event === 'reading.visible-rows-ack');
    const owner = [...entries].reverse().find((entry) => entry.event === 'reading.owner-commit');
    return {
      stage: label,
      readingKey: key,
      saved: key ? readings[key] : null,
      jumpText: document.querySelector('.timeline-jump-latest')?.textContent || '',
      physicalGap: viewport ? viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop : null,
      installedTailID: [...(viewport?.querySelectorAll('[data-presentation-row-id]') || [])]
        .at(-1)?.dataset.presentationRowId || '',
      mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
      surfaceVisibility: document.querySelector('.dynamic-message-pane')
        ? getComputedStyle(document.querySelector('.dynamic-message-pane')).visibility
        : '',
      documentVisibility: document.visibilityState,
      activationID: owner?.detail?.activationID || '',
      lastAck: acks.at(-1)?.detail || null,
      acks: acks.map((entry) => entry.detail),
      trace,
    };
  }, stage);
}

test('reload normalizes durable unseen records, then verified latest clears exactly those records', async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  await reset(request, 29109);
  await login(page);
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'ux-unseen-persistence' }));

  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  await page.mouse.wheel(0, -2_000);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');

  const arrival = await approval(request);
  await expect(page.getByRole('button', { name: /1 条新动态/ })).toBeVisible();

  const live = await readingState(page);
  expect(live.key).toBeTruthy();
  expect(live.value?.unseenRecords).toHaveLength(1);
  const [validKey, validSeq] = live.value.unseenRecords[0];
  expect(Number.isSafeInteger(validSeq) && validSeq > 0).toBe(true);

  await page.evaluate(({ readingKey, key, seq }) => {
    const storageKey = 'atoll.view-session.v3.root';
    const stored = JSON.parse(localStorage.getItem(storageKey));
    const current = stored.readings[readingKey];
    stored.readings[readingKey] = {
      ...current,
      revision: Number(current.revision || 0) + 1,
      unseenTail: 7,
      // A durable sequence-backed identity is authoritative; malformed and
      // legacy key-only entries must be discarded at the storage boundary.
      unseenKeys: ['legacy-key-only', 'another-legacy-key'],
      unseenRecords: [
        [key, seq - 1],
        [key, seq],
        ['invalid-zero', 0],
        ['invalid-infinity', 'Infinity'],
      ],
    };
    localStorage.setItem(storageKey, JSON.stringify(stored));
  }, { readingKey: live.key, key: validKey, seq: validSeq });

  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'ux-unseen-persistence-reloaded' }));
  await expect.poll(async () => (await readingState(page)).value?.unseenTail).toBeGreaterThan(0);
  const restored = await evidence(page, 'restored');
  await attachJSON(testInfo, 'ux-unseen-persistence-restored.json', {
    source: { validKey, validSeq, arrival },
    restored,
  });

  expect(restored.jumpText).toBe('↓ 1 条新动态');
  expect(restored.saved?.unseenTail).toBe(1);
  expect(restored.saved?.unseenKeys).toEqual([validKey]);
  expect(restored.saved?.unseenRecords).toEqual([[validKey, validSeq]]);

  await page.getByRole('button', { name: /1 条新动态/ }).click();
  await expect(page.locator('.timeline-jump-latest')).toHaveCount(0);
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(24);
  const cleared = await evidence(page, 'cleared');
  await attachJSON(testInfo, 'ux-unseen-persistence-cleared.json', cleared);

  expect(cleared.saved?.unseenTail).toBe(0);
  expect(cleared.saved?.unseenKeys).toEqual([]);
  expect(cleared.saved?.unseenRecords).toEqual([]);
  expect(cleared.acks.some((ack) => ack.before?.records?.some(
    (record) => record.key === validKey && record.seq === validSeq,
  ))).toBe(true);
  expect(cleared.lastAck?.remaining).toBe(0);
  expect(cleared.mode).toBe('following');
  expect(cleared.surfaceVisibility).toBe('visible');
  expect(cleared.documentVisibility).toBe('visible');
});
