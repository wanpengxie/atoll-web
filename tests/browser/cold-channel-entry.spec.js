import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

async function productionFingerprint() {
  const paths = [
    'src/app/hooks/useChannelFeed.js',
    'src/model/history-scheduler.js',
    'src/model/timeline-projection.js',
    'src/ui/Timeline.jsx',
    'src/ui/timeline/useReadingSession.js',
    'src/ui/timeline/LegendMessageList.jsx',
  ];
  const hash = createHash('sha256');
  for (const path of paths) hash.update(path).update('\0').update(await readFile(path));
  return { paths, digest: hash.digest('hex') };
}

async function reset(request, scenario, seed) {
  const response = await request.post('/mock/control/reset', { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号' }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

async function channelRowCount(page, channelId) {
  return page.evaluate(async (id) => {
    const database = await new Promise((resolve, reject) => {
      const open = indexedDB.open('atoll-feed-v8');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('rows', 'readonly');
      const count = transaction.objectStore('rows').count(IDBKeyRange.bound(
        [id, 0], [id, Number.MAX_SAFE_INTEGER],
      ));
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => reject(count.error);
    });
  }, channelId);
}

async function hasCachedEnvelopeText(page, channelId, text) {
  return page.evaluate(async ({ id, expected }) => {
    const database = await new Promise((resolve, reject) => {
      const open = indexedDB.open('atoll-feed-v8');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('rows', 'readonly');
      const rows = transaction.objectStore('rows').getAll(IDBKeyRange.bound(
        [id, 0], [id, Number.MAX_SAFE_INTEGER],
      ));
      rows.onsuccess = () => resolve(rows.result.some((row) => row.envelope?.payload?.text === expected));
      rows.onerror = () => reject(rows.error);
    });
  }, { id: channelId, expected: text });
}

async function beginEntryTrace(page, channelId) {
  await page.evaluate((id) => {
    window.__ATOLL_DIAGNOSTICS__.clear();
    window.__ATOLL_DIAGNOSTICS__.reading.enable({ case: 'cold-channel-entry', channelId: id });
    const startedAt = performance.now();
    const startedEpoch = Date.now();
    const samples = [];
    const sent = [];
    const longTasks = [];
    const longAnimationFrames = [];
    const longTaskObserver = typeof PerformanceObserver === 'function'
      ? new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push({
          at: entry.startTime - startedAt,
          duration: entry.duration,
          name: entry.name,
        });
      })
      : null;
    try { longTaskObserver?.observe({ entryTypes: ['longtask'] }); } catch { /* unsupported */ }
    const longAnimationFrameObserver = typeof PerformanceObserver === 'function'
      ? new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longAnimationFrames.push({
          at: entry.startTime - startedAt,
          duration: entry.duration,
          renderStart: Number(entry.renderStart || 0) - startedAt,
          styleAndLayoutStart: Number(entry.styleAndLayoutStart || 0) - startedAt,
          scripts: [...(entry.scripts || [])].map((script) => ({
            duration: script.duration,
            invoker: script.invoker,
            sourceFunctionName: script.sourceFunctionName,
            sourceURL: script.sourceURL,
          })),
        });
      })
      : null;
    try { longAnimationFrameObserver?.observe({ type: 'long-animation-frame' }); } catch { /* unsupported */ }
    if (!window.__ATOLL_COLD_ORIGINAL_SEND__) {
      window.__ATOLL_COLD_ORIGINAL_SEND__ = WebSocket.prototype.send;
      WebSocket.prototype.send = function tracedSend(data) {
        const active = window.__ATOLL_COLD_ENTRY__;
        if (active) {
          try {
            const frame = JSON.parse(data);
            active.sent.push({
              at: performance.now() - active.startedAt,
              type: frame.frame_type || '',
              channelId: frame.payload?.channel_id || '',
              ref: frame.ref || '',
            });
          } catch { /* A test recorder must not affect transport. */ }
        }
        return window.__ATOLL_COLD_ORIGINAL_SEND__.call(this, data);
      };
    }
    let stopped = false;
    const sample = () => {
      if (stopped) return;
      const heading = document.querySelector('main h1')?.textContent || '';
      const message = document.querySelector('.timeline-entry')?.textContent || '';
      const status = document.querySelector('.timeline-history-status, .timeline-reading-restore')?.textContent || '';
      const statuses = [...document.querySelectorAll('#workspace-panel-dynamic [role="status"]')]
        .map((node) => node.textContent?.trim() || '')
        .filter(Boolean);
      const empty = document.querySelector('.empty-ledger')?.textContent || '';
      const list = document.querySelector('.timeline-message-list[role="region"]');
      const listRect = list?.getBoundingClientRect();
      const materialized = [...(list?.querySelectorAll('[data-presentation-row-id]') || [])];
      const visibleRows = materialized.filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.bottom > listRect.top && rect.top < listRect.bottom;
      });
      samples.push({
        at: performance.now() - startedAt,
        heading,
        message,
        status,
        statuses,
        empty,
        materializedRowIDs: materialized.map((node) => node.dataset.presentationRowId),
        visibleRowIDs: visibleRows.map((node) => node.dataset.presentationRowId),
        firstVisibleTop: visibleRows[0]?.getBoundingClientRect().top ?? null,
        scrollTop: list?.scrollTop ?? null,
        scrollHeight: list?.scrollHeight ?? null,
        clientHeight: list?.clientHeight ?? null,
      });
      requestAnimationFrame(sample);
    };
    window.__ATOLL_COLD_ENTRY__ = {
      channelId: id,
      startedAt,
      startedEpoch,
      samples,
      sent,
      longTasks,
      longAnimationFrames,
      stop() {
        stopped = true;
        longTaskObserver?.disconnect();
        longAnimationFrameObserver?.disconnect();
      },
    };
    requestAnimationFrame(sample);
  }, channelId);
}

