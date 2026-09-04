import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';


async function reset(request, scenario = 'multi-channel', seed = 1101) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号' }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page).toHaveURL(/#\/channels\/c0\/dynamic$/);
}

// 文件已经不是第三个 tab 了：它是与动态并排的分屏，所以这条从"三视图互斥"改成
// "两 tab 互斥 + 文件与动态并存"。互斥的仍然只有动态和任务。
test('F1-001/F1-002/F1-004 主视图互斥，文件与动态并存，Composer 按频道保留且历史可恢复', async ({ page, request }) => {
  await reset(request); await login(page);
  const tabs = page.getByRole('tablist', { name: '频道主视图' });
  await expect(tabs.getByRole('tab')).toHaveCount(2);
  await page.getByLabel('消息').fill('只属于 c0 的草稿');

  await page.locator('#workspace-files-toggle').click();
  await expect(page.getByRole('region', { name: '频道文件' })).toBeVisible();
  // 并排：开着文件区照样能打字。以前这里断言的是编辑器消失。
  await expect(page.getByLabel('消息', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/#\/channels\/c0\/artifacts$/);

  await tabs.getByRole('tab', { name: '任务' }).click();
  await expect(page.getByRole('tabpanel', { name: '任务' })).toBeVisible();
  await expect(page.getByRole('region', { name: '频道文件' })).toHaveCount(0);
  await expect(page).toHaveURL(/#\/channels\/c0\/tasks$/);

  await page.goBack();
  // artifacts 这一段历史 = 动态 + 文件分屏，所以亮的是动态那一格。
  await expect(page).toHaveURL(/#\/channels\/c0\/artifacts$/);
  await expect(page.getByRole('region', { name: '频道文件' })).toBeVisible();
  await expect(tabs.getByRole('tab', { name: '动态' })).toHaveAttribute('aria-selected', 'true');
  await page.goBack();
  await expect(tabs.getByRole('tab', { name: '动态' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('消息')).toContainText('只属于 c0 的草稿');

  const other = page.locator('.channel-item').filter({ hasNot: page.locator('.active') }).nth(1);
  if (await other.count()) {
    await other.click();
    await expect(page.getByLabel('消息')).toBeEmpty();
    await page.getByRole('button', { name: '# c0', exact: true }).click();
    await expect(page.getByLabel('消息')).toContainText('只属于 c0 的草稿');
  }
});

test('F1-003/F1-005 Context 与主 Tab 分离并按断点改变表面组合', async ({ page, request }) => {
  await reset(request, 'actor-capability', 1102); await login(page);

  for (const width of [1280, 800, 600, 320]) {
    await page.setViewportSize({ width, height: 720 });
    await page.getByRole('button', { name: '成员', exact: true }).click();
    const context = page.locator('.context-host');
    await expect(context).toBeVisible();
    await expect(context).toHaveAttribute('data-context-type', 'channel');
    await expect(page).toHaveURL(/focus=channel%3Ac0$/);
    const geometry = await page.evaluate(() => {
      const workspace = document.querySelector('.workspace').getBoundingClientRect();
      const context = document.querySelector('.context-pane').getBoundingClientRect();
      return { workspace: { left: workspace.left, right: workspace.right, width: workspace.width }, context: { left: context.left, right: context.right }, viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth };
    });
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport);
    if (width > 900) {
      expect(geometry.context.right).toBe(width);
      expect(geometry.context.left).toBeLessThan(geometry.workspace.right);
    }
    else if (width > 640) expect(geometry.context.left).toBe(geometry.workspace.left);
    else {
      expect(geometry.context.left).toBe(0);
      expect(geometry.context.right).toBe(width);
    }
    await context.getByRole('button', { name: '关闭频道详情' }).click();
    await expect(context).toHaveCount(0);
    await expect(page).toHaveURL(/#\/channels\/c0\/dynamic$/);
  }
});

test('F1-006 旧成员、频道管理、文件和自动动作能力仍可达', async ({ page, request }) => {
  await reset(request, 'space-administration', 1103); await login(page);
  await page.getByRole('button', { name: '成员', exact: true }).click();
  await expect(page.getByRole('complementary', { name: /频道管理/ })).toBeVisible();
  await page.getByRole('button', { name: '关闭频道详情' }).click();

  await page.getByRole('button', { name: '频道操作' }).click();
  await page.getByRole('menuitem', { name: '频道详情' }).click();
  await expect(page.getByRole('complementary', { name: /频道管理/ })).toBeVisible();
  await page.getByRole('button', { name: '关闭频道详情' }).click();

  await page.getByRole('button', { name: '频道操作' }).click();
  await page.getByRole('menuitem', { name: '高级资源工具' }).click();
  const resources = page.getByRole('complementary', { name: '频道资源' });
  await expect(resources.getByRole('tab', { name: 'KV' })).toBeVisible();
  await expect(resources.getByRole('tab', { name: '文件', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭频道资源' }).click();
  await page.getByRole('tab', { name: '任务' }).click();
  await page.getByRole('button', { name: '安排自动动作' }).click();
  await expect(page.getByRole('button', { name: '创建定时动作' })).toBeVisible();
});
