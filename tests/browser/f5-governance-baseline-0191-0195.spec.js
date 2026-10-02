import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// Exact baseline successors for fae8b70:tests/browser/f5-management.spec.js
// TC-0191..TC-0195. The cases stay independent: member governance, child
// creation, activity return and operation return
// each retain their own historical action/result contract.

async function reset(request, scenario, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

// Current public owner mapping for the former Channel Context panel. The
// header's 成员 button is now the read-only RosterFeature; management commands
// live behind the public 频道操作 → 频道详情 → ChannelAdministrationPanel
// route. The member capability and old observables remain strict below.
async function openChannelGovernance(page) {
  await page.getByRole('button', { name: '频道操作' }).click();
  await page.getByRole('menuitem', { name: '频道详情' }).click();
  const panel = page.getByRole('complementary', { name: /频道治理/ });
  await expect(panel).toBeVisible();
  return panel;
}

test('TC-0191 F5-001/002 Channel Context 成员优先且添加参与者不改变按钮布局', async ({ page, request }) => {
  await reset(request, 'actor-governance', 1501); await login(page);
  // 人进频道是写频道描述；c0 的描述是内核写的、只读，所以在 c0.project 里加人（BATCH3 §5）。
  await page.locator('.channel-rail, aside').first().getByText('c0.project', { exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  const panel = await openChannelGovernance(page);
  await expect(panel.getByRole('tab', { name: '成员' })).toHaveAttribute('aria-selected', 'true');
  // system 门不是成员；registrar 只在 c0；svcactor 是描述里的条目，照常列出。
  for (const name of ['system', 'registrar']) await expect(panel.getByText(name, { exact: true })).toHaveCount(0);
  await expect(panel.locator('.managed-actor').filter({ hasText: 'svcactor' })).toHaveCount(1);

  const select = panel.getByRole('combobox', { name: '选择参与者' });
  const submit = panel.getByRole('button', { name: '添加到频道' });
  const before = await submit.boundingBox();
  await select.click();
  await expect(panel.getByRole('option', { name: /Alice · 用户/ })).toBeVisible();
  // Agent 和工具的候选是 Actor 描述（名字@版本），不再是声明。
  await expect(panel.getByRole('option', { name: /analyst @1 · Actor 描述/ })).toBeVisible();
  await expect(panel.getByRole('option', { name: '直接按 Class 新建…' })).toBeVisible();
  // 内核的 actor 描述也是公开的描述，可以挑（比如给一个删了 svcactor 的频道再加一个）。
  await expect(panel.getByRole('option', { name: /svcactor @1 · Actor 描述/ })).toBeVisible();
  const after = await submit.boundingBox();
  expect(after.y).toBe(before.y);
  await panel.getByRole('option', { name: /Alice · 用户/ }).click();
  await submit.click();
  // 人写进描述，随构建进来（和真节点一样，回复之后）。
  await expect(panel.locator('.managed-actor').filter({ hasText: 'human:alice:' })).toBeVisible();
});

test('TC-0192 F5-003 新建频道是独立 Modal 并保持四步收敛', async ({ page, request }) => {
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

test('TC-0193 F5-004 Activity 去重并返回 WorkItem 来源', async ({ page, request }) => {
  await reset(request, 'approval-schema', 1503); await login(page);
  await page.getByRole('button', { name: '打开活动中心' }).click();
  const center = page.getByRole('complementary', { name: '全局活动' });
  const row = center.locator('.activity-row').filter({ hasText: /Approve mock actionc0 ·/ });
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(page.getByRole('complementary', { name: '工作项详情' })).toContainText('Approve mock action');
  await expect(page).toHaveURL(/channels\/c0\/tasks\?focus=work_item/);
});

test('TC-0194 F5-004 创建操作进入 Operation Center 并可回到原频道回合', async ({ page, request }) => {
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
  await expect(page.locator('.turn-card').filter({ hasText: '创建子频道' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '回合详情' })).toContainText('operation-room');
  await expect(page.locator('main h1')).toHaveText('c0');
});
