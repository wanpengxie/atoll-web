import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

const OUT = process.env.ATOLL_UPWARD_OUT || '/tmp/post-entry-upward-jump-evidence';
const SEED = Number(process.env.ATOLL_UPWARD_SEED || 0x4a_de_37);
const DELTAS = String(process.env.ATOLL_UPWARD_DELTAS || '-120,-160,-220,-260')
  .split(',').map(Number).filter(Number.isFinite);

async function reset(request, scenario = 'deep-history-delayed') {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario, seed: SEED },
  });
  expect(response.ok()).toBe(true);
}

async function installWriteProbe(page) {
  await page.addInitScript(() => {
    const writes = [];
    const events = [];
    const nodeIDs = new WeakMap();
    let nextNodeID = 1;
    const describe = (node) => {
      if (!(node instanceof Element)) return String(node);
      return `${node.tagName.toLowerCase()}.${String(node.className || '').trim().replaceAll(' ', '.')}`;
    };
    const record = (kind, node, detail) => {
      if (node instanceof Element && !nodeIDs.has(node)) nodeIDs.set(node, nextNodeID++);
      const layer = node instanceof Element ? node.closest('.timeline-reading-layer') : null;
      const activeScroller = document.querySelector(
        '.timeline-reading-layer.is-active .timeline-message-list',
      );
      writes.push({
        at: performance.now(),
        kind,
        node: describe(node),
        nodeID: node instanceof Element ? nodeIDs.get(node) : null,
        connected: node instanceof Element ? node.isConnected : null,
        layer: layer?.classList.contains('is-active')
          ? 'active'
          : layer?.classList.contains('is-outgoing')
            ? 'outgoing'
            : layer?.classList.contains('is-incoming')
              ? 'incoming'
              : '',
        currentActiveScroller: node === activeScroller,
        detail,
        stack: String(new Error(kind).stack || '').split('\n').slice(2, 10).join('\n'),
      });
    };
    for (const name of ['scrollTo', 'scroll', 'scrollBy']) {
      const original = Element.prototype[name];
      Element.prototype[name] = function intercepted(...args) {
        const options = typeof args[0] === 'object' && args[0] !== null
          ? args[0]
          : { left: args[0], top: args[1] };
        record(name, this, {
          top: Number(options?.top ?? Number.NaN),
          before: Number(this.scrollTop || 0),
          behavior: options?.behavior || '',
        });
        return original.apply(this, args);
      };
    }
    const intoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function intercepted(...args) {
      record('scrollIntoView', this, { argument: args[0] ?? null });
      return intoView.apply(this, args);
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
    addEventListener('wheel', (event) => {
      const list = event.target?.closest?.('.timeline-message-list');
      events.push({
        at: performance.now(), type: 'wheel', deltaY: event.deltaY,
        target: describe(event.target), container: list?.dataset.readingContainer || (list ? 'virtuoso' : ''),
        scrollTop: Number(list?.scrollTop || 0),
      });
    }, { capture: true, passive: true });
    addEventListener('touchmove', (event) => {
      const list = event.target?.closest?.('.timeline-message-list');
      events.push({
        at: performance.now(), type: 'touchmove', clientY: event.touches[0]?.clientY ?? null,
        target: describe(event.target), container: list?.dataset.readingContainer || (list ? 'virtuoso' : ''),
        scrollTop: Number(list?.scrollTop || 0),
      });
    }, { capture: true, passive: true });
    addEventListener('scroll', (event) => {
      const list = event.target?.closest?.('.timeline-message-list');
      if (!list) return;
      events.push({
        at: performance.now(), type: 'scroll', target: describe(event.target),
        container: list.dataset.readingContainer || 'virtuoso',
        scrollTop: Number(list.scrollTop || 0), scrollHeight: Number(list.scrollHeight || 0),
        clientHeight: Number(list.clientHeight || 0),
      });
    }, { capture: true, passive: true });
    window.__UPWARD_WRITES__ = { writes, events };
  });
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

async function armFrames(page) {
  await page.evaluate(() => {
    window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'post-entry-upward-jump' });
    const frames = [];
    let running = true;
    let phase = 'armed';
    const rect = (node, root) => {
      const box = node.getBoundingClientRect();
      const viewport = root.getBoundingClientRect();
      return {
        id: node.dataset.presentationRowId || '',
        top: Number((box.top - viewport.top).toFixed(2)),
        bottom: Number((box.bottom - viewport.top).toFixed(2)),
        height: Number(box.height.toFixed(2)),
      };
    };
    const sampleList = (root) => {
      if (!root) return null;
      const rows = [...root.querySelectorAll('[data-presentation-row-id]')];
      return {
        container: root.dataset.readingContainer || 'virtuoso',
        scrollTop: Number(Number(root.scrollTop || 0).toFixed(2)),
        scrollHeight: Number(Number(root.scrollHeight || 0).toFixed(2)),
        clientHeight: Number(Number(root.clientHeight || 0).toFixed(2)),
        rows: rows.map((row) => rect(row, root)),
      };
    };
    const tick = () => {
      if (!running) return;
      const stack = document.querySelector('.timeline-reading-stack');
      const active = document.querySelector('.timeline-reading-layer.is-active .timeline-message-list');
      const outgoing = document.querySelector('.timeline-reading-layer.is-outgoing .timeline-message-list');
      const incoming = document.querySelector('.timeline-reading-layer.is-incoming .timeline-message-list');
      const timeline = document.querySelector('.timeline');
      const readingEntries = window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.().entries || [];
      const owner = [...readingEntries].reverse().find((entry) => (
        entry.detail?.activationID && Number.isFinite(Number(entry.detail?.inputEpoch))
      ));
      frames.push({
        index: frames.length,
        at: Number(performance.now().toFixed(2)),
        phase,
        channel: document.querySelector('main h1')?.textContent?.trim() || '',
        mode: timeline?.dataset.viewportMode || '',
        activation: owner?.detail?.activationID || '',
        inputEpoch: owner?.detail?.inputEpoch ?? null,
        handoffPending: stack?.dataset.handoffPending || '',
        handoffReady: stack?.dataset.handoffReady || '',
        active: sampleList(active),
        outgoing: sampleList(outgoing),
        incoming: sampleList(incoming),
      });
      requestAnimationFrame(tick);
    };
    window.__UPWARD_FRAMES__ = {
      setPhase(value) { phase = value; },
      stop() { running = false; return frames; },
    };
    requestAnimationFrame(tick);
  });
}

