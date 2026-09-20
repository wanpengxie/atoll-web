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

test('TC0220 F7 a committed under-filled viewport establishes history demand without trusting the initial edge callback', async ({ page, request }, testInfo) => {
  // Sole public owner contract: the committed viewport-coverage branch in
  // useBrowsingReadingController publishes history.viewport_underfilled only
  // after rows, boundaries, attachment, older supply, and bottom readiness.
  await page.setViewportSize({ width: 1280, height: 5_000 });
  await reset(request, 'deep-history', 1720);
  await login(page);
  const preconditionEvidence = await page.evaluate(() => ({
    viewport: (() => {
      const node = document.querySelector('.timeline-message-list');
      return node ? {
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        scrollTop: node.scrollTop,
        rowCount: node.querySelectorAll('[data-presentation-row-id]').length,
      } : null;
    })(),
    relevantDiagnostics: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => [
      'history.viewport_underfilled',
      'history.intent_started',
      'cold_entry.snapshot',
    ].includes(entry.event)),
  }));
  // Keep the first owner boundary observable even when the strict event is
  // absent; the assertion below remains the unmodified contract.
  await testInfo.attach('viewport-coverage-owner.json', {
    body: JSON.stringify(preconditionEvidence, null, 2),
    contentType: 'application/json',
  });
  let replayEvidence = null;
  try {
    await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
      .find((entry) => entry.event === 'history.viewport_underfilled')?.detail || null)).not.toBeNull();
    const detail = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
      .find((entry) => entry.event === 'history.viewport_underfilled')?.detail || null);
    expect(detail.clientHeight).toBeGreaterThan(0);
    expect(detail.scrollHeight).toBeLessThanOrEqual(detail.clientHeight + 1);
    expect(detail.rowCount).toBeGreaterThan(0);
    expect(detail).toMatchObject({ attached: true, messageCurrent: true, bottomReady: true, hasOlder: true });
    await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
      .some((entry) => entry.event === 'history.intent_started'))).toBe(true);

    // The same latest committed coverage may be replayed by layout callbacks,
    // but it must not publish another admission for the same public coverage.
    await page.waitForTimeout(500);
    const events = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
      .filter((entry) => entry.event === 'history.viewport_underfilled'));
    const keyOf = (entry) => JSON.stringify(entry?.detail || {});
    const latestKey = keyOf(events[0]);
    const sameCoverage = events.filter((entry) => keyOf(entry) === latestKey);
    replayEvidence = {
      events,
      latestKey,
      sameCoverageCount: sameCoverage.length,
      intentStarted: await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
        .filter((entry) => entry.event === 'history.intent_started')),
    };
    expect(sameCoverage).toHaveLength(1);
  } finally {
    const evidence = replayEvidence || await page.evaluate(() => ({
      events: window.__ATOLL_DIAGNOSTICS__.snapshot()
        .filter((entry) => entry.event === 'history.viewport_underfilled'),
      intentStarted: window.__ATOLL_DIAGNOSTICS__.snapshot()
        .filter((entry) => entry.event === 'history.intent_started'),
    }));
    await testInfo.attach('viewport-coverage-replay.json', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
  }
});

test('TC0221 F7 keyboard Home creates one physical top demand from the focused main scroller', async ({ page, request }) => {
  await reset(request, 'deep-history', 1721);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  const viewport = page.locator('.timeline-message-list');
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());
  await viewport.focus();
  await viewport.evaluate((node) => {
    window.__homeMinScrollTop = node.scrollTop;
    for (const type of ['scroll', 'scrollend']) {
      node.addEventListener(type, () => { window.__homeMinScrollTop = Math.min(window.__homeMinScrollTop, node.scrollTop); }, { passive: true });
    }
  });
  await viewport.press('Home');
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .filter((entry) => entry.event === 'history.intent_started').length)).toBe(1);
  expect(await page.evaluate(() => Math.round(window.__homeMinScrollTop))).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .some((entry) => entry.event === 'history.intent_satisfied'))).toBe(true);
});
