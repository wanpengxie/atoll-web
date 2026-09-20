import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

const CONTEXT_KEY = 'atoll.web.pane.context';
const ARTIFACT_KEY = 'atoll.web.pane.artifact';

async function reset(request, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'actor-governance', seed },
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

async function clearPanePrefs(page) {
  await page.evaluate(([contextKey, artifactKey]) => {
    localStorage.removeItem(contextKey);
    localStorage.removeItem(artifactKey);
  }, [CONTEXT_KEY, ARTIFACT_KEY]);
}

async function openChannelContext(page) {
  await page.getByRole('button', { name: '频道操作' }).click();
  await page.getByRole('menuitem', { name: '频道详情' }).click();
  const panel = page.getByRole('complementary', { name: /频道治理/ });
  await expect(panel).toBeVisible();
  await panel.getByRole('tab', { name: '成员', exact: true }).click();
  return panel;
}

test('NR07-02 context pane drag/keyboard/reset stays on the public workspace path', async ({ page, request }) => {
  await page.setViewportSize({ width: 1000, height: 720 });
  await reset(request, 180702);
  await login(page);
  await clearPanePrefs(page);

  await openChannelContext(page);
  const host = page.locator('.context-host[data-context-type="channel-administration"]');
  const handle = page.getByRole('separator', { name: '调整右侧面板宽度' });
  await expect(handle).toBeVisible();
  const before = await host.locator('.context-pane').evaluate((node) => node.getBoundingClientRect().width);
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box.x + box.width / 2, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + 20);
  await page.mouse.up();

  const dragged = await host.locator('.context-pane').evaluate((node) => ({
    width: node.getBoundingClientRect().width,
    style: node.parentElement.style.getPropertyValue('--context-width'),
  }));
  expect(dragged.width).toBeGreaterThan(before + 70);
  expect(dragged.style).toBe(`${Math.round(dragged.width)}px`);
  expect(await page.evaluate((key) => localStorage.getItem(key), CONTEXT_KEY)).toBe(String(Math.round(dragged.width)));
  expect(await page.evaluate((key) => localStorage.getItem(key), ARTIFACT_KEY)).toBeNull();

  await handle.focus();
  const keyboardBefore = Number.parseFloat((await host.getAttribute('style')).match(/--context-width:\s*([\d.]+)px/)?.[1]);
  await handle.press('ArrowLeft');
  const keyboardAfter = Number.parseFloat((await host.getAttribute('style')).match(/--context-width:\s*([\d.]+)px/)?.[1]);
  expect(keyboardAfter - keyboardBefore).toBe(16);
  await handle.press('Home');
  await expect(host).not.toHaveAttribute('style', /--context-width/);
  expect(await page.evaluate((key) => localStorage.getItem(key), CONTEXT_KEY)).toBeNull();

  await handle.press('ArrowLeft');
  await handle.dblclick();
  await expect(host).not.toHaveAttribute('style', /--context-width/);
  expect(await page.evaluate((key) => localStorage.getItem(key), CONTEXT_KEY)).toBeNull();
});

test('NR07-02 context preference survives the public panel close/reopen and is hidden at compact width', async ({ page, request }) => {
  await page.setViewportSize({ width: 1000, height: 720 });
  await reset(request, 180703);
  await login(page);
  await clearPanePrefs(page);
  await openChannelContext(page);

  const host = page.locator('.context-host[data-context-type="channel-administration"]');
  const handle = page.getByRole('separator', { name: '调整右侧面板宽度' });
  await handle.focus();
  await handle.press('ArrowLeft');
  const saved = await page.evaluate((key) => localStorage.getItem(key), CONTEXT_KEY);
  expect(saved).toBe('376');

  await page.getByRole('button', { name: '关闭频道详情' }).click();
  await expect(host).toHaveCount(0);
  await openChannelContext(page);
  await expect(page.locator('.context-host')).toHaveAttribute('style', /--context-width:\s*376px/);

  await page.setViewportSize({ width: 900, height: 720 });
  const compactHandle = page.getByRole('separator', { name: '调整右侧面板宽度' });
  await expect(compactHandle).toBeHidden();
  await page.setViewportSize({ width: 901, height: 720 });
  await expect(compactHandle).toBeVisible();
});