function commonMotion(frames) {
  const motion = [];
  for (let index = 1; index < frames.length; index += 1) {
    const previousFrame = frames[index - 1];
    const frame = frames[index];
    const previous = previousFrame.active || previousFrame.outgoing;
    const current = frame.active || frame.outgoing;
    if (!previous?.rows?.length || !current?.rows?.length) continue;
    const previousByID = new Map(previous.rows.map((row) => [row.id, row]));
    const deltas = current.rows.flatMap((row) => {
      const before = previousByID.get(row.id);
      return before ? [Number((row.top - before.top).toFixed(2))] : [];
    });
    if (!deltas.length) continue;
    deltas.sort((left, right) => left - right);
    motion.push({
      from: previousFrame.index,
      to: frame.index,
      previousAt: previousFrame.at,
      at: frame.at,
      phase: frame.phase,
      previousContainer: previous.container,
      container: current.container,
      shared: deltas.length,
      minimum: deltas[0],
      median: deltas[Math.floor(deltas.length / 2)],
      maximum: deltas.at(-1),
    });
  }
  return motion;
}

test('cold/same-session entry then real upward wheel records the first reverse paint', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1120, height: 620 });
  await installWriteProbe(page);
  await reset(request);
  await login(page);
  await armFrames(page);

  await page.evaluate(() => window.__UPWARD_FRAMES__.setPhase('channel-click'));
  await page.getByRole('button', { name: '# c0.project', exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  const active = page.locator('.timeline-reading-layer.is-active .timeline-message-list');
  await expect(active.locator('[data-presentation-row-id]').last()).toBeVisible();
  await active.focus();
  await page.mouse.move(560, 300);
  await page.evaluate(() => window.__UPWARD_FRAMES__.setPhase('wheel-up-burst'));
  for (const delta of DELTAS) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(12);
  }
  const becameReady = await page.waitForFunction(() => (
    document.querySelector('.timeline-reading-stack')?.dataset.handoffReady === 'true'
  ), null, { timeout: 10_000 }).then(() => true).catch(() => false);
  if (becameReady) {
    await page.evaluate(() => window.__UPWARD_FRAMES__.setPhase('post-ready-history'));
    for (let step = 0; step < 5; step += 1) {
      const scrollTop = await page.locator('.timeline-reading-layer.is-active .timeline-message-list')
        .evaluate((node) => Number(node.scrollTop || 0));
      if (scrollTop <= 700) break;
      await page.mouse.wheel(0, -220);
      await page.waitForTimeout(30);
    }
  }
  await page.evaluate(() => window.__UPWARD_FRAMES__.setPhase('post-wheel'));
  await page.waitForTimeout(2_000);

  const frames = await page.evaluate(() => window.__UPWARD_FRAMES__.stop());
  const trace = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.() || { entries: [] });
  const io = await page.evaluate(() => window.__UPWARD_WRITES__);
  const motion = commonMotion(frames);
  // Upward input moves common rows down in both the reverse Following surface
  // and ordinary Virtuoso. Only a negative common-row displacement is a
  // reverse jump. The container reveal itself must preserve the shared anchor.
  const upwardWheels = io.events.filter((entry) => entry.type === 'wheel' && entry.deltaY < 0);
  const reverse = motion.filter((entry) => (
    entry.phase !== 'channel-click' && entry.median < -2
  ));
  const result = { seed: SEED, frames, motion, reverse, writes: io.writes, events: io.events, trace };
  await mkdir(OUT, { recursive: true });
  const path = resolve(OUT, `upward-jump-${SEED}.json`);
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await testInfo.attach('upward-jump.json', { path, contentType: 'application/json' });

  expect(frames.some((frame) => frame.phase === 'wheel-up-burst' && frame.mode === 'browsing')).toBe(true);
  expect(frames.at(-1)?.handoffPending).toBe('');
  expect(frames.at(-1)?.handoffReady).toBe('true');
  expect(frames.at(-1)?.active?.container).toBe('virtuoso');
  const entries = trace.entries || [];
  const firstInputAt = upwardWheels[0]?.at ?? Infinity;
  const firstBrowsingPaintAt = frames.find((frame) => (
    frame.at >= firstInputAt
    && frame.handoffReady === 'true'
    && frame.active?.container === 'virtuoso'
  ))?.at ?? Infinity;
  const staleHandoffWrites = io.writes.filter((entry) => (
    entry.node.includes('timeline-message-list')
    && entry.at >= firstInputAt
    && (
      entry.connected !== true
      || (entry.at >= firstBrowsingPaintAt && (
        entry.layer !== 'active'
        || entry.currentActiveScroller !== true
      ))
    )
  ));
  const revealMotion = motion.find((entry) => (
    entry.previousContainer === 'following-tail'
    && entry.container === 'virtuoso'
    && entry.at >= firstInputAt
  ));
  expect(staleHandoffWrites, JSON.stringify(staleHandoffWrites, null, 2)).toEqual([]);
  expect(revealMotion?.shared || 0).toBeGreaterThan(0);
  expect(Math.abs(Number(revealMotion?.median || 0))).toBeLessThanOrEqual(2);
  const targets = entries.filter((entry) => entry.event === 'reading.navigation-target');
  expect(targets.some((entry) => entry.detail?.phase === 'settled')).toBe(true);
  const lastInputEpoch = Math.max(...entries
    .filter((entry) => entry.event === 'reading.input-owner')
    .map((entry) => Number(entry.detail?.inputEpoch || 0)));
  expect(Number(targets.at(-1)?.detail?.inputEpoch || 0)).toBeLessThanOrEqual(lastInputEpoch);
  // Diagnostic red gate: any common-row reverse paint after upward input is a
  // product-visible downward jump, regardless of which positioning mechanism
  // produced it. Preserve the complete event/write/trace timeline on failure.
  expect(reverse, JSON.stringify(reverse.slice(0, 12), null, 2)).toEqual([]);
});

