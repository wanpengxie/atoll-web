import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  installReadingOwnerHelper,
  readingOwner,
  tailDistance,
} from './reading-owner.js';

const browserFailures = new WeakMap();

test.beforeEach(async ({ page }) => {
  await installReadingOwnerHelper(page);
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
  // A missing pre-login identity session is an expected authentication
  // result, not an application runtime failure. Everything after the session
  // opens remains a hard console/page-error assertion.
  browserFailures.get(page)?.splice(0);
}

async function chooseSteward(page) {
  const choose = page.getByRole('button', { name: '选择 Agent' });
  if (!await choose.isVisible().catch(() => false)) return;
  await choose.click();
  await page.getByRole('menu', { name: '选择目标 Agent' }).getByRole('menuitem', { name: 'steward' }).click();
}

async function captureVisibleAnchor(page) {
  return page.locator('.timeline-message-list').evaluate((node) => {
    const top = node.getBoundingClientRect().top;
    const row = [...node.querySelectorAll('[data-presentation-row-id]')]
      .map((candidate) => ({
        id: candidate.dataset.presentationRowId,
        top: candidate.getBoundingClientRect().top - top,
        bottom: candidate.getBoundingClientRect().bottom - top,
      }))
      .filter((candidate) => candidate.bottom > 0 && candidate.top < node.clientHeight)
      .sort((left, right) => left.top - right.top)[0];
    return row || null;
  });
}

async function persistedBookmark(page, channelID, viewKeyPrefix) {
  return page.evaluate(({ channelID: channel, prefix }) => {
    const readings = JSON.parse(localStorage.getItem('atoll.view-session.v3.root') || 'null')?.readings || {};
    const key = Object.keys(readings).find((candidate) => candidate.startsWith(`${channel}\u0000${prefix}`));
    return key ? readings[key]?.bookmark || null : null;
  }, { channelID, prefix: viewKeyPrefix });
}

async function expectAnchorRestored(page, anchor) {
  const viewport = page.locator('.timeline-message-list');
  await expect.poll(() => viewport.evaluate((node, expected) => {
    const row = [...node.querySelectorAll('[data-presentation-row-id]')]
      .find((candidate) => candidate.dataset.presentationRowId === expected.id);
    if (!row) return false;
    const rect = row.getBoundingClientRect();
    const root = node.getBoundingClientRect();
    return rect.bottom > root.top && rect.top < root.bottom;
  }, anchor)).toBe(true);
  const samples = await viewport.evaluate((node, expected) => new Promise((resolve) => {
    const values = [];
    const rootTop = () => node.getBoundingClientRect().top;
    const collect = () => {
      const row = [...node.querySelectorAll('[data-presentation-row-id]')]
        .find((candidate) => candidate.dataset.presentationRowId === expected.id);
      values.push(row ? row.getBoundingClientRect().top - rootTop() : null);
      if (values.length >= 8) resolve(values);
      else requestAnimationFrame(collect);
    };
    requestAnimationFrame(collect);
  }), anchor);
  expect(samples.every(Number.isFinite), JSON.stringify(samples)).toBe(true);
  expect(Math.abs(samples.at(-1) - anchor.top), JSON.stringify({ anchor, samples })).toBeLessThanOrEqual(32);
  expect(Math.max(...samples) - Math.min(...samples), JSON.stringify(samples)).toBeLessThanOrEqual(2);
}

async function startProductionSendProbe(page) {
  await page.evaluate(() => {
    const frames = [];
    const writes = [];
    const owner = window.__ATOLL_TEST_READING_OWNER__;
    const root = owner.current();
    const originalScrollTo = root.scrollTo;
    root.scrollTo = function (...args) {
      const entries = window.__ATOLL_DIAGNOSTICS__.reading.snapshot().entries;
      const issuer = entries.at(-1);
      const before = {
        sequence: issuer?.sequence || 0,
        event: issuer?.event || '',
        waitingIDs: [...document.querySelectorAll('.agent-wait-item[data-request-id]')]
          .map((node) => node.dataset.requestId),
        timelineIDs: [...this.querySelectorAll('[data-presentation-row-id]')]
          .map((node) => node.dataset.presentationRowId),
        durableIDs: window.__ATOLL_DIAGNOSTICS__.snapshot()
          .filter((entry) => entry.event === 'submission.outbox_accepted')
          .flatMap((entry) => entry.detail?.messageIds || []),
        scrollTop: this.scrollTop,
        scrollHeight: this.scrollHeight,
        clientHeight: this.clientHeight,
      };
      const result = originalScrollTo.apply(this, args);
      writes.push({ ...before, afterScrollTop: this.scrollTop,
        afterGap: owner.tailDistance(this) });
      return result;
    };
    let running = true;
    let userInputAt = null;
    let autoInputRequested = false;
    let preInputGeometry = null;
    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const value = node.getBoundingClientRect();
      return {
        top: value.top,
        bottom: value.bottom,
        left: value.left,
        right: value.right,
        width: value.width,
        height: value.height,
      };
    };
    const sample = (at) => {
      if (!running) return;
      const viewport = owner.current();
      const reading = window.__ATOLL_DIAGNOSTICS__.reading.snapshot();
      const application = window.__ATOLL_DIAGNOSTICS__.snapshot();
      const readingEvents = reading.entries.filter((entry) => [
        'reading.bottom-intent',
        'reading.issuer-enter',
        'reading.issuer-write',
        'reading.issuer-reject',
        'reading.list-height',
        'reading.scroller-resize',
        'reading.range',
        'reading.scroll-observed',
      ].includes(entry.event));
      const submissionEvents = application.filter((entry) => entry.event?.startsWith('submission.'));
      const countSubmission = (event) => submissionEvents.filter((entry) => entry.event === event).length;
      const issuerWriteCount = readingEvents.filter((entry) => entry.event === 'reading.issuer-write').length;
      const geometry = {
        mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
        scrollTop: Number(viewport?.scrollTop || 0),
        scrollHeight: Number(viewport?.scrollHeight || 0),
        clientHeight: Number(viewport?.clientHeight || 0),
        gap: owner.tailDistance(viewport),
      };
      frames.push({
        frame: frames.length,
        at,
        afterUserInput: userInputAt != null,
        ...geometry,
        waitingMounted: Boolean(document.querySelector('.agent-wait-layer')),
        waitingItems: document.querySelectorAll('.agent-wait-item').length,
        geometry: {
          stack: rect('.conversation-bottom-stack'),
          input: rect('.conversation-input-slot'),
          floating: rect('.conversation-floating-slot'),
          composer: rect('.composer-surface'),
          waiting: rect('.agent-wait-layer'),
        },
        bottomIntentCount: readingEvents.filter((entry) => entry.event === 'reading.bottom-intent').length,
        issuerWriteCount,
        lastReadingSequence: Number(readingEvents.at(-1)?.sequence || 0),
        submissionCounts: {
          composerSendStarted: countSubmission('submission.composer_send_started'),
          composerDurableAccepted: countSubmission('submission.composer_durable_accepted'),
          outboxAccepted: countSubmission('submission.outbox_accepted'),
          transmitStarted: countSubmission('submission.transmit_started'),
          receiptAccepted: countSubmission('submission.receipt_accepted'),
          feedLanded: countSubmission('submission.feed_landed'),
        },
      });
      if (!autoInputRequested && issuerWriteCount > 0 && typeof window.__wheelAfterAuthorizedWrite === 'function') {
        autoInputRequested = true;
        preInputGeometry = geometry;
        userInputAt = performance.now();
        window.__wheelAfterAuthorizedWrite().catch(() => {});
      }
      if (frames.length < 1_200) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    window.__productionSendProbe = {
      markUserInput() {
        userInputAt = performance.now();
        return userInputAt;
      },
      preInputGeometry() {
        return preInputGeometry;
      },
      writes() {
        return writes;
      },
      stop() {
        running = false;
        root.scrollTo = originalScrollTo;
        return frames;
      },
    };
  });
}

test('F6-PERF-05/F7 deep history keeps background reservoir silent, starts at tail, and admits realtime live', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1707 } });
  expect(reset.ok()).toBe(true);
  await login(page);

  const viewport = readingOwner(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  // Following owns the structural tail: column-reverse makes zero the bottom
  // origin, independently of the list's total height.
  await expect(viewport).toHaveAttribute('data-reading-container', 'following-tail');
  await expect.poll(() => viewport.evaluate(tailDistance)).toBeLessThanOrEqual(1);
  const samples = await page.evaluate(async () => {
    const values = [];
    for (let index = 0; index < 6; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const node = window.__ATOLL_TEST_READING_OWNER__.current();
      values.push({
        container: node?.dataset.readingContainer || (node ? 'virtuoso' : 'none'),
        tailOrigin: window.__ATOLL_TEST_READING_OWNER__.tailDistance(node),
      });
    }
    return values;
  });
  expect(samples.every((sample) => sample.container === 'following-tail' && sample.tailOrigin <= 1), JSON.stringify(samples)).toBe(true);

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

  // Use a canonical, presentable root arrival. `mock.channel.pulse` is an
  // intentionally unknown event and the current projection correctly keeps it
  // out of both the list and unseen count.
  const arrival = await request.post('/mock/control/action', {
    data: { type: 'approval', channel_id: 'c0' },
  });
  expect(arrival.ok()).toBe(true);
  await expect(page.getByRole('button', { name: /条新动态/ })).toBeVisible();
  await page.getByRole('button', { name: /条新动态/ }).click();
  await expect(page.getByText('Approve live mock action', { exact: true })).toBeVisible();

  const cachedRows = await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const open = indexedDB.open('atoll-feed-v8');
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

test('F7 real upward runway demand releases bounded raw history into the production list', async ({ page, request }, testInfo) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'mixed-height-history', seed: 1730 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  const viewport = readingOwner(page);
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
    window.__ATOLL_RUNWAY_FRAMES__ = [];
    window.__ATOLL_RUNWAY_RUNNING__ = true;
    const sample = () => {
      if (!window.__ATOLL_RUNWAY_RUNNING__) return;
      // Following remains the visible owner while the incoming virtualizer is
      // prepared. After the atomic reveal, the active layer becomes the owner.
      // Re-resolve that owner every frame instead of retaining detached DOM.
      const node = window.__ATOLL_TEST_READING_OWNER__.current();
      if (!node) {
        requestAnimationFrame(sample);
        return;
      }
      const viewportRect = node.getBoundingClientRect();
      const visible = [...node.querySelectorAll('[data-presentation-row-id]')].flatMap((row) => {
        const rect = row.getBoundingClientRect();
        return rect.bottom > viewportRect.top && rect.top < viewportRect.bottom
          ? [{ id: row.dataset.presentationRowId || '', top: rect.top - viewportRect.top, bottom: rect.bottom - viewportRect.top }]
          : [];
      });
      window.__ATOLL_RUNWAY_FRAMES__.push({
        at: performance.now(),
        container: node.dataset.readingContainer || 'virtuoso',
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

test('F7 production runway folds one oversized raw record and keeps compositor coverage', async ({ page, request }, testInfo) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'extreme-height-history', seed: 1731 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  const viewport = readingOwner(page);
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await page.evaluate(() => {
    window.__ATOLL_DIAGNOSTICS__.clear();
    window.__ATOLL_DIAGNOSTICS__.reading.enable({ case: 'production-history-extreme-turn', seed: 1731 });
    window.__ATOLL_EXTREME_FRAMES__ = [];
    window.__ATOLL_EXTREME_RUNNING__ = true;
    const sample = () => {
      if (!window.__ATOLL_EXTREME_RUNNING__) return;
      const node = window.__ATOLL_TEST_READING_OWNER__.current();
      if (!node) {
        requestAnimationFrame(sample);
        return;
      }
      const viewportRect = node.getBoundingClientRect();
      const visible = [...node.querySelectorAll('[data-presentation-row-id]')].flatMap((row) => {
        const rect = row.getBoundingClientRect();
        return rect.bottom > viewportRect.top && rect.top < viewportRect.bottom
          ? [{ id: row.dataset.presentationRowId || '', top: rect.top - viewportRect.top, bottom: rect.bottom - viewportRect.top }]
          : [];
      });
      window.__ATOLL_EXTREME_FRAMES__.push({
        at: performance.now(),
        container: node.dataset.readingContainer || 'virtuoso',
        scrollTop: node.scrollTop,
        scrollHeight: node.scrollHeight,
        visible,
        rowCount: node.querySelectorAll('.timeline-virtual-item').length,
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const region = await viewport.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const color = getComputedStyle(node).backgroundColor.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [255, 255, 255];
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
  await viewport.hover();
  let runwayStarted = false;
  let runwayIntentCount = 0;
  let extremeInstalled = false;
  let extremeGeometry = null;
  for (let step = 0; step < 90; step += 1) {
    await page.mouse.wheel(0, -480);
    await page.waitForTimeout(18);
    runwayIntentCount = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
      .filter((entry) => entry.event === 'history.intent_started' && entry.detail?.reason === 'runway').length);
    runwayStarted = runwayIntentCount > 0;
    // The target belongs to the first admission and can leave the virtual
    // window before the third. Preserve verified DOM evidence at arrival;
    // later history demand must not erase a successful target observation.
    if (!extremeInstalled) {
      extremeGeometry = await page.evaluate(() => {
        const entry = document.querySelector('[data-entry-id="c0-history-request-104"]');
        if (!entry?.textContent?.includes('c0 PONG 104')) return null;
        const row = entry.closest('.timeline-virtual-item')?.getBoundingClientRect();
        const viewportRect = entry.closest('.timeline-message-list')?.getBoundingClientRect();
        return {
          itemHeight: Number(row?.height || 0),
          viewportHeight: Number(viewportRect?.height || 0),
          foldedBodies: entry.querySelectorAll('.message-fold.is-folded').length,
          hasExpandControl: Boolean(entry.querySelector('.message-fold-toggle[aria-expanded="false"]')),
        };
      });
      if (extremeGeometry) {
        expect(extremeGeometry).toMatchObject({ hasExpandControl: true });
        expect(extremeGeometry.foldedBodies).toBeGreaterThan(0);
        expect(extremeGeometry.itemHeight).toBeGreaterThan(0);
        expect(extremeGeometry.viewportHeight).toBeGreaterThan(0);
        extremeInstalled = true;
      }
    }
    const committedBatchCount = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
      .filter((entry) => entry.event === 'history.admission_commit' && entry.detail?.stagedIDs?.length > 0).length);
    if (runwayIntentCount >= 3 && committedBatchCount >= 3 && extremeInstalled) break;
  }
  await page.waitForTimeout(320);
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  const evidence = await page.evaluate(() => {
    window.__ATOLL_EXTREME_RUNNING__ = false;
    return {
      diagnostics: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event.startsWith('history.')),
      reading: window.__ATOLL_DIAGNOSTICS__.reading.snapshot(),
      frames: window.__ATOLL_EXTREME_FRAMES__ || [],
    };
  });
  const paint = await page.evaluate(async ({ frames, paintRegion }) => {
    const decode = (base64) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = `data:image/jpeg;base64,${base64}`;
    });
    const result = [];
    for (let index = 0; index < frames.length; index += 1) {
      const image = await decode(frames[index]);
      const scaleX = image.naturalWidth / paintRegion.pageWidth;
      const scaleY = image.naturalHeight / paintRegion.pageHeight;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(paintRegion.width * scaleX));
      canvas.height = Math.max(1, Math.floor(paintRegion.height * scaleY));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(
        image,
        Math.floor(paintRegion.left * scaleX), Math.floor(paintRegion.top * scaleY), canvas.width, canvas.height,
        0, 0, canvas.width, canvas.height,
      );
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let foreground = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const difference = Math.abs(pixels[offset] - paintRegion.color[0])
          + Math.abs(pixels[offset + 1] - paintRegion.color[1])
          + Math.abs(pixels[offset + 2] - paintRegion.color[2]);
        if (difference > 45) foreground += 1;
      }
      result.push({ index, foreground, width: canvas.width, height: canvas.height });
    }
    return result;
  }, { frames: screencast.map((frame) => frame.data), paintRegion: region });
  const manifest = [];
  for (let index = 0; index < screencast.length; index += 1) {
    const name = `extreme-turn-paint-${String(index).padStart(3, '0')}.jpeg`;
    const path = testInfo.outputPath(name);
    await writeFile(path, Buffer.from(screencast[index].data, 'base64'));
    manifest.push({ index, epochMs: screencast[index].epochMs, metadata: screencast[index].metadata, name });
  }
  const artifactPath = testInfo.outputPath('extreme-turn-production-evidence.json');
  await writeFile(artifactPath, JSON.stringify({ region, paint, paintFrames: manifest, runwayStarted, runwayIntentCount, extremeInstalled, extremeGeometry, ...evidence }, null, 2));
  await testInfo.attach('extreme-turn-production-evidence.json', { path: artifactPath, contentType: 'application/json' });

  const started = evidence.diagnostics.filter((entry) => entry.event === 'history.intent_started' && entry.detail?.reason === 'runway');
  const checks = evidence.diagnostics.filter((entry) => entry.event === 'history.projection_checked');
  expect(runwayStarted, JSON.stringify({ started, checks })).toBe(true);
  expect(runwayIntentCount, JSON.stringify({ started, checks })).toBeGreaterThanOrEqual(3);
  expect(extremeInstalled, JSON.stringify({ started, checks })).toBe(true);
  expect(extremeGeometry).toMatchObject({ hasExpandControl: true });
  expect(extremeGeometry.foldedBodies).toBeGreaterThan(0);
  expect(evidence.diagnostics.filter((entry) => entry.event === 'history.admission_commit'
    && entry.detail?.stagedIDs?.length > 0).length).toBeGreaterThanOrEqual(3);
  expect(started.length).toBeGreaterThan(0);
  expect(checks.length).toBeGreaterThan(0);
  expect(checks.every((entry) => Number(entry.detail?.released) > 0 && Number(entry.detail?.released) <= 8)).toBe(true);
  expect(evidence.reading.entries.filter((entry) => entry.event === 'reading.issuer-write')).toHaveLength(0);
  expect(Math.max(...evidence.frames.map((frame) => frame.rowCount))).toBeLessThan(100);
  expect(evidence.frames.some((frame) => frame.visible.length === 0)).toBe(false);
  expect(paint.length).toBeGreaterThan(2);
  const baseline = paint.find((frame) => frame.foreground > 0)?.foreground || 0;
  const minimumRequired = Math.max(100, Math.floor(baseline * 0.05));
  expect(paint.filter((frame) => frame.foreground < minimumRequired), JSON.stringify({ baseline, minimumRequired, paint })).toEqual([]);
});

test('F7 browsing send is one explicit bottom intent and later user input defeats live completion', async ({ page, request }, testInfo) => {
  test.slow();
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'long-running-history', seed: 0x92_09_23 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  const viewport = readingOwner(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  // Occupy the canonical agent so the target send has a durable queued
  // destination. The mock only advances that owner on explicit control calls,
  // giving the trusted wheel a deterministic window before later live stages.
  await chooseSteward(page);
  const ownerText = 'keep steward occupied for send takeover';
  await page.getByLabel('消息').fill(ownerText);
  await page.getByRole('button', { name: /发送/ }).click();
  await page.waitForFunction((needle) => (
    [...document.querySelectorAll('[data-presentation-row-id]')].some((row) => row.textContent?.includes(needle))
    && [...document.querySelectorAll('.task-control-buttons button')].some((button) => button.textContent === '停止')
  ), ownerText);

  await viewport.hover();
  await page.mouse.wheel(0, -3_000);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  await expect.poll(() => viewport.evaluate(tailDistance)).toBeGreaterThan(24);

  await chooseSteward(page);
  const text = 'browse send returns to latest once';
  await page.getByLabel('消息').fill(text);
  await page.evaluate(() => {
    window.__ATOLL_DIAGNOSTICS__.clear();
    window.__ATOLL_DIAGNOSTICS__.reading.enable({ case: 'production-browsing-send', seed: 0x92_09_23 });
  });
  const viewportBox = await viewport.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  let wheelDelivered;
  const wheelDelivery = new Promise((resolve) => { wheelDelivered = resolve; });
  await page.exposeBinding('__wheelAfterAuthorizedWrite', async () => {
    const x = Math.round((viewportBox?.x || 0) + Math.max(1, (viewportBox?.width || 1) / 2));
    const y = Math.round((viewportBox?.y || 0) + Math.max(1, (viewportBox?.height || 1) / 2));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: -2_000 });
    wheelDelivered();
    return true;
  });
  await startProductionSendProbe(page);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  await page.getByRole('button', { name: /发送/ }).click();
  // The editor is released by the local durable outbox transaction, not by a
  // receipt/feed. A slow remote phase must never leave the accepted draft in
  // the input or make the next send repeat it.
  await expect(page.getByLabel('消息')).toHaveText('');
  // Observation waits are intentionally non-asserting: even a missing phase
  // must produce the exclusive frame artifact before the business oracle runs.
  await Promise.race([wheelDelivery, new Promise((resolve) => setTimeout(resolve, 20_000))]).catch(() => null);
  const preInputGeometry = await page.evaluate(() => window.__productionSendProbe.preInputGeometry());
  await page.waitForFunction((needle) => [...document.querySelectorAll('.agent-wait-item')]
    .some((node) => node.textContent?.includes(needle)), text, { timeout: 10_000 }).catch(() => null);
  for (let step = 0; step < 3; step += 1) {
    await request.post('/mock/control/advance', { data: { ms: 0, compute: { channel_id: 'c0' } } });
    await page.waitForTimeout(90);
  }
  // Let every durable/network phase and the later live turn revisions arrive
  // after the trusted input. A stale send transaction must not survive that
  // input epoch and issue a correction for queued/processing/completed rows.
  await page.waitForFunction(() => {
    const events = window.__ATOLL_DIAGNOSTICS__.snapshot().map((entry) => entry.event);
    return ['submission.outbox_accepted', 'submission.transmit_started', 'submission.receipt_accepted', 'submission.feed_landed']
      .every((event) => events.includes(event));
  }, null, { timeout: 10_000 }).catch(() => null);
  await page.waitForTimeout(350);

  const productionEvidence = await page.evaluate(() => ({
    frames: window.__productionSendProbe.stop(),
    writes: window.__productionSendProbe.writes(),
    reading: window.__ATOLL_DIAGNOSTICS__.reading.snapshot(),
    diagnostics: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event?.startsWith('submission.')),
  }));
  productionEvidence.preInputGeometry = preInputGeometry;
  const artifactPath = testInfo.outputPath('browsing-send-production-evidence.json');
  await writeFile(artifactPath, JSON.stringify(productionEvidence, null, 2));
  await testInfo.attach('browsing-send-production-evidence.json', { path: artifactPath, contentType: 'application/json' });

  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  expect(await viewport.evaluate(tailDistance)).toBeGreaterThan(24);
  const bottomIntents = productionEvidence.reading.entries.filter((entry) => entry.event === 'reading.bottom-intent');
  const issuerWrites = productionEvidence.reading.entries.filter((entry) => entry.event === 'reading.issuer-write');
  const trustedWheels = productionEvidence.reading.entries.filter((entry) => (
    entry.event === 'reading.input-owner' && entry.detail?.type === 'wheel'
  ));
  const targetPending = productionEvidence.reading.entries.filter((entry) => (
    entry.event === 'reading.issuer-reject'
    && entry.detail?.reason === 'intent-target-pending'
  ));
  expect(bottomIntents, JSON.stringify(productionEvidence, null, 2)).toHaveLength(1);
  expect(issuerWrites, JSON.stringify(productionEvidence, null, 2)).toHaveLength(1);
  expect(trustedWheels, JSON.stringify(productionEvidence, null, 2)).toHaveLength(1);
  expect(Number(trustedWheels[0].sequence)).toBeGreaterThan(Number(issuerWrites[0].sequence));
  expect(Number(trustedWheels[0].detail?.inputEpoch)).toBeGreaterThan(Number(issuerWrites[0].detail?.inputEpoch));
  expect(issuerWrites.filter((entry) => Number(entry.sequence) > Number(trustedWheels[0].sequence))).toHaveLength(0);
  expect(productionEvidence.preInputGeometry?.mode).toBe('following');
  expect(targetPending.length, JSON.stringify(productionEvidence, null, 2)).toBeGreaterThan(0);
  const preTargetPending = targetPending.filter((entry) => (
    Number(entry.detail?.snapshotRevision) <= Number(entry.detail?.afterPresentationRevision)
  ));
  expect(preTargetPending.length, JSON.stringify(targetPending, null, 2)).toBeGreaterThan(0);
  // Waiting commits outside the list flow and may keep its baseline revision.
  // Join the actual write to already-installed target DOM and local durability;
  // a mode-change height write before target acceptance must fail this oracle.
  const firstWrite = issuerWrites[0];
  const physicalWrite = productionEvidence.writes.find((entry) => entry.sequence === firstWrite.sequence);
  expect(firstWrite.detail?.authorityLabel).toBe('intent');
  expect(firstWrite.detail?.sendDestination).toBe('waiting');
  expect(firstWrite.detail?.sendTargetIDs?.length).toBeGreaterThan(0);
  expect(Number(firstWrite.detail?.sendReadyRevision)).toBeGreaterThanOrEqual(
    Number(firstWrite.detail?.afterPresentationRevision),
  );
  expect(physicalWrite?.event).toBe('reading.issuer-write');
  for (const id of firstWrite.detail.sendTargetIDs) {
    expect(physicalWrite.waitingIDs).toContain(id);
    expect(physicalWrite.durableIDs).toContain(id);
  }
  expect(Math.abs(physicalWrite.afterGap)).toBeLessThanOrEqual(1);
  expect(Math.abs(productionEvidence.preInputGeometry?.gap)).toBeLessThanOrEqual(1);
  for (const required of [
    'submission.composer_send_started',
    'submission.outbox_accepted',
    'submission.composer_durable_accepted',
    'submission.transmit_started',
    'submission.receipt_accepted',
    'submission.feed_landed',
  ]) {
    expect(productionEvidence.diagnostics.some((entry) => entry.event === required), required).toBe(true);
  }
  expect(productionEvidence.frames.at(-1)?.bottomIntentCount).toBe(1);
  expect(productionEvidence.frames.at(-1)?.issuerWriteCount).toBe(1);
  const firstWriteFrame = productionEvidence.frames.findIndex((frame) => frame.issuerWriteCount === 1);
  expect(firstWriteFrame).toBeGreaterThan(0);
  expect(productionEvidence.frames[firstWriteFrame].gap).toBeLessThan(productionEvidence.frames[0].gap);
  expect(productionEvidence.frames.slice(firstWriteFrame).every((frame) => frame.issuerWriteCount === 1)).toBe(true);
  const postInputFrames = productionEvidence.frames.filter((frame) => frame.afterUserInput);
  expect(postInputFrames.length).toBeGreaterThan(0);
  expect(postInputFrames.every((frame) => frame.issuerWriteCount === 1)).toBe(true);
  expect(postInputFrames.at(-1)?.mode).toBe('browsing');
  const waitingIndex = productionEvidence.frames.findIndex((frame) => frame.waitingMounted && frame.waitingItems > 0);
  if (waitingIndex > 0) {
    const prior = productionEvidence.frames[waitingIndex - 1];
    const mounted = productionEvidence.frames[waitingIndex];
    const writerDelta = mounted.issuerWriteCount - prior.issuerWriteCount;
    expect([0, 1], JSON.stringify({ prior, mounted }, null, 2)).toContain(writerDelta);
    if (writerDelta === 0) {
      expect(mounted.scrollTop, JSON.stringify({ prior, mounted }, null, 2)).toBe(prior.scrollTop);
    } else {
      expect(prior.issuerWriteCount, JSON.stringify({ prior, mounted }, null, 2)).toBe(0);
      expect(mounted.issuerWriteCount, JSON.stringify({ prior, mounted }, null, 2)).toBe(1);
    }
    for (const key of ['stack', 'input', 'composer']) {
      expect(mounted.geometry[key], `${key}: ${JSON.stringify({ prior, mounted }, null, 2)}`).toEqual(prior.geometry[key]);
    }
  }

  const before = await viewport.evaluate(tailDistance);
  const arrival = await request.post('/mock/control/action', {
    data: { type: 'approval', channel_id: 'c0' },
  });
  expect(arrival.ok()).toBe(true);
  await expect(page.getByRole('button', { name: /条新动态/ })).toBeVisible();
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  await expect.poll(() => viewport.evaluate(tailDistance)).toBeGreaterThanOrEqual(Math.min(before, 25));
});

