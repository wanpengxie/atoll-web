import { expect, test } from '@playwright/test';

// These cases replace the retired fixture-only Waiting specs.  They enter the
// production WorkspaceApp, drive its public composer/mock transport boundary,
// and assert only rendered semantics and geometry.  No source fingerprint,
// React fiber, diagnostics journal, or fixture helper is part of the oracle.

async function reset(request, scenario, seed) {
  const response = await request.post('/mock/control/reset', { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function login(page, history = false) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.locator('.timeline-message-list')).toBeVisible();
  if (history) await expect.poll(() => page.locator('.timeline-message-list').evaluate((node) => node.scrollHeight > node.clientHeight * 1.5)).toBe(true);
}

async function compose(page, text) {
  const editor = page.getByLabel('消息');
  await editor.fill('@st');
  const option = page.getByRole('option', { name: /steward/ });
  if (await option.isVisible().catch(() => false)) await option.click();
  await editor.press('End');
  const lines = String(text).split('\n');
  for (const [index, line] of lines.entries()) {
    if (index) await editor.press('Shift+Enter');
    await editor.pressSequentially(line);
  }
}

async function send(page, text) {
  await compose(page, text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
}

async function waitForRunning(page, text) {
  await page.waitForFunction((needle) => [...document.querySelectorAll('[data-presentation-row-id]')]
    .some((row) => row.textContent?.includes(needle)
      && [...row.querySelectorAll('.task-control-buttons button')]
        .some((button) => button.textContent?.trim() === '停止')), text, { timeout: 15_000 });
}

async function establishQueued(page, ownerText, targetText) {
  await send(page, ownerText);
  await waitForRunning(page, ownerText);
  await send(page, targetText);
  await expect(page.getByRole('region', { name: '等待区' })).toContainText(targetText);
  return page.getByRole('region', { name: '等待区' }).locator('.agent-wait-item').filter({ hasText: targetText });
}

async function advance(request, count = 3) {
  for (let index = 0; index < count; index += 1) {
    const response = await request.post('/mock/control/advance', { data: { ms: 0, compute: { channel_id: 'c0' } } });
    expect(response.ok()).toBe(true);
  }
}

async function complete(request, requestId, text) {
  const response = await request.post('/mock/control/action', {
    data: { type: 'push_terminal', channel_id: 'c0', request_id: requestId, payload: { text: `已完成：${text}` } },
  });
  expect(response.ok()).toBe(true);
}

async function geometry(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return { top: box.top, right: box.right, bottom: box.bottom, left: box.left, width: box.width, height: box.height };
    };
    const list = document.querySelector('.timeline-message-list');
    return {
      reading: rect('.conversation-reading-slot'),
      stack: rect('.conversation-bottom-stack'),
      input: rect('.conversation-input-slot'),
      composer: rect('.composer-wrap'),
      obstruction: rect('.timeline-waiting-obstruction'),
      waiting: rect('.agent-wait-layer'),
      list: list ? { gap: list.scrollHeight - list.clientHeight - list.scrollTop, scrollTop: list.scrollTop } : null,
      focus: document.activeElement?.getAttribute('aria-label') || '',
      pageWidth: document.documentElement.scrollWidth,
    };
  });
}

function expectStable(before, after, fields = ['reading', 'stack', 'input', 'composer']) {
  for (const field of fields) {
    expect(before[field], `${field} baseline is present`).toBeTruthy();
    expect(after[field], `${field} after state is present`).toBeTruthy();
    for (const coordinate of ['top', 'right', 'bottom', 'left', 'width', 'height']) {
      expect(Math.abs(Number(after[field]?.[coordinate] || 0) - Number(before[field]?.[coordinate] || 0)), `${field}.${coordinate}`).toBeLessThanOrEqual(1);
    }
  }
}

async function attach(testInfo, name, value) {
  await testInfo.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' });
}

