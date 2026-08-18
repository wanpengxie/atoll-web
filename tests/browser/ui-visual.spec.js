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

async function openChannelPanel(page, tab = '概览') {
  await page.getByRole('button', { name: '管理频道' }).click();
  const panel = page.getByRole('complementary', { name: /频道管理/ });
  await expect(panel).toBeVisible();
  if (tab !== '概览') await panel.getByRole('tab', { name: tab, exact: true }).click();
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
  const panel = page.getByRole('complementary', { name: '新建频道' });
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

for (const [tab, filename] of [['KV', 'channel-resources-kv.png'], ['文件与附件', 'channel-resources-files.png']]) {
  test(`UI-VIS-05 频道资源 ${tab} 视觉基线`, async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await reset(request, 'resource-workflow', 904);
    await login(page);
    await page.getByRole('button', { name: '资源', exact: true }).click();
    const panel = page.getByRole('complementary', { name: '频道资源' });
    await expect(panel).toBeVisible();
    if (tab !== 'KV') await panel.getByRole('tab', { name: tab, exact: true }).click();
    await expect(panel).toHaveScreenshot(filename, SCREENSHOT_OPTIONS);
  });
}

test('UI-VIS-06 定时动作视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 'scheduled-action', 905);
  await login(page);
  await page.getByRole('button', { name: '定时动作', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '定时动作' });
  await expect(panel).toBeVisible();
  await expect(panel).toHaveScreenshot('channel-automation.png', SCREENSHOT_OPTIONS);
});

test('UI-VIS-07 850px 频道管理抽屉视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 850, height: 720 });
  await reset(request, 'actor-governance', 905);
  await login(page);
  await openChannelPanel(page, '成员');
  await expect(page).toHaveScreenshot('channel-members-850.png', pageScreenshotOptions(page));
});

test('UI-VIS-08 600px 选择用户菜单视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 600, height: 720 });
  await reset(request, 'actor-governance', 906);
  await login(page);
  const panel = await openChannelPanel(page, '成员');
  await panel.getByRole('combobox', { name: '选择 Principal' }).click();
  await expect(panel.getByRole('listbox', { name: '选择 Principal选项' })).toBeVisible();
  await expect(page).toHaveScreenshot('channel-members-select-600.png', pageScreenshotOptions(page));
});
