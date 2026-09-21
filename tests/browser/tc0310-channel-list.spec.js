import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'multi-channel', seed: 3100 },
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

function submittedPayload(frame) {
  try {
    let outer = typeof frame === 'string' ? JSON.parse(frame) : frame;
    if (typeof outer?.payload === 'string') outer = JSON.parse(outer.payload);
    return outer?.frame_type === 'submit' ? outer.payload : null;
  } catch {
    return null;
  }
}

function captureSubmits(page) {
  const submits = [];
  page.on('websocket', (socket) => socket.on('framesent', (frame) => {
    const payload = submittedPayload(frame);
    if (payload) submits.push(payload);
  }));
  return submits;
}

test('TC-0310 普通频道通过 system actor 展示 channel.list', async ({ page, request }) => {
  const submits = captureSubmits(page);
  await reset(request);
  await login(page);

  await page.getByRole('button', { name: /c0\.project/ }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await page.getByLabel('消息').fill('/channels');
  await page.getByRole('button', { name: /发送/ }).click();

  await expect.poll(() => submits.find((payload) => payload?.msg_type === 'system.channel.list'))
    .toMatchObject({
      channel_id: 'c0.project',
      msg_type: 'system.channel.list',
      kind: 'request',
      audience: ['system'],
    });

  const result = page.locator('.structured-result-details').filter({ hasText: 'system.channel.list' }).last();
  await expect(result).toBeVisible();
  await result.locator(':scope > summary').click();
  await expect(result.locator('.structured-result-scroll')).toContainText('c0.public');
});
