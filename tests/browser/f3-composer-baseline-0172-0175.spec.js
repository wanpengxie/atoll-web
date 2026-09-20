import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// Exact browser successors for fae8b70:tests/browser/f3-dynamic.spec.js
// TC-0172..TC-0175. Keep each historical action/observable as its own test;
// these are not aggregate smoke coverage. Only public App/Composer/Files
// controls are used.

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

test('TC-0172 F3-001..004/006 动态只保留用户消息与原地定格的 Agent 气泡', async ({ page, request }) => {
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

test('TC-0173 F3-003..005 键盘、多行草稿、附件入口与 320px 单表面可达', async ({ page, request }) => {
  await reset(request, 'long-running', 1302); await login(page);
  const editor = page.getByLabel('消息');
  await editor.fill('第一行\n第二行');
  await expect(editor).toContainText('第一行');
  await expect(editor).toContainText('第二行');

  // Preserve the historical public action. If the modal was removed without
  // an equivalent public Composer affordance, this must remain a real red.
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
  const geometry = await page.evaluate(() => ({
    viewport: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bubble: document.querySelector('.agent-turn-bubble')?.getBoundingClientRect().width || 0,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.bubble).toBeLessThanOrEqual(320);
  await expect(turn.locator('.agent-turn-bubble').getByRole('button', { name: /编辑|停止|重试/ })).toHaveCount(0);
});

test('TC-0174 Composer 的 @成员是收件人条上的芯片，正文恒是纯文本', async ({ page, request }) => {
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

test('TC-0175 正文里的 @ 是字面量：ESC 关掉选择框后照常写、照常发', async ({ page, request }) => {
  await reset(request, 'message-flow', 1306); await login(page);
  const editor = page.getByLabel('消息');
  await editor.click();
  await page.keyboard.type('@st');
  await expect(page.getByRole('option', { name: /steward/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('option', { name: /steward/ })).toHaveCount(0);
  await page.keyboard.type('eward@atoll.local 看下 ');
  await expect(page.getByRole('status', { name: '收件人' }).locator('.composer-target-pill.is-picked')).toHaveCount(0);

  await page.keyboard.type('@st');
  await page.getByRole('option', { name: /steward/ }).click();
  await expect(page.getByRole('status', { name: '收件人' }).locator('.composer-target-pill.is-picked')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('.turn-card').filter({ hasText: '@steward@atoll.local 看下' })).toBeVisible();
});
