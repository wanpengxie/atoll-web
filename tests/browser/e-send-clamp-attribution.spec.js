import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// Agent E. e-send-scroll-writers established the negative result: after a send
// there is exactly ONE JavaScript write on the timeline scroller (the adapter's
// single root.scrollTo), and the list still moves a second time — scrollTop
// 3229 -> 3130 with the write ledger unchanged. e-send-second-displacement
// narrowed the moment to a single React commit and showed no geometry read that
// explains it: scrollHeight, clientHeight and therefore maxScrollTop are the
// same before and after the move.
//
// Batch-resolution reads cannot settle that. This spec adds two things:
//
//   1. Task-level sampling. A MessageChannel ping-pong loop samples scrollTop
//      at every macrotask boundary, roughly an order of magnitude finer than
//      rAF, and records the write-ledger length at that instant. A move whose
//      sample carries no new write happened without a writer, in a known task.
//   2. Capability removal. The same send runs three times, each with exactly
//      one suspected native mechanism neutralised from the page side (never
//      from source): reduced motion, which zeroes the input-resize transition
//      and its temporary tail spacer, and preventScroll focus, which removes
//      the browser's own focus scrolling. Whichever removal takes the second
//      move away names the mechanism.
//
// Nothing here waits on a timer for a state to become true; the timeouts are
// recording windows, and every assertion reads a recorded value.

const OUT = process.env.ATOLL_E_OUT || '/tmp/E-a35eea6d-out/clamp-attribution';

async function dump(name, value) {
  const path = resolve(OUT, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
  return path;
}

// Everything below runs before the app boots, so no app write escapes it.
async function installProbe(page, { preventFocusScroll = false } = {}) {
  await page.addInitScript(({ preventFocusScroll: noFocusScroll }) => {
    const writes = [];
    const describe = (node) => {
      if (!node || node.nodeType !== 1) return String(node);
      const classes = String(node.className || '');
      return `${node.tagName.toLowerCase()}${classes ? `.${classes.trim().split(/\s+/).join('.')}` : ''}`;
    };
    const stackOf = () => String(new Error('write').stack || '').split('\n').slice(2, 14).join('\n');
    const record = (kind, node, detail) => {
      writes.push({
        index: writes.length,
        at: performance.now(),
        kind,
        node: describe(node),
        isTimelineList: Boolean(node?.classList?.contains?.('timeline-message-list')),
        inTimelineList: Boolean(node?.closest?.('.timeline-message-list')),
        detail,
        stack: stackOf(),
      });
    };

    const scrollToOriginal = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function patchedScrollTo(...args) {
      const options = typeof args[0] === 'object' && args[0] !== null ? args[0] : { top: args[1] };
      record('scrollTo', this, { top: Number(options?.top ?? NaN), before: Number(this.scrollTop || 0) });
      return scrollToOriginal.apply(this, args);
    };
    // Element.prototype.scroll is a distinct entry point from scrollTo. No
    // shipped code uses it today; it is patched so that stays falsifiable.
    const scrollOriginal = Element.prototype.scroll;
    Element.prototype.scroll = function patchedScroll(...args) {
      const options = typeof args[0] === 'object' && args[0] !== null ? args[0] : { top: args[1] };
      record('scroll-method', this, { top: Number(options?.top ?? NaN), before: Number(this.scrollTop || 0) });
      return scrollOriginal.apply(this, args);
    };
    const scrollByOriginal = Element.prototype.scrollBy;
    Element.prototype.scrollBy = function patchedScrollBy(...args) {
      const options = typeof args[0] === 'object' && args[0] !== null ? args[0] : { top: args[1] };
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
        record('scrollTop-set', this, { top: Number(value), before: Number(descriptor.get.call(this) || 0) });
        return descriptor.set.call(this, value);
      },
    });
    // focus() scrolls ancestors natively, leaving no scroll write behind.
    const focusOriginal = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function patchedFocus(options) {
      record('focus', this, { preventScroll: Boolean(options?.preventScroll) || noFocusScroll });
      return focusOriginal.call(this, noFocusScroll ? { ...(options || {}), preventScroll: true } : options);
    };

    window.__eWrites = {
      all: () => writes,
      count: () => writes.length,
      since: (from) => writes.slice(from),
    };
  }, { preventFocusScroll });
}

