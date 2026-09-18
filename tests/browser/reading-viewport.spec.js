import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// This fixture exercises the browser's real native thumb. Chromium otherwise
// uses a headless overlay scrollbar whose painted handle is not mouse-hit-testable.
test.use({
  headless: process.env.ATOLL_NATIVE_SCROLLBAR_HEADFUL === '1' ? false : undefined,
  launchOptions: {
    args: ['--disable-features=OverlayScrollbar'],
    ...(process.env.ATOLL_NATIVE_SCROLLBAR_HEADFUL === '1'
      ? { executablePath: process.env.ATOLL_CHROMIUM_EXECUTABLE || '/usr/bin/google-chrome' }
      : {}),
  },
});

async function openFixture(page) {
  await page.goto('/tests/browser/fixtures/reading-viewport.html');
  await page.waitForFunction(() => window.readingFixture?.anchor().id);
  await page.waitForTimeout(160);
}

async function frames(page, count = 6) {
  return page.evaluate(async (amount) => {
    const values = [];
    for (let index = 0; index < amount; index += 1) {
      await new Promise(requestAnimationFrame);
      values.push(window.readingFixture.anchor());
    }
    return values;
  }, count);
}

async function readingFrames(page, count = 3) {
  return page.evaluate(async (amount) => {
    const values = [];
    for (let index = 0; index < amount; index += 1) {
      await new Promise(requestAnimationFrame);
      const node = document.querySelector('.timeline-message-list');
      values.push({
        ...window.readingFixture.anchor(),
        mode: window.readingFixture.state().mode,
        gap: node.scrollHeight - node.clientHeight - node.scrollTop,
      });
    }
    return values;
  }, count);
}

async function startVisualProbe(page) {
  await page.evaluate(() => {
    const frames = [];
    const mutations = [];
    const longTasks = [];
    const nodeSerials = new WeakMap();
    let serial = 0;
    let running = true;
    const rowMetadata = (node) => {
      if (!nodeSerials.has(node)) nodeSerials.set(node, ++serial);
      return { id: node.dataset.presentationRowId || '', nodeSerial: nodeSerials.get(node) };
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const collect = (nodes) => [...nodes].flatMap((node) => {
          if (!(node instanceof Element)) return [];
          const rows = node.matches('[data-presentation-row-id]')
            ? [node]
            : [...node.querySelectorAll('[data-presentation-row-id]')];
          return rows.map(rowMetadata);
        });
        const added = collect(record.addedNodes);
        const removed = collect(record.removedNodes);
        if (added.length || removed.length) mutations.push({
          at: performance.now(),
          added,
          removed,
        });
      }
    });
    const root = document.querySelector('.timeline-message-list');
    observer.observe(root, { subtree: true, childList: true });
    let performanceObserver = null;
    try {
      performanceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push({ startTime: entry.startTime, duration: entry.duration });
      });
      performanceObserver.observe({ type: 'longtask', buffered: false });
    } catch { /* Long-task entries are not available in every browser mode. */ }
    const sample = () => {
      if (!running) return;
      const viewport = root.getBoundingClientRect();
      const style = getComputedStyle(root);
      const materialized = [...root.querySelectorAll('[data-presentation-row-id]')];
      const visible = materialized.filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.bottom > viewport.top + 0.5 && rect.top < viewport.bottom - 0.5;
      });
      const visibleMeta = visible.map((node) => {
        const rect = node.getBoundingClientRect();
        return { ...rowMetadata(node), top: rect.top - viewport.top, bottom: rect.bottom - viewport.top };
      });
      const first = visibleMeta[0];
      const last = visibleMeta.at(-1);
      frames.push({
        at: performance.now(),
        mode: window.readingFixture.state().mode,
        inputEpoch: window.readingFixture.state().inputEpoch,
        anchor: window.readingFixture.anchor(),
        materializedCount: materialized.length,
        visible: visibleMeta,
        emptyViewport: visibleMeta.length === 0,
        uncoveredTop: root.scrollTop > 1 && (!first || first.top > 1),
        uncoveredBottom: root.scrollHeight - root.clientHeight - root.scrollTop > 24
          && (!last || last.bottom < root.clientHeight - 1),
        rowErrorCount: root.querySelectorAll('.timeline-row-error').length,
        visibility: style.visibility,
        opacity: style.opacity,
        scrollTop: root.scrollTop,
        scrollHeight: root.scrollHeight,
        clientHeight: root.clientHeight,
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    window.__readingVisualProbe = {
      stop() {
        running = false;
        observer.disconnect();
        performanceObserver?.disconnect();
        return { frames, mutations, longTasks };
      },
    };
  });
}