test('F7 history and progress publication do not manufacture new-dynamic notifications', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1718 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  const viewport = readingOwner(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  await viewport.hover();
  for (let index = 0; index < 4; index += 1) {
    await page.mouse.wheel(0, -100_000);
    await page.waitForTimeout(30);
  }
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  await expect(page.getByRole('button', { name: /条新动态/ })).toHaveCount(0);

  const progress = await request.post('/mock/control/action', {
    data: { type: 'dense_progress', channel_id: 'c0', count: 80 },
  });
  expect(progress.ok()).toBe(true);
  await page.waitForTimeout(250);
  await expect(page.getByRole('button', { name: /条新动态/ })).toHaveCount(0);

  const arrival = await request.post('/mock/control/action', {
    data: { type: 'approval', channel_id: 'c0' },
  });
  expect(arrival.ok()).toBe(true);
  await expect(page.getByRole('button', { name: /1 条新动态/ })).toBeVisible();
});

test('F7 continuous upward scrolling does not fight history prepend anchoring', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'mixed-height-history', seed: 1713 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const viewport = readingOwner(page);
  // The virtualizer is the sole geometry owner. Native overflow anchoring
  // would add a second prepend correction on top of keyed anchor retention.
  await expect(viewport).toHaveCSS('overflow-anchor', 'none');
  const samplesPromise = page.evaluate(async () => {
    const samples = [];
    const baselineEpoch = window.__ATOLL_DIAGNOSTICS__.snapshot()
      .filter((entry) => entry.event === 'history.intent_started')
      .reduce((latest, entry) => Math.max(latest, Number(entry.detail?.epoch || 0)), 0);
    let targetEpoch = 0;
    let satisfied = false;
    let postTerminalFrames = 0;
    for (let frame = 0; frame < 600; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const node = window.__ATOLL_TEST_READING_OWNER__.current();
      const viewportRect = node.getBoundingClientRect();
      const positions = {};
      for (const entry of node.querySelectorAll('.timeline-entry')) {
        const rect = entry.getBoundingClientRect();
        if (rect.bottom > viewportRect.top && rect.top < viewportRect.bottom) {
          positions[entry.dataset.entryId || ''] = rect.top - viewportRect.top;
        }
      }
      samples.push({
        frame,
        top: Math.round(node.scrollTop),
        height: Math.round(node.scrollHeight),
        positions,
      });
      if (frame % 4 === 0 || targetEpoch > 0) {
        const diagnostics = window.__ATOLL_DIAGNOSTICS__.snapshot();
        if (!targetEpoch) {
          targetEpoch = Number(diagnostics.find((entry) => (
            entry.event === 'history.intent_started'
              && entry.detail?.reason === 'runway'
              && Number(entry.detail?.epoch || 0) > baselineEpoch
          ))?.detail?.epoch || 0);
        }
        if (targetEpoch && diagnostics.some((entry) => (
          entry.event === 'history.intent_satisfied'
            && Number(entry.detail?.epoch || 0) === targetEpoch
        ))) {
          satisfied = true;
          postTerminalFrames += 1;
          if (postTerminalFrames >= 12) break;
        }
      }
    }
    return { samples, targetEpoch, satisfied };
  });
  await viewport.hover();
  // Keep producing real upward input while the first historical batch arrives.
  // The list owns anchor compensation; application code must not overwrite the
  // reader's wheel momentum with an absolute scrollTop from another frame.
  // Do not infer the top boundary from scrollTop here: Following uses reverse
  // coordinates while the browsing owner uses ordinary positive coordinates.
  // This journey is specifically the continuous-input contract, so all forty
  // input transactions must be delivered and the resulting operation awaited.
  for (let step = 0; step < 40; step += 1) {
    await page.mouse.wheel(0, -360);
    await page.waitForTimeout(18);
  }
  const sampledOperation = await samplesPromise;
  const { samples } = sampledOperation;
  expect(sampledOperation.targetEpoch).toBeGreaterThan(0);
  expect(sampledOperation.satisfied).toBe(true);
  const geometryCommands = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .filter((entry) => entry.event.startsWith('timeline.geometry_command')));
  const screenMotion = [];
  const motionFrames = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const shared = Object.keys(previous.positions).filter((id) => id && id in current.positions);
    if (!shared.length) continue;
    const movements = shared
      .map((id) => current.positions[id] - previous.positions[id])
      .sort((left, right) => left - right);
    const itemMovement = movements[Math.floor(movements.length / 2)];
    screenMotion.push(itemMovement);
    if (Math.abs(itemMovement) > 600 || itemMovement < -80) {
      motionFrames.push({ previous: { ...previous, positions: undefined }, current: { ...current, positions: undefined }, itemMovement });
    }
  }
  // Upward wheel input moves content down; native prepend anchoring keeps the
  // current reading row still. A large leap means another scrollTop controller
  // is fighting the reader's gesture.
  expect(Math.max(...screenMotion), JSON.stringify(motionFrames)).toBeLessThanOrEqual(600);
  expect(Math.min(...screenMotion), JSON.stringify({ motionFrames, geometryCommands })).toBeGreaterThanOrEqual(-80);
});