test('Waiting and status facts never change the fixed reading or Composer allocation', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1120, height: 760 });
  await reset(request, 'long-running-canonical', 0x92_18_11);
  await login(page);
  const baseline = await geometry(page);
  const queued = await establishQueued(page, 'layout-owner', 'layout-target');
  const withWaiting = await geometry(page);
  await page.getByRole('button', { name: '收起', exact: true }).click();
  await expect(page.locator('.agent-wait-layer.is-collapsed')).toBeVisible();
  const collapsed = await geometry(page);
  await page.getByRole('button', { name: '展开', exact: true }).click();
  const expanded = await geometry(page);
  await attach(testInfo, 'waiting-layout-stable.json', { baseline, withWaiting, collapsed, expanded });
  expectStable(baseline, withWaiting);
  expectStable(baseline, collapsed);
  expectStable(baseline, expanded);
  expect(withWaiting.obstruction?.height).toBeGreaterThan(0);
});

test('input growth and clear stay inside the overlay while reading client geometry is constant', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1120, height: 760 });
  await reset(request, 'long-running-canonical', 0x92_18_12);
  await login(page);
  const baseline = await geometry(page);
  await compose(page, 'line one\nline two\nline three\nline four\nline five\nline six');
  const grown = await geometry(page);
  const editor = page.getByLabel('消息');
  const grownEditor = await editor.evaluate((node) => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, overflowY: getComputedStyle(node).overflowY }));
  await editor.fill('');
  const cleared = await geometry(page);
  await attach(testInfo, 'waiting-input-growth.json', { baseline, grown, cleared, grownEditor });
  expectStable(baseline, grown, ['reading']);
  expectStable(baseline, cleared, ['reading']);
  expect(grownEditor.scrollHeight).toBeGreaterThanOrEqual(grownEditor.clientHeight);
  expect(cleared.input.bottom).toBeCloseTo(baseline.input.bottom, 0);
});

test('short mobile-style Surface keeps focus and makes oversized Composer internally scrollable', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await reset(request, 'long-running-history', 0x92_18_13);
  await login(page);
  const editor = page.getByLabel('消息');
  await editor.focus();
  await compose(page, Array.from({ length: 24 }, (_, index) => `mobile line ${index}`).join('\n'));
  const sample = await geometry(page);
  const editorGeometry = await editor.evaluate((node) => ({ scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, overflowY: getComputedStyle(node).overflowY }));
  await attach(testInfo, 'waiting-mobile-input.json', { sample, editorGeometry });
  expect(sample.focus).toBe('消息');
  expect(sample.pageWidth).toBeLessThanOrEqual(390);
  expect(editorGeometry.scrollHeight).toBeGreaterThan(editorGeometry.clientHeight);
  expect(editorGeometry.overflowY).toBe('auto');
  expect(sample.composer.bottom).toBeLessThanOrEqual(500 + 1);
});

test('production Timeline keeps queued to running to terminal outside the fixed geometry', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1120, height: 760 });
  await reset(request, 'long-running-canonical', 0x92_18_14);
  await login(page);
  const baseline = await geometry(page);
  const queued = await establishQueued(page, 'timeline-owner', 'timeline-target');
  const requestId = await queued.getAttribute('data-request-id');
  const running = await geometry(page);
  await advance(request);
  await complete(request, requestId, 'timeline-target');
  await expect(page.getByText('已完成：timeline-target', { exact: true })).toBeVisible();
  await expect(queued).toHaveCount(0);
  const terminal = await geometry(page);
  await attach(testInfo, 'waiting-timeline-states.json', { baseline, running, terminal });
  expectStable(baseline, running);
  expectStable(baseline, terminal);
});

