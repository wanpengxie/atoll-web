import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import {
  installReadingOwnerHelper,
  readingOwner,
} from './reading-owner.js';

const PRINCIPAL = 'root';
const STORAGE_KEY = `atoll.view-session.v3.${PRINCIPAL}`;

async function reset(request, seed) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'deep-history', seed },
  });
  expect(response.ok()).toBe(true);
}

async function cachedRows(page, channelID) {
  return page.evaluate(async (id) => {
    const databaseName = 'atoll-channel-replica-v1';
    if (indexedDB.databases) {
      const databases = await indexedDB.databases();
      if (!databases.some((entry) => entry.name === databaseName)) return 0;
    }
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

async function login(page) {
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.locator('.timeline')).toBeVisible();
  await expect(page.locator('.timeline-reading-stack > .timeline-reading-layer.is-active > .timeline-message-list')).toHaveCount(1);
  await expect(page.locator('.top-error')).toHaveCount(0);
}

async function viewportState(page) {
  return page.evaluate(() => {
    const timeline = document.querySelector('.timeline');
    const owner = window.__ATOLL_TEST_READING_OWNER__;
    const viewport = owner.current();
    const bounds = viewport.getBoundingClientRect();
    const rowEvidence = [...viewport.querySelectorAll('[data-presentation-row-id]')]
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          node,
          id: node.dataset.presentationRowId,
          top: rect.top - bounds.top,
          bottom: rect.bottom - bounds.top,
          text: node.textContent || '',
        };
      });
    const visible = rowEvidence.filter((row) => row.bottom > 0 && row.top < bounds.height);
    // Virtuoso keeps overscan rows in DOM order.  The first DOM row is not
    // necessarily the row the reader can see: it may be fully above the
    // viewport, occluded, or only contribute an invisible sliver.  Match the
    // production observation contract by requiring a hit-tested painted point
    // inside the row before calling it the user-visible anchor.
    const userVisible = visible.filter((row) => {
      const node = row.node;
      const rect = node.getBoundingClientRect();
      const left = Math.max(bounds.left, rect.left);
      const right = Math.min(bounds.right, rect.right);
      const top = Math.max(bounds.top, rect.top);
      const bottom = Math.min(bounds.bottom, rect.bottom);
      if (right - left <= 1 || bottom - top <= 1) return false;
      const x = (left + right) / 2;
      return [top + 1, (top + bottom) / 2, bottom - 1].some((y) => {
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && (hit === node || node.contains(hit)));
      });
    }).sort((left, right) => left.top - right.top);
    const serialize = (row) => {
      if (!row) return null;
      const { node, ...evidence } = row;
      return evidence;
    };
    const firstVisible = serialize(userVisible[0] || null);
    return {
      mode: timeline?.dataset.viewportMode || '',
      hasInitialAnchor: timeline?.dataset.hasInitialAnchor || '',
      tailDistance: owner.tailDistance(viewport),
      visible: visible.map(serialize),
      userVisible: userVisible.map(serialize),
      domFirst: serialize(rowEvidence[0] || null),
      firstVisible,
      userAnchor: firstVisible,
      lastVisible: serialize(userVisible.at(-1) || null),
      storage: JSON.parse(localStorage.getItem('atoll.view-session.v3.root') || 'null'),
    };
  });
}

async function waitAtTail(page) {
  await page.waitForFunction(() => {
    const timeline = document.querySelector('.timeline');
    const owner = window.__ATOLL_TEST_READING_OWNER__;
    const viewport = owner.current();
    return timeline?.dataset.viewportMode === 'following'
      && !timeline.dataset.hasInitialAnchor
      && viewport
      && owner.tailDistance(viewport) <= 24;
  });
}

