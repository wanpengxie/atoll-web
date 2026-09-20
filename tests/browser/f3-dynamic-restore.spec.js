// Successor coverage for the absent fae8b70 tests/browser/f3-dynamic.spec.js and
// f3-math-markdown.spec.js contracts. These tests use only the current public
// App → WorkspaceApp → ConversationSurface/Composer/Markdown owners.
import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request, scenario, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

async function selectSteward(page) {
  const current = page.locator('.model-selector-trigger').filter({ hasText: 'steward' });
  if (await current.isVisible().catch(() => false)) return;
  const chooser = page.getByRole('button', { name: '选择 Agent' });
  if (await chooser.isVisible().catch(() => false)) {
    await chooser.click();
    await page.getByRole('menu', { name: '选择目标 Agent' })
      .getByRole('menuitem', { name: 'steward' }).click();
  }
  await expect(current).toBeVisible();
}

async function sendToSteward(page, text) {
  await selectSteward(page);
  const editor = page.getByRole('textbox', { name: '消息', exact: true });
  await editor.fill(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
}

test('Composer 聚焦时只有一个紧凑的外层焦点表面', async ({ page, request }) => {
  await reset(request, 'message-flow', 1306); await login(page);
  const geometry = await page.evaluate(() => {
    const node = document.querySelector('.composer-editor');
    const surface = document.querySelector('.composer-surface');
    node.focus();
    const editorStyle = getComputedStyle(node);
    const surfaceStyle = getComputedStyle(surface);
    return {
      editorOutline: editorStyle.outlineStyle,
      editorHeight: node.getBoundingClientRect().height,
      surfaceHeight: surface.getBoundingClientRect().height,
      surfaceRadius: Number.parseFloat(surfaceStyle.borderRadius),
    };
  });
  expect(geometry.editorOutline).toBe('none');
  expect(geometry.editorHeight).toBeLessThanOrEqual(50);
  expect(geometry.surfaceHeight).toBeLessThanOrEqual(96);
  expect(geometry.surfaceRadius).toBeGreaterThanOrEqual(12);
});

test('连续中文输入不改变 Composer 与消息区的布局尺寸', async ({ page, request }) => {
  await reset(request, 'message-flow', 1307); await login(page);
  const editor = page.getByLabel('消息');
  const timeline = page.locator('#workspace-panel-dynamic');
  const composer = page.locator('.composer-surface');
  const measure = async () => {
    const composerRect = await composer.evaluate((node) => node.getBoundingClientRect().toJSON());
    const timelineRect = await timeline.evaluate((node) => node.getBoundingClientRect().toJSON());
    return { composerHeight: composerRect.height, timelineTop: timelineRect.top, timelineBottom: timelineRect.bottom };
  };
  await editor.focus();
  const before = await measure();
  await editor.pressSequentially('这是一段连续输入的中文内容，用来确认消息区不会随着输入过程上下抖动。', { delay: 10 });
  const after = await measure();
  expect(Math.abs(after.timelineTop - before.timelineTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.timelineBottom - before.timelineBottom)).toBeLessThanOrEqual(1);
});

test('Composer 随多行内容向上增高，并稳定地为消息区让出同等空间', async ({ page, request }, testInfo) => {
  await reset(request, 'message-flow', 1308); await login(page);
  const editor = page.getByLabel('消息');
  const timeline = page.locator('#workspace-panel-dynamic');
  const composer = page.locator('.composer-surface');
  const handoff = await page.evaluate(() => {
    const surface = document.querySelector('.composer-surface');
    const input = document.querySelector('[aria-label="消息"]');
    const surfaceRect = surface?.getBoundingClientRect();
    const inputRect = input?.getBoundingClientRect();
    return {
      surfaceHeight: surfaceRect?.height || 0,
      inputHeight: inputRect?.height || 0,
      inputVisible: Boolean(inputRect?.width && inputRect?.height && getComputedStyle(input).visibility !== 'hidden'),
      restoring: Boolean(document.querySelector('.timeline-reading-restore')),
    };
  });
  await testInfo.attach('composer-readiness-handoff.json', {
    body: Buffer.from(JSON.stringify(handoff, null, 2)),
    contentType: 'application/json',
  });
  expect(handoff.inputVisible && handoff.surfaceHeight === 0, JSON.stringify(handoff)).toBe(false);
  await expect(page.locator('.timeline-message-list')).toBeVisible();
  await expect.poll(() => composer.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThan(0);
  const beforeSurface = await composer.evaluate((node) => node.getBoundingClientRect().height);
  const beforeTimeline = await timeline.evaluate((node) => node.getBoundingClientRect().toJSON());
  await editor.fill('第一行\n第二行\n第三行\n第四行');
  const afterSurface = await composer.evaluate((node) => node.getBoundingClientRect().height);
  const afterTimeline = await timeline.evaluate((node) => node.getBoundingClientRect().toJSON());
  const evidence = JSON.stringify({ beforeSurface, afterSurface, beforeTimeline, afterTimeline });
  expect(afterSurface).toBeGreaterThan(beforeSurface);
  expect(Math.abs(afterTimeline.top - beforeTimeline.top)).toBeLessThanOrEqual(1);
  expect(Math.abs((beforeTimeline.bottom - afterTimeline.bottom) - (afterSurface - beforeSurface)), evidence).toBeLessThanOrEqual(1);
});

test('审批使用正文列，后台活动不污染消息主线', async ({ page, request }) => {
  await reset(request, 'multi-channel', 1303); await login(page);
  await expect(page.locator('.approval-card')).toBeAttached();
  await expect(page.locator('.narration')).toHaveCount(0);
  await expect(page.locator('.information-flow-row > .information-flow-content > .approval-card')).toHaveCount(1);

  async function alignment() {
    return page.evaluate(() => {
      const approval = document.querySelector('.approval-card');
      const content = approval?.closest('.information-flow-content');
      const edges = (node) => node ? { left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right } : null;
      return { content: edges(content), approval: edges(approval), viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth };
    });
  }

  const desktop = await alignment();
  expect(desktop.approval).not.toBeNull();
  expect(Math.abs(desktop.approval.left - desktop.content.left)).toBeLessThanOrEqual(1);
  expect(desktop.approval.right).toBeLessThanOrEqual(desktop.content.right + 1);

  await page.setViewportSize({ width: 320, height: 720 });
  const mobile = await alignment();
  expect(Math.abs(mobile.approval.left - mobile.content.left)).toBeLessThanOrEqual(1);
  expect(mobile.approval.right).toBeLessThanOrEqual(mobile.content.right + 1);
  expect(mobile.scrollWidth).toBeLessThanOrEqual(mobile.viewport);
});

test('新条目到达时，固定在底部的信息流不反向抖动', async ({ page, request }, testInfo) => {
  await reset(request, 'multi-channel', 1304); await login(page);
  await expect(page.locator('.approval-card')).toBeAttached();

  const sampling = page.evaluate(async () => {
    const viewport = document.querySelector('.timeline-message-list');
    viewport.scrollTo(0, viewport.scrollHeight);
    const rows = [];
    const trace = [];
    let tracing = true;
    const geometry = () => ({
      top: viewport.scrollTop,
      bottom: viewport.scrollHeight - viewport.clientHeight,
      approvals: document.querySelectorAll('.approval-card').length,
    });
    window.__ATOLL_READING_TRACE__ = (entry) => trace.push({ kind: 'adapter', ...entry, ...geometry() });
    const frame = (at) => {
      if (!tracing) return;
      trace.push({ kind: 'raf', stage: 'raf', at, ...geometry() });
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    for (let index = 0; index < 30; index += 1) {
      rows.push({ ...geometry() });
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    tracing = false;
    delete window.__ATOLL_READING_TRACE__;
    return { rows, trace };
  });
  await page.waitForTimeout(300);
  expect((await request.get(`${MOCK}/mock/approve`)).ok()).toBe(true);
  const { rows, trace } = await sampling;
  await testInfo.attach('append-timing.json', {
    body: Buffer.from(JSON.stringify({ rows, trace }, null, 2)),
    contentType: 'application/json',
  });

  expect(rows.at(-1).approvals).toBeGreaterThan(rows[0].approvals);
  expect(rows.filter((row, index) => index > 0 && row.top + 1 < rows[index - 1].top)).toHaveLength(0);
  expect(rows.every((row) => Math.abs(row.bottom - row.top) <= 2), JSON.stringify(rows)).toBe(true);
});

test('研究消息里的 LaTeX 括号语法渲染为数学公式且不撑破窄屏', async ({ page, request }) => {
  await reset(request, 'deep-history', 1312);
  await page.setViewportSize({ width: 320, height: 720 });
  await login(page);

  const editor = page.getByRole('textbox', { name: '消息', exact: true });
  await editor.click();
  await page.keyboard.type('@st');
  await page.getByRole('option', { name: /steward/ }).click();
  await page.keyboard.insertText([
    '行内公式：\\(M_t = \\operatorname{Fold}_R(H_t)\\)',
    '',
    '\\[',
    '\\text{Problem}\\rightarrow\\text{Constructional Model}\\rightarrow\\text{Machine}\\rightarrow\\text{Running Witness}',
    '\\]',
  ].join('\n'));
  await page.getByRole('button', { name: '发送', exact: true }).click();

  const message = page.locator('.turn-card.self > .request-message').last();
  await expect(message.locator('.katex')).toHaveCount(2);
  await expect(page.getByText('PONG', { exact: true }).last()).toBeVisible();
  const readLayout = () => message.locator('.katex-display').evaluate((node) => ({
    connected: node.isConnected,
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    displayClientWidth: node.clientWidth,
    displayScrollWidth: node.scrollWidth,
    overflowX: getComputedStyle(node).overflowX,
  }));
  await expect.poll(readLayout).toMatchObject({ connected: true, displayClientWidth: expect.any(Number), overflowX: 'auto' });
  const layout = await readLayout();
  const evidence = JSON.stringify(layout);
  expect(layout.pageWidth, evidence).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.displayClientWidth, evidence).toBeGreaterThan(0);
  expect(layout.displayScrollWidth, evidence).toBeGreaterThanOrEqual(layout.displayClientWidth);
  expect(layout.overflowX, evidence).toBe('auto');
});

test('权威当前消息的长正文首次进入即展开，成为历史后按默认折叠', async ({ page, request }) => {
  await reset(request, 'deep-history', 1313); await login(page);

  const marker = 'LATEST-AUTHORITY-ENTRY';
  const longMessage = [marker, ...Array.from({ length: 44 }, (_, index) => `当前消息第 ${index + 1} 行`)].join('\n');
  await sendToSteward(page, longMessage);
  const activeLayer = page.locator('.timeline-reading-layer.is-active');
  const row = activeLayer.getByRole('article').filter({ hasText: marker }).last();
  // The current public renderer treats the latest role as an expanded body;
  // it does not need to expose a redundant expanded toggle while current.
  await expect(row).toContainText('当前消息第 44 行');
  await expect(row.locator('.message-fold.is-folded')).toHaveCount(0);

  await page.getByRole('navigation', { name: '频道' }).getByText('c0.project', { exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await page.getByRole('navigation', { name: '频道' }).getByText('c0', { exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('c0');
  const returnedRow = page.locator('.timeline-reading-layer.is-active').getByRole('article').filter({ hasText: marker }).last();
  await expect(returnedRow).toContainText('当前消息第 44 行');
  await expect(returnedRow.locator('.message-fold.is-folded')).toHaveCount(0);

  await sendToSteward(page, '把上一条变成历史，但不写入永久展开默认。');
  const historicalRow = page.locator('.timeline-reading-layer.is-active').getByRole('article').filter({ hasText: marker }).last();
  await expect(historicalRow.getByRole('button', { name: /展开全文/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(historicalRow.locator('.message-fold.is-folded')).toHaveCount(1);
});
