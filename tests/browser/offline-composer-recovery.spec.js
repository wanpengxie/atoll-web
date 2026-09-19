import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', { data: { scenario: 'message-flow', seed: 6601 } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.locator('.timeline')).toBeVisible();
  await expect(page.locator('.top-error')).toHaveCount(0);
}

async function disconnect(context, page, request) {
  await context.setOffline(true);
  const response = await request.post('/mock/control/action', { data: { type: 'drop' } });
  expect(response.ok()).toBe(true);
  // Offline draft admission is owned by the browser network boundary, not by
  // the asynchronously painted WebSocket badge. Chromium can retain the last
  // OPEN paint until it delivers the socket close task even though every new
  // connection and request is already rejected. Requiring RECONNECTING here
  // made the fixture race an unrelated UI publication before it could exercise
  // the durable draft/submission transaction.
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
}

async function chooseSteward(page) {
  const editor = page.getByRole('textbox', { name: '消息', exact: true });
  await editor.fill('@st');
  await page.getByRole('option', { name: /steward/ }).click();
}

test('offline draft restores after reload and sends exactly once when reconnected', async ({ context, page, request }) => {
  await reset(request);
  await login(page);

  const editor = page.getByRole('textbox', { name: '消息' });
  // Establish the "known member" premise while the canonical roster is
  // online. The durable recipient snapshot may then be edited and restored
  // offline without asking an unavailable directory to discover a new actor.
  await chooseSteward(page);
  await expect(page.getByRole('status', { name: '收件人' })).toContainText('@steward');

  await disconnect(context, page, request);
  await expect(editor).toBeEnabled();
  await expect(page.locator('.connection-state')).toHaveClass(/state-reconnecting/);
  await expect(page.getByLabel('上传本机文件到频道')).toBeDisabled();

  await editor.pressSequentially('离线草稿跨刷新恢复');
  await expect(editor).toContainText('离线草稿跨刷新恢复');
  await expect(editor).toBeFocused();

  await context.setOffline(false);
  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.getByRole('textbox', { name: '消息' })).toContainText('离线草稿跨刷新恢复');
  await expect(page.getByRole('status', { name: '收件人' })).toContainText('@steward');

  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByRole('textbox', { name: '消息' })).toHaveText('', { exact: true });
  const sent = page.locator('[data-presentation-row-id]').filter({ hasText: '离线草稿跨刷新恢复' });
  await expect(sent).toHaveCount(1);
  await expect(sent).toBeVisible();
});
