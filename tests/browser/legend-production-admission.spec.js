import { expect, test } from '@playwright/test';

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('.timeline-message-list')).toBeVisible();
}

test('production list keeps a browsing anchor when a mounted row below it grows', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1120, height: 700 });
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'long-running-history', seed: 0x92_19_02 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  const list = page.locator('.timeline-message-list');
  await list.hover();
  // Leaving the tail is ordinary reading up: a few notches, until browsing holds.
  for (let notch = 0; notch < 6; notch += 1) {
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(250);
    if (await page.locator('.timeline').getAttribute('data-viewport-mode') === 'browsing') break;
  }
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  // Virtuoso keeps measured rows mounted outside the viewport with
  // `visibility:hidden`; `.first()` therefore selects an off-screen shell and
  // never exercises the user-visible anchor contract. Select the first
  // mounted conversation row whose public box intersects the actual scroller.
  const anchorID = await list.evaluate((root) => {
    const viewport = root.getBoundingClientRect();
    return [...root.querySelectorAll('[data-presentation-row-id]')]
      .find((node) => {
        const rect = node.getBoundingClientRect();
        return node.querySelector('.agent-conversation-turn')
          && getComputedStyle(node).visibility !== 'hidden'
          && rect.bottom > viewport.top
          && rect.top < viewport.bottom;
      })?.getAttribute('data-presentation-row-id') || '';
  });
  expect(anchorID).not.toBe('');
  const anchor = list.locator(`[data-presentation-row-id="${anchorID}"]`);
  await expect(anchor).toBeVisible();
  const before = await anchor.boundingBox();
  const created = await request.post('/mock/control/action', { data: { type: 'dense_progress', channel_id: 'c0', count: 1 } });
  expect(created.ok()).toBe(true);
  const body = await created.json();
  const terminal = await request.post('/mock/control/action', { data: { type: 'push_terminal', channel_id: 'c0', request_id: body.request_id, payload: { text: 'mounted row growth ' + '正文 '.repeat(100) } } });
  expect(terminal.ok()).toBe(true);
  await page.waitForTimeout(700);
  const after = await anchor.boundingBox();
  const evidence = await page.evaluate(() => ({
    mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
    blank: [...document.querySelectorAll('.timeline-message-list [data-presentation-row-id]')].filter((node) => {
      const rect = node.getBoundingClientRect(); const root = document.querySelector('.timeline-message-list').getBoundingClientRect(); return rect.bottom > root.top && rect.top < root.bottom;
    }).length === 0,
  }));
  await testInfo.attach('production-admission-anchor.json', { body: JSON.stringify({ before, after, evidence }, null, 2), contentType: 'application/json' });
  expect(evidence.mode).toBe('browsing');
  expect(evidence.blank).toBe(false);
  expect(after).not.toBeNull();
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
});
