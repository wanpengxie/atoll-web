import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'channel-governance', seed: 203 },
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

async function openDangerousGovernance(page) {
  await page.getByRole('button', { name: '频道操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '频道详情', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '频道治理' });
  await expect(panel).toBeVisible();
  await panel.getByRole('tab', { name: '危险操作', exact: true }).click();
  return panel;
}

test('TC-0326 D-BR-05 retires an ordinary channel only after explicit confirmation', async ({ page, request }) => {
  await reset(request);
  await login(page);

  await page.getByRole('button', { name: /c0\.project/ }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');

  const panel = await openDangerousGovernance(page);
  const retire = panel.getByRole('button', { name: '退役当前频道', exact: true });
  await expect(retire).toBeDisabled();
  await panel.getByLabel('退役确认').fill('c0.project');
  await expect(retire).toBeEnabled();
  await retire.click();

  await expect(page.locator('main h1')).toHaveText('c0', { timeout: 15_000 });
  await expect(page.locator('.channel-rail').getByText('c0.project', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('消息')).toBeEnabled();
});
