import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// Successor for fae8b70:tests/browser/phase-d.spec.js:56 (TC-0323/D-BR-00).
// The current public owner keeps channel creation in ChannelCreateModal and
// channel management in ChannelAdministrationPanel; adjacent tests exercise
// each path's feature, but do not preserve this entry-separation contract.

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'channel-governance', seed: 323 },
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

test('TC-0323 D-BR-00 channel creation and management remain separate public entries', async ({ page, request }) => {
  await reset(request);
  await login(page);

  await page.getByRole('button', { name: '新建频道', exact: true }).click();
  const creation = page.getByRole('dialog', { name: '新建频道' });
  await expect(creation).toBeVisible();
  await expect(creation.getByRole('tablist')).toHaveCount(0);
  await expect(creation.getByLabel('新频道名称')).toBeVisible();
  await expect(creation.getByRole('button', { name: '读取完整详情到账本' })).toHaveCount(0);
  await creation.getByRole('button', { name: '关闭新建频道' }).click();
  await expect(creation).toHaveCount(0);

  await page.getByRole('button', { name: '频道操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '频道详情', exact: true }).click();
  const management = page.getByRole('complementary', { name: '频道治理' });
  await expect(management).toBeVisible();
  await management.getByRole('tab', { name: '概览', exact: true }).click();
  await expect(management.getByRole('tablist')).toBeVisible();
  await expect(management.getByRole('tab', { name: '概览', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(management.getByRole('tab', { name: '成员', exact: true })).toHaveAttribute('aria-selected', 'false');
  await expect(management.getByLabel('新频道名称')).toHaveCount(0);
  await expect(management.getByRole('button', { name: '关闭频道详情' })).toBeVisible();
});
