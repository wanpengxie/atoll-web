import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { readingOwner } from './reading-owner.js';

// This is deliberately an observation-only oracle.  It does not import a
// product module, install a compatibility owner, or change any existing case.
// The browser exposes the only facts needed to locate the first broken edge:
// mock input, durable cursor/high-water storage, the public replica cache,
// mounted presentation rows, public rail diagnostics, and reading trace.

async function attachJSON(testInfo, name, payload) {
  const path = testInfo.outputPath(name);
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

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
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.locator('.timeline')).toBeVisible();
  await expect(readingOwner(page)).toHaveCount(1);
}

function channel(page, name) {
  return page.locator('.channel-item').filter({
    has: page.locator('.channel-name', {
      hasText: new RegExp(`^${name.replace('.', '\\.')}$`),
    }),
  });
}

async function clickChannel(page, name) {
  try {
    await channel(page, name).click({ timeout: 10_000 });
    await expect(page.locator('main h1')).toHaveText(name, { timeout: 10_000 });
  } catch {
    // The oracle must still emit the chain when the product stops between
    // navigation and presentation.  The snapshot records that gap.
    await page.waitForTimeout(300);
  }
}

async function reachBottom(page) {
  try {
    const viewport = readingOwner(page);
    await viewport.hover({ timeout: 5_000 });
    await page.mouse.wheel(0, 100_000);
    await expect.poll(() => viewport.evaluate((node) => (
      node.dataset.readingContainer === 'following-tail'
        ? Math.abs(Number(node.scrollTop || 0))
        : Number(node.scrollHeight || 0) - Number(node.clientHeight || 0) - Number(node.scrollTop || 0)
    )), { timeout: 10_000 }).toBeLessThanOrEqual(2);
  } catch {
    // Keep the snapshot instead of replacing a product failure with a fixture
    // or selector failure.
  }
}