// Sampling is armed around the send only, so the ledgers stay small enough to
// read by eye and the probe cannot shape the app's steady state.
async function armProbe(page) {
  await page.evaluate(() => {
    const root = document.querySelector('.timeline-message-list');
    const surface = document.querySelector('.conversation-surface');
    const inputSlot = document.querySelector('.conversation-input-slot');
    const carrier = () => root.querySelector('.timeline-input-resize-content');

    const taskSamples = [];
    const frames = [];
    const events = [];
    let stopped = false;
    let lastTop = Number(root.scrollTop || 0);
    let lastSampleWriteCount = window.__eWrites.count();
    let taskIndex = 0;

    const surfaceStyle = () => {
      const computed = getComputedStyle(surface);
      return {
        progressHeight: computed.getPropertyValue('--input-resize-progress-height').trim(),
        spacerFromHeight: computed.getPropertyValue('--input-resize-spacer-from-height').trim(),
        deltaHeight: computed.getPropertyValue('--input-resize-delta-height').trim(),
        inputResize: surface.getAttribute('data-input-resize-transition') || '',
        inputGrowth: surface.getAttribute('data-input-resize-growth') || '',
        sendClear: inputSlot?.getAttribute('data-send-clear-transition') || '',
        inputHeight: Number((inputSlot?.getBoundingClientRect().height || 0).toFixed(1)),
      };
    };
    const carrierState = () => {
      const node = carrier();
      if (!node) return { paddingTop: '', afterBlockSize: '', transform: '', height: 0 };
      return {
        paddingTop: node.style.paddingTop || '',
        afterBlockSize: getComputedStyle(node, '::after').blockSize,
        transform: getComputedStyle(node).transform,
        height: Number(node.getBoundingClientRect().height.toFixed(1)),
      };
    };

    // Task-boundary sampling. Only scrollTop is read here: it is the smallest
    // read that can observe the move, and a sample is only kept when the value
    // actually changed, so a run records its moves and nothing else.
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      if (stopped) return;
      taskIndex += 1;
      const top = Number(root.scrollTop || 0);
      if (Math.abs(top - lastTop) > 0.5) {
        taskSamples.push({
          task: taskIndex,
          at: performance.now(),
          from: lastTop,
          to: top,
          delta: top - lastTop,
          writeCountBefore: lastSampleWriteCount,
          writeCount: window.__eWrites.count(),
          lastWrite: window.__eWrites.all().at(-1) || null,
          scrollHeight: Number(root.scrollHeight || 0),
          clientHeight: Number(root.clientHeight || 0),
          carrier: carrierState(),
          surface: surfaceStyle(),
        });
        lastTop = top;
        lastSampleWriteCount = window.__eWrites.count();
      }
      if (taskSamples.length < 400 && taskIndex < 200_000) channel.port2.postMessage(0);
    };
    channel.port2.postMessage(0);

    const frame = () => {
      if (stopped) return;
      frames.push({
        frame: frames.length,
        at: performance.now(),
        mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
        scrollTop: Number(root.scrollTop || 0),
        scrollHeight: Number(root.scrollHeight || 0),
        clientHeight: Number(root.clientHeight || 0),
        gap: Number(root.scrollHeight || 0) - Number(root.clientHeight || 0) - Number(root.scrollTop || 0),
        rows: root.querySelectorAll('[data-presentation-row-id]').length,
        waiting: document.querySelectorAll('.agent-wait-item').length,
        writeCount: window.__eWrites.count(),
        carrier: carrierState(),
        surface: surfaceStyle(),
      });
      if (frames.length < 400) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);

    const note = (kind) => events.push({
      kind,
      at: performance.now(),
      scrollTop: Number(root.scrollTop || 0),
      writeCount: window.__eWrites.count(),
    });
    root.addEventListener('scroll', () => note('scroll'), { passive: true });
    surface.addEventListener('transitionstart', (event) => note(`transitionstart:${event.propertyName}`), true);
    surface.addEventListener('transitionend', (event) => note(`transitionend:${event.propertyName}`), true);

    window.__eProbe = {
      stop() {
        stopped = true;
        return { taskSamples, frames, events };
      },
    };
  });
}

