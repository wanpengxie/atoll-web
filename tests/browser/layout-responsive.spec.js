import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request, scenario, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

test('Actor details keep the roster header and capability form inside their scroll region', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 'actor-capability', 951);
  await login(page);
  await page.getByRole('button', { name: '成员', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '频道成员' });
  await panel.getByRole('button', { name: /steward agent/ }).click();
  const details = page.getByRole('complementary', { name: 'Actor 详情' });
  await expect(details).toContainText('mock.order.create');
  const capabilitySelect = details.locator('select').first();
  await capabilitySelect.selectOption('mock.order.create');
  const form = details.locator('.governance-form');
  await details.getByRole('button', { name: '提交调用' }).click();
  const geometry = await details.evaluate((element) => {
    const rect = (node) => { const value = node.getBoundingClientRect(); return { top: value.top, right: value.right, bottom: value.bottom, left: value.left }; };
    return { details: rect(element), header: rect(element.querySelector(':scope > .side-panel-header')), scroll: rect(element.querySelector('.side-panel-scroll')), form: rect(element.querySelector('.governance-form')) };
  });
  expect(geometry.header.bottom).toBeLessThanOrEqual(geometry.scroll.top + 1);
  expect(geometry.form.top).toBeGreaterThanOrEqual(geometry.scroll.top - 1);
  expect(geometry.form.bottom).toBeLessThanOrEqual(geometry.scroll.bottom + 1);
  expect(geometry.form.bottom).toBeLessThanOrEqual(geometry.details.bottom);
  await expect(details.getByRole('button', { name: '刷新能力' })).toBeVisible();
  await expect(form).toBeVisible();
});

test('320px workspace remains a single returnable surface', async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await reset(request, 'space-administration', 952);
  await login(page);
  for (const name of ['成员', '频道操作']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await expect(page.locator('.workspace-quick-actions')).toBeHidden();
  await expect(page.getByRole('tab', { name: '任务' })).toBeVisible();
  await page.getByRole('button', { name: '频道操作' }).click();
  const menu = page.getByRole('menu', { name: '频道操作菜单' });
  await expect(menu).toBeVisible();
  for (const name of ['频道详情', '打开文件', '打开终端']) await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '频道操作' }).click();
  const geometry = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth }));
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  await page.getByRole('button', { name: '打开频道列表' }).click();
  await page.getByRole('button', { name: '空间管理', exact: true }).click();
  const space = page.getByRole('complementary', { name: '空间管理' });
  await expect(space).toBeVisible();
  await expect(space.getByRole('tab')).toHaveCount(4);
});

test('@成员 menu stays within the input area at 320px', async ({ page, request }) => {
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
    const area = document.querySelector('.conversation-input-slot').getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, areaLeft: area.left, areaRight: area.right, height: innerHeight };
  });
  const after = await input.boundingBox();
  expect(after.y).toBe(before.y);
  expect(geometry.left).toBeGreaterThanOrEqual(geometry.areaLeft);
  expect(geometry.right).toBeLessThanOrEqual(geometry.areaRight);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
});

test('completed Agent answer without process summary has only copy/reply actions', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 'actor-capability', 954);
  await login(page);
  const turn = page.locator('.agent-conversation-turn.status-completed').first();
  const bubble = turn.locator('.agent-turn-bubble');
  await expect(bubble).toBeVisible();
  await expect(bubble.locator('.message-actions button')).toHaveText(['复制', '↩ 回复']);
  await expect(bubble.locator('button')).toHaveCount(2);
  await expect(turn.locator('.turn-process-summary')).toHaveCount(0);
});

test('Context panel takes the workspace at 800px and the full surface at 600px', async ({ page, request }) => {
  await page.setViewportSize({ width: 800, height: 720 });
  await reset(request, 'resource-workflow', 955);
  await login(page);
  await page.getByRole('button', { name: '成员', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '频道成员' });
  let geometry = await panel.evaluate((element) => { const rect = element.getBoundingClientRect(); const rail = document.querySelector('.channel-rail').getBoundingClientRect(); return { left: rect.left, right: rect.right, railRight: rail.right, viewport: innerWidth, documentWidth: document.documentElement.scrollWidth }; });
  expect(geometry.left).toBe(geometry.railRight);
  expect(geometry.right).toBe(geometry.viewport);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
  await page.setViewportSize({ width: 600, height: 720 });
  geometry = await panel.evaluate((element) => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, viewport: innerWidth, documentWidth: document.documentElement.scrollWidth }; });
  expect(geometry.left).toBe(0);
  expect(geometry.right).toBe(geometry.viewport);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
});
