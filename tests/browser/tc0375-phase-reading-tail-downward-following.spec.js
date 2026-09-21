import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

const SEED = 0x51_09_18;
const OWNER_SELECTOR = '.timeline-reading-stack > .timeline-reading-layer.is-active > .timeline-message-list';

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'long-running-history', seed: SEED },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

function owner(page) {
  return page.locator(OWNER_SELECTOR);
}

async function metrics(page) {
  return owner(page).evaluate((node) => ({
    scrollTop: Number(node.scrollTop || 0),
    gap: Number(node.scrollHeight || 0) - Number(node.clientHeight || 0) - Number(node.scrollTop || 0),
    mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
  }));
}

async function append(request, text) {
  const response = await request.post(`${MOCK}/mock/control/action`, {
    data: {
      type: 'q_tail_append',
      channel_id: 'c0',
      ask: 'TC0375 tail append',
      text,
    },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

test('TC-0375 downward wheel at the physical tail preserves following and reaches the next append', async ({ page, request }) => {
  test.setTimeout(90_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));

  await page.setViewportSize({ width: 1120, height: 620 });
  await reset(request);
  await login(page);

  const viewport = owner(page);
  await expect(viewport).toHaveCount(1);
  await expect(viewport.locator('[data-presentation-row-id]').last()).toBeVisible();
  await expect.poll(() => metrics(page).then((value) => value.mode)).toBe('following');
  await expect.poll(() => metrics(page).then((value) => value.gap)).toBeLessThanOrEqual(24);

  const before = await metrics(page);
  await viewport.hover();
  await page.mouse.wheel(0, 560);
  await page.waitForTimeout(80);
  const afterInput = await metrics(page);

  expect(afterInput.mode, JSON.stringify({ before, afterInput })).toBe('following');
  expect(afterInput.scrollTop, JSON.stringify({ before, afterInput })).toBe(before.scrollTop);
  expect(afterInput.gap, JSON.stringify({ before, afterInput })).toBeLessThanOrEqual(24);

  const marker = `TC0375 visible append ${Date.now()}`;
  const appended = await append(request, marker);
  const row = page.locator(`[data-presentation-row-id="${appended.request_id}"]`);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(marker);
  await expect.poll(() => metrics(page).then((value) => value.mode)).toBe('following');
  await expect.poll(() => metrics(page).then((value) => value.gap)).toBeLessThanOrEqual(24);
  expect(pageErrors).toEqual([]);
});
