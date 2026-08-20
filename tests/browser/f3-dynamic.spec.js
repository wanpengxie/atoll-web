import { expect, test } from '@playwright/test';

const MOCK = 'http://127.0.0.1:8832';

async function reset(request, scenario = 'message-flow', seed = 1301) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByLabel('邮箱').fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

test('F3-001..004/006 动态保持业务主线，回合详情完整且来源可返回', async ({ page, request }) => {
  await reset(request); await login(page);
  await page.getByLabel('消息').fill('浏览器验收一条回合');
  await page.getByRole('button', { name: /发送/ }).click();
  const turn = page.locator('.turn-card').filter({ hasText: '浏览器验收一条回合' });
  await expect(turn).toBeVisible();
  await expect(turn).not.toContainText('向 Agent 提问');
  await expect(turn.locator('.turn-process-summary')).toContainText(/已完成|处理中/);
  await expect(turn).not.toContainText('工具 · mock.ping');

  await turn.locator('.request-message').hover();
  const timeline = page.locator('.timeline');
  const composer = page.locator('.composer-wrap');
  const requestTopBefore = await turn.locator('.request-message').evaluate((node) => node.getBoundingClientRect().top);
  await turn.getByRole('button', { name: '查看详情' }).click();
  const context = page.getByRole('region', { name: '回合详情' });
  await expect(context).toBeVisible();
  await expect(timeline).toBeVisible();
  await expect(composer).toBeVisible();
  await expect(turn.locator('.turn-inline-detail')).toBeVisible();
  const placement = await turn.evaluate((node) => {
    const request = node.querySelector('.request-message');
    const process = node.querySelector('.turn-process-summary')?.closest('.information-flow-row');
    const detail = node.querySelector('.turn-inline-detail')?.closest('.information-flow-row');
    const response = node.querySelector('.turn-response');
    return {
      requestTop: request.getBoundingClientRect().top,
      ordered: request.compareDocumentPosition(process) & Node.DOCUMENT_POSITION_FOLLOWING
        && process.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING
        && detail.compareDocumentPosition(response) & Node.DOCUMENT_POSITION_FOLLOWING,
    };
  });
  expect(Math.abs(placement.requestTop - requestTopBefore)).toBeLessThanOrEqual(2);
  expect(Boolean(placement.ordered)).toBe(true);
  await expect(context).toContainText('工具 · mock.ping');
  await expect(context).toContainText('技术审计');
  const processSurfaces = await context.locator('.turn-context-process-scroll').evaluateAll((nodes) => nodes.map((node) => ({ maxHeight: Number.parseFloat(getComputedStyle(node).maxHeight), overflowY: getComputedStyle(node).overflowY })));
  expect(processSurfaces.length).toBeGreaterThan(0);
  expect(processSurfaces.every((item) => item.maxHeight <= 240 && item.overflowY === 'auto')).toBe(true);
  await expect(page).toHaveURL(/focus=turn%3A/);
  await page.reload();
  await expect(page.getByRole('region', { name: '回合详情' })).toBeVisible();
  await expect(turn).toContainText('浏览器验收一条回合');
  await context.getByRole('button', { name: '收起回合详情' }).click();
  await expect(page).toHaveURL(/#\/channels\/c0\/dynamic$/);
  await expect(turn).toBeInViewport();
});

test('F3-003..005 键盘、多行草稿、附件入口与 320px 单表面可达', async ({ page, request }) => {
  await reset(request, 'long-running', 1302); await login(page);
  const editor = page.getByLabel('消息');
  await editor.fill('第一行\n第二行');
  await expect(editor).toContainText('第一行');
  await expect(editor).toContainText('第二行');
  await page.getByRole('button', { name: '＋ 附件' }).click();
  await expect(page.getByRole('tab', { name: '文件' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '动态' }).click();
  await expect(editor).toContainText('第一行');
  await expect(editor).toContainText('第二行');
  await editor.fill('检查窄屏回合');
  await page.getByRole('button', { name: /发送/ }).click();
  const turn = page.locator('.turn-card').filter({ hasText: '检查窄屏回合' });
  await expect(turn).toBeVisible();
  await page.setViewportSize({ width: 320, height: 720 });
  await turn.focus();
  await turn.getByRole('button', { name: '查看详情' }).click();
  const context = page.getByRole('region', { name: '回合详情' });
  await expect(context).toBeVisible();
  const geometry = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, context: document.querySelector('.turn-inline-detail').getBoundingClientRect().width }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.context).toBeLessThanOrEqual(320);
  await expect(context.getByRole('button', { name: /取消任务|调整方向|打断回合/ }).first()).toBeVisible();
});

