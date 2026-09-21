import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// Successor for fae8b70:tests/browser/phase-d.spec.js:99 (TC-0325 /
// D-BR-03).  The legacy side-panel helpers are retired; this keeps the same
// user-visible delayed-projection contract on the public ChannelCreateModal.

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'channel-governance-delay', seed: 202 },
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

test('TC-0325 D-BR-03 delayed channel projection keeps ledger success and converges', async ({ page, request }) => {
  await reset(request);
  await login(page);

  await page.getByRole('button', { name: '新建频道', exact: true }).click();
  const creation = page.getByRole('dialog', { name: '新建频道' });
  await expect(creation).toBeVisible();
  await creation.getByLabel('新频道名称').fill('slow-projection');
  await creation.getByRole('button', { name: '创建频道', exact: true }).click();

  const progress = creation.getByRole('region', { name: '频道创建进度' });
  await expect(progress.getByText('账本确认', { exact: true }).locator('..'))
    .toContainText('已确认');
  await expect(progress.getByText('频道已经可以打开和协作。', { exact: true }))
    .toBeVisible({ timeout: 15_000 });
  await expect(progress.getByText('创建失败', { exact: true })).toHaveCount(0);
});
