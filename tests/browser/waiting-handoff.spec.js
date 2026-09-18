import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

const SOURCE_PATHS = [
  'src/model/waiting-presentation.js',
  'src/ui/Timeline.jsx',
  'src/ui/timeline/LegendMessageList.jsx',
  'src/ui/conversation/ConversationSurface.jsx',
  'src/styles/timeline.css',
  'tests/browser/waiting-handoff.spec.js',
];

async function fingerprint() {
  const hash = createHash('sha256');
  for (const path of SOURCE_PATHS) hash.update(path).update('\0').update(await readFile(path));
  return { algorithm: 'sha256', digest: hash.digest('hex'), paths: SOURCE_PATHS };
}

async function reset(request, scenario, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed } });
  if (!response.ok()) throw new Error(`mock reset failed: ${response.status()} ${await response.text()}`);
}

async function login(page, history = false) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await page.waitForFunction(() => document.querySelector('.connection-state.state-open'));
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'c0');
  await page.waitForFunction((needsHistory) => {
    const root = document.querySelector('.timeline-message-list');
    return root && root.clientHeight > 0 && (!needsHistory || root.scrollHeight > root.clientHeight * 1.5);
  }, history);
}

async function composeForSteward(page, text) {
  const editor = page.getByLabel('消息');
  await editor.fill('@st');
  await page.getByRole('option', { name: /steward/ }).click();
  await editor.press('End');
  await editor.pressSequentially(text);
}

