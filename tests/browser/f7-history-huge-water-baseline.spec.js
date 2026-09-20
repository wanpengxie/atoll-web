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
  const beforeRows = await page.locator('.timeline-virtual-item').count();
  expect(beforeRows).toBeLessThan(100);
  await testInfo.attach('huge-history-before-demand.json', {
    body: JSON.stringify({
      beforeRows,
      diagnostics: await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event.startsWith('history.'))),
    }, null, 2),
    contentType: 'application/json',
  });

  // Exactly one gesture. A prefetched batch may be ready or still in flight;
  // either path must satisfy the same public demand contract.
  await viewport.hover();
  await page.mouse.wheel(0, -100_000);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .some((entry) => entry.event === 'history.intent_started'))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
    entry.event === 'history.intent_satisfied'
  ))), { timeout: 5_000 }).toBe(true);

  const afterRows = await page.locator('.timeline-virtual-item').count();
  const evidence = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('[data-presentation-row-id]')].map((node) => node.textContent),
    diagnostics: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event.startsWith('history.')),
  }));
  await testInfo.attach('huge-history-after-demand.json', {
    body: JSON.stringify({ afterRows, ...evidence }, null, 2),
    contentType: 'application/json',
  });
  expect(afterRows).toBeLessThan(100);
});