function expectBrowsingTakeover(trace) {
  const takeover = trace.findIndex((frame) => frame.mode === 'browsing' && frame.gap > 40);
  expect(takeover, JSON.stringify(trace)).toBeGreaterThanOrEqual(0);
  for (const frame of trace.slice(takeover)) {
    expect(frame.anchor, JSON.stringify(trace)).toBeTruthy();
    expect(frame.mode, JSON.stringify(trace)).toBe('browsing');
    expect(frame.gap, JSON.stringify(trace)).toBeGreaterThan(40);
  }
}

test('F6-PERF-04/C3/C5 cold prepend keeps the tail window bounded and survives fast reverse', async ({ page }, testInfo) => {
  await openFixture(page);
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.enable({
    case: 'cold-prepend-fast-reverse',
    fixture: 'reading-viewport',
  }));
  await page.mouse.move(300, 260);
  await page.mouse.wheel(0, -1700);
  await page.waitForTimeout(120);
  const evidence = [];
  for (let step = 0; step < 8; step += 1) {
    const before = await page.evaluate(() => window.readingFixture.anchor());
    await page.evaluate(() => window.readingFixture.prepend());
    const samples = await frames(page);
    for (const frame of samples) {
      expect(frame.id, JSON.stringify({ step, before, frame })).toBe(before.id);
      expect(Math.abs(frame.offset - before.offset), JSON.stringify({ step, before, frame })).toBeLessThanOrEqual(1);
    }
    const delta = step % 2 ? 480 : -520;
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(24);
    await expect(page.locator('[data-presentation-row-id]').first()).toBeVisible();
    evidence.push({ step, delta, before, samples, afterInput: await page.evaluate(() => window.readingFixture.anchor()) });
  }
  expect(await page.locator('[data-presentation-row-id]').count()).toBeLessThan(100);
  const readingTrace = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.snapshot());
  await testInfo.attach('cold-prepend-fast-reverse-reading-trace.json', {
    body: Buffer.from(JSON.stringify({ evidence, readingTrace }, null, 2)),
    contentType: 'application/json',
  });
  const firstInput = readingTrace.entries.find((entry) => entry.event === 'reading.input-owner')?.sequence || 0;
  expect(readingTrace.entries.filter((entry) => (
    entry.sequence > firstInput && entry.event === 'reading.issuer-write'
  ))).toHaveLength(0);
});

