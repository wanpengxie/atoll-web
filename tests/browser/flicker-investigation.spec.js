import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const allCases = [
  { seed: 4101, history: 'concurrent', delayMs: 0, deltas: [-700, -900, -1_300, -1_700], intervalMs: 12 },
  { seed: 4102, history: 'concurrent', delayMs: 32, deltas: [-900, -1_400, -1_900, -2_200], intervalMs: 8 },
  { seed: 4103, history: 'concurrent', delayMs: 96, deltas: [-1_100, -1_600, -2_100, -2_500], intervalMs: 6 },
  { seed: 4104, history: 'none', deltas: [-1_100, -1_600, -2_100, -2_500], intervalMs: 6 },
  { seed: 4105, history: 'stationary', delayMs: 32, deltas: [-2_700], intervalMs: 0 },
];
const selectedSeed = Number(process.env.ATOLL_FLICKER_SEED || 0);
const cases = selectedSeed ? allCases.filter((scenario) => scenario.seed === selectedSeed) : allCases;

async function openNearHistoryEdge(page) {
  await page.goto('/tests/browser/fixtures/reading-viewport.html');
  await page.waitForFunction(() => window.readingFixture?.anchor().id);
  await page.waitForTimeout(120);
  await page.evaluate(async () => {
    // Take reading ownership, then settle close enough to the history edge for
    // a short, fast native-wheel burst to overlap the arriving prepend.
    window.readingFixture.scroll(-100_000_000);
    window.readingFixture.scroll(2_500);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
}

async function installProbe(page, scenario) {
  await page.evaluate((metadata) => {
    window.__ATOLL_DIAGNOSTICS__.reading.enable({
      case: 'flicker-investigation-near-top-prepend',
      fixture: 'reading-viewport',
      ...metadata,
    });
    const root = document.querySelector('.timeline-message-list');
    const nodeSerial = new WeakMap();
    let nextSerial = 0;
    let running = true;
    const frames = [];
    const mutations = [];
    const marks = [];
    const longTasks = [];
    const serialFor = (node) => {
      if (!nodeSerial.has(node)) nodeSerial.set(node, ++nextSerial);
      return nodeSerial.get(node);
    };
    const rowsFrom = (nodes) => [...nodes].flatMap((node) => {
      if (!(node instanceof Element)) return [];
      const rows = node.matches('[data-presentation-row-id]')
        ? [node]
        : [...node.querySelectorAll('[data-presentation-row-id]')];
      return rows.map((row) => ({ id: row.dataset.presentationRowId || '', serial: serialFor(row) }));
    });
    const mutationObserver = new MutationObserver((records) => {
      for (const record of records) {
        const added = rowsFrom(record.addedNodes);
        const removed = rowsFrom(record.removedNodes);
        if (added.length || removed.length) mutations.push({
          epochMs: Date.now(),
          at: performance.now(),
          added,
          removed,
        });
      }
    });
    mutationObserver.observe(root, { childList: true, subtree: true });
    let longTaskObserver = null;
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push({
          startTime: entry.startTime,
          duration: entry.duration,
        });
      });
      longTaskObserver.observe({ type: 'longtask', buffered: false });
    } catch { /* Chromium may disable long-task entries in some modes. */ }

    const mark = (name, detail = {}) => marks.push({
      name,
      epochMs: Date.now(),
      at: performance.now(),
      ...detail,
    });
    const sample = () => {
      if (!running) return;
      const viewport = root.getBoundingClientRect();
      const list = root.firstElementChild;
      const items = [...root.querySelectorAll('[data-presentation-row-id]')];
      const visible = items.flatMap((item) => {
        const rect = item.getBoundingClientRect();
        if (rect.bottom <= viewport.top + 0.5 || rect.top >= viewport.bottom - 0.5) return [];
        const row = item;
        return [{
          id: row.dataset.presentationRowId || '',
          rowSerial: serialFor(row),
          itemIndex: Number.NaN,
          knownSize: rect.height,
          top: rect.top - viewport.top,
          bottom: rect.bottom - viewport.top,
        }];
      }).sort((left, right) => left.top - right.top);
      const first = visible[0];
      const last = visible.at(-1);
      const style = getComputedStyle(root);
      const listStyle = list ? getComputedStyle(list) : null;
      frames.push({
        epochMs: Date.now(),
        at: performance.now(),
        mode: window.readingFixture.state().mode,
        inputEpoch: window.readingFixture.state().inputEpoch,
        anchor: window.readingFixture.anchor(),
        scrollTop: root.scrollTop,
        scrollHeight: root.scrollHeight,
        clientHeight: root.clientHeight,
        itemCount: items.length,
        visible,
        emptyViewport: visible.length === 0,
        undefinedVisibleSlot: visible.some((row) => !row.id),
        uncoveredTop: root.scrollTop > 1 && (!first || first.top > 1),
        uncoveredBottom: root.scrollHeight - root.clientHeight - root.scrollTop > 24
          && (!last || last.bottom < root.clientHeight - 1),
        rowErrorCount: root.querySelectorAll('.timeline-row-error').length,
        rootVisibility: style.visibility,
        rootOpacity: style.opacity,
        listVisibility: listStyle?.visibility || '',
        listOpacity: listStyle?.opacity || '',
        listMarginTop: listStyle?.marginTop || '',
        listPaddingTop: listStyle?.paddingTop || '',
      });
      requestAnimationFrame(sample);
    };
    window.__flickerProbe = {
      mark,
      stop() {
        running = false;
        mutationObserver.disconnect();
        longTaskObserver?.disconnect();
        return { scenario: metadata, frames, mutations, marks, longTasks };
      },
    };
    mark('probe-start', { anchor: window.readingFixture.anchor() });
    requestAnimationFrame(sample);
  }, scenario);
}

