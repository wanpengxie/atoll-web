import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request, seed = 10010) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'progress-demo', seed },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

test('NR10-01/04 public process detail and live timing', async ({ page, request }) => {
  await reset(request);
  await login(page);

  const marker = 'NR10 public process timing';
  const editor = page.getByRole('textbox', { name: '消息', exact: true });
  await editor.fill('@st');
  await page.getByRole('option', { name: /steward/ }).click();
  await editor.press('End');
  await editor.pressSequentially(marker);
  await page.getByRole('button', { name: '发送', exact: true }).click();

  const turn = page.locator('.agent-conversation-turn').filter({ hasText: marker }).first();
  await expect(turn).toBeVisible();
  const trail = turn.locator('.progress-trail.running');
  await expect(trail).toBeVisible();
  await expect(trail.locator('.progress-row')).toHaveCount(1);
  await expect(trail.locator('.progress-row time')).toHaveCount(1);
  await expect(trail.locator('.progress-row-duration')).toHaveCount(1);
  // The fixture's first tool observation carries typed input even before its
  // ended output arrives, so the public action advertises safe tool data. A
  // truly empty tool is covered by the owner unit contract.
  await expect(turn.getByRole('button', { name: '查看过程' })).toHaveCount(1);
  const before = await trail.locator('.progress-row-duration').textContent();
  await expect.poll(
    () => trail.locator('.progress-row-duration').textContent(),
    { timeout: 4_000, intervals: [100, 250, 500] },
  ).not.toBe(before);

  await trail.getByRole('button', { name: /展开过程详情/ }).click();
  const requestId = await turn.getAttribute('data-request-id');
  const detailText = '浏览器可见的过程正文，不是 wire JSON。';
  const response = await request.post(`${MOCK}/mock/control/action`, {
    data: {
      type: 'push_provisional',
      channel_id: 'c0',
      request_id: requestId,
      status: 'processing',
      payload: {
        process: {
          kind: 'stage',
          stage: 'thinking',
          text: detailText,
          input: { secret: 'nr10-wire-input' },
          output: { secret: 'nr10-wire-output' },
        },
      },
    },
  });
  expect(response.ok()).toBe(true);

  await expect(trail.locator('.progress-row-line', { hasText: detailText })).toBeVisible();
  await expect(turn.getByRole('button', { name: '查看过程' })).toHaveCount(1);
  const stageDetailTrigger = trail.locator('button[title="查看完整内容"]').filter({ hasText: detailText });
  await stageDetailTrigger.click();
  const drawer = page.getByRole('complementary', { name: '回合详情' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText(detailText);
  await expect(drawer.locator('pre')).toHaveCount(0);
  await expect(drawer).not.toContainText('nr10-wire-input');
  await expect(drawer).not.toContainText('nr10-wire-output');
  await drawer.getByRole('button', { name: '关闭过程' }).click();
  await expect(drawer).toHaveCount(0);
  await expect.poll(() => stageDetailTrigger.evaluate((node) => document.activeElement === node)).toBe(true);

  const liveToolCallID = 'nr10-live-tool-sync';
  const liveToolStart = await request.post(`${MOCK}/mock/control/action`, {
    data: {
      type: 'push_provisional',
      channel_id: 'c0',
      request_id: requestId,
      status: 'processing',
      payload: {
        process: {
          kind: 'tool', phase: 'started', tool_call_id: liveToolCallID,
          tool: 'search',
        },
      },
    },
  });
  expect(liveToolStart.ok()).toBe(true);
  // The row keeps its React key/DOM identity while its status text changes
  // from started to ended; locate it by stable trail position, not mutable
  // status text.
  const liveToolRow = trail.locator('.progress-row').last();
  await expect(liveToolRow).toBeVisible();
  await expect(liveToolRow).toContainText('tool: search …');
  await expect(liveToolRow.locator('button[title="查看完整内容"]')).toHaveCount(0);

  const liveToolEnd = await request.post(`${MOCK}/mock/control/action`, {
    data: {
      type: 'push_provisional',
      channel_id: 'c0',
      request_id: requestId,
      status: 'processing',
      payload: {
        process: {
          kind: 'tool', phase: 'ended', tool_call_id: liveToolCallID,
          tool: 'search', outcome: 'completed', detail: '同一调用的公开结果。',
          input: { query: '账本模型', filters: { scope: 'channel' }, secret: 'nr10-live-input' },
          output: { hits: 3, secret: 'nr10-live-output' },
        },
      },
    },
  });
  expect(liveToolEnd.ok()).toBe(true);
  await expect(liveToolRow.locator('button[title="查看完整内容"]')).toHaveCount(1);
  await liveToolRow.locator('button[title="查看完整内容"]').click();
  const liveDrawer = page.getByRole('complementary', { name: '回合详情' });
  await expect(liveDrawer).toContainText('同一调用的公开结果。');
  await expect(liveDrawer).toContainText('input');
  await expect(liveDrawer).toContainText('账本模型');
  await expect(liveDrawer).toContainText('output');
  await expect(liveDrawer).toContainText('3');
  await expect(liveDrawer).not.toContainText('nr10-live-input');
  await expect(liveDrawer).not.toContainText('nr10-live-output');
  const nested = liveDrawer.locator('details').first();
  await expect(nested).not.toHaveAttribute('open');
  // The panel is a side panel, not a modal: no focus trap to walk.
  await nested.locator('summary').click();
  await expect(nested).toHaveAttribute('open', '');
  await expect(liveDrawer).toContainText('scope');
  await liveDrawer.getByRole('button', { name: '关闭过程' }).click();
  await expect(liveDrawer).toHaveCount(0);
});

test('NR10 nested drawer input does not take over the timeline Reading owner', async ({ page, request }) => {
  await reset(request, 10011);
  await login(page);

  const marker = 'NR10 nested drawer boundary';
  const editor = page.getByRole('textbox', { name: '消息', exact: true });
  await editor.fill('@st');
  await page.getByRole('option', { name: /steward/ }).click();
  await editor.press('End');
  await editor.pressSequentially(marker);
  await page.getByRole('button', { name: '发送', exact: true }).click();

  const turn = page.locator('.agent-conversation-turn').filter({ hasText: marker }).first();
  await expect(turn).toBeVisible();
  const trail = turn.locator('.progress-trail.running');
  await expect(trail).toBeVisible();
  await trail.getByRole('button', { name: /展开过程详情/ }).click();
  const requestId = await turn.getAttribute('data-request-id');
  const detail = 'nested drawer boundary detail';
  const response = await request.post(`${MOCK}/mock/control/action`, {
    data: {
      type: 'push_provisional',
      channel_id: 'c0',
      request_id: requestId,
      status: 'processing',
      payload: { process: { kind: 'stage', stage: 'thinking', text: detail } },
    },
  });
  expect(response.ok()).toBe(true);

  const trigger = trail.locator('button[title="查看完整内容"]').filter({ hasText: detail });
  await expect(trigger).toBeVisible();
  await trigger.evaluate(() => {
    const root = document.querySelector('.timeline-message-list');
    const writes = [];
    const originalScrollTo = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function patchedScrollTo(...args) {
      if (this === root) writes.push({ method: 'scrollTo', args });
      return originalScrollTo?.apply(this, args);
    };
    window.__nr10DrawerBoundary = { root, writes, originalScrollTo };
  });

  const before = await page.evaluate(() => {
    const root = document.querySelector('.timeline-message-list');
    const timeline = document.querySelector('.timeline');
    const row = [...root.querySelectorAll('[data-presentation-row-id]')]
      .find((node) => { const rect = node.getBoundingClientRect(); const box = root.getBoundingClientRect(); return rect.bottom > box.top && rect.top < box.bottom; });
    return {
      mode: timeline?.dataset.viewportMode,
      scrollTop: root.scrollTop,
      anchorID: row?.closest('[data-presentation-row-id]')?.dataset.presentationRowId || '',
      anchorTop: row?.getBoundingClientRect().top ?? null,
    };
  });

  await trigger.click();
  const drawer = page.getByRole('complementary', { name: '回合详情' });
  await expect(drawer).toBeVisible();
  const inputResult = await drawer.locator('.side-panel-scroll').evaluate((node) => {
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -240 });
    node.dispatchEvent(wheel);
    const keydown = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Home' });
    node.dispatchEvent(keydown);
    const touch = (type, touches) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { configurable: true, value: touches });
      node.dispatchEvent(event);
    };
    touch('touchstart', [{ identifier: 1, clientY: 180 }]);
    touch('touchmove', [{ identifier: 1, clientY: 80 }]);
    touch('touchend', []);
    node.dispatchEvent(new Event('scroll', { bubbles: true }));
    node.dispatchEvent(new Event('scrollend', { bubbles: true }));
    return { keyPrevented: keydown.defaultPrevented };
  });
  await page.waitForTimeout(100);

  const after = await page.evaluate(() => {
    const root = document.querySelector('.timeline-message-list');
    const timeline = document.querySelector('.timeline');
    const row = [...root.querySelectorAll('[data-presentation-row-id]')]
      .find((node) => { const rect = node.getBoundingClientRect(); const box = root.getBoundingClientRect(); return rect.bottom > box.top && rect.top < box.bottom; });
    return {
      mode: timeline?.dataset.viewportMode,
      scrollTop: root.scrollTop,
      anchorID: row?.closest('[data-presentation-row-id]')?.dataset.presentationRowId || '',
      anchorTop: row?.getBoundingClientRect().top ?? null,
      writes: window.__nr10DrawerBoundary.writes,
    };
  });

  expect(inputResult.keyPrevented).toBe(false);
  expect(after.mode).toBe(before.mode);
  expect(after.scrollTop).toBe(before.scrollTop);
  expect(after.anchorID).toBe(before.anchorID);
  if (before.anchorTop != null && after.anchorTop != null) {
    expect(Math.abs(after.anchorTop - before.anchorTop)).toBeLessThanOrEqual(1);
  }
  expect(after.writes).toEqual([]);

  await drawer.getByRole('button', { name: '关闭过程' }).click();
  await expect(drawer).toHaveCount(0);
  await expect.poll(() => trigger.evaluate((node) => document.activeElement === node)).toBe(true);
  await page.evaluate(() => {
    const boundary = window.__nr10DrawerBoundary;
    if (boundary) Element.prototype.scrollTo = boundary.originalScrollTo;
  });
});
