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

test('TC0217 F7 local Claude filter paints installed rows without foreground history UI', async ({ page, request }, testInfo) => {
  await reset(request, 'deep-history', 1736);
  const dense = await request.post('/mock/control/action', {
    data: {
      type: 'dense_progress', channel_id: 'c0', related: false, count: 40,
      target_agent: 'claude', target_count: 3, target_after_noise: true, tail_count: 0,
    },
  });
  expect(dense.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('target claude question 3', { exact: true })).toBeVisible({ timeout: 15_000 });
  const filter = page.getByTitle('只看我与 Claude 的往来');
  await expect(filter).toBeVisible();
  await page.evaluate(() => {
    window.__ATOLL_FILTER_TRACE__ = [];
    const started = performance.now();
    const sample = () => {
      const list = document.querySelector('.timeline-message-list');
      const filterButton = document.querySelector('.timeline-actor-filter button[aria-pressed="true"]');
      window.__ATOLL_FILTER_TRACE__.push({
        at: Math.round(performance.now() - started),
        filtered: Boolean(filterButton),
        claudeRows: [...document.querySelectorAll('[data-presentation-row-id]')]
          .filter((node) => node.textContent?.includes('target claude question')).length,
        foreground: Boolean(document.querySelector('.timeline-history-demand')),
        confirming: [...document.querySelectorAll('.timeline-history-status')]
          .some((node) => node.textContent?.includes('确认频道内容')),
        width: list?.getBoundingClientRect().width || 0,
        height: list?.getBoundingClientRect().height || 0,
      });
      window.__ATOLL_FILTER_RAF__ = requestAnimationFrame(sample);
    };
    window.__ATOLL_FILTER_RAF__ = requestAnimationFrame(sample);
  });
  await filter.click();
  await page.waitForTimeout(350);
  const evidence = await page.evaluate(() => {
    cancelAnimationFrame(window.__ATOLL_FILTER_RAF__);
    return {
      frames: window.__ATOLL_FILTER_TRACE__,
      diagnostics: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event.startsWith('history.')),
    };
  });
  await testInfo.attach('filter-claude-local-rows.json', {
    body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
  });
  const filtered = evidence.frames.filter((frame) => frame.filtered);
  expect(filtered.length).toBeGreaterThan(0);
  expect(filtered[0].claudeRows).toBeGreaterThanOrEqual(3);
  expect(filtered.every((frame) => !frame.foreground && !frame.confirming)).toBe(true);
  expect(Math.max(...filtered.map((frame) => frame.width)) - Math.min(...filtered.map((frame) => frame.width))).toBeLessThanOrEqual(1);
  expect(Math.max(...filtered.map((frame) => frame.height)) - Math.min(...filtered.map((frame) => frame.height))).toBeLessThanOrEqual(1);
});

