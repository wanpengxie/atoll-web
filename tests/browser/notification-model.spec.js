import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function login(page, request, reset = true) {
  if (reset) {
    const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario: 'mixed-height-history', seed: 4501 } });
    expect(response.ok()).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const account = page.getByRole('textbox', { name: '账号', exact: true });
  if (await account.count()) {
    await account.fill('root');
    await page.getByLabel('密码').fill('root');
    await page.getByRole('button', { name: '进入 Atoll' }).click();
  }
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('.timeline-message-list [data-presentation-row-id]:visible').first()).toBeVisible();
}

async function hoverList(page) {
  const box = await page.locator('.timeline-message-list').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

test('history loaded by scrolling up is never a new message', async ({ page, request }) => {
  await login(page, request);
  await page.evaluate(() => {
    window.__notices = [];
    const tick = () => {
      const notice = document.querySelector('.timeline-jump-latest:not(.timeline-jump-bottom)');
      if (notice) window.__notices.push(notice.textContent);
      window.__raf = requestAnimationFrame(tick);
    };
    tick();
  });
  await hoverList(page);
  for (let i = 0; i < 40; i += 1) {
    await page.mouse.wheel(0, -900);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(800);
  const notices = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__notices; });
  expect(notices).toEqual([]);
});

test('a message from someone else while browsing is new until it is scrolled into view', async ({ page, request }) => {
  await login(page, request);
  await hoverList(page);
  for (let i = 0; i < 6; i += 1) { await page.mouse.wheel(0, -600); await page.waitForTimeout(60); }
  await page.waitForTimeout(600);
  await request.post(`${MOCK}/mock/control/action`, { data: { type: 'approval', channel_id: 'c0' } });
  const notice = page.locator('.timeline-jump-latest:not(.timeline-jump-bottom)');
  await expect(notice).toContainText('1 条新动态');
  // Reading it by scrolling back down clears it.
  for (let i = 0; i < 12; i += 1) { await page.mouse.wheel(0, 900); await page.waitForTimeout(60); }
  await expect(notice).toHaveCount(0);
});

test('another channel shows a rail badge that survives reload and clears once read', async ({ page, request }) => {
  await login(page, request);
  const project = page.locator('.channel-item', { hasText: 'c0.project' });
  await request.post(`${MOCK}/mock/control/action`, { data: { type: 'approval', channel_id: 'c0.project' } });
  await expect(project.locator('.unread-badge')).toBeVisible();
  const before = (await project.locator('.unread-badge').first().textContent()).trim();

  await page.reload();
  await login(page, request, false);
  await expect(project.locator('.unread-badge').first()).toHaveText(before);

  await project.click();
  await expect(project.locator('.unread-badge')).toHaveCount(0, { timeout: 10_000 });
});
