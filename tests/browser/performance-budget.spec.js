import { expect, test } from '@playwright/test';

async function reset(request, scenario, seed) {
  const response = await request.post('/mock/control/reset', { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function login(page, path = '/') {
  await page.goto(path);
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.getByRole('region', { name: '频道动态' })).toBeVisible();
}

async function renderedRows(page) {
  return page.locator('[data-presentation-row-id]').count();
}

test('huge ledger paints the latest message before and after reload with a bounded rendered window', async ({ page, request }) => {
  test.setTimeout(60_000);
  await reset(request, 'huge-history', 98101);

  const coldStartedAt = Date.now();
  await login(page);
  const latest = page.getByText('c0 history 14286: ask steward for PONG', { exact: true });
  await expect(latest).toBeVisible();
  expect(Date.now() - coldStartedAt).toBeLessThan(15_000);
  expect(await renderedRows(page)).toBeLessThan(100);

  const warmStartedAt = Date.now();
  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(latest).toBeVisible();
  expect(Date.now() - warmStartedAt).toBeLessThan(8_000);
  expect(await renderedRows(page)).toBeLessThan(100);
});

test('a full waiting queue remains visible and operable', async ({ page, request }) => {
  test.setTimeout(60_000);
  await reset(request, 'long-running', 98102);
  await login(page);

  const editor = page.getByRole('textbox', { name: '消息' });
  await page.getByLabel('目标 Agent').selectOption('steward');
  await editor.fill('performance active task');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('[data-presentation-row-id]').filter({ hasText: 'performance active task' })).toBeVisible();

  for (let index = 1; index <= 8; index += 1) {
    await editor.fill(`performance queued task ${index}`);
    await page.getByRole('button', { name: '发送', exact: true }).click();
  }

  const waiting = page.getByRole('region', { name: '等待区' });
  await expect(waiting.locator('.agent-wait-item')).toHaveCount(8);
  await waiting.getByRole('button', { name: '收起' }).click();
  await expect(waiting).toContainText('8 条等待消息');
  await waiting.getByRole('button', { name: '展开' }).click();
  await expect(waiting.locator('.agent-wait-item')).toHaveCount(8);
});

test('mobile repeated history browsing keeps content visible and the rendered window bounded', async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await reset(request, 'huge-history', 98103);
  await login(page, '/?perf=mobile');
  await expect(page.locator('[data-presentation-row-id]:visible').last()).not.toHaveText('');

  const timeline = page.getByRole('region', { name: '频道动态' });
  await timeline.hover();
  for (let index = 0; index < 20; index += 1) {
    await page.mouse.wheel(0, -4_000);
    await page.waitForTimeout(40);
  }

  await expect(page.locator('[data-presentation-row-id]:visible').first()).toContainText('c0 history');
  expect(await renderedRows(page)).toBeLessThan(100);
});
