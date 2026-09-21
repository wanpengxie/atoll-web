import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// TC-0145 is the single desktop fixed-overlay contract extracted from
// fae8b70:tests/browser/composer-fixed-overlay.spec.js.  Composer growth is a
// visual overlay concern: the reading reserve, active timeline geometry and
// browsing position stay owned by the reading surface.

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'long-running-history', seed: 0xc0_09_18 },
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
  await expect(page.locator('.timeline-message-list')).toBeVisible();
}

async function waitForFollowingReady(page) {
  const list = page.locator('.timeline-message-list');
  await expect.poll(async () => {
    const before = await list.evaluate((node) => {
      const timeline = document.querySelector('.timeline');
      return {
        mode: timeline?.dataset.viewportMode || '',
        height: node.scrollHeight,
        gap: node.scrollHeight - node.clientHeight - node.scrollTop,
      };
    });
    if (before.mode !== 'following' || before.gap > 1) return false;
    await page.waitForTimeout(120);
    const after = await list.evaluate((node) => {
      const timeline = document.querySelector('.timeline');
      return {
        mode: timeline?.dataset.viewportMode || '',
        height: node.scrollHeight,
        gap: node.scrollHeight - node.clientHeight - node.scrollTop,
      };
    });
    return after.mode === 'following'
      && after.gap <= 1
      && Math.abs(after.height - before.height) <= 1;
  }, { timeout: 15_000 }).toBe(true);
}

async function armProbe(page) {
  await page.evaluate(() => {
    const frames = [];
    const writes = [];
    const events = [];
    let phase = 'idle';
    let stopped = false;
    const nativeScrollTo = Element.prototype.scrollTo;
    const nativeDispatch = EventTarget.prototype.dispatchEvent;

    Element.prototype.scrollTo = function scrollTo(...args) {
      if (this.classList?.contains('timeline-message-list')) {
        writes.push({ phase, at: performance.now(), args });
      }
      return nativeScrollTo.apply(this, args);
    };
    EventTarget.prototype.dispatchEvent = function dispatchEvent(event) {
      if (['atoll:input-resize-prepared', 'atoll:timeline-bottom-write'].includes(event?.type)) {
        events.push({ phase, at: performance.now(), type: event.type });
      }
      return nativeDispatch.call(this, event);
    };

    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const value = node.getBoundingClientRect();
      return { top: value.top, bottom: value.bottom, height: value.height };
    };
    const tick = () => {
      if (stopped) return;
      const scroller = document.querySelector('.timeline-reading-layer.is-active .timeline-message-list')
        || document.querySelector('.timeline-message-list');
      const input = document.querySelector('.conversation-input-slot');
      const obstruction = scroller?.querySelector('.timeline-waiting-obstruction');
      frames.push({
        frame: frames.length,
        phase,
        at: performance.now(),
        reading: rect('.conversation-reading-slot'),
        surface: rect('.conversation-surface'),
        input: rect('.conversation-input-slot'),
        scrollerClientHeight: scroller?.clientHeight ?? null,
        scrollerScrollHeight: scroller?.scrollHeight ?? null,
        scrollTop: scroller?.scrollTop ?? null,
        inputClientHeight: input?.clientHeight ?? null,
        inputScrollHeight: input?.scrollHeight ?? null,
        obstructionHeight: obstruction?.getBoundingClientRect().height ?? null,
        mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
        editorFocused: Boolean(document.activeElement?.closest?.('.composer-editor')),
      });
      requestAnimationFrame(tick);
    };

    window.__tc0145ComposerOverlayProbe = {
      frames,
      writes,
      events,
      setPhase(value) { phase = value; },
      stop() {
        stopped = true;
        Element.prototype.scrollTo = nativeScrollTo;
        EventTarget.prototype.dispatchEvent = nativeDispatch;
        return { frames, writes, events };
      },
    };
    requestAnimationFrame(tick);
  });
}

async function growEditor(page, prefix, lines) {
  const editor = page.getByLabel('消息');
  await editor.focus();
  for (let index = 0; index < lines; index += 1) {
    if (index > 0) await editor.press('Shift+Enter');
    await editor.pressSequentially(`${prefix}-${index} 固定浮层输入`);
  }
}

async function clearEditor(page) {
  const editor = page.getByLabel('消息');
  await editor.press('Control+A');
  await editor.press('Backspace');
}

function phaseFrames(frames, phase) {
  return frames.filter((frame) => frame.phase === phase);
}

