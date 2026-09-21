import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'long-running', seed: 103 },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('.timeline-message-list')).toBeVisible();
}

async function openSteward(page) {
  await page.getByRole('button', { name: '成员', exact: true }).click();
  const roster = page.getByRole('complementary', { name: '频道成员' });
  await expect(roster.getByRole('button', { name: /steward/ })).toBeVisible();
  await roster.getByRole('button', { name: /steward/ }).click();
  const details = page.getByRole('complementary', { name: 'Actor 详情' });
  await expect(details).toBeVisible();
  await expect(details).toContainText('mock.order.create');
  await details.getByRole('button', { name: /关闭/ }).click();
}

async function sendTask(page, text) {
  const editor = page.getByRole('textbox', { name: '消息', exact: true });
  await editor.fill('@st');
  const option = page.getByRole('option', { name: /steward/ });
  if (await option.isVisible().catch(() => false)) await option.click();
  await editor.press('End');
  await editor.pressSequentially(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const turn = page.locator('.turn-card').filter({ hasText: text }).last();
  await expect(turn).toBeVisible();
  return turn;
}

test('TC-0313 C-BR-03/05 processing exposes edit/stop only and removes controls after stop', async ({ page, request }) => {
  await reset(request);
  await login(page);
  await openSteward(page);

  const turn = await sendTask(page, '阶段C取消长任务');
  // Current successor renders the public task-control rail without an ARIA
  // region wrapper; the contract is the visible controls themselves.
  const controls = turn.locator('.task-controls');
  await expect(controls.getByRole('button', { name: '编辑', exact: true })).toBeVisible();
  await expect(controls.getByRole('button', { name: '停止', exact: true })).toBeVisible();
  await expect(controls.getByRole('button', { name: '取消任务', exact: true })).toHaveCount(0);

  await controls.getByRole('button', { name: '停止', exact: true }).click();
  await expect(turn.getByText('✗ 已停止 · 发消息即继续', { exact: true })).toBeVisible();
  await expect(turn.locator('.task-controls')).toHaveCount(0);
});
