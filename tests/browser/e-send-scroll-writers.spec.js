import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// Agent E spec. Two questions, one instrument:
//   1. After a send, does the current reading owner settle the timeline at the
//      physical tail, and is every visible move backed by a writer?
//   2. In browsing mode, does the send hand off to the current following owner?
//
// The instrument is deliberately not the production trace. It patches the DOM
// geometry setters themselves (scrollTo / scrollBy / scrollTop / scrollIntoView)
// before the app boots, so every write — production issuer, virtualizer, browser
// library, anything — is recorded with its own call stack. The production
// reading trace is captured alongside it, but the stack is the evidence.

const OUT = process.env.ATOLL_E_OUT || '/tmp/E-20260918-out';

async function dump(name, value) {
  const path = resolve(OUT, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
  return path;
}

async function installWriteInterceptor(page) {
  await page.addInitScript(() => {
    const writes = [];
    let frame = 0;
    const tick = () => { frame += 1; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);

    const describe = (node) => {
      if (!node || node.nodeType !== 1) return String(node);
      return `${node.tagName.toLowerCase()}${node.className ? `.${String(node.className).split(/\s+/).filter(Boolean).join('.')}` : ''}`;
    };
    const record = (kind, node, detail) => {
      // Only the timeline scroller and its ancestors/descendants matter; record
      // everything but tag it, so an unexpected writer is never filtered away.
      const stack = String(new Error('write').stack || '').split('\n').slice(2, 18).join('\n');
      writes.push({
        index: writes.length,
        frame,
        at: performance.now(),
        kind,
        node: describe(node),
        isTimelineList: Boolean(node?.classList?.contains?.('timeline-message-list')),
        scrollTopBefore: kind === 'scrollTop-set' ? detail.before : Number(node?.scrollTop || 0),
        detail,
        stack,
      });
    };

    const scrollToOriginal = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function patchedScrollTo(...args) {
      const options = typeof args[0] === 'object' && args[0] !== null ? args[0] : { left: args[0], top: args[1] };
      record('scrollTo', this, {
        top: Number(options?.top ?? NaN),
        behavior: options?.behavior || '',
        scrollHeight: Number(this.scrollHeight || 0),
        clientHeight: Number(this.clientHeight || 0),
        before: Number(this.scrollTop || 0),
      });
      return scrollToOriginal.apply(this, args);
    };

    const scrollByOriginal = Element.prototype.scrollBy;
    Element.prototype.scrollBy = function patchedScrollBy(...args) {
      const options = typeof args[0] === 'object' && args[0] !== null ? args[0] : { left: args[0], top: args[1] };
      record('scrollBy', this, { top: Number(options?.top ?? NaN), before: Number(this.scrollTop || 0) });
      return scrollByOriginal.apply(this, args);
    };

    const intoViewOriginal = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function patchedScrollIntoView(...args) {
      record('scrollIntoView', this, { arg: JSON.stringify(args[0] ?? null) });
      return intoViewOriginal.apply(this, args);
    };

    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() { return descriptor.get.call(this); },
      set(value) {
        const before = descriptor.get.call(this);
        record('scrollTop-set', this, {
          top: Number(value),
          before: Number(before || 0),
          scrollHeight: Number(this.scrollHeight || 0),
          clientHeight: Number(this.clientHeight || 0),
        });
        return descriptor.set.call(this, value);
      },
    });

    window.__eWrites = {
      all: () => writes,
      timeline: () => writes.filter((entry) => entry.isTimelineList),
      since: (index) => writes.slice(index),
      count: () => writes.length,
      frame: () => frame,
    };
  });
}

