import { expect, test } from '@playwright/test';

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

function channel(page, name) {
  return page.locator('.channel-item').filter({
    has: page.locator('.channel-name', { hasText: new RegExp(`^${name.replace('.', '\\.')}$`) }),
  });
}

async function captureVisibleAnchor(viewport) {
  return viewport.evaluate((node) => {
    const root = node.getBoundingClientRect();
    return [...node.querySelectorAll('[data-presentation-row-id]')]
      .map((row) => ({
        id: row.dataset.presentationRowId || '',
        top: row.getBoundingClientRect().top - root.top,
        bottom: row.getBoundingClientRect().bottom - root.top,
      }))
      .filter((row) => row.id && row.bottom > 0 && row.top < node.clientHeight)
      .sort((left, right) => left.top - right.top)[0] || null;
  });
}

async function waitForVisibleAnchor(viewport, anchorID) {
  await expect.poll(() => viewport.evaluate((node, id) => {
    const root = node.getBoundingClientRect();
    const row = [...node.querySelectorAll('[data-presentation-row-id]')]
      .find((candidate) => candidate.dataset.presentationRowId === id);
    if (!row) return false;
    const rect = row.getBoundingClientRect();
    return rect.bottom > root.top && rect.top < root.bottom;
  }, anchorID)).toBe(true);
}

async function captureSettledAnchor(viewport, anchorID) {
  return viewport.evaluate((node, id) => {
    const root = node.getBoundingClientRect();
    const row = [...node.querySelectorAll('[data-presentation-row-id]')]
      .find((candidate) => candidate.dataset.presentationRowId === id);
    if (!row) return null;
    const rect = row.getBoundingClientRect();
    return {
      id: row.dataset.presentationRowId || '',
      top: rect.top - root.top,
      bottom: rect.bottom - root.top,
      visible: rect.bottom > 0 && rect.top < node.clientHeight,
    };
  }, anchorID);
}

async function installPublicFrameSampler(page, anchorID) {
  await page.evaluate((id) => {
    const state = { id, frames: [], started: false, raf: 0 };
    const collect = () => {
      if (!state.started) return;
      const node = document.querySelector('.timeline-message-list');
      const root = node?.getBoundingClientRect();
      const row = [...(node?.querySelectorAll('[data-presentation-row-id]') || [])]
        .find((candidate) => candidate.dataset.presentationRowId === state.id);
      const rect = row?.getBoundingClientRect();
      state.frames.push({
        frame: state.frames.length,
        rowID: row?.dataset.presentationRowId || null,
        top: rect && root ? rect.top - root.top : null,
        visible: Boolean(rect && root && rect.bottom > root.top && rect.top < root.bottom),
        scrollTop: node?.scrollTop ?? null,
      });
      if (state.frames.length < 120) state.raf = requestAnimationFrame(collect);
    };
    const start = (event) => {
      const item = event.target.closest?.('.channel-item');
      const name = item?.querySelector('.channel-name')?.textContent?.trim();
      if (name !== 'c0' || state.started) return;
      state.started = true;
      state.raf = requestAnimationFrame(collect);
    };
    document.addEventListener('pointerdown', start, { capture: true });
    window.__NR41_PUBLIC_FRAME_SAMPLER__ = {
      stop() {
        document.removeEventListener('pointerdown', start, { capture: true });
        if (state.raf) cancelAnimationFrame(state.raf);
        return { started: state.started, frames: state.frames };
      },
    };
  }, anchorID);
}

test('TC0224 minimal public black-box: channel return keeps one semantic anchor at one screen position', async ({ page, request }, testInfo) => {
  // This is the public regression contract for the channel-return geometry.
  // Keep the observer DOM-only: no private owner or runtime binding is used.
  test.setTimeout(60_000);

  const reset = await request.post('/mock/control/reset', {
    data: { scenario: 'deep-history', seed: 1714 },
  });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  await page.mouse.wheel(0, -2_400);
  await page.waitForTimeout(150);
  const before = await captureVisibleAnchor(viewport);
  expect(before?.id, JSON.stringify({ before })).toBeTruthy();

  await channel(page, 'c0.project').click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await installPublicFrameSampler(page, before.id);
  await channel(page, 'c0').click();
  await expect(page.locator('main h1')).toHaveText('c0');
  await page.waitForTimeout(700);
  const returnEvidence = await page.evaluate(() => window.__NR41_PUBLIC_FRAME_SAMPLER__?.stop?.() || ({ started: false, frames: [] }));
  const frames = returnEvidence.frames;
  await waitForVisibleAnchor(viewport, before.id);
  const settled = await captureSettledAnchor(viewport, before.id);
  const visibleFrames = frames.filter((frame) => frame.visible && Number.isFinite(frame.top));
  const tops = visibleFrames.map((frame) => frame.top);
  const spread = tops.length ? Math.max(...tops) - Math.min(...tops) : null;
  const settledTop = settled?.top ?? null;
  const settledDelta = Number.isFinite(settledTop) && Number.isFinite(before.top)
    ? Math.abs(settledTop - before.top)
    : null;
  const evidence = {
    contract: 'same public row ID returns to its pre-leave screen top and stays there',
    baseline: 'old reading baseline: stable semantic anchor, <=1px target; current F7 gate uses <=2px over return frames',
    before,
    frames,
    settled,
    visibleFrameCount: visibleFrames.length,
    spread,
    settledTop,
    settledDelta,
  };
  await testInfo.attach('tc0224-public-blackbox.json', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });

  expect(visibleFrames.length, JSON.stringify(evidence)).toBeGreaterThanOrEqual(8);
  expect(visibleFrames.every((frame) => frame.rowID === before.id), JSON.stringify(evidence)).toBe(true);
  expect(settled?.id, JSON.stringify(evidence)).toBe(before.id);
  expect(settled?.visible, JSON.stringify(evidence)).toBe(true);
  expect(settledDelta, JSON.stringify(evidence)).toBeLessThanOrEqual(2);
  expect(spread, JSON.stringify(evidence)).toBeLessThanOrEqual(2);
});
