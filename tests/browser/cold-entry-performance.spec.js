import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

async function reset(request) {
  const response = await request.post('/mock/control/reset', { data: { scenario: 'deep-history-delayed', seed: 2921 } });
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
      rows.onsuccess = () => resolve(rows.result.some((row) => row.envelope?.payload?.body?.text === expected));
      rows.onerror = () => reject(rows.error);
    });
  }, { id: channelId, expected: text });
}

function topEntries(values, count = 40) {
  return [...values.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, count)
    .map(([name, ms]) => ({ name, ms: Number(ms.toFixed(2)) }));
}

function summarizeProfile(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const byURL = new Map();
  const byFunction = new Map();
  for (let index = 0; index < (profile.samples?.length || 0); index += 1) {
    const node = nodes.get(profile.samples[index]);
    const ms = Number(profile.timeDeltas?.[index] || 0) / 1000;
    const url = node?.callFrame?.url || '(native/idle)';
    const functionName = node?.callFrame?.functionName || '(anonymous)';
    byURL.set(url, (byURL.get(url) || 0) + ms);
    const key = `${functionName} — ${url}`;
    byFunction.set(key, (byFunction.get(key) || 0) + ms);
  }
  return {
    sampleCount: profile.samples?.length || 0,
    topURLs: topEntries(byURL),
    topFunctions: topEntries(byFunction),
  };
}

async function startRecorder(page, { diagnostics = false } = {}) {
  await page.evaluate((enableDiagnostics) => {
    if (enableDiagnostics) {
      window.__ATOLL_DIAGNOSTICS__.clear();
      window.__ATOLL_DIAGNOSTICS__.reading.enable({ case: 'cold-entry-performance', channelId: 'c0.project' });
    }
    window.__COLD_PERF__ = { startedAt: performance.now(), longTasks: [], frames: [] };
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__COLD_PERF__.longTasks.push({
        at: entry.startTime - window.__COLD_PERF__.startedAt,
        duration: entry.duration,
      });
    });
    observer.observe({ type: 'longtask' });
    window.__COLD_PERF__.observer = observer;
    const frame = () => {
      const message = document.querySelector('.timeline-entry')?.textContent || '';
      window.__COLD_PERF__.frames.push({
        at: performance.now() - window.__COLD_PERF__.startedAt,
        message: message.slice(0, 120),
        rows: document.querySelectorAll('[data-presentation-row-id]').length,
      });
      if (!message.includes('c0.project history')) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, diagnostics);
}

async function readRecorder(page, { diagnostics = false } = {}) {
  return page.evaluate((includeDiagnostics) => {
    window.__COLD_PERF__.observer.disconnect();
    const rows = [...document.querySelectorAll('[data-presentation-row-id]')];
    const readableFrame = window.__COLD_PERF__.frames.find((frame) => frame.message.includes('c0.project history'));
    return {
      firstReadableFrame: readableFrame?.at ?? null,
      longTasks: window.__COLD_PERF__.longTasks,
      frames: window.__COLD_PERF__.frames,
      materializedRows: rows.length,
      markdownContents: document.querySelectorAll('.markdown-content').length,
      markdownBlocks: document.querySelectorAll('[data-reading-block-id]').length,
      domElements: document.querySelectorAll('*').length,
      rowTextLengths: rows.map((row) => ({ id: row.dataset.presentationRowId, textLength: row.textContent.length })),
      events: includeDiagnostics ? window.__ATOLL_DIAGNOSTICS__.snapshot() : [],
      reading: includeDiagnostics ? window.__ATOLL_DIAGNOSTICS__.reading.snapshot().entries : [],
    };
  }, diagnostics);
}

function metricDeltas(beforeMetrics, afterMetrics) {
  const before = Object.fromEntries(beforeMetrics.metrics.map((entry) => [entry.name, entry.value]));
  const after = Object.fromEntries(afterMetrics.metrics.map((entry) => [entry.name, entry.value]));
  return Object.fromEntries([
    'TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'JSHeapUsedSize', 'Nodes',
  ].map((key) => [key, (after[key] || 0) - (before[key] || 0)]));
}

test('PERF cold cached entry attributes cache-to-readable main-thread work', async ({ page, request }, testInfo) => {
  test.setTimeout(45_000);
  await reset(request);
  await login(page);
  const project = page.getByRole('button', { name: '# c0.project', exact: true });
  await project.click();
  await expect.poll(() => hasCachedEnvelopeText(
    page,
    'c0.project',
    'c0.project history 120: ask project-agent for PONG',
  ), { timeout: 15_000 }).toBe(true);
  await page.getByRole('button', { name: '# c0', exact: true }).click();
  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await startRecorder(page);
  const rawMetricsBefore = await cdp.send('Performance.getMetrics');
  await project.click();
  await page.getByText(/c0\.project history/, { exact: false }).first().waitFor({ state: 'visible', timeout: 2_000 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const rawMetricsAfter = await cdp.send('Performance.getMetrics');
  const raw = {
    browser: await readRecorder(page),
    metrics: metricDeltas(rawMetricsBefore, rawMetricsAfter),
  };

  await page.getByRole('button', { name: '# c0', exact: true }).click();
  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
  await startRecorder(page, { diagnostics: true });
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  const metricsBefore = await cdp.send('Performance.getMetrics');
  await cdp.send('Profiler.start');
  const started = performance.now();
  await project.click();
  await page.getByText(/c0\.project history/, { exact: false }).first().waitFor({ state: 'visible', timeout: 2_000 });
  const wallMs = performance.now() - started;
  const { profile } = await cdp.send('Profiler.stop');
  const metricsAfter = await cdp.send('Performance.getMetrics');
  const browser = await readRecorder(page, { diagnostics: true });
  const evidence = {
    raw,
    attribution: {
      wallMs,
      browser,
      cpu: summarizeProfile(profile),
      metrics: metricDeltas(metricsBefore, metricsAfter),
    },
  };
  const path = testInfo.outputPath('cold-entry-performance.json');
  await writeFile(path, JSON.stringify(evidence, null, 2));
  await testInfo.attach('cold-entry-performance.json', { path, contentType: 'application/json' });

  expect(raw.browser.materializedRows).toBeGreaterThan(0);
  expect(raw.browser.firstReadableFrame).not.toBeNull();
  expect(browser.materializedRows).toBeGreaterThan(0);
  expect(browser.firstReadableFrame).not.toBeNull();
});