test('one continuous touch gesture keeps ownership across the following handoff', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1120, height: 620 });
  await installWriteProbe(page);
  await reset(request);
  await login(page);
  await armFrames(page);

  await page.evaluate(() => window.__UPWARD_FRAMES__.setPhase('touch-channel-click'));
  await page.getByRole('button', { name: '# c0.project', exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  const following = page.locator('.timeline-reading-layer.is-active .timeline-following-tail');
  await expect(following.locator('[data-presentation-row-id]').last()).toBeVisible();
  const box = await following.boundingBox();
  expect(box).not.toBeNull();
  const client = await page.context().newCDPSession(page);
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + Math.min(box.height - 60, box.height / 2));
  await page.evaluate(() => window.__UPWARD_FRAMES__.setPhase('touch-gesture'));
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y: y + 80, radiusX: 4, radiusY: 4, force: 1, id: 1 }],
  });
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y: y + 120, radiusX: 4, radiusY: 4, force: 1, id: 1 }],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y: y + 160, radiusX: 4, radiusY: 4, force: 1, id: 1 }],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.timeline-reading-stack')).toHaveAttribute('data-handoff-ready', 'true');
  await page.waitForTimeout(500);

  const frames = await page.evaluate(() => window.__UPWARD_FRAMES__.stop());
  const trace = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.() || { entries: [] });
  const io = await page.evaluate(() => window.__UPWARD_WRITES__);
  const entries = trace.entries || [];
  const targets = entries.filter((entry) => entry.event === 'reading.navigation-target');
  const touchEvents = io.events.filter((entry) => entry.type === 'touchmove');
  const followingScrolls = io.events.filter((entry) => (
    entry.type === 'scroll' && entry.container === 'following-tail'
  ));
  // The first effective native scroll activates the potential touch
  // transaction, so its target is labelled `begin`. Only later effective
  // scrolls are labelled `scroll`. Compare the full position-bearing stream
  // with actual Following scroll events instead of assuming every movement is
  // a post-begin update; Chromium may coalesce the dispatched touch points.
  const positionTargets = targets.filter((entry) => (
    entry.detail?.reason === 'begin' || entry.detail?.reason === 'scroll'
  ));
  const motion = commonMotion(frames);
  const reveal = motion.find((entry) => (
    entry.previousContainer === 'following-tail' && entry.container === 'virtuoso'
  ));
  const firstTouchAt = touchEvents[0]?.at ?? Infinity;
  const revealAt = Number(reveal?.at || Infinity);
  const staleWrites = io.writes.filter((entry) => (
    entry.node.includes('timeline-message-list')
    && entry.at >= firstTouchAt
    && (
      entry.connected !== true
      || (entry.at >= revealAt && (
        entry.layer !== 'active' || entry.currentActiveScroller !== true
      ))
    )
  ));
  const reverseMotion = motion.filter((entry) => (
    entry.phase === 'touch-gesture' && entry.median < -2
  ));
  const result = { frames, motion, writes: io.writes, events: io.events, trace };
  await mkdir(OUT, { recursive: true });
  const path = resolve(OUT, `touch-handoff-${SEED}.json`);
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  await testInfo.attach('touch-handoff.json', { path, contentType: 'application/json' });

  expect(touchEvents.length).toBeGreaterThanOrEqual(3);
  expect(touchEvents.every((entry) => entry.container === 'following-tail')).toBe(true);
  expect(followingScrolls.length).toBeGreaterThanOrEqual(2);
  expect(new Set(targets.map((entry) => entry.detail?.transactionID)).size).toBe(1);
  expect(new Set(targets.map((entry) => entry.detail?.inputEpoch)).size).toBe(1);
  expect(positionTargets.length).toBeGreaterThanOrEqual(followingScrolls.length);
  expect(new Set(positionTargets.map((entry) => entry.detail?.targetRevision)).size)
    .toBeGreaterThanOrEqual(2);
  expect(new Set(positionTargets.map((entry) => entry.detail?.targetViewportOffset)).size)
    .toBeGreaterThanOrEqual(2);
  expect(targets.at(-1)?.detail?.phase).toBe('settled');
  expect(reveal?.shared || 0).toBeGreaterThan(0);
  expect(Math.abs(Number(reveal?.median || 0))).toBeLessThanOrEqual(2);
  expect(staleWrites, JSON.stringify(staleWrites, null, 2)).toEqual([]);
  expect(reverseMotion, JSON.stringify(reverseMotion, null, 2)).toEqual([]);
  await expect(page.locator('.timeline-reading-layer.is-active .timeline-message-list')).toBeVisible();
});

