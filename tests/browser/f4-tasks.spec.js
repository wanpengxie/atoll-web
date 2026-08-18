import { expect, test } from '@playwright/test';

const MOCK = process.env.ATOLL_F4_MOCK_URL || 'http://127.0.0.1:8832';

async function reset(request, scenario, seed) {
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

test('F4-001..003/005 Tasks 聚合审批且无 provider 时不伪造正式任务', async ({ page, request }) => {
  await reset(request, 'approval-schema', 1401); await login(page);
  await page.getByRole('tab', { name: '任务', exact: true }).click();
  const tasks = page.getByRole('tabpanel', { name: '任务' });
  await expect(tasks).toContainText('需要你处理');
  await expect(tasks.getByRole('button', { name: /Approve mock action/ })).toBeVisible();
  await expect(tasks.getByRole('button', { name: '新建任务' })).toHaveCount(0);
  await expect(tasks).toContainText('当前频道没有声明 task.create 的成员');
  await tasks.getByRole('button', { name: /Approve mock action/ }).click();
  const context = page.getByRole('complementary', { name: '工作项详情' });
  await expect(context).toContainText('频道账本');
  await expect(context.getByRole('button', { name: '批准' })).toBeVisible();
  await expect(page).toHaveURL(/focus=work_item%3Aapproval%3Ac0%3A/);
  await page.reload();
  await expect(page.getByRole('complementary', { name: '工作项详情' })).toContainText('Approve mock action');
  await context.getByRole('button', { name: '返回来源' }).click();
  await expect(page.getByRole('tab', { name: '动态' })).toHaveAttribute('aria-selected', 'true');
});

test('F4-004 只有真实 task.create provider 时可从回合创建并恢复正式任务', async ({ page, request }) => {
  await reset(request, 'task-capability', 1402); await login(page);
  const turn = page.locator('.turn-card').filter({ hasText: 'c0 history 1' });
  await turn.hover();
  await expect(turn.getByRole('button', { name: '创建任务' })).toBeVisible();
  await turn.getByRole('button', { name: '创建任务' }).click();
  const modal = page.getByRole('dialog', { name: '新建任务' });
  await expect(modal).toContainText('动态 #1');
  await modal.getByLabel('任务内容').fill('复核研究结论');
  await modal.getByRole('button', { name: '创建任务' }).click();
  await expect(page.getByRole('tab', { name: '任务' })).toHaveAttribute('aria-selected', 'true');
  const tasks = page.getByRole('tabpanel', { name: '任务' });
  await tasks.getByRole('button', { name: '全部', exact: true }).click();
  const createdTask = tasks.locator('.work-item-row.kind-task').filter({ hasText: '复核研究结论' });
  await expect(createdTask).toBeVisible();
  await createdTask.click();
  const context = page.getByRole('complementary', { name: '工作项详情' });
  await expect(context).toContainText('返回稳定任务编号');
  await page.reload();
  await expect(page.getByRole('complementary', { name: '工作项详情' })).toContainText('复核研究结论');
  await context.getByRole('button', { name: '返回来源' }).click();
  await expect(page.getByText('c0 history 1: ask steward for PONG', { exact: true })).toBeVisible();
});

test('F4-006 timer 只作为本设备 Automation 并在 320px 保持可达', async ({ page, request }) => {
  await reset(request, 'scheduled-action', 1403); await login(page);
  await page.getByRole('tab', { name: '任务', exact: true }).click();
  await page.getByRole('button', { name: '安排自动动作' }).click();
  const automation = page.getByRole('complementary', { name: '定时动作' });
  await automation.getByLabel('定时延迟毫秒').fill('60000');
  await automation.getByLabel('定时 Payload JSON').fill('{"text":"本设备周报提醒"}');
  await automation.getByRole('button', { name: '创建定时动作' }).click();
  await automation.getByRole('button', { name: '关闭定时动作' }).click();
  const tasks = page.getByRole('tabpanel', { name: '任务' });
  await expect(tasks.getByRole('button', { name: /本设备周报提醒/ })).toBeVisible();
  await tasks.getByRole('button', { name: /本设备周报提醒/ }).click();
  const context = page.getByRole('complementary', { name: '工作项详情' });
  await expect(context).toContainText('不代表频道共享或跨设备的完整事实');
  await page.setViewportSize({ width: 320, height: 720 });
  const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
  await expect(context.getByRole('button', { name: '取消本设备自动动作' })).toBeVisible();
});