async function send(page, text) {
  await composeForSteward(page, text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
}

async function establishQueuedTarget(page, ownerText, targetText) {
  await send(page, ownerText);
  await page.waitForFunction((needle) => (
    [...document.querySelectorAll('[data-presentation-row-id]')].some((row) => row.textContent?.includes(needle))
    && [...document.querySelectorAll('.task-control-buttons button')].some((button) => button.textContent === '停止')
  ), ownerText);
  await send(page, targetText);
  await page.waitForFunction((needle) => [...document.querySelectorAll('.agent-wait-item')]
    .some((node) => node.textContent?.includes(needle)), targetText);
  return page.evaluate((needle) => [...document.querySelectorAll('.agent-wait-item')]
    .find((node) => node.textContent?.includes(needle))?.dataset.requestId || '', targetText);
}

async function advance(request, count) {
  for (let index = 0; index < count; index += 1) {
    const response = await request.post(`${MOCK}/mock/control/advance`, { data: { ms: 0, compute: { channel_id: 'c0' } } });
    if (!response.ok()) throw new Error(`advance failed: ${response.status()} ${await response.text()}`);
  }
}

async function installProbe(page, requestId, label) {
  await page.evaluate(({ targetRequestId, caseLabel }) => {
    const root = document.querySelector('.timeline-message-list');
    if (!root) throw new Error('timeline scroller is absent');
    const escaped = globalThis.CSS?.escape?.(targetRequestId) || targetRequestId;
    const waitSelector = `.agent-wait-item[data-request-id="${escaped}"]`;
    const rowSelector = `[data-presentation-row-id="${escaped}"]`;
    const nodeIDs = new WeakMap();
    let nextNodeID = 1;
    let raf = 0;
    let running = true;
    const idOf = (node) => {
      if (!node) return '';
      if (!nodeIDs.has(node)) nodeIDs.set(node, `${node.localName}-${nextNodeID++}`);
      return nodeIDs.get(node);
    };
    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const value = node.getBoundingClientRect();
      return {
        nodeID: idOf(node), top: value.top, right: value.right, bottom: value.bottom, left: value.left,
        width: value.width, height: value.height,
      };
    };
    const semantic = (node) => Boolean(node
      && !node.closest('[aria-hidden="true"]')
      && !node.closest('[inert]'));
    const probe = {
      schema: 1,
      label: caseLabel,
      requestId: targetRequestId,
      startedAt: performance.now(),
      frames: [], markers: [], writes: [], mutations: [], animations: [],
    };
    const sample = () => {
      const scroller = document.querySelector('.timeline-message-list');
      const bounds = scroller?.getBoundingClientRect();
      const waiting = document.querySelector(waitSelector);
      const row = document.querySelector(rowSelector);
      const rowBounds = row?.getBoundingClientRect();
      const visibleRows = scroller ? [...scroller.querySelectorAll('[data-presentation-row-id]')]
        .filter((node) => node.getBoundingClientRect().bottom > bounds.top + 0.5)
        .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top) : [];
      const anchor = visibleRows[0];
      const anchorRect = anchor?.getBoundingClientRect();
      probe.frames.push({
        index: probe.frames.length,
        at: performance.now(),
        channel: document.querySelector('main h1')?.textContent || '',
        mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
        waiting: waiting ? {
          nodeID: idOf(waiting), handoff: waiting.dataset.handoffState || '',
          ariaHidden: waiting.getAttribute('aria-hidden') || '', inert: waiting.hasAttribute('inert'),
          semantic: semantic(waiting), interactive: waiting.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href]').length,
        } : null,
        row: row ? {
          nodeID: idOf(row), presentationState: row.dataset.presentationState || '', semantic: semantic(row),
          visible: Boolean(bounds && rowBounds.bottom > bounds.top + 0.5 && rowBounds.top < bounds.bottom - 0.5),
          status: row.querySelector('[data-request-id]')?.className || '',
        } : null,
        semanticOwnerCount: Number(semantic(waiting)) + Number(semantic(row)),
        scroller: scroller ? {
          nodeID: idOf(scroller), scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight,
          clientHeight: scroller.clientHeight, gap: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
        } : null,
        anchor: anchor ? {
          rowID: anchor.dataset.presentationRowId || '', nodeID: idOf(anchor), top: anchorRect.top - bounds.top,
        } : null,
        reading: rect('.conversation-reading-slot'),
        input: rect('.conversation-input-slot'),
        composer: rect('.composer-wrap'),
      });
      if (running) raf = requestAnimationFrame(sample);
    };
    const stack = () => String(new Error().stack || '').split('\n').slice(2, 9).join('\n');
    const recordWrite = (method, detail) => probe.writes.push({ at: performance.now(), method, detail, stack: stack() });
    const nativeScrollTo = root.scrollTo;
    const nativeScrollBy = root.scrollBy;
    root.scrollTo = function waitingHandoffScrollTo(...args) {
      recordWrite('scrollTo', args);
      return nativeScrollTo.apply(this, args);
    };
    root.scrollBy = function waitingHandoffScrollBy(...args) {
      recordWrite('scrollBy', args);
      return nativeScrollBy.apply(this, args);
    };
    let prototype = root;
    let descriptor;
    while (prototype && !descriptor) {
      prototype = Object.getPrototypeOf(prototype);
      descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, 'scrollTop');
    }
    if (descriptor?.get && descriptor?.set) Object.defineProperty(root, 'scrollTop', {
      configurable: true,
      get() { return descriptor.get.call(this); },
      set(value) { recordWrite('scrollTop=', Number(value)); return descriptor.set.call(this, value); },
    });
    const mutationObserver = new MutationObserver((records) => {
      for (const record of records) {
        const node = record.target instanceof Element ? record.target : record.target.parentElement;
        if (!node) continue;
        const relevant = node.matches?.(`${waitSelector}, ${rowSelector}`)
          || node.closest?.(`${waitSelector}, ${rowSelector}`)
          || [...record.addedNodes, ...record.removedNodes].some((item) => item instanceof Element
            && (item.matches?.(`${waitSelector}, ${rowSelector}`) || item.querySelector?.(`${waitSelector}, ${rowSelector}`)));
        if (relevant) probe.mutations.push({
          at: performance.now(), type: record.type, attribute: record.attributeName || '',
          target: idOf(node), waitingPresent: Boolean(document.querySelector(waitSelector)), rowPresent: Boolean(document.querySelector(rowSelector)),
        });
      }
    });
    mutationObserver.observe(document.querySelector('.conversation-surface') || document.body, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['data-handoff-state', 'data-presentation-state', 'aria-hidden', 'inert', 'class'],
    });
    const onAnimation = (event) => {
      const node = event.target;
      if (!(node instanceof Element)) return;
      const owner = node.closest?.(`${waitSelector}, ${rowSelector}`)
        || (node.matches('.agent-wait-layer.is-handoff-only') ? node.querySelector(waitSelector) : null);
      if (!owner) return;
      probe.animations.push({
        at: performance.now(), type: event.type, name: event.animationName,
        owner: owner.matches(waitSelector) ? 'waiting' : 'row', nodeID: idOf(owner),
      });
    };
    document.addEventListener('animationstart', onAnimation, true);
    document.addEventListener('animationend', onAnimation, true);
    probe.mark = (name, detail = {}) => probe.markers.push({ at: performance.now(), name, detail });
    probe.stop = () => {
      running = false;
      cancelAnimationFrame(raf);
      mutationObserver.disconnect();
      document.removeEventListener('animationstart', onAnimation, true);
      document.removeEventListener('animationend', onAnimation, true);
      sample();
    };
    probe.snapshot = () => ({ ...probe });
    window.__waitingHandoffProbe = probe;
    probe.mark('installed');
    sample();
  }, { targetRequestId: requestId, caseLabel: label });
}

async function mark(page, name, detail = {}) {
  await page.evaluate(({ marker, value }) => window.__waitingHandoffProbe?.mark(marker, value), { marker: name, value: detail });
}

