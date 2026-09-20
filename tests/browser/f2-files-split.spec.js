import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'multi-channel', seed },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号' }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

async function openFilesAtWorkspace(page) {
  await page.locator('#workspace-files-toggle').click();
  const files = page.getByRole('region', { name: '频道文件' });
  await expect(files).toBeVisible();
  await files.getByRole('row', { name: /workspace/ }).click();
  await expect(files.getByRole('row', { name: /README\.md/ })).toBeVisible();
  return files;
}

test('UI-VIS-12 Files surface close returns focus to the desktop route trigger', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 224);
  await login(page);
  const files = await openFilesAtWorkspace(page);

  const close = files.getByRole('button', { name: '关闭文件', exact: true });
  await expect(close).toBeVisible();
  await close.click();
  await expect(page.getByRole('region', { name: '频道文件' })).toHaveCount(0);
  await expect(page.locator('#workspace-files-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#workspace-files-toggle')).toBeFocused();
});

test('UI-VIS-12 mobile Files surface close returns focus to channel actions', async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await reset(request, 225);
  await login(page);
  await page.getByRole('button', { name: '频道操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '打开文件', exact: true }).click();
  const files = page.getByRole('region', { name: '频道文件' });
  await expect(files).toBeVisible();
  const close = files.getByRole('button', { name: '关闭文件', exact: true });
  await expect(close).toBeVisible();
  await close.click();
  await expect(page.getByRole('region', { name: '频道文件' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '频道操作', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('F2-FS-02c desktop restores Files after a Tasks excursion', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await reset(request, 222);
  await login(page);
  const files = await openFilesAtWorkspace(page);

  await page.getByRole('tab', { name: '任务', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: '任务' })).toBeVisible();
  await expect(files).toHaveCount(0);

  await page.getByRole('tab', { name: '动态', exact: true }).click();
  await expect(files).toBeVisible();
  await expect(files.getByRole('row', { name: /README\.md/ })).toBeVisible();
  await expect(page.locator('#workspace-files-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/#\/channels\/c0\/files$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('F2-FS-02c mobile restores Files after a Tasks excursion', async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await reset(request, 223);
  await login(page);

  await page.getByRole('button', { name: '频道操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '打开文件', exact: true }).click();
  const files = page.getByRole('region', { name: '频道文件' });
  await expect(files).toBeVisible();
  await files.getByRole('row', { name: /workspace/ }).click();
  await expect(files.getByRole('row', { name: /README\.md/ })).toBeVisible();

  await page.getByRole('tab', { name: '任务', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: '任务' })).toBeVisible();
  await expect(files).toHaveCount(0);

  await page.getByRole('tab', { name: '动态', exact: true }).click();
  await expect(files).toBeVisible();
  await expect(files.getByRole('row', { name: /README\.md/ })).toBeVisible();
  await expect(page.locator('#workspace-files-toggle')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('F2-FS-03 desktop keeps the selected Files surface beside Terminal', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await reset(request, 220);
  await login(page);
  await openFilesAtWorkspace(page);

  await page.locator('#workspace-terminal-toggle').click();
  await expect(page.locator('.terminal-view')).toBeVisible();
  await expect(page.getByRole('region', { name: '频道动态' })).toBeVisible();
  await expect(page.getByRole('region', { name: '频道文件' })).toBeVisible();
  await expect(page.getByRole('row', { name: /README\.md/ })).toBeVisible();

  const geometry = await page.evaluate(() => {
    const box = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON();
    return {
      viewport: window.innerWidth,
      message: box('.dynamic-message-pane'),
      files: box('.artifacts-view'),
      terminal: box('.terminal-view'),
      filesToggle: document.querySelector('#workspace-files-toggle')?.getAttribute('aria-pressed'),
    };
  });
  expect(geometry.viewport).toBe(1280);
  expect(geometry.filesToggle).toBe('true');
  expect(geometry.files.left).toBeGreaterThanOrEqual(geometry.message.right - 1);
  expect(geometry.terminal.left).toBeGreaterThanOrEqual(geometry.message.right - 1);
  expect(geometry.terminal.top).toBeGreaterThanOrEqual(geometry.files.bottom - 1);
  expect(geometry.terminal.bottom).toBeLessThanOrEqual(geometry.message.bottom + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('F2-FS-03 mobile retains the mounted Files state while Terminal is shown', async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await reset(request, 221);
  await login(page);

  await page.getByRole('button', { name: '频道操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '打开文件', exact: true }).click();
  const files = page.getByRole('region', { name: '频道文件' });
  await expect(files).toBeVisible();
  await files.getByRole('row', { name: /workspace/ }).click();
  await expect(files.getByRole('row', { name: /README\.md/ })).toBeVisible();

  await page.getByRole('button', { name: '频道操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '打开终端', exact: true }).click();
  await expect(page.locator('.terminal-view')).toBeVisible();
  await expect(page.locator('#workspace-files-toggle')).toHaveAttribute('aria-pressed', 'true');
  // The compact/mobile CSS hides the file pane while Terminal owns the one
  // visible surface, but the feature must remain mounted so its directory and
  // selection survive the overlay.
  await expect(page.locator('.artifacts-view')).toHaveCount(1);
  await expect(page.locator('.artifacts-view')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole('button', { name: '频道操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '关闭终端', exact: true }).click();
  await expect(files).toBeVisible();
  await expect(files.getByRole('row', { name: /README\.md/ })).toBeVisible();
});
