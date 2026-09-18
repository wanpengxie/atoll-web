import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';


async function reset(request, scenario = 'message-flow', seed = 1301) {
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

test('F3-001..004/006 动态只保留用户消息与原地定格的 Agent 气泡', async ({ page, request }) => {
  await reset(request); await login(page);
  const editor = page.getByLabel('消息');
  await editor.fill('@st');
  await page.getByRole('option', { name: /steward/ }).click();
  await editor.press('End');
  await editor.pressSequentially('浏览器验收一条回合');
  await page.getByRole('button', { name: /发送/ }).click();
  const turn = page.locator('.turn-card').filter({ hasText: '浏览器验收一条回合' });
  await expect(turn).toBeVisible();
  await expect(turn).not.toContainText('向 Agent 提问');
  const bubble = turn.locator('.agent-turn-bubble');
  await expect(bubble).toBeVisible();
  await expect(bubble.getByRole('button', { name: /编辑|停止|重试/ })).toHaveCount(0);
  await expect(bubble.locator('.progress-trail-toggle')).toContainText('1 条过程记录');
  await expect(bubble).not.toContainText(/turn-\d|回合 \d/);
  await expect(turn.locator('.turn-process-summary')).toHaveCount(0);
  await page.reload();
  await expect(turn).toContainText('浏览器验收一条回合');
  await expect(turn).toBeInViewport();
});

test('F3-003..005 键盘、多行草稿、附件入口与 320px 单表面可达', async ({ page, request }) => {
  await reset(request, 'long-running', 1302); await login(page);
  const editor = page.getByLabel('消息');
  await editor.fill('第一行\n第二行');
  await expect(editor).toContainText('第一行');
  await expect(editor).toContainText('第二行');
  await page.getByRole('button', { name: '从频道文件选择' }).click();
  await expect(page.getByRole('dialog', { name: '从频道文件选择' })).toBeVisible();
  await page.getByRole('button', { name: '关闭频道文件选择' }).click();
  await expect(page.getByRole('tab', { name: '动态' })).toHaveAttribute('aria-selected', 'true');
  await expect(editor).toContainText('第一行');
  await expect(editor).toContainText('第二行');
  await editor.fill('@st');
  await page.getByRole('option', { name: /steward/ }).click();
  await editor.press('End');
  await editor.pressSequentially('检查窄屏回合');
  await page.getByRole('button', { name: /发送/ }).click();
  const turn = page.locator('.turn-card').filter({ hasText: '检查窄屏回合' });
  await expect(turn).toBeVisible();
  await page.setViewportSize({ width: 320, height: 720 });
  await turn.focus();
  const geometry = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, bubble: document.querySelector('.agent-turn-bubble').getBoundingClientRect().width }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.bubble).toBeLessThanOrEqual(320);
  await expect(turn.locator('.agent-turn-bubble').getByRole('button', { name: /编辑|停止|重试/ })).toHaveCount(0);
});

// @ 是动词不是文本：选中的人离开正文、上到收件人条，正文里恒不留下任何"疑似
// 收件人"的字符串。收件人跟正文一样属于草稿，切走再回来恒还在。
test('Composer 的 @成员是收件人条上的芯片，正文恒是纯文本', async ({ page, request }) => {
  await reset(request, 'message-flow', 1305); await login(page);
  const editor = page.getByLabel('消息');
  const banner = page.getByRole('status', { name: '收件人' });
  await editor.fill('@st');
  await page.getByRole('option', { name: /steward/ }).click();
  await expect(banner.locator('.composer-target-pill.is-picked')).toHaveCount(1);
  await expect(banner).toContainText('@steward');
  await expect(editor).not.toContainText('@');

  await page.locator('#workspace-files-toggle').click();
  await page.getByRole('tab', { name: '动态' }).click();
  const restored = page.getByLabel('消息');
  await expect(page.getByRole('status', { name: '收件人' }).locator('.composer-target-pill.is-picked')).toHaveCount(1);
  await restored.press('End');
  await restored.pressSequentially('检查结构化收件人');
  await page.getByRole('button', { name: /发送/ }).click();
  await expect(page.locator('.turn-card').filter({ hasText: '检查结构化收件人' })).toBeVisible();
});

// 这条测的是"粘一段带 @ 的文本就发不出去"那个病：正文里的 @ 恒只是一个字符，
// ESC 是它的出口——@ 后面按 ESC，选择框收起，接着写邮箱。
test('正文里的 @ 是字面量：ESC 关掉选择框后照常写、照常发', async ({ page, request }) => {
  await reset(request, 'message-flow', 1306); await login(page);
  const editor = page.getByLabel('消息');
  await editor.click();
  // 这一个 @ 不是在叫人：ESC 关掉选择框，把邮箱写完，@ 就只是一个字符。
  await page.keyboard.type('@st');
  await expect(page.getByRole('option', { name: /steward/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('option', { name: /steward/ })).toHaveCount(0);
  await page.keyboard.type('eward@atoll.local 看下 ');
  await expect(page.getByRole('status', { name: '收件人' }).locator('.composer-target-pill.is-picked')).toHaveCount(0);

  // 摘掉一个 @ 恒只摘掉那一个：下一个 @ 照常打开选择框。
  await page.keyboard.type('@st');
  await page.getByRole('option', { name: /steward/ }).click();
  await expect(page.getByRole('status', { name: '收件人' }).locator('.composer-target-pill.is-picked')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('.turn-card').filter({ hasText: '@steward@atoll.local 看下' })).toBeVisible();
});

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
  const timeline = page.getByRole('tabpanel', { name: '动态' });
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
  const timeline = page.getByRole('tabpanel', { name: '动态' });
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
  // A zero-sized mount handoff is not a user-operable composer. If the editor
  // is visible, its owning surface must already have real geometry.
  expect(handoff.inputVisible && handoff.surfaceHeight === 0, JSON.stringify(handoff)).toBe(false);
  // This case measures input growth, not the separate 500ms readable-restore
  // handoff. Capture the baseline only after both production surfaces have a
  // committed non-zero box; a transient zero-sized composer is not geometry.
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
      rows.push({
        ...geometry(),
      });
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
