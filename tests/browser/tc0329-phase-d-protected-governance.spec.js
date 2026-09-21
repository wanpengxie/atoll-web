import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// Successor for fae8b70:tests/browser/phase-d.spec.js D-BR-10.
// Preserve the public protected-entry and denied-command journey.  The
// management panel must explain protected system actors, keep the owner row
// non-destructible, and keep a denied channel-creation request in its modal
// with an actionable server error rather than silently losing context.

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'channel-governance-denied', seed: 206 },
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

async function openMemberGovernance(page) {
  await page.getByRole('button', { name: '频道操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '频道详情', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '频道治理' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('tab', { name: '成员', exact: true })).toHaveAttribute('aria-selected', 'true');
  return panel;
}

test('TC-0329 D-BR-10 protected actors and denied governance keep context understandable', async ({ page, request }) => {
  await reset(request);
  await login(page);

  const panel = await openMemberGovernance(page);
  await expect(panel.getByText(/标准系统 Actor.*已隐藏/)).toBeVisible();
  const ownerRow = panel.locator('.managed-actor').filter({ hasText: 'root' }).first();
  await expect(ownerRow).toBeVisible();
  await expect(ownerRow.getByRole('button', { name: 'Owner', exact: true })).toBeDisabled();

  await panel.getByRole('button', { name: '关闭频道详情', exact: true }).click();
  await page.getByRole('button', { name: '新建频道', exact: true }).click();
  const creation = page.getByRole('dialog', { name: '新建频道' });
  await expect(creation).toBeVisible();
  const name = creation.getByLabel('新频道名称');
  await name.fill('denied-room');
  await creation.getByRole('button', { name: '创建频道', exact: true }).click();

  // Preserve the typed ledger code and the server detail in the public alert;
  // the modal and draft must remain available for retry.
  await expect(creation.getByRole('alert').filter({ hasText: /账本失败：unauthorized_sender/ })).toBeVisible();
  await expect(creation.getByRole('alert').filter({ hasText: /sender is not an active channel member/ })).toBeVisible();
  await expect(creation).toBeVisible();
  await expect(name).toHaveValue('denied-room');
});