test('F7 one boundary demand keeps one status DOM across filtered physical history pages', async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history-delayed', seed: 1731 } });
  expect(reset.ok()).toBe(true);
  const dense = await request.post('/mock/control/action', {
    data: { type: 'dense_progress', channel_id: 'c0', count: 320, related: false, tail_count: 20 },
  });
  expect(dense.ok()).toBe(true);

  await login(page);
  await expect(page.getByText('visible tail 20', { exact: true })).toBeVisible({ timeout: 15_000 });
  const viewport = readingOwner(page);
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await page.evaluate(() => {
    window.__ATOLL_DIAGNOSTICS__.clear();
    const timeline = document.querySelector('.timeline');
    const owner = window.__ATOLL_TEST_READING_OWNER__;
    const list = owner.current();
    const ids = new WeakMap();
    let nextID = 0;
    let frame = 0;
    const evidence = {
      baseline: { width: list?.getBoundingClientRect().width || 0, height: list?.getBoundingClientRect().height || 0 },
      statusIDs: [], revisions: [], samples: [],
    };
    const sample = () => {
      const currentList = owner.current();
      const status = document.querySelector('.timeline-history-demand');
      if (status && !ids.has(status)) ids.set(status, `status-${++nextID}`);
      const statusID = status ? ids.get(status) : '';
      if (statusID && !evidence.statusIDs.includes(statusID)) evidence.statusIDs.push(statusID);
      const revision = status?.dataset.revision || '';
      if (revision && !evidence.revisions.includes(revision)) evidence.revisions.push(revision);
      evidence.samples.push({
        frame: frame++,
        statusID,
        phase: status?.dataset.phase || '',
        revision,
        animationName: status ? getComputedStyle(status, '::before').animationName : '',
        ownerCount: owner.nodes().length,
        container: currentList.dataset.readingContainer || 'virtuoso',
        listWidth: currentList?.getBoundingClientRect().width || 0,
        listHeight: currentList?.getBoundingClientRect().height || 0,
        presentationRows: currentList?.querySelectorAll('[data-presentation-row-id]').length || 0,
      });
      window.__ATOLL_LOADING_RAF__ = requestAnimationFrame(sample);
    };
    window.__ATOLL_LOADING_EVIDENCE__ = evidence;
    window.__ATOLL_LOADING_RAF__ = requestAnimationFrame(sample);
    window.__ATOLL_STOP_LOADING_TRACE__ = () => {
      cancelAnimationFrame(window.__ATOLL_LOADING_RAF__);
      return {
        ...evidence,
        timelineConnected: timeline?.isConnected === true,
        diagnostics: window.__ATOLL_DIAGNOSTICS__.snapshot(),
      };
    };
  });

  let activeEpoch = 0;
  let statusSeen = false;
  let settledSeen = false;
  let captureError = '';
  let evidence;
  try {
    await viewport.hover();
    // Legend consumes a real stream of wheel deltas. A single synthetic giant
    // delta can be clamped by Chromium before the virtualizer observes the top
    // edge, so drive the same production boundary path as a reader continuously
    // scrolling upward.
    for (let step = 0; step < 120; step += 1) {
      await page.mouse.wheel(0, -360);
      await page.waitForTimeout(18);
      statusSeen = await page.locator('.timeline-history-demand[data-phase="pending"]').isVisible().catch(() => false);
      if (statusSeen) break;
    }
    const statusDeadline = Date.now() + 10_000;
    while (!statusSeen && Date.now() < statusDeadline) {
      await page.waitForTimeout(50);
      statusSeen = await page.locator('.timeline-history-demand[data-phase="pending"]').isVisible().catch(() => false);
    }
    activeEpoch = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
      .findLast((entry) => entry.event === 'history.intent_started')?.detail?.epoch || 0);
    const settleDeadline = Date.now() + 30_000;
    while (activeEpoch > 0 && !settledSeen && Date.now() < settleDeadline) {
      settledSeen = await page.evaluate((targetEpoch) => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
        entry.event === 'history.intent_satisfied' && entry.detail?.epoch === targetEpoch
      )), activeEpoch);
      if (!settledSeen) await page.waitForTimeout(50);
    }
  } catch (error) {
    captureError = error?.stack || error?.message || String(error);
  } finally {
    evidence = await page.evaluate(() => window.__ATOLL_STOP_LOADING_TRACE__?.()).catch((error) => ({
      baseline: { width: 0, height: 0 }, statusIDs: [], revisions: [], samples: [], diagnostics: [],
      captureFailure: error?.message || String(error),
    }));
    evidence = { ...evidence, observation: { activeEpoch, statusSeen, settledSeen, captureError } };
    await mkdir(testInfo.outputDir, { recursive: true });
    await writeFile(`${testInfo.outputDir}/history-demand-multi-page.json`, JSON.stringify(evidence, null, 2));
    await testInfo.attach('history-demand-multi-page.json', {
      body: Buffer.from(JSON.stringify(evidence, null, 2)),
      contentType: 'application/json',
    });
  }

  const started = evidence.diagnostics.findLast((entry) => entry.event === 'history.intent_started');
  const settled = evidence.diagnostics.find((entry) => (
    entry.event === 'history.intent_satisfied'
      && entry.detail?.epoch === started?.detail?.epoch
  ));
  const completedDuringDemand = evidence.diagnostics.filter((entry) => (
    entry.event === 'history.batch_complete'
      && entry.detail?.channelId === 'c0'
      && Date.parse(entry.at) >= Date.parse(started?.at || 0)
      && Date.parse(entry.at) <= Date.parse(settled?.at || Number.POSITIVE_INFINITY)
  ));
  const pendingSamples = evidence.samples.filter((sample) => sample.statusID);
  expect(captureError).toBe('');
  expect(statusSeen).toBe(true);
  expect(settledSeen).toBe(true);
  expect(started).toBeTruthy();
  expect(settled).toBeTruthy();
  expect(completedDuringDemand.length).toBeGreaterThanOrEqual(2);
  expect(evidence.statusIDs).toHaveLength(1);
  expect(evidence.revisions).toHaveLength(1);
  expect(pendingSamples.length).toBeGreaterThan(1);
  expect(pendingSamples.every((sample) => sample.phase === 'pending')).toBe(true);
  expect(pendingSamples.every((sample) => sample.animationName === 'history-status-spin')).toBe(true);
  expect(evidence.samples.every((sample) => sample.ownerCount === 1)).toBe(true);
  expect(pendingSamples.every((sample) => sample.presentationRows > 0)).toBe(true);
  expect(Math.max(...evidence.samples.map((sample) => Math.abs(sample.listWidth - evidence.baseline.width)))).toBeLessThanOrEqual(1);
  expect(Math.max(...evidence.samples.map((sample) => Math.abs(sample.listHeight - evidence.baseline.height)))).toBeLessThanOrEqual(1);
});

