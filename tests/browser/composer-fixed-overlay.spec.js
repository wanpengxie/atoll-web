import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

const OUT = process.env.ATOLL_COMPOSER_OVERLAY_OUT || '';

async function persist(name, value) {
  if (!OUT) return;
  await mkdir(OUT, { recursive: true });
  await writeFile(resolve(OUT, name), `${JSON.stringify(value, null, 2)}\n`);
}

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
  await expect(page.locator('[data-reading-container="following-tail"]')).toBeVisible();
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
      return {
        top: value.top, bottom: value.bottom, height: value.height,
      };
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
        scrollTop: scroller?.scrollTop ?? null,
        inputClientHeight: input?.clientHeight ?? null,
        inputScrollHeight: input?.scrollHeight ?? null,
        obstructionHeight: obstruction?.getBoundingClientRect().height ?? null,
        mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
        editorFocused: Boolean(document.activeElement?.closest?.('.composer-editor')),
      });
      requestAnimationFrame(tick);
    };
    window.__composerOverlayProbe = {
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

test('production Composer growth is overlay-only in following and browsing', async ({ page, request }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1120, height: 720 });
  await reset(request);
  await login(page);
  await armProbe(page);

  await page.evaluate(() => window.__composerOverlayProbe.setPhase('following-growth'));
  await growEditor(page, 'following', 7);
  await page.waitForTimeout(260);
  await clearEditor(page);
  await page.waitForTimeout(180);

  await page.evaluate(() => window.__composerOverlayProbe.setPhase('navigation'));
  const scroller = page.locator('[data-reading-container="following-tail"]');
  await scroller.hover();
  await page.mouse.wheel(0, -640);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  await expect(page.locator('.timeline-reading-layer.is-active [data-reading-container="following-tail"]'))
    .toHaveCount(0);
  await page.waitForTimeout(180);
  const browsingStart = await page.locator('.timeline-reading-layer.is-active .timeline-message-list')
    .evaluate((node) => node.scrollTop);

  await page.evaluate(() => window.__composerOverlayProbe.setPhase('browsing-growth'));
  await growEditor(page, 'browsing', 7);
  await page.waitForTimeout(260);
  await clearEditor(page);
  await page.waitForTimeout(180);
  const browsingEnd = await page.locator('.timeline-reading-layer.is-active .timeline-message-list')
    .evaluate((node) => node.scrollTop);

  const evidence = await page.evaluate(() => window.__composerOverlayProbe.stop());
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
    writes: evidence.writes,
    events: evidence.events,
    growthWrites: evidence.writes.filter((entry) => (
      entry.phase === 'following-growth' || entry.phase === 'browsing-growth'
    )),
    growthEvents: evidence.events.filter((entry) => (
      entry.phase === 'following-growth' || entry.phase === 'browsing-growth'
    )),
    followingBadTail: following.filter((frame) => (
      frame.mode === 'following' && Math.abs(frame.scrollTop || 0) > 0.5
    )),
    browsingStart,
    browsingEnd,
    followingLostFocus: following.filter((frame) => frame.input.height > 110 && !frame.editorFocused).length,
    browsingLostFocus: browsing.filter((frame) => frame.input.height > 110 && !frame.editorFocused).length,
  };
  await persist('production-composer-overlay.json', { summary, evidence });

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

