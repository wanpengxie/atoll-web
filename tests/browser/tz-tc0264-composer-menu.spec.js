import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// Exact public successor for fae8b70:tests/browser/layout-responsive.spec.js:94
// (TC-0264 / LAYOUT-03).  The contract is the visible Composer member menu:
// opening @ at the compact viewport must keep the input in place and keep the
// listbox inside the Composer input surface and the viewport.

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'actor-capability', seed: 953 },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

test('TC-0264 LAYOUT-03 @成员菜单以输入区为边界且不改变输入区位置', async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await reset(request);
  await login(page);

  const input = page.getByRole('textbox', { name: '消息', exact: true });
  const before = await input.boundingBox();
  expect(before).not.toBeNull();

  await input.fill('@');
  const menu = page.getByRole('listbox');
  await expect(menu).toBeVisible();
  // The current Composer owns the menu anchor, while FloatingPortal mounts
  // the listbox at the document root.  Preserve the old input-area geometry
  // contract without relying on the retired DOM-parent relationship.
  const inputArea = page.locator('.composer-input-area');
  await expect(inputArea).toBeVisible();
  const geometry = await menu.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportHeight: innerHeight,
    };
  });
  const inputAreaGeometry = await inputArea.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right };
  });
  const after = await input.boundingBox();

  expect(after).not.toBeNull();
  expect(after.y).toBe(before.y);
  expect(geometry.left).toBeGreaterThanOrEqual(inputAreaGeometry.left);
  expect(geometry.right).toBeLessThanOrEqual(inputAreaGeometry.right);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight);
});