test('Composer 的 @成员是可恢复的 Mention Node，不靠正文猜收件人', async ({ page, request }) => {
  await reset(request, 'message-flow', 1305); await login(page);
  const editor = page.getByLabel('消息');
  await editor.fill('@st');
  await page.getByRole('option', { name: /steward/ }).click();
  await expect(editor.locator('[data-type="mention"][data-id="steward"]')).toHaveCount(1);

  await page.getByRole('tab', { name: '文件' }).click();
  await page.getByRole('tab', { name: '动态' }).click();
  const restored = page.getByLabel('消息');
  await expect(restored.locator('[data-type="mention"][data-id="steward"]')).toHaveCount(1);
  await restored.press('End');
  await restored.pressSequentially('检查结构化收件人');
  await page.getByRole('button', { name: /发送/ }).click();
  await expect(page.locator('.turn-card').filter({ hasText: '检查结构化收件人' })).toBeVisible();
});

test('审批使用正文列，后台活动不污染消息主线', async ({ page, request }) => {
  await reset(request, 'multi-channel', 1303); await login(page);
  await expect(page.locator('.approval-card')).toBeAttached();
  await expect(page.locator('.narration')).toHaveCount(0);
  await expect(page.locator('.information-flow-row > .information-flow-content > .approval-card')).toHaveCount(1);

  async function alignment() {
    return page.evaluate(() => {
      const row = document.querySelector('.message-row');
      const body = row?.querySelector('.message-body');
      const approval = document.querySelector('.approval-card');
      const edges = (node) => node ? { left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right } : null;
      return { body: edges(body), approval: edges(approval), viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth };
    });
  }

  const desktop = await alignment();
  expect(desktop.approval).not.toBeNull();
  expect(Math.abs(desktop.approval.left - desktop.body.left)).toBeLessThanOrEqual(1);
  expect(desktop.approval.right).toBeLessThanOrEqual(desktop.body.right + 1);

  await page.setViewportSize({ width: 320, height: 720 });
  const mobile = await alignment();
  expect(Math.abs(mobile.approval.left - mobile.body.left)).toBeLessThanOrEqual(1);
  expect(mobile.approval.right).toBeLessThanOrEqual(mobile.body.right + 1);
  expect(mobile.scrollWidth).toBeLessThanOrEqual(mobile.viewport);
});

test('新条目到达时，固定在底部的信息流不反向抖动', async ({ page, request }) => {
  await reset(request, 'multi-channel', 1304); await login(page);
  await expect(page.locator('.approval-card')).toBeAttached();

  const sampling = page.evaluate(async () => {
    const viewport = document.querySelector('.timeline');
    viewport.scrollTo(0, viewport.scrollHeight);
    const rows = [];
    for (let index = 0; index < 30; index += 1) {
      rows.push({
        top: viewport.scrollTop,
        bottom: viewport.scrollHeight - viewport.clientHeight,
        approvals: document.querySelectorAll('.approval-card').length,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return rows;
  });
  await page.waitForTimeout(300);
  expect((await request.get(`${MOCK}/mock/approve`)).ok()).toBe(true);
  const rows = await sampling;

  expect(rows.at(-1).approvals).toBeGreaterThan(rows[0].approvals);
  expect(rows.filter((row, index) => index > 0 && row.top + 1 < rows[index - 1].top)).toHaveLength(0);
  expect(rows.every((row) => Math.abs(row.bottom - row.top) <= 2)).toBe(true);
});
