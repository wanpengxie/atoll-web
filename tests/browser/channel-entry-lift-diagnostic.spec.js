import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const OUT = process.env.ATOLL_ENTRY_OUT || '/tmp/channel-entry-lift-evidence';
const LABEL = process.env.ATOLL_ENTRY_LABEL || 'current';

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'multi-channel', seed: 0x5dcb_68 },
  });
  expect(response.ok()).toBe(true);
}

async function arm(page) {
  await page.evaluate(() => {
    const rect = (node) => {
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return {
        top: Number(box.top.toFixed(2)), bottom: Number(box.bottom.toFixed(2)),
        height: Number(box.height.toFixed(2)),
      };
    };
    const style = (node) => {
      if (!node) return null;
      const value = getComputedStyle(node);
      return {
        transform: value.transform,
        transitionProperty: value.transitionProperty,
        transitionDuration: value.transitionDuration,
        animationName: value.animationName,
        opacity: value.opacity,
      };
    };
    const state = { active: true, mark: 'armed', startedAt: performance.now(), frames: [] };
    const tick = () => {
      if (!state.active) return;
      const surface = document.querySelector('.conversation-surface');
      const reading = document.querySelector('.conversation-reading-slot');
      const stack = document.querySelector('.timeline-reading-stack');
      const activeLayer = document.querySelector('.timeline-reading-layer.is-active');
      const incoming = document.querySelector('.timeline-reading-layer.is-incoming');
      const outgoing = document.querySelector('.timeline-reading-layer.is-outgoing');
      const list = activeLayer?.querySelector('.timeline-message-list')
        || incoming?.querySelector('.timeline-message-list')
        || document.querySelector('.timeline-message-list');
      const content = list?.querySelector('.timeline-following-tail-content, [data-testid="virtuoso-item-list"]')
        || list?.firstElementChild;
      const rows = [...(list?.querySelectorAll('[data-presentation-row-id]') || [])];
      const inputSlot = document.querySelector('.conversation-input-slot');
      const composer = document.querySelector('.composer-wrap');
      state.frames.push({
        at: Number((performance.now() - state.startedAt).toFixed(1)),
        mark: state.mark,
        channel: document.querySelector('main h1')?.textContent?.trim() || '',
        mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
        listType: list?.dataset.readingContainer || (list ? 'virtuoso' : ''),
        rowCount: rows.length,
        firstID: rows[0]?.dataset.presentationRowId || '',
        lastID: rows.at(-1)?.dataset.presentationRowId || '',
        pane: rect(document.querySelector('.dynamic-message-pane')),
        surface: rect(surface),
        reading: rect(reading),
        timeline: rect(document.querySelector('.timeline')),
        stack: rect(stack),
        list: rect(list),
        content: rect(content),
        first: rect(rows[0]),
        last: rect(rows.at(-1)),
        inputSlot: rect(inputSlot),
        composer: rect(composer),
        surfaceStyle: style(surface),
        readingStyle: style(reading),
        stackStyle: style(stack),
        layerStyle: style(activeLayer || incoming),
        listStyle: style(list),
        inputStyle: style(inputSlot),
        inputResize: surface?.dataset.inputResizeTransition || '',
        inputGrowth: surface?.dataset.inputResizeGrowth || '',
        sendClear: inputSlot?.dataset.sendClearTransition || '',
        handoffPending: stack?.dataset.handoffPending || '',
        handoffReady: stack?.dataset.handoffReady || '',
        focused: document.activeElement === list,
      });
      requestAnimationFrame(tick);
    };
    window.__ENTRY_LIFT__ = {
      mark(value) { state.mark = value; },
      stop() { state.active = false; return state.frames; },
    };
    requestAnimationFrame(tick);
  });
}

test('cold entry and same-session channel switches record first-frame geometry', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1120, height: 620 });
  await reset(request);
  await page.goto('/');
  await arm(page);
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.evaluate(() => window.__ENTRY_LIFT__.mark('cold-login-click'));
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.locator('.timeline-message-list [data-presentation-row-id]').last()).toBeVisible();
  await page.waitForTimeout(1_200);

  await page.evaluate(() => window.__ENTRY_LIFT__.mark('switch-project-click'));
  await page.locator('.channel-item').filter({
    has: page.locator('.channel-name', { hasText: /^c0\.project$/ }),
  }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.locator('.timeline-message-list [data-presentation-row-id]').last()).toBeVisible();
  await page.waitForTimeout(1_200);

  await page.evaluate(() => window.__ENTRY_LIFT__.mark('switch-home-click'));
  await page.locator('.channel-item').filter({
    has: page.locator('.channel-name', { hasText: /^c0$/ }),
  }).click();
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.locator('.timeline-message-list [data-presentation-row-id]').last()).toBeVisible();
  await page.waitForTimeout(1_200);

  const frames = await page.evaluate(() => window.__ENTRY_LIFT__.stop());
  const path = resolve(OUT, `${LABEL}.json`);
  await mkdir(OUT, { recursive: true });
  await writeFile(path, `${JSON.stringify({ label: LABEL, frames }, null, 2)}\n`, 'utf8');
  await testInfo.attach(`${LABEL}.json`, { path, contentType: 'application/json' });
  expect(frames.some((frame) => frame.mark === 'cold-login-click' && frame.rowCount > 0)).toBe(true);
  expect(frames.some((frame) => frame.mark === 'switch-project-click' && frame.channel === 'c0.project' && frame.rowCount > 0)).toBe(true);
  expect(frames.some((frame) => frame.mark === 'switch-home-click' && frame.channel === 'c0' && frame.rowCount > 0)).toBe(true);
  const entryMotionFrames = frames.filter((frame) => frame.rowCount > 0
    && ['switch-project-click', 'switch-home-click'].includes(frame.mark)
    && frame.inputResize);
  expect(entryMotionFrames, 'channel entry must not borrow the user-authored composer resize animation').toEqual([]);
});
