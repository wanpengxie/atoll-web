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

test('audit: distributed sparse matches expose each presentation commit and viewport displacement', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const reset = await request.post('/mock/control/reset', {
    data: { scenario: 'deep-history-delayed', seed: 0x92_30_02 },
  });
  expect(reset.ok()).toBe(true);

  // One matching turn per separated noise island creates several semantic
  // matches across distinct physical history batches instead of one dense tail.
  for (let island = 0; island < 6; island += 1) {
    const response = await request.post('/mock/control/action', {
      data: {
        type: 'dense_progress', channel_id: 'c0', related: false, count: 70,
        target_agent: 'claude', target_count: 1, target_after_noise: true, tail_count: 0,
      },
    });
    expect(response.ok()).toBe(true);
  }

  await login(page);
  await page.evaluate(() => {
    window.__ATOLL_DIAGNOSTICS__.clear();
    const state = { active: true, startedAt: performance.now(), frames: [], reading: [] };
    window.__SPARSE_PAINT_AUDIT__ = state;
    window.__ATOLL_READING_TRACE__ = (entry) => {
      if (['owner-commit', 'row-commit', 'list-height', 'range', 'scroll-observed', 'observation', 'input-owner']
        .includes(entry.stage)) state.reading.push({ ...entry, relativeAt: entry.at - state.startedAt });
    };
    const sample = () => {
      if (!state.active) return;
      const viewport = document.querySelector('.timeline-message-list');
      const viewportRect = viewport?.getBoundingClientRect();
      const rows = [...(viewport?.querySelectorAll('[data-presentation-row-id]') || [])].map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          id: node.dataset.presentationRowId || '',
          top: rect.top - (viewportRect?.top || 0),
          bottom: rect.bottom - (viewportRect?.top || 0),
          target: node.textContent?.includes('target claude question') === true,
        };
      });
      const visible = rows.find((row) => row.bottom > 0.5 && row.top < (viewportRect?.height || 0));
      const status = document.querySelector('.timeline-history-demand');
      const statusRect = status?.getBoundingClientRect();
      state.frames.push({
        at: performance.now() - state.startedAt,
        scrollTop: Number(viewport?.scrollTop || 0),
        scrollHeight: Number(viewport?.scrollHeight || 0),
        clientHeight: Number(viewport?.clientHeight || 0),
        rowIDs: rows.map((row) => row.id),
        targetCount: rows.filter((row) => row.target).length,
        firstVisibleID: visible?.id || '',
        firstVisibleOffset: visible?.top ?? null,
        statusPhase: status?.dataset.phase || '',
        statusTop: statusRect ? statusRect.top - (viewportRect?.top || 0) : null,
        statusHeight: statusRect?.height || 0,
        statusPosition: status ? getComputedStyle(status).position : '',
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  await page.getByTitle('只看我与 Claude 的往来').click();
  const list = page.locator('.timeline-message-list');
  await expect.poll(() => list.locator('[data-presentation-row-id]').count(), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(1);
  await list.hover();
  for (let step = 0; step < 50; step += 1) {
    await page.mouse.wheel(0, -320);
    await page.waitForTimeout(90);
  }
  // Supply may remain in the structural Following owner until its rows exceed
  // the viewport.  Wait for committed semantic growth, not a forced handoff
  // to Virtuoso or a fixed number of simultaneously mounted row elements.
  await expect.poll(() => page.evaluate(() => {
    let count = 0;
    let previous = 0;
    for (const frame of window.__SPARSE_PAINT_AUDIT__.frames) {
      if (frame.targetCount > previous) count += 1;
      previous = frame.targetCount;
    }
    return count;
  }), { timeout: 45_000 }).toBeGreaterThanOrEqual(3);
  await page.waitForTimeout(300);

  const evidence = await page.evaluate(() => {
    const state = window.__SPARSE_PAINT_AUDIT__;
    state.active = false;
    window.__ATOLL_READING_TRACE__ = null;
    return {
      frames: state.frames,
      reading: state.reading,
      diagnostics: window.__ATOLL_DIAGNOSTICS__.snapshot()
        .filter((entry) => entry.event.startsWith('history.')),
    };
  });
  const transitions = [];
  for (let index = 1; index < evidence.frames.length; index += 1) {
    const before = evidence.frames[index - 1];
    const after = evidence.frames[index];
    if (after.targetCount <= before.targetCount) continue;
    const stabilization = evidence.frames.filter((frame) => (
      frame.at >= after.at && frame.at <= after.at + 70
    ));
    const stabilized = stabilization.at(-1) || after;
    transitions.push({
      at: after.at,
      fromCount: before.targetCount,
      toCount: after.targetCount,
      addedIDs: after.rowIDs.filter((id) => !before.rowIDs.includes(id)),
      scrollTopDelta: after.scrollTop - before.scrollTop,
      scrollHeightDelta: after.scrollHeight - before.scrollHeight,
      clientHeightBefore: before.clientHeight,
      clientHeightAfter: after.clientHeight,
      firstVisibleBefore: { id: before.firstVisibleID, offset: before.firstVisibleOffset },
      firstVisibleAfter: { id: after.firstVisibleID, offset: after.firstVisibleOffset },
      stabilizedWithin70ms: {
        scrollTop: stabilized.scrollTop,
        scrollHeight: stabilized.scrollHeight,
        firstVisibleID: stabilized.firstVisibleID,
        firstVisibleOffset: stabilized.firstVisibleOffset,
      },
      statusBefore: { phase: before.statusPhase, top: before.statusTop, height: before.statusHeight },
      statusAfter: { phase: after.statusPhase, top: after.statusTop, height: after.statusHeight },
    });
  }
  const prependCommitsByRevision = new Map();
  for (const entry of evidence.reading) {
    if (entry.stage !== 'owner-commit' || entry.changeKind !== 'prepend'
      || prependCommitsByRevision.has(entry.snapshotRevision)) continue;
    prependCommitsByRevision.set(entry.snapshotRevision, {
      relativeAt: entry.relativeAt,
      snapshotRevision: entry.snapshotRevision,
      rowCount: entry.rowCount,
      firstItemIndex: entry.firstItemIndex,
      firstRowID: entry.firstRowID,
      insertedIDs: entry.insertedIDs,
      scrollTop: entry.scrollTop,
      scrollHeight: entry.scrollHeight,
      clientHeight: entry.clientHeight,
    });
  }
  const uniquePrependCommits = [...prependCommitsByRevision.values()];
  const artifact = {
    capturedAt: new Date().toISOString(),
    sourceDigest: await sourceDigest(),
    transitions,
    intentStarts: evidence.diagnostics.filter((entry) => entry.event === 'history.intent_started'),
    intentSettles: evidence.diagnostics.filter((entry) => /^history\.intent_(satisfied|exhausted)$/.test(entry.event)),
    projectionChecks: evidence.diagnostics.filter((entry) => entry.event === 'history.projection_checked'),
    matchingProjectionChecks: evidence.diagnostics.filter((entry) => (
      entry.event === 'history.projection_checked'
      && Number(entry.detail?.firstVisibleSeq || 0) < Number(entry.detail?.anchorSeq || 0)
    )),
    batches: evidence.diagnostics.filter((entry) => entry.event === 'history.batch_complete'),
    uniquePrependCommits,
    scrollportClientHeights: [...new Set(evidence.frames.map((frame) => frame.clientHeight))],
    statusGeometries: [...new Map(evidence.frames.filter((frame) => frame.statusPhase).map((frame) => [
      `${frame.statusPhase}:${frame.statusPosition}:${frame.statusTop}:${frame.statusHeight}`,
      { phase: frame.statusPhase, position: frame.statusPosition, top: frame.statusTop, height: frame.statusHeight },
    ])).values()],
    ownerCommits: evidence.reading.filter((entry) => entry.stage === 'owner-commit'),
    rowCommits: evidence.reading.filter((entry) => entry.stage === 'row-commit'),
    listHeights: evidence.reading.filter((entry) => entry.stage === 'list-height'),
    frames: evidence.frames,
  };
  const path = testInfo.outputPath('sparse-filter-paint-audit.json');
  await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  await testInfo.attach('sparse-filter-paint-audit.json', { path, contentType: 'application/json' });

  expect(transitions.length).toBeGreaterThanOrEqual(3);
  expect(artifact.intentSettles.filter((entry) => entry.event === 'history.intent_satisfied').length)
    .toBeGreaterThanOrEqual(2);
  expect(artifact.projectionChecks.length).toBeGreaterThanOrEqual(transitions.length);
});
