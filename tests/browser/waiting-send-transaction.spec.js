import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

const SOURCE_PATHS = [
  'src/ui/Composer.jsx',
  'src/ui/Timeline.jsx',
  'src/ui/conversation/ConversationSurface.jsx',
  'src/ui/timeline/LegendMessageList.jsx',
  'src/ui/timeline/useReadingSession.js',
  'src/app/hooks/useChannelFeed.js',
  'src/app/hooks/useSubmissions.js',
  'src/model/outbox-store.js',
  'src/model/send-scroll-transaction.js',
  'src/model/submissions.js',
  'src/model/timeline-projection.js',
  'src/model/waiting-presentation.js',
  'src/styles/app-shell.css',
  'src/styles/timeline.css',
  'tests/browser/waiting-send-transaction.spec.js',
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

async function login(page, { history = false } = {}) {
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
  const lines = String(text).split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0) await editor.press('Shift+Enter');
    await editor.pressSequentially(lines[index]);
  }
}

async function sendOwner(page, text) {
  await composeForSteward(page, text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForFunction((needle) => (
    [...document.querySelectorAll('[data-presentation-row-id]')].some((row) => (
      row.textContent?.includes(needle)
      && row.querySelector('.progress-trail.running[role="status"]')
    ))
  ), text, { timeout: 15_000 });
  await page.waitForTimeout(100);
}

async function installProbe(page, label) {
  await page.evaluate((caseLabel) => {
    const root = document.querySelector('.timeline-message-list');
    if (!root) throw new Error('timeline scroller is absent');
    window.__waitingSendProbe?.stop?.();

    const nodeIDs = new WeakMap();
    let nextNodeID = 1;
    let raf = 0;
    let running = true;
    const idOf = (node) => {
      if (!node) return '';
      if (!nodeIDs.has(node)) nodeIDs.set(node, `${node.localName || 'node'}-${nextNodeID++}`);
      return nodeIDs.get(node);
    };
    const rectOf = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        nodeID: idOf(node), connected: node.isConnected,
        top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left,
        width: rect.width, height: rect.height,
        clientHeight: Number(node.clientHeight || 0), scrollHeight: Number(node.scrollHeight || 0),
      };
    };
    const stack = () => String(new Error().stack || '').split('\n').slice(2, 10).join('\n');
    const describe = (node) => {
      if (!(node instanceof Element)) return null;
      return {
        nodeID: idOf(node), tag: node.localName, className: node.className || '',
        rowID: node.dataset?.presentationRowId || '', requestID: node.dataset?.requestId || '',
        text: String(node.textContent || '').trim().slice(0, 160),
      };
    };
    const terminalState = () => {
      const inputSlot = document.querySelector('.conversation-input-slot');
      const composer = document.querySelector('.composer-surface');
      const editor = document.querySelector('.composer-editor');
      const style = inputSlot ? globalThis.getComputedStyle(inputSlot) : null;
      const controlHit = (label, selector) => {
        const node = document.querySelector(selector);
        if (!node) return { label, present: false };
        const rect = node.getBoundingClientRect();
        const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        const hit = document.elementFromPoint(point.x, point.y);
        return {
          label, present: true, disabled: Boolean(node.disabled), point,
          rect: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height },
          hit: describe(hit), owned: hit === node || node.contains(hit),
        };
      };
      return {
        transition: inputSlot?.getAttribute('data-send-clear-transition') || '',
        hasTransitionAttribute: Boolean(inputSlot?.hasAttribute('data-send-clear-transition')),
        fromHeight: inputSlot?.style.getPropertyValue('--send-clear-from-height') || '',
        toHeight: inputSlot?.style.getPropertyValue('--send-clear-to-height') || '',
        overflowX: style?.overflowX || '',
        overflowY: style?.overflowY || '',
        inputSlot: rectOf('.conversation-input-slot'),
        composer: rectOf('.composer-surface'),
        editor: rectOf('.composer-editor'),
        alert: describe(document.querySelector('.composer-error')),
        controls: [
          controlHit('send', '.send-button'),
          controlHit('upload-local', '.composer-file-control input[type="file"]'),
          controlHit('choose-channel-file', '.composer-tools button[aria-label="从频道文件选择"]'),
          controlHit('retry', '.composer-retry'),
        ],
      };
    };
    const probe = {
      schema: 1,
      label: caseLabel,
      startedAt: performance.now(),
      frames: [], markers: [], writes: [], scrollEvents: [], wheelEvents: [], mutations: [], resizes: [], layoutShifts: [],
      targetRequestID: '',
    };
    const recordFrame = () => {
      const scroller = document.querySelector('.timeline-message-list');
      const bounds = scroller?.getBoundingClientRect();
      const rows = scroller ? [...scroller.querySelectorAll('[data-presentation-row-id]')] : [];
      const visible = rows.filter((row) => {
        const rect = row.getBoundingClientRect();
        return bounds && rect.bottom > bounds.top + 0.5 && rect.top < bounds.bottom - 0.5;
      }).sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);
      const anchor = visible[0];
      const anchorRect = anchor?.getBoundingClientRect();
      const lastSemantic = rows.at(-1);
      const lastSemanticRect = lastSemantic?.getBoundingClientRect();
      const waitingItems = [...document.querySelectorAll('.agent-wait-item')];
      const target = waitingItems.find((node) => node.textContent?.includes('waiting-target'));
      if (target?.dataset.requestId) probe.targetRequestID = target.dataset.requestId;
      probe.frames.push({
        index: probe.frames.length,
        at: performance.now(),
        mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
        connection: document.querySelector('.connection-state')?.className || '',
        scroller: scroller ? {
          nodeID: idOf(scroller), connected: scroller.isConnected,
          scrollTop: Number(scroller.scrollTop || 0), scrollHeight: Number(scroller.scrollHeight || 0),
          clientHeight: Number(scroller.clientHeight || 0),
          gap: Number(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop),
        } : null,
        reading: rectOf('.conversation-reading-slot'),
        inputSlot: rectOf('.conversation-input-slot'),
        bottomStack: rectOf('.conversation-bottom-stack'),
        floatingSlot: rectOf('.conversation-floating-slot'),
        waiting: rectOf('.agent-wait-layer'),
        waitingObstruction: rectOf('.timeline-waiting-obstruction'),
        floatingObstruction: Number.parseFloat(globalThis.getComputedStyle(scroller)
          .getPropertyValue('--conversation-floating-obstruction')) || 0,
        composerWrap: rectOf('.composer-wrap'),
        composerSurface: rectOf('.composer-surface'),
        sendClearRevision: document.querySelector('.composer-wrap')?.dataset.sendClearRevision || '',
        sendClearTransition: document.querySelector('.conversation-input-slot')?.dataset.sendClearTransition || '',
        sendClearStyle: (() => {
          const node = document.querySelector('.conversation-input-slot');
          const style = node ? globalThis.getComputedStyle(node) : null;
          return {
            hasTransitionAttribute: Boolean(node?.hasAttribute('data-send-clear-transition')),
            fromHeight: node?.style.getPropertyValue('--send-clear-from-height') || '',
            toHeight: node?.style.getPropertyValue('--send-clear-to-height') || '',
            overflowX: style?.overflowX || '', overflowY: style?.overflowY || '',
          };
        })(),
        editor: (() => {
          const node = document.querySelector('.composer-editor');
          return node ? { ...rectOf('.composer-editor'), text: String(node.textContent || '') } : null;
        })(),
        anchor: anchor ? {
          nodeID: idOf(anchor), rowID: anchor.dataset.presentationRowId || '',
          top: anchorRect.top - bounds.top, bottom: anchorRect.bottom - bounds.top,
        } : null,
        lastSemantic: lastSemantic ? {
          nodeID: idOf(lastSemantic), rowID: lastSemantic.dataset.presentationRowId || '',
          top: lastSemanticRect.top - bounds.top, bottom: lastSemanticRect.bottom - bounds.top,
        } : null,
        materialized: rows.map((row) => ({ nodeID: idOf(row), rowID: row.dataset.presentationRowId || '' })),
        waitingItems: waitingItems.map((node) => ({
          nodeID: idOf(node), requestID: node.dataset.requestId || '', text: String(node.textContent || '').trim().slice(0, 160),
        })),
      });
      if (running) raf = requestAnimationFrame(recordFrame);
    };

    const recordWrite = (method, detail) => probe.writes.push({ at: performance.now(), method, detail, stack: stack() });
    const nativeScrollTo = root.scrollTo;
    const nativeScrollBy = root.scrollBy;
    root.scrollTo = function instrumentedScrollTo(...args) {
      recordWrite('scrollTo', args);
      return nativeScrollTo.apply(this, args);
    };
    root.scrollBy = function instrumentedScrollBy(...args) {
      recordWrite('scrollBy', args);
      return nativeScrollBy.apply(this, args);
    };
    let prototype = root;
    let scrollTopDescriptor;
    while (prototype && !scrollTopDescriptor) {
      prototype = Object.getPrototypeOf(prototype);
      scrollTopDescriptor = prototype && Object.getOwnPropertyDescriptor(prototype, 'scrollTop');
    }
    if (scrollTopDescriptor?.get && scrollTopDescriptor?.set) {
      Object.defineProperty(root, 'scrollTop', {
        configurable: true,
        get() { return scrollTopDescriptor.get.call(this); },
        set(value) {
          recordWrite('scrollTop=', Number(value));
          return scrollTopDescriptor.set.call(this, value);
        },
      });
    }
    root.addEventListener('scroll', () => probe.scrollEvents.push({
      at: performance.now(), scrollTop: Number(root.scrollTop || 0), scrollHeight: Number(root.scrollHeight || 0),
      clientHeight: Number(root.clientHeight || 0), gap: Number(root.scrollHeight - root.clientHeight - root.scrollTop),
    }), { passive: true });
    const onWheel = (event) => probe.wheelEvents.push({
      at: performance.now(), trusted: event.isTrusted, deltaX: event.deltaX, deltaY: event.deltaY,
      scrollTop: Number(root.scrollTop || 0), inputEpoch: document.querySelector('.timeline')?.dataset.viewportMode || '',
    });
    root.addEventListener('wheel', onWheel, { capture: true, passive: true });

    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
      probe.resizes.push({
        at: performance.now(),
        entries: entries.map((entry) => ({ nodeID: idOf(entry.target), className: entry.target.className || '', width: entry.contentRect.width, height: entry.contentRect.height })),
      });
    }) : null;
    for (const selector of ['.timeline-message-list', '.conversation-reading-slot', '.conversation-input-slot', '.conversation-bottom-stack', '.conversation-floating-slot', '.composer-wrap']) {
      const node = document.querySelector(selector);
      if (node) resizeObserver?.observe(node);
    }
    const mutationObserver = new MutationObserver((records) => {
      for (const record of records) {
        const added = [...record.addedNodes].flatMap((node) => {
          if (!(node instanceof Element)) return [];
          return [node, ...node.querySelectorAll('[data-presentation-row-id], .agent-wait-layer, .agent-wait-item')]
            .filter((candidate) => candidate.matches('[data-presentation-row-id], .agent-wait-layer, .agent-wait-item'))
            .map(describe).filter(Boolean);
        });
        const removed = [...record.removedNodes].flatMap((node) => {
          if (!(node instanceof Element)) return [];
          return [node, ...node.querySelectorAll('[data-presentation-row-id], .agent-wait-layer, .agent-wait-item')]
            .filter((candidate) => candidate.matches('[data-presentation-row-id], .agent-wait-layer, .agent-wait-item'))
            .map(describe).filter(Boolean);
        });
        if (added.length || removed.length) probe.mutations.push({ at: performance.now(), added, removed });
        for (const entry of added) {
          if (entry.className.includes('agent-wait-layer')) {
            const node = document.querySelector('.agent-wait-layer');
            if (node) resizeObserver?.observe(node);
          }
          if (entry.className.includes('conversation-floating-slot')) {
            const node = document.querySelector('.conversation-floating-slot');
            if (node) resizeObserver?.observe(node);
          }
        }
      }
    });
    mutationObserver.observe(document.querySelector('.conversation-surface') || document.body, { subtree: true, childList: true });
    let performanceObserver = null;
    try {
      performanceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) probe.layoutShifts.push({
          at: entry.startTime, value: entry.value, hadRecentInput: entry.hadRecentInput,
          sources: (entry.sources || []).map((source) => ({ nodeID: idOf(source.node), previousRect: source.previousRect, currentRect: source.currentRect })),
        });
      });
      performanceObserver.observe({ type: 'layout-shift', buffered: true });
    } catch { performanceObserver = null; }

    probe.mark = (name, detail = {}) => probe.markers.push({ at: performance.now(), name, detail });
    probe.stop = () => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      performanceObserver?.disconnect();
      root.removeEventListener('wheel', onWheel, { capture: true });
      recordFrame();
    };
    probe.snapshot = () => ({
      ...probe,
      terminalState: terminalState(),
      readingTrace: window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.() || null,
      applicationDiagnostics: window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || [],
    });
    window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'waiting-send-transaction', label: caseLabel });
    window.__waitingSendProbe = probe;
    probe.mark('probe-installed');
    recordFrame();
  }, label);
}

