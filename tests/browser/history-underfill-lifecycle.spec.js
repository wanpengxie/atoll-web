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

async function driveToSettledTopIntent(page, viewport) {
  await viewport.hover();
  for (let index = 0; index < 12; index += 1) {
    await page.mouse.wheel(0, -1_800);
    await page.waitForTimeout(45);
    const settled = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
      entry.event === 'history.intent_satisfied'
      && entry.detail?.reason === 'top'
    )));
    if (settled) return;
  }
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
    entry.event === 'history.intent_satisfied'
    && entry.detail?.reason === 'top'
  )))).toBe(true);
}

async function coldEntry(page) {
  return page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.coldEntry.snapshot());
}

function historyEvidence(entries) {
  return {
    pageEnds: entries.filter((entry) => entry.event === 'wire.page_end'),
    batchCompletions: entries.filter((entry) => entry.event === 'history.batch_complete'),
    admissionCommits: entries.filter((entry) => entry.event === 'history.admission_commit'),
    intentStarts: entries.filter((entry) => entry.event === 'history.intent_started'),
    intentSettles: entries.filter((entry) => entry.event.startsWith('history.intent_')
      && !['history.intent_started'].includes(entry.event)),
  };
}

test('history underfill keeps one demand owner and settles from progress', async ({ page, request }, testInfo) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 0x92_48_03 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());
  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  for (let index = 0; index < 32; index += 1) {
    await page.mouse.wheel(0, -1_800);
    await page.waitForTimeout(20);
    if (await page.getByText('c0 history 1: ask steward for PONG', { exact: true }).isVisible().catch(() => false)) break;
  }
  await page.waitForTimeout(2_000);
  await expect.poll(() => page.locator('.timeline-history-demand[data-phase="pending"]').count()).toBe(0);
  await expect(page.locator('.timeline-history-status', { hasText: '正在确认频道内容' })).toHaveCount(0);

  const evidence = await page.evaluate(() => {
    const entries = window.__ATOLL_DIAGNOSTICS__.snapshot();
    const viewportNode = document.querySelector('.timeline-message-list');
    return {
      historyOneVisible: [...document.querySelectorAll('[data-presentation-row-id]')]
        .some((node) => node.textContent?.includes('c0 history 1: ask steward for PONG')),
      firstPresentationRows: [...document.querySelectorAll('[data-presentation-row-id]')]
        .slice(0, 5).map((node) => ({
          id: node.getAttribute('data-presentation-row-id') || '',
          seqLow: Number(node.querySelector('[data-seq-low]')?.getAttribute('data-seq-low') || 0),
        })),
      viewport: viewportNode ? {
        scrollTop: Number(viewportNode.scrollTop || 0),
        scrollHeight: Number(viewportNode.scrollHeight || 0),
        clientHeight: Number(viewportNode.clientHeight || 0),
      } : null,
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

test('history top continuation is revoked when the reader reverses toward newer rows', async ({ page, request }, testInfo) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 0x92_48_04 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const viewport = page.locator('.timeline-message-list');
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());
  await driveToSettledTopIntent(page, viewport);

  // The settled top request leaves a continuation timer behind. Clear the
  // recorder at the native wheel boundary so any top start below is strictly
  // after the user's opposite-direction input, not a timer that won a race
  // while the test was handing control back to Chromium.
  await page.evaluate(() => {
    document.addEventListener('wheel', () => {
      window.__ATOLL_DIAGNOSTICS__.clear();
    }, { capture: true, once: true });
  });
  await viewport.hover();
  await page.mouse.wheel(0, 1_800);
  await expect.poll(() => viewport.evaluate((node) => Number(node.scrollTop || 0))).toBeGreaterThan(1);
  await page.waitForTimeout(450);

  const evidence = await page.evaluate(() => {
    const node = document.querySelector('.timeline-reading-layer.is-active .timeline-message-list');
    return {
      mode: node?.dataset.readingMode || '',
      scrollTop: Number(node?.scrollTop || 0),
      topStarts: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => (
        entry.event === 'history.intent_started' && entry.detail?.reason === 'top'
      )).length,
      historyEvents: window.__ATOLL_DIAGNOSTICS__.snapshot()
        .filter((entry) => entry.event.startsWith('history.')),
    };
  });
  await testInfo.attach('history-underfill-reverse.json', {
    body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
  });
  expect(evidence.mode).toBe('browsing');
  expect(evidence.scrollTop).toBeGreaterThan(1);
  expect(evidence.topStarts).toBe(0);
});