async function paintSnapshot(page, targetMarker = '') {
  return page.evaluate((targetMarker) => {
    const root = document.querySelector('.timeline-message-list');
    const viewport = root?.getBoundingClientRect?.() || null;
    const rows = [...(root?.querySelectorAll('[data-presentation-row-id]') || [])];
    const target = targetMarker
      ? rows.find((node) => String(node.textContent || '').includes(targetMarker)) || null
      : null;
    const targetRect = target?.getBoundingClientRect?.() || null;
    const scrollTop = Number(root?.scrollTop || 0);
    const scrollHeight = Number(root?.scrollHeight || 0);
    const clientHeight = Number(root?.clientHeight || 0);
    return {
      at: performance.now(),
      mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
      scrollTop,
      scrollHeight,
      clientHeight,
      gap: scrollHeight - clientHeight - scrollTop,
      jumpText: document.querySelector('.timeline-jump-latest')?.textContent || '',
      mountedRowIDs: rows.map((node) => node.getAttribute('data-presentation-row-id') || ''),
      target: target ? {
        rowID: target.getAttribute('data-presentation-row-id') || '',
        painted: Boolean(target.getClientRects().length),
        top: targetRect?.top ?? null,
        bottom: targetRect?.bottom ?? null,
        intersectsViewport: Boolean(targetRect && viewport
          && targetRect.bottom > viewport.top + 0.5
          && targetRect.top < viewport.bottom - 0.5),
      } : null,
    };
  }, targetMarker);
}

async function startFrameProbe(page, targetMarker = '') {
  await page.evaluate((targetMarker) => {
    const frames = [];
    let running = true;
    const sample = () => {
      if (!running) return;
      const root = document.querySelector('.timeline-message-list');
      const reading = window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.() || { entries: [] };
      const viewport = root?.getBoundingClientRect?.() || null;
      const rows = [...(root?.querySelectorAll('[data-presentation-row-id]') || [])];
      const target = targetMarker
        ? rows.find((node) => String(node.textContent || '').includes(targetMarker)) || null
        : null;
      const targetRect = target?.getBoundingClientRect?.() || null;
      frames.push({
        frame: frames.length,
        at: performance.now(),
        mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
        scrollTop: Number(root?.scrollTop || 0),
        scrollHeight: Number(root?.scrollHeight || 0),
        clientHeight: Number(root?.clientHeight || 0),
        gap: Number((root?.scrollHeight || 0) - (root?.clientHeight || 0) - (root?.scrollTop || 0)),
        rowCount: root?.querySelectorAll('[data-presentation-row-id]').length || 0,
        mountedRowIDs: rows.map((node) => node.getAttribute('data-presentation-row-id') || ''),
        jumpText: document.querySelector('.timeline-jump-latest')?.textContent || '',
        target: target ? {
          rowID: target.getAttribute('data-presentation-row-id') || '',
          painted: Boolean(target.getClientRects().length),
          top: targetRect?.top ?? null,
          bottom: targetRect?.bottom ?? null,
          intersectsViewport: Boolean(targetRect && viewport
            && targetRect.bottom > viewport.top + 0.5
            && targetRect.top < viewport.bottom - 0.5),
        } : null,
        waitingItems: document.querySelectorAll('.agent-wait-item').length,
        writeCount: window.__eWrites?.count?.() || 0,
        readingTail: reading.entries.slice(-6).map((entry) => ({
          sequence: entry.sequence,
          event: entry.event,
          source: entry.detail?.source,
          reason: entry.detail?.reason,
          intentID: entry.detail?.intentID,
        })),
        intents: reading.entries.filter((entry) => entry.event === 'reading.bottom-intent').length,
        issuerWrites: reading.entries.filter((entry) => entry.event === 'reading.issuer-write').length,
        issuerRejects: reading.entries.filter((entry) => entry.event === 'reading.issuer-reject').length,
      });
      if (frames.length < 300) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    window.__eFrameProbe = { stop() { running = false; return frames; } };
  }, targetMarker);
}

// A displacement is a maximal run of consecutive frames whose scrollTop keeps
// changing. Two writes in the same frame are one displacement on screen; a
// write two frames later that moves the list again is a second displacement.
function displacements(frames, tolerance = 2) {
  const runs = [];
  let current = null;
  for (let index = 1; index < frames.length; index += 1) {
    const delta = frames[index].scrollTop - frames[index - 1].scrollTop;
    if (Math.abs(delta) > tolerance) {
      if (current) {
        current.to = frames[index].scrollTop;
        current.endFrame = index;
        current.delta = current.to - current.from;
      } else {
        current = {
          startFrame: index - 1,
          endFrame: index,
          from: frames[index - 1].scrollTop,
          to: frames[index].scrollTop,
          delta,
        };
        runs.push(current);
      }
    } else {
      current = null;
    }
  }
  return runs;
}

async function reset(request, seed, scenario) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
  // Rows are virtualized: the first installed row may sit above the viewport.
  // Readiness is "the tail row is painted", not "row zero is visible".
  await expect(page.locator('.timeline-message-list [data-presentation-row-id]').last()).toBeVisible();
}