async function finishEntryTrace(page) {
  return page.evaluate(() => {
    window.__ATOLL_COLD_ENTRY__?.stop();
    const trace = window.__ATOLL_COLD_ENTRY__;
    const events = window.__ATOLL_DIAGNOSTICS__.snapshot().map((entry) => ({
      event: entry.event,
      at: Date.parse(entry.at) - trace.startedEpoch,
      detail: entry.detail,
    }));
    const reading = window.__ATOLL_DIAGNOSTICS__.reading.snapshot().entries;
    const first = (predicate) => trace.samples.find(predicate)?.at ?? null;
    const targetSamples = trace.samples.filter((sample) => sample.heading === trace.channelId);
    const nonEmptySignatures = targetSamples
      .map((sample) => sample.visibleRowIDs.join('|'))
      .filter(Boolean);
    return {
      samples: trace.samples,
      sent: trace.sent,
      longTasks: trace.longTasks,
      longAnimationFrames: trace.longAnimationFrames,
      maxRafGap: trace.samples.slice(1).reduce((largest, sample, index) => (
        Math.max(largest, sample.at - trace.samples[index].at)
      ), 0),
      visibleIdentityChanges: nonEmptySignatures.slice(1).reduce((count, signature, index) => (
        count + Number(signature !== nonEmptySignatures[index])
      ), 0),
      events,
      reading,
      milestones: {
        heading: first((sample) => sample.heading === trace.channelId),
        feedback: first((sample) => sample.heading === trace.channelId && Boolean(sample.status)),
        cachedPaint: first((sample) => sample.message.includes(`${trace.channelId} history`)),
        empty: first((sample) => sample.heading === trace.channelId && Boolean(sample.empty)),
      },
    };
  });
}

async function persistEntryTrace(testInfo, name, trace) {
  const evidence = `${JSON.stringify({ source: await productionFingerprint(), ...trace }, null, 2)}\n`;
  const path = testInfo.outputPath(name);
  await writeFile(path, evidence, 'utf8');
  await mkdir('docs/evidence/cold-loading-final', { recursive: true });
  await writeFile(`docs/evidence/cold-loading-final/${name}`, evidence, 'utf8');
  await testInfo.attach(name, { path, contentType: 'application/json' });
  return path;
}

