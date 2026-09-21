import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario: 'resource-workflow', seed } });
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

async function openMenu(page) {
  await page.getByRole('button', { name: '频道操作' }).click();
  return page.getByRole('menu', { name: '频道操作菜单' });
}

test('TC-0263 desktop restores resource/create/restart channel actions with focus return', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 2631);
  await login(page);
  const sent = [];
  page.on('websocket', (socket) => socket.on('framesent', ({ payload }) => {
    try { sent.push(JSON.parse(String(payload))); } catch { /* non-JSON frame */ }
  }));

  let menu = await openMenu(page);
  for (const name of ['高级资源工具', '新建子频道', '重启频道']) {
    await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible();
  }

  await menu.getByRole('menuitem', { name: '高级资源工具', exact: true }).click();
  const resources = page.getByRole('complementary', { name: '频道资源' });
  await expect(resources).toBeVisible();
  await expect(resources.getByRole('tab', { name: '文件', exact: true })).toBeVisible();
  await expect(resources.getByRole('tab', { name: 'KV', exact: true })).toBeVisible();
  await expect(resources.getByRole('region', { name: '频道文件' })).toBeVisible();
  await resources.getByRole('tab', { name: 'KV', exact: true }).click();
  await resources.getByRole('button', { name: '创建', exact: true }).click();
  await expect(resources.locator('.resource-result')).toContainText('kv:demo');
  await resources.getByRole('button', { name: '关闭频道资源' }).click();
  await expect(page.getByRole('button', { name: '频道操作' })).toBeFocused();

  menu = await openMenu(page);
  await menu.getByRole('menuitem', { name: '新建子频道', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新建频道' });
  await expect(create).toBeVisible();
  await expect(create.getByRole('textbox', { name: '新频道名称' })).toBeFocused();
  await create.getByRole('button', { name: '关闭新建频道' }).click();
  await expect(page.getByRole('button', { name: '频道操作' })).toBeFocused();

  menu = await openMenu(page);
  const restart = menu.getByRole('menuitem', { name: '重启频道', exact: true });
  await expect(restart).toHaveAttribute('data-capability-state', 'unsupported');
  await expect(restart).toHaveAttribute('title', /system\.member\.restart_all/);
  await restart.click();
  await expect(page.locator('.channel-notice')).toContainText('没有频道级 system.member.restart_all 命令端口');
  expect(sent.some((frame) => frame?.frame_type === 'member.restart_all' || frame?.payload?.msg_type === 'system.member.restart_all')).toBe(false);
});

test('TC-0263 mobile keeps channel menu actions and returns focus after create/resource close', async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await reset(request, 2632);
  await login(page);
  await expect(page.locator('.workspace-quick-actions')).toBeHidden();

  let menu = await openMenu(page);
  for (const name of ['高级资源工具', '新建子频道', '重启频道', '打开文件', '打开终端']) {
    await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible();
  }

  await menu.getByRole('menuitem', { name: '高级资源工具', exact: true }).click();
  const resources = page.getByRole('complementary', { name: '频道资源' });
  await expect(resources).toBeVisible();
  await resources.getByRole('button', { name: '关闭频道资源' }).click();
  await expect(page.getByRole('button', { name: '频道操作' })).toBeFocused();

  menu = await openMenu(page);
  await menu.getByRole('menuitem', { name: '新建子频道', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新建频道' });
  await expect(create).toBeVisible();
  await expect(create.getByRole('textbox', { name: '新频道名称' })).toBeFocused();
  await create.getByRole('button', { name: '关闭新建频道' }).click();
  await expect(page.getByRole('button', { name: '频道操作' })).toBeFocused();

  menu = await openMenu(page);
  await menu.getByRole('menuitem', { name: '重启频道', exact: true }).click();
  await expect(page.locator('.channel-notice')).toContainText('没有频道级 system.member.restart_all 命令端口');
});
