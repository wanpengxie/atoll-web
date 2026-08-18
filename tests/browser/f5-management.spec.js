import { expect, test } from '@playwright/test';

const MOCK = 'http://127.0.0.1:8832';

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
  await expect(page.locator('main h1')).toHaveText('c0');
}

test('F5-001/002 Channel Context 成员优先且添加参与者不改变按钮布局', async ({ page, request }) => {
  await reset(request, 'actor-governance', 1501); await login(page);
  await page.getByRole('button', { name: '成员', exact: true }).click();
  const panel = page.getByRole('complementary', { name: /频道管理/ });
  await expect(panel.getByRole('tab', { name: '成员' })).toHaveAttribute('aria-selected', 'true');
  for (const name of ['system', 'registrar', 'svcactor']) await expect(panel.getByText(name, { exact: true })).toHaveCount(0);

  const select = panel.getByRole('combobox', { name: '选择参与者' });
  const submit = panel.getByRole('button', { name: '添加到频道' });
  const before = await submit.boundingBox();
  await select.click();
  await expect(panel.getByRole('option', { name: /Alice · 用户/ })).toBeVisible();
  await expect(panel.getByRole('option', { name: /Analyst Agent · Agent/ })).toBeVisible();
  await expect(panel.getByRole('option', { name: /svcactor/ })).toHaveCount(0);
  const after = await submit.boundingBox();
  expect(after.y).toBe(before.y);
  await panel.getByRole('option', { name: /Alice · 用户/ }).click();
  await submit.click();
  await expect(panel.getByText('alice-home', { exact: true })).toBeVisible();
});

test('F5-003 新建频道是独立 Modal 并保持四步收敛', async ({ page, request }) => {
  await reset(request, 'channel-governance', 1502); await login(page);
  await page.getByRole('button', { name: '新建频道' }).click();
  const modal = page.getByRole('dialog', { name: '新建频道' });
  await expect(modal).toBeVisible();
  await expect(page.locator('.context-host')).toHaveCount(0);
  await modal.getByLabel('新频道名称').fill('f5-room');
  await modal.getByRole('button', { name: '创建频道' }).click();
  const progress = modal.getByRole('region', { name: '频道创建进度' });
  for (const label of ['账本确认', '频道可观察', '成员关系', '服务就绪']) await expect(progress.getByText(label, { exact: true })).toBeVisible();
  await expect(progress.getByText('已确认')).toHaveCount(4);
  await modal.getByRole('button', { name: '进入新频道' }).click();
  await expect(page.locator('main h1')).toHaveText('c0.f5-room');
});

test('F5-004 Activity 去重并返回 WorkItem 来源', async ({ page, request }) => {
  await reset(request, 'approval-schema', 1503); await login(page);
  await page.getByRole('button', { name: '打开活动中心' }).click();
  const center = page.getByRole('complementary', { name: '全局活动' });
  const row = center.locator('.activity-row').filter({ hasText: /Approve mock actionc0 ·/ });
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(page.getByRole('complementary', { name: '工作项详情' })).toContainText('Approve mock action');
  await expect(page).toHaveURL(/channels\/c0\/tasks\?focus=work_item/);
});

test('F5-004 创建操作进入 Operation Center 并可回到原频道回合', async ({ page, request }) => {
  await reset(request, 'channel-governance-delay', 1504); await login(page);
  await page.getByRole('button', { name: '新建频道' }).click();
  const modal = page.getByRole('dialog', { name: '新建频道' });
  await modal.getByLabel('新频道名称').fill('operation-room');
  await modal.getByRole('button', { name: '创建频道' }).click();
  const progress = modal.getByRole('region', { name: '频道创建进度' });
  await expect(progress.getByText('账本确认').locator('..')).toContainText('已确认');
  await modal.getByRole('button', { name: '关闭新建频道' }).click();
  await page.getByRole('button', { name: '打开活动中心' }).click();
  const center = page.getByRole('complementary', { name: '全局活动' });
  await center.getByRole('tab', { name: '操作' }).click();
  const operation = center.getByRole('button', { name: /创建频道 operation-room/ });
  await expect(operation).toHaveCount(1);
  await operation.click();
  await expect(page.getByRole('region', { name: '回合详情' })).toContainText('创建子频道');
  await expect(page.getByRole('region', { name: '回合详情' })).toContainText('operation-room');
  await expect(page.locator('main h1')).toHaveText('c0');
});

test('F5-005 全局搜索恢复频道、视图和 focus，权限撤销后不泄漏缓存', async ({ page, request }) => {
  await reset(request, 'multi-channel', 1505); await login(page);
  await page.getByRole('button', { name: '全局搜索' }).click();
  let search = page.getByRole('dialog', { name: '全局搜索' });
  await search.getByLabel('搜索频道、消息、文件、任务或成员').fill('c0.project history 1');
  const result = search.getByRole('button', { name: /c0\.project history 1/ });
  await expect(result).toHaveCount(1);
  await result.click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.getByRole('complementary', { name: '工作项详情' })).toBeVisible();
  await expect(page).toHaveURL(/channels\/c0.project\/tasks\?focus=work_item/);

  await request.post(`${MOCK}/mock/control/action`, { data: { type: 'revoke_membership', channel_id: 'c0.project' } });
  await expect(page.getByText(/频道访问权限已被撤销/)).toBeVisible();
  await expect(page.getByRole('complementary', { name: '工作项详情' })).toHaveCount(0);
  await expect(page.getByRole('tabpanel', { name: '任务' })).toContainText('任务不可访问');
  await page.getByRole('button', { name: '全局搜索' }).click();
  search = page.getByRole('dialog', { name: '全局搜索' });
  await search.getByLabel('搜索频道、消息、文件、任务或成员').fill('c0.project history 1');
  await expect(search.getByRole('button', { name: /c0\.project history 1/ })).toHaveCount(0);
});

test('F5-006 空间治理保持独立全局目的地', async ({ page, request }) => {
  await reset(request, 'space-administration', 1506); await login(page);
  await page.getByRole('button', { name: '空间管理' }).click();
  const space = page.getByRole('complementary', { name: '空间管理' });
  await expect(space).toBeVisible();
  await expect(space.getByRole('tab', { name: 'Actor 模板' })).toBeVisible();
  await expect(space.getByRole('tab', { name: '成员' })).toHaveCount(0);
  await expect(page).toHaveURL(/#\/channels\/c0\/dynamic$/);
});