// The move happens inside one task with no write in it, so it is the browser's
// own. The browser only changes scrollTop by itself when the scroller's maximum
// drops below it, and a maximum only changes at a layout. Layouts inside a task
// happen when someone reads geometry. So: patch the geometry readers, and after
// each original read — at which point layout is already clean, so this costs no
// extra layout and perturbs nothing — sample the scroller. The first read whose
// sample shows a lower scrollTop is the layout at which the browser clamped, and
// its own stack names who forced that layout.
async function installLayoutWitness(page) {
  await page.addInitScript(() => {
    const original = {
      scrollTop: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop').get,
      scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight').get,
      clientHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight').get,
      rect: Element.prototype.getBoundingClientRect,
    };
    const observations = [];
    const ring = [];
    let armed = false;
    let root = null;
    let carrier = null;
    let lastTop = 0;
    let reading = false;
    let reads = 0;

    // Layout is clean at this point, so this census costs nothing extra and
    // shows which box is short at the exact layout that clamped.
    const census = () => {
      const rows = {};
      for (const row of root.querySelectorAll('[data-presentation-row-id]')) {
        rows[row.dataset.presentationRowId] = Number(original.rect.call(row).height.toFixed(1));
      }
      // The current list owner may mount candidate rows in a preparing state
      // and measure them. Whether a preparing candidate is in flow decides
      // whether measuring it can change the scroller's scrollable height.
      const carrierChildren = carrier ? [...carrier.children].map((child) => {
        const rect = original.rect.call(child);
        const style = getComputedStyle(child);
        return {
          index: child.dataset.index ?? '',
          preparing: child.dataset.formalPreparing ?? '',
          knownSize: child.dataset.knownSize ?? '',
          height: Number(rect.height.toFixed(1)),
          top: Number(rect.top.toFixed(1)),
          position: style.position,
          display: style.display,
          rowID: child.querySelector?.('[data-presentation-row-id]')?.dataset.presentationRowId || '',
        };
      }) : [];
      const footer = root.querySelector('.timeline-waiting-obstruction');
      return {
        rows,
        rowCount: Object.keys(rows).length,
        rowTotal: Number(Object.values(rows).reduce((sum, value) => sum + value, 0).toFixed(1)),
        footer: footer ? Number(original.rect.call(footer).height.toFixed(1)) : null,
        carrier: carrier ? Number(original.rect.call(carrier).height.toFixed(1)) : null,
        carrierPaddingTop: carrier ? carrier.style.paddingTop : '',
        carrierPaddingBottom: carrier ? carrier.style.paddingBottom : '',
        carrierChildren,
        inFlowChildTotal: Number(carrierChildren
          .filter((child) => child.position === 'static' || child.position === 'relative')
          .reduce((sum, child) => sum + child.height, 0).toFixed(1)),
        preparingCount: carrierChildren.filter((child) => child.preparing).length,
      };
    };

    const sample = (label, node) => {
      if (!armed || reading || !root) return;
      reading = true;
      try {
        reads += 1;
        const error = new Error(label);
        ring.push({ label, node, error, at: performance.now(), index: reads });
        if (ring.length > 60) ring.shift();
        const top = original.scrollTop.call(root);
        if (Math.abs(top - lastTop) > 0.5) {
          observations.push({
            census: census(),
            at: performance.now(),
            readIndex: reads,
            from: lastTop,
            to: top,
            delta: top - lastTop,
            byLabel: label,
            byNode: node,
            byStack: String(error.stack || '').split('\n').slice(1, 12).join('\n'),
            scrollHeight: original.scrollHeight.call(root),
            clientHeight: original.clientHeight.call(root),
            carrierPaddingTop: carrier ? carrier.style.paddingTop : '',
            writeCount: window.__eWrites?.count?.() ?? -1,
            precedingReads: ring.slice(-12).map((entry) => ({
              label: entry.label,
              node: entry.node,
              at: entry.at,
              head: String(entry.error.stack || '').split('\n').slice(1, 5).join(' | '),
            })),
          });
          lastTop = top;
        }
      } finally {
        reading = false;
      }
    };
    const describe = (node) => {
      if (!node || node.nodeType !== 1) return String(node);
      const classes = String(node.className || '');
      return `${node.tagName.toLowerCase()}${classes ? `.${classes.trim().split(/\s+/)[0]}` : ''}`;
    };

    const patchGetter = (proto, name, getter) => {
      const descriptor = Object.getOwnPropertyDescriptor(proto, name);
      Object.defineProperty(proto, name, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get() {
          const value = getter.call(this);
          sample(name, describe(this));
          return value;
        },
      });
    };
    patchGetter(Element.prototype, 'scrollHeight', original.scrollHeight);
    patchGetter(Element.prototype, 'clientHeight', original.clientHeight);
    const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    patchGetter(HTMLElement.prototype, 'offsetHeight', offsetHeight.get);
    Element.prototype.getBoundingClientRect = function patchedRect(...args) {
      const value = original.rect.apply(this, args);
      sample('getBoundingClientRect', describe(this));
      return value;
    };

    window.__eWitness = {
      arm() {
        root = document.querySelector('.timeline-message-list');
        // The current list owner no longer exposes the retired input-resize
        // carrier. Keep the witness attached to the real scroller and treat
        // the optional carrier census as evidence when present.
        carrier = root?.querySelector('.timeline-input-resize-content') || null;
        lastTop = root ? original.scrollTop.call(root) : 0;
        armed = Boolean(root);
        // A probe that silently observes nothing turns a red run green. Report
        // whether it is actually attached and let the spec assert on it.
        return { armed, lastTop, reads, hasRoot: Boolean(root), hasCarrier: Boolean(carrier) };
      },
      stop() {
        armed = false;
        return { observations, reads, steady: root ? census() : null };
      },
    };
  });
}

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