test('mobile layout resize is the only reading resize; subsequent typing stays isolated', async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await reset(request);
  await login(page);
  const editor = page.getByLabel('消息');
  await editor.focus();
  const before = await page.locator('.conversation-reading-slot').evaluate((node) => ({
    clientHeight: node.clientHeight,
    reserve: node.parentElement.getBoundingClientRect().bottom - node.getBoundingClientRect().bottom,
  }));

  await page.setViewportSize({ width: 390, height: 500 });
  await expect.poll(() => page.evaluate(() => innerHeight)).toBe(500);
  const resized = await page.locator('.conversation-reading-slot').evaluate((node) => ({
    clientHeight: node.clientHeight,
    reserve: node.parentElement.getBoundingClientRect().bottom - node.getBoundingClientRect().bottom,
  }));
  await armProbe(page);
  await page.evaluate(() => window.__composerOverlayProbe.setPhase('mobile-growth'));
  await growEditor(page, 'mobile', 8);
  await page.waitForTimeout(240);
  const evidence = await page.evaluate(() => window.__composerOverlayProbe.stop());
  const frames = phaseFrames(evidence.frames, 'mobile-growth');
  const summary = {
    before,
    resized,
    readingHeights: [...new Set(frames.map((frame) => frame.reading?.height))],
    scrollerHeights: [...new Set(frames.map((frame) => frame.scrollerClientHeight))],
    inputHeights: [...new Set(frames.map((frame) => frame.input?.height))],
    fixedReserves: [...new Set(frames.map((frame) => frame.surface.bottom - frame.reading.bottom))],
    writes: evidence.writes,
    events: evidence.events,
    lostFocus: frames.filter((frame) => frame.input.height > 120 && !frame.editorFocused).length,
  };
  await persist('mobile-composer-overlay.json', { summary, evidence });

  expect(resized.clientHeight).toBeLessThan(before.clientHeight);
  expect(Math.abs(before.reserve - 152)).toBeLessThanOrEqual(1);
  expect(Math.abs(resized.reserve - 152)).toBeLessThanOrEqual(1);
  expect(summary.readingHeights).toHaveLength(1);
  expect(summary.scrollerHeights).toHaveLength(1);
  expect(summary.inputHeights.length).toBeGreaterThan(1);
  expect(summary.fixedReserves.every((value) => Math.abs(value - 152) <= 1)).toBe(true);
  expect(summary.writes).toEqual([]);
  expect(summary.events).toEqual([]);
  expect(summary.lostFocus).toBe(0);
  await expect(editor).toBeFocused();
});

