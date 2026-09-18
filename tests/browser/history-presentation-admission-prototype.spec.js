import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const SOURCE_PATHS = [
  'src/model/history-presentation-admission.js',
  'src/app/hooks/useChannelFeed.js',
  'src/model/timeline-projection.js',
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

async function persist(testInfo, name, artifact) {
  await mkdir(testInfo.outputDir, { recursive: true });
  const path = testInfo.outputPath(`${name}.json`);
  await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  await testInfo.attach(`${name}.json`, { path, contentType: 'application/json' });
}

test('prototype: one history intent stages sparse matches and publishes one real prepend', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const browserErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 940 });
  const reset = await request.post('/mock/control/reset', {
    data: { scenario: 'deep-history-delayed', seed: 0x92_41_11 },
  });
  expect(reset.ok()).toBe(true);

  // Four older targets are separated by more than one physical page each.
  // The final exact 128 records contain four recent targets and form the
  // already-visible baseline when the Claude projection is selected.
  for (let island = 0; island < 4; island += 1) {
    const response = await request.post('/mock/control/action', {
      data: {
        type: 'dense_progress', channel_id: 'c0', related: false, count: 70,
        target_agent: 'claude', target_count: 1, target_after_noise: true, tail_count: 0,
      },
    });
    expect(response.ok()).toBe(true);
  }
  const tail = await request.post('/mock/control/action', {
    data: {
      type: 'dense_progress', channel_id: 'c0', related: false, count: 60,
      target_agent: 'claude', target_count: 4, target_after_noise: true, tail_count: 0,
    },
  });
  expect(tail.ok()).toBe(true);

  await login(page);
  await page.evaluate(() => {
    window.__ATOLL_DIAGNOSTICS__.clear();
    const state = { active: true, startedAt: performance.now(), frames: [], reading: [] };
    window.__HISTORY_ADMISSION_PROBE__ = state;
    window.__ATOLL_READING_TRACE__ = (entry) => state.reading.push({
      ...entry, relativeAt: entry.at - state.startedAt,
    });
    const sample = () => {
      if (!state.active) return;
      const list = document.querySelector('.timeline-message-list');
      const rect = list?.getBoundingClientRect();
      const rows = [...(list?.querySelectorAll('[data-presentation-row-id]') || [])].map((node) => {
        const rowRect = node.getBoundingClientRect();
        return {
          id: node.dataset.presentationRowId || '',
          top: rowRect.top - (rect?.top || 0),
          bottom: rowRect.bottom - (rect?.top || 0),
          target: node.textContent?.includes('target claude question') === true,
        };
      });
      const visible = rows.find((row) => row.bottom > 0.5 && row.top < (rect?.height || 0));
      state.frames.push({
        at: performance.now() - state.startedAt,
        activationID: list?.dataset.readingActivation || '',
        inputEpoch: Number(list?.dataset.readingInputEpoch || 0),
        connected: list?.isConnected === true,
        scrollTop: Number(list?.scrollTop || 0),
        scrollHeight: Number(list?.scrollHeight || 0),
        clientHeight: Number(list?.clientHeight || 0),
        rowIDs: rows.map((row) => row.id),
        targetCount: rows.filter((row) => row.target).length,
        firstVisibleID: visible?.id || '',
        firstVisibleOffset: visible?.top ?? null,
        baselineAnchorID: state.baselineID || '',
        baselineAnchorOffset: state.baselineID
          ? rows.find((row) => row.id === state.baselineID)?.top ?? null
          : null,
        status: document.querySelector('.timeline-history-demand')?.dataset.phase || '',
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  await page.getByTitle('只看我与 Claude 的往来').click();
  const list = page.locator('.timeline-message-list');
  await expect.poll(async () => list.locator('[data-presentation-row-id]').count(), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(4);
  const baseline = await page.evaluate(() => {
    const list = document.querySelector('.timeline-message-list');
    const first = list?.querySelector('[data-presentation-row-id]');
    const bounds = list?.getBoundingClientRect();
    const firstBounds = first?.getBoundingClientRect();
    return {
      activationID: list?.dataset.readingActivation || '',
      inputEpoch: Number(list?.dataset.readingInputEpoch || 0),
      rowIDs: [...(list?.querySelectorAll('[data-presentation-row-id]') || [])]
        .map((node) => node.dataset.presentationRowId || ''),
      firstID: first?.dataset.presentationRowId || '',
      firstOffset: firstBounds && bounds ? firstBounds.top - bounds.top : null,
    };
  });
  await page.evaluate((baselineID) => {
    const state = window.__HISTORY_ADMISSION_PROBE__;
    state.baselineID = baselineID;
    state.baselineAt = performance.now() - state.startedAt;
  }, baseline.firstID);

  await list.hover();
  // One trusted older gesture owns the intent. Repeated same-direction deltas
  // may promote/reuse it but must not publish each physical page separately.
  for (let step = 0; step < 8; step += 1) {
    await page.mouse.wheel(0, -360);
    await page.waitForTimeout(50);
  }
  await expect.poll(async () => list.locator('[data-presentation-row-id]').count(), { timeout: 75_000 })
    .toBeGreaterThanOrEqual(baseline.rowIDs.length + 3);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .filter((entry) => entry.event === 'history.admission_commit').length), { timeout: 5_000 }).toBe(1);
  const committedRowCount = await list.locator('[data-presentation-row-id]').count();

  // A new operation for the remaining older island is cancelled by trusted
  // newer input before it can publish. It must not replay the prior token or
  // produce a stale structural commit.
  await list.hover();
  await page.mouse.wheel(0, -2_000);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .filter((entry) => entry.event === 'history.admission_begin').length), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(2);
  await page.mouse.wheel(0, 420);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .filter((entry) => entry.event === 'history.admission_cancel').length), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(700);

  const captured = await page.evaluate(() => {
    const state = window.__HISTORY_ADMISSION_PROBE__;
    state.active = false;
    window.__ATOLL_READING_TRACE__ = null;
    return {
      baselineAt: state.baselineAt,
      frames: state.frames,
      reading: state.reading,
      diagnostics: window.__ATOLL_DIAGNOSTICS__.snapshot()
        .filter((entry) => entry.event.startsWith('history.')),
    };
  });
  const begins = captured.diagnostics.filter((entry) => entry.event === 'history.admission_begin');
  const settles = captured.diagnostics.filter((entry) => entry.event === 'history.admission_settle');
  const admissionOperation = begins.find((entry) => entry.detail?.baselineCount >= 3);
  const operationID = admissionOperation?.detail?.operationID || '';
  const cancelledOperation = begins.find((entry) => entry.detail?.operationID !== operationID);
  const operationSettles = settles.filter((entry) => entry.detail?.operationID === operationID);
  const operationObserves = captured.diagnostics.filter((entry) => (
    entry.event === 'history.admission_observe' && entry.detail?.operationID === operationID
  ));
  const revealWrites = captured.reading.filter((entry) => (
    entry.stage === 'history-reveal-write'
      && (!operationID || entry.commitID?.startsWith(operationID))
  ));
  const revealCommits = captured.diagnostics.filter((entry) => (
    entry.event === 'history.admission_commit'
      && (!operationID || entry.detail?.operationID === operationID)
  ));
  const ownerPrepends = [...new Map(captured.reading.filter((entry) => (
    entry.stage === 'owner-commit'
      && entry.changeKind === 'prepend'
      && entry.activationID === admissionOperation?.detail?.activationID
  )).map((entry) => [entry.snapshotRevision, entry])).values()];
  const countTransitions = [];
  for (let index = 1; index < captured.frames.length; index += 1) {
    const before = captured.frames[index - 1];
    const after = captured.frames[index];
    if (after.at < Number(captured.baselineAt || 0)) continue;
    if (after.activationID !== baseline.activationID || before.activationID !== baseline.activationID) continue;
    if (after.targetCount > before.targetCount) countTransitions.push({
      at: after.at,
      beforeCount: before.targetCount,
      afterCount: after.targetCount,
      addedIDs: after.rowIDs.filter((id) => !before.rowIDs.includes(id)),
      firstBefore: { id: before.firstVisibleID, offset: before.firstVisibleOffset },
      firstAfter: { id: after.firstVisibleID, offset: after.firstVisibleOffset },
      scrollTopBefore: before.scrollTop,
      scrollTopAfter: after.scrollTop,
      scrollHeightBefore: before.scrollHeight,
      scrollHeightAfter: after.scrollHeight,
    });
  }
  const commitAt = countTransitions[0]?.at || Number.POSITIVE_INFINITY;
  const anchorFrames = captured.frames.filter((frame) => (
    frame.activationID === baseline.activationID
      && frame.baselineAnchorID === baseline.firstID
      && Number.isFinite(frame.baselineAnchorOffset)
      && frame.at <= commitAt + 250
  ));
  const anchorOffsets = anchorFrames.map((frame) => frame.baselineAnchorOffset);
  const artifact = {
    capturedAt: new Date().toISOString(),
    sourceDigest: await sourceDigest(),
    browserErrors,
    baselineAt: captured.baselineAt,
    baseline,
    admissionOperation,
    cancelledOperation,
    operationObserves,
    operationSettles,
    revealWrites,
    revealCommits,
    ownerPrepends,
    countTransitions,
    anchorFrames,
    diagnostics: captured.diagnostics,
    reading: captured.reading,
    frames: captured.frames,
  };
  await persist(testInfo, 'history-presentation-admission-prototype', artifact);

  expect(admissionOperation).toBeTruthy();
  expect(admissionOperation.detail.demandUnits).toBeGreaterThanOrEqual(3);
  expect(operationObserves.length).toBeGreaterThanOrEqual(3);
  expect(operationObserves.at(-1)?.detail?.completeUnits).toBeGreaterThanOrEqual(
    admissionOperation.detail.demandUnits,
  );
  expect(operationSettles).toHaveLength(1);
  expect(countTransitions).toHaveLength(1);
  expect(ownerPrepends).toHaveLength(1);
  expect(revealWrites).toHaveLength(0);
  expect(revealCommits).toHaveLength(1);
  expect(cancelledOperation).toBeTruthy();
  expect(captured.diagnostics.filter((entry) => (
    entry.event === 'history.admission_commit'
      && entry.detail?.operationID === cancelledOperation.detail.operationID
  ))).toHaveLength(0);
  expect(captured.diagnostics.filter((entry) => (
    entry.event === 'history.admission_cancel'
      && entry.detail?.operationID === cancelledOperation.detail.operationID
  )).length).toBeGreaterThanOrEqual(1);
  expect(captured.frames.at(-1)?.targetCount).toBe(committedRowCount);
  expect(captured.frames.filter((frame) => (
    frame.at >= captured.baselineAt && frame.activationID === baseline.activationID
  ))
    .every((frame) => frame.connected && frame.targetCount >= baseline.rowIDs.length)).toBe(true);
  expect(browserErrors.filter((message) => (
    message.includes('Cannot update a component') || message.includes('while rendering')
  ))).toEqual([]);
});
