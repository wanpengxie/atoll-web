import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'multi-channel', seed: 2103 },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

test('NR21 roster self is fenced while detached and restored by the new attach', async ({ page, request }) => {
  await reset(request);
  await login(page);

  await page.getByRole('button', { name: '成员', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '频道成员' });
  const selfMarker = panel.locator('.roster-row strong em');
  await expect(panel).toBeVisible();
  await expect(selfMarker).toHaveCount(1);

  for (let index = 0; index < 10; index += 1) {
    const dropped = await request.post('/mock/control/action', { data: { type: 'drop' } });
    expect(dropped.ok()).toBe(true);
    await expect(page.locator('.connection-state')).toHaveClass(/state-reconnecting/);
    await expect(selfMarker).toHaveCount(0);
    await expect(page.locator('.connection-state')).toHaveClass(/state-open/, { timeout: 15_000 });
    await expect(selfMarker).toHaveCount(1);
  }
});