test('mobile visual-only keyboard frame keeps Composer, menu and focus inside the visible viewport', async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    Object.assign(viewport, {
      width: 390,
      height: 844,
      offsetTop: 0,
      offsetLeft: 0,
      pageTop: 0,
      pageLeft: 0,
      scale: 1,
    });
    Object.defineProperty(globalThis, 'visualViewport', {
      configurable: true,
      value: viewport,
    });
    globalThis.__setSyntheticVisualViewport = (patch, type = 'resize') => {
      Object.assign(viewport, patch);
      viewport.dispatchEvent(new Event(type));
    };
  });
  await reset(request);
  await login(page);
  await expect(page.locator('.shell.mobile-shell')).not.toHaveAttribute('data-visual-viewport-owned');
  const editor = page.getByLabel('消息');
  await editor.focus();
  await editor.fill('@st');
  const option = page.getByRole('option', { name: /steward/i });
  await expect(option).toBeVisible();
  const before = await page.evaluate(() => ({
    innerHeight,
    shell: document.querySelector('.shell')?.getBoundingClientRect().toJSON(),
    readingHeight: document.querySelector('.conversation-reading-slot')?.clientHeight || 0,
    selection: getSelection()?.toString() || '',
  }));

  await page.evaluate(() => globalThis.__setSyntheticVisualViewport({ height: 500, offsetTop: 37 }));
  await expect(page.locator('.shell.mobile-shell')).toHaveAttribute('data-visual-viewport-owned', 'true');
  await expect.poll(() => page.locator('.shell').evaluate((node) => node.getBoundingClientRect().bottom))
    .toBeCloseTo(537, 0);
  const contracted = await page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON() || null;
    const ownsHit = (selector) => {
      const node = document.querySelector(selector);
      const bounds = node?.getBoundingClientRect();
      if (!node || !bounds) return false;
      const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      return hit === node || node.contains(hit);
    };
    return {
      innerHeight,
      visualHeight: visualViewport.height,
      visualOffsetTop: visualViewport.offsetTop,
      shell: rect('.shell'),
      surface: rect('.conversation-surface'),
      composer: rect('.composer-surface'),
      option: rect('[role="option"]'),
      send: rect('.send-button'),
      readingHeight: document.querySelector('.conversation-reading-slot')?.clientHeight || 0,
      editorFocused: document.activeElement?.closest?.('.composer-editor') != null,
      optionOwnsHit: ownsHit('[role="option"]'),
      sendOwnsHit: ownsHit('.send-button'),
    };
  });
  await page.evaluate(() => globalThis.__setSyntheticVisualViewport({ width: 700 }));
  await page.setViewportSize({ width: 700, height: 844 });
  await expect(page.locator('.shell.compact-shell')).toHaveAttribute('data-visual-viewport-owned', 'true');
  const compact = await page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON() || null;
    const option = document.querySelector('[role="option"]');
    const bounds = option?.getBoundingClientRect();
    const hit = bounds
      ? document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
      : null;
    return {
      innerWidth,
      innerHeight,
      visualWidth: visualViewport.width,
      visualHeight: visualViewport.height,
      shell: rect('.shell'),
      composer: rect('.composer-surface'),
      option: rect('[role="option"]'),
      editorFocused: document.activeElement?.closest?.('.composer-editor') != null,
      optionOwnsHit: Boolean(option && (hit === option || option.contains(hit))),
    };
  });
  await option.click();
  await editor.press('End');
  await editor.pressSequentially(' visual-only keyboard owner');
  await editor.press('Shift+Enter');
  await editor.pressSequentially('second line');
  await expect(editor).toBeFocused();
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect.poll(() => editor.textContent()).toBe('');
  const afterSend = await page.evaluate(() => ({
    shellBottom: document.querySelector('.shell')?.getBoundingClientRect().bottom || 0,
    composerBottom: document.querySelector('.composer-surface')?.getBoundingClientRect().bottom || 0,
    activeElement: document.activeElement?.className || '',
    hasLegacyResizeAttribute: Boolean(document.querySelector(
      '[data-input-resize-transition], [data-send-clear-transition], [data-send-clear-revision]',
    )),
  }));
  const evidence = { before, contracted, compact, afterSend };
  await persist('visual-only-ime-owner.json', evidence);

  expect(contracted.innerHeight).toBe(844);
  expect(contracted.visualHeight).toBe(500);
  expect(contracted.readingHeight).toBeLessThan(before.readingHeight);
  expect(contracted.visualOffsetTop).toBe(37);
  expect(contracted.shell.top).toBeCloseTo(42, 0);
  expect(contracted.shell.bottom).toBeCloseTo(537, 0);
  expect(contracted.surface.bottom).toBeLessThanOrEqual(537);
  expect(contracted.composer.bottom).toBeLessThanOrEqual(537);
  expect(contracted.option.bottom).toBeLessThanOrEqual(537);
  expect(contracted.optionOwnsHit).toBe(true);
  expect(contracted.sendOwnsHit).toBe(true);
  expect(contracted.editorFocused).toBe(true);
  expect(compact.innerWidth).toBe(700);
  expect(compact.innerHeight).toBe(844);
  expect(compact.visualWidth).toBe(700);
  expect(compact.visualHeight).toBe(500);
  expect(compact.shell.top).toBeCloseTo(42, 0);
  expect(compact.shell.bottom).toBeCloseTo(537, 0);
  expect(compact.composer.bottom).toBeLessThanOrEqual(537);
  expect(compact.option.bottom).toBeLessThanOrEqual(537);
  expect(compact.optionOwnsHit).toBe(true);
  expect(compact.editorFocused).toBe(true);
  expect(afterSend.shellBottom).toBeCloseTo(537, 0);
  expect(afterSend.composerBottom).toBeLessThanOrEqual(537);
  expect(afterSend.hasLegacyResizeAttribute).toBe(false);
});