test('fixed-seed reading fuzz keeps semantic content painted through delayed history and live resize', async ({ page }, testInfo) => {
  const seeds = [2711, 2712, 2713];
  const deltasBySeed = [
    [-360, 260, -420, 320],
    [-520, 300, -280, 240],
    [-300, 220, -480, 360],
  ];
  const violations = [];
  for (let seedIndex = 0; seedIndex < seeds.length; seedIndex += 1) {
    const seed = seeds[seedIndex];
    await openFixture(page);
    await page.evaluate((value) => window.__ATOLL_DIAGNOSTICS__.reading.enable({
      case: 'delayed-history-live-resize-fuzz',
      seed: value,
    }), seed);
    await page.mouse.move(300, 260);
    await page.mouse.wheel(0, -1_300);
    await page.waitForTimeout(80);
    await startVisualProbe(page);
    const steps = [];
    for (let step = 0; step < deltasBySeed[seedIndex].length; step += 1) {
      const delta = deltasBySeed[seedIndex][step];
      await page.mouse.wheel(0, delta);
      const baseline = await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        return window.readingFixture.anchor();
      });
      await page.evaluate(() => {
        setTimeout(() => window.readingFixture.prepend(), 32);
        setTimeout(() => {
          window.readingFixture.append();
          window.readingFixture.growTail();
        }, 56);
      });
      const samples = await frames(page, 12);
      steps.push({ step, delta, baseline, samples });
      const screenshot = await page.locator('.timeline-message-list').screenshot();
      await testInfo.attach(`reading-fuzz-${seed}-${step}.png`, { body: screenshot, contentType: 'image/png' });
      for (const frame of samples) {
        if (frame.id !== baseline.id || Math.abs(frame.offset - baseline.offset) > 1) {
          violations.push({ kind: 'semantic-drift', seed, step, delta, baseline, frame });
        }
      }
    }
    const probe = await page.evaluate(() => window.__readingVisualProbe.stop());
    const readingTrace = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.snapshot());
    const visualFailures = probe.frames.filter((frame) => (
      frame.emptyViewport
      || frame.uncoveredTop
      || frame.uncoveredBottom
      || frame.rowErrorCount > 0
      || frame.visibility === 'hidden'
      || Number(frame.opacity) === 0
    ));
    if (visualFailures.length) violations.push({ kind: 'visible-coverage', seed, frames: visualFailures });
    const firstInput = readingTrace.entries.find((entry) => entry.event === 'reading.input-owner')?.sequence || 0;
    const lateIssuerWrites = readingTrace.entries.filter((entry) => (
      entry.sequence > firstInput && entry.event === 'reading.issuer-write'
    ));
    if (lateIssuerWrites.length) violations.push({ kind: 'application-write-after-input', seed, lateIssuerWrites });
    await testInfo.attach(`reading-fuzz-${seed}.json`, {
      body: Buffer.from(JSON.stringify({ seed, steps, probe, readingTrace }, null, 2)),
      contentType: 'application/json',
    });
  }
  expect(violations, JSON.stringify(violations)).toEqual([]);
});

test('C1 return-bottom or follow hands off to immediate upward input before late tail resize', async ({ page }) => {
  await openFixture(page);
  expect(await page.locator('.timeline-message-list').evaluate((node) => getComputedStyle(node).scrollBehavior)).toBe('auto');
  await page.mouse.move(300, 260);
  await page.mouse.wheel(0, -1800);
  await page.waitForTimeout(120);
  await page.evaluate(() => window.readingFixture.append());
  await page.evaluate(() => window.readingFixture.returnToBottom());
  const afterIntent = await page.evaluate(() => ({ state: window.readingFixture.state(), gap: document.querySelector('.timeline-message-list').scrollHeight - document.querySelector('.timeline-message-list').clientHeight - document.querySelector('.timeline-message-list').scrollTop }));
  await page.mouse.wheel(0, -420);
  const afterWheel = await page.evaluate(() => ({ state: window.readingFixture.state(), gap: document.querySelector('.timeline-message-list').scrollHeight - document.querySelector('.timeline-message-list').clientHeight - document.querySelector('.timeline-message-list').scrollTop }));
  await page.evaluate(() => window.readingFixture.growTail());
  await page.waitForTimeout(180);
  const afterGrow = await page.evaluate(() => ({ state: window.readingFixture.state(), gap: document.querySelector('.timeline-message-list').scrollHeight - document.querySelector('.timeline-message-list').clientHeight - document.querySelector('.timeline-message-list').scrollTop }));
  expect(await page.evaluate(() => window.readingFixture.state().mode)).toBe('browsing');
  const gap = await page.evaluate(() => {
    const node = document.querySelector('.timeline-message-list');
    return node.scrollHeight - node.clientHeight - node.scrollTop;
  });
  expect(gap, JSON.stringify({ afterIntent, afterWheel, afterGrow })).toBeGreaterThan(40);
  const before = await page.evaluate(() => window.readingFixture.anchor());
  for (const frame of await frames(page, 8)) {
    expect(frame.id).toBe(before.id);
    expect(Math.abs(frame.offset - before.offset)).toBeLessThanOrEqual(1);
  }
});

