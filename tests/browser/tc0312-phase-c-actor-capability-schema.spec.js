import { expect, test } from '@playwright/test';

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

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'actor-capability', seed: 3120 },
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

async function openSteward(page) {
  await page.getByRole('button', { name: '成员', exact: true }).click();
  const roster = page.getByRole('complementary', { name: '频道成员' });
  await expect(roster.getByRole('button', { name: /steward/ })).toBeVisible();
  await roster.getByRole('button', { name: /steward/ }).click();
  const details = page.getByRole('complementary', { name: 'Actor 详情' });
  await expect(details).toBeVisible();
  await expect(details).toContainText('mock.order.create');
  return details;
}

test('TC-0312 C-BR-02/03/04 preserves capability payload across refresh and shows the typed result', async ({ page, request }) => {
  const submits = captureSubmits(page);
  await reset(request);
  await login(page);

  const details = await openSteward(page);
  await details.locator('select').first().selectOption('mock.order.create');
  const payloadText = '{"name":"阶段C结构化订单","count":7,"priority":"urgent","notify":true}';
  const payload = details.getByRole('textbox', { name: '参数 JSON', exact: true });
  await payload.fill(payloadText);

  // The current public owner exposes an explicit capability refresh while the
  // actor detail remains mounted. This is the current successor of the old
  // OBS refresh action; the user-visible invariant is that the in-progress
  // payload is not replaced by the new Describe projection.
  await details.getByRole('button', { name: '刷新能力' }).click();
  await expect(payload).toHaveValue(payloadText);

  await details.getByRole('button', { name: '提交调用' }).click();
  await expect.poll(() => submits.find((frame) => frame?.msg_type === 'mock.order.create'))
    .toMatchObject({
      msg_type: 'mock.order.create',
      payload: { name: '阶段C结构化订单', count: 7, priority: 'urgent', notify: true },
    });

  await details.getByRole('button', { name: /关闭/ }).click();
  const result = page.locator('.structured-result-details').filter({ hasText: '结构化结果' }).last();
  await expect(result).toBeVisible();
  await result.locator(':scope > summary').click();
  await expect(result.locator('.structured-result-scroll')).toContainText('阶段C结构化订单');
  await expect(result.locator('.structured-result-scroll')).toContainText('7');
  await expect(result.locator('.structured-result-scroll')).toContainText('urgent');
  await expect(result.locator('.structured-result-scroll')).toContainText('是');
  await expect(result.locator('.structured-result-scroll')).toContainText('order_id');
});
