import { expect, test } from '@playwright/test';

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

async function chooseSteward(page) {
  const choose = page.getByRole('button', { name: '选择 Agent' });
  await expect(choose).toBeVisible();
  await choose.click();
  await page.getByRole('menu', { name: '选择目标 Agent' })
    .getByRole('menuitem', { name: 'steward' }).click();
}

async function startLongTask(page, text) {
  const editor = page.getByRole('textbox', { name: '消息', exact: true });
  await chooseSteward(page);
  await editor.fill(text);
  await editor.press('Enter');
  await expect(page.locator('.channel-agent-timer')).toHaveCount(1);
}

async function advanceComputation(request, count = 1) {
  for (let index = 0; index < count; index += 1) {
    const advanced = await request.post('/mock/control/advance', { data: { ms: 0, compute: { channel_id: 'c0' } } });
    expect(advanced.ok()).toBe(true);
  }
}

test('F7 inactive-channel business and core progress never create rail or new-dynamic counts', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'multi-channel', seed: 2620 } });
  expect(reset.ok()).toBe(true);
  await login(page);

  const project = page.locator('.channel-item').filter({ hasText: 'c0.project' });
  for (let index = 0; index < 20; index += 1) {
    const response = await request.post('/mock/control/action', {
      data: {
        type: 'push_provisional', channel_id: 'c0.project',
        request_id: `c0.project-history-request-${index % 2 + 1}`,
        status: 'provider.waiting', payload: { step: index + 1 },
      },
    });
    expect(response.ok()).toBe(true);
  }
  const dense = await request.post('/mock/control/action', {
    data: { type: 'dense_progress', channel_id: 'c0.project', count: 40 },
  });
  expect(dense.ok()).toBe(true);

  await expect(project.locator('.unread-related')).toHaveCount(0);
  await expect(project.locator('.unread-total:not(.unread-pending)')).toHaveCount(0);
  await project.click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.getByRole('button', { name: /条新动态/ })).toHaveCount(0);
  await expect(project.locator('.unread-related')).toHaveCount(0);
  await expect(project.locator('.unread-total:not(.unread-pending)')).toHaveCount(0);
});

test('F7 channel rail exposes live Agent timers across channels and clears on completion', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'long-running', seed: 2610 } });
  expect(reset.ok()).toBe(true);
  await login(page);

  await startLongTask(page, '验证跨频道运行通知');

  const home = page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0$/ }) });
  await expect(home.locator('.channel-agent-timer')).toHaveCount(1);
  const project = page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0\.project$/ }) });
  await project.click();
  await expect(home.locator('.channel-agent-timer')).toHaveCount(1);
  await home.click();

  await advanceComputation(request, 3);
  await expect(home.locator('.channel-agent-timer')).toHaveCount(0);
});

test('F7 server boot change cannot leave a zombie Agent timer', async ({ page, request }) => {
  let response = await request.post('/mock/control/reset', { data: { scenario: 'long-running', seed: 2611 } });
  expect(response.ok()).toBe(true);
  await login(page);
  await startLongTask(page, '后端重启前的长任务');

  response = await request.post('/mock/control/reset', { data: { scenario: 'multi-channel', seed: 2612 } });
  expect(response.ok()).toBe(true);
  response = await request.post('/mock/control/action', { data: { type: 'drop' } });
  expect(response.ok()).toBe(true);
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/, { timeout: 15_000 });
  await expect(page.locator('.channel-agent-timer')).toHaveCount(0);
});

test('F7 unresolved history after a same-boot reload stays quiet until fresh live progress', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'long-running', seed: 2613 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await startLongTask(page, '刷新前保持运行但不制造僵尸');

  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('.channel-agent-timer')).toHaveCount(0);

  // The task really is still alive: one new live progress frame confirms the
  // current generation and restores the timer.
  await advanceComputation(request);
  await expect(page.locator('.channel-agent-timer')).toHaveCount(1);
});

test('F7 completion during a same-boot disconnect clears the live timer', async ({ page, request }) => {
  let response = await request.post('/mock/control/reset', { data: { scenario: 'long-running', seed: 2614 } });
  expect(response.ok()).toBe(true);
  await login(page);
  await startLongTask(page, '断线期间完成的任务');

  response = await request.post('/mock/control/action', { data: { type: 'drop' } });
  expect(response.ok()).toBe(true);
  await expect(page.locator('.connection-state')).toHaveClass(/state-reconnecting/);
  await advanceComputation(request, 3);
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/, { timeout: 15_000 });
  await expect(page.locator('.channel-agent-timer')).toHaveCount(0);
});