test('following append work cannot reclaim the viewport after immediate upward input and resize', async ({ page }, testInfo) => {
  await openFixture(page);
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.enable({ case: 'append-immediate-upward-resize' }));
  await page.evaluate(() => {
    window.readingFixture.append();
    window.readingFixture.beginFrameTrace(28);
  });
  await page.mouse.move(300, 260);
  await page.mouse.wheel(0, -420);
  await page.evaluate(() => window.readingFixture.growTail());
  await page.waitForTimeout(500);
  const trace = await page.evaluate(() => window.readingFixture.frameTrace());
  const readingTrace = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.snapshot());
  const tracePath = testInfo.outputPath('append-immediate-upward-resize.json');
  await writeFile(tracePath, JSON.stringify({ trace, readingTrace }, null, 2));
  await testInfo.attach('append-immediate-upward-resize.json', {
    path: tracePath,
    contentType: 'application/json',
  });
  expectBrowsingTakeover(trace);
});

test('P1 tail downward wheel with no movement keeps following and the next append reachable', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => window.readingFixture.returnToBottom());
  await expect.poll(() => page.locator('.timeline-message-list').evaluate(
    (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
  )).toBeLessThanOrEqual(1);
  const before = await page.evaluate(() => ({
    session: window.readingFixture.state(),
    top: document.querySelector('.timeline-message-list').scrollTop,
  }));
  await page.mouse.move(300, 540);
  await page.mouse.wheel(0, 560);
  await page.waitForTimeout(80);
  const afterInput = await page.evaluate(() => ({
    session: window.readingFixture.state(),
    top: document.querySelector('.timeline-message-list').scrollTop,
  }));
  expect(afterInput.top).toBe(before.top);
  expect(afterInput.session.mode).toBe('following');
  expect(afterInput.session.inputEpoch).toBe(before.session.inputEpoch);

  await page.evaluate(() => window.readingFixture.append());
  await expect.poll(() => page.locator('.timeline-message-list').evaluate(
    (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
  )).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => window.readingFixture.state().mode)).toBe('following');
});

test('P1 native content selection autoscroll reaching the tail remains browsing', async ({ page }) => {
  await openFixture(page);
  await page.mouse.move(300, 280);
  await page.mouse.wheel(0, -720);
  await expect.poll(() => page.evaluate(() => window.readingFixture.state().mode)).toBe('browsing');
  const points = await page.evaluate(() => {
    const viewport = document.querySelector('.timeline-message-list').getBoundingClientRect();
    const blocks = [...document.querySelectorAll('[data-reading-block-id]')]
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.bottom > viewport.top + 16 && rect.top < viewport.bottom - 16;
      });
    const first = blocks[0]?.getBoundingClientRect();
    return first ? {
      start: { x: first.left + 12, y: Math.max(viewport.top + 20, first.top + 8) },
      outside: { x: first.left + 180, y: viewport.bottom + 48 },
    } : null;
  });
  expect(points).toBeTruthy();
  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  for (let step = 0; step < 24; step += 1) {
    await page.mouse.move(points.outside.x, points.outside.y, { steps: 2 });
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  const atTail = await page.evaluate(() => {
    const node = document.querySelector('.timeline-message-list');
    return {
      selection: getSelection().toString(),
      gap: node.scrollHeight - node.clientHeight - node.scrollTop,
      session: window.readingFixture.state(),
    };
  });
  expect(atTail.selection.length, JSON.stringify(atTail)).toBeGreaterThan(20);
  expect(atTail.gap, JSON.stringify(atTail)).toBeLessThanOrEqual(24);
  expect(atTail.session.mode).toBe('browsing');

  await page.evaluate(() => window.readingFixture.append());
  await page.waitForTimeout(120);
  const afterAppend = await page.evaluate(() => {
    const node = document.querySelector('.timeline-message-list');
    return {
      gap: node.scrollHeight - node.clientHeight - node.scrollTop,
      mode: window.readingFixture.state().mode,
      selection: getSelection().toString(),
    };
  });
  expect(afterAppend.mode).toBe('browsing');
  expect(afterAppend.gap, JSON.stringify(afterAppend)).toBeGreaterThan(24);
  expect(afterAppend.selection.length).toBeGreaterThan(20);
});

