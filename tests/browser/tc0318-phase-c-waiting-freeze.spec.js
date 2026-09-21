import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'long-running', seed: 107 },
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

test('TC-0318 C-BR-06/08 queued work stays in Waiting while interrupt freezes only the Agent turn', async ({ page, request }) => {
  await reset(request);
  await login(page);

  const original = await sendTask(page, '阶段C待打断长任务');
  const editor = page.getByRole('textbox', { name: '消息', exact: true });
  await editor.fill('队列中的后续任务');
  await page.getByRole('button', { name: /发送/ }).click();

  const waiting = page.getByRole('region', { name: '等待区' });
  await expect(waiting).toContainText('队列中的后续任务');
  await expect(page.locator('.timeline')).not.toContainText('队列中的后续任务');

  await original.getByRole('button', { name: '停止', exact: true }).click();
  await expect(original).toContainText('✗ 已停止 · 发消息即继续');
  await expect(waiting).not.toContainText('已暂停');
  await expect(page.getByRole('button', { name: '继续', exact: true })).toHaveCount(0);
});
