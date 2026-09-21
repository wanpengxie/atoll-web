import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'actor-governance', seed: 327 },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

async function openMembers(page) {
  await page.getByRole('button', { name: '频道操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '频道详情', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '频道治理' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('tab', { name: '成员', exact: true })).toHaveAttribute('aria-selected', 'true');
  return panel;
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

test('TC-0327 D-BR-06 admits an OBS human candidate and waits for roster convergence', async ({ page, request }) => {
  const submits = [];
  page.on('websocket', (socket) => socket.on('framesent', (frame) => {
    const payload = submittedPayload(frame);
    if (payload) submits.push(payload);
  }));

  await reset(request);
  await login(page);
  const panel = await openMembers(page);
  const principal = panel.getByRole('combobox', { name: '选择参与者', exact: true });
  await principal.click();

  const options = panel.getByRole('listbox', { name: '选择参与者选项', exact: true });
  await expect(options.getByRole('option', { name: /Alice · 用户/ })).toHaveCount(1);
  await expect(options.getByRole('option', { name: /Root · 用户/ })).toHaveCount(0);
  await options.getByRole('option', { name: /Alice · 用户/ }).click();
  await expect(panel.locator('[data-participant-id="alice"][data-participant-kind="human"]')).toBeVisible();

  await panel.getByRole('button', { name: '添加到频道', exact: true }).click();
  await expect.poll(() => submits.find((payload) => payload?.msg_type === 'system.member.admit'))
    .toMatchObject({
      msg_type: 'system.member.admit',
      channel_id: 'c0',
      payload: { principal: 'alice' },
    });
  await expect(panel.locator('.managed-actor').filter({ hasText: 'alice-home' })).toBeVisible();
  await expect(panel.locator('.roster-ready')).toHaveText('成员已就绪');
  await expect(panel.locator('.managed-actor').filter({ hasText: 'alice-home' })).toContainText('alice');
});
