import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function login(page, request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario: 'mixed-height-history', seed: 4203 } });
  expect(response.ok()).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('.timeline-message-list [data-presentation-row-id]:visible').first()).toBeVisible();
}

const gap = (page) => page.evaluate(() => {
  const scroller = document.querySelector('.timeline-message-list');
  return scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
});

test('back-to-bottom appears only far from the bottom and yields to new arrivals', async ({ page, request }) => {
  await login(page, request);
  const jumpBottom = page.getByRole('button', { name: '回到最底部' });
  const box = await page.locator('.timeline-message-list').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // One screen up: browsing, but not far — no affordance yet.
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(500);
  await expect(jumpBottom).toHaveCount(0);

  for (let i = 0; i < 20 && (await jumpBottom.count()) === 0; i += 1) {
    await page.mouse.wheel(0, -900);
    await page.waitForTimeout(120);
  }
  await expect(jumpBottom).toBeVisible();

  // A new arrival takes the slot.
  await request.post(`${MOCK}/mock/control/action`, { data: { type: 'approval', channel_id: 'c0' } });
  await expect(page.locator('.timeline-jump-latest')).toContainText('1 条新动态');
  await expect(jumpBottom).toHaveCount(0);
  await page.locator('.timeline-jump-latest').click();
  await expect.poll(() => gap(page)).toBeLessThanOrEqual(24);

  // Far up again, then the affordance returns and takes the reader home.
  for (let i = 0; i < 20 && (await jumpBottom.count()) === 0; i += 1) {
    await page.mouse.wheel(0, -900);
    await page.waitForTimeout(120);
  }
  await jumpBottom.click();
  await expect.poll(() => gap(page)).toBeLessThanOrEqual(24);
  await expect(jumpBottom).toHaveCount(0);
});

test('scope controls and the recent tab never sit over the files split', async ({ page, request }) => {
  await login(page, request);
  await page.getByRole('button', { name: /文件/ }).first().click();
  await page.waitForTimeout(600);
  const overlap = await page.evaluate(() => {
    const rect = (node) => node?.getBoundingClientRect();
    const pane = rect(document.querySelector('.dynamic-message-pane'));
    const scope = rect(document.querySelector('.timeline-scope-bar'));
    const recent = rect(document.querySelector('.reading-history-edge-tab'));
    const firstRow = rect(document.querySelector('.timeline-message-list'));
    return {
      scopeInsidePane: !scope || (scope.left >= pane.left - 1 && scope.right <= pane.right + 1),
      scopeAboveList: !scope || scope.bottom <= firstRow.top + 1,
      recentInsidePane: !recent || recent.right <= pane.right + 1,
    };
  });
  await page.screenshot({ path: 'test-results/files-split-controls.png' });
  expect(overlap).toEqual({ scopeInsidePane: true, scopeAboveList: true, recentInsidePane: true });
});