function delta(left, right, key, field) {
  return Math.abs(Number(right?.[key]?.[field] || 0) - Number(left?.[key]?.[field] || 0));
}

function summarize(snapshot) {
  const frames = snapshot.frames || [];
  const baseline = frames[0] || null;
  const exitFrames = frames.filter((frame) => frame.waiting?.handoff === 'exit');
  const enterFrames = frames.filter((frame) => frame.row?.presentationState === 'handoff-enter');
  const firstExit = exitFrames[0] || null;
  const postHandoff = frames.find((frame) => firstExit && frame.at > firstExit.at + 220) || frames.at(-1) || null;
  const geometryMax = Object.fromEntries(['reading', 'input', 'composer'].map((key) => [key, Object.fromEntries(
    ['top', 'bottom', 'height'].map((field) => [field, Math.max(0, ...frames.map((frame) => delta(baseline, frame, key, field)))]),
  )]));
  const animationStarts = snapshot.animations.filter((event) => (
    event.type === 'animationstart' && ['waiting-handoff-exit', 'waiting-handoff-enter'].includes(event.name)
  ));
  return {
    baseline, firstExit, postHandoff, geometryMax,
    exitFrameCount: exitFrames.length,
    enterFrameCount: enterFrames.length,
    animationStarts,
    semanticOwnerMaximum: Math.max(0, ...frames.map((frame) => frame.semanticOwnerCount)),
    exitingInteractiveMaximum: Math.max(0, ...exitFrames.map((frame) => frame.waiting?.interactive || 0)),
    handoffWrites: snapshot.writes,
  };
}

async function persist(testInfo, mode, payload) {
  const path = testInfo.outputPath(`${mode}-waiting-handoff.json`);
  await writeFile(path, JSON.stringify(payload, null, 2));
  await testInfo.attach(`${mode}-waiting-handoff`, { path, contentType: 'application/json' });
  return path;
}

async function finish(page, testInfo, mode, operationFailure) {
  const snapshot = await page.evaluate(() => {
    window.__waitingHandoffProbe?.stop?.();
    return window.__waitingHandoffProbe?.snapshot?.() || null;
  });
  const summary = snapshot ? summarize(snapshot) : null;
  const artifact = {
    schema: 1, capturedAt: new Date().toISOString(), mode,
    oracle: {
      durationMs: 180, geometryTolerancePx: 1, semanticOwnerMaximum: 1,
      artifactOrdering: 'writeFile-and-attach-before-business-expect',
    },
    source: await fingerprint(),
    operationFailure: operationFailure ? { message: operationFailure.message, stack: operationFailure.stack } : null,
    summary, snapshot,
  };
  const path = await persist(testInfo, mode, artifact);
  if (operationFailure) throw new Error(`trajectory failed after artifact persisted at ${path}: ${operationFailure.message}`);
  return { snapshot, summary };
}

test('queued request hands off once to a rapidly completed canonical row without duplicate semantics', async ({ page, request }, testInfo) => {
  test.slow();
  await page.setViewportSize({ width: 1120, height: 760 });
  await reset(request, 'long-running-canonical', 0x92_18_01);
  await login(page);
  const targetText = 'handoff-rapid-terminal';
  const requestId = await establishQueuedTarget(page, 'handoff-owner-rapid', targetText);
  await installProbe(page, requestId, 'rapid-terminal');
  let operationFailure = null;
  try {
    await mark(page, 'promote-start');
    await advance(request, 3);
    const terminal = await request.post(`${MOCK}/mock/control/action`, {
      data: { type: 'push_terminal', channel_id: 'c0', request_id: requestId, payload: { text: `已完成：${targetText}` } },
    });
    if (!terminal.ok()) throw new Error(`terminal failed: ${terminal.status()} ${await terminal.text()}`);
    const terminalBody = await terminal.json();
    await mark(page, 'rapid-terminal-appended', { envelopeId: terminalBody.row?.envelope?.id || '' });
    await page.waitForFunction((id) => document.querySelector(`[data-presentation-row-id="${CSS.escape(id)}"]`)?.textContent?.includes('已完成'), requestId);
    await page.waitForTimeout(260);
    await mark(page, 'duplicate-replay-before');
    const replay = await request.post(`${MOCK}/mock/control/action`, {
      data: { type: 'replay_envelope', channel_id: 'c0', envelope_id: terminalBody.row.envelope.id },
    });
    if (!replay.ok()) throw new Error(`replay failed: ${replay.status()} ${await replay.text()}`);
    await page.waitForTimeout(240);
    await mark(page, 'duplicate-replay-settled');
  } catch (error) {
    operationFailure = error;
    await mark(page, 'operation-failure', { message: error.message }).catch(() => {});
  }
  const { snapshot, summary } = await finish(page, testInfo, 'rapid-terminal', operationFailure);
  expect(summary.exitFrameCount).toBeGreaterThan(0);
  expect(summary.enterFrameCount).toBeGreaterThan(0);
  expect(summary.animationStarts.filter((event) => event.owner === 'waiting')).toHaveLength(1);
  expect(summary.animationStarts.filter((event) => event.owner === 'row')).toHaveLength(1);
  expect(summary.semanticOwnerMaximum).toBeLessThanOrEqual(1);
  expect(summary.exitingInteractiveMaximum).toBe(0);
  expect(summary.handoffWrites).toEqual([]);
  expect(summary.geometryMax.reading.height).toBeLessThanOrEqual(1);
  expect(summary.geometryMax.input.height).toBeLessThanOrEqual(1);
  expect(summary.geometryMax.composer.top).toBeLessThanOrEqual(1);
  const duplicateAt = snapshot.markers.find((entry) => entry.name === 'duplicate-replay-before')?.at || Number.POSITIVE_INFINITY;
  expect(snapshot.animations.filter((event) => event.type === 'animationstart' && event.at > duplicateAt)).toEqual([]);
  expect(summary.postHandoff.waiting).toBeNull();
});