test('history top continuation is revoked when the reader exits browsing at the tail', async ({ page, request }, testInfo) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 0x92_48_05 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const viewport = page.locator('.timeline-message-list');
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());
  await driveToSettledTopIntent(page, viewport);

  // Reaching the physical tail is the product's real exit from browsing. The
  // old timer must not issue another older request while this newer gesture is
  // installing Following mode.
  await page.evaluate(() => {
    document.addEventListener('wheel', () => {
      window.__ATOLL_DIAGNOSTICS__.clear();
    }, { capture: true, once: true });
  });
  await viewport.hover();
  for (let index = 0; index < 20; index += 1) {
    await page.mouse.wheel(0, 5_000);
    await page.waitForTimeout(40);
    const atTail = await viewport.evaluate((node) => (
      Number(node.scrollHeight || 0) - Number(node.clientHeight || 0) - Number(node.scrollTop || 0) <= 1
    ));
    if (atTail) break;
  }
  await expect.poll(() => viewport.evaluate((node) => (
    Number(node.scrollHeight || 0) - Number(node.clientHeight || 0) - Number(node.scrollTop || 0)
  ))).toBeLessThanOrEqual(1);
  await viewport.hover();
  await page.mouse.wheel(0, 1);
  await page.waitForTimeout(50);
  await viewport.press('End');
  await expect(viewport).toHaveAttribute('data-reading-mode', 'following');
  await page.waitForTimeout(450);

  const evidence = await page.evaluate(() => {
    const node = document.querySelector('.timeline-reading-layer.is-active .timeline-message-list');
    return {
      mode: node?.dataset.readingMode || '',
      tailDistance: node
        ? Number(node.scrollHeight || 0) - Number(node.clientHeight || 0) - Number(node.scrollTop || 0)
        : null,
      topStarts: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => (
        entry.event === 'history.intent_started' && entry.detail?.reason === 'top'
      )).length,
      historyEvents: window.__ATOLL_DIAGNOSTICS__.snapshot()
        .filter((entry) => entry.event.startsWith('history.')),
    };
  });
  await testInfo.attach('history-underfill-exit-browsing.json', {
    body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
  });
  expect(evidence.mode).toBe('following');
  expect(evidence.tailDistance).toBeLessThanOrEqual(1);
  expect(evidence.topStarts).toBe(0);
});

test('TC0223 late page after cancel cannot mutate the current Presentation', async ({ page, request }, testInfo) => {
  const reset = await request.post('/mock/control/reset', {
    data: { scenario: 'deep-history-cancel-late', seed: 0x92_48_07 },
  });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const viewport = page.locator('.timeline-message-list');
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());
  await viewport.hover();
  await page.mouse.wheel(0, -5_000);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
    entry.event === 'history.intent_started' && entry.detail?.reason === 'top'
  )))).toBe(true);
  const beforeCancel = await coldEntry(page);

  // The opposite gesture retires the semantic waiter.  Wait for that local
  // cancellation before clearing diagnostics; the scheduled server page must
  // still arrive afterwards in this scenario.
  await viewport.hover();
  await page.mouse.wheel(0, 1_800);
  await expect.poll(() => viewport.evaluate((node) => Number(node.scrollTop || 0))).toBeGreaterThan(1);
  // Let the opposite gesture cross the local abort and remote cancel call,
  // but stay well inside the 750ms server delay before the forced page.
  await page.waitForTimeout(120);
  const cancellationTrace = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot());
  const atCancel = await coldEntry(page);
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());

  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .filter((entry) => entry.event === 'wire.page_end').length)).toBeGreaterThan(0);
  await page.waitForTimeout(350);
  const afterLatePage = await coldEntry(page);
  const lateTrace = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot());
  const evidence = {
    beforeCancel,
    atCancel,
    afterLatePage,
    cancellationTrace: historyEvidence(cancellationTrace),
    lateTrace: historyEvidence(lateTrace),
  };
  await testInfo.attach('tc0223-late-page-after-cancel.json', {
    body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
  });

  const beforePresentation = atCancel.presentation;
  const afterPresentation = afterLatePage.presentation;
  expect(afterLatePage.history.presentationRevision).toBeGreaterThanOrEqual(
    atCancel.history.presentationRevision,
  );
  expect(afterPresentation.revision).toBe(beforePresentation.revision);
  expect(afterPresentation.sourceRevision).toBe(beforePresentation.sourceRevision);
  expect(afterLatePage.dom.visibleIDs).toEqual(atCancel.dom.visibleIDs);
  expect(evidence.lateTrace.pageEnds.length).toBeGreaterThan(0);
  expect(evidence.lateTrace.admissionCommits).toHaveLength(0);
});

test('TC0223 normal current waiter publishes one late page exactly once', async ({ page, request }, testInfo) => {
  const reset = await request.post('/mock/control/reset', {
    data: { scenario: 'deep-history-cancel-late', seed: 0x92_48_08 },
  });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const viewport = page.locator('.timeline-message-list');
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());
  await viewport.hover();
  await page.mouse.wheel(0, -5_000);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot().some((entry) => (
    entry.event === 'history.intent_started' && entry.detail?.reason === 'top'
  )))).toBe(true);
  const before = await coldEntry(page);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .filter((entry) => entry.event === 'wire.page_end').length)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .filter((entry) => entry.event === 'history.admission_commit').length)).toBe(1);
  await page.waitForTimeout(350);
  const after = await coldEntry(page);
  const entries = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot());
  const evidence = {
    before,
    after,
    trace: historyEvidence(entries),
  };
  await testInfo.attach('tc0223-current-waiter-publish-once.json', {
    body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
  });

  expect(after.presentation.revision).toBeGreaterThan(before.presentation.revision);
  expect(after.presentation.sourceRevision).toBeGreaterThan(before.presentation.sourceRevision);
  expect(after.dom.visibleIDs).not.toEqual(before.dom.visibleIDs);
  expect(evidence.trace.pageEnds).toHaveLength(1);
  expect(evidence.trace.batchCompletions.filter((entry) => (
    entry.detail?.priority === 'foreground'
  ))).toHaveLength(1);
  expect(evidence.trace.admissionCommits).toHaveLength(1);
});
