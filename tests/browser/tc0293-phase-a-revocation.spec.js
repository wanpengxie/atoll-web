import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'multi-channel', seed: 31 },
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

test('TC-0293 A-BR-08/09 disconnect, revoke, and retire converge through the public workspace', async ({ page, request }) => {
  await reset(request);
  await login(page);

  const project = page.locator('.channel-item').filter({
    has: page.locator('.channel-name', { hasText: /^c0\.project$/ }),
  });
  await expect(project).toBeVisible();
  await project.click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.getByLabel('消息')).toBeEnabled();

  const dropped = await request.post('/mock/control/action', { data: { type: 'drop' } });
  expect(dropped.ok()).toBe(true);
  await expect(page.locator('.connection-state')).toHaveClass(/state-reconnecting|state-closed/, { timeout: 10_000 });
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/, { timeout: 15_000 });

  const revoked = await request.post('/mock/control/action', {
    data: { type: 'revoke_membership', channel_id: 'c0.project' },
  });
  expect(revoked.ok()).toBe(true);
  await expect(page.getByLabel('消息')).toBeDisabled({ timeout: 15_000 });
  await expect(page.locator('.channel-rail').getByText('c0.project', { exact: true })).toBeVisible();

  const retired = await request.post('/mock/control/action', {
    data: { type: 'retire_channel', channel_id: 'c0.project' },
  });
  expect(retired.ok()).toBe(true);
  await expect(page.locator('main h1')).toHaveText('c0', { timeout: 15_000 });
  await expect(page.locator('.channel-rail').getByText('c0.project', { exact: true })).toHaveCount(0);
});
