import { expect, test } from '@playwright/test';

async function reset(request, seed) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'deep-history-delayed', seed },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('.timeline-message-list')).toBeVisible();
}

function visibleRows(page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-presentation-row-id]')]
    .map((node) => ({
      id: node.getAttribute('data-presentation-row-id') || '',
      seq: Number(node.querySelector('[data-seq-low]')?.getAttribute('data-seq-low') || 0),
    }))
    .filter((row) => row.id && row.seq > 0));
}

test('SZ-282 history progression keeps pending feedback and stable unique visible order', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  await reset(request, 0x282_61);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true }))
    .toBeVisible({ timeout: 20_000 });

  const viewport = page.locator('.timeline-message-list');
  const initialRows = await visibleRows(page);
  const initialMinSeq = Math.min(...initialRows.map((row) => row.seq));
  expect(initialRows.length).toBeGreaterThan(0);
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());
  await viewport.hover();
  await page.mouse.wheel(0, -5_000);

  // The delayed page keeps the public demand in pending while the existing
  // tail remains readable. The selector is a UI contract, not a scheduler
  // event or private history field.
  await expect.poll(() => page.locator('.timeline-history-demand[data-phase="pending"]').count(), {
    timeout: 10_000,
  }).toBeGreaterThan(0);
  const pendingRows = await visibleRows(page);
  expect(pendingRows.length).toBeGreaterThan(0);

  // A delayed page must add an older public row, not only settle a private
  // operation. One wheel/page is enough for this successor; deeper pages are
  // covered by the public unit contract without depending on timing.
  await expect.poll(async () => {
    const rows = await visibleRows(page);
    return rows.some((row) => row.seq < initialMinSeq);
  }, { timeout: 15_000 }).toBe(true);
  await expect.poll(() => page.locator('.timeline-history-demand[data-phase="pending"]').count(), {
    timeout: 15_000,
  }).toBe(0);

  const settledRows = await visibleRows(page);
  const ids = settledRows.map((row) => row.id);
  const seqs = settledRows.map((row) => row.seq);
  const sorted = [...seqs].sort((left, right) => left - right);
  const diagnostics = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .filter((entry) => entry.event.startsWith('history.')));
  const evidence = { initialRows, pendingRows, settledRows, diagnostics };
  await testInfo.attach('sz282-history-progression.json', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });

  expect(new Set(ids).size).toBe(ids.length);
  expect(seqs).toEqual(sorted);
  expect(Math.min(...seqs)).toBeLessThan(initialMinSeq);
  expect(diagnostics.some((entry) => entry.event === 'history.intent_satisfied'
    || entry.event === 'history.intent_exhausted')).toBe(true);
});
