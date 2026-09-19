import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';


async function login(page, request, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario: 'multi-channel', seed } });
  expect(response.ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号' }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

test('F6-003 1280/800/600/320 与 200% 等价视口没有页面横向溢出', async ({ page, request }) => {
  await login(page, request, 1603);
  for (const width of [1280, 800, 640, 600, 320]) {
    await page.setViewportSize({ width, height: 720 });
    const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }));
    expect(geometry.document).toBeLessThanOrEqual(geometry.viewport);
  }

  await page.setViewportSize({ width: 320, height: 720 });
  for (const selector of ['.mobile-channel-toggle', '.header-action', '.channel-view-tabs button', '.send-button']) {
    // 只量"画出来了"的：display:none 的件（窄屏下的 .mock-advance-action）盒子是
    // 0×0，手指点不到它，拿 44 去要求它只会把一条真判据变成假警报。node.hidden
    // 只看 HTML 的 hidden 属性，看不见 display:none。
    const boxes = await page.locator(selector).evaluateAll((nodes) => nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }).filter((box) => box.width > 0 && box.height > 0));
    expect(boxes.length, selector).toBeGreaterThan(0);
    for (const box of boxes) expect(Math.min(box.width, box.height), selector).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('button', { name: '打开频道列表' }).click();
  await expect(page.getByRole('button', { name: '关闭频道列表' })).toBeVisible();
  await page.getByRole('button', { name: '关闭频道列表' }).click();
  await expect(page.getByRole('button', { name: '打开频道列表' })).toBeFocused();
});

test('F6-004 主视图支持方向键，Modal 隔离背景并恢复焦点', async ({ page, request }) => {
  await login(page, request, 1604);
  const dynamic = page.getByRole('tab', { name: '动态' });
  await dynamic.focus();
  await dynamic.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '任务' })).toBeFocused();
  await expect(page.getByRole('tab', { name: '任务' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: '任务' })).toBeVisible();

  const opener = page.locator('button[aria-label="全局搜索"]');
  await opener.click();
  await expect(page.getByRole('dialog', { name: '全局搜索' }).getByRole('textbox')).toBeFocused();
  // The modal focus owner marks the application surfaces (its sibling rail
  // and main) inert. The shell is the modal layer's parent and intentionally
  // remains exposed to host the dialog, so asserting on it is the retired
  // ownership contract.
  await expect(page.locator('main')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('main')).toHaveJSProperty('inert', true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '全局搜索' })).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('F6-004 reduced motion 停止持续动画', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page, request, 1605);
  const animation = await page.evaluate(() => {
    const node = document.createElement('span');
    node.className = 'attachment-tool-busy';
    document.body.append(node);
    const style = getComputedStyle(node);
    const result = { duration: style.animationDuration, iterations: style.animationIterationCount };
    node.remove();
    return result;
  });
  expect(['0.01ms', '1e-05s']).toContain(animation.duration);
  expect(animation.iterations).toBe('1');
});
