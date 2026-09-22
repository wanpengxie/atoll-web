import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function login(page, request, scenario) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed: 4201 } });
  expect(response.ok()).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('.timeline-message-list [data-presentation-row-id]:visible').first()).toBeVisible();
}

function metrics(page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('.timeline-message-list');
    const top = scroller.getBoundingClientRect().top;
    const bottom = scroller.getBoundingClientRect().bottom;
    // Rows the vendor is still measuring are mounted but not visible; only a
    // row actually painted inside the viewport can be the reader's anchor.
    const rows = [...scroller.querySelectorAll('[data-presentation-row-id]')].filter((row) => {
      const rect = row.getBoundingClientRect();
      const style = getComputedStyle(row.closest('[data-index]') || row);
      return rect.height > 0 && style.visibility !== 'hidden' && rect.bottom > top + 1 && rect.top < bottom - 1;
    });
    const anchor = rows[0];
    return {
      gap: scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
      rows: rows.length,
      lastID: rows.at(-1)?.dataset.presentationRowId || '',
      anchorID: anchor?.dataset.presentationRowId || '',
      anchorTop: anchor ? anchor.getBoundingClientRect().top - top : null,
    };
  });
}

async function hoverList(page) {
  const box = await page.locator('.timeline-message-list').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

for (const scenario of ['mixed-height-history', 'deep-history-delayed']) {
  test(`${scenario}: continuous upward reading reaches the channel start without a jump`, async ({ page, request }) => {
    test.setTimeout(120_000);
    await login(page, request, scenario);
    const opened = await metrics(page);
    expect(opened.gap).toBeLessThanOrEqual(24);
    await hoverList(page);
    const boundary = page.locator('.timeline-history-boundary');
    let jumps = 0;
    let steps = 0;
    while (!(await boundary.isVisible()) && steps < 400) {
      steps += 1;
      await page.mouse.wheel(0, -700);
      await page.waitForTimeout(40);
      // With no further input the reader's row must not move, whatever
      // arrives above it in the meantime.
      const before = await metrics(page);
      await page.waitForTimeout(scenario === 'deep-history-delayed' ? 300 : 120);
      const after = await metrics(page);
      if (before.anchorID && before.anchorID === after.anchorID
        && Math.abs(after.anchorTop - before.anchorTop) > 2) {
        jumps += 1;
        console.log('jump', before, after);
      }
    }
    await expect(boundary).toBeVisible();
    expect(jumps).toBe(0);
    console.log(`${scenario}: reached start in ${steps} wheel steps`);
  });
}

test('following sticks to new rows; browsing counts them and keeps its place', async ({ page, request }) => {
  await login(page, request, 'mixed-height-history');
  const push = () => request.post(`${MOCK}/mock/control/action`, { data: { type: 'approval', channel_id: 'c0' } });

  const start = await metrics(page);
  expect(start.gap).toBeLessThanOrEqual(24);
  await push();
  await expect.poll(async () => (await metrics(page)).lastID).not.toBe(start.lastID);
  await expect.poll(async () => (await metrics(page)).gap).toBeLessThanOrEqual(24);

  await hoverList(page);
  for (let i = 0; i < 6; i += 1) {
    await page.mouse.wheel(0, -500);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(600);
  const browsing = await metrics(page);
  expect(browsing.gap).toBeGreaterThan(200);
  await push();
  const jump = page.locator('.timeline-jump-latest');
  await expect(jump).toContainText('1 条新动态');
  const held = await metrics(page);
  expect(held.anchorID).toBe(browsing.anchorID);
  expect(Math.abs(held.anchorTop - browsing.anchorTop)).toBeLessThanOrEqual(2);

  await jump.click();
  await expect.poll(async () => (await metrics(page)).gap).toBeLessThanOrEqual(24);
  await expect(jump).toHaveCount(0);
});

for (const [mode, count] of [['reject', 3], ['drop', 1]]) {
  test(`a ${mode}ed older page recovers at the top with no further input`, async ({ page, request }) => {
    test.setTimeout(120_000);
    await login(page, request, 'mixed-height-history');
    await request.post(`${MOCK}/mock/control/fault`, { data: { target: 'history', mode, count } });
    await hoverList(page);
    // Scroll hard to the top once, then stop touching the page.
    for (let i = 0; i < 12; i += 1) {
      await page.mouse.wheel(0, -2000);
      await page.waitForTimeout(30);
    }
    await page.mouse.move(0, 0);
    const stalled = await metrics(page);
    if (mode === 'reject') {
      await expect(page.locator('.timeline-history-demand[data-phase="error"]')).toContainText('正在重试');
    }
    // Recovery is the scheduler's: more rows arrive above without any input.
    await expect.poll(async () => (await metrics(page)).scrollHeight, { timeout: 60_000 })
      .toBeGreaterThan(stalled.scrollHeight);
    await expect(page.locator('.timeline-history-demand[data-phase="error"]')).toHaveCount(0, { timeout: 30_000 });
  });
}