async function chooseSteward(page) {
  const choose = page.getByRole('button', { name: '选择 Agent' });
  await expect(choose).toBeVisible();
  await choose.click();
  await page.getByRole('menu', { name: '选择目标 Agent' })
    .getByRole('menuitem', { name: 'steward' }).click();
}

async function overflowGeometry(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.timeline-message-list');
    return {
      scrollTop: Number(root?.scrollTop || 0),
      scrollHeight: Number(root?.scrollHeight || 0),
      clientHeight: Number(root?.clientHeight || 0),
      overflow: Number(root?.scrollHeight || 0) - Number(root?.clientHeight || 0),
    };
  });
}

test.describe('E send scroll writers', () => {
  test.beforeEach(async ({ page }) => {
    await installWriteInterceptor(page);
    await page.setViewportSize({ width: 1120, height: 620 });
  });

  test('following send settles the list at the tail with recorded writes', async ({ page, request }, testInfo) => {
    await reset(request, 0xe0_09_18, 'long-running-history');
    await login(page);
    await chooseSteward(page);

    const before = await overflowGeometry(page);
    expect(before.overflow, JSON.stringify(before)).toBeGreaterThan(200);

    await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.enable({ case: 'E-following-send' }));
    const editor = page.getByTestId('composer-input');
    await editor.fill('E-20260918 following send probe');
    await expect(page.getByRole('button', { name: /发送/ })).toBeEnabled();

    const writeBaseline = await page.evaluate(() => window.__eWrites.count());
    await startFrameProbe(page);
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
    await page.getByRole('button', { name: /发送/ }).click();
    await expect(page.getByText('E-20260918 following send probe', { exact: true })).toBeVisible();
    await page.waitForTimeout(900);

    const frames = await page.evaluate(() => window.__eFrameProbe.stop());
    const writes = await page.evaluate((from) => window.__eWrites.since(from), writeBaseline);
    const timelineWrites = writes.filter((entry) => entry.isTimelineList);
    const runs = displacements(frames);

    const report = {
      geometryBefore: before,
      frameCount: frames.length,
      displacements: runs,
      timelineWrites: timelineWrites.map((entry) => ({
        index: entry.index,
        frame: entry.frame,
        kind: entry.kind,
        detail: entry.detail,
        stack: entry.stack,
      })),
      otherWrites: writes.filter((entry) => !entry.isTimelineList)
        .map((entry) => ({ kind: entry.kind, node: entry.node, detail: entry.detail, stack: entry.stack })),
      frames,
    };
    await testInfo.attach('following-send-frames.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    await dump('following-send-frames.json', report);

    expect(frames.at(-1).gap, JSON.stringify({ last: frames.at(-1) })).toBeLessThanOrEqual(24);
    const movement = [];
    for (let index = 1; index < frames.length; index += 1) {
      const previous = frames[index - 1];
      const frame = frames[index];
      if (Math.abs(frame.scrollTop - previous.scrollTop) > 2) movement.push({ frame, previous });
    }
    expect(runs.length, JSON.stringify({ runs, writes: report.timelineWrites }, null, 2)).toBeGreaterThanOrEqual(1);
    expect(
      movement.filter(({ frame, previous }) => frame.writeCount <= previous.writeCount),
      JSON.stringify({ movement, runs, writes: report.timelineWrites }, null, 2),
    ).toEqual([]);
  });

  test('browsing send hands off to the following owner with recorded writes', async ({ page, request }, testInfo) => {
    await reset(request, 0xe0_09_19, 'long-running-history');
    await login(page);
    await chooseSteward(page);

    const geometry = await overflowGeometry(page);
    expect(geometry.overflow, JSON.stringify(geometry)).toBeGreaterThan(200);

    // Leave the tail by user displacement, the only way to own browsing mode.
    await page.locator('.timeline-message-list').hover();
    await page.mouse.wheel(0, -900);
    await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');

    await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.enable({ case: 'E-browsing-send' }));
    const marker = 'E-20260918 browsing send probe';
    const beforePaint = await paintSnapshot(page);
    const editor = page.getByTestId('composer-input');
    await editor.fill(marker);
    await expect(page.getByRole('button', { name: /发送/ })).toBeEnabled();

    const writeBaseline = await page.evaluate(() => window.__eWrites.count());
    await startFrameProbe(page, marker);
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
    await page.getByRole('button', { name: /发送/ }).click();
    const paintedRow = page.locator('[data-presentation-row-id]').filter({ hasText: marker }).first();
    await expect(paintedRow).toHaveCount(1);
    await page.waitForTimeout(1_200);

    const frames = await page.evaluate(() => window.__eFrameProbe.stop());
    const afterPaint = await paintSnapshot(page, marker);
    const writes = await page.evaluate((from) => window.__eWrites.since(from), writeBaseline);
    const trace = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.snapshot());
    const timelineWrites = writes.filter((entry) => entry.isTimelineList);
    const runs = displacements(frames);
    // The public reading owner now records the send handoff in geometry rather
    // than exposing an implementation-specific diagnostic event for each
    // intent. Keep the trace in the report for evidence, but do not gate on
    // retired event names.
    const intents = trace.entries.filter((entry) => entry.event === 'reading.bottom-intent');
    const issuerWrites = trace.entries.filter((entry) => entry.event === 'reading.issuer-write');
    const issuerRejects = trace.entries.filter((entry) => entry.event === 'reading.issuer-reject');

    const report = {
      geometry,
      oracle: {
        contract: 'explicit-composer-send-from-browsing',
        authorization: 'one composerSendStarted/requestBottom; composerAccepted binds returned target IDs only',
        beforePaint,
        afterPaint,
        targetPainted: Boolean(afterPaint.target?.painted),
        targetAtPhysicalTail: Boolean(afterPaint.target?.intersectsViewport && afterPaint.gap <= 24),
        continuousWriterRunCount: runs.length,
      },
      frameCount: frames.length,
      displacements: runs,
      intents: intents.map((entry) => ({ sequence: entry.sequence, detail: entry.detail })),
      issuerWrites: issuerWrites.map((entry) => ({ sequence: entry.sequence, detail: entry.detail })),
      issuerRejects: issuerRejects.map((entry) => ({ sequence: entry.sequence, source: entry.detail?.source, reason: entry.detail?.reason, detail: entry.detail })),
      timelineWrites: timelineWrites.map((entry) => ({ index: entry.index, frame: entry.frame, kind: entry.kind, detail: entry.detail, stack: entry.stack })),
      frames,
    };
    await testInfo.attach('browsing-send-frames.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    await dump('browsing-send-frames.json', report);

    expect(frames.at(-1).mode, JSON.stringify(frames.at(-1))).toBe('following');
    expect(timelineWrites.length, JSON.stringify({ intents, runs, timelineWrites }, null, 2)).toBeGreaterThanOrEqual(1);
    expect(runs.length, JSON.stringify(runs)).toBeGreaterThanOrEqual(1);
    expect(frames.at(-1).gap, JSON.stringify(frames.at(-1))).toBeLessThanOrEqual(24);
    expect(afterPaint.target?.rowID, JSON.stringify(afterPaint)).toBeTruthy();
    expect(afterPaint.target?.painted, JSON.stringify(afterPaint)).toBe(true);
  });

  test('browsing passive append paints a jump without taking the reader to the tail', async ({ page, request }, testInfo) => {
    await reset(request, 0xe0_09_20, 'long-running-history');
    await login(page);
    const viewport = page.locator('.timeline-message-list');
    await viewport.hover();
    await page.mouse.wheel(0, -1_500);
    await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');

    const marker = 'E-20260920 passive append probe';
    const beforePaint = await paintSnapshot(page);
    const writeBaseline = await page.evaluate(() => window.__eWrites.count());
    await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.enable({ case: 'E-browsing-passive-append' }));
    await startFrameProbe(page, marker);
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
    const appended = await request.post(`${MOCK}/mock/control/action`, {
      data: { type: 'q_tail_append', channel_id: 'c0', ask: 'passive append oracle', text: marker },
    });
    expect(appended.ok()).toBe(true);
    const appendedBody = await appended.json();
    const appendedRow = page.locator(`[data-presentation-row-id="${appendedBody.request_id}"]`);
    await expect(appendedRow).toHaveCount(1);
    await expect(page.locator('.timeline-jump-latest')).toBeVisible();
    await page.waitForTimeout(1_000);

    const frames = await page.evaluate(() => window.__eFrameProbe.stop());
    const afterPaint = await paintSnapshot(page, marker);
    const writes = await page.evaluate((from) => window.__eWrites.since(from), writeBaseline);
    const trace = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.snapshot());
    const timelineWrites = writes.filter((entry) => entry.isTimelineList);
    const runs = displacements(frames);
    const report = {
      oracle: {
        contract: 'passive-nonself-append-while-browsing',
        authorization: 'no composerSendStarted/composerAccepted; no bottom intent',
        beforePaint,
        afterPaint,
        anchorScrollDelta: afterPaint.scrollTop - beforePaint.scrollTop,
        jumpVisible: Boolean(afterPaint.jumpText),
        targetPainted: Boolean(afterPaint.target?.painted),
      },
      appended: appendedBody,
      frameCount: frames.length,
      displacements: runs,
      timelineWrites: timelineWrites.map((entry) => ({ index: entry.index, frame: entry.frame, kind: entry.kind, detail: entry.detail, stack: entry.stack })),
      trace: trace.entries,
      frames,
    };
    await testInfo.attach('browsing-passive-append-frames.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    await dump('browsing-passive-append-frames.json', report);

    expect(afterPaint.mode, JSON.stringify(afterPaint)).toBe('browsing');
    expect(afterPaint.gap, JSON.stringify(afterPaint)).toBeGreaterThan(24);
    expect(afterPaint.jumpText, JSON.stringify(afterPaint)).toContain('条新动态');
    expect(afterPaint.target?.rowID, JSON.stringify(afterPaint)).toBe(appendedBody.request_id);
    expect(afterPaint.target?.painted, JSON.stringify(afterPaint)).toBe(true);
    expect(afterPaint.scrollTop, JSON.stringify({ beforePaint, afterPaint })).toBe(beforePaint.scrollTop);
    expect(frames.every((frame) => frame.mode === 'browsing'), JSON.stringify(frames)).toBe(true);
    expect(frames.every((frame) => frame.gap > 24), JSON.stringify(frames)).toBe(true);
    expect(runs, JSON.stringify({ runs, frames })).toEqual([]);
    expect(timelineWrites, JSON.stringify(timelineWrites)).toEqual([]);
  });
});