test('F7 reading position is document-session memory: cold and cached page starts use latest', async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  await installReadingOwnerHelper(page);
  await reset(request, 29601);
  await page.goto('/');
  expect(await cachedRows(page, 'c0')).toBe(0);

  // This is the exact legacy payload that previously made a new page restore
  // an old middle position. Preferences and unseen evidence share the record
  // and must survive while mode/bookmark stop being startup authority.
  await page.evaluate(({ key }) => localStorage.setItem(key, JSON.stringify({
    schema: 2,
    preferences: { c0: { scope: 'mine', actorFilter: [], foldOverrides: [], layoutChoices: [] } },
    readings: {
      'c0\u0000c0:mine:': {
        revision: 7,
        mode: 'browsing',
        bookmark: { messageID: 'c0-history-request-40', rowViewportOffset: -12, seq: 79 },
        unseenRecords: [],
      },
    },
  })), { key: STORAGE_KEY });

  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  await waitAtTail(page);
  const uncachedStart = await viewportState(page);
  expect(uncachedStart.mode).toBe('following');
  expect(uncachedStart.hasInitialAnchor).toBe('');
  expect(uncachedStart.tailDistance).toBeLessThanOrEqual(24);
  expect(uncachedStart.visible.some((row) => row.text.includes('c0 history 120'))).toBe(true);

  const viewport = readingOwner(page);
  await viewport.hover();
  await page.mouse.wheel(0, -1800);
  await page.waitForFunction(() => document.querySelector('.timeline')?.dataset.viewportMode === 'browsing');
  const beforeSwitch = await viewportState(page);
  expect(beforeSwitch.firstVisible?.id).toBeTruthy();
  expect(beforeSwitch.firstVisible?.text).not.toContain('c0 history 120');

  await page.getByRole('button', { name: '# c0.project', exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await page.getByRole('button', { name: '# c0', exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('c0');
  await page.waitForFunction((id) => (
    [...window.__ATOLL_TEST_READING_OWNER__.current().querySelectorAll('[data-presentation-row-id]')]
      .some((row) => row.dataset.presentationRowId === id
        && row.getBoundingClientRect().bottom > window.__ATOLL_TEST_READING_OWNER__.current().getBoundingClientRect().top)
  ), beforeSwitch.firstVisible.id);
  const afterSwitch = await viewportState(page);
  expect(afterSwitch.mode).toBe('browsing');
  const restoredAnchor = afterSwitch.visible.find((row) => row.id === beforeSwitch.firstVisible.id);
  const anchorEvidence = {
    before: {
      domFirst: beforeSwitch.domFirst,
      firstHitTested: beforeSwitch.firstVisible,
      exactAnchor: beforeSwitch.visible.find((row) => row.id === beforeSwitch.firstVisible.id),
    },
    after: {
      domFirst: afterSwitch.domFirst,
      firstHitTested: afterSwitch.firstVisible,
      exactAnchor: restoredAnchor,
    },
    contract: 'preserve the hit-tested painted first user anchor; exact row is diagnostic only',
  };
  const anchorEvidencePath = testInfo.outputPath('reading-user-anchor-position.json');
  await writeFile(anchorEvidencePath, `${JSON.stringify(anchorEvidence, null, 2)}\n`, 'utf8');
  await testInfo.attach('reading-user-anchor-position.json', {
    path: anchorEvidencePath,
    contentType: 'application/json',
  });
  // `firstHitTested` is the first painted row the user can see. The exact
  // retained row may still exist in the overscan DOM after a one-row shift;
  // accepting that would hide a user-visible 112 -> 111 jump. Keep the strict
  // painted-anchor contract separate from the diagnostic exact-row evidence.
  expect(afterSwitch.firstVisible?.id).toBe(beforeSwitch.firstVisible.id);
  expect(Math.abs(afterSwitch.firstVisible.top - beforeSwitch.firstVisible.top)).toBeLessThanOrEqual(80);
  expect(await cachedRows(page, 'c0')).toBeGreaterThan(0);

  // Re-inject an old-position payload to prove the read boundary, rather than
  // merely relying on the new writer having scrubbed it.
  await page.evaluate(({ key, bookmark }) => {
    const value = JSON.parse(localStorage.getItem(key));
    const readingKey = Object.keys(value.readings || {}).find((candidate) => candidate.startsWith('c0\u0000'))
      || 'c0\u0000c0:mine:';
    value.readings ||= {};
    value.readings[readingKey] = {
      ...(value.readings[readingKey] || {}),
      revision: Number(value.readings[readingKey]?.revision || 0) + 100,
      mode: 'browsing',
      bookmark,
    };
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: STORAGE_KEY, bookmark: { messageID: beforeSwitch.firstVisible.id, rowViewportOffset: beforeSwitch.firstVisible.top } });

  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  await waitAtTail(page);
  const cachedRefresh = await viewportState(page);
  expect(cachedRefresh.mode).toBe('following');
  expect(cachedRefresh.hasInitialAnchor).toBe('');
  expect(cachedRefresh.tailDistance).toBeLessThanOrEqual(24);
  expect(cachedRefresh.visible.some((row) => row.text.includes('c0 history 120'))).toBe(true);
  expect(cachedRefresh.storage.preferences.c0.scope).toBe('mine');

  const result = {
    uncachedStart,
    beforeSwitch,
    afterSwitch,
    cachedRefresh,
    cachedRows: await cachedRows(page, 'c0'),
  };
  const path = testInfo.outputPath('reading-position-session.json');
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await testInfo.attach('reading-position-session.json', { path, contentType: 'application/json' });
});
