import { expect, test } from '@playwright/test';

test('d4aa invalidates an offscreen certificate by row measurement key and keeps a live fold-signature change on ordinary resize', async ({ page }, testInfo) => {
  await page.goto('/tests/browser/fixtures/d4aa-measurement-key.html');
  await page.waitForFunction(() => window.d4aaMeasurementKey?.ready());
  await page.waitForFunction(() => {
    const state = window.d4aaMeasurementKey.snapshot();
    return state.formalStates.some((entry) => entry.phase === 'pending'
      && entry.reason === 'inline-size'
      && entry.blocking);
  });
  expect((await page.evaluate(() => window.d4aaMeasurementKey.snapshot())).status).toBe('');

  // Admission feedback is scoped to the active reading surface. A hidden
  // channel can remain pending without exposing a stale status to the user.
  await page.evaluate(() => window.d4aaMeasurementKey.showSurface());
  await page.waitForFunction(() => window.d4aaMeasurementKey.snapshot().status === '正在准备频道内容…');

  await page.evaluate(() => window.d4aaMeasurementKey.revealHost());
  await page.waitForFunction(() => {
    const state = window.d4aaMeasurementKey.snapshot();
    return state.formalStates.at(-1)?.phase === 'ready' && state.status === '';
  });
  // The whole accepted extent is measured exactly once, but an offscreen
  // certificate may release its native node until that row becomes desired.
  // A changing count here detects prepare/detach loops before testing the key.
  await page.waitForTimeout(750);

  const before = await page.evaluate(() => window.d4aaMeasurementKey.snapshot());
  expect(before.mountCount).toBe(1);
  expect(before.businessWrites).toBe(0);
  expect(before.transitions.some((entry) => entry.formalPreparing && entry.actual === 40)).toBe(true);
  expect(before.formalStates.some((state) => state.phase === 'pending' && state.blocking)).toBe(true);
  expect(before.formalStates.at(-1)?.phase).toBe('ready');
  expect(before.status).toBe('');

  await page.evaluate(() => window.d4aaMeasurementKey.changeOffscreenLayout());
  await page.waitForFunction(() => {
    const state = window.d4aaMeasurementKey.snapshot();
    return state.mountCount === 2
      && state.transitions.some((entry) => entry.formalPreparing && entry.actual === 140);
  }, null, { timeout: 5_000 });

  await page.evaluate(() => window.d4aaMeasurementKey.scrollTarget());
  await page.waitForFunction(() => {
    const state = window.d4aaMeasurementKey.snapshot();
    return state.dataIndex === String(window.d4aaMeasurementKey.target)
      && !state.retained && !state.formalPreparing;
  });
  const promoted = await page.evaluate(() => window.d4aaMeasurementKey.snapshot());
  expect(promoted.actual).toBe(140);
  expect(promoted.knownSize).toBe(140);
  expect(promoted.mountCount).toBe(3);
  expect(promoted.businessWrites).toBe(0);

  const preparationCount = promoted.transitions.filter((entry) => entry.formalPreparing).length;
  await page.evaluate(() => window.d4aaMeasurementKey.toggleLocalFold());
  await page.waitForFunction(() => {
    const state = window.d4aaMeasurementKey.snapshot();
    return state.actual === 220 && state.knownSize === 220;
  });
  const folded = await page.evaluate(() => window.d4aaMeasurementKey.snapshot());
  // The real App includes its controlled fold override in rowRevision. A
  // changed signature on an already-live connected row is ordinary geometry;
  // it must not remount the row or route it through future-range preparation.
  expect(folded.mountCount).toBe(3);
  expect(folded.businessWrites).toBe(0);
  expect(folded.transitions.filter((entry) => entry.formalPreparing)).toHaveLength(preparationCount);
  expect(folded.runtimeErrors).toEqual([]);
  await testInfo.attach('measurement-key-result.json', {
    body: Buffer.from(JSON.stringify(folded, null, 2)),
    contentType: 'application/json',
  });
});
