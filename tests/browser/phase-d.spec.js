import { expect, test } from '@playwright/test';

const MOCK = 'http://127.0.0.1:8832';

async function reset(request, scenario = 'channel-governance', seed = 201) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByLabel('邮箱').fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  await expect(page.locator('main h1')).toHaveText('c0');
}

async function openManagement(page, section = '概览') {
  await page.getByRole('button', { name: '管理频道' }).click();
  const panel = page.getByRole('complementary', { name: /频道管理/ });
  await expect(panel).toBeVisible();
  if (section !== '概览') await panel.getByRole('button', { name: section, exact: true }).click();
  return panel;
}

test('D-BR-01/02/04 c0 经 registrar 创建子频道并展示完整收敛与详情', async ({ page, request }) => {
  await reset(request);
  await login(page);
  const panel = await openManagement(page);
  await expect(panel.getByText('父级固定为当前频道')).toBeVisible();
  await panel.getByLabel('新频道名称').fill('design-room');
  await panel.getByLabel('频道用途').fill('集中讨论产品设计');
  await expect(panel.getByLabel('频道模板 ID')).toBeVisible();
  await panel.getByRole('button', { name: '创建频道' }).click();

  const progress = panel.getByRole('region', { name: '频道创建进度' });
  await expect(progress.getByText('账本确认')).toBeVisible();
  await expect(progress.getByText('频道可观察')).toBeVisible();
  await expect(progress.getByText('成员关系')).toBeVisible();
  await expect(progress.getByText('服务就绪')).toBeVisible();
  await expect(progress.getByText('已确认')).toHaveCount(4);
  await expect(progress.getByText('频道已经可以打开和协作。')).toBeVisible();
  await expect(page.locator('.turn-card[data-request-type="channel.create"]')).toContainText('registrar');
  await expect(page.locator('.turn-card[data-request-type="channel.create"]')).toContainText('集中讨论产品设计');
  await expect(page.locator('.channel-rail').getByText('c0.design-room', { exact: true })).toBeVisible();

  await panel.getByRole('button', { name: '读取完整详情到账本' }).click();
  await expect(page.locator('.turn-card[data-request-type="channel.get"]')).toContainText('owner_principal');
});

test('D-BR-03 投影延迟保留账本成功事实并最终自行收敛', async ({ page, request }) => {
  await reset(request, 'channel-governance-delay', 202);
  await login(page);
  const panel = await openManagement(page);
  await panel.getByLabel('新频道名称').fill('slow-projection');
  await panel.getByRole('button', { name: '创建频道' }).click();
  const progress = panel.getByRole('region', { name: '频道创建进度' });
  await expect(progress.getByText('账本确认').locator('..')).toContainText('已确认');
  await expect(progress.getByText('频道已经可以打开和协作。')).toBeVisible({ timeout: 15_000 });
});

test('D-BR-05 普通频道经 coreactor 精确确认退役并停止写入', async ({ page, request }) => {
  await reset(request, 'channel-governance', 203);
  await login(page);
  await page.getByRole('button', { name: /c0\.project/ }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  const panel = await openManagement(page, '危险操作');
  const retire = panel.getByRole('button', { name: '退役当前频道' });
  await expect(retire).toBeDisabled();
  await panel.getByLabel('退役确认').fill('c0.project');
  await expect(retire).toBeEnabled();
  await retire.click();
  await expect(page.locator('.turn-card[data-request-type="channel.retire"]')).toContainText('coreactor');
  await expect(page.locator('main h1')).toHaveText('c0', { timeout: 15_000 });
  await expect(page.locator('.channel-rail').getByText('c0.project', { exact: true })).toHaveCount(0);
});

test('D-BR-06 human 候选来自 OBS，添加后 roster 与 membership 收敛', async ({ page, request }) => {
  await reset(request, 'actor-governance', 204);
  await login(page);
  const panel = await openManagement(page, '成员');
  const principal = panel.getByLabel('选择 Principal');
  await expect(principal.getByRole('option', { name: 'Alice' })).toHaveCount(1);
  await expect(principal.getByRole('option', { name: 'Root' })).toHaveCount(0);
  await principal.selectOption('alice');
  await panel.getByRole('button', { name: '添加到频道' }).click();
  await expect(panel.getByText('alice-home', { exact: true })).toBeVisible();
  await expect(panel.getByRole('region', { name: '成员操作进度' }).getByText('已收敛')).toBeVisible();
  await expect(page.locator('.turn-card[data-request-type="channel.introduce_actor"]')).toContainText('"principal":"alice"');
});

test('D-BR-07/08/09 agent/tool 添加、重启和 instance_id 移除形成账本闭环', async ({ page, request }) => {
  await reset(request, 'actor-governance', 205);
  await login(page);
  const panel = await openManagement(page, '成员');

  await panel.getByRole('button', { name: 'agent', exact: true }).click();
  await panel.getByLabel('选择 Actor 声明').selectOption('mock:analyst');
  await panel.getByRole('button', { name: '添加到频道' }).click();
  const agentRow = panel.locator('.managed-actor').filter({ hasText: 'agent-' }).last();
  await expect(agentRow).toBeVisible();

  await agentRow.getByRole('button', { name: '重启' }).click();
  await panel.getByRole('button', { name: '确认操作' }).click();
  const restartTurn = page.locator('.turn-card[data-request-type="channel.restart_actor"]');
  await expect(restartTurn).toContainText('instance_id');
  await expect(restartTurn).toContainText('restarted');
  await expect(panel.getByRole('region', { name: '成员操作进度' }).getByText('已收敛')).toBeVisible();

  await agentRow.getByRole('button', { name: '移除' }).click();
  await panel.getByRole('button', { name: '确认操作' }).click();
  const removeTurn = page.locator('.turn-card[data-request-type="channel.remove_actor"]');
  await expect(removeTurn).toContainText('instance_id');
  await expect(removeTurn).toContainText('removed');
  await expect(agentRow).toHaveCount(0);

  await panel.getByRole('button', { name: 'tool', exact: true }).click();
  await expect(panel.getByLabel('选择 Actor 声明').getByRole('option', { name: 'Search Tool' })).toHaveCount(1);
  await expect(panel.getByLabel('选择 Actor 声明').getByRole('option', { name: 'Analyst Agent' })).toHaveCount(0);
});

test('D-BR-10 受保护入口与权限失败可理解且不丢失管理上下文', async ({ page, request }) => {
  await reset(request, 'channel-governance-denied', 206);
  await login(page);
  const panel = await openManagement(page, '成员');
  await expect(panel.getByText(/标准系统 Actor.*已隐藏/)).toBeVisible();
  const ownerRow = panel.locator('.managed-actor').filter({ hasText: 'root' });
  await expect(ownerRow.getByRole('button', { name: 'Owner' })).toBeDisabled();
  await panel.getByRole('button', { name: '概览' }).click();
  await panel.getByLabel('新频道名称').fill('denied-room');
  await panel.getByRole('button', { name: '创建频道' }).click();
  await expect(panel.getByText(/账本失败：permission_denied/)).toBeVisible();
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel('新频道名称')).toHaveValue('denied-room');
});