async function reset(request, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'long-running-history', seed },
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

async function chooseSteward(page) {
  const choose = page.getByRole('button', { name: '选择 Agent' });
  await expect(choose).toBeVisible();
  await choose.click();
  await page.getByRole('menu', { name: '选择目标 Agent' })
    .getByRole('menuitem', { name: 'steward' }).click();
}

async function geometry(page) {
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

// One send, fully recorded. `label` names the capability-removal arm.
async function recordSend(page, request, { seed, label, text }) {
  await reset(request, seed);
  await login(page);
  await chooseSteward(page);

  const beforeFill = await geometry(page);
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.enable({ case: 'E-clamp-attribution' }));
  await page.getByTestId('composer-input').fill(text);
  await expect(page.getByRole('button', { name: /发送/ })).toBeEnabled();
  const afterFill = await geometry(page);

  await armProbe(page);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
  const writeBaseline = await page.evaluate(() => window.__eWrites.count());
  await page.getByRole('button', { name: /发送/ }).click();
  await expect(page.getByText(text, { exact: true })).toBeVisible();
  await page.waitForTimeout(1_200);

  const probe = await page.evaluate(() => window.__eProbe.stop());
  const writes = await page.evaluate((from) => window.__eWrites.since(from), writeBaseline);
  const trace = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.snapshot());

  return {
    label,
    beforeFill,
    afterFill,
    fillDisplacement: afterFill.scrollTop - beforeFill.scrollTop,
    displacements: displacements(probe.frames),
    // A move is unattributed when no write landed between the previous sample
    // and this one: the writer ledger is the same length on both sides.
    taskMoves: probe.taskSamples.map((sample) => ({
      ...sample,
      attributed: sample.lastWrite
        && sample.writeCount > sample.writeCountBefore
        && sample.lastWrite.inTimelineList,
    })),
    events: probe.events,
    timelineWrites: writes.filter((entry) => entry.inTimelineList || entry.isTimelineList),
    otherWrites: writes.filter((entry) => !entry.inTimelineList && !entry.isTimelineList)
      .map((entry) => ({ kind: entry.kind, node: entry.node, detail: entry.detail })),
    readingTail: trace.entries.slice(-60).map((entry) => ({
      sequence: entry.sequence,
      event: entry.event,
      source: entry.detail?.source,
      reason: entry.detail?.reason,
    })),
    frames: probe.frames,
    final: probe.frames.at(-1) || null,
  };
}

