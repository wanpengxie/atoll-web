import { test, expect } from '@playwright/test';

async function open(page) {
  await page.goto('/tests/browser/fixtures/reading-lifecycle.html');
  await page.waitForFunction(() => window.readingLifecycle?.anchor().id);
  await page.waitForTimeout(200);
}
async function anchorFrames(page) {
  return page.evaluate(async () => {
    const result = [];
    for (let i = 0; i < 8; i++) {
      await new Promise(requestAnimationFrame);
      result.push(window.readingLifecycle.debugGeometry());
    }
    return result;
  });
}
function sameAnchor(before, frames) {
  for (const frame of frames) {
    expect(frame.anchor.id, JSON.stringify({ before, frames })).toBe(before.id);
    expect(Math.abs(frame.anchor.top - before.top), JSON.stringify({ before, frames })).toBeLessThanOrEqual(1);
  }
}
async function restoredSemanticAnchor(page, bookmark) {
  await expect.poll(() => page.evaluate(
    (saved) => window.readingLifecycle.readingPoint(saved),
    bookmark,
  )).toMatchObject({ id: bookmark.messageID, blockID: bookmark.blockID, visible: true });
  const settled = await page.evaluate(async (saved) => {
    const result = [];
    for (let i = 0; i < 8; i++) {
      await new Promise(requestAnimationFrame);
      result.push(window.readingLifecycle.readingPoint(saved));
    }
    return result;
  }, bookmark);
  expect(settled.every((frame) => frame.visible
    && frame.id === bookmark.messageID
    && frame.blockID === bookmark.blockID
    && frame.blockText.startsWith(bookmark.blockTextStart)
    && Math.abs(frame.rowTop - bookmark.rowViewportOffset) <= 1
    && Math.abs(frame.blockTop - bookmark.viewportOffset) <= 1
    && (bookmark.textViewportOffset == null || frame.textOffset === bookmark.textOffset)), JSON.stringify({ bookmark, settled })).toBe(true);
}
test('tail content updates cannot restore a pre-scroll bookmark while browsing', async ({ page }, testInfo) => {
  await open(page);
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.enable({
    case: 'tail-content-browsing',
    fixture: 'reading-lifecycle',
  }));
  await page.mouse.move(300, 250);
  await page.mouse.wheel(0, -1300);
  await page.waitForTimeout(200);
  const preCommit = await page.evaluate(() => window.readingLifecycle.debugGeometry());
  const before = await page.evaluate(() => window.readingLifecycle.scrollAndRevise(-180));
  const frames = await anchorFrames(page);
  const evidence = await page.evaluate(() => ({
    postCommit: window.readingLifecycle.debugGeometry(),
    readingTrace: window.__ATOLL_DIAGNOSTICS__.reading.snapshot(),
  }));
  await testInfo.attach('tail-content-reading-trace.json', {
    body: Buffer.from(JSON.stringify({ preCommit, before, frames, ...evidence }, null, 2)),
    contentType: 'application/json',
  });
  sameAnchor(before, frames);
});

test('tail resize diagnostic matrix separates input direction and changed-row position', async ({ page }, testInfo) => {
  const evidence = [];
  for (const direction of ['still', 'up', 'down']) {
    for (const relative of ['above', 'below']) {
      await open(page);
      await page.evaluate(({ direction: inputDirection, relative: changedPosition }) => {
        window.__ATOLL_DIAGNOSTICS__.reading.enable({
          case: 'tail-resize-matrix',
          direction: inputDirection,
          relative: changedPosition,
          fixture: 'reading-lifecycle',
        });
      }, { direction, relative });
      await page.mouse.move(300, 250);
      await page.mouse.wheel(0, -1300);
      await page.waitForTimeout(200);
      if (direction === 'up') await page.mouse.wheel(0, -180);
      if (direction === 'down') await page.mouse.wheel(0, 180);
      const before = await page.evaluate(() => window.readingLifecycle.debugGeometry());
      const anchorIndex = Number(before.anchor.id?.split('-').at(-1));
      const targetID = `a-${Math.max(0, Math.min(119, anchorIndex + (relative === 'above' ? -1 : 1)))}`;
      const changedID = await page.evaluate((id) => window.readingLifecycle.revise(id), targetID);
      const samples = await anchorFrames(page);
      const readingTrace = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.snapshot());
      const inputSequence = readingTrace.entries.find((entry) => entry.event === 'reading.input-owner')?.sequence || 0;
      const lateWrites = readingTrace.entries.filter((entry) => (
        entry.sequence > inputSequence && entry.event === 'reading.issuer-write'
      ));
      expect(before.mode).toBe('browsing');
      expect(changedID).toBe(targetID);
      expect(lateWrites, JSON.stringify({ direction, relative, readingTrace })).toHaveLength(0);
      evidence.push({ direction, relative, targetID, before, samples, readingTrace });
    }
  }
  await testInfo.attach('tail-resize-direction-position-matrix.json', {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: 'application/json',
  });
});
test('switching away and back initializes once from the saved reading bookmark', async ({ page }) => {
  await open(page);
  await page.mouse.move(300, 250);
  await page.mouse.wheel(0, -1800);
  await page.waitForTimeout(200);
  const original = await page.evaluate(() => window.readingLifecycle.saved('a').bookmark);
  await page.evaluate(() => window.readingLifecycle.switch('b'));
  await page.waitForTimeout(100);
  const observations = await page.evaluate(async () => {
    window.readingLifecycle.switch('a');
    await new Promise(requestAnimationFrame);
    const saved = window.readingLifecycle.saved('a').bookmark;
    window.readingLifecycle.switch('b');
    return saved;
  });
  expect(observations).toEqual(original);
  await page.evaluate(() => window.readingLifecycle.switch('a'));
  await restoredSemanticAnchor(page, original);
  await page.evaluate(() => window.readingLifecycle.reviseLast());
  await restoredSemanticAnchor(page, original);
});

