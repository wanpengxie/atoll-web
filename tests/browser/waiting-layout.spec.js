import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const OUT = process.env.ATOLL_COMPOSER_OVERLAY_OUT || '';

async function sourceFingerprint() {
  const paths = [
    'src/ui/conversation/ConversationSurface.jsx',
    'src/ui/Timeline.jsx',
    'src/styles/app-shell.css',
    'src/styles/responsive.css',
    'src/styles/timeline.css',
  ];
  const hash = createHash('sha256');
  for (const path of paths) hash.update(path).update('\0').update(await readFile(path));
  return { algorithm: 'sha256', paths, digest: hash.digest('hex') };
}

async function persistEvidence(testInfo, name, payload) {
  const path = testInfo.outputPath(name);
  const body = JSON.stringify({
    capturedAt: new Date().toISOString(),
    oracle: { coordinateTolerancePx: 1, sampledFrames: 16 },
    source: await sourceFingerprint(),
    ...payload,
  }, null, 2);
  await writeFile(path, body);
  await testInfo.attach(name, { path, contentType: 'application/json' });
  if (OUT) {
    await mkdir(OUT, { recursive: true });
    await writeFile(resolve(OUT, name), `${body}\n`);
  }
}

function expectRect(actual, expected, context) {
  for (const key of ['top', 'right', 'bottom', 'left', 'width', 'height']) {
    expect(Math.abs(actual[key] - expected[key]), `${context}:${key}`).toBeLessThanOrEqual(1);
  }
}

test('Waiting and status facts never change the fixed reading or Composer allocation', async ({ page }, testInfo) => {
  await page.goto('/tests/browser/fixtures/waiting-layout.html');
  await page.waitForFunction(() => window.waitingLayout?.geometry().composer?.height > 0);
  const baseline = await page.evaluate(() => window.waitingLayout.geometry());

  const trajectories = [];
  for (const [label, patch] of [
    ['queued', { fact: 'queued' }],
    ['partial evidence', { fact: 'partial' }],
    ['roster refresh', { fact: 'roster', rosterRevision: 2 }],
    ['edit queued', { fact: 'queued', editing: true }],
    ['running', { fact: 'running', editing: false }],
    ['terminal', { fact: 'terminal' }],
    ['offline', { network: 'offline' }],
    ['queued locally', { network: 'queued' }],
    ['network restored', { network: 'open' }],
  ]) {
    trajectories.push({
      label,
      frames: await page.evaluate((next) => window.waitingLayout.transition(next, 16), patch),
    });
  }
  await persistEvidence(testInfo, 'fixed-overlay-waiting.json', { baseline, trajectories });

  expect(Math.abs((baseline.surface.bottom - baseline.reading.bottom) - 132)).toBeLessThanOrEqual(1);
  expect(Math.abs((baseline.stack.top - baseline.reading.bottom) - 32)).toBeLessThanOrEqual(1);
  expect(baseline.lastRow.bottom).toBeLessThanOrEqual(baseline.reading.bottom + 1);
  expect(baseline.lastRowOwnsHit).toBe(true);
  for (const { label, frames } of trajectories) {
    for (const [index, frame] of frames.entries()) {
      expectRect(frame.reading, baseline.reading, `${label}:frame-${index}:reading`);
      expectRect(frame.stack, baseline.stack, `${label}:frame-${index}:stack`);
      expectRect(frame.input, baseline.input, `${label}:frame-${index}:input`);
      expectRect(frame.composer, baseline.composer, `${label}:frame-${index}:composer`);
      if (frame.waiting) {
        expect(Math.abs(frame.waiting.bottom - frame.stack.top),
          `${label}:Waiting remains attached to current Composer top`).toBeLessThanOrEqual(1);
      }
    }
  }
});

test('input growth and clear stay inside the overlay while reading client geometry is constant', async ({ page }, testInfo) => {
  await page.goto('/tests/browser/fixtures/waiting-layout.html');
  await page.waitForFunction(() => window.waitingLayout?.geometry().composer?.height > 0);
  const oneLine = await page.evaluate(() => window.waitingLayout.geometry());
  const grownFrames = await page.evaluate(() => window.waitingLayout.transition({ lines: 6 }, 16));
  const grown = grownFrames.at(-1);
  const submitFrames = await page.evaluate(() => window.waitingLayout.transition({
    lines: 1,
    fact: 'queued',
    network: 'queued',
  }, 16));
  await persistEvidence(testInfo, 'fixed-overlay-input-growth.json', {
    oneLine, grownFrames, submitFrames,
  });

  expect(grown.input.height).toBeGreaterThan(oneLine.input.height);
  expect(Math.abs(grown.input.bottom - oneLine.input.bottom)).toBeLessThanOrEqual(1);
  expect(grown.input.height).toBeLessThanOrEqual(320);
  expect(grown.stack.top - grown.surface.top).toBeGreaterThanOrEqual(192);
  for (const [index, frame] of [...grownFrames, ...submitFrames].entries()) {
    expectRect(frame.reading, oneLine.reading, `frame-${index}:reading`);
  }
  for (const frame of submitFrames) {
    expectRect(frame.input, oneLine.input, 'clear installs final input geometry directly');
    expect(frame.waiting?.height || 0).toBeGreaterThan(0);
    expect(Math.abs(frame.waiting.bottom - frame.stack.top)).toBeLessThanOrEqual(1);
  }
  expect(await page.locator('[data-input-resize-transition], [data-send-clear-transition]').count()).toBe(0);
});