test('TC-0145 Composer growth stays an overlay in following and browsing', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1120, height: 720 });
  await reset(request);
  await login(page);
  await waitForFollowingReady(page);
  await armProbe(page);

  await page.evaluate(() => window.__tc0145ComposerOverlayProbe.setPhase('following-growth'));
  await growEditor(page, 'following', 7);
  await page.waitForTimeout(260);
  await clearEditor(page);
  await page.waitForTimeout(180);

  await page.evaluate(() => window.__tc0145ComposerOverlayProbe.setPhase('navigation'));
  // The current handoff exposes one public reading region for both modes;
  // mode is the observable, rather than the retired following-tail DOM.
  const scroller = page.locator('.timeline-message-list');
  await scroller.hover();
  await page.mouse.wheel(0, -640);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  await expect(scroller).toHaveAttribute('data-reading-mode', 'browsing');
  await page.waitForTimeout(180);
  const browsingStart = await page.locator('.timeline-reading-layer.is-active .timeline-message-list')
    .evaluate((node) => node.scrollTop);

  await page.evaluate(() => window.__tc0145ComposerOverlayProbe.setPhase('browsing-growth'));
  await growEditor(page, 'browsing', 7);
  await page.waitForTimeout(260);
  await clearEditor(page);
  await page.waitForTimeout(180);
  const browsingEnd = await page.locator('.timeline-reading-layer.is-active .timeline-message-list')
    .evaluate((node) => node.scrollTop);

  const evidence = await page.evaluate(() => window.__tc0145ComposerOverlayProbe.stop());
  const following = phaseFrames(evidence.frames, 'following-growth');
  const browsing = phaseFrames(evidence.frames, 'browsing-growth');
  const summary = {
    followingFrames: following.length,
    browsingFrames: browsing.length,
    followingReadingHeights: [...new Set(following.map((frame) => frame.reading?.height))],
    browsingReadingHeights: [...new Set(browsing.map((frame) => frame.reading?.height))],
    followingScrollerHeights: [...new Set(following.map((frame) => frame.scrollerClientHeight))],
    browsingScrollerHeights: [...new Set(browsing.map((frame) => frame.scrollerClientHeight))],
    followingInputHeights: [...new Set(following.map((frame) => frame.input?.height))],
    browsingInputHeights: [...new Set(browsing.map((frame) => frame.input?.height))],
    fixedReserves: [...new Set(evidence.frames.map((frame) => (
      frame.surface && frame.reading ? frame.surface.bottom - frame.reading.bottom : null
    )))],
    obstructionHeights: [...new Set(evidence.frames.map((frame) => frame.obstructionHeight))],
    growthWrites: evidence.writes.filter((entry) => (
      entry.phase === 'following-growth' || entry.phase === 'browsing-growth'
    )),
    growthEvents: evidence.events.filter((entry) => (
      entry.phase === 'following-growth' || entry.phase === 'browsing-growth'
    )),
    followingBadTail: following.filter((frame) => (
      frame.mode === 'following'
      && frame.scrollerScrollHeight != null
      && frame.scrollerClientHeight != null
      && frame.scrollTop != null
      && frame.scrollerScrollHeight - frame.scrollerClientHeight - frame.scrollTop > 0.5
    )),
    browsingStart,
    browsingEnd,
    followingLostFocus: following.filter((frame) => frame.input.height > 110 && !frame.editorFocused).length,
    browsingLostFocus: browsing.filter((frame) => frame.input.height > 110 && !frame.editorFocused).length,
  };
  await testInfo.attach('tc0145-composer-overlay-evidence.json', {
    body: JSON.stringify({ summary, evidence }, null, 2),
    contentType: 'application/json',
  });

  expect(summary.followingReadingHeights).toHaveLength(1);
  expect(summary.browsingReadingHeights).toHaveLength(1);
  expect(summary.followingScrollerHeights).toHaveLength(1);
  expect(summary.browsingScrollerHeights).toHaveLength(1);
  expect(summary.followingInputHeights.length).toBeGreaterThan(2);
  expect(summary.browsingInputHeights.length).toBeGreaterThan(2);
  expect(summary.fixedReserves.every((value) => Math.abs(value - 132) <= 1)).toBe(true);
  expect(summary.obstructionHeights.filter((value) => value != null).every((value) => value === 48)).toBe(true);
  expect(summary.growthWrites).toEqual([]);
  expect(summary.growthEvents).toEqual([]);
  expect(summary.followingBadTail).toEqual([]);
  expect(Math.abs(browsingEnd - browsingStart)).toBeLessThanOrEqual(1);
  expect(summary.followingLostFocus).toBe(0);
  expect(summary.browsingLostFocus).toBe(0);
});
