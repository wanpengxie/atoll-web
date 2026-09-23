import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

test.use({ hasTouch: true, isMobile: true, viewport: { width: 360, height: 780 } });

async function login(page, request, scenario = 'multi-channel') {
  await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed: 4401 } });
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

const menu = async (page, item) => {
  await page.getByRole('button', { name: '频道操作' }).click();
  await page.getByRole('menuitem', { name: item }).click();
};

// Nothing visible may extend past the screen edge unless it sits inside a
// horizontal scroller.
const overflowing = (page, scope) => page.evaluate((selector) => {
  const root = document.querySelector(selector);
  const clipped = (el) => { for (let a = el.parentElement; a && a !== root; a = a.parentElement) { if (/(auto|scroll)/.test(getComputedStyle(a).overflowX)) return true; } return false; };
  return [...root.querySelectorAll('*')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top < innerHeight && (r.right > innerWidth + 1 || r.left < -1) && !clipped(el);
  }).map((el) => `${el.tagName}.${el.className}`);
}, scope);

test('the process panel fits the phone and stacks tool input keys above values', async ({ page, request }) => {
  await login(page, request, 'progress-real');
  const choose = page.getByRole('button', { name: '选择 Agent' });
  if (await choose.isVisible().catch(() => false)) {
    await choose.click();
    await page.getByRole('menuitem', { name: /steward/ }).first().click();
  }
  const editor = page.getByRole('textbox', { name: '消息' });
  await editor.click(); await editor.type('a turn with a long title that would push the close button off the screen');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText('检查完毕')).toBeVisible({ timeout: 15_000 });
  await page.locator('.progress-trail-toggle').first().tap();
  await page.locator('.progress-trail-list .progress-row button').first().tap();
  const panel = page.locator('.turn-detail-page');
  await expect(panel).toBeVisible();
  const close = await page.getByRole('button', { name: '关闭过程' }).boundingBox();
  expect(close.x + close.width).toBeLessThanOrEqual(360);
  expect(await overflowing(page, '.turn-detail-page')).toEqual([]);
  const [dt, dd] = await Promise.all([
    panel.locator('.structured-object dt', { hasText: 'command' }).boundingBox(),
    panel.locator('.structured-object dt', { hasText: 'command' }).locator('xpath=following-sibling::dd').boundingBox(),
  ]);
  expect(dd.y).toBeGreaterThanOrEqual(dt.y + dt.height - 1);
  // Output is a code block, not prose under 执行说明.
  await expect(panel.locator('.progress-tool-output pre, .progress-tool-output .code-block-line').first()).toBeVisible();
});

test('phone surfaces: reading history in the menu, terminal without the recipient pill, full-page search, tidy member rows', async ({ page, request }) => {
  await login(page, request);
  await expect(page.locator('.reading-history-edge-tab')).toBeHidden();
  await menu(page, '最近阅读');
  await expect(page.locator('.context-pane')).toContainText('最近阅读');
  await page.locator('.context-pane button[aria-label^="关闭"]').first().click();

  await menu(page, '打开终端');
  await expect(page.locator('.terminal-view')).toBeVisible();
  await expect(page.locator('.composer-target')).toBeHidden();
  await menu(page, '关闭终端');

  await page.getByRole('button', { name: '打开频道列表' }).click();
  await page.locator('.channel-rail').getByRole('button', { name: '搜索' }).click();
  const search = await page.locator('.global-search').boundingBox();
  expect(search.height).toBeGreaterThan(700);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '打开频道列表' }).click();
  await page.locator('.channel-rail').getByRole('button', { name: '新建频道' }).click();
  const box = await page.locator('.channel-create-member input[type="checkbox"]').first().boundingBox();
  expect(box.width).toBeLessThan(30);
  await page.keyboard.press('Escape');

  await menu(page, '频道详情');
  const buttons = page.locator('.context-pane .managed-actor button');
  await expect(buttons.first()).toBeVisible();
  for (const height of await buttons.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))) {
    expect(height).toBeGreaterThanOrEqual(44);
  }
  expect(await overflowing(page, '.context-pane')).toEqual([]);
});