test('short mobile-style Surface keeps focus and makes oversized Composer internally scrollable', async ({ page }, testInfo) => {
  await page.goto('/tests/browser/fixtures/waiting-layout.html');
  await page.waitForFunction(() => window.waitingLayout?.geometry().composer?.height > 0);
  await page.locator('.composer-editor').focus();
  const editor = page.locator('.composer-editor');
  const before = await page.evaluate(() => window.waitingLayout.geometry());
  const frames = await page.evaluate(async () => {
    document.getElementById('root').style.height = '300px';
    return window.waitingLayout.transition({ lines: 24 }, 16);
  });
  const after = frames.at(-1);
  const scrollEvidence = await page.locator('.composer-editor').evaluate((editor) => {
    const slot = editor.closest('.conversation-input-slot');
    const beforeScroll = editor.scrollTop;
    editor.scrollTop = editor.scrollHeight;
    const bounds = slot.getBoundingClientRect();
    const send = document.querySelector('.composer-toolbar button')?.getBoundingClientRect();
    return {
      clientHeight: editor.clientHeight,
      scrollHeight: editor.scrollHeight,
      beforeScroll,
      afterScroll: editor.scrollTop,
      overflowY: getComputedStyle(editor).overflowY,
      sendBottom: send?.bottom || 0,
      slotTop: bounds.top,
      slotBottom: bounds.bottom,
    };
  });
  await persistEvidence(testInfo, 'fixed-overlay-short-surface.json', {
    before, frames, after, scrollEvidence,
  });

  await expect(editor).toBeFocused();
  expect(Math.abs((after.surface.bottom - after.reading.bottom) - 132)).toBeLessThanOrEqual(1);
  expect(after.reading.height).toBeGreaterThan(0);
  expect(scrollEvidence.overflowY).toBe('auto');
  expect(scrollEvidence.scrollHeight).toBeGreaterThan(scrollEvidence.clientHeight);
  expect(scrollEvidence.afterScroll).toBeGreaterThan(scrollEvidence.beforeScroll);
  expect(scrollEvidence.sendBottom).toBeLessThanOrEqual(scrollEvidence.slotBottom + 1);
  expect(scrollEvidence.sendBottom).toBeGreaterThanOrEqual(scrollEvidence.slotTop - 1);
});

test('production Timeline keeps queued to running to terminal outside the fixed geometry', async ({ page }, testInfo) => {
  await page.goto('/tests/browser/fixtures/waiting-timeline.html');
  await page.waitForFunction(() => window.waitingTimeline?.geometry().composer?.height > 0);
  const baseline = await page.evaluate(() => window.waitingTimeline.geometry());
  const trajectory = [];
  for (const [label, patch] of [
    ['queued', { fact: 'queued' }],
    ['partial', { fact: 'partial' }],
    ['roster', { fact: 'roster', rosterRevision: 2 }],
    ['running', { fact: 'running' }],
    ['terminal', { fact: 'terminal' }],
  ]) {
    trajectory.push({ label, frames: await page.evaluate(
      ({ next, count }) => window.waitingTimeline.transition(next, count),
      { next: patch, count: 16 },
    ) });
  }
  await persistEvidence(testInfo, 'fixed-overlay-production-waiting.json', { baseline, trajectory });
  for (const { label, frames } of trajectory) {
    for (const [index, frame] of frames.entries()) {
      expectRect(frame.reading, baseline.reading, `timeline-${label}:frame-${index}:reading`);
      expectRect(frame.stack, baseline.stack, `timeline-${label}:frame-${index}:stack`);
      expectRect(frame.input, baseline.input, `timeline-${label}:frame-${index}:input`);
    }
  }
});

test('production Timeline exposes compact actor controls with request-scoped commands', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/waiting-timeline.html');
  await page.waitForFunction(() => window.waitingTimeline?.geometry().composer?.height > 0);

  await page.evaluate(() => window.waitingTimeline.transition({ fact: 'queued', authority: true, capabilityKnown: false }, 2));
  const waiting = page.getByRole('region', { name: '等待区' });
  await expect(waiting.getByRole('button', { name: '插入', exact: true })).toBeVisible();
  await expect(waiting.getByText('正在确认 Agent 编辑能力', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.waitingTimeline.capabilityRequests())).toContainEqual({
    actorId: 'agent',
    channelId: 'fixture',
  });

  await page.evaluate(() => window.waitingTimeline.transition({ capabilityKnown: true }, 2));
  await expect(waiting.getByRole('button', { name: '编辑' })).toBeVisible();

  await page.evaluate(() => window.waitingTimeline.transition({ fact: 'running', authority: true }, 2));

  const controls = page.getByRole('region', { name: '任务控制' });
  await expect(controls.getByRole('button', { name: '编辑' })).toBeVisible();
  await expect(controls.getByRole('button', { name: '停止', exact: true })).toBeVisible();

  await controls.getByRole('button', { name: '停止', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.waitingTimeline.taskControlCalls())).toEqual([
    expect.objectContaining({
      actorId: 'agent',
      type: 'agent.interrupt',
      payload: {},
    }),
  ]);
});
