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
  await expect(page.getByRole('navigation', { name: '频道' })).toBeVisible();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

test('TC-0296 B-BR-01 keeps root/project/public channels and lists c0\'s described members, not the system door', async ({ page, request }) => {
  await reset(request);
  await login(page);

  const rail = page.locator('.channel-rail');
  await expect(rail.getByText('c0', { exact: true })).toBeVisible();
  await expect(rail.getByText('c0.project', { exact: true })).toBeVisible();
  await expect(rail.getByText('c0.public', { exact: true })).toBeVisible();
  await expect(page.getByText(/lobby/i)).toHaveCount(0);

  await page.getByRole('button', { name: '成员', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '频道成员' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('steward', { exact: true })).toBeVisible();
  // c0 的描述（内核写的）里的成员照常列出；system 门不是成员。
  await expect(panel.getByText('system', { exact: true })).toHaveCount(0);
  for (const name of ['registrar', 'svcactor', 'metapeer']) {
    await expect(panel.getByText(name, { exact: true })).toBeVisible();
  }
});
