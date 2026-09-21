import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// Successor for fae8b70:tests/browser/phase-d.spec.js D-BR-07/08/09.
// Keep the historical member-panel contract public: adding a declaration
// creates an observable Agent row, that row exposes restart, and removal
// clears that exact instance.  A Composer /restart command is a different
// user path and cannot stand in for this member-management affordance.

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'actor-governance', seed: 205 },
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
  await page.getByRole('button', { name: '频道操作' }).click();
  await page.getByRole('menuitem', { name: '频道详情' }).click();
  const panel = page.getByRole('complementary', { name: /频道治理/ });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('tab', { name: '成员', exact: true })).toHaveAttribute('aria-selected', 'true');
  return panel;
}

test('TC-0328 D-BR-07/08/09 member Agent lifecycle keeps restart and instance removal public', async ({ page, request }) => {
  await reset(request);
  await login(page);
  const panel = await openMemberGovernance(page);

  const candidates = panel.getByRole('combobox', { name: '选择参与者' });
  await candidates.click();
  await panel.getByRole('option', { name: /Analyst Agent · Agent/ }).click();
  await panel.getByRole('button', { name: '添加到频道' }).click();

  const agentRow = panel.locator('.managed-actor').filter({ hasText: 'Analyst Agent' }).last();
  await expect(agentRow).toBeVisible();
  await expect(agentRow.locator('small')).toContainText('agent-actor-205-1');

  // D-BR-07 requires lifecycle control on the managed member row itself;
  // Composer /restart is a distinct public path and cannot substitute here.
  const restart = agentRow.getByRole('button', { name: '重启', exact: true });
  await expect(restart).toBeEnabled();
  await restart.click();
  await panel.getByRole('button', { name: '确认操作' }).click();
  await expect(panel.getByRole('status').filter({ hasText: /重启已提交|成员已就绪/ }).first())
    .toContainText(/重启已提交|成员已就绪/);

  const remove = agentRow.getByRole('button', { name: '移除', exact: true });
  await expect(remove).toBeEnabled();
  await remove.click();
  await panel.getByRole('button', { name: '确认操作' }).click();
  await expect(agentRow).toHaveCount(0);

  await candidates.click();
  const options = panel.getByRole('listbox', { name: '选择参与者选项' });
  await expect(options.getByRole('option', { name: /Analyst Agent · Agent/ })).toHaveCount(1);
  await expect(options.getByRole('option', { name: /Search Tool · 工具/ })).toHaveCount(1);
});
