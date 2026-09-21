import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'multi-channel', seed: 6033 },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  const project = page.locator('.channel-item').filter({
    has: page.locator('.channel-name', { hasText: /^c0\.project$/ }),
  });
  await expect(project).toBeVisible({ timeout: 15_000 });
  await project.click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.locator('.composer-richtext')).toBeVisible();
}

function captureSubmitFrames(page) {
  const frames = [];
  page.on('websocket', (socket) => {
    socket.on('framesent', (frame) => {
      const raw = typeof frame === 'string' ? frame : frame?.payload;
      if (typeof raw !== 'string') return;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.frame_type === 'submit') frames.push(parsed.payload);
      } catch {
        // Handshake/control traffic is outside the submit contract.
      }
    });
  });
  return frames;
}

test('queued Composer send is rejected before wire after membership revocation and never resurrects', async ({ context, page, request }) => {
  const submits = captureSubmitFrames(page);
  await reset(request);
  await login(page);

  const connection = page.locator('.connection-state');
  const dropped = await request.post('/mock/control/action', { data: { type: 'drop' } });
  expect(dropped.ok()).toBe(true);
  await expect(connection).toHaveClass(/state-reconnecting|state-closed/, { timeout: 10_000 });
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);

  const editor = page.getByLabel('消息');
  await editor.fill('queued before membership revoke');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(editor).toHaveText('', { exact: true });
  expect(submits.filter((frame) => frame?.msg_type === 'agent.ask')).toHaveLength(0);

  const revoked = await request.post('/mock/control/action', {
    data: { type: 'revoke_membership', channel_id: 'c0.project' },
  });
  expect(revoked.ok()).toBe(true);

  await context.setOffline(false);
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/, { timeout: 15_000 });
  await expect(page.locator('.composer-error')).toContainText(/频道访问权限已被撤销|频道成员权限已撤销|频道授权事实已变化/, { timeout: 15_000 });
  expect(submits.filter((frame) => frame?.msg_type === 'agent.ask')).toHaveLength(0);

  const granted = await request.post('/mock/control/action', {
    data: { type: 'grant_membership', channel_id: 'c0.project', actor_id: 'root-project' },
  });
  expect(granted.ok()).toBe(true);
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/, { timeout: 15_000 });
  await page.waitForTimeout(500);
  expect(submits.filter((frame) => frame?.msg_type === 'agent.ask')).toHaveLength(0);
});