test('F7 local Claude filter paints installed rows without foreground history UI', async ({ page, request }, testInfo) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1736 } });
  expect(reset.ok()).toBe(true);
  const dense = await request.post('/mock/control/action', {
    data: {
      type: 'dense_progress', channel_id: 'c0', related: false, count: 40,
      target_agent: 'claude', target_count: 3, target_after_noise: true, tail_count: 0,
    },
  });
  expect(dense.ok()).toBe(true);
  await login(page);
  // These mixed Codex/Claude rows are both installed and materialized at the
  // current tail. The filter commit must retain the local Claude rows without
  // remounting the scroller or waiting for history.
  await expect(page.getByText('target claude question 3', { exact: true })).toBeVisible({ timeout: 15_000 });
  const filter = page.getByTitle('只看我与 Claude 的往来');
  await expect(filter).toBeVisible();
  await page.evaluate(() => {
    window.__ATOLL_FILTER_TRACE__ = [];
    const started = performance.now();
    const sample = () => {
      const list = document.querySelector('.timeline-message-list');
      const filterButton = document.querySelector('.timeline-actor-filter button[aria-pressed="true"]');
      window.__ATOLL_FILTER_TRACE__.push({
        at: Math.round(performance.now() - started),
        filtered: Boolean(filterButton),
        claudeRows: [...document.querySelectorAll('[data-presentation-row-id]')]
          .filter((node) => node.textContent?.includes('target claude question')).length,
        foreground: Boolean(document.querySelector('.timeline-history-demand')),
        confirming: [...document.querySelectorAll('.timeline-history-status')]
          .some((node) => node.textContent?.includes('确认频道内容')),
        width: list?.getBoundingClientRect().width || 0,
        height: list?.getBoundingClientRect().height || 0,
      });
      window.__ATOLL_FILTER_RAF__ = requestAnimationFrame(sample);
    };
    window.__ATOLL_FILTER_RAF__ = requestAnimationFrame(sample);
  });
  await filter.click();
  await page.waitForTimeout(350);
  const evidence = await page.evaluate(() => {
    cancelAnimationFrame(window.__ATOLL_FILTER_RAF__);
    return {
      frames: window.__ATOLL_FILTER_TRACE__,
      diagnostics: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event.startsWith('history.')),
    };
  });
  const localArtifact = `${testInfo.outputDir}/filter-claude-local-rows.json`;
  await mkdir(testInfo.outputDir, { recursive: true });
  await writeFile(localArtifact, JSON.stringify(evidence, null, 2));
  await testInfo.attach('filter-claude-local-rows.json', {
    path: localArtifact, contentType: 'application/json',
  });

  const filtered = evidence.frames.filter((frame) => frame.filtered);
  expect(filtered.length).toBeGreaterThan(0);
  expect(filtered[0].claudeRows).toBeGreaterThanOrEqual(3);
  expect(filtered.every((frame) => !frame.foreground && !frame.confirming)).toBe(true);
  expect(Math.max(...filtered.map((frame) => frame.width)) - Math.min(...filtered.map((frame) => frame.width))).toBeLessThanOrEqual(1);
  expect(Math.max(...filtered.map((frame) => frame.height)) - Math.min(...filtered.map((frame) => frame.height))).toBeLessThanOrEqual(1);
});