test('follow policy is owned by ReadingSession intent rather than transient tail geometry', async ({ page }) => {
  await openFixture(page);
  const viewport = page.locator('.timeline-message-list');

  // A layout-origin gap does not revoke following. The literal `auto` prop
  // lets Virtuoso consume the next append even though geometry is briefly no
  // longer at the tail.
  await viewport.evaluate((node) => {
    node.scrollTop -= 160;
    node.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => viewport.evaluate(
    (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
  )).toBeGreaterThan(40);
  expect(await page.evaluate(() => window.readingFixture.state().mode)).toBe('following');
  await page.evaluate(() => window.readingFixture.append());
  await expect.poll(() => viewport.evaluate(
    (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
  )).toBeLessThanOrEqual(1);

  // Conversely, clamping a browsing viewport to the geometric tail must not
  // turn literal `false` back into follow authorization.
  await page.mouse.move(300, 260);
  await page.mouse.wheel(0, -900);
  await expect.poll(() => page.evaluate(() => window.readingFixture.state().mode)).toBe('browsing');
  await page.evaluate(() => window.readingFixture.expandViewportToClamp());
  await expect.poll(() => viewport.evaluate(
    (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
  )).toBeLessThanOrEqual(24);
  expect(await page.evaluate(() => window.readingFixture.state().mode)).toBe('browsing');
  await page.evaluate(() => window.readingFixture.append());
  await expect.poll(() => viewport.evaluate(
    (node) => node.scrollHeight - node.clientHeight - node.scrollTop,
  )).toBeGreaterThan(24);
  expect(await page.evaluate(() => window.readingFixture.state().mode)).toBe('browsing');
});

test('C1 no-append control: a tail resize cannot reclaim after immediate upward input', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => window.readingFixture.beginFrameTrace(28));
  await page.mouse.move(300, 260);
  await page.mouse.wheel(0, -420);
  await page.evaluate(() => window.readingFixture.growTail());
  await page.waitForTimeout(500);
  expectBrowsingTakeover(await page.evaluate(() => window.readingFixture.frameTrace()));
});

test('C1 no-resize control: pending append cannot reclaim after immediate upward input', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => {
    window.readingFixture.append();
    window.readingFixture.beginFrameTrace(28);
  });
  await page.mouse.move(300, 260);
  await page.mouse.wheel(0, -420);
  await page.waitForTimeout(500);
  expectBrowsingTakeover(await page.evaluate(() => window.readingFixture.frameTrace()));
});

test('C2/C4 keeps a live DOM selection while the visible content is stable', async ({ page }) => {
  await openFixture(page);
  await page.mouse.move(300, 260);
  await page.mouse.wheel(0, -1200);
  await page.waitForTimeout(100);
  const selected = await page.evaluate(() => window.readingFixture.selectAcrossVisibleRows());
  expect(selected.length).toBeGreaterThan(20);
  await page.evaluate(() => window.readingFixture.append());
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => getSelection().toString())).toBe(selected);
});

