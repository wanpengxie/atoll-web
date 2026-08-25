import { expect, test } from '@playwright/test';

// 这一组存在的理由，如实记账：终端的真相原来放在浏览器的 DOM 里。DOM 一没
//（切频道、切主视图、刷新页面）真相就没，回来是黑屏；为了不黑屏又把 N 块终端
// 常驻在 DOM 里，于是变成一个终端一条 WebSocket，开十个频道就是十条连接。
//
// 现在真相在服务端：shell 由宽限期保住，屏幕由会话的回放环保住，attach 恒先
// 回放再转直播；一条 WS 按流 id 承载所有频道的终端。这一组锁住这两件事。
//
// 恒不依赖 DOM 里能读到终端文字这件事本身——WebGL 渲染器把字画在 canvas 上。
// 用 --disable-webgl 逼出 DOM 渲染器，走的仍是同一条产品路径。
test.use({ launchOptions: { args: ['--disable-webgl'] } });

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

const visibleScreen = (page) => page.evaluate(() => {
  const view = [...document.querySelectorAll('.terminal-view')].find((n) => !n.hidden);
  return view ? view.innerText : '';
});

async function countSockets(page) {
  // 关键的是**同时**开着几条，恒不是这一辈子开过几条：切频道时旧的先收、新的
  // 再开，累计数自然会涨，那恒不是"一个终端一条"。
  return page.evaluate(() => ({ peak: window.__wsPeak, live: window.__wsLive }));
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__wsPeak = 0;
    window.__wsLive = 0;
    const Real = window.WebSocket;
    window.WebSocket = function (url, ...rest) {
      const ws = new Real(url, ...rest);
      if (String(url).includes('/pty')) {
        window.__wsLive += 1;
        window.__wsPeak = Math.max(window.__wsPeak, window.__wsLive);
        ws.addEventListener('close', () => { window.__wsLive -= 1; });
      }
      return ws;
    };
    window.WebSocket.prototype = Real.prototype;
    Object.assign(window.WebSocket, Real);
  });
});

async function openTerminalAndMark(page, mark) {
  await page.getByRole('button', { name: /终端/ }).click();
  await expect(page.locator('.terminal-view:not([hidden]) .terminal-host')).toBeVisible();
  await page.locator('.terminal-view:not([hidden]) .terminal-host').click();
  await page.keyboard.type(`echo ${mark}`);
  await page.keyboard.press('Enter');
  await expect.poll(() => visibleScreen(page), { timeout: 20_000 }).toContain(mark);
}

test('F8-001 两个频道各开终端：恒只有一条 WS，来回切各看各的屏', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('status of 401')) errors.push(msg.text());
  });
  await login(page);
  const items = page.locator('.channel-item');

  await items.nth(0).click();
  await openTerminalAndMark(page, 'MARK_ZERO');
  await items.nth(1).click();
  await openTerminalAndMark(page, 'MARK_ONE');

  for (let round = 0; round < 3; round += 1) {
    await items.nth(0).click();
    await expect.poll(() => visibleScreen(page), { timeout: 15_000 }).toContain('MARK_ZERO');
    await items.nth(1).click();
    await expect.poll(() => visibleScreen(page), { timeout: 15_000 }).toContain('MARK_ONE');
  }

  const counts = await countSockets(page);
  expect(counts.peak, `同时开着 ${counts.peak} 条终端 WS——一个终端一条就白改了`).toBeLessThanOrEqual(1);
  expect(errors, errors.join(' | ')).toHaveLength(0);
});

test('F8-002 切主视图再回来，屏幕还在', async ({ page }) => {
  await login(page);
  await openTerminalAndMark(page, 'KEEP_TAB');
  await page.getByRole('tab', { name: '文件' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('tab', { name: '动态' }).click();
  await expect.poll(() => visibleScreen(page), { timeout: 20_000 }).toContain('KEEP_TAB');
});

test('F8-003 刷新整页再打开，接回同一个 shell 且屏幕还在', async ({ page }) => {
  await login(page);
  await openTerminalAndMark(page, 'KEEP_RELOAD');
  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  if (!(await page.locator('.terminal-view').count())) {
    await page.getByRole('button', { name: /终端/ }).click();
  }
  await expect.poll(() => visibleScreen(page), { timeout: 20_000 }).toContain('KEEP_RELOAD');
});