async function mark(page, name, detail = {}) {
  await page.evaluate(({ marker, value }) => window.__waitingSendProbe?.mark(marker, value), { marker: name, value: detail });
}

function conciseError(error) {
  return error ? { name: error.name || 'Error', message: String(error.message || error), stack: String(error.stack || '').split('\n').slice(0, 12).join('\n') } : null;
}

function geometryDelta(before, after, key) {
  const left = before?.[key];
  const right = after?.[key];
  if (!left || !right) return null;
  return Object.fromEntries(['top', 'right', 'bottom', 'left', 'width', 'height', 'clientHeight', 'scrollHeight']
    .map((field) => [field, Number(right[field] || 0) - Number(left[field] || 0)]));
}

function maxGeometryDrift(baseline, frames, key) {
  const reference = baseline?.[key];
  if (!reference || frames.length === 0) return null;
  return Object.fromEntries(['top', 'right', 'bottom', 'left', 'width', 'height', 'clientHeight', 'scrollHeight']
    .map((field) => [field, Math.max(...frames.map((frame) => Math.abs(
      Number(frame?.[key]?.[field] || 0) - Number(reference[field] || 0),
    )))]));
}

function summarize(snapshot) {
  const frames = snapshot.frames || [];
  const firstWaitingIndex = frames.findIndex((frame) => frame.waitingItems?.length > 0);
  const firstWaiting = firstWaitingIndex >= 0 ? frames[firstWaitingIndex] : null;
  const beforeWaiting = firstWaitingIndex > 0 ? frames[firstWaitingIndex - 1] : null;
  const lastWaitingIndex = [...frames].map((frame) => frame.waitingItems?.length > 0).lastIndexOf(true);
  const lastWaiting = lastWaitingIndex >= 0 ? frames[lastWaitingIndex] : null;
  const afterWaiting = lastWaitingIndex >= 0 ? frames[lastWaitingIndex + 1] || null : null;
  const postMountFrames = firstWaitingIndex >= 0 ? frames.slice(firstWaitingIndex) : [];
  const sendClearFrameIndexes = frames.flatMap((frame, index) => frame.sendClearTransition ? [index] : []);
  const firstSendClearIndex = sendClearFrameIndexes[0] ?? -1;
  const lastSendClearIndex = sendClearFrameIndexes.at(-1) ?? -1;
  const sendClearFrames = firstSendClearIndex >= 0
    ? frames.slice(Math.max(0, firstSendClearIndex - 1), Math.min(frames.length, lastSendClearIndex + 2))
    : [];
  const sendClearAnchorSteps = sendClearFrames.slice(1).flatMap((frame, index) => {
    const before = sendClearFrames[index];
    if (!frame.anchor?.rowID || frame.anchor.rowID !== before.anchor?.rowID) return [];
    return [Number(frame.anchor.top || 0) - Number(before.anchor.top || 0)];
  });
  const sendClearCausalSteps = sendClearFrames.slice(1).flatMap((frame, index) => {
    const before = sendClearFrames[index];
    if (!frame.anchor?.rowID || frame.anchor.rowID !== before.anchor?.rowID) return [];
    const scrollTopDelta = Number(frame.scroller?.scrollTop || 0) - Number(before.scroller?.scrollTop || 0);
    const scrollHeightDelta = Number(frame.scroller?.scrollHeight || 0) - Number(before.scroller?.scrollHeight || 0);
    const clientHeightDelta = Number(frame.scroller?.clientHeight || 0) - Number(before.scroller?.clientHeight || 0);
    const gapDelta = Number(frame.scroller?.gap || 0) - Number(before.scroller?.gap || 0);
    const anchorDelta = Number(frame.anchor.top || 0) - Number(before.anchor.top || 0);
    return [{
      from: before.index, to: frame.index,
      scrollTopDelta, scrollHeightDelta, clientHeightDelta, gapDelta, anchorDelta,
      tailEquationError: scrollTopDelta - (scrollHeightDelta - clientHeightDelta - gapDelta),
      anchorEquationError: anchorDelta + scrollTopDelta,
      viewportStatic: Math.abs(scrollHeightDelta) <= 0.5 && Math.abs(clientHeightDelta) <= 0.5,
    }];
  });
  const sendClearSettled = lastSendClearIndex >= 0 ? frames[lastSendClearIndex + 1] || null : null;
  const trailingReleasedFrames = [...frames].reverse().findIndex((frame) => (
    frame.sendClearTransition
    || frame.sendClearStyle?.hasTransitionAttribute
    || frame.sendClearStyle?.fromHeight
    || frame.sendClearStyle?.toHeight
  ));
  const sendClearStart = sendClearFrames[0] || null;
  const sendClearEnd = sendClearFrames.at(-1) || null;
  const discontinuities = frames.slice(1).flatMap((frame, index) => {
    const before = frames[index];
    const scrollTopDelta = Number(frame.scroller?.scrollTop || 0) - Number(before.scroller?.scrollTop || 0);
    const scrollHeightDelta = Number(frame.scroller?.scrollHeight || 0) - Number(before.scroller?.scrollHeight || 0);
    const anchorOffsetDelta = frame.anchor?.rowID && frame.anchor.rowID === before.anchor?.rowID
      ? Number(frame.anchor.top || 0) - Number(before.anchor.top || 0) : null;
    if (Math.abs(scrollTopDelta) <= 0.5 && Math.abs(scrollHeightDelta) <= 0.5 && (anchorOffsetDelta == null || Math.abs(anchorOffsetDelta) <= 0.5)) return [];
    return [{
      from: before.index, to: frame.index, at: frame.at, scrollTopDelta, scrollHeightDelta, anchorOffsetDelta,
      beforeAnchor: before.anchor, afterAnchor: frame.anchor,
      waitingBefore: before.waitingItems?.map((item) => item.requestID),
      waitingAfter: frame.waitingItems?.map((item) => item.requestID),
    }];
  });
  const entries = snapshot.readingTrace?.entries || [];
  const bottomIntents = entries.filter((entry) => entry.event === 'reading.bottom-intent');
  const issuerWrites = entries.filter((entry) => entry.event === 'reading.issuer-write');
  const issuerSatisfies = entries.filter((entry) => entry.event === 'reading.issuer-satisfy');
  const waitMountMutation = snapshot.mutations?.find((entry) => entry.added.some((node) => node.className.includes('agent-wait-layer')));
  // A local optimistic row can briefly precede the canonical queued Waiting
  // fact. The transition under test is the last insertion of this stable id:
  // the canonical waiting→timeline presentation handoff.
  const targetRowMutation = [...(snapshot.mutations || [])].reverse()
    .find((entry) => entry.added.some((node) => node.rowID === snapshot.targetRequestID));
  const targetCommitAt = targetRowMutation?.at || null;
  const beforeTargetCommit = targetCommitAt
    ? [...frames].reverse().find((frame) => frame.at < targetCommitAt) || null
    : null;
  const afterTargetCommitFrames = targetCommitAt
    ? frames.filter((frame) => frame.at >= targetCommitAt)
    : [];
  const afterTargetSettled = afterTargetCommitFrames.at(-1) || null;
  const markerTime = (name) => snapshot.markers?.find((entry) => entry.name === name)?.at || null;
  const waitingVisibleAt = markerTime('waiting-visible');
  const trustedWheelEvents = snapshot.wheelEvents?.filter((entry) => entry.trusted) || [];
  // Ownership changes at the browser's trusted input event, not when the test
  // finishes polling the resulting browsing state. Using the later marker can
  // hide a Virtuoso correction that lands between those two moments.
  const wheelAt = trustedWheelEvents[0]?.at || null;
  const lateWrites = waitMountMutation ? snapshot.writes.filter((entry) => entry.at > waitMountMutation.at + 0.5) : [];
  // A durable queued destination and its floating presentation can publish in
  // the same frame as the one authorized send return. What must never survive
  // that commit is a writer waiting for a later queue/running/layout event.
  const delayedWrites = waitMountMutation ? snapshot.writes.filter((entry) => entry.at > waitMountMutation.at + 50) : [];
  return {
    frameCount: frames.length,
    firstWaitingIndex,
    lastWaitingIndex,
    targetRequestID: snapshot.targetRequestID,
    waitMountAt: waitMountMutation?.at || null,
    transitionFrames: {
      baseline: frames[0] || null,
      beforeWaiting,
      firstWaiting,
      lastWaiting,
      afterWaiting,
    },
    geometryAtWaitMount: beforeWaiting && firstWaiting ? Object.fromEntries(
      ['reading', 'inputSlot', 'bottomStack', 'composerWrap', 'composerSurface'].map((key) => [key, geometryDelta(beforeWaiting, firstWaiting, key)]),
    ) : null,
    maxGeometryDriftAfterWaitMount: beforeWaiting ? Object.fromEntries(
      ['reading', 'inputSlot', 'bottomStack', 'composerWrap', 'composerSurface'].map((key) => [key, maxGeometryDrift(beforeWaiting, postMountFrames, key)]),
    ) : null,
    maxGeometryDriftFromFirstWaiting: firstWaiting ? Object.fromEntries(
      ['reading', 'inputSlot', 'bottomStack', 'composerWrap', 'composerSurface'].map((key) => [key, maxGeometryDrift(firstWaiting, postMountFrames, key)]),
    ) : null,
    sendClearTransition: {
      firstIndex: firstSendClearIndex,
      lastIndex: lastSendClearIndex,
      frameCount: sendClearFrameIndexes.length,
      anchorSteps: sendClearAnchorSteps,
      maxAnchorStep: sendClearAnchorSteps.length ? Math.max(...sendClearAnchorSteps.map(Math.abs)) : null,
      reverseSteps: sendClearAnchorSteps.filter((step) => step < -1),
      causalSteps: sendClearCausalSteps,
      unexplainedAnchorSteps: sendClearCausalSteps.filter((step) => step.viewportStatic && Math.abs(step.anchorDelta) > 1),
      totalBudget: sendClearStart && sendClearEnd ? {
        inputContraction: Number(sendClearStart.inputSlot?.height || 0) - Number(sendClearEnd.inputSlot?.height || 0),
        contentExtentDelta: Number(sendClearEnd.scroller?.scrollHeight || 0) - Number(sendClearStart.scroller?.scrollHeight || 0),
        anchorDelta: Number(sendClearEnd.anchor?.top || 0) - Number(sendClearStart.anchor?.top || 0),
        error: (Number(sendClearStart.inputSlot?.height || 0) - Number(sendClearEnd.inputSlot?.height || 0))
          - (Number(sendClearEnd.scroller?.scrollHeight || 0) - Number(sendClearStart.scroller?.scrollHeight || 0))
          - (Number(sendClearEnd.anchor?.top || 0) - Number(sendClearStart.anchor?.top || 0)),
        gapBefore: Number(sendClearStart.scroller?.gap || 0),
        gapAfter: Number(sendClearEnd.scroller?.gap || 0),
        obstructionBefore: Number(sendClearStart.waitingObstruction?.height || 0),
        obstructionAfter: Number(sendClearEnd.waitingObstruction?.height || 0),
      } : null,
      programmaticWrites: firstSendClearIndex >= 0 ? (snapshot.writes || []).filter((entry) => (
        entry.at >= frames[firstSendClearIndex].at
        && entry.at <= (frames[lastSendClearIndex + 1]?.at || frames[lastSendClearIndex].at)
      )) : [],
      settledGeometryDrift: sendClearSettled ? Object.fromEntries(
        ['reading', 'inputSlot', 'bottomStack', 'composerWrap', 'composerSurface'].map((key) => [key, maxGeometryDrift(sendClearSettled, frames.slice(lastSendClearIndex + 1), key)]),
      ) : null,
      terminal: snapshot.terminalState || null,
      trailingReleasedFrameCount: trailingReleasedFrames < 0 ? frames.length : trailingReleasedFrames,
    },
    discontinuities,
    bottomIntents,
    issuerWrites,
    issuerSatisfies,
    issuerAuthorities: [...issuerWrites, ...issuerSatisfies].map((entry) => ({
      event: entry.event,
      source: entry.detail?.source || '', authorization: entry.detail?.authorization || '',
      intentID: entry.detail?.intentID || '', snapshotRevision: entry.detail?.snapshotRevision || 0,
      activationID: entry.detail?.activationID || '', inputEpoch: entry.detail?.inputEpoch,
    })),
    programmaticWrites: snapshot.writes,
    targetCommitAt,
    transition: beforeTargetCommit && afterTargetSettled ? {
      before: beforeTargetCommit,
      after: afterTargetSettled,
      scrollTopDelta: Number(afterTargetSettled.scroller?.scrollTop || 0) - Number(beforeTargetCommit.scroller?.scrollTop || 0),
      scrollHeightDelta: Number(afterTargetSettled.scroller?.scrollHeight || 0) - Number(beforeTargetCommit.scroller?.scrollHeight || 0),
      gapBefore: Number(beforeTargetCommit.scroller?.gap || 0),
      gapAfter: Number(afterTargetSettled.scroller?.gap || 0),
      anchorOffsetDelta: beforeTargetCommit.anchor?.rowID === afterTargetSettled.anchor?.rowID
        ? Number(afterTargetSettled.anchor?.top || 0) - Number(beforeTargetCommit.anchor?.top || 0)
        : null,
    } : null,
    targetCommitWrites: targetCommitAt ? snapshot.writes.filter((entry) => entry.at >= targetCommitAt - 0.5) : [],
    followMechanism: targetCommitAt && snapshot.writes.some((entry) => entry.at >= targetCommitAt - 0.5)
      ? 'observed-application-public-layout-write'
      : 'public-virtuoso-layout-follow',
    wheelAt,
    trustedWheelEvents,
    writesAfterWheel: wheelAt ? snapshot.writes.filter((entry) => entry.at > wheelAt + 0.5) : [],
    lateWritesAfterWaitMount: lateWrites,
    delayedWritesAfterWaitMountSettle: delayedWrites,
    resizeCallbacksNearWaitMount: waitMountMutation ? snapshot.resizes.filter((entry) => Math.abs(entry.at - waitMountMutation.at) < 40) : [],
    prematureTargetTimelineRows: waitingVisibleAt ? (snapshot.mutations || []).filter((entry) => (
      entry.at <= waitingVisibleAt
      && entry.added.some((node) => node.rowID && node.text.includes('waiting-target'))
    )) : [],
  };
}