test('F7 Claude filter silently scans nonmatching physical pages until semantic supply', async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history-delayed', seed: 1738 } });
  expect(reset.ok()).toBe(true);
  const dense = await request.post('/mock/control/action', {
    data: {
      type: 'dense_progress', channel_id: 'c0', related: false, count: 320,
      target_agent: 'claude', target_count: 2, tail_count: 20,
    },
  });
  expect(dense.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('visible tail 20', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());
  await page.getByTitle('只看我与 Claude 的往来').click();
  await expect(page.getByText('target claude question 2', { exact: true })).toBeVisible({ timeout: 30_000 });

  const evidence = await page.evaluate(() => ({
    foreground: Boolean(document.querySelector('.timeline-history-demand')),
    confirming: [...document.querySelectorAll('.timeline-history-status')]
      .some((node) => node.textContent?.includes('确认频道内容')),
    rows: [...document.querySelectorAll('[data-presentation-row-id]')].map((node) => node.textContent),
    diagnostics: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event.startsWith('history.')),
  }));
  const deepArtifact = `${testInfo.outputDir}/filter-claude-deep-supply.json`;
  await mkdir(testInfo.outputDir, { recursive: true });
  await writeFile(deepArtifact, JSON.stringify(evidence, null, 2));
  await testInfo.attach('filter-claude-deep-supply.json', {
    path: deepArtifact, contentType: 'application/json',
  });
  const started = evidence.diagnostics.find((entry) => (
    entry.event === 'history.intent_started' && entry.detail?.reason === 'projection-underfill'
  ));
  const completed = evidence.diagnostics.filter((entry) => entry.event === 'history.batch_complete');
  expect(started?.detail).toMatchObject({ urgency: 'anticipatory', installedVisibleRows: 0, actorFilterCount: 1 });
  expect(completed.length).toBeGreaterThanOrEqual(2);
  expect(evidence.foreground || evidence.confirming).toBe(false);
  expect(evidence.rows.some((text) => text.includes('target claude question 2'))).toBe(true);
});

test('F7 empty local Claude filter stays partial while warm history remains silent', async ({ page, request }, testInfo) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history-delayed', seed: 1737 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible({ timeout: 15_000 });
  const list = page.locator('.timeline-message-list');
  const before = await list.boundingBox();

  await page.getByTitle('只看我与 Claude 的往来').click();
  await expect(page.getByText('当前已加载的动态里没有符合筛选的往来', { exact: true })).toBeVisible();
  await expect(page.getByText('已扫描到频道开头，没有符合当前成员筛选的往来', { exact: true }))
    .toBeVisible({ timeout: 30_000 });
  const samples = [];
  for (let index = 0; index < 12; index += 1) {
    samples.push(await page.evaluate(() => ({
      partial: Boolean(document.querySelector('.empty-ledger[data-scope-state="partial"]')),
      definitive: [...document.querySelectorAll('.empty-ledger h2')]
        .some((node) => node.textContent === '已扫描到频道开头，没有符合当前成员筛选的往来'),
      foreground: Boolean(document.querySelector('.timeline-history-demand')),
      confirming: [...document.querySelectorAll('.timeline-history-status')]
        .some((node) => node.textContent?.includes('确认频道内容')),
      rect: (() => {
        const box = document.querySelector('.timeline-message-list')?.getBoundingClientRect();
        return box ? { width: box.width, height: box.height } : null;
      })(),
    })));
    await page.waitForTimeout(50);
  }
  const evidence = {
    samples,
    diagnostics: await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
      .filter((entry) => entry.event.startsWith('history.'))),
  };
  const emptyArtifact = `${testInfo.outputDir}/filter-claude-empty-eof.json`;
  await mkdir(testInfo.outputDir, { recursive: true });
  await writeFile(emptyArtifact, JSON.stringify(evidence, null, 2));
  await testInfo.attach('filter-claude-empty-eof.json', {
    path: emptyArtifact, contentType: 'application/json',
  });
  expect(samples.every((sample) => sample.definitive && !sample.partial
    && !sample.foreground && !sample.confirming)).toBe(true);
  expect(samples.every((sample) => sample.rect
    && Math.abs(sample.rect.width - before.width) <= 1
    && Math.abs(sample.rect.height - before.height) <= 1)).toBe(true);
});

test('F7 a committed under-filled viewport establishes history demand without trusting the initial edge callback', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 5_000 });
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1720 } });
  expect(reset.ok()).toBe(true);
  await login(page);

  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .find((entry) => entry.event === 'history.viewport_underfilled')?.detail || null)).not.toBeNull();
  const detail = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .find((entry) => entry.event === 'history.viewport_underfilled')?.detail || null);
  expect(detail.clientHeight).toBeGreaterThan(0);
  expect(detail.scrollHeight).toBeLessThanOrEqual(detail.clientHeight + 1);
  expect(detail.rowCount).toBeGreaterThan(0);
  expect(detail).toMatchObject({ attached: true, messageCurrent: true, bottomReady: true, hasOlder: true });
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .some((entry) => entry.event === 'history.intent_started'))).toBe(true);
});

