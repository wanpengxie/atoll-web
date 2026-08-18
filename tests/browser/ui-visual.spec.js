import { expect, test } from '@playwright/test';

const MOCK = 'http://127.0.0.1:8832';
const SCREENSHOT_OPTIONS = { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixels: 10 };

function pageScreenshotOptions(page) {
  return { ...SCREENSHOT_OPTIONS, mask: [page.locator('.timeline')], maskColor: '#f7f2e8' };
}

async function reset(request, scenario, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByLabel('邮箱').fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('main h1')).toHaveText('c0');
}

async function openChannelPanel(page, tab = '成员') {
  await page.getByRole('button', { name: '频道操作' }).click();
  await page.getByRole('menuitem', { name: '频道详情' }).click();
  const panel = page.getByRole('complementary', { name: /频道管理/ });
  await expect(panel).toBeVisible();
  if (tab !== '成员') await panel.getByRole('tab', { name: tab === '概览' ? '信息' : tab, exact: true }).click();
  return panel;
}

test('UI-VIS-01 桌面三栏工作台视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 'multi-channel', 901);
  await login(page);
  await expect(page).toHaveScreenshot('desktop-workspace.png', pageScreenshotOptions(page));
});

for (const [tab, filename] of [['概览', 'channel-overview.png'], ['成员', 'channel-members.png'], ['危险操作', 'channel-danger.png']]) {
  test(`UI-VIS-02 频道管理 ${tab} 视觉基线`, async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await reset(request, 'actor-governance', 902);
    await login(page);
    const panel = await openChannelPanel(page, tab);
    await expect(panel).toHaveScreenshot(filename, SCREENSHOT_OPTIONS);
  });
}

test('UI-VIS-03 新建频道独立任务视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 'channel-governance', 907);
  await login(page);
  await page.getByRole('button', { name: '新建频道' }).click();
  const panel = page.getByRole('dialog', { name: '新建频道' });
  await expect(panel).toBeVisible();
  await expect(panel).toHaveScreenshot('channel-create.png', SCREENSHOT_OPTIONS);
});

test('UI-VIS-04 空间管理视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 'space-administration', 903);
  await login(page);
  await page.getByRole('button', { name: '空间管理' }).click();
  const panel = page.getByRole('complementary', { name: '空间管理' });
  await expect(panel).toBeVisible();
  await expect(panel).toHaveScreenshot('space-administration.png', SCREENSHOT_OPTIONS);
});

for (const [tab, filename] of [['KV', 'channel-resources-kv.png'], ['文件', 'channel-resources-files.png']]) {
  test(`UI-VIS-05 频道资源 ${tab} 视觉基线`, async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await reset(request, 'resource-workflow', 904);
    await login(page);
    await page.getByRole('tab', { name: '文件', exact: true }).click();
    await page.getByText('高级资源工具', { exact: true }).click();
    const panel = page.locator('.embedded-resources');
    await expect(panel).toBeVisible();
    await panel.getByRole('tab', { name: tab, exact: true }).click();
    await expect(panel).toHaveScreenshot(filename, SCREENSHOT_OPTIONS);
  });
}

test('UI-VIS-06 定时动作视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 'scheduled-action', 905);
  await login(page);
  await page.getByRole('tab', { name: '任务', exact: true }).click();
  await page.getByRole('button', { name: '安排自动动作' }).click();
  const panel = page.getByRole('complementary', { name: '定时动作' });
  await expect(panel).toBeVisible();
  await expect(panel).toHaveScreenshot('channel-automation.png', SCREENSHOT_OPTIONS);
});

test('UI-VIS-07 850px 频道管理抽屉视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 850, height: 720 });
  await reset(request, 'actor-governance', 905);
  await login(page);
  await openChannelPanel(page, '成员');
  await expect(page).toHaveScreenshot('channel-members-850.png', SCREENSHOT_OPTIONS);
});

test('UI-VIS-08 600px 选择用户菜单视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 600, height: 720 });
  await reset(request, 'actor-governance', 906);
  await login(page);
  const panel = await openChannelPanel(page, '成员');
  await panel.getByRole('combobox', { name: '选择参与者' }).click();
  await expect(panel.getByRole('listbox', { name: '选择参与者选项' })).toBeVisible();
  await expect(page).toHaveScreenshot('channel-members-select-600.png', SCREENSHOT_OPTIONS);
});

test('UI-VIS-09 平面账本条目与折叠过程视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 'actor-capability', 908);
  await login(page);
  const turn = page.locator('.turn-card.status-completed').filter({ has: page.locator('.turn-process-summary') }).first();
  await expect(turn).toBeVisible();
  await expect(turn).toHaveScreenshot('flat-ledger-turn.png', SCREENSHOT_OPTIONS);
});

test('UI-VIS-10 全局活动中心视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 'approval-schema', 909);
  await login(page);
  await page.getByRole('button', { name: '打开活动中心' }).click();
  const center = page.getByRole('complementary', { name: '全局活动' });
  await expect(center).toBeVisible();
  await expect(center).toHaveScreenshot('global-activity.png', SCREENSHOT_OPTIONS);
});

test('UI-VIS-11 600px 全局搜索视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 600, height: 720 });
  await reset(request, 'multi-channel', 910);
  await login(page);
  await page.getByRole('button', { name: '打开频道列表' }).click();
  await page.getByRole('button', { name: '全局搜索' }).click();
  const search = page.getByRole('dialog', { name: '全局搜索' });
  await search.getByLabel('搜索频道、消息、文件、任务或成员').fill('history 1');
  await expect(search).toHaveScreenshot('global-search-600.png', SCREENSHOT_OPTIONS);
});

test('UI-VIS-12 频道挂载文件主页面视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 'resource-workflow', 911);
  await login(page);
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  const files = page.getByRole('tabpanel', { name: '文件' });
  await files.getByLabel('选择要上传到当前目录的文件').setInputFiles({
    name: '频道交付说明.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('这是当前频道默认挂载目录中的文件。'),
  });
  await expect(files.getByText('频道交付说明.txt', { exact: true })).toBeVisible();
  await expect(files).toHaveScreenshot('channel-files-mounted.png', SCREENSHOT_OPTIONS);
});

test('UI-VIS-13 频道挂载文件预览视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 'resource-workflow', 912);
  await login(page);
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  const files = page.getByRole('tabpanel', { name: '文件' });
  await files.getByLabel('选择要上传到当前目录的文件').setInputFiles({
    name: '可预览说明.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# 文件预览\n\n挂载目录文件可以直接在全屏画布中预览。'),
  });
  await files.locator('.channel-file-row').filter({ hasText: '可预览说明.md' }).getByRole('button', { name: '预览', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /文件预览：可预览说明.md/ })).toContainText('挂载目录文件可以直接在全屏画布中预览');
  await expect(page).toHaveScreenshot('channel-files-preview.png', SCREENSHOT_OPTIONS);
});
