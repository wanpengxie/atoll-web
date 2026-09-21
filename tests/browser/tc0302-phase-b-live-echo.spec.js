import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'real-backend-shape', seed: 814 },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.getByRole('navigation', { name: '频道' })).toBeVisible();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

function decodeFrame(payload) {
  try {
    const value = JSON.parse(String(payload));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function isWorkspaceSocket(socket) {
  try {
    return new URL(socket.url()).pathname === '/ws';
  } catch {
    return false;
  }
}

test('TC-0302 B-BR-04b first local live echo keeps one public message identity and no new-dynamic notice', async ({ page, request }) => {
  await reset(request);

  const sent = [];
  const received = [];
  page.on('websocket', (socket) => {
    if (!isWorkspaceSocket(socket)) return;
    socket.on('framesent', ({ payload }) => {
      const frame = decodeFrame(payload);
      if (frame) sent.push(frame);
    });
    socket.on('framereceived', ({ payload }) => {
      const frame = decodeFrame(payload);
      if (frame) received.push(frame);
    });
  });

  await login(page);

  const message = `first-local-echo-${Date.now()}`;
  const editor = page.getByLabel('消息');
  await expect(editor).toBeEnabled();
  await editor.fill(message);
  await page.getByRole('button', { name: '发送', exact: true }).click();

  await expect.poll(() => sent.find((frame) => (
    frame.frame_type === 'submit'
      && frame.payload?.payload?.text === message
  ))).toBeTruthy();
  const submission = sent.find((frame) => (
    frame.frame_type === 'submit'
      && frame.payload?.payload?.text === message
  ));
  const messageId = String(submission?.payload?.id || '');
  expect(messageId).toBeTruthy();

  await expect.poll(() => received.filter((frame) => (
    frame.frame_type === 'feed'
      && frame.payload?.source === 'live'
      && frame.payload?.envelope?.id === messageId
  )).length).toBe(1);
  const live = received.find((frame) => (
    frame.frame_type === 'feed'
      && frame.payload?.source === 'live'
      && frame.payload?.envelope?.id === messageId
  ));
  expect(live?.payload?.envelope?.id).toBe(messageId);
  expect(live?.payload?.envelope?.payload?.body?.text).toBe(message);

  // The public Presentation row is keyed by the submitted envelope id.  A
  // local echo followed by its live feed must reconcile that key, not append
  // a second row or manufacture an unread/new-dynamic notice.
  await expect(page.locator(`[data-message-id="${messageId}"]`)).toHaveCount(1);
  await expect(page.getByText(message, { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /条新动态/ })).toHaveCount(0);

  await page.waitForTimeout(250);
  expect(received.filter((frame) => (
    frame.frame_type === 'feed'
      && frame.payload?.source === 'live'
      && frame.payload?.envelope?.id === messageId
  ))).toHaveLength(1);
  await expect(page.locator(`[data-message-id="${messageId}"]`)).toHaveCount(1);
  await expect(page.getByText(message, { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /条新动态/ })).toHaveCount(0);
});
