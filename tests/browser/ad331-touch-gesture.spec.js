import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function reset(request, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'actor-capability', seed },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

test('AD-331 390x844 message surface keeps touch gestures reachable and keyboard actions available', async ({ page, request }) => {
  await reset(request, 33101);
  await login(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });

  const bubble = page.locator('.agent-turn-bubble').first();
  const surface = bubble.locator('.message-body');
  const actions = bubble.locator('.message-actions');
  const copy = bubble.getByRole('button', { name: '复制' });
  const reply = bubble.getByRole('button', { name: '↩ 回复' });
  await expect(surface).toBeVisible();
  await expect(surface).not.toHaveCSS('display', 'none');
  await expect(actions).not.toHaveCSS('display', 'none');
  await expect(copy).toHaveCount(1);
  await expect(reply).toHaveCount(1);
  const interaction = await surface.evaluate((node) => ({
    touchAction: getComputedStyle(node.closest('.replyable-message')).touchAction,
    userSelect: getComputedStyle(node).userSelect,
  }));
  expect(interaction.touchAction).toBe('pan-y');
  expect(interaction.userSelect).not.toBe('none');

  const surfaceBox = await surface.boundingBox();
  expect(surfaceBox?.width).toBeGreaterThan(0);
  expect(surfaceBox?.height).toBeGreaterThan(0);

  await surface.tap();
  await expect(page.locator('.composer-reply')).toBeVisible();
  await expect(page.locator('.composer-reply')).toContainText('回复');
  await page.getByRole('button', { name: '取消回复' }).click();

  // Playwright exposes a real mobile tap but no separate touchscreen hold;
  // dispatch the same public PointerEvent sequence in Chromium for the long
  // press so the production surface, rather than an action button, is tested.
  await surface.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0, isPrimary: true });
  await page.waitForTimeout(600);
  await surface.dispatchEvent('pointerup', { pointerType: 'touch', button: 0, isPrimary: true });
  await expect(bubble.locator('.message-copy-feedback')).toHaveText('已复制正文');
  await expect(page.locator('.composer-reply')).toHaveCount(0);

  await reply.focus();
  await expect(reply).toBeFocused();
  await expect(reply).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.composer-reply')).toBeVisible();
  await expect(page.locator('.composer-reply')).toContainText('回复');
});