test('short visual viewport keeps reply, attachment, editor overflow and menus operable', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    Object.assign(viewport, {
      width: 390, height: 844, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1,
    });
    Object.defineProperty(globalThis, 'visualViewport', { configurable: true, value: viewport });
    globalThis.__setSyntheticVisualViewport = (patch) => {
      Object.assign(viewport, patch);
      viewport.dispatchEvent(new Event('resize'));
    };
  });
  await page.goto('/tests/browser/fixtures/composer-short-viewport.html');
  const editor = page.getByLabel('消息');
  await expect(editor).toBeVisible();
  await growEditor(page, 'short', 14);
  await page.evaluate(() => globalThis.__setSyntheticVisualViewport({ height: 320 }));
  await expect(page.locator('.shell.mobile-shell')).toHaveAttribute('data-visual-viewport-owned', 'true');
  await expect.poll(() => page.locator('.shell').evaluate((node) => node.getBoundingClientRect().bottom))
    .toBeCloseTo(320, 0);

  const expanded = await page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON() || null;
    const ownsHit = (selector) => {
      const node = document.querySelector(selector);
      const bounds = node?.getBoundingClientRect();
      if (!node || !bounds) return false;
      const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      return hit === node || node.contains(hit);
    };
    const editorNode = document.querySelector('.composer-editor');
    return {
      shell: rect('.shell'),
      surface: rect('.conversation-surface'),
      composer: rect('.composer-surface'),
      editor: rect('.composer-editor'),
      editorClientHeight: editorNode?.clientHeight || 0,
      editorScrollHeight: editorNode?.scrollHeight || 0,
      editorFocused: document.activeElement === editorNode,
      cancelReply: rect('[aria-label="取消回复"]'),
      removeAttachment: rect('[aria-label="移除附件 evidence.txt"]'),
      send: rect('.send-button'),
      cancelReplyOwnsHit: ownsHit('[aria-label="取消回复"]'),
      removeAttachmentOwnsHit: ownsHit('[aria-label="移除附件 evidence.txt"]'),
      sendOwnsHit: ownsHit('.send-button'),
    };
  });
  await page.getByRole('button', { name: '取消回复' }).click();
  await page.getByRole('button', { name: '移除附件 evidence.txt' }).click();
  await editor.fill('@Ag');
  const option = page.getByRole('option', { name: /Agent One/i });
  await expect(option).toBeVisible();
  const menu = await option.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return {
      rect: bounds.toJSON(),
      ownsHit: hit === node || node.contains(hit),
      shellBottom: document.querySelector('.shell')?.getBoundingClientRect().bottom || 0,
    };
  });
  await option.click();
  await editor.press('End');
  await editor.pressSequentially(' short viewport send');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByTestId('sent-count')).toHaveText('1');
  await expect.poll(() => editor.textContent()).toBe('');
  const evidence = { expanded, menu };
  await persist('short-visual-viewport-composer.json', evidence);

  expect(expanded.shell.bottom).toBeCloseTo(320, 0);
  expect(expanded.surface.bottom).toBeLessThanOrEqual(320);
  expect(expanded.composer.top).toBeGreaterThanOrEqual(expanded.surface.top - 1);
  expect(expanded.composer.bottom).toBeLessThanOrEqual(320);
  expect(expanded.editorScrollHeight).toBeGreaterThan(expanded.editorClientHeight);
  expect(expanded.editorFocused).toBe(true);
  expect(expanded.cancelReplyOwnsHit).toBe(true);
  expect(expanded.removeAttachmentOwnsHit).toBe(true);
  expect(expanded.sendOwnsHit).toBe(true);
  expect(menu.rect.bottom).toBeLessThanOrEqual(menu.shellBottom);
  expect(menu.ownsHit).toBe(true);
});

