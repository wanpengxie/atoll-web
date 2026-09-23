import { expect, test } from '@playwright/test';

async function reset(request, scenario, seed) {
  const response = await request.post('/mock/control/reset', { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

test('FAE-1618 F6-PERF-03/F7 100k ledger keeps bounded production DOM and reveals older rows on upward demand', async ({ page, request }, testInfo) => {
  // This is the old FAE observable: one physical upward gesture must expose
  // older history while the production virtual window remains bounded.
  test.setTimeout(45_000);
  await reset(request, 'huge-history', 1709);
  await login(page);
  await page.waitForFunction(() => {
    const node = document.querySelector('.timeline-message-list');
    return node && node.scrollHeight > node.clientHeight && document.querySelector('.request-text');
  });

  const viewport = page.locator('.timeline-message-list');
  await expect(page.getByText('c0 history 14286: ask steward for PONG', { exact: true })).toBeVisible();
  const mounted = () => page.locator('.timeline-message-list [data-presentation-row-id]').count();
  const oldestShown = () => page.evaluate(() => Math.min(...[...document.querySelectorAll('.timeline-message-list .request-text')]
    .map((node) => Number(/history (\d+):/.exec(node.textContent || '')?.[1] || Infinity))));
  const beforeRows = await mounted();
  const beforeOldest = await oldestShown();
  expect(beforeRows).toBeLessThan(100);

  // Reading upward is ordinary wheel input, several notches: older history
  // arrives and is shown while the mounted window stays bounded.
  await viewport.hover();
  for (let notch = 0; notch < 12; notch += 1) {
    await page.mouse.wheel(0, -2_400);
    await page.waitForTimeout(120);
  }
  await expect.poll(oldestShown, { timeout: 15_000 }).toBeLessThan(beforeOldest);
  const afterRows = await mounted();
  await testInfo.attach('huge-history-upward.json', {
    body: JSON.stringify({ beforeRows, afterRows, beforeOldest, afterOldest: await oldestShown() }, null, 2),
    contentType: 'application/json',
  });
  expect(afterRows).toBeLessThan(100);
});
