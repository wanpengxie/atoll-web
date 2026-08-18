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
  await expect(turn.locator('.turn-process-summary')).toContainText(/已完成|处理中/);
  await expect(turn).not.toContainText('工具 · mock.ping');

  await turn.hover();
  await turn.getByRole('button', { name: '打开详情' }).click();
  const context = page.getByRole('region', { name: '回合详情' });
  await expect(context).toBeVisible();
  await expect(context).toContainText('工具 · mock.ping');
  await expect(context).toContainText('技术审计');
  await expect(page).toHaveURL(/focus=turn%3A/);
  await page.reload();
  await expect(page.getByRole('region', { name: '回合详情' })).toContainText('浏览器验收一条回合');
  await context.getByRole('button', { name: /返回动态/ }).click();
  await expect(page).toHaveURL(/#\/channels\/c0\/dynamic$/);
  await expect(turn).toBeInViewport();
});

test('F3-003..005 键盘、多行草稿、附件入口与 320px 单表面可达', async ({ page, request }) => {
  await reset(request, 'long-running', 1302); await login(page);
  const editor = page.getByLabel('消息');
  await editor.fill('第一行\n第二行');
  await expect(editor).toHaveValue('第一行\n第二行');
  await page.getByRole('button', { name: '＋ 附件' }).click();
  await expect(page.getByRole('tab', { name: '文件' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '动态' }).click();
  await expect(editor).toHaveValue('第一行\n第二行');
  await editor.fill('检查窄屏回合');
  await page.getByRole('button', { name: /发送/ }).click();
  const turn = page.locator('.turn-card').filter({ hasText: '检查窄屏回合' });
  await expect(turn).toBeVisible();
  await page.setViewportSize({ width: 320, height: 720 });
  await turn.focus();
  await turn.getByRole('button', { name: '打开详情' }).click();
  const context = page.getByRole('region', { name: '回合详情' });
  await expect(context).toBeVisible();
  const geometry = await page.evaluate(() => ({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, context: document.querySelector('.turn-detail-page').getBoundingClientRect().width }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.context).toBe(320);
  await expect(context.getByRole('button', { name: /取消任务|调整方向|打断回合/ }).first()).toBeVisible();
});
