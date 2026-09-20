import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', { data: { scenario: 'message-flow', seed: 3511 } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
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

test('AD-351 missing @ recipient stays visible, explains refusal, and sends no frame', async ({ page, request }) => {
  const submits = captureSubmitFrames(page);
  await reset(request);
  await login(page);

  const editor = page.getByLabel('消息');
  await editor.fill('@Cl');
  await page.getByRole('option', { name: /Claude/ }).click();
  await editor.pressSequentially('收件人消失后仍保留草稿');

  await page.getByRole('button', { name: '频道操作' }).click();
  await page.getByRole('menuitem', { name: '频道详情' }).click();
  const panel = page.getByRole('complementary', { name: '频道治理' });
  await expect(panel).toBeVisible();
  const claude = panel.locator('.managed-actor').filter({ hasText: 'Claude' }).first();
  await expect(claude).toBeVisible();
  await claude.getByRole('button', { name: '移除' }).click();
  const confirmation = panel.locator('.inline-confirmation');
  await expect(confirmation).toContainText('确认移除 Claude');
  await confirmation.getByRole('button', { name: '确认操作' }).click();
  await expect(panel.locator('.managed-actor').filter({ hasText: 'Claude' })).toHaveCount(0);
  await page.getByRole('button', { name: '关闭频道详情' }).click();

  const recipients = page.getByRole('status', { name: '收件人' });
  await expect(recipients.locator('.composer-target-pill.is-picked')).toContainText('@Claude');
  await expect(page.getByRole('alert')).toContainText(/@Claude.*已不在频道.*不可投递/);
  await expect(editor).toContainText('收件人消失后仍保留草稿');

  const beforeSend = submits.filter((frame) => frame?.msg_type === 'agent.ask').length;
  await page.getByRole('button', { name: '发送' }).click();
  await page.waitForTimeout(300);
  expect(submits.filter((frame) => frame?.msg_type === 'agent.ask')).toHaveLength(beforeSend);
  await expect(editor).toContainText('收件人消失后仍保留草稿');
});
