import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'long-running', seed: 139 },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll', exact: true }).click();
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

test('TC-0314 C-BR-03a processing edit preserves public Reading and ordinary draft handoff', async ({ page, request }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await reset(request);
  await login(page);
  await openSteward(page);

  const taskText = 'TC0314 processing edit keeps the Reading owner';
  const turn = await sendTask(page, taskText);
  const editor = page.getByRole('textbox', { name: '消息', exact: true });
  const ordinaryDraft = 'TC0314 ordinary draft survives processing edit';
  const reading = page.locator('.timeline-reading-stack');

  await editor.fill(ordinaryDraft);
  await expect(reading).toHaveCount(1);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'following');

  await turn.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消编辑', exact: true })).toBeVisible();
  await expect(editor).toContainText(taskText);
  await expect(editor).toBeFocused();
  await expect(reading).toHaveCount(1);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'following');

  await editor.fill('TC0314 replacement remains edit-only');
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消编辑', exact: true })).toHaveCount(0);
  await expect(editor).toContainText(ordinaryDraft);
  await expect(editor).toBeFocused();
  await expect(reading).toHaveCount(1);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'following');
  expect(pageErrors).toEqual([]);
});
