import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function login(page, request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario: 'extreme-height-history', seed: 4202 } });
  expect(response.ok()).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('.timeline-message-list [data-presentation-row-id]:visible').first()).toBeVisible();
}

const visibleToggles = (page) => page.locator('.timeline-message-list .message-fold-toggle:visible');

test('long messages open collapsed; an expansion lasts for the page, not across a reload', async ({ page, request }) => {
  await login(page, request);
  // Scroll away from the newest row so only middle messages are on screen.
  const box = await page.locator('.timeline-message-list').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const toggles = visibleToggles(page);
  for (let i = 0; i < 200 && !(await toggles.first().isVisible()); i += 1) {
    await page.mouse.wheel(0, -500);
    await page.waitForTimeout(80);
  }
  await expect(toggles.first()).toBeVisible();
  const states = await toggles.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-expanded')));
  expect(states.every((value) => value === 'false')).toBe(true);

  const target = toggles.first();
  const foldID = await target.getAttribute('data-fold-id');
  await target.click();
  const byID = page.locator(`.message-fold-toggle[data-fold-id="${foldID}"]`);
  await expect(byID).toHaveAttribute('aria-expanded', 'true');

  // Another channel and back: still the reader's choice on this page.
  await page.getByRole('button', { name: /c0\.project/ }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /^# ?c0$|^c0$/ }).first().click().catch(async () => {
    await page.locator('text=c0').first().click();
  });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => localStorage.getItem(Object.keys(localStorage).find((key) => key.startsWith('atoll.view-session')) || '') || ''))
    .not.toContain(foldID);

  // Reload: nothing about that message survives.
  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  const after = await page.locator('.timeline-message-list .message-fold-toggle')
    .evaluateAll((nodes) => nodes.map((node) => [node.getAttribute('data-fold-id'), node.getAttribute('aria-expanded')]));
  expect(after.filter(([id, expanded]) => id === foldID && expanded === 'true')).toEqual([]);
});
