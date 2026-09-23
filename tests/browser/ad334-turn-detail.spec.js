import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request, seed = 33401) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'message-flow', seed },
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

test('AD334 turn detail exposes process identifiers without payload JSON', async ({ page, request }) => {
  await reset(request);
  await login(page);

  const marker = 'AD334 browser audit projection';
  const editor = page.getByRole('textbox', { name: '消息', exact: true });
  await editor.fill('@st');
  await page.getByRole('option', { name: /steward/ }).click();
  await editor.press('End');
  await editor.pressSequentially(marker);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  const turn = page.locator('.agent-conversation-turn').filter({ hasText: marker }).first();
  await expect(turn).toBeVisible();
  const requestId = await turn.getAttribute('data-request-id');
  await turn.getByRole('button', { name: '查看过程' }).first().click();

  // 查看过程 opens the one right-side process panel; process identifiers are
  // in its 账本信息 section.
  const detail = page.getByRole('complementary', { name: '回合详情' });
  await expect(detail).toBeVisible();
  await detail.getByText('账本信息').click();
  await expect(detail).toContainText('调用编号');
  await expect(detail).toContainText(`${requestId}-tool`);
  await expect(detail.locator('pre')).toHaveCount(0);
  await expect(detail).not.toContainText('"payload"');
});