test('F7 keyboard Home creates one physical top demand from the focused main scroller', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1721 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  const viewport = page.locator('.timeline-message-list');
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());

  await viewport.focus();
  await viewport.evaluate((node) => {
    window.__homeMinScrollTop = node.scrollTop;
    for (const type of ['scroll', 'scrollend']) {
      node.addEventListener(type, () => {
        window.__homeMinScrollTop = Math.min(window.__homeMinScrollTop, node.scrollTop);
      }, { passive: true });
    }
  });
  await viewport.press('Home');
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .filter((entry) => entry.event === 'history.intent_started').length)).toBe(1);
  // The satisfied prepend is allowed to move the physical scroll offset to
  // preserve the row at the top. Prove that Home first reached the real edge
  // instead of requiring the post-prepend scrollTop to remain zero.
  expect(await page.evaluate(() => Math.round(window.__homeMinScrollTop))).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .some((entry) => entry.event === 'history.intent_satisfied'))).toBe(true);
});

test('F7 reader can reverse direction immediately after a history prepend', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'mixed-height-history', seed: 1715 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  await page.mouse.wheel(0, -100_000);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .some((entry) => entry.event === 'history.intent_satisfied'))).toBe(true);

  // The prepend can still be receiving late ResizeObserver corrections here.
  // A downward gesture is nevertheless authoritative and must not be undone
  // by the old anchor transaction.
  const beforeReverse = await viewport.evaluate((node) => node.scrollTop);
  await page.mouse.wheel(0, 640);
  await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(beforeReverse + 20);
});

test('F7 oldest-history boundary stays inert under repeated upward input', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1716 } });
  expect(reset.ok()).toBe(true);
  await login(page);

  const viewport = readingOwner(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  for (let step = 0; step < 30; step += 1) {
    await viewport.hover();
    await page.mouse.wheel(0, -100_000);
    await page.waitForTimeout(30);
  }
  await expect(page.getByText('c0 history 1: ask steward for PONG', { exact: true })).toBeVisible();
  await viewport.hover();
  await page.mouse.wheel(0, -100_000);
  await expect.poll(() => viewport.evaluate((node) => Math.round(node.scrollTop))).toBe(0);

  const before = await page.evaluate(() => {
    const node = window.__ATOLL_TEST_READING_OWNER__.current();
    const first = node.querySelector('[data-presentation-row-id]');
    return {
      top: node.scrollTop,
      rowID: first?.dataset.presentationRowId || '',
      rowTop: first?.getBoundingClientRect().top - node.getBoundingClientRect().top,
      starts: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event === 'history.intent_started').length,
    };
  });
  for (let step = 0; step < 12; step += 1) await page.mouse.wheel(0, -720);
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => {
    const node = window.__ATOLL_TEST_READING_OWNER__.current();
    const first = node.querySelector('[data-presentation-row-id]');
    return {
      top: node.scrollTop,
      rowID: first?.dataset.presentationRowId || '',
      rowTop: first?.getBoundingClientRect().top - node.getBoundingClientRect().top,
      starts: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event === 'history.intent_started').length,
    };
  });
  expect(after.top).toBe(0);
  expect(after.rowID).toBe(before.rowID);
  expect(Math.abs(after.rowTop - before.rowTop)).toBeLessThanOrEqual(1);
  expect(after.starts).toBe(before.starts);
});

test('F7 switching channels restores the saved semantic reading anchor', async ({ page, request }, testInfo) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1714 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  await page.mouse.wheel(0, -2_400);
  await page.waitForTimeout(150);
  // Read the oracle at the same native event boundary as the production
  // handoff. A history prepend can legitimately finish while Playwright waits
  // for the channel button to become stable; sampling before that wait would
  // compare the restored click-time bookmark with an older screen.
  await page.evaluate(() => {
    document.addEventListener('pointerdown', (event) => {
      if (!event.target.closest?.('.channel-item')) return;
      const node = document.querySelector('.timeline-message-list');
      const viewportTop = node.getBoundingClientRect().top;
      const rows = [...node.querySelectorAll('[data-presentation-row-id]')]
        .map((row) => ({ id: row.dataset.presentationRowId, top: row.getBoundingClientRect().top - viewportTop, bottom: row.getBoundingClientRect().bottom - viewportTop }))
        .filter((row) => row.bottom > 0 && row.top < node.clientHeight)
        .sort((left, right) => left.top - right.top);
      window.__ATOLL_HANDOFF_ANCHOR__ = rows[0] || null;
    }, { capture: true, once: true });
  });

  await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0\.project$/ }) }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  const anchor = await page.evaluate(() => window.__ATOLL_HANDOFF_ANCHOR__ || null);
  expect(anchor?.id).toBeTruthy();
  // Reading position belongs to this browser document. Storage retains
  // durable unseen evidence, but must not make a reload resume stale middle
  // content; the live ViewSession still owns this same-document handoff.
  const persistedAfterLeave = await persistedBookmark(page, 'c0', 'c0:mine:');
  expect(persistedAfterLeave, JSON.stringify({ anchor, persistedAfterLeave })).toBeNull();
  await page.evaluate((anchorID) => {
    window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'channel-return-paints' });
    const frames = [];
    const writes = [];
    const originalScrollTo = Element.prototype.scrollTo;
    const originalScrollBy = Element.prototype.scrollBy;
    const captureWrite = (method, original) => function (...args) {
      const owned = this.classList?.contains('timeline-message-list');
      const before = owned ? Number(this.scrollTop || 0) : null;
      const result = original.apply(this, args);
      if (owned) writes.push({
        at: performance.now(),
        method,
        args,
        before,
        after: Number(this.scrollTop || 0),
        stack: new Error().stack || '',
      });
      return result;
    };
    if (typeof originalScrollTo === 'function') Element.prototype.scrollTo = captureWrite('scrollTo', originalScrollTo);
    if (typeof originalScrollBy === 'function') Element.prototype.scrollBy = captureWrite('scrollBy', originalScrollBy);
    let running = false;
    let animationFrame = 0;
    const sample = () => {
      if (!running) return;
      const node = document.querySelector('.timeline-message-list');
      const root = node?.getBoundingClientRect();
      const rows = [...(node?.querySelectorAll('[data-presentation-row-id]') || [])];
      const anchorRow = rows.find((candidate) => candidate.dataset.presentationRowId === anchorID);
      const anchorRect = anchorRow?.getBoundingClientRect();
      const hitX = anchorRect && root ? Math.max(root.left, Math.min(root.right - 1, anchorRect.left + anchorRect.width / 2)) : null;
      const hitY = anchorRect && root
        ? (Math.max(root.top, anchorRect.top) + Math.min(root.bottom, anchorRect.bottom)) / 2
        : null;
      const topmost = Number.isFinite(hitX) && Number.isFinite(hitY)
        ? document.elementFromPoint(hitX, hitY)
        : null;
      frames.push({
        frame: frames.length,
        at: performance.now(),
        channel: document.querySelector('main h1')?.textContent || '',
        restoring: Boolean(document.querySelector('.timeline-reading-restore')),
        mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
        scrollTop: node?.scrollTop ?? null,
        scrollHeight: node?.scrollHeight ?? null,
        firstRowID: rows[0]?.dataset.presentationRowId || '',
        lastRowID: rows.at(-1)?.dataset.presentationRowId || '',
        anchorTop: anchorRect && root ? anchorRect.top - root.top : null,
        anchorVisible: Boolean(anchorRect && root && anchorRect.bottom > root.top && anchorRect.top < root.bottom),
        anchorOwnedHit: Boolean(anchorRow && topmost && anchorRow.contains(topmost)),
        hitRowID: topmost?.closest?.('[data-presentation-row-id]')?.dataset.presentationRowId || '',
      });
      if (frames.length < 120) animationFrame = requestAnimationFrame(sample);
    };
    document.addEventListener('pointerdown', (event) => {
      const channel = event.target.closest?.('.channel-item')?.querySelector('.channel-name')?.textContent?.trim();
      if (channel !== 'c0') return;
      running = true;
      animationFrame = requestAnimationFrame(sample);
    }, { capture: true, once: true });
    window.__ATOLL_RETURN_PAINTS__ = {
      stop() {
        running = false;
        cancelAnimationFrame(animationFrame);
        if (typeof originalScrollTo === 'function') Element.prototype.scrollTo = originalScrollTo;
        if (typeof originalScrollBy === 'function') Element.prototype.scrollBy = originalScrollBy;
        return {
          frames,
          writes,
          reading: window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.() || null,
          diagnostics: window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || [],
        };
      },
    };
  }, anchor.id);
  await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0$/ }) }).click();
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect.poll(() => viewport.evaluate((node, anchorID) => {
    const root = node.getBoundingClientRect();
    const row = [...node.querySelectorAll('[data-presentation-row-id]')]
      .find((candidate) => candidate.dataset.presentationRowId === anchorID);
    if (!row) return false;
    const rect = row.getBoundingClientRect();
    return rect.bottom > root.top && rect.top < root.bottom;
  }, anchor.id)).toBe(true);
  await page.waitForTimeout(500);
  const returnEvidence = await page.evaluate(() => window.__ATOLL_RETURN_PAINTS__?.stop?.() || ({ frames: [] }));
  const returnFrames = returnEvidence.frames || [];
  const evidence = { anchor, persistedAfterLeave, ...returnEvidence };
  const evidencePath = testInfo.outputPath('channel-return-paints.json');
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  await testInfo.attach('channel-return-paints', { path: evidencePath, contentType: 'application/json' });

  const firstChannelFrame = returnFrames.find((frame) => frame.channel === 'c0');
  const firstVisibleIndex = returnFrames.findIndex((frame) => frame.channel === 'c0' && frame.anchorVisible);
  const visibleFrames = firstVisibleIndex < 0
    ? []
    : returnFrames.slice(firstVisibleIndex).filter((frame) => frame.channel === 'c0');
  expect(firstChannelFrame, JSON.stringify(evidence)).toBeTruthy();
  expect(firstVisibleIndex, JSON.stringify(evidence)).toBeGreaterThanOrEqual(0);
  expect(visibleFrames.every((frame) => frame.anchorVisible && Number.isFinite(frame.anchorTop)), JSON.stringify(evidence)).toBe(true);
  const restoredTops = visibleFrames.map((frame) => frame.anchorTop);
  expect(Math.max(...restoredTops) - Math.min(...restoredTops), JSON.stringify(evidence)).toBeLessThanOrEqual(2);
});