test('switching immediately after a scroll preserves the last semantic reading point', async ({ page }) => {
  await open(page);
  await page.mouse.move(300, 250);
  await page.mouse.wheel(0, -1800);
  await page.waitForTimeout(200);
  await page.evaluate(() => window.readingLifecycle.scrollAndSwitch(-180, 'b'));
  const saved = await page.evaluate(() => window.readingLifecycle.saved('a').bookmark);
  expect(saved?.messageID).toBeTruthy();
  await page.evaluate(() => window.readingLifecycle.switch('a'));
  await restoredSemanticAnchor(page, saved);
});

test('user upward input during return initialization owns a later atomic prepend', async ({ page }) => {
  await open(page);
  await page.mouse.move(300, 250);
  await page.mouse.wheel(0, -1800);
  await page.waitForTimeout(200);
  await page.evaluate(() => window.readingLifecycle.switch('b'));
  const saved = await page.evaluate(() => window.readingLifecycle.saved('a').bookmark);
  expect(saved?.messageID).toBeTruthy();

  // Dispatch a real browser wheel immediately after the remount commit, then
  // deliver a valid data+firstItemIndex prepend before waiting for restore to
  // settle. The prepend may preserve the input-time anchor; the old bookmark
  // may not reclaim the viewport afterward.
  await page.evaluate(() => window.readingLifecycle.switch('a'));
  await page.waitForFunction(() => document.querySelector(
    '.timeline-message-list [data-presentation-row-id]',
  ));
  await page.mouse.move(300, 250);
  await page.mouse.wheel(0, -480);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const inputAnchor = await page.evaluate(() => window.readingLifecycle.prependActive(8));
  expect(inputAnchor?.id).toBeTruthy();
  expect(
    inputAnchor.id !== saved.messageID
      || Math.abs(inputAnchor.top - saved.rowViewportOffset) > 20,
  ).toBe(true);
  const frames = await page.evaluate(async () => {
    const result = [];
    for (let index = 0; index < 8; index += 1) {
      await new Promise(requestAnimationFrame);
      result.push(window.readingLifecycle.anchor());
    }
    return result;
  });
  const inputIndex = Number(inputAnchor.id.split('-').at(-1));
  expect(frames.every((frame) => frame.id
    && Number(frame.id.split('-').at(-1)) <= inputIndex), JSON.stringify({ inputAnchor, frames })).toBe(true);
  expect(frames.some((frame) => frame.id === saved.messageID
    && Math.abs(frame.top - saved.rowViewportOffset) <= 1), JSON.stringify({ saved, frames })).toBe(false);
  expect(await page.evaluate(() => window.readingLifecycle.session().mode)).toBe('browsing');
});

test('a single text block taller than the viewport restores its exact middle reading point', async ({ page }) => {
  await open(page);
  const saved = await page.evaluate(() => window.readingLifecycle.scrollLongBlockToMiddle());
  expect(saved?.messageID).toBe('a-118');
  expect(saved?.blockID).toBe('long');
  expect(saved?.textOffset).toBeGreaterThan(0);
  expect(saved?.rowViewportOffset).toBeLessThan(-600);
  await page.evaluate(() => window.readingLifecycle.switch('b'));
  await page.evaluate(() => window.readingLifecycle.switch('a'));
  await restoredSemanticAnchor(page, saved);
});

test('a deleted long anchor returns to its visible successor without reusing the deleted row offset', async ({ page }) => {
  await open(page);
  const saved = await page.evaluate(() => window.readingLifecycle.scrollLongBlockToMiddle('a-60'));
  expect(saved?.messageID).toBe('a-60');
  expect(saved?.successorID).toBe('a-61');
  expect(saved?.rowViewportOffset).toBeLessThan(-600);
  const beforeSwitch = await page.evaluate(() => {
    const current = window.readingLifecycle.saved('a').bookmark;
    window.readingLifecycle.switch('b');
    window.readingLifecycle.deleteLongAnchor('a-60');
    window.readingLifecycle.switch('a');
    return current;
  });
  expect(beforeSwitch?.messageID).toBe('a-60');
  await expect.poll(() => page.evaluate(() => window.readingLifecycle.rowAnchor('a-61')))
    .toMatchObject({ id: 'a-61', visible: true });
  const frames = await page.evaluate(async () => {
    const result = [];
    for (let i = 0; i < 8; i++) {
      await new Promise(requestAnimationFrame);
      result.push(window.readingLifecycle.rowAnchor('a-61'));
    }
    return result;
  });
  expect(frames.every((frame) => frame.visible && frame.id === 'a-61' && Math.abs(frame.top) <= 1), JSON.stringify(frames)).toBe(true);
});

test('following survives channel switches and repeated content revisions', async ({ page }) => {
  await open(page);
  for (const channel of ['b', 'a', 'b', 'a']) {
    await page.evaluate((next) => window.readingLifecycle.switch(next), channel);
    await page.evaluate(() => window.readingLifecycle.reviseLast());
    await expect.poll(() => page.evaluate(() => {
      const root = document.querySelector('.timeline-message-list');
      return Math.abs(root.scrollHeight - root.clientHeight - root.scrollTop);
    })).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => window.readingLifecycle.session().mode)).toBe('following');
  }
});