test('TC0218 F7 Claude filter silently scans nonmatching physical pages until semantic supply', async ({ page, request }, testInfo) => {
  // Sole public owner contract: channel-feed-runtime's physical page loop
  // must publish one history.batch_complete per completed page. The consumer
  // may start projection-underfill, but cannot impersonate completion.
  test.setTimeout(60_000);
  await reset(request, 'deep-history-delayed', 1738);
  const dense = await request.post('/mock/control/action', {
    data: { type: 'dense_progress', channel_id: 'c0', related: false, count: 320, target_agent: 'claude', target_count: 2, tail_count: 20 },
  });
  expect(dense.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('visible tail 20', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());
  await page.getByTitle('只看我与 Claude 的往来').click();
  await expect(page.getByText('target claude question 2', { exact: true })).toBeVisible({ timeout: 30_000 });
  const evidence = await page.evaluate(() => ({
    foreground: Boolean(document.querySelector('.timeline-history-demand')),
    confirming: [...document.querySelectorAll('.timeline-history-status')]
      .some((node) => node.textContent?.includes('确认频道内容')),
    rows: [...document.querySelectorAll('[data-presentation-row-id]')].map((node) => node.textContent),
    diagnostics: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event.startsWith('history.')),
  }));
  const completed = evidence.diagnostics.filter((entry) => (
    entry.event === 'history.batch_complete' && entry.detail?.channelId === 'c0'
  ));
  const completionRefs = completed.map((entry) => String(entry.detail?.ref || ''));
  const duplicateRefs = completionRefs.filter((ref, index) => ref && completionRefs.indexOf(ref) !== index);
  const completionRanges = completed.map((entry) => [
    entry.detail?.scanLowSeq,
    entry.detail?.scanHighSeq,
    entry.detail?.nextBeforeSeq,
  ].join(':'));
  const duplicateRanges = completionRanges.filter((range, index) => (
    range !== '::' && completionRanges.indexOf(range) !== index
  ));
  evidence.physicalCompletion = {
    count: completed.length,
    refs: completionRefs,
    duplicateRefs,
    ranges: completionRanges,
    duplicateRanges,
    coldSnapshotCompletedPages: evidence.diagnostics
      .filter((entry) => entry.event === 'cold_entry.snapshot')
      .at(-1)?.detail?.history?.completedPages ?? null,
  };
  await testInfo.attach('filter-claude-deep-supply.json', {
    body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
  });
  const started = evidence.diagnostics.find((entry) => (
    entry.event === 'history.intent_started' && entry.detail?.reason === 'projection-underfill'
  ));
  expect(started?.detail).toMatchObject({ urgency: 'anticipatory', installedVisibleRows: 0, actorFilterCount: 1 });
  expect(completed.length).toBeGreaterThanOrEqual(2);
  expect(completionRefs.every(Boolean)).toBe(true);
  expect(duplicateRefs).toEqual([]);
  expect(duplicateRanges).toEqual([]);
  expect(evidence.foreground || evidence.confirming).toBe(false);
  expect(evidence.rows.some((text) => text.includes('target claude question 2'))).toBe(true);
});

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

test('TC0221 F7 keyboard Home walks to authoritative history EOF then performs one typed physical top write', async ({ page, request }) => {
  test.setTimeout(60_000);
  await reset(request, 'deep-history', 1721);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  const viewport = page.locator('.timeline-message-list');
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());
  await page.evaluate(() => {
    window.__tc0221ScrollCommands = [];
    const original = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function tc0221ScrollTo(value) {
      if (this.classList?.contains('timeline-message-list')) {
        window.__tc0221ScrollCommands.push({ top: Number(value?.top), behavior: value?.behavior });
      }
      return original.call(this, value);
    };
  });
  await viewport.focus();
  await viewport.evaluate((node) => {
    window.__homeMinScrollTop = node.scrollTop;
    for (const type of ['scroll', 'scrollend']) {
      node.addEventListener(type, () => { window.__homeMinScrollTop = Math.min(window.__homeMinScrollTop, node.scrollTop); }, { passive: true });
    }
  });
  await viewport.press('Home');
  await expect(page.getByText('c0 history 1: ask steward for PONG', { exact: true }))
    .toBeVisible({ timeout: 45_000 });
  await expect.poll(() => viewport.evaluate((node) => Number(node.scrollTop) <= 1), {
    timeout: 15_000,
  }).toBe(true);
  const evidence = await page.evaluate(() => ({
    focused: document.activeElement?.classList?.contains('timeline-message-list') === true,
    scrollTop: Number(document.querySelector('.timeline-message-list')?.scrollTop || 0),
    minScrollTop: Math.round(window.__homeMinScrollTop),
    scrollCommands: window.__tc0221ScrollCommands,
    diagnostics: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event.startsWith('history.')),
  }));
  const started = evidence.diagnostics.filter((entry) => entry.event === 'history.intent_started');
  const homeStarted = started.filter((entry) => entry.detail?.reason === 'history-start');
  expect(homeStarted.length).toBeGreaterThan(0);
  expect(evidence.diagnostics.some((entry) => entry.event === 'history.intent_satisfied'
    && entry.detail?.reason === 'history-start')).toBe(true);
  expect(evidence.focused).toBe(true);
  expect(evidence.scrollTop).toBeLessThanOrEqual(1);
  expect(evidence.minScrollTop).toBeLessThanOrEqual(1);
  expect(evidence.scrollCommands).toEqual([{ top: 0, behavior: 'auto' }]);
});