test('nested code scrolling never takes over the main reading intent', async ({ page }) => {
  await openFixture(page);
  expect(await page.evaluate(() => window.readingFixture.installNestedScroller())).toBe(true);
  // Installing the nested region is itself a real content resize. Let
  // Virtuoso commit that row measurement and the current following policy
  // settle before attributing any later main-scroller motion to the wheel.
  // Content-resize following has separate coverage; this sample isolates
  // which scroll container owns the input.
  await expect.poll(() => page.evaluate(() => window.readingFixture.nestedLayout()))
    .toMatchObject({ gap: 0 });
  await expect.poll(async () => {
    const layout = await page.evaluate(() => window.readingFixture.nestedLayout());
    return layout.knownSize > layout.knownSizeBefore;
  }).toBe(true);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const before = await page.evaluate(() => ({
    inputEpoch: window.readingFixture.state().inputEpoch,
    mode: window.readingFixture.state().mode,
    mainTop: document.querySelector('.timeline-message-list').scrollTop,
    nestedTop: document.querySelector('.fixture-nested-scroll').scrollTop,
  }));
  await page.locator('.fixture-nested-scroll').hover();
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(80);
  const after = await page.evaluate(() => ({
    inputEpoch: window.readingFixture.state().inputEpoch,
    mode: window.readingFixture.state().mode,
    mainTop: document.querySelector('.timeline-message-list').scrollTop,
    nestedTop: document.querySelector('.fixture-nested-scroll').scrollTop,
  }));
  expect(after.nestedTop).toBeGreaterThan(before.nestedTop);
  expect(after.mainTop).toBe(before.mainTop);
  expect(after.inputEpoch).toBe(before.inputEpoch);
  expect(after.mode).toBe('following');
});

test('nested input stays with the inner scroller while the containing row grows', async ({ page }) => {
  await openFixture(page);
  expect(await page.evaluate(() => window.readingFixture.installNestedScroller())).toBe(true);
  await expect.poll(async () => {
    const layout = await page.evaluate(() => window.readingFixture.nestedLayout());
    return layout.knownSize > layout.knownSizeBefore;
  }).toBe(true);
  const before = await page.evaluate(() => ({
    inputEpoch: window.readingFixture.state().inputEpoch,
    nestedTop: document.querySelector('.fixture-nested-scroll').scrollTop,
  }));
  await page.locator('.fixture-nested-scroll').hover();
  expect(await page.evaluate(() => window.readingFixture.growNestedHost())).toBe(true);
  await page.mouse.wheel(0, 120);
  const frames = await page.evaluate(async () => {
    const values = [];
    for (let index = 0; index < 4; index += 1) {
      await new Promise(requestAnimationFrame);
      const main = document.querySelector('.timeline-message-list');
      values.push({
        mode: window.readingFixture.state().mode,
        inputEpoch: window.readingFixture.state().inputEpoch,
        nestedTop: document.querySelector('.fixture-nested-scroll').scrollTop,
        mainTop: main.scrollTop,
        gap: main.scrollHeight - main.clientHeight - main.scrollTop,
      });
    }
    return values;
  });
  expect(frames.some((frame) => frame.nestedTop > before.nestedTop), JSON.stringify(frames)).toBe(true);
  expect(frames.every((frame) => frame.inputEpoch === before.inputEpoch), JSON.stringify(frames)).toBe(true);
  expect(frames.every((frame) => frame.mode === 'following'), JSON.stringify(frames)).toBe(true);
  expect(frames.at(-1).gap, JSON.stringify(frames)).toBeLessThanOrEqual(1);
});

