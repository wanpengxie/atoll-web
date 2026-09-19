import { expect, test } from '@playwright/test';

async function reset(request, scenario, seed) {
  const response = await request.post('/mock/control/reset', { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

test('member filter keeps the selected Agent conversation visible and can be cleared', async ({ page, request }) => {
  await reset(request, 'deep-history', 29_211);
  await login(page);
  await page.locator('.channel-item').filter({
    has: page.locator('.channel-name', { hasText: /^c0\.project$/ }),
  }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');

  const latestConversation = page.getByText(
    'c0.project history 120: ask project-agent for PONG',
    { exact: true },
  );
  await expect(latestConversation).toBeVisible();

  const filter = page.getByRole('group', { name: '动态范围' })
    .getByRole('button', { name: 'project-agent', exact: true });
  await filter.click();
  await expect(filter).toHaveAttribute('aria-pressed', 'true');
  await expect(latestConversation).toBeVisible();
  await expect(page.getByText('c0.project PONG 120', { exact: true })).toBeVisible();

  await filter.click();
  await expect(filter).toHaveAttribute('aria-pressed', 'false');
  await expect(latestConversation).toBeVisible();
});
