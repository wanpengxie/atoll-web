import { expect, test } from '@playwright/test';

// This used to render a private scheduler fixture.  The contract belongs to
// the real history consumer: an underfilled/filtered view may ask for more
// supply, but must not show a false empty state or duplicate requests.

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('.timeline-message-list')).toBeVisible();
}

test('history underfill keeps one demand owner and settles from progress', async ({ page, request }, testInfo) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 0x92_48_03 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());
  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  for (let index = 0; index < 12; index += 1) {
    await page.mouse.wheel(0, -1_800);
    await page.waitForTimeout(45);
  }
  await page.waitForTimeout(1_000);
  await expect.poll(() => page.locator('.timeline-history-demand[data-phase="pending"]').count()).toBe(0);
  await expect(page.locator('.timeline-history-status', { hasText: '正在确认频道内容' })).toHaveCount(0);

  const evidence = await page.evaluate(() => {
    const entries = window.__ATOLL_DIAGNOSTICS__.snapshot();
    return {
      historyOneVisible: [...document.querySelectorAll('[data-presentation-row-id]')]
        .some((node) => node.textContent?.includes('c0 history 1: ask steward for PONG')),
      statuses: [...document.querySelectorAll('.timeline-history-status')].map((node) => node.textContent || ''),
      demand: document.querySelector('.timeline-history-demand')?.dataset.phase || 'idle',
      starts: entries.filter((entry) => entry.event === 'history.intent_started').length,
      settles: entries.filter((entry) => entry.event === 'history.intent_satisfied' || entry.event === 'history.intent_exhausted').length,
      pending: entries.filter((entry) => entry.event === 'history.intent_failed').length,
    };
  });
  await testInfo.attach('history-underfill-lifecycle.json', {
    body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
  });
  expect(evidence.historyOneVisible).toBe(true);
  expect(evidence.demand).toBe('idle');
  expect(evidence.pending).toBe(0);
  expect(evidence.settles).toBeGreaterThan(0);
});
