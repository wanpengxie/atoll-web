import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'actor-governance', seed: 19401 },
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

test('AD-194 only exposes member ready after the canonical roster settles', async ({ page, request }) => {
  await reset(request);
  await login(page);

  // c0 的成员是平台固定的；加一个 Agent 成员条目在 c0.project 里做。
  await page.getByRole('button', { name: /c0\.project/ }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await page.getByRole('button', { name: '频道操作' }).click();
  await page.getByRole('menuitem', { name: '频道详情' }).click();
  const panel = page.getByRole('complementary', { name: /频道治理/ });
  await expect(panel.getByRole('tab', { name: '成员' })).toHaveAttribute('aria-selected', 'true');

  const select = panel.getByRole('combobox', { name: '选择参与者' });
  await select.click();
  await panel.getByRole('option', { name: /analyst@1 · Actor 描述/ }).click();
  await panel.getByRole('button', { name: '添加到频道' }).click();

  // The command receipt is not roster readiness. The ready fact must come
  // from the canonical service-backed roster projection for this channel.
  await expect(panel.getByText(/^成员条目已写进频道描述；成员构建好后出现在名册里/)).toBeVisible();
  await expect(panel.getByText('成员已就绪')).toBeVisible({ timeout: 10_000 });
  await expect(panel.locator('.managed-actor').filter({ hasText: 'agent:analyst:' })).toHaveCount(1);
});
