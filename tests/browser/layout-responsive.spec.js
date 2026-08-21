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

test('LAYOUT-01 Actor 详情保留名册头部，能力表单拥有独立布局区', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 'actor-capability', 951);
  await login(page);
  await page.getByRole('button', { name: '成员', exact: true }).click();
  await page.getByRole('complementary', { name: /频道管理/ }).getByRole('button', { name: '查看 steward' }).click();
  const details = page.getByRole('region', { name: 'Actor 详情 steward' });
  await details.locator('.capability-row').filter({ hasText: 'mock.order.create' }).getByRole('button', { name: '调用' }).click();
  const form = details.getByRole('region', { name: 'mock.order.create 参数' });
  const geometry = await details.evaluate((element) => {
    const rect = (node) => {
      const value = node.getBoundingClientRect();
      return { top: value.top, right: value.right, bottom: value.bottom, left: value.left, height: value.height };
    };
    return {
      details: rect(element),
      rosterHeader: rect(element.closest('.roster-panel').querySelector(':scope > header')),
      scroll: rect(element.querySelector('.actor-details-scroll')),
      form: rect(element.querySelector('.capability-form')),
    };
  });
  expect(geometry.details.top).toBeGreaterThanOrEqual(geometry.rosterHeader.bottom);
  expect(geometry.scroll.bottom).toBeLessThanOrEqual(geometry.form.top);
  expect(geometry.form.bottom).toBeLessThanOrEqual(geometry.details.bottom);
  await expect(page.getByRole('button', { name: '刷新名册' })).toBeVisible();
  await page.getByRole('button', { name: '刷新名册' }).click();
  await expect(form).toBeVisible();
});

test('LAYOUT-02 320px 下频道列表、工作区和 Context 是可返回的单表面', async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await reset(request, 'space-administration', 952);
  await login(page);

  for (const name of ['成员', '频道操作']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '文件' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '任务' })).toBeVisible();
  await page.getByRole('button', { name: '频道操作' }).click();
  await expect(page.getByRole('menuitem', { name: '频道详情' })).toBeVisible();
  await page.getByRole('button', { name: '频道操作' }).click();
  const shellGeometry = await page.evaluate(() => {
    const workspace = document.querySelector('.workspace').getBoundingClientRect();
    const actions = [...document.querySelectorAll('.channel-header-actions .header-action')].map((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    });
    return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, workspace: { left: workspace.left, right: workspace.right }, actions };
  });
  expect(shellGeometry.documentWidth).toBeLessThanOrEqual(shellGeometry.viewport);
  for (const action of shellGeometry.actions) {
    expect(action.left).toBeGreaterThanOrEqual(shellGeometry.workspace.left);
    expect(action.right).toBeLessThanOrEqual(shellGeometry.workspace.right);
  }

  await page.getByRole('button', { name: '打开频道列表' }).click();
  for (const name of ['新建频道', '空间管理', '退出']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '空间管理', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '空间管理' });
  await expect(panel).toBeVisible();
  const tabs = panel.getByRole('tab');
  await expect(tabs).toHaveCount(4);
  await panel.getByRole('tab', { name: '设备' }).click();
  await expect(panel.getByRole('tab', { name: '设备' })).toHaveAttribute('aria-selected', 'true');
  const panelGeometry = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewport: innerWidth, documentWidth: document.documentElement.scrollWidth };
  });
  expect(panelGeometry.left).toBeGreaterThanOrEqual(0);
  expect(panelGeometry.right).toBeLessThanOrEqual(panelGeometry.viewport);
  expect(panelGeometry.documentWidth).toBeLessThanOrEqual(panelGeometry.viewport);
});

test('LAYOUT-03 @成员菜单以输入区为边界且不改变输入区位置', async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await reset(request, 'actor-capability', 953);
  await login(page);
  const input = page.getByLabel('消息');
  const before = await input.boundingBox();
  await input.fill('@');
  const menu = page.getByRole('listbox');
  await expect(menu).toBeVisible();
  const geometry = await menu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const inputArea = element.closest('.composer-input-area').getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, areaLeft: inputArea.left, areaRight: inputArea.right, viewportHeight: innerHeight };
  });
  const after = await input.boundingBox();
  expect(after.y).toBe(before.y);
  expect(geometry.left).toBeGreaterThanOrEqual(geometry.areaLeft);
  expect(geometry.right).toBeLessThanOrEqual(geometry.areaRight);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
});

test('LAYOUT-04 已完成任务原地定格答案且 Agent 气泡无按钮', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 'actor-capability', 954);
  await login(page);
  const turn = page.locator('.agent-conversation-turn.status-completed').first();
  await expect(turn.locator('.agent-turn-bubble')).toBeVisible();
  await expect(turn.locator('.agent-turn-bubble button')).toHaveCount(0);
  await expect(turn.locator('.turn-process-summary')).toHaveCount(0);
});

test('LAYOUT-05 Context 在 800px 接管工作区，在 600px 接管全屏', async ({ page, request }) => {
  await page.setViewportSize({ width: 800, height: 720 });
  await reset(request, 'resource-workflow', 955);
  await login(page);
  await page.getByRole('button', { name: '成员', exact: true }).click();
  const panel = page.getByRole('complementary', { name: /频道管理/ });
  let geometry = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const rail = document.querySelector('.channel-rail').getBoundingClientRect();
    return { left: rect.left, right: rect.right, railRight: rail.right, viewport: innerWidth, documentWidth: document.documentElement.scrollWidth };
  });
  expect(geometry.left).toBe(geometry.railRight);
  expect(geometry.right).toBe(geometry.viewport);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);

  await page.setViewportSize({ width: 600, height: 720 });
  geometry = await panel.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewport: innerWidth, documentWidth: document.documentElement.scrollWidth };
  });
  expect(geometry.left).toBe(0);
  expect(geometry.right).toBe(geometry.viewport);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
});
