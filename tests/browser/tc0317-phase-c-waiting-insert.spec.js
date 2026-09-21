import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'long-running', seed: 106 },
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
  await expect(roster).toBeVisible();
  await roster.getByRole('button', { name: /steward/ }).click();
  const details = page.getByRole('complementary', { name: 'Actor 详情' });
  await expect(details).toBeVisible();
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

test('TC-0317 C-BR-05/07 waiting insert materializes the target turn and removes the source controls', async ({ page, request }) => {
  await reset(request);
  await login(page);
  await openSteward(page);

  const original = await sendTask(page, '阶段C待调整长任务');
  const editor = page.getByRole('textbox', { name: '消息', exact: true });
  await editor.fill('只输出风险清单');
  await page.getByRole('button', { name: /发送/ }).click();

  const waiting = page.getByRole('region', { name: '等待区' });
  await expect(waiting).toContainText('只输出风险清单');
  await waiting.getByRole('button', { name: '插入', exact: true }).click();

  const inserted = page.locator('.turn-card').filter({ hasText: '只输出风险清单' });
  await expect(inserted).toBeVisible();
  await expect(waiting).toHaveCount(0);
  await expect(original.locator('.task-controls')).toHaveCount(0);
});
