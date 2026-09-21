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

test('F2-FS-01 Files surface opens beside the conversation without replacing its public composer', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 226);
  await login(page);

  await expect(page.getByRole('region', { name: '频道动态' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '频道文件' })).toHaveCount(0);

  await page.locator('#workspace-files-toggle').click();
  await expect(page.getByRole('region', { name: '频道文件' })).toBeVisible();
  await expect(page.getByRole('region', { name: '频道动态' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible();
  await expect(page.locator('#workspace-files-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/#\/channels\/c0\/files$/);

  await page.locator('#workspace-files-toggle').click();
  await expect(page.getByRole('region', { name: '频道文件' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '频道动态' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '消息', exact: true })).toBeVisible();
  await expect(page.locator('#workspace-files-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(page).toHaveURL(/#\/channels\/c0\/conversation$/);
});

test('F2-FS-02 desktop restores Files only for a channel that previously opened it', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await reset(request, 227);
  await login(page);

  const c0Files = await openFilesAtWorkspace(page);
  await expect(page).toHaveURL(/#\/channels\/c0\/files$/);

  const channelRail = page.getByRole('navigation', { name: '频道' });
  await channelRail.getByText('c0.project', { exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(c0Files).toHaveCount(0);
  await expect(page).toHaveURL(/#\/channels\/c0\.project\/conversation$/);

  await page.locator('#workspace-files-toggle').click();
  const projectFiles = page.getByRole('region', { name: '频道文件' });
  await expect(projectFiles).toBeVisible();
  await expect(projectFiles.getByRole('row', { name: /项目说明/ })).toBeVisible();
  await expect(page).toHaveURL(/#\/channels\/c0\.project\/files$/);

  await channelRail.getByText('c0', { exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.getByRole('region', { name: '频道文件' })).toBeVisible();
  await expect(page.getByRole('region', { name: '频道文件' }).getByRole('row', { name: /README\.md/ })).toBeVisible();
  await expect(page).toHaveURL(/#\/channels\/c0\/files$/);
});

test('F2-FS-02 mobile isolates Files memory while switching channels', async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await reset(request, 228);
  await login(page);

  await page.getByRole('button', { name: '频道操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '打开文件', exact: true }).click();
  const c0Files = page.getByRole('region', { name: '频道文件' });
  await expect(c0Files).toBeVisible();
  await c0Files.getByRole('row', { name: /workspace/ }).click();
  await expect(c0Files.getByRole('row', { name: /README\.md/ })).toBeVisible();

  await page.getByRole('button', { name: '打开频道列表', exact: true }).click();
  const channelRail = page.getByRole('navigation', { name: '频道' });
  await channelRail.getByText('c0.project', { exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(c0Files).toHaveCount(0);
  await expect(page).toHaveURL(/#\/channels\/c0\.project\/conversation$/);

  await page.getByRole('button', { name: '频道操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '打开文件', exact: true }).click();
  const projectFiles = page.getByRole('region', { name: '频道文件' });
  await expect(projectFiles).toBeVisible();
  await expect(projectFiles.getByRole('row', { name: /项目说明/ })).toBeVisible();

  await page.getByRole('button', { name: '打开频道列表', exact: true }).click();
  await channelRail.getByText('c0', { exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.getByRole('region', { name: '频道文件' })).toBeVisible();
  await expect(page.getByRole('region', { name: '频道文件' }).getByRole('row', { name: /README\.md/ })).toBeVisible();
  await expect(page).toHaveURL(/#\/channels\/c0\/files$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

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

test('F2-FS-04 mobile Files overlay keeps queued Waiting inert while Files and Composer stay usable', async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'long-running', seed: 226 },
  });
  expect(response.ok()).toBe(true);
  await login(page);

  await page.getByRole('button', { name: '选择 Agent', exact: true }).click();
  await page.getByRole('menu', { name: '选择目标 Agent' })
    .getByRole('menuitem', { name: 'steward' }).click();
  const composer = page.getByRole('textbox', { name: '消息', exact: true });
  await composer.fill('mobile Files owner');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('[data-presentation-row-id]').filter({ hasText: 'mobile Files owner' })).toBeVisible();
  await composer.fill('mobile Files queued Waiting');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const waiting = page.getByRole('region', { name: '等待区' });
  await expect(waiting).toContainText('mobile Files queued Waiting');

  await page.getByRole('button', { name: '频道操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '打开文件', exact: true }).click();
  const files = page.getByRole('region', { name: '频道文件' });
  await expect(files).toBeVisible();
  await expect(composer).toBeVisible();
  await expect(page.locator('.conversation-floating-slot')).toBeHidden();
  await expect(page.locator('.agent-wait-layer')).toBeHidden();
  await expect.poll(() => page.locator('.channel-files-scroll').evaluate((node) => (
    getComputedStyle(node).paddingBottom
  ))).toBe('152px');

  const waitingHit = await page.locator('.agent-wait-layer').evaluate((node) => {
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    const target = box.width > 0 && box.height > 0
      ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      : null;
    return {
      visibility: style.visibility,
      display: style.display,
      hitInsideWaiting: Boolean(target && (target === node || node.contains(target))),
      focusInsideWaiting: node.contains(document.activeElement),
    };
  });
  expect(waitingHit.visibility).toBe('hidden');
  expect(waitingHit.hitInsideWaiting).toBe(false);
  expect(waitingHit.focusInsideWaiting).toBe(false);

  // A bounded Tab walk must never enter the hidden Waiting subtree. The
  // Composer remains the only Conversation control layered over Files.
  await composer.fill('Files surface remains usable');
  await expect(composer).toBeFocused();
  const tabBudget = await page.locator('button, a[href], input, textarea, select, [tabindex]:not([tabindex="-1"])').count() + 4;
  for (let index = 0; index < tabBudget; index += 1) {
    await page.keyboard.press('Tab');
    await expect.poll(() => page.evaluate(() => (
      document.querySelector('.conversation-floating-slot')?.contains(document.activeElement) || false
    ))).toBe(false);
  }

  // The long-running fixture intentionally has no seeded rows; the public
  // Files refresh/upload controls still prove the surface owns its hit area
  // instead of being covered by the mounted Conversation pane.
  const refreshFiles = files.getByRole('button', { name: '刷新文件目录', exact: true });
  await expect(refreshFiles).toBeEnabled();
  await refreshFiles.click();
  await expect(files).toBeVisible();
  await composer.fill('Files and Composer both usable');
  await expect(composer).toContainText('Files and Composer both usable');
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
