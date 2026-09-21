import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'multi-channel', seed: 2920 },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

function channel(page, name) {
  return page.locator('.channel-item').filter({
    has: page.locator('.channel-name', { hasText: new RegExp(`^${name.replace('.', '\\.')}$`) }),
  });
}

async function openMembers(page) {
  await page.getByRole('button', { name: '频道操作' }).click();
  await page.getByRole('menuitem', { name: '频道详情', exact: true }).click();
  const panel = page.getByRole('complementary', { name: /频道治理/ });
  await expect(panel).toBeVisible();
  await panel.getByRole('tab', { name: '成员', exact: true }).click();
  return panel;
}

test('TC-0292 phase-A multi-channel isolation, terminal approval, and actor visibility', async ({ page, request }) => {
  await reset(request);
  await login(page);

  // The public channel button is the only navigation input in this contract.
  // Entering c0.project must not leak the root ledger into its presentation.
  await channel(page, 'c0.project').click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.getByText('c0.project history 1: ask project-agent for PONG', { exact: true })).toBeVisible();
  await expect(page.locator('main').getByText(/^c0 history 1/)).toHaveCount(0);

  // The member tab is the public governance projection. System and service
  // actors may occur in the ledger but must not be exposed as user members.
  const panel = await openMembers(page);
  await expect(panel.getByText('project-agent', { exact: true })).toBeVisible();
  await expect(panel.getByText('system', { exact: true })).toHaveCount(0);
  await expect(panel.getByText('registrar', { exact: true })).toHaveCount(0);
  await expect(panel.getByText('svcactor', { exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: '关闭频道详情' }).click();

  // A user message must reach its terminal response, while the pre-seeded
  // approval card must publish an explicit receipt and COMPLETED result.
  const message = 'TC0292 public multi-channel terminal check';
  await page.getByLabel('消息').fill(message);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await expect(page.getByText('PONG', { exact: true }).last()).toBeVisible();

  const approval = page.locator('.approval-card').first();
  await expect(approval.getByText('需要你的决定', { exact: true })).toBeVisible();
  await approval.getByRole('button', { name: '批准', exact: true }).click();
  await expect(approval).toContainText('已回执');
  await expect(approval).toContainText('COMPLETED');

  // Two live pulses alternate channels. Only the project pulse belongs in
  // this active channel; the c0 pulse must remain absent from main.
  const firstPulse = await request.post(`${MOCK}/mock/control/action`, { data: { type: 'pulse' } });
  const secondPulse = await request.post(`${MOCK}/mock/control/action`, { data: { type: 'pulse' } });
  expect(firstPulse.ok()).toBe(true);
  expect(secondPulse.ok()).toBe(true);
  await expect(page.getByText(/project 动态 #2/)).toBeVisible();
  await expect(page.locator('main').getByText(/c0 动态 #1/)).toHaveCount(0);
});