test('queued request hands off once to a rapidly completed canonical row without duplicate semantics', async ({ page, request }, testInfo) => {
  await reset(request, 'long-running-canonical', 0x92_18_15);
  await login(page);
  const queued = await establishQueued(page, 'handoff-owner-rapid', 'handoff-rapid-terminal');
  const requestId = await queued.getAttribute('data-request-id');
  await advance(request);
  await complete(request, requestId, 'handoff-rapid-terminal');
  await expect(page.getByText('已完成：handoff-rapid-terminal', { exact: true })).toBeVisible();
  await expect(queued).toHaveCount(0);
  expect(await page.locator('[data-presentation-row-id]').filter({ hasText: 'handoff-rapid-terminal' }).count()).toBe(1);
  await testInfo.attach('waiting-handoff-rapid.json', { body: JSON.stringify(await geometry(page), null, 2), contentType: 'application/json' });
});

test('browsing-up handoff stays offscreen, preserves its anchor, and cleans up on channel exit', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1120, height: 760 });
  await reset(request, 'long-running-history', 0x92_18_16);
  await login(page, true);
  const queued = await establishQueued(page, 'handoff-owner-browsing', 'handoff-browsing-target');
  const list = page.locator('.timeline-message-list');
  await list.hover();
  await page.mouse.wheel(0, -900);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  const anchorBefore = await page.locator('[data-presentation-row-id]:visible').first().evaluate((node) => ({ id: node.dataset.presentationRowId, top: node.getBoundingClientRect().top }));
  const requestId = await queued.getAttribute('data-request-id');
  await advance(request);
  await complete(request, requestId, 'handoff-browsing-target');
  await expect(queued).toHaveCount(0);
  const anchorAfter = await page.locator('[data-presentation-row-id]:visible').first().evaluate((node) => ({ id: node.dataset.presentationRowId, top: node.getBoundingClientRect().top }));
  const channel = page.locator('button.channel-item').filter({ hasText: 'c0.project' }).first();
  await channel.click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await attach(testInfo, 'waiting-handoff-browsing.json', { anchorBefore, anchorAfter, finalChannel: await page.locator('main h1').textContent() });
  expect(anchorAfter.id).toBe(anchorBefore.id);
  expect(Math.abs(anchorAfter.top - anchorBefore.top)).toBeLessThanOrEqual(1);
  expect(await page.locator('.agent-wait-item').filter({ hasText: 'handoff-browsing-target' }).count()).toBe(0);
});

test('reduced motion performs the same semantic handoff without transition state', async ({ page, request }, testInfo) => {
  await reset(request, 'long-running-canonical', 0x92_18_17);
  await login(page);
  const queued = await establishQueued(page, 'handoff-owner-reduced', 'handoff-reduced-target');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const requestId = await queued.getAttribute('data-request-id');
  await advance(request);
  await complete(request, requestId, 'handoff-reduced-target');
  await expect(page.getByText('已完成：handoff-reduced-target', { exact: true })).toBeVisible();
  await expect(queued).toHaveCount(0);
  const animations = await page.evaluate(() => document.getAnimations().filter((animation) => /waiting-handoff/.test(animation.animationName || '')).length);
  await attach(testInfo, 'waiting-handoff-reduced-motion.json', { animations, geometry: await geometry(page) });
  expect(animations).toBe(0);
});

test('following keeps a fixed Waiting reserve through mount, controls and handoff', async ({ page, request }, testInfo) => {
  await reset(request, 'long-running-canonical', 0x92_18_18);
  await login(page);
  const before = await geometry(page);
  const queued = await establishQueued(page, 'obstruction-owner-following', 'obstruction-following-target');
  const mounted = await geometry(page);
  await page.getByRole('button', { name: '收起', exact: true }).click();
  const collapsed = await geometry(page);
  await page.getByRole('button', { name: '展开', exact: true }).click();
  const expanded = await geometry(page);
  await attach(testInfo, 'waiting-obstruction-following.json', { before, mounted, collapsed, expanded });
  expect(mounted.obstruction?.height).toBe(48);
  expect(collapsed.obstruction?.height).toBe(48);
  expect(expanded.obstruction?.height).toBe(48);
  expectStable(before, mounted);
});

