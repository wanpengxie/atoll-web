import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const SOURCE_PATHS = [
  'src/app/hooks/useChannelFeed.js',
  'src/model/history-scheduler.js',
  'src/ui/timeline/useReadingSession.js',
  'src/ui/Timeline.jsx',
  'src/ui/timeline/LegendMessageList.jsx',
];

async function sourceDigest() {
  const hash = createHash('sha256');
  for (const path of SOURCE_PATHS) hash.update(path).update('\0').update(await readFile(path));
  return hash.digest('hex');
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('.timeline-message-list')).toBeVisible();
}

test('audit: sparse Claude filter preserves rows and commits a durable authoritative EOF boundary', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const reset = await request.post('/mock/control/reset', {
    data: { scenario: 'deep-history-delayed', seed: 0x92_30_01 },
  });
  expect(reset.ok()).toBe(true);
  const dense = await request.post('/mock/control/action', {
    data: {
      type: 'dense_progress', channel_id: 'c0', related: false, count: 320,
      target_agent: 'claude', target_count: 2, target_after_noise: true, tail_count: 20,
    },
  });
  expect(dense.ok()).toBe(true);

  await login(page);
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());
  await page.getByTitle('只看我与 Claude 的往来').click();
  await expect(page.getByText('target claude question 2', { exact: true })).toBeVisible({ timeout: 30_000 });
  const list = page.locator('.timeline-message-list');
  await expect.poll(() => page.evaluate(() => {
    const entries = window.__ATOLL_DIAGNOSTICS__.snapshot();
    const starts = entries.filter((entry) => entry.event === 'history.intent_started' && entry.detail?.reason === 'underfill');
    const last = starts.at(-1);
    if (!last) return false;
    return !entries.some((entry) => entry.event.startsWith('history.intent_')
      && entry.event !== 'history.intent_started' && entry.detail?.epoch === last.detail?.epoch);
  }), { timeout: 20_000 }).toBe(true);

  await page.evaluate(() => {
    window.__ATOLL_DIAGNOSTICS__.clear();
    const state = { active: true, startedAt: performance.now(), frames: [] };
    const statusIDs = new WeakMap();
    let nextStatusID = 0;
    window.__SPARSE_FILTER_AUDIT__ = state;
    const sample = () => {
      if (!state.active) return;
      const viewport = document.querySelector('.timeline-message-list');
      const status = document.querySelector('.timeline-history-demand');
      if (status && !statusIDs.has(status)) statusIDs.set(status, `status-${++nextStatusID}`);
      const rows = [...document.querySelectorAll('[data-presentation-row-id]')];
      const feedback = [...document.querySelectorAll('.timeline-history-status, .timeline-history-boundary, .empty-ledger')]
        .map((node) => node.textContent?.trim() || '').filter(Boolean);
      state.frames.push({
        elapsedMs: performance.now() - state.startedAt,
        scrollTop: viewport?.scrollTop || 0,
        scrollHeight: viewport?.scrollHeight || 0,
        clientHeight: viewport?.clientHeight || 0,
        rowIDs: rows.map((node) => node.dataset.presentationRowId || ''),
        statusID: status ? statusIDs.get(status) : '',
        statusPhase: status?.dataset.phase || '',
        statusRevision: status?.dataset.revision || '',
        statusText: status?.textContent?.trim() || '',
        feedback,
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  await list.hover();
  for (let step = 0; step < 12; step += 1) {
    await page.mouse.wheel(0, -360);
    await page.waitForTimeout(18);
  }
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .some((entry) => entry.event === 'history.intent_exhausted')), { timeout: 60_000 }).toBe(true);
  // Pending acquisition belongs to the transient demand affordance.  Once
  // authoritative EOF is committed, the durable boundary belongs to the
  // reading container and scrolls with the content.
  await expect(page.locator('.timeline-history-boundary[data-phase="exhausted"]'))
    .toContainText('没有更早的符合筛选的往来');

  const promotionCountBeforeRepeat = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .filter((entry) => entry.event === 'history.operation_promoted').length);
  for (let step = 0; step < 12; step += 1) {
    await page.mouse.wheel(0, -360);
    await page.waitForTimeout(18);
  }
  await page.waitForTimeout(250);

  const evidence = await page.evaluate(() => {
    const state = window.__SPARSE_FILTER_AUDIT__;
    state.active = false;
    const diagnostics = window.__ATOLL_DIAGNOSTICS__.snapshot()
      .filter((entry) => entry.event.startsWith('history.'));
    const finalFeedback = [...document.querySelectorAll('.timeline-history-status, .timeline-history-boundary, .empty-ledger')]
      .map((node) => node.textContent?.trim() || '').filter(Boolean);
    return {
      frames: state.frames,
      diagnostics,
      finalFeedback,
      finalRows: [...document.querySelectorAll('[data-presentation-row-id]')]
        .map((node) => ({ id: node.dataset.presentationRowId || '', text: node.textContent?.trim() || '' })),
    };
  });
  const batches = evidence.diagnostics.filter((entry) => entry.event === 'history.batch_complete');
  const promotions = evidence.diagnostics.filter((entry) => entry.event === 'history.operation_promoted');
  const pending = evidence.frames.filter((frame) => frame.statusPhase === 'pending');
  const visibleEOF = evidence.finalFeedback.some((text) => /没有更早|最早|已到顶|已经读完/.test(text));
  const artifact = {
    capturedAt: new Date().toISOString(),
    sourceDigest: await sourceDigest(),
    transientDemandVisible: evidence.frames.some((frame) => frame.statusPhase === 'pending'),
    promotionCountBeforeRepeat,
    promotionCountAfterRepeat: promotions.length,
    batchCount: batches.length,
    batchFrontiers: batches.map((entry) => ({
      beforeSeq: entry.detail?.beforeSeq,
      hasOlder: entry.detail?.hasOlder,
      rows: entry.detail?.rows,
      acceptedRows: entry.detail?.acceptedRows,
    })),
    pendingFrameCount: pending.length,
    pendingStatusIDs: [...new Set(pending.map((frame) => frame.statusID))],
    pendingStatusRevisions: [...new Set(pending.map((frame) => frame.statusRevision))],
    minimumRowsDuringPending: pending.length ? Math.min(...pending.map((frame) => frame.rowIDs.length)) : 0,
    finalRowCount: evidence.finalRows.length,
    finalClaudeRows: evidence.finalRows.filter((row) => row.text.includes('target claude question')).length,
    finalFeedback: evidence.finalFeedback,
    visibleEOF,
    frames: evidence.frames.filter((frame, index, frames) => (
      index === 0
      || frame.statusPhase !== frames[index - 1].statusPhase
      || frame.statusID !== frames[index - 1].statusID
      || frame.statusRevision !== frames[index - 1].statusRevision
      || frame.rowIDs.join('\0') !== frames[index - 1].rowIDs.join('\0')
    )),
    diagnostics: evidence.diagnostics,
  };
  const path = testInfo.outputPath('sparse-filter-scroll-audit.json');
  await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  await testInfo.attach('sparse-filter-scroll-audit.json', { path, contentType: 'application/json' });

  // Sparse semantic scanning is an anticipatory supply obligation.  It keeps
  // the already-readable rows installed and does not impersonate an explicit
  // foreground user wait.
  expect(artifact.transientDemandVisible).toBe(false);
  expect(batches.length).toBeGreaterThanOrEqual(2);
  expect(pending).toHaveLength(0);
  expect(artifact.pendingStatusIDs).toHaveLength(0);
  expect(promotions).toHaveLength(0);
  expect(Math.min(...evidence.frames.map((frame) => frame.rowIDs.length))).toBeGreaterThan(0);
  expect(artifact.finalClaudeRows).toBeGreaterThan(0);
  expect(promotions.length).toBe(promotionCountBeforeRepeat);
  expect(visibleEOF).toBe(true);
});
