import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'actor-capability', seed: 31101 },
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

test('TC-0311 Actor Describe keeps canonical actor metadata usable in Actor details', async ({ page, request }) => {
  await reset(request);
  await login(page);

  const details = await openSteward(page);
  await expect(details.getByText('Mock collaboration agent', { exact: true })).toBeVisible();

  const textCapability = details.locator('.capability-row').filter({ hasText: 'agent.ask' });
  await expect(textCapability.getByText('执行普通文本任务', { exact: true })).toBeVisible();
  await textCapability.getByText('可能的错误', { exact: true }).click();
  await expect(textCapability.getByText('provider_timeout', { exact: true })).toBeVisible();

  const orderCapability = details.locator('.capability-row').filter({ hasText: 'mock.order.create' });
  await expect(orderCapability.getByText('创建一个 Mock 订单', { exact: true })).toBeVisible();

  await details.getByRole('button', { name: '关闭steward', exact: true }).click();
  await page.getByRole('button', { name: '成员', exact: true }).click();
  const roster = page.getByRole('complementary', { name: '频道成员' });
  await expect(roster).toBeVisible();
  await roster.getByRole('button', { name: '刷新名册', exact: true }).click();
  await roster.getByRole('button', { name: /steward agent · mock:steward/ }).click();
  const refreshed = page.getByRole('complementary', { name: 'Actor 详情' });
  await expect(refreshed).toBeVisible();
  await expect(refreshed.getByText('Mock collaboration agent', { exact: true })).toBeVisible();
});
