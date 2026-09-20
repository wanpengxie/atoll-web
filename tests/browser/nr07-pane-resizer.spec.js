import { expect, test } from '@playwright/test';

const RAIL_KEY = 'atoll.web.pane.rail';

async function reset(request, seed) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'multi-channel', seed },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号' }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

async function railWidth(page) {
  return page.locator('.shell').evaluate((shell) => shell.style.getPropertyValue('--rail-width'));
}

test('NR07-01 public rail drag reports live width and commits the legacy preference on release', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 5701);
  await login(page);
  await page.evaluate((key) => localStorage.removeItem(key), RAIL_KEY);

  const handle = page.getByRole('separator', { name: '调整频道栏宽度' });
  await expect(handle).toBeVisible();
  await expect(handle).toHaveAttribute('aria-orientation', 'vertical');
  await expect(handle).toHaveAttribute('aria-valuemin', '200');
  const box = await handle.boundingBox();
  expect(box).toBeTruthy();
  const startX = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + 36, y, { steps: 2 });
  await expect.poll(() => railWidth(page)).toBe('300px');
  expect(await page.evaluate((key) => localStorage.getItem(key), RAIL_KEY)).toBeNull();
  await page.mouse.move(startX + 76, y, { steps: 2 });
  await expect.poll(() => railWidth(page)).toBe('340px');
  expect(await page.evaluate((key) => localStorage.getItem(key), RAIL_KEY)).toBeNull();
  await page.mouse.up();

  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), RAIL_KEY)).toBe('340');
  await expect(handle).toHaveAttribute('aria-valuenow', '340');

  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect.poll(() => railWidth(page)).toBe('340px');
  await expect(page.getByRole('separator', { name: '调整频道栏宽度' })).toBeVisible();
});

test('NR07-01 public rail keyboard and reset gestures clear the persisted width', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 5702);
  await login(page);
  await page.evaluate((key) => localStorage.setItem(key, '340'), RAIL_KEY);
  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);

  const handle = page.getByRole('separator', { name: '调整频道栏宽度' });
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => railWidth(page)).toBe('324px');
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), RAIL_KEY)).toBe('324');

  await handle.dblclick();
  await expect.poll(() => railWidth(page)).toBe('');
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), RAIL_KEY)).toBeNull();

  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), RAIL_KEY)).toBe('280');
  await page.keyboard.press('Home');
  await expect.poll(() => railWidth(page)).toBe('');
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), RAIL_KEY)).toBeNull();
});

test('NR07-01 rail separator is visible above the compact breakpoint and hidden at 900px', async ({ page, request }) => {
  await page.setViewportSize({ width: 901, height: 720 });
  await reset(request, 5703);
  await login(page);
  const handle = page.getByRole('separator', { name: '调整频道栏宽度' });
  await expect(page.locator('.shell')).toHaveClass(/desktop-shell/);
  await expect(handle).toBeVisible();
  const geometry = await page.evaluate(() => {
    const rail = document.querySelector('.channel-rail')?.getBoundingClientRect();
    const separator = document.querySelector('.pane-resizer-rail')?.getBoundingClientRect();
    return { railRight: rail?.right, separatorCenter: separator ? separator.left + separator.width / 2 : null };
  });
  expect(Math.abs(geometry.separatorCenter - geometry.railRight)).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 900, height: 720 });
  await expect(page.locator('.shell')).toHaveClass(/compact-shell/);
  await expect(handle).toBeHidden();
});