async function persist(testInfo, name, payload) {
  const path = testInfo.outputPath(name);
  await writeFile(path, JSON.stringify(payload, null, 2));
  await testInfo.attach(name, { path, contentType: 'application/json' });
  return path;
}

async function runTrajectory({ page, request, testInfo, mode }) {
  const wheelTakeover = mode === 'wheel-takeover-after-send';
  const multiline = mode === 'following-multiline-clear';
  const existingWaiting = mode === 'following-existing-waiting';
  const scenario = 'long-running-history';
  const seed = wheelTakeover ? 0x92_09_23 : multiline ? 0x92_09_24 : existingWaiting ? 0x92_09_25 : 0x92_09_17;
  const ownerText = `owner-${mode}`;
  const targetNeedle = `waiting-target-${mode}`;
  const targetText = multiline
    ? `${targetNeedle}\n第二行用于扩展输入区\n第三行记录清空的高度传播\n第四行保持足够高的编辑器\n第五行用于观察首帧绘制`
    : targetNeedle;
  await page.setViewportSize({ width: 1120, height: 760 });
  await reset(request, scenario, seed);
  await login(page, { history: true });
  await page.locator('.timeline-message-list').evaluate((node) => node.scrollTo({ top: node.scrollHeight, behavior: 'auto' }));
  await page.waitForFunction(() => {
    const node = document.querySelector('.timeline-message-list');
    return node && node.scrollHeight - node.clientHeight - node.scrollTop <= 2;
  });
  await sendOwner(page, ownerText);

  if (existingWaiting) {
    const preexistingText = `preexisting-waiting-${mode}`;
    await composeForSteward(page, preexistingText);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.waitForFunction((needle) => [...document.querySelectorAll('.agent-wait-item')]
      .some((node) => node.textContent?.includes(needle)), preexistingText, { timeout: 10_000 });
  }

  await composeForSteward(page, targetText);
  if (multiline) {
    await page.waitForFunction(() => (
      (document.querySelector('.conversation-input-slot')?.getBoundingClientRect().height || 0) > 150
      && (document.querySelector('.composer-editor')?.getBoundingClientRect().height || 0) > 80
    ));
    // Establish the trajectory's public precondition after multiline input
    // has resized the viewport. This setup write happens before the probe: the
    // business oracle begins from a genuinely following, gap-zero paint.
    await page.locator('.timeline-message-list').evaluate((node) => node.scrollTo({ top: node.scrollHeight, behavior: 'auto' }));
    await page.waitForFunction(() => {
      const node = document.querySelector('.timeline-message-list');
      return node && node.scrollHeight - node.clientHeight - node.scrollTop <= 1;
    });
  }
  const precondition = await page.evaluate(() => {
    const scroller = document.querySelector('.timeline-message-list');
    const input = document.querySelector('.conversation-input-slot');
    const editor = document.querySelector('.composer-editor');
    return {
      inputHeight: input?.getBoundingClientRect().height || 0,
      editorHeight: editor?.getBoundingClientRect().height || 0,
      scrollTop: Number(scroller?.scrollTop || 0),
      scrollHeight: Number(scroller?.scrollHeight || 0),
      clientHeight: Number(scroller?.clientHeight || 0),
      gap: scroller ? Number(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop) : null,
    };
  });
  await installProbe(page, mode);
  let operationFailure = null;
  try {
    await mark(page, 'send-click-before');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await mark(page, 'send-click-after');
    await page.waitForFunction(() => String(document.querySelector('.composer-editor')?.textContent || '').trim() === '');
    await mark(page, 'durable-draft-cleared');
    await page.waitForFunction((needle) => [...document.querySelectorAll('.agent-wait-item')]
      .some((node) => node.textContent?.includes(needle)), targetNeedle, { timeout: 10_000 });
    await mark(page, 'waiting-visible');
    await page.waitForFunction(() => (window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.().entries || [])
      .some((entry) => (
        (entry.event === 'reading.issuer-write' || entry.event === 'reading.issuer-satisfy')
        && String(entry.detail?.intentID || '').startsWith('composer:send-start:')
      )));
    await mark(page, 'initial-send-authorization-observed');
    if (wheelTakeover) {
      await page.locator('.timeline-message-list').hover();
      await mark(page, 'trusted-wheel-before');
      await page.mouse.wheel(0, -900);
      await page.waitForFunction(() => {
        const node = document.querySelector('.timeline-message-list');
        return node && node.scrollHeight - node.clientHeight - node.scrollTop > 100
          && document.querySelector('.timeline')?.dataset.viewportMode === 'browsing';
      });
      await mark(page, 'trusted-wheel-took-control');
    }
    await page.waitForTimeout(240);
    for (let step = 1; step <= 3; step += 1) {
      await mark(page, `advance-${step}-before`);
      const advanced = await request.post(`${MOCK}/mock/control/advance`, { data: { ms: 0, compute: { channel_id: 'c0' } } });
      if (!advanced.ok()) throw new Error(`advance ${step} failed: ${advanced.status()} ${await advanced.text()}`);
      await mark(page, `advance-${step}-after`, await advanced.json());
      await page.waitForTimeout(90);
    }
    await page.waitForFunction((needle) => (
      ![...document.querySelectorAll('.agent-wait-item')].some((node) => node.textContent?.includes(needle))
    ), targetNeedle, { timeout: 5_000 });
    await mark(page, 'waiting-promoted-to-running');
    await page.waitForTimeout(240);
  } catch (error) {
    operationFailure = error;
    await mark(page, 'operation-failure', conciseError(error)).catch(() => {});
  }
  const snapshot = await page.evaluate(() => {
    window.__waitingSendProbe?.stop?.();
    return window.__waitingSendProbe?.snapshot?.() || null;
  });
  const summary = snapshot ? summarize(snapshot) : null;
  const artifact = {
    schema: 1,
    capturedAt: new Date().toISOString(),
    scenario, seed, mode, ownerText, targetText, targetNeedle, precondition,
    oracle: {
      coordinateTolerancePx: 1,
      discontinuityThresholdPx: 0.5,
      expectedBottomIntentReason: 'composer:send-start',
      followingTailMustTrackRealExtent: true,
      followingMechanismMayBePublicVirtuosoOrObservedApplicationLayout: true,
      wheelTakeoverForbidsLaterProgrammaticWrites: true,
      waitingMountMayAffectReadingOrComposerGeometry: false,
      artifactOrdering: 'writeFile-and-attach-before-business-expect',
    },
    source: await fingerprint(),
    operationFailure: conciseError(operationFailure),
    summary,
    snapshot,
  };
  const artifactPath = await persist(testInfo, `${mode}-waiting-send-transaction.json`, artifact);

  if (operationFailure) throw new Error(`trajectory failed after artifact persisted at ${artifactPath}: ${operationFailure.message}`);
  expect(snapshot, 'probe snapshot').not.toBeNull();
  if (multiline) {
    expect(precondition.inputHeight, 'multiline trajectory must begin with an expanded input slot').toBeGreaterThan(150);
    expect(precondition.editorHeight, 'multiline trajectory must contain painted editor lines').toBeGreaterThan(80);
    expect(precondition.gap, 'multiline clear must begin from the physical tail').toBeLessThanOrEqual(1);
  }
  expect(summary.targetRequestID, 'queued fact must expose the stable request id').not.toBe('');
  expect(summary.bottomIntents.map((entry) => entry.detail?.reason)).toEqual(['composer:send-start']);
  expect(summary.prematureTargetTimelineRows,
    'an agent request committed to Waiting must never create a transient list row before that destination is visible').toEqual([]);
  if (multiline) {
    expect(summary.sendClearTransition.frameCount,
      'durable clear has no presentation transition owner').toBe(0);
    expect(summary.sendClearTransition.programmaticWrites,
      'direct clear never chases its overlay geometry with scroll methods').toEqual([]);
    const terminal = summary.sendClearTransition.terminal;
    expect(terminal, 'terminal composer state is captured in the artifact').not.toBeNull();
    expect(terminal.hasTransitionAttribute, 'terminal input slot has no send-clear owner').toBe(false);
    expect(terminal.transition, 'terminal input slot has no transition phase').toBe('');
    expect(terminal.fromHeight, 'terminal input slot releases the from-height').toBe('');
    expect(terminal.toHeight, 'terminal input slot releases the to-height').toBe('');
    expect(['hidden', 'clip'], 'terminal input slot releases horizontal clipping').not.toContain(terminal.overflowX);
    expect(['hidden', 'clip'], 'terminal input slot releases vertical clipping').not.toContain(terminal.overflowY);
    for (const key of ['inputSlot', 'composer', 'editor']) {
      const metrics = terminal[key];
      expect(metrics, `${key} terminal metrics exist`).not.toBeNull();
      expect(Number.isFinite(metrics?.clientHeight), `${key}.clientHeight is finite`).toBe(true);
      expect(Number.isFinite(metrics?.scrollHeight), `${key}.scrollHeight is finite`).toBe(true);
      expect(metrics.clientHeight + 1, `${key} content remains reachable after clear`).toBeGreaterThanOrEqual(metrics.scrollHeight);
    }
    for (const label of ['send', 'upload-local', 'choose-channel-file']) {
      expect(terminal.controls.find((row) => row.label === label)?.present, `${label} remains present after clear`).toBe(true);
    }
    for (const control of terminal.controls.filter((row) => row.present)) {
      expect(control.rect.width, `${control.label} retains a painted hit width`).toBeGreaterThan(0);
      expect(control.rect.height, `${control.label} retains a painted hit height`).toBeGreaterThan(0);
      expect(control.owned, `${control.label} center hit remains owned by that control`).toBe(true);
    }
  } else {
    expect(summary.geometryAtWaitMount?.reading?.height || 0).toBeLessThanOrEqual(1);
    expect(Math.abs(summary.geometryAtWaitMount?.inputSlot?.height || 0)).toBeLessThanOrEqual(1);
    expect(Math.abs(summary.geometryAtWaitMount?.composerWrap?.top || 0)).toBeLessThanOrEqual(1);
    expect(Math.abs(summary.geometryAtWaitMount?.composerWrap?.height || 0)).toBeLessThanOrEqual(1);
  }
  for (const key of ['reading', 'inputSlot', 'bottomStack', 'composerWrap', 'composerSurface']) {
    for (const field of ['top', 'bottom', 'height', 'clientHeight']) {
      const drift = summary.maxGeometryDriftFromFirstWaiting?.[key]?.[field];
      expect(Number.isFinite(drift), `${key}.${field} drift must be measured, not defaulted`).toBe(true);
      expect(drift, `${key}.${field} stays stable after the durable clear settles through running`).toBeLessThanOrEqual(1);
    }
  }
  expect(summary.programmaticWrites.filter((entry) => entry.method === 'scrollTop=')).toEqual([]);
  expect(summary.transition?.scrollHeightDelta, 'waiting→timeline must publish its real list extent').toBeGreaterThan(100);
  if (wheelTakeover) {
    expect(summary.trustedWheelEvents.length, 'takeover must be a trusted browser wheel input').toBeGreaterThan(0);
    expect(summary.writesAfterWheel, 'wheel ownership forbids any later programmatic writer').toEqual([]);
    expect(summary.transition?.scrollTopDelta, 'browsing transition keeps physical scrollTop').toBe(0);
    expect(summary.transition?.anchorOffsetDelta, 'browsing transition keeps the visible anchor').toBeLessThanOrEqual(1);
  } else {
    expect(summary.transition?.gapBefore, 'following begins at the installed tail').toBeLessThanOrEqual(1);
    expect(summary.transition?.gapAfter, 'public height acknowledgement keeps following at the new tail').toBeLessThanOrEqual(1);
    expect(summary.transition?.scrollTopDelta, 'following moves by the real appended extent').toBeGreaterThan(100);
    // Public Virtuoso may preserve a following viewport as part of its own
    // layout reconciliation without crossing the instrumented application
    // writer boundary. The contract is the physical tail result and the lack
    // of a competing explicit intent, not a mandatory JS method invocation.
    expect(['observed-application-public-layout-write', 'public-virtuoso-layout-follow'])
      .toContain(summary.followMechanism);
  }
}

for (const mode of [
  'following-at-bottom',
  'following-multiline-clear',
  'following-existing-waiting',
  'wheel-takeover-after-send',
]) {
  test(`real App send transaction keeps queued WaitingLayer out of ${mode} geometry`, async ({ page, request }, testInfo) => {
    test.slow();
    await runTrajectory({ page, request, testInfo, mode });
  });
}