test('extreme visual viewport constrains the overlay and keeps every Composer action reachable', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    Object.assign(viewport, {
      width: 390, height: 844, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1,
    });
    Object.defineProperty(globalThis, 'visualViewport', { configurable: true, value: viewport });
    globalThis.__setSyntheticVisualViewport = (patch) => {
      Object.assign(viewport, patch);
      viewport.dispatchEvent(new Event('resize'));
    };
  });
  await page.goto('/tests/browser/fixtures/composer-short-viewport.html');
  const editor = page.getByLabel('消息');
  await growEditor(page, 'extreme', 14);
  await page.evaluate(() => globalThis.__setSyntheticVisualViewport({ height: 200 }));
  await expect(page.locator('.shell.mobile-shell')).toHaveAttribute('data-visual-viewport-owned', 'true');
  await expect.poll(() => page.locator('.shell').evaluate((node) => node.getBoundingClientRect().bottom))
    .toBeCloseTo(200, 0);

  const initial = await page.evaluate(() => {
    const input = document.querySelector('.conversation-input-slot');
    const stack = document.querySelector('.conversation-bottom-stack');
    const surface = document.querySelector('.conversation-surface');
    const rect = (node) => node?.getBoundingClientRect().toJSON() || null;
    return {
      shell: rect(document.querySelector('.shell')),
      input: rect(input),
      stack: rect(stack),
      surface: rect(surface),
      inputClientHeight: input?.clientHeight || 0,
      inputScrollHeight: input?.scrollHeight || 0,
      inputScrollTop: input?.scrollTop || 0,
      readingHeight: document.querySelector('.conversation-reading-slot')?.clientHeight || 0,
      editorFocused: document.activeElement === document.querySelector('.composer-editor'),
    };
  });

  const cancelReply = page.getByRole('button', { name: '取消回复' });
  await cancelReply.click();
  await expect(cancelReply).toHaveCount(0);
  const removeAttachment = page.getByRole('button', { name: '移除附件 evidence.txt' });
  await removeAttachment.click();
  await expect(removeAttachment).toHaveCount(0);

  await editor.fill('@Ag');
  const option = page.getByRole('option', { name: /Agent One/i });
  await expect(option).toBeVisible();
  await option.scrollIntoViewIfNeeded();
  const menu = await option.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return {
      rect: bounds.toJSON(),
      ownsHit: hit === node || node.contains(hit),
      shellBottom: document.querySelector('.shell')?.getBoundingClientRect().bottom || 0,
      inputScrollTop: document.querySelector('.conversation-input-slot')?.scrollTop || 0,
    };
  });
  await option.click();
  await editor.press('End');
  await editor.pressSequentially(' extreme viewport send');
  const send = page.getByRole('button', { name: '发送', exact: true });
  await send.click();
  await expect(page.getByTestId('sent-count')).toHaveText('1');
  await expect.poll(() => editor.textContent()).toBe('');

  const final = await page.evaluate(() => {
    const input = document.querySelector('.conversation-input-slot');
    return {
      shellBottom: document.querySelector('.shell')?.getBoundingClientRect().bottom || 0,
      surfaceBottom: document.querySelector('.conversation-surface')?.getBoundingClientRect().bottom || 0,
      inputBottom: input?.getBoundingClientRect().bottom || 0,
      inputClientHeight: input?.clientHeight || 0,
      inputScrollHeight: input?.scrollHeight || 0,
      readingHeight: document.querySelector('.conversation-reading-slot')?.clientHeight || 0,
      legacyAttributes: document.querySelectorAll(
        '[data-input-resize-transition], [data-send-clear-transition], [data-send-clear-revision]',
      ).length,
    };
  });
  await persist('extreme-visual-viewport-composer.json', { initial, menu, final });

  expect(initial.shell?.bottom).toBeCloseTo(200, 0);
  expect(initial.surface?.bottom).toBeLessThanOrEqual(200);
  expect(initial.stack?.top).toBeGreaterThanOrEqual(initial.surface?.top - 1);
  expect(initial.stack?.bottom).toBeLessThanOrEqual(initial.surface?.bottom + 1);
  expect(initial.inputScrollHeight).toBeGreaterThan(initial.inputClientHeight);
  expect(initial.editorFocused).toBe(true);
  expect(menu.rect.top).toBeGreaterThanOrEqual(initial.surface?.top - 1);
  expect(menu.rect.bottom).toBeLessThanOrEqual(menu.shellBottom);
  expect(menu.ownsHit).toBe(true);
  expect(final.shellBottom).toBeCloseTo(200, 0);
  expect(final.surfaceBottom).toBeLessThanOrEqual(200);
  expect(final.inputBottom).toBeLessThanOrEqual(final.surfaceBottom + 1);
  expect(final.readingHeight).toBe(initial.readingHeight);
  expect(final.legacyAttributes).toBe(0);
});