test('browsing-up handoff stays offscreen, preserves its anchor, and cleans up on channel exit', async ({ page, request }, testInfo) => {
  test.slow();
  await page.setViewportSize({ width: 1120, height: 760 });
  await reset(request, 'long-running-history', 0x92_18_02);
  await login(page, true);
  const requestId = await establishQueuedTarget(page, 'handoff-owner-browsing', 'handoff-browsing-target');
  const scroller = page.locator('.timeline-message-list');
  await scroller.hover();
  await page.mouse.wheel(0, -900);
  await page.waitForFunction(() => document.querySelector('.timeline')?.dataset.viewportMode === 'browsing');
  await installProbe(page, requestId, 'browsing-channel-exit');
  let operationFailure = null;
  try {
    await mark(page, 'promote-start');
    await advance(request, 3);
    await page.waitForFunction((id) => document.querySelector(`.agent-wait-item[data-request-id="${CSS.escape(id)}"]`)?.dataset.handoffState === 'exit', requestId);
    await mark(page, 'exit-visible');
    await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0\.project$/ }) }).click();
    await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'c0.project');
    await page.waitForTimeout(220);
    await mark(page, 'channel-exit-settled');
  } catch (error) {
    operationFailure = error;
    await mark(page, 'operation-failure', { message: error.message }).catch(() => {});
  }
  const { snapshot, summary } = await finish(page, testInfo, 'browsing-channel-exit', operationFailure);
  expect(summary.exitFrameCount).toBeGreaterThan(0);
  expect(snapshot.frames.filter((frame) => frame.row?.presentationState === 'handoff-enter')
    .every((frame) => frame.row.visible === false)).toBe(true);
  expect(summary.semanticOwnerMaximum).toBeLessThanOrEqual(1);
  expect(summary.exitingInteractiveMaximum).toBe(0);
  expect(summary.handoffWrites).toEqual([]);
  expect(summary.geometryMax.reading.height).toBeLessThanOrEqual(1);
  const before = summary.baseline.anchor;
  const handoff = summary.firstExit.anchor;
  expect(handoff?.rowID).toBe(before?.rowID);
  expect(Math.abs(Number(handoff?.top || 0) - Number(before?.top || 0))).toBeLessThanOrEqual(1);
  expect(snapshot.frames.at(-1).channel).toBe('c0.project');
  expect(snapshot.frames.at(-1).waiting).toBeNull();
  expect(snapshot.frames.at(-1).row).toBeNull();
});

test('reduced motion performs the same semantic handoff without transition state', async ({ page, request }, testInfo) => {
  test.slow();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1120, height: 760 });
  await reset(request, 'long-running-canonical', 0x92_18_03);
  await login(page);
  const requestId = await establishQueuedTarget(page, 'handoff-owner-reduced', 'handoff-reduced-target');
  await installProbe(page, requestId, 'reduced-motion');
  let operationFailure = null;
  try {
    await advance(request, 3);
    await page.waitForFunction((id) => Boolean(document.querySelector(`[data-presentation-row-id="${CSS.escape(id)}"]`)), requestId);
    await page.waitForTimeout(80);
  } catch (error) {
    operationFailure = error;
  }
  const { summary } = await finish(page, testInfo, 'reduced-motion', operationFailure);
  expect(summary.exitFrameCount).toBe(0);
  expect(summary.enterFrameCount).toBe(0);
  expect(summary.animationStarts).toEqual([]);
  expect(summary.semanticOwnerMaximum).toBeLessThanOrEqual(1);
  expect(summary.handoffWrites).toEqual([]);
});
