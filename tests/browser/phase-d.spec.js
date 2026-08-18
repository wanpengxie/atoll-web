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

async function openManagement(page, section = '成员') {
  await page.getByRole('button', { name: '频道操作' }).click();
  await page.getByRole('menuitem', { name: '频道详情' }).click();
  const panel = page.getByRole('complementary', { name: /频道管理/ });
  await expect(panel).toBeVisible();
  if (section !== '成员') await panel.getByRole('tab', { name: section, exact: true }).click();
  return panel;
}

async function openChannelCreation(page) {
  await page.getByRole('button', { name: '新建频道' }).click();
  const panel = page.getByRole('dialog', { name: '新建频道' });
  await expect(panel).toBeVisible();
  return panel;
}

test('D-BR-00 新建频道与管理频道是两个独立任务入口', async ({ page, request }) => {
  await reset(request);
  await login(page);
  let panel = await openChannelCreation(page);
  await expect(panel.getByRole('tablist')).toHaveCount(0);
  await expect(panel.getByLabel('新频道名称')).toBeVisible();
  await expect(panel.getByRole('button', { name: '读取完整详情到账本' })).toHaveCount(0);
  await panel.getByRole('button', { name: '关闭新建频道' }).click();

  panel = await openManagement(page, '信息');
  await expect(panel.getByRole('tablist')).toBeVisible();
  await expect(panel.getByRole('tab', { name: '成员' })).toHaveAttribute('aria-selected', 'false');
  await expect(panel.getByLabel('新频道名称')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: '读取完整详情到账本' })).toBeVisible();
});

test('D-BR-01/02/04 c0 经 registrar 创建子频道并展示完整收敛与详情', async ({ page, request }) => {
  await reset(request);
  await login(page);
  let panel = await openChannelCreation(page);
  await expect(panel.getByText(/在.*c0.*下创建子频道/)).toBeVisible();
  await panel.getByLabel('新频道名称').fill('design-room');
  await panel.getByLabel('频道用途').fill('集中讨论产品设计');
  await expect(panel.getByLabel('频道模板 ID')).toBeVisible();
  await panel.getByRole('button', { name: '创建频道' }).click();

  const progress = panel.getByRole('region', { name: '频道创建进度' });
  await expect(progress.getByText('账本确认')).toBeVisible();
  await expect(progress.getByText('频道可观察')).toBeVisible();
  await expect(progress.getByText('成员关系', { exact: true })).toBeVisible();
  await expect(progress.getByText('服务就绪')).toBeVisible();
  await expect(progress.getByText('已确认')).toHaveCount(4);
  await expect(progress.getByText('频道已经可以打开和协作。')).toBeVisible();
  await expect(page.locator('.turn-card[data-request-type="channel.create"]')).toContainText('registrar');
  await expect(page.locator('.turn-card[data-request-type="channel.create"]')).toContainText('集中讨论产品设计');
  await expect(page.locator('.channel-rail').getByText('c0.design-room', { exact: true })).toBeVisible();

  await panel.getByRole('button', { name: '关闭新建频道' }).click();
  panel = await openManagement(page, '信息');
  await panel.getByRole('button', { name: '读取完整详情到账本' }).click();
  await expect(page.locator('.turn-card[data-request-type="channel.get"]')).toContainText('owner_principal');
});

test('D-BR-03 投影延迟保留账本成功事实并最终自行收敛', async ({ page, request }) => {
  await reset(request, 'channel-governance-delay', 202);
  await login(page);
  const panel = await openChannelCreation(page);
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
  const principal = panel.getByRole('combobox', { name: '选择参与者' });
  await principal.click();
  const principalOptions = panel.getByRole('listbox', { name: '选择参与者选项' });
  await expect(principalOptions.getByRole('option', { name: /Alice · 用户/ })).toHaveCount(1);
  await expect(principalOptions.getByRole('option', { name: /Root · 用户/ })).toHaveCount(0);
  await principalOptions.getByRole('option', { name: /Alice · 用户/ }).click();
  await panel.getByRole('button', { name: '添加到频道' }).click();
  await expect(panel.getByText('alice-home', { exact: true })).toBeVisible();
  await expect(panel.getByRole('region', { name: '成员操作进度' }).getByText('已收敛')).toBeVisible();
  await expect(page.locator('.turn-card[data-request-type="channel.introduce_actor"]')).toContainText('添加参与者');
  await expect(page.locator('.turn-card[data-request-type="channel.introduce_actor"]')).toContainText('alice');
});