test.describe('E send clamp attribution', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1120, height: 620 });
  });

  test('following send leaves the list at the tail', async ({ page, request }, testInfo) => {
    await installProbe(page);
    const report = await recordSend(page, request, {
      seed: 0xe0_09_21,
      label: 'baseline',
      text: 'E-a35eea6d baseline send probe',
    });
    await dump('baseline.json', report);
    await testInfo.attach('baseline.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });

    const summary = {
      fillDisplacement: report.fillDisplacement,
      displacements: report.displacements,
      taskMoves: report.taskMoves.map((move) => ({
        delta: move.delta,
        writeCount: move.writeCount,
        attributed: move.attributed,
        scrollHeight: move.scrollHeight,
        clientHeight: move.clientHeight,
        carrier: move.carrier,
        surface: move.surface,
      })),
      timelineWrites: report.timelineWrites.map((entry) => ({ kind: entry.kind, detail: entry.detail })),
      final: report.final,
    };
    // The whole point: a send must leave the follower at the tail.
    expect(report.final.gap, JSON.stringify(summary, null, 2)).toBeLessThanOrEqual(24);
    // A send may cross more than one committed geometry revision (the input
    // overlay and the semantic row are separate current-owner commits). The
    // product contract is the settled physical tail; every visible move must
    // still have a corresponding current-owner write.
    expect(report.displacements.length, JSON.stringify(summary, null, 2)).toBeGreaterThanOrEqual(1);
    expect(
      report.taskMoves.filter((move) => move.delta && move.attributed === false),
      JSON.stringify(summary, null, 2),
    ).toEqual([]);
  });

  test('attribution: reduced motion still settles through the current reading owner', async ({ page, request }, testInfo) => {
    await installProbe(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const report = await recordSend(page, request, {
      seed: 0xe0_09_21,
      label: 'reduced-motion',
      text: 'E-a35eea6d reduced motion send probe',
    });
    await dump('reduced-motion.json', report);
    await testInfo.attach('reduced-motion.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    expect(report.final.gap, JSON.stringify({
      displacements: report.displacements,
      taskMoves: report.taskMoves.map((move) => ({ delta: move.delta, writeCount: move.writeCount, surface: move.surface })),
      final: report.final,
    }, null, 2)).toBeLessThanOrEqual(24);
  });

  test('attribution: the unwritten move has a layout and a forcer on record', async ({ page, request }, testInfo) => {
    await installProbe(page);
    await installLayoutWitness(page);
    await reset(request, 0xe0_09_21);
    await login(page);
    await chooseSteward(page);

    const text = 'E-a35eea6d layout witness send probe';
    await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.enable({ case: 'E-layout-witness' }));
    // Armed before the fill: typing already displaces the list, and that move
    // belongs to the same question as the one after the send.
    const armed = await page.evaluate(() => window.__eWitness.arm());
    expect(armed, JSON.stringify(armed)).toMatchObject({ armed: true });
    const writeBaseline = await page.evaluate(() => window.__eWrites.count());
    await page.getByTestId('composer-input').fill(text);
    await expect(page.getByRole('button', { name: /发送/ })).toBeEnabled();

    await page.getByRole('button', { name: /发送/ }).click();
    await expect(page.getByText(text, { exact: true })).toBeVisible();
    await page.waitForTimeout(1_200);

    const witness = await page.evaluate(() => window.__eWitness.stop());
    expect(witness.reads, 'the witness must have observed the app reading geometry').toBeGreaterThan(100);
    const writes = await page.evaluate((from) => window.__eWrites.since(from), writeBaseline);
    const report = {
      reads: witness.reads,
      steady: witness.steady,
      // Which box was short at the clamping layout, measured against the
      // settled list. This is the whole answer to "who shrank".
      shortBoxes: witness.observations.map((entry) => ({
        at: entry.at,
        delta: entry.delta,
        scrollHeight: entry.scrollHeight,
        rowTotalAtClamp: entry.census?.rowTotal,
        rowTotalSteady: witness.steady?.rowTotal,
        footerAtClamp: entry.census?.footer,
        footerSteady: witness.steady?.footer,
        carrierAtClamp: entry.census?.carrier,
        carrierSteady: witness.steady?.carrier,
        rowDeltas: Object.entries(entry.census?.rows || {})
          .map(([id, height]) => ({ id, height, steady: witness.steady?.rows?.[id] ?? null }))
          .filter((row) => row.steady == null || Math.abs(row.height - row.steady) > 1),
        missingRows: Object.keys(witness.steady?.rows || {})
          .filter((id) => !(id in (entry.census?.rows || {}))),
      })),
      observations: witness.observations,
      timelineWrites: writes
        .filter((entry) => entry.inTimelineList || entry.isTimelineList)
        .map((entry) => ({ kind: entry.kind, at: entry.at, detail: entry.detail, stack: entry.stack })),
    };
    await dump('layout-witness.json', report);
    await testInfo.attach('layout-witness.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });

    // Every scrollTop change the browser makes must be explained by a write.
    const unwritten = witness.observations.filter((entry) => (
      entry.delta < -2 && !report.timelineWrites.some((write) => Math.abs(write.at - entry.at) < 40)
    ));
    expect(unwritten.length, JSON.stringify(unwritten.map((entry) => ({
      delta: entry.delta,
      from: entry.from,
      to: entry.to,
      scrollHeight: entry.scrollHeight,
      clientHeight: entry.clientHeight,
      maxScrollTop: entry.scrollHeight - entry.clientHeight,
      carrierPaddingTop: entry.carrierPaddingTop,
      byLabel: entry.byLabel,
      byNode: entry.byNode,
      byStack: entry.byStack,
      precedingReads: entry.precedingReads,
    })), null, 2)).toBe(0);
  });

  test('attribution: preventScroll focus removes native focus scrolling', async ({ page, request }, testInfo) => {
    await installProbe(page, { preventFocusScroll: true });
    const report = await recordSend(page, request, {
      seed: 0xe0_09_21,
      label: 'prevent-focus-scroll',
      text: 'E-a35eea6d prevent focus scroll send probe',
    });
    await dump('prevent-focus-scroll.json', report);
    await testInfo.attach('prevent-focus-scroll.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    expect(report.final.gap, JSON.stringify({
      displacements: report.displacements,
      taskMoves: report.taskMoves.map((move) => ({ delta: move.delta, writeCount: move.writeCount })),
      final: report.final,
    }, null, 2)).toBeLessThanOrEqual(24);
  });
});
