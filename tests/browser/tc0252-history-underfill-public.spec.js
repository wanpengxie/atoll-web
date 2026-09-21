import { expect, test } from '@playwright/test';

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('.timeline-message-list')).toBeVisible();
}

function publicSnapshot() {
  const list = document.querySelector('.timeline-message-list');
  const listRect = list?.getBoundingClientRect();
  const rows = [...(list?.querySelectorAll('[data-presentation-row-id]') || [])];
  const visibleRows = rows.filter((row) => {
    const rect = row.getBoundingClientRect();
    return rect.bottom > (listRect?.top || 0) && rect.top < (listRect?.bottom || 0);
  });
  const ids = rows.map((row) => row.getAttribute('data-presentation-row-id') || '');
  return {
    activeLists: document.querySelectorAll('.timeline-reading-layer.is-active .timeline-message-list').length,
    rowCount: rows.length,
    visibleRows: visibleRows.length,
    visibleIDs: visibleRows.map((row) => row.getAttribute('data-presentation-row-id') || ''),
    duplicateIDs: ids.filter((id, index) => id && ids.indexOf(id) !== index),
    historyOneVisible: rows.some((row) => row.textContent?.includes('c0 history 1: ask steward for PONG')),
    pendingDemandVisible: [...document.querySelectorAll('.timeline-history-demand[data-phase="pending"]')]
      .filter((node) => node.getBoundingClientRect().height > 0).length,
    publicStatuses: [...document.querySelectorAll('.timeline-history-status')]
      .filter((node) => node.getBoundingClientRect().height > 0)
      .map((node) => node.textContent || ''),
    falseEmptyVisible: Boolean(document.querySelector('.empty-ledger[data-scope-state="partial"]')),
    scrollTop: Number(list?.scrollTop || 0),
    scrollHeight: Number(list?.scrollHeight || 0),
    clientHeight: Number(list?.clientHeight || 0),
  };
}

test('TC-0252 public underfill keeps the history surface readable until older content appears', async ({ page, request }, testInfo) => {
  const reset = await request.post('/mock/control/reset', {
    data: { scenario: 'deep-history', seed: 0x92_48_03 },
  });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const viewport = page.locator('.timeline-message-list');
  const frames = [];
  let failure = '';
  try {
    await viewport.hover();
    for (let index = 0; index < 32; index += 1) {
      await page.mouse.wheel(0, -1_800);
      await page.waitForTimeout(35);
      frames.push(await page.evaluate(publicSnapshot));
      if (frames.at(-1)?.historyOneVisible) break;
    }

    await expect.poll(() => page.getByText('c0 history 1: ask steward for PONG', { exact: true })
      .isVisible().catch(() => false), { timeout: 15_000, intervals: [100, 250, 500] }).toBe(true);
    const settled = await page.evaluate(publicSnapshot);
    expect(settled.activeLists).toBe(1);
    expect(settled.rowCount).toBeGreaterThan(0);
    expect(settled.visibleRows).toBeGreaterThan(0);
    expect(settled.historyOneVisible).toBe(true);
    expect(settled.duplicateIDs).toEqual([]);
    expect(settled.pendingDemandVisible).toBe(0);
    expect(settled.falseEmptyVisible).toBe(false);
  } catch (error) {
    failure = error?.stack || error?.message || String(error);
    throw error;
  } finally {
    const final = await page.evaluate(publicSnapshot).catch(() => null);
    await testInfo.attach('tc0252-public-underfill.json', {
      body: JSON.stringify({ frames, final, failure }, null, 2),
      contentType: 'application/json',
    });
  }
});
