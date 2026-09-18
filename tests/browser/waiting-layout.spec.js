import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const stableKeys = ['surface', 'reading', 'stack', 'input', 'composer'];

function expectSameGeometry(actual, expected, context) {
  for (const key of stableKeys) {
    expect(actual[key], `${context}:${key}`).toEqual(expected[key]);
  }
}

async function sourceFingerprint() {
  const paths = [
    'src/ui/conversation/ConversationSurface.jsx',
    'src/ui/Timeline.jsx',
    'src/styles/app-shell.css',
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
    oracle: { coordinateTolerancePx: 1, inputReadingDeltaTolerancePx: 0, sampledAnimationFrames: 16 },
    source: await sourceFingerprint(),
    ...payload,
  }, null, 2);
  await writeFile(path, body);
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

test('waiting facts and network presentation never own reading or composer geometry', async ({ page }, testInfo) => {
  await page.goto('/tests/browser/fixtures/waiting-layout.html');
  await page.waitForFunction(() => window.waitingLayout?.geometry().composer?.height > 0);
  const baseline = await page.evaluate(() => window.waitingLayout.geometry());

  const transitions = [
    ['queued', { fact: 'queued' }],
    ['partial evidence', { fact: 'partial' }],
    ['roster refresh', { fact: 'roster', rosterRevision: 2 }],
    ['edit queued', { fact: 'queued', editing: true }],
    ['running', { fact: 'running', editing: false }],
    ['terminal', { fact: 'terminal' }],
    ['offline', { network: 'offline' }],
    ['queued locally', { network: 'queued' }],
    ['network restored', { network: 'open' }],
  ];
  const trajectories = [];
  for (const [label, patch] of transitions) {
    const frames = await page.evaluate((next) => window.waitingLayout.transition(next, 16), patch);
    trajectories.push({ label, patch, frames });
  }
  await persistEvidence(testInfo, 'waiting-facts-geometry.json', { baseline, trajectories });
  for (const { label, frames } of trajectories) {
    for (const [index, frame] of frames.entries()) {
      expectSameGeometry(frame, baseline, `${label}:frame-${index}`);
      // Obstruction growth is synchronous so content is never covered. A
      // reduction is allowed to retain only excess space while the bounded
      // Surface transition retires it; it may never undershoot the overlay.
      expect(frame.floatingObstruction, `${label}:frame-${index}:measured obstruction`)
        .toBeGreaterThanOrEqual(Math.max(0, (frame.floating?.height || 0) - frame.readingGap) - 1);
    }
    const settled = frames.at(-1);
    expect(Math.abs(settled.floatingObstruction - Math.max(0, (settled.floating?.height || 0) - settled.readingGap)),
      `${label}: bounded obstruction retirement settles to the measured overlay`).toBeLessThanOrEqual(1);
  }
});

test('submit may remove natural input height while its new queued layer remains geometry-neutral', async ({ page }, testInfo) => {
  await page.goto('/tests/browser/fixtures/waiting-layout.html');
  await page.waitForFunction(() => window.waitingLayout?.geometry().composer?.height > 0);
  const oneLine = await page.evaluate(() => window.waitingLayout.geometry());
  const grownFrames = await page.evaluate(() => window.waitingLayout.transition({ lines: 6 }));
  const grown = grownFrames.at(-1);
  const submitFrames = await page.evaluate(() => window.waitingLayout.transition({
    lines: 1,
    fact: 'queued',
    network: 'queued',
    sendClearRevision: 1,
  }, 18));
  await persistEvidence(testInfo, 'waiting-submit-geometry.json', { baseline: oneLine, grownFrames, submitFrames });
  expect(grown.composer.height).toBeGreaterThan(oneLine.composer.height);
  expect(grown.composer.bottom).toBe(oneLine.composer.bottom);
  expect(grown.reading.top).toBe(oneLine.reading.top);
  expect(oneLine.reading.bottom - grown.reading.bottom).toBe(grown.input.height - oneLine.input.height);
  const inputHeights = submitFrames.map((frame) => Math.round(frame.input.height));
  const readingBottoms = submitFrames.map((frame) => Math.round(frame.reading.bottom));
  expect(new Set(inputHeights).size).toBeGreaterThanOrEqual(3);
  expect(inputHeights[0]).toBe(grown.input.height);
  expect(inputHeights.at(-1)).toBe(oneLine.input.height);
  expect(readingBottoms[0]).toBe(grown.reading.bottom);
  expect(readingBottoms.at(-1)).toBe(oneLine.reading.bottom);
  expect(inputHeights.slice(1).every((height, index) => height <= inputHeights[index])).toBe(true);
  expect(readingBottoms.slice(1).every((bottom, index) => bottom >= readingBottoms[index])).toBe(true);
  for (const frame of submitFrames) {
    expect(frame.composer.bottom).toBe(oneLine.composer.bottom);
    expect(frame.waiting?.height || 0).toBeGreaterThan(0);
    expect(frame.floatingObstruction)
      .toBe(Math.max(0, frame.floating.height - frame.readingGap));
  }
});

test('production Timeline keeps queued to running to terminal facts outside the geometry contract', async ({ page }, testInfo) => {
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
    trajectory.push({ label, patch, frames: await page.evaluate(
      ({ next, count }) => window.waitingTimeline.transition(next, count),
      { next: patch, count: ['running', 'terminal'].includes(label) ? 16 : 4 },
    ) });
  }
  await persistEvidence(testInfo, 'waiting-timeline-geometry.json', { baseline, trajectory });
  for (const { label, frames } of trajectory) {
    for (const [index, frame] of frames.entries()) expectSameGeometry(frame, baseline, `timeline-${label}:frame-${index}`);
  }
  expect(trajectory.find(({ label }) => label === 'queued').frames.some((frame) => frame.waiting?.height > 0)).toBe(true);
  expect(trajectory.find(({ label }) => label === 'partial').frames.some((frame) => frame.waiting?.height > 0)).toBe(true);
  expect(trajectory.find(({ label }) => label === 'running').frames.at(-1).waiting).toBeNull();
  expect(trajectory.find(({ label }) => label === 'terminal').frames.at(-1).waiting).toBeNull();
});
