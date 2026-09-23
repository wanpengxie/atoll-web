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



test('TC0219 F7 empty local Claude filter stays partial while warm history remains silent', async ({ page, request }, testInfo) => {
  // Sole public owner contract: ConversationSurface owns the exact partial
  // and definitive empty-state observables; a demand spinner is not a partial
  // empty-state substitute.
  await reset(request, 'deep-history-delayed', 1737);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true }), { timeout: 15_000 }).toBeVisible();
  const list = page.locator('.timeline-message-list');
  const before = await list.boundingBox();
  await page.getByTitle('只看我与 Claude 的往来').click();
  const partialLocator = page.getByText('当前已加载的动态里没有符合筛选的往来', { exact: true });
  try {
    await expect(partialLocator).toBeVisible();
  } finally {
    await testInfo.attach('filter-claude-partial-owner.json', {
      body: JSON.stringify({
        partialVisible: await partialLocator.isVisible().catch(() => false),
        partialText: '当前已加载的动态里没有符合筛选的往来',
        currentText: await page.locator('.empty-ledger').allTextContents(),
        statusText: await page.locator('.timeline-history-status').allTextContents(),
        diagnostics: await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event.startsWith('history.'))),
      }, null, 2),
      contentType: 'application/json',
    });
  }
  await expect(page.getByText('已扫描到频道开头，没有符合当前成员筛选的往来', { exact: true })).toBeVisible({ timeout: 30_000 });
  const samples = [];
  for (let index = 0; index < 12; index += 1) {
    samples.push(await page.evaluate(() => ({
      partial: Boolean(document.querySelector('.empty-ledger[data-scope-state="partial"]')),
      definitive: [...document.querySelectorAll('.empty-ledger h2')]
        .some((node) => node.textContent === '已扫描到频道开头，没有符合当前成员筛选的往来'),
      foreground: Boolean(document.querySelector('.timeline-history-demand')),
      confirming: [...document.querySelectorAll('.timeline-history-status')]
        .some((node) => node.textContent?.includes('确认频道内容')),
      rect: (() => {
        const box = document.querySelector('.timeline-message-list')?.getBoundingClientRect();
        return box ? { width: box.width, height: box.height } : null;
      })(),
    })));
    await page.waitForTimeout(50);
  }
  const evidence = {
    beforeRect: before,
    samples,
    diagnostics: await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event.startsWith('history.'))),
  };
  await testInfo.attach('filter-claude-empty-eof.json', {
    body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
  });
  expect(samples.every((sample) => sample.definitive && !sample.partial && !sample.foreground && !sample.confirming)).toBe(true);
  expect(samples.every((sample) => sample.rect && Math.abs(sample.rect.width - before.width) <= 1 && Math.abs(sample.rect.height - before.height) <= 1)).toBe(true);
});

test('TC0220 F7 an under-filled viewport with older supply makes visible progress', async ({ page, request }, testInfo) => {
  // User contract: a readable under-filled viewport with older history must
  // acquire more content and become visibly taller. DOM geometry and message
  // content are the contract; diagnostic timing, event counts, and retained
  // observer evidence are intentionally not asserted here.
  // GAP: anticipatory underfill has no public explicit-error owner at this
  // commit; this test does not invent a retry/error state machine.
  await page.setViewportSize({ width: 1280, height: 5_000 });
  await page.addInitScript(() => {
    window.__TC0220_FIRST_UNDERFILL__ = null;
    const sample = () => {
      const node = document.querySelector('.timeline-message-list');
      const rows = [...document.querySelectorAll('[data-presentation-row-id]')];
      if (!window.__TC0220_FIRST_UNDERFILL__ && node && rows.length
        && Number(node.clientHeight) > 0
        && Number(node.scrollHeight) <= Number(node.clientHeight) + 1) {
        window.__TC0220_FIRST_UNDERFILL__ = {
          scrollHeight: Number(node.scrollHeight),
          clientHeight: Number(node.clientHeight),
          rowCount: rows.length,
          firstText: rows[0]?.textContent || '',
          emptyState: Boolean(document.querySelector('.empty-ledger')),
        };
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await reset(request, 'deep-history', 1720);
  await login(page);
  await expect.poll(() => page.evaluate(() => Boolean(window.__TC0220_FIRST_UNDERFILL__)))
    .toBe(true);
  const initial = await page.evaluate(() => window.__TC0220_FIRST_UNDERFILL__);
  expect(initial.clientHeight).toBeGreaterThan(0);
  expect(initial.scrollHeight).toBeLessThanOrEqual(initial.clientHeight + 1);
  expect(initial.rowCount).toBeGreaterThan(0);
  expect(initial.firstText).toContain('c0 history 103: ask steward for PONG');
  expect(initial.emptyState).toBe(false);

  // Seed 1720 starts with a readable tail slice and older supply. The first
  // older page exposes history 101 in the current visible window; this is a
  // user-visible content assertion, not a scheduler or diagnostic assertion.
  await expect(page.getByText('c0 history 101: ask steward for PONG', { exact: true }))
    .toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate((rowCount) => {
    const node = document.querySelector('.timeline-message-list');
    return Boolean(node
      && Number(node.scrollHeight) > Number(node.clientHeight) + 1
      && document.querySelectorAll('[data-presentation-row-id]').length > rowCount
      && !document.querySelector('.empty-ledger'));
  }, initial.rowCount)).toBe(true);

  const final = await page.evaluate(() => {
    const node = document.querySelector('.timeline-message-list');
    const rows = [...document.querySelectorAll('[data-presentation-row-id]')];
    return {
      scrollHeight: Number(node?.scrollHeight || 0),
      clientHeight: Number(node?.clientHeight || 0),
      rowCount: rows.length,
      firstText: rows[0]?.textContent || '',
      olderContentVisible: rows.some((row) => row.textContent?.includes('c0 history 101: ask steward for PONG')),
      emptyState: Boolean(document.querySelector('.empty-ledger')),
    };
  });
  await testInfo.attach('tc0220-user-content-progress.json', {
    body: JSON.stringify({ initial, final }, null, 2),
    contentType: 'application/json',
  });
  expect(final.scrollHeight).toBeGreaterThan(final.clientHeight + 1);
  expect(final.rowCount).toBeGreaterThan(initial.rowCount);
  expect(final.firstText).not.toBe(initial.firstText);
  expect(final.olderContentVisible).toBe(true);
  expect(final.emptyState).toBe(false);
});