test('ordinary browsing touch stays with the active Virtuoso owner', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1120, height: 620 });
  await reset(request);
  await login(page);
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({
    case: 'ordinary-browsing-touch',
  }));
  await page.getByRole('button', { name: '# c0.project', exact: true }).click();
  const following = page.locator('.timeline-following-tail');
  await expect(following.locator('[data-presentation-row-id]').last()).toBeVisible();
  await page.mouse.move(560, 300);
  for (const delta of DELTAS) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(12);
  }
  await expect(page.locator('.timeline-reading-stack')).toHaveAttribute('data-handoff-ready', 'true');

  await page.evaluate(() => {
    const samples = [];
    const touchEvents = [];
    let running = true;
    addEventListener('touchmove', (event) => {
      const root = event.target?.closest?.('.timeline-message-list');
      touchEvents.push({
        at: performance.now(),
        container: root?.dataset.readingContainer || (root ? 'virtuoso' : ''),
        scrollTop: Number(root?.scrollTop || 0),
      });
    }, { capture: true, passive: true });
    const tick = () => {
      if (!running) return;
      const root = document.querySelector('.timeline-reading-layer.is-active .timeline-message-list');
      const viewport = root?.getBoundingClientRect();
      samples.push({
        at: performance.now(),
        scrollTop: Number(root?.scrollTop || 0),
        rows: root && viewport ? [...root.querySelectorAll('[data-presentation-row-id]')].map((row) => ({
          id: row.dataset.presentationRowId,
          top: Number((row.getBoundingClientRect().top - viewport.top).toFixed(2)),
        })) : [],
      });
      requestAnimationFrame(tick);
    };
    window.__ORDINARY_TOUCH__ = {
      stop() { running = false; return { samples, touchEvents }; },
    };
    requestAnimationFrame(tick);
  });

  const active = page.locator('.timeline-reading-layer.is-active .timeline-message-list');
  const before = await active.evaluate((node) => Number(node.scrollTop || 0));
  const box = await active.boundingBox();
  expect(box).not.toBeNull();
  const client = await page.context().newCDPSession(page);
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x, y, id: 7, radiusX: 4, radiusY: 4, force: 1 }],
  });
  for (const offset of [80, 140, 200]) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x, y: y + offset, id: 7, radiusX: 4, radiusY: 4, force: 1 }],
    });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(500);
  const after = await active.evaluate((node) => Number(node.scrollTop || 0));
  const captured = await page.evaluate(() => ({
    ...window.__ORDINARY_TOUCH__.stop(),
    entries: window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.().entries || [],
  }));
  const motion = [];
  for (let index = 1; index < captured.samples.length; index += 1) {
    const previous = new Map(captured.samples[index - 1].rows.map((row) => [row.id, row.top]));
    const deltas = captured.samples[index].rows.flatMap((row) => (
      previous.has(row.id) ? [row.top - previous.get(row.id)] : []
    )).sort((left, right) => left - right);
    if (deltas.length) motion.push({
      at: captured.samples[index].at,
      median: deltas[Math.floor(deltas.length / 2)],
    });
  }
  const evidence = { before, after, ...captured, motion };
  await mkdir(OUT, { recursive: true });
  const path = resolve(OUT, `ordinary-touch-${SEED}.json`);
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  await testInfo.attach('ordinary-touch.json', { path, contentType: 'application/json' });
  const owners = captured.entries.filter((entry) => (
    entry.event === 'reading.input-owner' && entry.detail?.source === 'touch'
  ));
  expect(captured.touchEvents.length).toBeGreaterThanOrEqual(3);
  expect(captured.touchEvents.every((entry) => entry.container === 'virtuoso')).toBe(true);
  expect(owners.some((entry) => entry.detail?.reason === 'begin')).toBe(true);
  expect(after).toBeLessThan(before);
  expect(motion.filter((entry) => entry.median < -2)).toEqual([]);
  await expect(page.locator('.timeline-reading-stack')).toHaveAttribute('data-handoff-ready', 'true');
});