test('F7 scope and participant-filter activation exits save and restore through the single list lifecycle', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1715 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  await page.mouse.wheel(0, -2_400);
  await page.waitForTimeout(150);

  const mineAnchor = await captureVisibleAnchor(page);
  expect(mineAnchor?.id).toBeTruthy();
  await page.getByRole('group', { name: '动态范围' }).getByRole('button', { name: '@我' }).click();
  await expect(page.getByRole('group', { name: '动态范围' }).getByRole('button', { name: '全部' })).toBeVisible();
  expect(await persistedBookmark(page, 'c0', 'c0:mine:')).toBeNull();
  await page.getByRole('group', { name: '动态范围' }).getByRole('button', { name: '全部' }).click();
  await expectAnchorRestored(page, mineAnchor);

  const unfilteredAnchor = await captureVisibleAnchor(page);
  const steward = page.getByRole('group', { name: '按成员过滤' }).getByRole('button', { name: 'steward' });
  await steward.click();
  await expect(steward).toHaveAttribute('aria-pressed', 'true');
  expect(await persistedBookmark(page, 'c0', 'c0:mine:')).toBeNull();
  await steward.click();
  await expect(steward).toHaveAttribute('aria-pressed', 'false');
  await expectAnchorRestored(page, unfilteredAnchor);
});

test('F7 access loss saves the old activation and a later membership grant restores it', async ({ page, request }, testInfo) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1716 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'access-initial-current-tail' }));
  await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0\.project$/ }) }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await page.waitForTimeout(1_000);
  const initialEvidence = await page.evaluate(() => ({
    reading: window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.() || null,
    sequence: document.querySelector('.seq-label')?.textContent || '',
    rows: [...document.querySelectorAll('[data-presentation-row-id]')].map((row) => row.dataset.presentationRowId || ''),
  }));
  const initialEvidencePath = testInfo.outputPath('access-initial-current-tail.json');
  await writeFile(initialEvidencePath, JSON.stringify(initialEvidence, null, 2));
  await testInfo.attach('access-initial-current-tail', { path: initialEvidencePath, contentType: 'application/json' });
  await expect(page.getByText('c0.project history 119: ask project-agent for PONG', { exact: true })).toBeVisible();
  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  await page.mouse.wheel(0, -2_400);
  await page.waitForTimeout(150);
  const anchor = await captureVisibleAnchor(page);
  expect(anchor?.id).toBeTruthy();
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'access-restore-current-tail' }));

  const revoked = await request.post('/mock/control/action', { data: { type: 'revoke_membership', channel_id: 'c0.project' } });
  expect(revoked.ok()).toBe(true);
  await expect(page.getByText('频道内容不可访问', { exact: true })).toBeVisible({ timeout: 10_000 });
  expect(await persistedBookmark(page, 'c0.project', 'c0.project:mine:')).toBeNull();

  const granted = await request.post('/mock/control/action', { data: { type: 'grant_membership', channel_id: 'c0.project' } });
  expect(granted.ok()).toBe(true);
  await expect(page.locator('.timeline-message-list')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1_000);
  const restoreEvidence = await page.evaluate(() => ({
    reading: window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.() || null,
    diagnostics: window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || [],
    sequence: document.querySelector('.seq-label')?.textContent || '',
    rows: [...document.querySelectorAll('[data-presentation-row-id]')].map((row) => ({
      id: row.dataset.presentationRowId || '',
      text: row.textContent?.slice(0, 120) || '',
    })),
  }));
  const restoreEvidencePath = testInfo.outputPath('access-restore-current-tail.json');
  await writeFile(restoreEvidencePath, JSON.stringify(restoreEvidence, null, 2));
  await testInfo.attach('access-restore-current-tail', { path: restoreEvidencePath, contentType: 'application/json' });
  // The saved bookmark is intentionally allowed to keep 119 virtualized off
  // screen. It is not allowed to omit 119 from the committed Presentation,
  // which was the stale cache-frontier failure hidden by the old anchor-only
  // oracle.
  const currentTailCommit = restoreEvidence.reading?.entries?.find((entry) => (
    entry.event === 'reading.owner-commit'
      && entry.detail?.insertedIDs?.includes('c0.project-history-request-119')
  ));
  expect(currentTailCommit, JSON.stringify(restoreEvidence, null, 2)).toBeTruthy();
  await expectAnchorRestored(page, anchor);
});

test('F7 revoked active channel sends no freshness request and a later grant resumes exactly once', async ({ page, request }, testInfo) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1717 } });
  expect(reset.ok()).toBe(true);
  let accessPhase = 'initial';
  const sockets = [];
  const metaFrames = [];
  page.on('websocket', (socket) => {
    sockets.push({ phase: accessPhase, url: socket.url() });
    socket.on('framesent', ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload));
        if (frame?.frame_type === 'channel_meta') {
          metaFrames.push({ phase: accessPhase, channelId: frame.payload?.channel_id, generation: frame.payload?.generation });
        }
      } catch {
        // Binary/non-JSON frames are outside the Gateway request contract.
      }
    });
  });
  await login(page);
  await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0\.project$/ }) }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.getByText('c0.project history 119: ask project-agent for PONG', { exact: true })).toBeVisible();

  const socketsBeforeRevoke = sockets.length;
  accessPhase = 'revoked';
  const revoked = await request.post('/mock/control/action', { data: { type: 'revoke_membership', channel_id: 'c0.project' } });
  expect(revoked.ok()).toBe(true);
  await expect(page.getByText('频道内容不可访问', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);
  expect(metaFrames.filter((frame) => frame.phase === 'revoked' && frame.channelId === 'c0.project')).toEqual([]);
  expect(sockets).toHaveLength(socketsBeforeRevoke + 1);

  accessPhase = 'granted';
  const granted = await request.post('/mock/control/action', { data: { type: 'grant_membership', channel_id: 'c0.project' } });
  expect(granted.ok()).toBe(true);
  await expect(page.locator('.timeline-message-list')).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => metaFrames.filter((frame) => (
    frame.phase === 'granted' && frame.channelId === 'c0.project'
  )).length).toBe(1);
  expect(sockets).toHaveLength(socketsBeforeRevoke + 2);

  const evidencePath = testInfo.outputPath('access-interest-lifecycle.json');
  await writeFile(evidencePath, JSON.stringify({ sockets, metaFrames }, null, 2));
  await testInfo.attach('access-interest-lifecycle', { path: evidencePath, contentType: 'application/json' });
});

for (const seed of [1722, 1723, 1724]) {
  test(`F7 delayed initial pages keep the access activation at latest (seed ${seed})`, async ({ page, request }, testInfo) => {
    test.setTimeout(45_000);
    const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history-delayed', seed } });
    expect(reset.ok()).toBe(true);
    await login(page);
    await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());
    await page.evaluate(() => {
      window.__ATOLL_ACCESS_INITIAL_TRACE__ = [];
      const started = performance.now();
      const sample = () => {
        const owner = window.__ATOLL_TEST_READING_OWNER__;
        const viewport = owner.current();
        const rows = [...(viewport?.querySelectorAll('[data-presentation-row-id]') || [])];
        window.__ATOLL_ACCESS_INITIAL_TRACE__.push({
          at: Math.round(performance.now() - started),
          channel: document.querySelector('main h1')?.textContent || '',
          ledgerSeq: document.querySelector('.seq-label')?.textContent || '',
          restoring: Boolean(document.querySelector('.timeline-reading-restore')),
          rowCount: rows.length,
          first: rows[0]?.dataset.presentationRowId || '',
          last: rows.at(-1)?.dataset.presentationRowId || '',
          mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
          gap: owner.tailDistance(viewport),
        });
        if (performance.now() - started < 4_000) window.__ATOLL_ACCESS_INITIAL_RAF__ = requestAnimationFrame(sample);
      };
      window.__ATOLL_ACCESS_INITIAL_RAF__ = requestAnimationFrame(sample);
    });
    await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0\.project$/ }) }).click();
    await expect(page.locator('main h1')).toHaveText('c0.project');

    let failure = null;
    try {
      await expect(page.getByText('c0.project history 119: ask project-agent for PONG', { exact: true })).toBeVisible({ timeout: 12_000 });
      const viewport = readingOwner(page);
      await expect.poll(() => viewport.evaluate(tailDistance)).toBeLessThanOrEqual(24);
    } catch (error) {
      failure = error;
    } finally {
      await page.waitForTimeout(4_050);
      const evidence = await page.evaluate(() => ({
        samples: window.__ATOLL_ACCESS_INITIAL_TRACE__ || [],
        diagnostics: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => [
          'reading.initialization_ready',
          'reading.initialization_degraded',
          'history.segment_requested',
          'history.batch_complete',
        ].includes(entry.event)),
      }));
      const evidencePath = `${process.cwd()}/test-results/access-delayed-evidence/access-initial-${seed}.json`;
      await mkdir(`${process.cwd()}/test-results/access-delayed-evidence`, { recursive: true });
      await writeFile(evidencePath, JSON.stringify({ seed, historyDelayMs: 750, ...evidence }, null, 2));
      await testInfo.attach(`access-initial-${seed}.json`, {
        body: Buffer.from(JSON.stringify({ seed, historyDelayMs: 750, ...evidence }, null, 2)),
        contentType: 'application/json',
      });
    }
    if (failure) throw failure;
  });
}