test('before: compositor and DOM remain continuously covered during history prepend', async ({ page }, testInfo) => {
  const report = [];
  const violations = [];
  for (const scenario of cases) {
    await openNearHistoryEdge(page);
    await installProbe(page, scenario);
    await page.mouse.move(320, 260);

    const cdp = await page.context().newCDPSession(page);
    const screencast = [];
    cdp.on('Page.screencastFrame', async (event) => {
      screencast.push({
        epochMs: Number(event.metadata?.timestamp || 0) * 1_000,
        metadata: event.metadata,
        jpegBase64: event.data,
      });
      await cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 90,
      maxWidth: 1_280,
      maxHeight: 720,
      everyNthFrame: 1,
    });
    await page.waitForTimeout(40);

    await page.evaluate(() => window.__flickerProbe.mark('input-burst-start'));
    await page.mouse.wheel(0, scenario.deltas[0]);
    if (scenario.history !== 'none') {
      await page.evaluate(({ delayMs }) => {
        window.__flickerProbe.mark('history-scheduled', { delayMs });
        setTimeout(() => {
          window.__flickerProbe.mark('prepend-before', { anchor: window.readingFixture.anchor() });
          window.readingFixture.prepend();
          window.__flickerProbe.mark('prepend-after', { anchor: window.readingFixture.anchor() });
        }, delayMs);
      }, scenario);
    }
    for (const delta of scenario.deltas.slice(1)) {
      await page.waitForTimeout(scenario.intervalMs);
      await page.evaluate((value) => window.__flickerProbe.mark('wheel-before', { delta: value }), delta);
      await page.mouse.wheel(0, delta);
    }
    await page.evaluate(() => window.__flickerProbe.mark('input-burst-end'));
    await page.waitForTimeout(520);
    await cdp.send('Page.stopScreencast');

    const probe = await page.evaluate(() => window.__flickerProbe.stop());
    const readingTrace = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.snapshot());
    const paintAnalysis = await page.evaluate(async (jpegFrames) => {
      const decode = (base64) => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = `data:image/jpeg;base64,${base64}`;
      });
      const results = [];
      for (let index = 0; index < jpegFrames.length; index += 1) {
        const image = await decode(jpegFrames[index]);
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = Math.min(600, image.naturalHeight);
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let darkPixels = 0;
        for (let offset = 0; offset < pixels.length; offset += 4) {
          if (pixels[offset] < 220 || pixels[offset + 1] < 220 || pixels[offset + 2] < 220) darkPixels += 1;
        }
        results.push({ index, width: canvas.width, height: canvas.height, darkPixels });
      }
      return results;
    }, screencast.map((frame) => frame.jpegBase64));
    const blankPaints = paintAnalysis.filter((frame) => frame.darkPixels < 100);
    const visualFailures = probe.frames.filter((frame) => (
      frame.emptyViewport
      || frame.undefinedVisibleSlot
      || frame.uncoveredTop
      || frame.uncoveredBottom
      || frame.rowErrorCount > 0
      || frame.rootVisibility === 'hidden'
      || Number(frame.rootOpacity) === 0
      || frame.listVisibility === 'hidden'
      || Number(frame.listOpacity) === 0
    ));
    if (visualFailures.length) violations.push({ seed: scenario.seed, visualFailures });

    const frameManifest = screencast.map((frame, index) => ({
      index,
      epochMs: frame.epochMs,
      metadata: frame.metadata,
      resourceName: `flicker-${scenario.seed}-paint-${String(index).padStart(3, '0')}.jpeg`,
    }));
    for (let index = 0; index < screencast.length; index += 1) {
      const paintPath = testInfo.outputPath(frameManifest[index].resourceName);
      await writeFile(paintPath, Buffer.from(screencast[index].jpegBase64, 'base64'));
      await testInfo.attach(frameManifest[index].resourceName, {
        path: paintPath,
        contentType: 'image/jpeg',
      });
    }
    const result = {
      scenario,
      probe,
      readingTrace,
      paintFrames: frameManifest,
      paintAnalysis,
      blankPaints,
      domCoverageFailures: visualFailures,
    };
    report.push(result);
    const timelinePath = testInfo.outputPath(`flicker-${scenario.seed}-timeline.json`);
    await writeFile(timelinePath, JSON.stringify(result, null, 2));
    await testInfo.attach(`flicker-${scenario.seed}-timeline.json`, {
      path: timelinePath,
      contentType: 'application/json',
    });
    await cdp.detach();
  }

  const summary = JSON.stringify(report.map(({
      scenario,
      probe,
      readingTrace,
      paintFrames,
      paintAnalysis,
      blankPaints,
      domCoverageFailures,
    }) => ({
      scenario,
      probeFrames: probe.frames.length,
      mutations: probe.mutations.length,
      longTasks: probe.longTasks,
      readingEvents: readingTrace.entries.length,
      readingDropped: readingTrace.dropped,
      paintFrames: paintFrames.length,
      darkPixelRange: [Math.min(...paintAnalysis.map((frame) => frame.darkPixels)), Math.max(...paintAnalysis.map((frame) => frame.darkPixels))],
      blankPaints,
      domCoverageFailureCount: domCoverageFailures.length,
      domCoverageFailures,
    })), null, 2);
  const summaryPath = testInfo.outputPath('flicker-investigation-summary.json');
  await writeFile(summaryPath, summary);
  await testInfo.attach('flicker-investigation-summary.json', {
    path: summaryPath,
    contentType: 'application/json',
  });
  const paintViolations = report.flatMap(({ scenario, blankPaints }) => (
    blankPaints.map((paint) => ({ seed: scenario.seed, history: scenario.history, paint }))
  ));
  const oracle = {
    domCoverage: { failureCount: violations.reduce((count, entry) => count + entry.visualFailures.length, 0), violations },
    compositorPaint: { failureCount: paintViolations.length, violations: paintViolations },
  };
  const oraclePath = testInfo.outputPath('flicker-investigation-oracle.json');
  await writeFile(oraclePath, JSON.stringify(oracle, null, 2));
  await testInfo.attach('flicker-investigation-oracle.json', {
    path: oraclePath,
    contentType: 'application/json',
  });
  expect.soft(oracle.domCoverage.failureCount, JSON.stringify(oracle.domCoverage.violations)).toBe(0);
  expect(oracle.compositorPaint.failureCount, JSON.stringify(oracle.compositorPaint.violations)).toBe(0);
});
