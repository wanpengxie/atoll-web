import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'approval-schema', seed: 32001 },
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

test('TC-0320 C-BR-08/11 approval keeps note and authoritative resolver across reload', async ({ page, request }) => {
  await reset(request);
  await login(page);

  const approval = page.locator('.approval-card').first();
  await expect(approval).toBeVisible();
  await expect(approval.getByText(/影响：/)).toBeVisible();
  const note = '同意按灰度方案执行';
  await approval.getByRole('textbox', { name: '备注（可选）' }).fill(note);
  await approval.getByRole('button', { name: '批准', exact: true }).click();

  await expect(approval).toContainText(/处理者：root.*approve/);
  await approval.locator('.structured-result-details > summary').click();
  await expect(approval.locator('dl').getByText(note, { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  const restored = page.locator('.approval-card').first();
  await expect(restored).toBeVisible();
  await expect(restored.getByText(/处理者：root.*approve/)).toBeVisible();
});