async function startNoticeCapture(page, channelID) {
  await page.evaluate((name) => {
    const capture = { active: true, frames: [], startedAt: performance.now() };
    window.__ATOLL_NOTIFICATION_OWNER_ORACLE__ = capture;
    const tick = () => {
      if (!capture.active) return;
      const item = [...document.querySelectorAll('.channel-item')]
        .find((node) => node.querySelector('.channel-name')?.textContent?.trim() === name);
      const viewport = document.querySelector('.timeline-reading-stack > .timeline-reading-layer.is-active > .timeline-message-list');
      const bounds = viewport?.getBoundingClientRect();
      const gap = viewport ? (viewport.dataset.readingContainer === 'following-tail'
        ? Math.abs(Number(viewport.scrollTop || 0))
        : Number(viewport.scrollHeight || 0) - Number(viewport.clientHeight || 0) - Number(viewport.scrollTop || 0)) : null;
      const digits = (node) => Number(String(node?.textContent || '').replace(/[^0-9]/g, '')) || 0;
      capture.frames.push({
        elapsedMs: Math.round(performance.now() - capture.startedAt),
        mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
        gap: gap == null ? null : Math.round(gap),
        tail: Boolean(bounds && gap != null && gap <= 2),
        related: digits(item?.querySelector('.unread-related')),
        total: digits(item?.querySelector('.unread-total:not(.unread-pending)')),
        pending: Boolean(item?.querySelector('.unread-pending')),
        jump: digits(document.querySelector('.timeline-jump-latest')),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, channelID);
}

async function stopNoticeCapture(page) {
  return page.evaluate(() => {
    const capture = window.__ATOLL_NOTIFICATION_OWNER_ORACLE__;
    if (!capture) return [];
    capture.active = false;
    return capture.frames || [];
  });
}

async function act(request, data) {
  const response = await request.post('/mock/control/action', { data });
  let body = null;
  try { body = await response.json(); } catch { /* response is still recorded */ }
  return { data, ok: response.ok(), status: response.status(), body };
}

async function approval(request, channelID) {
  return act(request, { type: 'approval', channel_id: channelID });
}

function actionIDs(action) {
  const result = [];
  const visit = (value, depth = 0) => {
    if (depth > 4 || value == null) return;
    if (Array.isArray(value)) { value.slice(0, 100).forEach((entry) => visit(entry, depth + 1)); return; }
    if (typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (/^(id|request_id|requestId|row_id|rowId)$/.test(key) && typeof item === 'string') result.push(item);
      else if (key === 'rows' || key === 'envelope' || key === 'body' || key === 'result') visit(item, depth + 1);
    }
  };
  visit(action?.body);
  return [...new Set(result)];
}

function compact(value, depth = 0) {
  if (depth > 4 || value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => compact(entry, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 80).map(([key, item]) => [key, compact(item, depth + 1)]));
  }
  return String(value);
}

async function snapshot(page, channelID, phase, extra = {}) {
  let value;
  try {
    value = await page.evaluate(async ({ channelID, phase, extra }) => {
      const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
      const readCursors = () => {
        const authorities = {};
        for (let index = 0; index < localStorage.length; index += 1) {
          const key = localStorage.key(index);
          if (!key?.startsWith('atoll.feed-cursors.v1.')) continue;
          try {
            const parsed = JSON.parse(localStorage.getItem(key) || '{}');
            authorities[key] = {
              reads: Object.fromEntries(Object.entries(parsed.reads || {}).map(([id, seq]) => [id, number(seq)])),
              notifications: Object.fromEntries(Object.entries(parsed.notifications || {}).map(([id, seq]) => [id, number(seq)])),
            };
          } catch {
            authorities[key] = { parseError: true };
          }
        }
        return authorities;
      };

      const readReplica = async () => {
        const databaseName = 'atoll-channel-replica-v1';
        let database;
        try {
          if (indexedDB.databases) {
            const known = await indexedDB.databases();
            if (!known.some((entry) => entry.name === databaseName)) return { available: false, rows: [], meta: null };
          }
          database = await new Promise((resolve, reject) => {
            const request = indexedDB.open(databaseName);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('open failed'));
          });
          const stores = ['rows', 'meta'].filter((name) => database.objectStoreNames.contains(name));
          if (!stores.length) return { available: false, rows: [], meta: null };
          const values = await new Promise((resolve, reject) => {
            const transaction = database.transaction(stores, 'readonly');
            const requests = Object.fromEntries(stores.map((name) => [name, transaction.objectStore(name).getAll()]));
            transaction.oncomplete = () => resolve(Object.fromEntries(Object.entries(requests).map(([name, request]) => [name, request.result || []])));
            transaction.onerror = () => reject(transaction.error || new Error('read failed'));
            transaction.onabort = () => reject(transaction.error || new Error('read aborted'));
          });
          const rows = (values.rows || []).filter((entry) => entry.channelId === channelID).map((entry) => ({
            owner: entry.owner || '',
            channelId: entry.channelId || '',
            seq: number(entry.seq),
            id: entry.row?.envelope?.id || entry.row?.id || '',
            kind: entry.row?.envelope?.kind || entry.row?.kind || '',
            type: entry.row?.envelope?.type || entry.row?.type || '',
          })).sort((left, right) => left.seq - right.seq);
          const meta = (values.meta || []).filter((entry) => entry.channelId === channelID).map((entry) => ({
            owner: entry.owner || '',
            channelId: entry.channelId || '',
            value: {
              headSeq: number(entry.value?.headSeq),
              newestSeq: number(entry.value?.newestSeq),
              oldestSeq: number(entry.value?.oldestSeq),
              rowCount: number(entry.value?.rowCount),
              coverage: entry.value?.coverage || [],
            },
          }));
          return { available: true, rows: rows.slice(-300), meta };
        } catch (error) {
          return { available: false, error: String(error?.message || error), rows: [], meta: null };
        } finally {
          database?.close?.();
        }
      };

      const viewport = document.querySelector('.timeline-reading-stack > .timeline-reading-layer.is-active > .timeline-message-list');
      const bounds = viewport?.getBoundingClientRect();
      const mounted = [...(viewport?.querySelectorAll('[data-presentation-row-id]') || [])].map((row) => {
        const rect = row.getBoundingClientRect();
        return {
          id: row.dataset.presentationRowId || '',
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          visible: Boolean(bounds && rect.bottom > bounds.top && rect.top < bounds.bottom),
        };
      });
      const item = [...document.querySelectorAll('.channel-item')].find((node) => node.querySelector('.channel-name')?.textContent?.trim() === channelID);
      const digits = (node) => Number(String(node?.textContent || '').replace(/[^0-9]/g, '')) || 0;
      const railDOM = {
        related: digits(item?.querySelector('.unread-related')),
        total: digits(item?.querySelector('.unread-total:not(.unread-pending)')),
        pending: Boolean(item?.querySelector('.unread-pending')),
        jump: digits(document.querySelector('.timeline-jump-latest')),
      };
      const reading = window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.() || null;
      const readingEntries = Array.isArray(reading?.entries) ? reading.entries.slice(-80).map((entry) => ({
        event: entry.event || '',
        sequence: number(entry.sequence),
        detail: entry.detail || {},
      })) : [];
      const rail = window.__ATOLL_DIAGNOSTICS__?.rail?.snapshot?.(channelID) || null;
      return {
        at: new Date().toISOString(),
        phase,
        extra,
        cursor: { authorities: readCursors() },
        replica: await readReplica(),
        presentation: {
          channelID,
          mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
          readingContainer: viewport?.dataset.readingContainer || '',
          gap: viewport ? Math.round(viewport.dataset.readingContainer === 'following-tail'
            ? Math.abs(Number(viewport.scrollTop || 0))
            : Number(viewport.scrollHeight || 0) - Number(viewport.clientHeight || 0) - Number(viewport.scrollTop || 0)) : null,
          mounted,
          visibleIDs: mounted.filter((row) => row.visible).map((row) => row.id),
        },
        rail: { diagnostic: rail, dom: railDOM },
        reading: {
          enabled: reading?.enabled === true,
          entries: readingEntries,
          session: (() => { try { return JSON.parse(localStorage.getItem('atoll.view-session.v3.root') || 'null'); } catch { return null; } })(),
        },
      };
    }, { channelID, phase, extra });
  } catch (error) {
    value = {
      at: new Date().toISOString(), phase, extra,
      error: String(error?.message || error),
      cursor: {}, replica: {}, presentation: {}, rail: {}, reading: {},
    };
  }
  return value;
}

async function trace(page, channelID, traces, phase, extra = {}) {
  const value = await snapshot(page, channelID, phase, extra);
  traces.push(value);
  return value;
}

function cursorSummary(value, channelID) {
  const authorities = Object.values(value?.cursor?.authorities || {});
  const reads = authorities.flatMap((entry) => Object.entries(entry.reads || {}).filter(([id]) => id === channelID).map(([, seq]) => Number(seq)));
  const notifications = authorities.flatMap((entry) => Object.entries(entry.notifications || {}).filter(([id]) => id === channelID).map(([, seq]) => Number(seq)));
  return {
    readSeq: Math.max(0, ...reads),
    notificationHighWater: Math.max(0, ...notifications),
    authorities: authorities.length,
  };
}

function railSummary(value, channelID) {
  const channels = value?.rail?.diagnostic?.channels || [];
  const channelValue = channels.find((entry) => entry.channelId === channelID) || channels[0] || null;
  return {
    present: Boolean(channelValue),
    authorityReady: channelValue?.authorityReady === true,
    readSeq: Number(channelValue?.readSeq || 0),
    notificationHighWater: Number(channelValue?.notificationHighWater || 0),
    counts: {
      related: Number(channelValue?.counts?.related || 0),
      total: Number(channelValue?.counts?.total || 0),
    },
    dom: value?.rail?.dom || {},
    rows: channelValue?.rows || [],
  };
}

function replicaSummary(value, channelID) {
  const rows = value?.replica?.rows || [];
  return {
    available: value?.replica?.available === true,
    count: rows.length,
    maxSeq: Math.max(0, ...rows.map((row) => Number(row.seq || 0))),
    ids: rows.map((row) => row.id).filter(Boolean),
    meta: value?.replica?.meta || [],
    channelID,
  };
}

function readingSummary(value) {
  const entries = value?.reading?.entries || [];
  return {
    enabled: value?.reading?.enabled === true,
    events: [...new Set(entries.map((entry) => entry.event).filter(Boolean))],
    visibleRows: entries.flatMap((entry) => entry.detail?.visibleRowIDs || []).slice(-100),
  };
}

function targetIDs(actions) {
  return [...new Set(actions.flatMap((action) => actionIDs(action)))];
}

function firstDivergence({ scenario, channelID, traces, actions, expected = {} }) {
  const final = (expected.phase && traces.find((entry) => entry.phase === expected.phase)) || traces.at(-1) || {};
  const cursor = cursorSummary(final, channelID);
  const replica = replicaSummary(final, channelID);
  const rail = railSummary(final, channelID);
  const reading = readingSummary(final);
  const ids = targetIDs(actions);
  const missingIDs = ids.filter((id) => !replica.ids.includes(id));
  const phase = final.phase || 'unknown';

  // Ordered in the same direction as the contract.  A missing rail provider
  // is reported only after durable cursor and replica evidence are inspected;
  // this avoids calling a rail symptom a cursor failure.
  if (expected.notificationHighWater != null && cursor.notificationHighWater < expected.notificationHighWater) {
    return {
      stage: 'cursor/highwater',
      phase,
      reason: `notification cursor ${cursor.notificationHighWater} < expected ${expected.notificationHighWater}`,
      cursor,
      replica,
      rail,
      reading,
    };
  }
  if (expected.requireReplicaIDs && missingIDs.length) {
    return {
      stage: 'replica',
      phase,
      reason: `input identities absent from channel replica: ${missingIDs.join(', ')}`,
      inputIDs: ids,
      cursor,
      replica,
      rail,
      reading,
    };
  }
  if (expected.visibleID && !final.presentation?.visibleIDs?.includes(expected.visibleID)) {
    return {
      stage: 'presentation',
      phase,
      reason: `expected visible row ${expected.visibleID} is not mounted in the visible owner`,
      expectedVisibleID: expected.visibleID,
      cursor,
      replica,
      presentation: final.presentation || {},
      rail,
      reading,
    };
  }
  if (expected.requireAuthority && !rail.authorityReady) {
    return {
      stage: 'rail',
      phase,
      reason: 'public rail snapshot has no ready channel authority',
      cursor,
      replica,
      rail,
      reading,
    };
  }
  if (expected.railHighWater != null && (!rail.present || rail.notificationHighWater < expected.railHighWater)) {
    return {
      stage: 'rail',
      phase,
      reason: `rail high-water ${rail.notificationHighWater} < expected ${expected.railHighWater}`,
      cursor,
      replica,
      rail,
      reading,
    };
  }
  if (expected.railCounts && (
    rail.dom.related !== expected.railCounts.related
      || rail.dom.total !== expected.railCounts.total
      || (expected.railCounts.jump != null && rail.dom.jump !== expected.railCounts.jump)
  )) {
    return {
      stage: 'rail',
      phase,
      reason: `rail DOM counts related=${rail.dom.related}, total=${rail.dom.total}, jump=${rail.dom.jump}`,
      expectedRailCounts: expected.railCounts,
      cursor,
      replica,
      rail,
      reading,
    };
  }
  if (expected.transientRailNotice && (final.extra?.frames || []).some((frame) => (
    frame.tail && (frame.related > 0 || frame.total > 0 || frame.pending || frame.jump > 0)
  ))) {
    return {
      stage: 'rail',
      phase,
      reason: 'following-tail frame exposed a transient unread/jump notice after the input row was mounted',
      frames: final.extra.frames,
      cursor,
      replica,
      rail,
      reading,
    };
  }
  if (expected.readingEvent && !reading.events.some((event) => expected.readingEvent.includes(event))) {
    return {
      stage: 'reading',
      phase,
      reason: `reading trace did not contain ${expected.readingEvent.join(', ')}`,
      cursor,
      replica,
      rail,
      reading,
    };
  }
  return {
    stage: 'none-observed',
    phase,
    reason: 'all requested oracle checks were observed at the selected phase',
    cursor,
    replica,
    rail,
    reading,
  };
}

async function finish(testInfo, scenario, channelID, traces, actions, expected = {}) {
  const payload = {
    version: 1,
    oracle: 'notification-owner-chain',
    scenario,
    channelID,
    head: process.env.GIT_COMMIT || 'runtime-head',
    actions: actions.map((action) => compact(action)),
    traces,
    firstDivergence: firstDivergence({ scenario, channelID, traces, actions, expected }),
  };
  await attachJSON(testInfo, `notification-owner-oracle-${scenario}.json`, payload);
  // Keep the oracle itself green: its job is to report a product RED, not to
  // convert that RED into a skipped or altered copy of the contract test.
  expect(traces.length).toBeGreaterThan(0);
}

test.describe('notification owner chain oracle', () => {
  test.describe.configure({ mode: 'serial' });

  test('N2 input to following-tail rail chain', async ({ page, request }, testInfo) => {
    test.setTimeout(60_000);
    await reset(request, 'multi-channel', 0x4e_02);
    await login(page);
    const traces = [];
    const actions = [];
    await reachBottom(page);
    await trace(page, 'c0', traces, 'baseline-following');
    for (let index = 0; index < 3; index += 1) actions.push(await approval(request, 'c0.project'));
    await page.waitForTimeout(400);
    await trace(page, 'c0', traces, 'input-while-away', { actionCount: actions.length });
    await clickChannel(page, 'c0.project');
    await reachBottom(page);
    await trace(page, 'c0.project', traces, 'cursor-highwater-after-return', { actionCount: actions.length });
    await startNoticeCapture(page, 'c0.project');
    for (let index = 0; index < 6; index += 1) actions.push(await approval(request, 'c0.project'));
    await page.waitForTimeout(700);
    const frames = await stopNoticeCapture(page);
    await trace(page, 'c0.project', traces, 'following-arrival', { frames });
    await finish(testInfo, 'N2', 'c0.project', traces, actions, { phase: 'following-arrival', transientRailNotice: true, railCounts: { related: 0, total: 0, jump: 0 } });
  });

  test('N4 filtered input to outside-scope rail chain', async ({ page, request }, testInfo) => {
    test.setTimeout(60_000);
    await reset(request, 'multi-channel', 0x4e_04);
    await login(page);
    const traces = [];
    const actions = [];
    await act(request, { type: 'notification_lifecycle', channel_id: 'c0', phase: 'tail', count: 24 }).then((value) => actions.push(value));
    await reachBottom(page);
    await page.getByTitle('只看我与 steward 的往来').click().catch(() => {});
    await reachBottom(page);
    await trace(page, 'c0', traces, 'filtered-baseline');
    actions.push(await act(request, { type: 'dense_progress', channel_id: 'c0', related: false, count: 1 }));
    for (let index = 0; index < 6; index += 1) actions.push(await approval(request, 'c0'));
    await page.waitForTimeout(700);
    await trace(page, 'c0', traces, 'filtered-tail');
    await finish(testInfo, 'N4', 'c0', traces, actions, { phase: 'filtered-tail', requireAuthority: true });
  });

  test('H1 acknowledgement high-water through reload and future input', async ({ page, request }, testInfo) => {
    test.setTimeout(75_000);
    await reset(request, 'multi-channel', 0x4e_05);
    await login(page);
    const traces = [];
    const actions = [];
    for (let index = 0; index < 2; index += 1) actions.push(await approval(request, 'c0.project'));
    await page.waitForTimeout(500);
    await trace(page, 'c0.project', traces, 'input-unread');
    await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'notification-owner-oracle-H1' }));
    await clickChannel(page, 'c0.project');
    await reachBottom(page);
    await trace(page, 'c0.project', traces, 'acknowledged-tail');
    await clickChannel(page, 'c0');
    await clickChannel(page, 'c0.project');
    await page.reload();
    await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
    await trace(page, 'c0.project', traces, 'reload-after-ack');
    await clickChannel(page, 'c0');
    actions.push(await approval(request, 'c0.project'));
    await page.waitForTimeout(500);
    await trace(page, 'c0', traces, 'future-input-away');
    await clickChannel(page, 'c0.project');
    await reachBottom(page);
    await trace(page, 'c0.project', traces, 'future-ack');
    await finish(testInfo, 'H1', 'c0.project', traces, actions, { phase: 'future-ack', notificationHighWater: 28, railHighWater: 28 });
  });

  test('H2 hydrated unread and second reload chain', async ({ page, request }, testInfo) => {
    test.setTimeout(75_000);
    await reset(request, 'multi-channel', 0x4e_06);
    await login(page);
    const traces = [];
    const actions = [];
    for (let index = 0; index < 2; index += 1) actions.push(await approval(request, 'c0.project'));
    await page.waitForTimeout(700);
    await page.reload();
    await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
    await trace(page, 'c0', traces, 'hydrated-unread');
    await clickChannel(page, 'c0.project');
    await reachBottom(page);
    await trace(page, 'c0.project', traces, 'hydrated-ack');
    await page.reload();
    await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
    await trace(page, 'c0.project', traces, 'second-hydration');
    await finish(testInfo, 'H2', 'c0.project', traces, actions, { phase: 'second-hydration', notificationHighWater: 27, railHighWater: 27 });
  });

  test('H3 filtered tail boundary chain', async ({ page, request }, testInfo) => {
    test.setTimeout(75_000);
    await reset(request, 'multi-channel', 0x4e_07);
    await login(page);
    const traces = [];
    const actions = [];
    await clickChannel(page, 'c0.project');
    await page.getByTitle('只看我与 project-agent 的往来').click().catch(() => {});
    await clickChannel(page, 'c0');
    for (let index = 0; index < 2; index += 1) actions.push(await approval(request, 'c0.project'));
    await page.waitForTimeout(500);
    await trace(page, 'c0', traces, 'filtered-input-away');
    await clickChannel(page, 'c0.project');
    await reachBottom(page);
    await trace(page, 'c0.project', traces, 'filtered-tail');
    await clickChannel(page, 'c0');
    await trace(page, 'c0', traces, 'after-leaving-filter');
    await finish(testInfo, 'H3', 'c0.project', traces, actions, { phase: 'filtered-tail', notificationHighWater: 27, railHighWater: 27 });
  });

  test('H4 following presentation before rail high-water chain', async ({ page, request }, testInfo) => {
    test.setTimeout(60_000);
    await reset(request, 'multi-channel', 0x4e_08);
    await login(page);
    const traces = [];
    const actions = [];
    await clickChannel(page, 'c0.project');
    await reachBottom(page);
    await trace(page, 'c0.project', traces, 'following-before-input');
    await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'notification-owner-oracle-H4' }));
    actions.push(await approval(request, 'c0.project'));
    await page.waitForTimeout(1_000);
    await trace(page, 'c0.project', traces, 'following-after-arrival');
    const before = traces.find((entry) => entry.phase === 'following-before-input');
    const beforeHighWater = Number(before?.rail?.diagnostic?.channels?.[0]?.notificationHighWater || 0);
    await finish(testInfo, 'H4', 'c0.project', traces, actions, { phase: 'following-after-arrival', railHighWater: beforeHighWater + 1, requireReplicaIDs: true });
  });

  test('F7 input to replica/presentation/reading return chain', async ({ page, request }, testInfo) => {
    test.setTimeout(75_000);
    await reset(request, 'deep-history', 29601);
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('atoll.view-session.v3.root', JSON.stringify({
      schema: 2,
      preferences: { c0: { scope: 'mine', actorFilter: [], foldOverrides: [], layoutChoices: [] } },
      readings: { 'c0\\u0000c0:mine:': {
        revision: 7,
        mode: 'browsing',
        bookmark: { messageID: 'c0-history-request-40', rowViewportOffset: -12, seq: 79 },
        unseenRecords: [],
      } },
    })));
    await login(page);
    const traces = [];
    const actions = [];
    await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
    await reachBottom(page);
    await trace(page, 'c0', traces, 'cold-latest');
    const viewport = readingOwner(page);
    await viewport.hover();
    await page.mouse.wheel(0, -1800);
    await page.waitForTimeout(500);
    const before = await trace(page, 'c0', traces, 'browsing-before-switch');
    const expectedVisibleID = before.presentation?.visibleIDs?.[0] || '';
    await clickChannel(page, 'c0.project');
    await clickChannel(page, 'c0');
    await page.waitForTimeout(3_000);
    await trace(page, 'c0', traces, 'return-after-switch', { expectedVisibleID });
    await page.reload();
    await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
    await trace(page, 'c0', traces, 'cached-refresh');
    await finish(testInfo, 'F7', 'c0', traces, actions, { phase: 'return-after-switch', visibleID: expectedVisibleID });
  });
});
