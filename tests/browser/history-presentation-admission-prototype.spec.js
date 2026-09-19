import { expect, test } from '@playwright/test';

// Contract: a trusted older gesture is owned by the production history
// admission/read-session pair.  It may stage several pages, but it publishes
// one prepend transaction into the one mounted VendorListExecutor.  The
// assertions below deliberately observe user-visible rows and geometry, not
// an implementation fingerprint.

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('.timeline-message-list')).toBeVisible();
}

async function addNoise(request) {
  for (let index = 0; index < 4; index += 1) {
    const response = await request.post('/mock/control/action', {
      data: {
        type: 'dense_progress', channel_id: 'c0', related: false,
        count: 70, target_agent: 'claude', target_count: index === 3 ? 4 : 1,
        target_after_noise: true, tail_count: 0,
      },
    });
    expect(response.ok()).toBe(true);
  }
}

async function sample(page, state) {
  return page.evaluate((probe) => {
    const list = document.querySelector('.timeline-message-list');
    const root = list?.getBoundingClientRect();
    const rows = [...(list?.querySelectorAll('[data-presentation-row-id]') || [])].map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        id: node.dataset.presentationRowId || '',
        top: root ? rect.top - root.top : null,
        bottom: root ? rect.bottom - root.top : null,
      };
    });
    const visible = rows.find((row) => row.bottom > 1 && row.top < (root?.height || 0));
    probe.frames.push({
      connected: Boolean(list?.isConnected),
      activation: list?.dataset.readingActivation || '',
      inputEpoch: Number(list?.dataset.readingInputEpoch || 0),
      scrollTop: Number(list?.scrollTop || 0),
      scrollHeight: Number(list?.scrollHeight || 0),
      clientHeight: Number(list?.clientHeight || 0),
      rowIDs: rows.map((row) => row.id),
      firstVisible: visible?.id || '',
      visibleRows: rows.filter((row) => row.bottom > 1 && row.top < (root?.height || 0)).length,
      demand: document.querySelector('.timeline-history-demand')?.dataset.phase || 'idle',
    });
    return probe.frames.at(-1);
  }, state);
}

test('one older gesture stages sparse history and publishes one real prepend', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 760 });
  const reset = await request.post('/mock/control/reset', {
    data: { scenario: 'deep-history-delayed', seed: 0x92_41_11 },
  });
  expect(reset.ok()).toBe(true);
  await addNoise(request);
  await login(page);
  // Delayed history is allowed to show its readable preparation state first;
  // establish the actual mounted baseline before sending a wheel gesture.
  await expect(page.getByText('target claude question 1', { exact: true }))
    .toBeVisible({ timeout: 30_000 });
  const claudeFilter = page.getByTitle('只看我与 Claude 的往来');
  if (await claudeFilter.isVisible().catch(() => false)) await claudeFilter.click();
  await expect.poll(() => page.locator('[data-presentation-row-id]').count(), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(4);

  const list = page.locator('.timeline-message-list');
  const baseline = await list.evaluate((root) => {
    const first = root.querySelector('[data-presentation-row-id]');
    const rootRect = root.getBoundingClientRect();
    const rect = first?.getBoundingClientRect();
    return {
      activation: root.dataset.readingActivation || '',
      inputEpoch: Number(root.dataset.readingInputEpoch || 0),
      rowIDs: [...root.querySelectorAll('[data-presentation-row-id]')]
        .map((node) => node.dataset.presentationRowId || ''),
      firstID: first?.dataset.presentationRowId || '',
      firstOffset: rect && rootRect ? rect.top - rootRect.top : null,
    };
  });
  expect(baseline.rowIDs.length).toBeGreaterThan(0);

  const probe = { frames: [] };
  await page.evaluate(() => {
    window.__ATOLL_DIAGNOSTICS__.clear();
  });
  await list.hover();
  for (let index = 0; index < 8; index += 1) {
    await page.mouse.wheel(0, -360);
    await page.waitForTimeout(55);
    probe.frames.push(await sample(page, probe));
  }
  // Give the real history consumer time to settle, then inspect the visible
  // rows and geometry in one snapshot.  A missing commit must fail at the
  // behavioral assertion below, not masquerade as a timeout on a diagnostic
  // event that is only a witness.
  await page.waitForTimeout(2_000);
  probe.frames.push(await sample(page, probe));

  const evidence = await page.evaluate((before) => {
    const list = document.querySelector('.timeline-message-list');
    const diagnostics = window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event.startsWith('history.'));
    const row = before.firstID
      ? list?.querySelector(`[data-presentation-row-id="${CSS.escape(before.firstID)}"]`)
      : null;
    const listRect = list?.getBoundingClientRect();
    const rowRect = row?.getBoundingClientRect();
    return {
      diagnostics,
      listCount: list?.querySelectorAll('[data-presentation-row-id]').length || 0,
      activeLists: document.querySelectorAll('.timeline-reading-layer.is-active .timeline-message-list').length,
      anchor: row && listRect && rowRect ? { connected: row.isConnected, offset: rowRect.top - listRect.top } : null,
      demand: document.querySelector('.timeline-history-demand')?.dataset.phase || 'idle',
    };
  }, baseline);
  await testInfo.attach('history-presentation-admission.json', {
    body: JSON.stringify({ baseline, evidence, frames: probe.frames }, null, 2),
    contentType: 'application/json',
  });

  expect(evidence.activeLists).toBe(1);
  expect(evidence.listCount).toBeGreaterThan(baseline.rowIDs.length);
  expect(evidence.anchor?.connected).toBe(true);
  expect(evidence.anchor?.offset).toBeCloseTo(baseline.firstOffset, 0);
  expect(probe.frames.every((frame) => frame.connected && frame.visibleRows > 0)).toBe(true);

  // These diagnostics are supporting evidence for the visible contract.  They
  // are intentionally checked after the user-visible prepend/anchor result,
  // so a missing private event cannot hide the real outcome.
  const begins = evidence.diagnostics.filter((entry) => entry.event === 'history.admission_begin');
  const commits = evidence.diagnostics.filter((entry) => entry.event === 'history.admission_commit');
  const settles = evidence.diagnostics.filter((entry) => entry.event === 'history.admission_settle');
  expect(begins.length).toBeGreaterThanOrEqual(1);
  expect(commits.length).toBeGreaterThanOrEqual(1);
  expect(commits.length).toBeLessThanOrEqual(begins.length);
  expect(settles.length).toBeGreaterThanOrEqual(1);
});
