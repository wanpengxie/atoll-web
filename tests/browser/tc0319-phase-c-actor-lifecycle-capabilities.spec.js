import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'actor-lifecycle', seed: 108 },
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

async function openSteward(page) {
  await page.getByRole('button', { name: '成员', exact: true }).click();
  const roster = page.getByRole('complementary', { name: '频道成员' });
  await expect(roster).toBeVisible();
  const steward = roster.getByRole('button', { name: /steward agent · mock:steward/ });
  await expect(steward).toHaveCount(1);
  await steward.click();
  const details = page.getByRole('complementary', { name: 'Actor 详情' });
  await expect(details).toBeVisible();
  return details;
}

test('TC-0319 C-BR-07/09/10 Actor details do not invent runtime lifecycle capabilities', async ({ page, request }) => {
  await reset(request);
  await login(page);

  const details = await openSteward(page);
  const capability = (type) => details.locator('.capability-row').filter({ hasText: type });

  await expect(capability('agent.restart')).toHaveCount(0);
  await expect(capability('agent.terminate')).toHaveCount(0);
  await expect(capability('agent.interrupt')).toHaveCount(1);
});
