import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'long-running', seed: 140 },
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

async function sendAgentMessage(page, text) {
  const editor = page.getByRole('textbox', { name: '消息', exact: true });
  await editor.fill('@st');
  const option = page.getByRole('option', { name: /steward/ });
  if (await option.isVisible().catch(() => false)) await option.click();
  await editor.press('End');
  await editor.pressSequentially(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
}

test('TC-0316 C-BR-04a interrupt exits waiting edit and leaves Composer usable', async ({ page, request }) => {
  test.setTimeout(45_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await reset(request);
  await login(page);

  const activeText = '编辑冲突中的当前任务';
  await sendAgentMessage(page, activeText);
  const activeTurn = page.locator('.turn-card').filter({ hasText: activeText }).last();
  await expect(activeTurn).toBeVisible();
  await expect(activeTurn.getByRole('button', { name: '停止', exact: true })).toBeVisible();

  const queuedText = '准备编辑的等待消息';
  await sendAgentMessage(page, queuedText);
  const waiting = page.getByRole('region', { name: '等待区' });
  const queued = waiting.locator('.agent-wait-item').filter({ hasText: queuedText });
  await expect(queued).toBeVisible();
  await queued.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消编辑', exact: true })).toBeVisible();

  await activeTurn.getByRole('button', { name: '停止', exact: true }).click();
  await expect(activeTurn.getByText('✗ 已停止 · 发消息即继续', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '取消编辑', exact: true })).toHaveCount(0);
  // The current public Waiting owner uses the canonical supersession copy;
  // this is the same user-visible takeover fact as the retired wording.
  await expect(page.getByRole('alert')).toHaveText('另一项控制已接管编辑');

  await sendAgentMessage(page, '停止后仍能正常发送');
  await expect(page.getByText('停止后仍能正常发送', { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
