import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request, scenario = 'multi-channel', seed = 220) {
  expect((await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed } })).ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号' }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
}

const filesToggle = (page) => page.locator('#workspace-files-toggle');
const filesPane = (page) => page.locator('.artifacts-view');
const crumbs = (page) => page.locator('.finder-toolbar .file-breadcrumbs, .finder-toolbar');

// 文件区曾经是一个整屏替换动态区的 tab：去查个文件就看不见对话，回来时又从根目录
// 重新开始。这两条测的正是那两件事——并排、以及回来时还在原地。
test('F2-FS-01 文件区与动态并排打开，恒不替换对话', async ({ page, request }) => {
  await reset(request); await login(page);
  await expect(page.getByRole('tablist', { name: '频道主视图' }).getByRole('tab')).toHaveText(['动态', '任务']);
  await expect(filesPane(page)).toHaveCount(0);

  await filesToggle(page).click();
  await expect(filesPane(page)).toBeVisible();
  // 并排的判据是"对话还在且还能发"，不是"DOM 里有这个节点"。
  await expect(page.locator('.dynamic-message-pane')).toBeVisible();
  await expect(page.getByLabel('消息')).toBeVisible();
  await expect(page).toHaveURL(/#\/channels\/c0\/artifacts$/);

  await filesToggle(page).click();
  await expect(filesPane(page)).toBeHidden();
  await expect(page).toHaveURL(/#\/channels\/c0\/dynamic$/);
});

test('F2-FS-02 收起、切 tab、换频道之后回来，仍停在原来的目录', async ({ page, request }) => {
  await reset(request); await login(page);
  await filesToggle(page).click();
  await page.getByRole('row', { name: /workspace/ }).click();
  await expect(page.getByRole('row', { name: /README\.md/ })).toBeVisible();

  // ① 收起再打开：这棵树恒不卸载，位置原样。
  await filesToggle(page).click();
  await filesToggle(page).click();
  await expect(page.getByRole('row', { name: /README\.md/ })).toBeVisible();

  // ② 去任务再回动态：路由只有一个 view 字段，回来时恒不能把分屏挤掉。
  await page.getByRole('tab', { name: '任务' }).click();
  await expect(filesPane(page)).toHaveCount(0);
  await page.getByRole('tab', { name: '动态' }).click();
  await expect(filesPane(page)).toBeVisible();
  await expect(page.getByRole('row', { name: /README\.md/ })).toBeVisible();

  // ③ 换频道再回来：那棵树真的被卸了，位置从 AppShell 的按频道记忆里恢复。
  //    开合与目录都是按频道各记各的——没在 c0.project 开过就恒不替它开，
  //    而 c0 的 workspace/ 恒不因为去过别的频道就丢。
  await page.getByRole('navigation', { name: '频道' }).getByText('c0.project', { exact: true }).click();
  await expect(filesPane(page)).toHaveCount(0);
  await filesToggle(page).click();
  await expect(page.getByRole('row', { name: /项目说明/ })).toBeVisible();

  await page.getByRole('navigation', { name: '频道' }).getByText('c0', { exact: true }).click();
  await expect(filesPane(page)).toBeVisible();
  await expect(page.getByRole('row', { name: /README\.md/ })).toBeVisible();
});

// 终端也是挂在动态那块布局里的分屏。开终端时曾经无条件把视图拨回 dynamic——
// 那在文件还是一个 tab 的时候是对的，改成分屏之后就成了"开个终端顺手关掉文件区"。
test('F2-FS-03 开终端恒不关掉文件分屏，三块可以同时在', async ({ page, request }) => {
  await reset(request); await login(page);
  await filesToggle(page).click();
  await page.getByRole('row', { name: /workspace/ }).click();
  await expect(page.getByRole('row', { name: /README\.md/ })).toBeVisible();

  await page.locator('#workspace-terminal-toggle').click();
  await expect(page.locator('.terminal-view')).toBeVisible();
  await expect(filesPane(page)).toBeVisible();
  await expect(page.locator('.dynamic-message-pane')).toBeVisible();
  // 而且文件区还停在原来的目录，恒不被这一下拨回根。
  await expect(page.getByRole('row', { name: /README\.md/ })).toBeVisible();
  // 三块并排恒不把页面撑出横向滚动。
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
