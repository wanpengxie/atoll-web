import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'resource-workflow', seed: 955 },
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

async function viewportGeometry(page, panel) {
  return page.evaluate((element) => {
    const panelRect = element.getBoundingClientRect();
    return {
      left: panelRect.left,
      right: panelRect.right,
      viewport: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  }, await panel.elementHandle());
}

test('TC-0266 LAYOUT-05 Context owns the workspace at 800px and the full surface at 600px', async ({ page, request }) => {
  await page.setViewportSize({ width: 800, height: 720 });
  await reset(request);
  await login(page);
  await page.getByRole('button', { name: '成员', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '频道成员' });
  await expect(panel).toBeVisible();

  let geometry = await viewportGeometry(page, panel);
  const rail = await page.locator('.channel-rail').boundingBox();
  expect(rail).not.toBeNull();
  expect(geometry.left).toBe(rail.x + rail.width);
  expect(geometry.right).toBe(geometry.viewport);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);

  await page.setViewportSize({ width: 600, height: 720 });
  geometry = await viewportGeometry(page, panel);
  expect(geometry.left).toBe(0);
  expect(geometry.right).toBe(geometry.viewport);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport);
});
