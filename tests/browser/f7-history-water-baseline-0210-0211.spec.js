import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const browserFailures = new WeakMap();

test.beforeEach(async ({ page }) => {
  const failures = [];
  browserFailures.set(page, failures);
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const location = message.location();
      failures.push(`console.error: ${message.text()} @ ${location.url || 'unknown'}:${location.lineNumber || 0}`);
    }
  });
});

test.afterEach(async ({ page }) => {
  expect(browserFailures.get(page) || [], 'browser emitted runtime errors').toEqual([]);
});

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  browserFailures.get(page)?.splice(0);
}

async function countReplicaRows(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('atoll-channel-replica-v1');
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('rows')) {
        database.close();
        resolve(0);
        return;
      }
      const transaction = database.transaction('rows', 'readonly');
      const count = transaction.objectStore('rows').count();
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => reject(count.error);
      transaction.oncomplete = () => database.close();
    };
    request.onerror = () => reject(request.error);
  }));
}

test('TC0210 F6-PERF-05/F7 deep history keeps background reservoir silent, starts at tail, and admits realtime live', async ({ page, request }) => {
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

  const pulse = await request.post('/mock/control/action', { data: { type: 'pulse' } });
  expect(pulse.ok()).toBe(true);
  await expect(page.getByRole('button', { name: /条新动态/ })).toBeVisible();
  await page.getByRole('button', { name: /条新动态/ }).click();
  await expect(page.getByText(/c0 动态 #1/)).toBeVisible();

  // The current public persistence owner is the bounded channel-replica DB.
  // Keep the old bounded-tail observable without importing an implementation
  // private or depending on the removed feed-cache database name.
  await expect.poll(() => countReplicaRows(page)).toBeLessThanOrEqual(5_000);
});

test('TC0211 F7 real upward runway demand releases bounded raw history into the production list', async ({ page, request }, testInfo) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'mixed-height-history', seed: 1730 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  const viewport = page.locator('.timeline-message-list');
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await page.evaluate(() => {
    window.__ATOLL_DIAGNOSTICS__.clear();
    window.__ATOLL_DIAGNOSTICS__.reading.enable({ case: 'production-history-runway', seed: 1730 });
  });

  const paintRegion = await viewport.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const color = getComputedStyle(node).backgroundColor.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [255, 255, 255];
    // Exclude the absolute history-status chip (top/centre), scrollbar gutter,
    // and list edge chrome. This region contains only message coverage; a
    // spinner or fixed control therefore cannot make a blank list look filled.
    return {
      left: rect.left + 48,
      top: rect.top + 64,
      width: Math.max(1, rect.width - 96),
      height: Math.max(1, rect.height - 96),
      pageWidth: innerWidth,
      pageHeight: innerHeight,
      color,
    };
  });
  await page.evaluate(() => {
    const node = document.querySelector('.timeline-message-list');
    window.__ATOLL_RUNWAY_FRAMES__ = [];
    window.__ATOLL_RUNWAY_RUNNING__ = true;
    const sample = () => {
      if (!window.__ATOLL_RUNWAY_RUNNING__) return;
      const viewportRect = node.getBoundingClientRect();
      const visible = [...node.querySelectorAll('[data-presentation-row-id]')].flatMap((row) => {
        const rect = row.getBoundingClientRect();
        return rect.bottom > viewportRect.top && rect.top < viewportRect.bottom
          ? [{ id: row.dataset.presentationRowId || '', top: rect.top - viewportRect.top, bottom: rect.bottom - viewportRect.top }]
          : [];
      });
      window.__ATOLL_RUNWAY_FRAMES__.push({
        at: performance.now(),
        scrollTop: node.scrollTop,
        scrollHeight: node.scrollHeight,
        visible,
        rowCount: node.querySelectorAll('.timeline-virtual-item').length,
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  const cdp = await page.context().newCDPSession(page);
  const screencast = [];
  cdp.on('Page.screencastFrame', async (event) => {
    screencast.push({
      epochMs: Number(event.metadata?.timestamp || 0) * 1_000,
      metadata: event.metadata,
      data: event.data,
    });
    await cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 });
  await page.waitForTimeout(40);
  await viewport.hover();
  let runwayStarted = false;
  for (let step = 0; step < 80; step += 1) {
    await page.mouse.wheel(0, -480);
    await page.waitForTimeout(18);
    runwayStarted = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
      .some((entry) => entry.event === 'history.intent_started' && entry.detail?.reason === 'runway'));
    if (runwayStarted) break;
  }
  const runwayIntent = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .find((entry) => entry.event === 'history.intent_started' && entry.detail?.reason === 'runway')?.detail || null);
  const settled = runwayIntent ? await page.waitForFunction((expected) => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
    entry.event === 'history.intent_satisfied'
    && entry.detail?.channelId === expected.channelId
    && Number(entry.detail?.epoch) === Number(expected.epoch)
    && Number(entry.detail?.anchorSeq) === Number(expected.anchorSeq)
    && entry.detail?.reason === 'runway'
  )), runwayIntent, { timeout: 10_000 }).then(() => true, () => false) : false;
  await page.waitForTimeout(320);
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  const evidence = await page.evaluate(() => {
    window.__ATOLL_RUNWAY_RUNNING__ = false;
    return {
      diagnostics: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event.startsWith('history.')),
      reading: window.__ATOLL_DIAGNOSTICS__.reading.snapshot(),
      frames: window.__ATOLL_RUNWAY_FRAMES__ || [],
    };
  });
  const paint = await page.evaluate(async ({ frames, region }) => {
    const decode = (base64) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = `data:image/jpeg;base64,${base64}`;
    });
    const result = [];
    for (let index = 0; index < frames.length; index += 1) {
      const image = await decode(frames[index]);
      const scaleX = image.naturalWidth / region.pageWidth;
      const scaleY = image.naturalHeight / region.pageHeight;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(region.width * scaleX));
      canvas.height = Math.max(1, Math.floor(region.height * scaleY));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(
        image,
        Math.floor(region.left * scaleX), Math.floor(region.top * scaleY), canvas.width, canvas.height,
        0, 0, canvas.width, canvas.height,
      );
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let foreground = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const difference = Math.abs(pixels[offset] - region.color[0])
          + Math.abs(pixels[offset + 1] - region.color[1])
          + Math.abs(pixels[offset + 2] - region.color[2]);
        if (difference > 45) foreground += 1;
      }
      result.push({ index, foreground, width: canvas.width, height: canvas.height });
    }
    return result;
  }, { frames: screencast.map((frame) => frame.data), region: paintRegion });
  const frameManifest = [];
  for (let index = 0; index < screencast.length; index += 1) {
    const name = `history-runway-paint-${String(index).padStart(3, '0')}.jpeg`;
    const path = testInfo.outputPath(name);
    await writeFile(path, Buffer.from(screencast[index].data, 'base64'));
    frameManifest.push({ index, epochMs: screencast[index].epochMs, metadata: screencast[index].metadata, name });
  }
  const artifact = JSON.stringify({ paintRegion, paint, paintFrames: frameManifest, ...evidence }, null, 2);
  const artifactPath = testInfo.outputPath('history-runway-production-evidence.json');
  await writeFile(artifactPath, artifact);
  await testInfo.attach('history-runway-production-evidence.json', { path: artifactPath, contentType: 'application/json' });
  const intent = evidence.diagnostics.find((entry) => entry.event === 'history.intent_started');
  const checks = evidence.diagnostics.filter((entry) => entry.event === 'history.projection_checked');
  expect(runwayStarted, JSON.stringify(evidence.frames.slice(-5))).toBe(true);
  expect(settled, JSON.stringify(evidence.diagnostics)).toBe(true);
  expect(intent?.detail).toMatchObject({ reason: 'runway', revealRows: 8, revealBytes: 262_144 });
  expect(checks.length).toBeGreaterThan(0);
  expect(checks.every((entry) => Number(entry.detail?.released) > 0 && Number(entry.detail?.released) <= 8)).toBe(true);
  expect(checks.every((entry) => Number(entry.detail?.revealRows) === 8 && Number(entry.detail?.revealBytes) === 262_144)).toBe(true);
  expect(Number(checks.at(-1)?.detail?.firstVisibleSeq)).toBeLessThan(Number(intent.detail.anchorSeq));
  expect(evidence.reading.entries.filter((entry) => entry.event === 'reading.issuer-write')).toHaveLength(0);
  expect(Math.max(...evidence.frames.map((frame) => frame.rowCount))).toBeLessThan(100);
  expect(evidence.frames.some((frame) => frame.visible.length === 0)).toBe(false);

  // CDP compositor frames are independent of the rAF DOM coverage sample.
  // Use the first populated frame as this run's own background/AA baseline;
  // a near-empty list paint cannot pass merely because DOM rows existed.
  expect(paint.length).toBeGreaterThan(2);
  const baseline = paint.find((frame) => frame.foreground > 0)?.foreground || 0;
  const minimumRequired = Math.max(100, Math.floor(baseline * 0.05));
  expect(paint.filter((frame) => frame.foreground < minimumRequired), JSON.stringify({ baseline, minimumRequired, paint })).toEqual([]);
});