test('continuous upward input keeps fresh reading evidence while live rows and measurements change', async ({ page }) => {
  await openFixture(page);
  await page.mouse.move(300, 260);
  await page.mouse.wheel(0, -1100);
  await page.waitForTimeout(80);
  const seen = [];
  for (let step = 0; step < 5; step += 1) {
    await page.evaluate((grow) => {
      window.readingFixture.append();
      if (grow) window.readingFixture.growTail();
    }, step % 2 === 0);
    await page.mouse.wheel(0, -260);
    for (const frame of await readingFrames(page, 3)) {
      expect(frame.mode).toBe('browsing');
      expect(frame.gap).toBeGreaterThan(40);
    }
    seen.push(await page.evaluate(() => ({
      anchor: window.readingFixture.anchor().id,
      bookmark: window.readingFixture.state().bookmark?.messageID || '',
      inputEpoch: window.readingFixture.state().inputEpoch,
    })));
  }
  expect(new Set(seen.map((entry) => entry.anchor)).size, JSON.stringify(seen)).toBeGreaterThan(1);
  expect(seen.at(-1).bookmark, JSON.stringify(seen)).toBe(seen.at(-1).anchor);
  expect(seen.at(-1).inputEpoch).toBeGreaterThan(seen[0].inputEpoch);
});

test('layout clamping cannot grant following; the synthetic pointer model can hand off at tail', async ({ page }) => {
  await openFixture(page);
  await page.mouse.move(300, 260);
  await page.mouse.wheel(0, -900);
  await page.mouse.wheel(0, 260);
  await page.waitForTimeout(80);
  expect(await page.evaluate(() => window.readingFixture.state().mode)).toBe('browsing');

  await page.evaluate(() => window.readingFixture.expandViewportToClamp());
  await page.waitForTimeout(160);
  const clamped = await page.evaluate(() => {
    const node = document.querySelector('.timeline-message-list');
    return {
      gap: node.scrollHeight - node.clientHeight - node.scrollTop,
      mode: window.readingFixture.state().mode,
    };
  });
  expect(clamped.gap).toBeLessThanOrEqual(24);
  expect(clamped.mode).toBe('browsing');

  await page.mouse.wheel(0, -480);
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => window.readingFixture.state().mode)).toBe('browsing');
  await page.evaluate(() => window.readingFixture.dragScrollbarToBottom());
  await page.waitForTimeout(80);
  expect(await page.evaluate(() => window.readingFixture.state().mode)).toBe('following');
});

test('a native Chromium scrollbar drag to tail resumes following when a classic gutter exists', async ({ page }) => {
  test.skip(process.env.ATOLL_NATIVE_SCROLLBAR_HEADFUL !== '1', 'Requires the isolated headful Chromium/Xvfb classic-scrollbar run.');
  await openFixture(page);
  await page.mouse.move(300, 260);
  await page.mouse.wheel(0, -2400);
  await page.waitForTimeout(100);
  const viewport = page.locator('.timeline-message-list');
  const box = await viewport.boundingBox();
  const metrics = await viewport.evaluate((node) => ({
    gutter: node.offsetWidth - node.clientWidth,
    clientWidth: node.clientWidth,
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
    scrollTop: node.scrollTop,
  }));
  test.skip(!box || metrics.gutter < 2, 'This browser exposes only overlay scrollbars; native thumb dragging is unavailable.');
  const maximum = metrics.scrollHeight - metrics.clientHeight;
  // Linux Chrome keeps a roughly 40px minimum grab target for the classic
  // native thumb; the proportional size would be only ~6px in this fixture.
  const thumbHeight = Math.max(40, metrics.clientHeight * metrics.clientHeight / metrics.scrollHeight);
  const track = metrics.clientHeight - thumbHeight;
  const thumbY = box.y + (metrics.scrollTop / maximum) * track + thumbHeight / 2;
  const scrollbarX = box.x + metrics.clientWidth + 2;
  await page.mouse.move(scrollbarX, thumbY);
  await page.mouse.down();
  await page.mouse.move(scrollbarX, box.y + box.height - 3, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  const after = await viewport.evaluate((node) => ({
    gap: node.scrollHeight - node.clientHeight - node.scrollTop,
    mode: window.readingFixture.state().mode,
  }));
  expect(after.gap, JSON.stringify({ box, metrics, scrollbarX, thumbY, after })).toBeLessThanOrEqual(24);
  expect(after.mode).toBe('following');
});