test('F7 mobile keeps realtime delivery while the reader is browsing history', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1708 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const viewport = readingOwner(page);
  for (let index = 0; index < 5; index += 1) {
    await viewport.hover();
    await page.mouse.wheel(0, -100_000);
    await page.waitForTimeout(40);
  }
  await expect.poll(() => viewport.evaluate(tailDistance)).toBeGreaterThan(24);
  const arrival = await request.post('/mock/control/action', {
    data: { type: 'approval', channel_id: 'c0' },
  });
  expect(arrival.ok()).toBe(true);
  const jump = page.getByRole('button', { name: /条新动态/ });
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(page.getByText('Approve live mock action', { exact: true })).toBeVisible();
});

test('F6-PERF-03/F7 100k ledger keeps bounded production DOM and reveals older rows on upward demand', async ({ page, request }) => {
  test.setTimeout(45_000);
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'huge-history', seed: 1709 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await page.waitForFunction(() => {
    const node = document.querySelector('.timeline-message-list');
    return node && node.scrollHeight > node.clientHeight && document.querySelector('.request-text');
  });

  const viewport = page.locator('.timeline-message-list');
  await expect(page.getByText('c0 history 14286: ask steward for PONG', { exact: true })).toBeVisible();
  expect(await page.locator('.timeline-virtual-item').count()).toBeLessThan(100);
  // Exactly one gesture. Depending on machine speed the prefetched batch may
  // already be in the reservoir or still in flight; both paths must reveal an
  // older row without a second gesture.
  await viewport.hover();
  await page.mouse.wheel(0, -100_000);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .some((entry) => entry.event === 'history.intent_started'))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
	entry.event === 'history.intent_satisfied'
  ))), { timeout: 5_000 }).toBe(true);
  expect(await page.locator('.timeline-virtual-item').count()).toBeLessThan(100);
});

test('F7 a bounded warm cache survives reload and satisfies one physical top demand', async ({ page, request }) => {
  test.setTimeout(90_000);
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'huge-history', seed: 1710 } });
  expect(reset.ok()).toBe(true);
  await login(page);

  const cachedRows = () => page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const open = indexedDB.open('atoll-feed-v8');
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
  // Startup establishes a useful P0 working set; it must not scan 5,000 cold
  // rows merely to satisfy an arbitrary cache ceiling. Deeper rows remain an
  // on-demand P2 pull and the warm set remains durable across reload.
  await expect.poll(cachedRows, { timeout: 30_000 }).toBeGreaterThanOrEqual(128);
  expect(await cachedRows()).toBeLessThan(1_000);
  await expect.poll(() => page.evaluate(() => {
    const rows = window.__ATOLL_DIAGNOSTICS__.snapshot();
    return rows.filter((entry) => entry.event === 'history.segment_requested').length
      - rows.filter((entry) => entry.event === 'history.batch_complete').length;
  })).toBe(0);
  const restored = page;
  await restored.reload();
  await expect(restored.locator('.connection-state')).toHaveClass(/state-open/);
  const viewport = restored.locator('.timeline-message-list');
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await restored.waitForTimeout(500);
  await restored.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());

  await viewport.hover();
  await restored.mouse.wheel(0, -100_000);
  await expect.poll(() => restored.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
	entry.event === 'history.intent_started'
  )))).toBe(true);
  await expect.poll(() => restored.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
	entry.event === 'history.intent_satisfied'
  ))), { timeout: 30_000 }).toBe(true);

  const operations = await restored.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => (
	entry.event === 'history.intent_started'
  )));
  expect(operations).toHaveLength(1);

  // scroll + scrollend from one gesture are deduplicated, but the key is not
  // a lifetime suppression. After the first prepend exposes a new physical
  // top, a second native gesture owns a new inputEpoch and must keep paging.
  await restored.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());
  await restored.mouse.wheel(0, -100_000);
  await expect.poll(() => restored.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => (
    entry.event === 'history.intent_started'
  )).length)).toBe(1);
  await expect.poll(() => restored.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
    entry.event === 'history.intent_satisfied'
  ))), { timeout: 30_000 }).toBe(true);
  const continued = await restored.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().find((entry) => (
    entry.event === 'history.intent_started'
  )));
  expect(continued.detail.anchorSeq).toBeLessThan(operations[0].detail.anchorSeq);
});

test('F7 a lagged cache paints locally, reconciles the network tail, then rejoins cache at the seam', async ({ page, request }) => {
  test.setTimeout(45_000);
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1711 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  // Wait only for the bounded current-tail working set. Exhausting all remote
  // history here would turn ordinary startup prefetch into an unbounded scan.
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
    entry.event === 'history.batch_complete'
      && entry.detail?.channelId === 'c0'
      && Number(entry.detail?.acceptedRows) > 0
  )))).toBe(true);
  // Build a cache that has both a paintable tail and a deeper continuation;
  // otherwise there is no local segment left to rejoin after the remote gap.
  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  await page.mouse.wheel(0, -100_000);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
    entry.event === 'history.intent_satisfied'
  ))), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const open = indexedDB.open('atoll-feed-v8');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return new Promise((resolve, reject) => {
      const tx = database.transaction('rows', 'readonly');
      const count = tx.objectStore('rows').count(IDBKeyRange.bound(['c0', 0], ['c0', Number.MAX_SAFE_INTEGER]));
      count.onsuccess = () => resolve(count.result >= 160);
      count.onerror = () => reject(count.error);
    });
  }), { timeout: 15_000 }).toBe(true);
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
  await resumed.goto('/');
  await expect(resumed.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(resumed.getByText(/c0 动态 #19/)).toBeVisible();
  await expect.poll(() => resumed.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
    entry.event === 'history.segment_requested'
      && entry.detail?.channelId === 'c0'
      && entry.detail?.source === 'indexeddb'
  ))), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => resumed.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
    entry.event === 'history.segment_requested'
      && entry.detail?.channelId === 'c0'
      && entry.detail?.source === 'network'
  ))), { timeout: 15_000 }).toBe(true);
  await expect.poll(() => resumed.evaluate(() => {
    const sources = window.__ATOLL_DIAGNOSTICS__.snapshot()
      .filter((entry) => entry.event === 'history.segment_requested' && entry.detail?.channelId === 'c0')
      .map((entry) => entry.detail.source);
    const network = sources.indexOf('network');
    return network > 0 && sources.slice(network + 1).includes('indexeddb');
  }), { timeout: 15_000 }).toBe(true);

  const sources = await resumed.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .filter((entry) => entry.event === 'history.segment_requested' && entry.detail?.channelId === 'c0')
    .map((entry) => ({ source: entry.detail.source, beforeSeq: entry.detail.beforeSeq })));
  // Local decode is allowed to paint before attach. Once attach establishes a
  // newer authoritative head, the scheduler fills that network-only gap and
  // then resumes IndexedDB below the exact covered seam.
  expect(sources[0]?.source).toBe('indexeddb');
  const networkIndex = sources.findIndex((entry) => entry.source === 'network');
  expect(networkIndex).toBeGreaterThan(0);
  const cacheAfterNetwork = sources.findIndex((entry, index) => index > networkIndex && entry.source === 'indexeddb');
  expect(cacheAfterNetwork).toBeGreaterThan(networkIndex);
  expect(sources[cacheAfterNetwork].beforeSeq).toBeLessThan(sources[networkIndex].beforeSeq);
});

test('F7 cached progress-only ranges never stall restoration of the visible root turn', async ({ page, request }) => {
  test.setTimeout(45_000);
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1712 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const dense = await request.post('/mock/control/action', {
    data: { type: 'dense_progress', channel_id: 'c0', count: 640 },
  });
  expect(dense.ok()).toBe(true);
  const detail = await dense.json();
  await expect.poll(() => page.evaluate(async (headSeq) => {
    const database = await new Promise((resolve, reject) => {
      const open = indexedDB.open('atoll-feed-v8');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return new Promise((resolve, reject) => {
      const tx = database.transaction('channelMeta', 'readonly');
      const get = tx.objectStore('channelMeta').get('c0');
      get.onsuccess = () => resolve((get.result?.coverage || []).some((entry) => entry.highSeq >= headSeq));
      get.onerror = () => reject(get.error);
    });
  }, detail.head_seq), { timeout: 15_000 }).toBe(true);
  expect(await page.evaluate(async ({ seq, requestId }) => {
    const database = await new Promise((resolve, reject) => {
      const open = indexedDB.open('atoll-feed-v8');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return new Promise((resolve, reject) => {
      const tx = database.transaction('rows', 'readonly');
      const get = tx.objectStore('rows').get(['c0', seq]);
      get.onsuccess = () => resolve(get.result?.envelope?.id === requestId);
      get.onerror = () => reject(get.error);
    });
  }, { seq: detail.head_seq - detail.count, requestId: detail.request_id })).toBe(true);

  const context = page.context();
  await page.close();
  const resumed = await context.newPage();
  await resumed.goto('/');
  await expect(resumed.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(resumed.getByText('dense progress request (640)', { exact: true })).toBeVisible({ timeout: 15_000 });
  const diagnostics = await resumed.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot());
  const started = diagnostics.filter((entry) => (
    entry.event === 'history.intent_started' && entry.detail?.reason === 'top'
  ));
  // Passive cache restoration owns its own bounded initial-tail operation. It
  // may drain progress-only ledger ranges until a root is presentable, but it
  // must not impersonate a user's request to reveal older visible history.
  expect(started).toHaveLength(0);
});
