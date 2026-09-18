import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

const SEED = 0x1e_09_18;
const EVIDENCE_DIR = process.env.ATOLL_LIVE_ENTRY_OUT || '';

async function persistEvidence(name, value) {
  if (!EVIDENCE_DIR) return;
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(resolve(EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'long-running-history', seed: SEED },
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
  await expect(page.locator('[data-reading-container="following-tail"]')).toBeVisible();
}

async function append(request, data = {}) {
  const response = await request.post(`${MOCK}/mock/control/action`, {
    data: { type: 'q_tail_append', channel_id: 'c0', ...data },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function armProbe(page) {
  await page.evaluate(() => {
    const frames = [];
    const animationSettles = [];
    const nativeFinish = Animation.prototype.finish;
    Animation.prototype.finish = function finish(...args) {
      const target = this.effect?.target;
      const root = target?.closest?.('.timeline-message-list');
      const before = target?.dataset?.liveEntryTransition === 'running' ? {
        phase: window.__liveEntryPhase || '',
        rowID: target.dataset.presentationRowId || '',
        height: Number(target.getBoundingClientRect().height.toFixed(2)),
        scrollTop: Number(root?.scrollTop || 0),
      } : null;
      const result = nativeFinish.apply(this, args);
      if (before) animationSettles.push({
        ...before,
        finalHeight: Number(target.getBoundingClientRect().height.toFixed(2)),
      });
      return result;
    };
    const identities = new WeakMap();
    let identity = 0;
    let stopped = false;
    const nodeIdentity = (node) => {
      if (!node) return 0;
      if (!identities.has(node)) identities.set(node, ++identity);
      return identities.get(node);
    };
    const tick = () => {
      if (stopped) return;
      const root = document.querySelector('.timeline-reading-layer.is-active .timeline-message-list')
        || document.querySelector('.timeline-reading-layer.is-outgoing .timeline-message-list');
      const transitions = root ? [...root.querySelectorAll('[data-live-entry-transition="running"]')]
        .map((node) => ({
          id: node.dataset.presentationRowId || '',
          identity: nodeIdentity(node),
          height: Number(node.getBoundingClientRect().height.toFixed(2)),
          track: getComputedStyle(node).gridTemplateRows,
        })) : [];
      const rows = root ? [...root.querySelectorAll('[data-presentation-row-id]')] : [];
      const obstruction = root?.querySelector('.timeline-waiting-obstruction');
      frames.push({
        frame: frames.length,
        at: Number(performance.now().toFixed(1)),
        phase: window.__liveEntryPhase || '',
        container: root?.dataset.readingContainer || 'none',
        scrollTop: root ? Number(Number(root.scrollTop || 0).toFixed(2)) : null,
        transitions,
        rows: rows.map((node) => ({
          id: node.dataset.presentationRowId || '',
          identity: nodeIdentity(node),
          height: Number(node.getBoundingClientRect().height.toFixed(2)),
          offset: root
            ? Number((node.getBoundingClientRect().top - root.getBoundingClientRect().top).toFixed(2))
            : null,
        })),
        obstructionHeight: obstruction
          ? Number(obstruction.getBoundingClientRect().height.toFixed(2))
          : null,
        activeTag: document.activeElement?.tagName || '',
        activeTestID: document.activeElement?.dataset?.testid || '',
      });
      if (frames.length < 12_000) requestAnimationFrame(tick);
    };
    window.__liveEntryPhase = 'armed';
    window.__liveEntryProbe = {
      frames,
      setPhase(value) { window.__liveEntryPhase = value; },
      identity(rowID) {
        return nodeIdentity(document.querySelector(`[data-presentation-row-id="${CSS.escape(rowID)}"]`));
      },
      animationSettles,
      stop() { stopped = true; return frames; },
    };
    requestAnimationFrame(tick);
  });
}

const phase = (page, value) => page.evaluate((next) => window.__liveEntryProbe.setPhase(next), value);

function phaseFrames(frames, name) {
  return frames.filter((frame) => frame.phase === name);
}

function transitionHeights(frames, phaseName, rowID) {
  return phaseFrames(frames, phaseName)
    .flatMap((frame) => frame.transitions.filter((item) => item.id === rowID))
    .map((item) => item.height);
}

test('live tail entry is one interruptible layout transaction, never replayed as history', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1120, height: 680 });
  await reset(request);
  await login(page);
  const scope = page.getByRole('group', { name: '动态范围' })
    .getByRole('button', { name: /^(@我|全部)$/ });
  if (await scope.textContent() === '@我') await scope.click();
  await expect(scope).toHaveText('全部');
  await expect(page.locator('[data-reading-container="following-tail"]')).toBeVisible();
  await armProbe(page);

  const composer = page.getByTestId('composer-input');
  await composer.click();
  const stableRowID = await page.locator('[data-presentation-row-id]').first()
    .getAttribute('data-presentation-row-id');
  const stableIdentity = await page.evaluate(
    (rowID) => window.__liveEntryProbe.identity(rowID),
    stableRowID,
  );

  await phase(page, 'single');
  const single = await append(request, {
    ask: 'single smooth entry',
    text: `single-entry ${'自然高度内容 '.repeat(28)}`,
  });
  const singleID = single.request_id;
  await expect(page.locator(`[data-presentation-row-id="${singleID}"]`)).toHaveCount(1);
  await expect.poll(() => page.locator('[data-live-entry-transition="running"]').count()).toBeGreaterThan(0);
  await expect.poll(() => page.locator('[data-live-entry-transition="running"]').count()).toBe(0);
  expect(await page.evaluate((rowID) => window.__liveEntryProbe.identity(rowID), stableRowID))
    .toBe(stableIdentity);
  await expect(composer).toBeFocused();

  await phase(page, 'same-batch');
  const batchResponse = await request.post(`${MOCK}/mock/control/action`, {
    data: { type: 'notification_lifecycle', channel_id: 'c0', phase: 'tail', count: 4 },
  });
  expect(batchResponse.ok()).toBe(true);
  const batch = await batchResponse.json();
  const batchIDs = batch.rows.map((row) => row.envelope.id);
  await expect(page.locator(`[data-presentation-row-id="${batchIDs.at(-1)}"]`)).toHaveCount(1);
  await page.waitForTimeout(300);

  await phase(page, 'continuous');
  const continuous = [];
  for (let index = 0; index < 4; index += 1) {
    continuous.push(await append(request, {
      ask: `continuous ${index}`,
      text: `continuous-entry-${index} ${'批次更新 '.repeat(16 + index * 5)}`,
    }));
    await page.waitForTimeout(45);
  }
  await expect(page.locator(`[data-presentation-row-id="${continuous.at(-1).request_id}"]`)).toHaveCount(1);
  await page.waitForTimeout(300);

  await phase(page, 'interrupt');
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.enable({ case: 'live-entry-interrupt' }));
  const following = page.locator('[data-reading-container="following-tail"]');
  const box = await following.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const interrupted = await append(request, {
    ask: 'interrupt entry',
    text: `interrupt-entry ${'用户输入优先 '.repeat(40)}`,
  });
  await expect(page.locator(`[data-presentation-row-id="${interrupted.request_id}"][data-live-entry-transition="running"]`))
    .toHaveCount(1);
  await page.mouse.wheel(0, -640);
  await expect(page.locator('[data-live-entry-transition="running"]')).toHaveCount(0);
  await expect(page.locator('.timeline-reading-layer.is-active [data-reading-container="following-tail"]'))
    .toHaveCount(0);

  await phase(page, 'browsing');
  const browsing = await append(request, {
    ask: 'browsing arrival',
    text: `browsing-entry ${'不得推动阅读位置 '.repeat(24)}`,
  });
  await expect(page.locator(`[data-presentation-row-id="${browsing.request_id}"]`)).toHaveCount(1);
  await page.waitForTimeout(260);

  const jump = page.locator('.timeline-jump-latest');
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(page.locator('[data-reading-container="following-tail"]')).toBeVisible();

  await phase(page, 'inactive-channel');
  await page.locator('.channel-item').filter({
    has: page.locator('.channel-name', { hasText: /^c0\.project$/ }),
  }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  const cold = await append(request, {
    ask: 'inactive channel arrival',
    text: 'cold-return-entry must already be ordinary restored content',
  });
  await page.waitForTimeout(120);
  await phase(page, 'cold-return');
  await page.locator('.channel-item').filter({
    has: page.locator('.channel-name', { hasText: /^c0$/ }),
  }).click();
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.locator(`[data-presentation-row-id="${cold.request_id}"]`)).toHaveCount(1);
  await page.waitForTimeout(280);

  const evidence = await page.evaluate(() => ({
    frames: window.__liveEntryProbe.stop(),
    animationSettles: window.__liveEntryProbe.animationSettles,
    readingTrace: window.__ATOLL_DIAGNOSTICS__.reading.snapshot(),
  }));
  const { frames, animationSettles, readingTrace } = evidence;
  await testInfo.attach('live-tail-entry-frames.json', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });

  const singleHeights = transitionHeights(frames, 'single', singleID);
  const singleDistinct = [...new Set(singleHeights)];
  const maxBatchActive = Math.max(0, ...phaseFrames(frames, 'same-batch')
    .map((frame) => frame.transitions.length));
  const maxContinuousActive = Math.max(0, ...phaseFrames(frames, 'continuous')
    .map((frame) => frame.transitions.length));
  const continuousIntervals = continuous.map(({ request_id: rowID }) => {
    const activeFrames = phaseFrames(frames, 'continuous')
      .filter((frame) => frame.transitions.some((item) => item.id === rowID))
      .map((frame) => frame.frame);
    const breaks = activeFrames.filter((frame, index) => index > 0 && frame !== activeFrames[index - 1] + 1);
    return { rowID, activeFrames, breaks };
  });
  const badTailFrames = frames.filter((frame) => frame.container === 'following-tail'
    && frame.phase !== 'interrupt'
    && Math.abs(frame.scrollTop || 0) > 0.5);
  const badReserveFrames = frames.filter((frame) => frame.container === 'following-tail'
    && frame.obstructionHeight !== 48);
  const browsingTransitions = phaseFrames(frames, 'browsing')
    .flatMap((frame) => frame.transitions);
  const coldTransitions = phaseFrames(frames, 'cold-return')
    .flatMap((frame) => frame.transitions);
  const interruptSettle = animationSettles.find((entry) => entry.phase === 'interrupt'
    && entry.rowID === interrupted.request_id);
  const navigationTargets = readingTrace.entries.filter((entry) => entry.event === 'reading.navigation-target');
  const settledTarget = [...navigationTargets].reverse().find((entry) => entry.detail?.phase === 'settled')
    || navigationTargets.at(-1);
  const targetID = settledTarget?.detail?.targetID || '';
  const desiredOffset = Number(settledTarget?.detail?.targetViewportOffset);
  const outgoingTargetFrames = phaseFrames(frames, 'interrupt')
    .filter((frame) => frame.container === 'following-tail')
    .map((frame) => frame.rows.find((row) => row.id === targetID))
    .filter(Boolean);
  const incomingTargetFrames = frames
    .filter((frame) => frame.frame > (phaseFrames(frames, 'interrupt').at(-1)?.frame || 0)
      && frame.container !== 'following-tail')
    .map((frame) => frame.rows.find((row) => row.id === targetID))
    .filter(Boolean);
  const firstIncomingOffset = incomingTargetFrames[0]?.offset;
  const summary = {
    singleHeights,
    maxBatchActive,
    maxContinuousActive,
    continuousIntervals,
    badTailFrames,
    badReserveFrames,
    browsingTransitions,
    coldTransitions,
    interruptSettle,
    settledTarget: settledTarget?.detail || null,
    outgoingTargetFrames,
    firstIncomingOffset,
  };
  await testInfo.attach('live-tail-entry-summary.json', {
    body: JSON.stringify(summary, null, 2), contentType: 'application/json',
  });
  await persistEvidence('live-tail-entry-frames.json', evidence);
  await persistEvidence('live-tail-entry-summary.json', summary);

  expect(singleDistinct.length, JSON.stringify(summary)).toBeGreaterThan(2);
  expect(singleHeights.at(0), JSON.stringify(summary)).toBeLessThan(singleHeights.at(-1));
  expect(maxBatchActive, JSON.stringify(summary)).toBeGreaterThan(1);
  expect(maxContinuousActive, JSON.stringify(summary)).toBeGreaterThan(1);
  expect(continuousIntervals.every((entry) => entry.activeFrames.length > 1
    && entry.breaks.length === 0), JSON.stringify(summary)).toBe(true);
  expect(badTailFrames, JSON.stringify(summary)).toEqual([]);
  expect(badReserveFrames, JSON.stringify(summary)).toEqual([]);
  expect(browsingTransitions, JSON.stringify(summary)).toEqual([]);
  expect(coldTransitions, JSON.stringify(summary)).toEqual([]);
  expect(interruptSettle, JSON.stringify(summary)).toBeTruthy();
  expect(interruptSettle.finalHeight, JSON.stringify(summary)).toBeGreaterThanOrEqual(interruptSettle.height);
  expect(targetID, JSON.stringify(summary)).not.toBe('');
  expect(Number.isFinite(desiredOffset), JSON.stringify(summary)).toBe(true);
  expect(outgoingTargetFrames.length, JSON.stringify(summary)).toBeGreaterThan(0);
  expect(Number.isFinite(firstIncomingOffset), JSON.stringify(summary)).toBe(true);
  expect(Math.abs(firstIncomingOffset - desiredOffset), JSON.stringify(summary)).toBeLessThanOrEqual(2);
});

test('reduced motion installs the live row directly at final layout', async ({ page, request }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await reset(request);
  await login(page);
  await armProbe(page);
  await phase(page, 'reduced');
  const row = await append(request, {
    ask: 'reduced motion entry', text: `reduced-entry ${'最终布局 '.repeat(24)}`,
  });
  await expect(page.locator(`[data-presentation-row-id="${row.request_id}"]`)).toHaveCount(1);
  await page.waitForTimeout(260);
  const frames = await page.evaluate(() => window.__liveEntryProbe.stop());
  const transitions = phaseFrames(frames, 'reduced').flatMap((frame) => frame.transitions);
  const summary = {
    rowID: row.request_id,
    frameCount: frames.length,
    transitions,
    badTailFrames: frames.filter((frame) => frame.container === 'following-tail'
      && Math.abs(frame.scrollTop || 0) > 0.5),
  };
  await testInfo.attach('live-tail-entry-reduced.json', {
    body: JSON.stringify(summary, null, 2), contentType: 'application/json',
  });
  await persistEvidence('live-tail-entry-reduced.json', summary);
  expect(transitions).toEqual([]);
  expect(summary.badTailFrames).toEqual([]);
});