test('D-BR-07/08/09 agent/tool 添加、重启和 instance_id 移除形成账本闭环', async ({ page, request }) => {
  await reset(request, 'actor-governance', 205);
  await login(page);
  const panel = await openManagement(page, '成员');

  await panel.getByRole('combobox', { name: '选择参与者' }).click();
  await panel.getByRole('option', { name: 'Analyst Agent' }).click();
  await panel.getByRole('button', { name: '添加到频道' }).click();
  const agentRow = panel.locator('.managed-actor').filter({ hasText: 'agent-' }).last();
  await expect(agentRow).toBeVisible();

  await agentRow.getByRole('button', { name: '重启' }).click();
  await panel.getByRole('button', { name: '确认操作' }).click();
  const restartTurn = page.locator('.turn-card[data-request-type="channel.restart_actor"]');
  await expect(restartTurn).toContainText('重启参与者');
  await expect(restartTurn).toContainText('restarted');
  await expect(panel.getByRole('region', { name: '成员操作进度' }).getByText('已收敛')).toBeVisible();

  await agentRow.getByRole('button', { name: '移除' }).click();
  await panel.getByRole('button', { name: '确认操作' }).click();
  const removeTurn = page.locator('.turn-card[data-request-type="channel.remove_actor"]');
  await expect(removeTurn).toContainText('移除参与者');
  await expect(removeTurn).toContainText('removed');
  await expect(agentRow).toHaveCount(0);

  await panel.getByRole('combobox', { name: '选择参与者' }).click();
  const declarationOptions = panel.getByRole('listbox', { name: '选择参与者选项' });
  await expect(declarationOptions.getByRole('option', { name: /Search Tool · 工具/ })).toHaveCount(1);
  await expect(declarationOptions.getByRole('option', { name: /Analyst Agent · Agent/ })).toHaveCount(1);
});

test('D-BR-10 受保护入口与权限失败可理解且不丢失管理上下文', async ({ page, request }) => {
  await reset(request, 'channel-governance-denied', 206);
  await login(page);
  const panel = await openManagement(page, '成员');
  await expect(panel.getByText(/标准系统 Actor.*已隐藏/)).toBeVisible();
  const ownerRow = panel.locator('.managed-actor').filter({ hasText: 'root' });
  await expect(ownerRow.getByRole('button', { name: 'Owner' })).toBeDisabled();
  await panel.getByRole('button', { name: '关闭频道详情' }).click();
  const creation = await openChannelCreation(page);
  await creation.getByLabel('新频道名称').fill('denied-room');
  await creation.getByRole('button', { name: '创建频道' }).click();
  await expect(creation.getByText(/账本失败：permission_denied/)).toBeVisible();
  await expect(creation).toBeVisible();
  await expect(creation.getByLabel('新频道名称')).toHaveValue('denied-room');
});

test('D-BR-11 窄窗口中的成员管理以站内抽屉展示且控件不越界', async ({ page, request }) => {
  await reset(request, 'actor-governance', 207);
  await page.setViewportSize({ width: 850, height: 720 });
  await login(page);
  const panel = await openManagement(page, '成员');

  const assertPanelInsideViewport = async () => {
    const geometry = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const form = element.querySelector('.side-panel-scroll > div:not([hidden]) .governance-form, .side-panel-scroll > .governance-form')?.getBoundingClientRect();
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        panel: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        form: form ? { left: form.left, right: form.right } : null,
      };
    });
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.panel.left).toBeGreaterThanOrEqual(0);
    expect(geometry.panel.right).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.panel.top).toBeGreaterThanOrEqual(0);
    expect(geometry.panel.bottom).toBeLessThanOrEqual(720);
    expect(geometry.form?.left).toBeGreaterThanOrEqual(geometry.panel.left);
    expect(geometry.form?.right).toBeLessThanOrEqual(geometry.panel.right);
  };

  await assertPanelInsideViewport();
  await page.setViewportSize({ width: 600, height: 720 });
  await assertPanelInsideViewport();
  const principal = panel.getByRole('combobox', { name: '选择参与者' });
  const submit = panel.getByRole('button', { name: '添加到频道' });
  await expect(principal).toBeVisible();
  const submitTopBefore = (await submit.boundingBox()).y;
  await principal.click();
  const menu = panel.getByRole('listbox', { name: '选择参与者选项' });
  await expect(menu).toBeVisible();
  const menuGeometry = await menu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const panelRect = element.closest('.side-panel').getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, panelLeft: panelRect.left, panelRight: panelRect.right, panelTop: panelRect.top, panelBottom: panelRect.bottom, viewportWidth: window.innerWidth };
  });
  expect(menuGeometry.left).toBeGreaterThanOrEqual(menuGeometry.panelLeft);
  expect(menuGeometry.right).toBeLessThanOrEqual(menuGeometry.panelRight);
  expect(menuGeometry.right).toBeLessThanOrEqual(menuGeometry.viewportWidth);
  expect(menuGeometry.top).toBeGreaterThanOrEqual(menuGeometry.panelTop);
  expect(menuGeometry.bottom).toBeLessThanOrEqual(menuGeometry.panelBottom);
  expect((await submit.boundingBox()).y).toBe(submitTopBefore);
  await expect(submit).toBeVisible();
});
