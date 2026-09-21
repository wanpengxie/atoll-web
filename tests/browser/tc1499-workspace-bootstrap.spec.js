import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'multi-channel', seed: 1499 },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

test('TC-1499 Workspace cold reload restores the authenticated directory and forgets it on logout', async ({ page, request }) => {
  await reset(request);
  await login(page);

  // The visible account, member directory and selected profile are the
  // WorkspaceApp → useWireSession/useChannelNavigation public projection.
  await expect(page.locator('.account-card small')).toHaveText('root');
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.getByRole('button', { name: '# c0', exact: true })).toBeVisible();
  const project = page.locator('.channel-item').filter({
    has: page.locator('.channel-name').filter({ hasText: /^c0\.project$/ }),
  });
  await expect(project).toBeVisible();

  // A browser reload must preserve the same principal's channel/profile
  // manifest without requiring a second login or inventing a new owner.
  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('.account-card small')).toHaveText('root');
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(project).toBeVisible();

  // Logout is the public forget boundary: the Workspace disappears and a
  // subsequent document cannot re-enter from the old principal cache.
  await page.getByRole('button', { name: '退出' }).click();
  await expect(page.getByRole('textbox', { name: '账号', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: '账号', exact: true })).toBeVisible();
  await expect(page.locator('.channel-rail')).toHaveCount(0);
});
