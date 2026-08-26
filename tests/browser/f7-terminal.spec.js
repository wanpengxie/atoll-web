import { expect, test } from '@playwright/test';

const MOCK = 'http://127.0.0.1:8832';

// 这组测试存在的理由，如实记账：终端线连续三次交付了「构建通过、单测全绿、
// 但浏览器一打开就白屏」的版本（monoStack is not defined、
// openedTerminalRef is not defined）。两者都是模块作用域的标识符缺失——
// **vite build 恒不检查它，jsdom 单测也碰不到 AppShell 的真实装配**。
// 只有真开一次浏览器才检查得到。故本组第一条就是「页面能打开且控制台无错」。

async function login(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => {
    // Mock feed intentionally contains protected resource examples. Their 401
    // is unrelated to terminal assembly; runtime/page errors still fail here.
    if (msg.type() === 'error' && !msg.text().includes('status of 401')) errors.push(msg.text());
  });
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  return errors;
}

const terminalToggle = (page) => page.getByRole('button', { name: /终端/ });

test('F7-001 打开终端分屏：消息与终端同时可见，页面无错', async ({ page }) => {
  const errors = await login(page);
  await terminalToggle(page).click();
  const view = page.locator('.terminal-view');
  await expect(view).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: '动态' })).toBeVisible();
  // xterm 真的挂载了（.xterm 是它自己建的根节点），而不是一个空壳。
  await expect(view.locator('.xterm')).toBeVisible({ timeout: 15_000 });
  expect(errors, `控制台报错：\n${errors.join('\n')}`).toEqual([]);
});

test('F7-002 桌面端消息区与终端左右各占一半', async ({ page }) => {
  await login(page);
  await terminalToggle(page).click();
  const view = page.locator('.terminal-view');
  await expect(view.locator('.xterm')).toBeVisible({ timeout: 15_000 });
  const terminalBox = await view.boundingBox();
  const messageBox = await page.locator('.dynamic-message-pane').boundingBox();
  expect(Math.abs(terminalBox.width - messageBox.width)).toBeLessThan(3);
  expect(terminalBox.x).toBeGreaterThanOrEqual(messageBox.x + messageBox.width - 1);
});

test('F7-003 收起再打开：消息恢复全宽，且终端恒不重建', async ({ page }) => {
  await login(page);
  await terminalToggle(page).click();
  await expect(page.locator('.terminal-view .xterm')).toBeVisible({ timeout: 15_000 });

  // 记下 xterm 根节点的身份；重建会换一个新节点。
  await page.evaluate(() => { document.querySelector('.terminal-view .xterm').dataset.probe = 'first'; });

  const splitWidth = (await page.locator('.dynamic-message-pane').boundingBox()).width;
  await terminalToggle(page).click();
  await expect(page.locator('.terminal-view')).toBeHidden();
  const fullWidth = (await page.locator('.dynamic-message-pane').boundingBox()).width;
  expect(fullWidth).toBeGreaterThan(splitWidth * 1.8);
  await terminalToggle(page).click();
  await expect(page.locator('.terminal-view')).toBeVisible();

  const probe = await page.evaluate(() => document.querySelector('.terminal-view .xterm')?.dataset.probe || '');
  expect(probe, '终端被重建了——切页签本不该断开').toBe('first');
});

test('F7-004 配色可切换，且切换恒不重建终端', async ({ page }) => {
  await login(page);
  await terminalToggle(page).click();
  const view = page.locator('.terminal-view');
  await expect(view.locator('.xterm')).toBeVisible({ timeout: 15_000 });
  await expect(view).toHaveAttribute('data-terminal-theme', 'dark');

  await page.evaluate(() => { document.querySelector('.terminal-view .xterm').dataset.probe = 'first'; });
  await page.getByRole('button', { name: /切到浅色/ }).click();
  await expect(view).toHaveAttribute('data-terminal-theme', 'light');

  const probe = await page.evaluate(() => document.querySelector('.terminal-view .xterm')?.dataset.probe || '');
  expect(probe, '切配色重建了终端——那会清空屏幕').toBe('first');
});

test('F7-005 Ctrl+F12 与按钮使用同一个分屏开关', async ({ page }) => {
  await login(page);
  // 连接 open 不等于频道就绪：toggleTerminal 在 workspace.channel 落定前是空操作，
  // 按键会被静默吞掉。按钮的 disabled 正是同一个就绪条件，等它再按。
  await expect(terminalToggle(page)).toBeEnabled();
  await page.keyboard.press('Control+F12');
  await expect(page.locator('.terminal-view')).toBeVisible();
  await expect(terminalToggle(page)).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('Control+F12');
  await expect(page.locator('.terminal-view')).toBeHidden();
  await expect(terminalToggle(page)).toHaveAttribute('aria-pressed', 'false');
});