test('F7 cold cached channel paints its durable tail without waiting for remote synchronization', async ({ page, request }, testInfo) => {
  test.setTimeout(45_000);
  await reset(request, 'deep-history-delayed', 2921);
  await login(page);

  const project = page.getByRole('button', { name: '# c0.project', exact: true });
  await project.click();
  // Populate the real durable cache through the production network/scheduler
  // path. The setup does not depend on the list adapter's current-tail choice;
  // the assertion below owns the actual cold-cache paint contract.
  await expect.poll(() => hasCachedEnvelopeText(
    page,
    'c0.project',
    'c0.project history 120: ask project-agent for PONG',
  ), { timeout: 15_000 }).toBe(true);
  await page.getByRole('button', { name: '# c0', exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('c0');
  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');

  await beginEntryTrace(page, 'c0.project');
  await project.click();
  let journeyError;
  try {
    await page.getByText(/c0\.project history/, { exact: false }).first().waitFor({ state: 'visible', timeout: 2_000 });
  } catch (error) {
    journeyError = error;
  }
  const trace = await finishEntryTrace(page);
  await persistEntryTrace(testInfo, 'cold-cache-entry-trace.json', trace);

  expect(journeyError).toBeUndefined();
  expect(trace.milestones.heading).not.toBeNull();
  expect(trace.milestones.cachedPaint).not.toBeNull();
  expect(trace.milestones.cachedPaint).toBeLessThan(500);
  expect(trace.samples.filter((sample) => (
    sample.heading === 'c0.project'
      && sample.at < trace.milestones.cachedPaint
  )).every((sample) => Boolean(sample.status || sample.message))).toBe(true);
  expect(trace.samples.filter((sample) => sample.heading === 'c0.project')
    .flatMap((sample) => sample.statuses)
    .filter((status) => status.includes('恢复上次阅读位置'))).toEqual([]);
  const cacheSegments = trace.reading.filter((entry) => (
    entry.event === 'history.segment-requested'
      && entry.detail?.channelId === 'c0.project'
  ));
  expect(cacheSegments[0]?.detail?.source).toBe('indexeddb');
  expect(trace.sent.some((frame) => frame.type === 'channel_meta' && frame.channelId === 'c0.project')).toBe(true);
});

test('F7 a never-opened channel uses its already prepared body reservoir on first selection', async ({ page, request }, testInfo) => {
  test.setTimeout(45_000);
  await reset(request, 'deep-history-delayed', 2924);
  await login(page);
  await expect.poll(() => channelRowCount(page, 'c0.project'), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.locator('main h1')).toHaveText('c0');

  await beginEntryTrace(page, 'c0.project');
  await page.getByRole('button', { name: '# c0.project', exact: true }).click();
  let journeyError;
  try {
    await page.getByText(/c0\.project history/, { exact: false }).first().waitFor({ state: 'visible', timeout: 2_000 });
  } catch (error) {
    journeyError = error;
  }
  const trace = await finishEntryTrace(page);
  await persistEntryTrace(testInfo, 'cold-prepared-unvisited-entry-trace.json', trace);

  expect(journeyError).toBeUndefined();
  expect(trace.milestones.heading).not.toBeNull();
  expect(trace.milestones.cachedPaint).not.toBeNull();
  expect(trace.milestones.cachedPaint).toBeLessThan(500);
  expect(trace.samples.filter((sample) => (
    sample.heading === 'c0.project'
      && sample.at < trace.milestones.cachedPaint
      && Boolean(sample.empty)
  ))).toEqual([]);
  expect(trace.samples.filter((sample) => (
    sample.heading === 'c0.project' && sample.at < trace.milestones.cachedPaint
  )).every((sample) => Boolean(sample.status || sample.message))).toBe(true);
  expect(trace.samples.filter((sample) => sample.heading === 'c0.project')
    .flatMap((sample) => sample.statuses)
    .filter((status) => status.includes('恢复上次阅读位置'))).toEqual([]);
});

test('F7 cold uncached channel gives stable feedback while current metadata and body are unavailable', async ({ page, request, context }, testInfo) => {
  test.setTimeout(45_000);
  await reset(request, 'deep-history-delayed', 2922);
  await login(page);
  expect(await channelRowCount(page, 'c0.project')).toBe(0);

  await context.setOffline(true);
  const dropped = await request.post('/mock/control/action', { data: { type: 'drop' } });
  expect(dropped.ok()).toBe(true);
  // The browser offline boundary is the authority for this fixture. The UI
  // connection badge can retain its last open paint until the socket's close
  // task is delivered, which is exactly the asynchronous window under test.
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);

  await beginEntryTrace(page, 'c0.project');
  await page.getByRole('button', { name: '# c0.project', exact: true }).click();
  let journeyError;
  try {
    await page.locator('main h1').waitFor({ state: 'visible', timeout: 500 });
    await page.getByRole('status').filter({ hasText: '正在确认频道内容' }).waitFor({ state: 'visible', timeout: 500 });
    await page.waitForTimeout(650);
    await context.setOffline(false);
    await page.locator('.connection-state.state-open').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByText('c0.project history 120: ask project-agent for PONG', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  } catch (error) {
    journeyError = error;
  }
  const trace = await finishEntryTrace(page);
  await persistEntryTrace(testInfo, 'cold-no-cache-entry-trace.json', trace);

  expect(journeyError).toBeUndefined();
  expect(trace.milestones.heading).not.toBeNull();
  expect(trace.milestones.feedback).not.toBeNull();
  expect(trace.milestones.feedback).toBeLessThan(500);
  expect(trace.milestones.feedback - trace.milestones.heading).toBeLessThan(100);
  expect(trace.milestones.cachedPaint).toBeGreaterThan(650);
  expect(trace.samples.filter((sample) => (
    sample.heading === 'c0.project'
      && sample.at < trace.milestones.cachedPaint
  )).every((sample) => Boolean(sample.status || sample.message))).toBe(true);
  expect(trace.samples.filter((sample) => (
    sample.heading === 'c0.project' && sample.at < trace.milestones.cachedPaint
  )).every((sample) => (
    sample.statuses.length === 1 && sample.statuses[0] === '正在确认频道内容…'
  ))).toBe(true);
  expect(trace.samples.filter((sample) => (
    sample.heading === 'c0.project' && Boolean(sample.empty)
  )).map((sample) => ({ at: sample.at, text: sample.empty }))).toEqual([]);
  const uncachedSegments = trace.reading.filter((entry) => (
    entry.event === 'history.segment-requested'
      && entry.detail?.channelId === 'c0.project'
  ));
  expect(uncachedSegments[0]?.detail?.source).toBe('network');
  expect(trace.sent.some((frame) => frame.type === 'channel_meta' && frame.channelId === 'c0.project')).toBe(true);
});

test('F7 authoritative zero metadata becomes the empty state without a history-page prerequisite', async ({ page, request }, testInfo) => {
  await reset(request, 'message-flow', 2923);
  await login(page);
  expect(await channelRowCount(page, 'c0.project')).toBe(0);

  await beginEntryTrace(page, 'c0.project');
  await page.getByRole('button', { name: '# c0.project', exact: true }).click();
  let journeyError;
  try {
    await page.locator('main h1').waitFor({ state: 'visible', timeout: 500 });
    await page.locator('.empty-ledger').filter({ hasText: '这本账还没有可见条目' }).waitFor({ state: 'visible', timeout: 500 });
  } catch (error) {
    journeyError = error;
  }
  const trace = await finishEntryTrace(page);
  await persistEntryTrace(testInfo, 'cold-authoritative-empty-entry-trace.json', trace);

  expect(journeyError).toBeUndefined();
  expect(trace.milestones.empty).not.toBeNull();
  expect(trace.milestones.empty).toBeLessThan(500);
  expect(trace.milestones.cachedPaint).toBeNull();
  const firstHistorySegment = trace.reading.find((entry) => (
    entry.event === 'history.segment-requested'
      && entry.detail?.channelId === 'c0.project'
  ));
  if (firstHistorySegment) expect(trace.milestones.empty).toBeLessThan(firstHistorySegment.elapsedMs);
  expect(trace.samples.filter((sample) => (
    sample.heading === 'c0.project'
      && Boolean(sample.empty)
      && (!firstHistorySegment || sample.at < firstHistorySegment.elapsedMs)
  )).every((sample) => sample.status === '')).toBe(true);
  expect(trace.sent.some((frame) => frame.type === 'channel_meta' && frame.channelId === 'c0.project')).toBe(true);
});
