import { expect, test } from '@playwright/test';

const SEED = 0x51_09_18;

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'long-running-history', seed: SEED },
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

async function append(request, index) {
  const response = await request.post('/mock/control/action', {
    data: {
      type: 'q_tail_append',
      channel_id: 'c0',
      ask: `TC0357 tail ${index}`,
      text: `TC0357 tail ${index} ${'mixed-height content '.repeat((index % 5 + 1) * 8)}`,
    },
  });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.request_id).toBeTruthy();
  return body;
}

async function tailState(page) {
  return page.locator('.timeline-message-list').evaluate((node) => ({
    gap: Number((node.scrollHeight - node.clientHeight - node.scrollTop).toFixed(2)),
    mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
  }));
}

test('TC-0357 wheel down from browsing returns to the visible live tail', async ({ page, request }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1120, height: 620 });
  await reset(request);
  await login(page);

  const appended = [];
  for (let index = 0; index < 12; index += 1) {
    appended.push(await append(request, index));
  }
  const newest = appended.at(-1);
  await expect(page.locator(`[data-presentation-row-id="${newest.request_id}"]`)).toHaveCount(1);
  await expect.poll(() => tailState(page).then((state) => state.mode)).toBe('following');

  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  await page.mouse.wheel(0, -260);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  await expect.poll(() => tailState(page).then((state) => state.gap)).toBeGreaterThan(24);

  for (let step = 0; step < 14; step += 1) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(90);
  }

  await expect.poll(() => tailState(page).then((state) => state.mode), { timeout: 15_000 }).toBe('following');
  await expect.poll(() => tailState(page).then((state) => state.gap), { timeout: 15_000 }).toBeLessThanOrEqual(24);
  await expect(page.locator(`[data-presentation-row-id="${newest.request_id}"]`)).toBeVisible();
});