test('browsing keeps its anchor while the fixed Waiting reserve stays unchanged', async ({ page, request }, testInfo) => {
  await reset(request, 'long-running-history', 0x92_18_19);
  await login(page, true);
  const queued = await establishQueued(page, 'obstruction-owner-browsing', 'obstruction-browsing-target');
  const list = page.locator('.timeline-message-list');
  await list.hover();
  await page.mouse.wheel(0, -900);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  const before = await geometry(page);
  const anchorBefore = await page.locator('[data-presentation-row-id]:visible').first().evaluate((node) => ({ id: node.dataset.presentationRowId, top: node.getBoundingClientRect().top }));
  const after = await geometry(page);
  const anchorAfter = await page.locator('[data-presentation-row-id]:visible').first().evaluate((node) => ({ id: node.dataset.presentationRowId, top: node.getBoundingClientRect().top }));
  await attach(testInfo, 'waiting-obstruction-browsing.json', { before, after, anchorBefore, anchorAfter });
  expect(after.obstruction?.height).toBe(48);
  expect(anchorAfter.id).toBe(anchorBefore.id);
  expect(Math.abs(anchorAfter.top - anchorBefore.top)).toBeLessThanOrEqual(1);
  await expect(queued).toBeVisible();
});

test('reduced motion uses the same fixed Waiting reserve without hidden controls', async ({ page, request }, testInfo) => {
  await reset(request, 'long-running-canonical', 0x92_18_20);
  await login(page);
  const queued = await establishQueued(page, 'obstruction-owner-reduced', 'obstruction-reduced-target');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const sample = await geometry(page);
  await attach(testInfo, 'waiting-obstruction-reduced-motion.json', { sample });
  expect(sample.obstruction?.height).toBe(48);
  expect(await page.getByRole('button', { name: '展开', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: '收起', exact: true }).count()).toBe(1);
});

async function runSendTrajectory({ page, request, testInfo, mode }) {
  await page.setViewportSize({ width: mode === 'mobile' ? 390 : 1120, height: mode === 'mobile' ? 500 : 760 });
  await reset(request, 'long-running-history', 0x92_18_30 + mode.length);
  await login(page, mode === 'browsing');
  const list = page.locator('.timeline-message-list');
  if (mode === 'browsing') {
    await list.hover();
    await page.mouse.wheel(0, -900);
    await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  }
  const before = await geometry(page);
  if (mode === 'existing-waiting') await establishQueued(page, 'send-existing-owner', 'send-existing-target');
  await send(page, mode === 'multiline' ? 'send line one\nsend line two\nsend line three' : `send ${mode}`);
  await expect(page.getByText(mode === 'multiline' ? 'send line one' : `send ${mode}`, { exact: false })).toBeVisible();
  const after = await geometry(page);
  await attach(testInfo, `waiting-send-${mode}.json`, { before, after });
  expectStable(before, after, ['reading']);
  expect(after.pageWidth).toBeLessThanOrEqual((mode === 'mobile' ? 390 : 1120) + 1);
  if (mode === 'browsing') expect(after.list.gap).toBeGreaterThan(1);
  else expect(after.list.gap).toBeLessThanOrEqual(24);
}

test('real App send transaction keeps queued WaitingLayer out of following-at-bottom geometry', async ({ page, request }, testInfo) => {
  await runSendTrajectory({ page, request, testInfo, mode: 'following-at-bottom' });
});

test('real App send transaction keeps queued WaitingLayer out of following-multiline-clear geometry', async ({ page, request }, testInfo) => {
  await runSendTrajectory({ page, request, testInfo, mode: 'multiline' });
});

test('real App send transaction keeps queued WaitingLayer out of following-existing-waiting geometry', async ({ page, request }, testInfo) => {
  await runSendTrajectory({ page, request, testInfo, mode: 'existing-waiting' });
});

test('real App send transaction keeps queued WaitingLayer out of wheel-takeover-after-send geometry', async ({ page, request }, testInfo) => {
  await runSendTrajectory({ page, request, testInfo, mode: 'browsing' });
});
