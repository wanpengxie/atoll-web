import { expect, test } from '@playwright/test';

const MOCK = 'http://127.0.0.1:8832';

async function login(page, request, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario: 'multi-channel', seed } });
  expect(response.ok()).toBe(true);
  await page.goto('/');
  await page.getByLabel('邮箱').fill('root@atoll.local');
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
    const boxes = await page.locator(selector).evaluateAll((nodes) => nodes.filter((node) => !node.hidden).map((node) => {
      const box = node.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }));
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
  await expect(page.getByRole('tab', { name: '文件' })).toBeFocused();
  await expect(page.getByRole('tab', { name: '文件' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: '文件' })).toBeVisible();

  const opener = page.locator('button[aria-label="全局搜索"]');
  await opener.click();
  await expect(page.getByRole('dialog', { name: '全局搜索' }).getByRole('textbox')).toBeFocused();
  await expect(page.locator('.shell')).toHaveAttribute('aria-hidden', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '全局搜索' })).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('F6-004 reduced motion 停止持续动画', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await login(page, request, 1605);
  const animation = await page.evaluate(() => {
    const node = document.createElement('span');
    node.className = 'pending-spinner';
    document.body.append(node);
    const style = getComputedStyle(node);
    const result = { duration: style.animationDuration, iterations: style.animationIterationCount };
    node.remove();
    return result;
  });
  expect(['0.01ms', '1e-05s']).toContain(animation.duration);
  expect(animation.iterations).toBe('1');
});
