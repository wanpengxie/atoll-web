import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

async function attachEvidence(testInfo, name, payload) {
  const path = testInfo.outputPath(name);
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

async function reset(request, seed) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'multi-channel', seed },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('.timeline-reading-stack > .timeline-reading-layer.is-active > .timeline-message-list')).toHaveCount(1);
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.locator('.timeline')).toBeVisible();
  await expect(page.locator('.top-error')).toHaveCount(0);
}

function channel(page, name) {
  return page.locator('.channel-item').filter({
    has: page.locator('.channel-name', {
      hasText: new RegExp(`^${name.replace('.', '\\.')}$`),
    }),
  });
}

async function approval(request, channelID) {
  const response = await request.post('/mock/control/action', {
    data: { type: 'approval', channel_id: channelID },
  });
  expect(response.ok()).toBe(true);
}

async function railEvidence(page, channelID) {
  return page.evaluate((id) => ({
    rail: window.__ATOLL_DIAGNOSTICS__?.rail?.snapshot?.(id),
    reading: window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.(),
    mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
    jump: document.querySelector('.timeline-jump-latest')?.textContent || '',
  }), channelID);
}

async function waitForSettledHydrationObservation(page, channelID) {
  // `visibleRowIDs` is produced by Reading's hit-tested DOM sampler. The
  // channel prefix rejects a settled observation from the previous c0
  // activation while the project Presentation is still hydrating.
  await expect.poll(async () => page.evaluate((id) => {
    const heading = document.querySelector('main h1')?.textContent?.trim() || '';
    const entries = window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.().entries || [];
    return heading === id && entries.some((entry) => (
      entry.event === 'reading.observation'
      && entry.detail?.settled === true
      && entry.detail?.atTail === true
      && entry.detail?.surfaceVisible === true
      && Array.isArray(entry.detail?.visibleRowIDs)
      && entry.detail.visibleRowIDs.some((rowID) => String(rowID).startsWith(`${id}-`))
    ));
  }, channelID)).toBe(true);
  return page.evaluate((id) => {
    const entries = window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.().entries || [];
    return entries.filter((entry) => (
      entry.event === 'reading.observation'
      && entry.detail?.settled === true
      && entry.detail?.atTail === true
      && entry.detail?.surfaceVisible === true
      && Array.isArray(entry.detail?.visibleRowIDs)
      && entry.detail.visibleRowIDs.some((rowID) => String(rowID).startsWith(`${id}-`))
    )).at(-1) || null;
  }, channelID);
}

function channelSnapshot(evidence) {
  return evidence.rail?.channels?.[0];
}

function addedApprovalRows(evidence) {
  return (channelSnapshot(evidence)?.rows || [])
    .filter((row) => row.type === 'human.approve' && row.id !== 'c0.project-approval-1')
    .sort((left, right) => left.seq - right.seq);
}

function latestAddedApprovalSeq(evidence) {
  const row = addedApprovalRows(evidence).at(-1);
  expect(row, 'rail evidence must retain the injected approval row').toBeTruthy();
  return Number(row.seq);
}

function expectAcknowledgedTail(evidence, minimumBoundary) {
  const snapshot = channelSnapshot(evidence);
  expect(snapshot).toMatchObject({
    authorityReady: true,
    counts: { related: 0, other: 0, pending: false, unknown: false },
  });
  expect(snapshot.notificationHighWater).toBeGreaterThanOrEqual(minimumBoundary);
}

test('tail acknowledgement survives channel switches and reload while a future row notifies', async ({ page, request }, testInfo) => {
  await reset(request, 0x4e_05);

  await login(page);
  const home = channel(page, 'c0');
  const project = channel(page, 'c0.project');
  const related = project.locator('.unread-related');
  const other = project.locator('.unread-total:not(.unread-pending)');
  await approval(request, 'c0.project');
  await approval(request, 'c0.project');
  await expect(related).toHaveText('2');
  await expect(other).toHaveCount(0);

  await project.click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  const initialScope = page.locator('.timeline-scope > button');
  await expect(initialScope).toHaveText('与我相关');
  await initialScope.click();
  await expect(initialScope).toHaveText('全部');
  await expect(related).toHaveCount(0);
  await expect(other).toHaveCount(0);

  await home.click();
  await expect(related).toHaveCount(0);
  await project.click();
  await expect(related).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(related).toHaveCount(0);
  await expect(other).toHaveCount(0);

  await home.click();
  await approval(request, 'c0.project');
  await expect(related).toHaveText('1');
  await expect(other).toHaveCount(0);
  await project.click();
  await expect(related).toHaveCount(0);
  await expect(other).toHaveCount(0);
  await attachEvidence(testInfo, 'notification-high-water-persistence.json', {
    contract: 'public-dom',
    afterAcknowledgement: { related: 0, other: 0 },
    afterReload: { related: 0, other: 0 },
    futureUnread: { related: 1, other: 0 },
    afterFutureAcknowledgement: { related: 0, other: 0 },
  });
});

test('cached hydration cannot resurrect a tail-acknowledged notification', async ({ page, request }, testInfo) => {
  await reset(request, 0x4e_06);
  await login(page);
  const project = channel(page, 'c0.project');
  await approval(request, 'c0.project');
  await approval(request, 'c0.project');
  await expect(project.locator('.unread-related')).toHaveText('2');

  // Cross the async row/checkpoint persistence boundary before testing cold
  // hydration, then acknowledge from the hydrated channel tail.
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(project.locator('.unread-related')).toHaveText('2');
  await page.evaluate(() => {
    window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'notification-high-water-hydration' });
    window.__ATOLL_DIAGNOSTICS__?.reading?.clear?.();
  });
  await project.click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  const hydrationScope = page.locator('.timeline-scope > button');
  if (await hydrationScope.textContent() === '与我相关') await hydrationScope.click();
  await expect(hydrationScope).toHaveText('全部');
  await expect(project.locator('.unread-related')).toHaveCount(0);
  const hydratedObservation = await waitForSettledHydrationObservation(page, 'c0.project');
  const afterHydratedAcknowledgement = await railEvidence(page, 'c0.project');

  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(project.locator('.unread-related')).toHaveCount(0);
  await page.evaluate(() => {
    window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'notification-high-water-second-hydration' });
    window.__ATOLL_DIAGNOSTICS__?.reading?.clear?.();
  });
  await project.click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(project.locator('.unread-related')).toHaveCount(0);
  const secondHydratedObservation = await waitForSettledHydrationObservation(page, 'c0.project');
  const afterSecondHydration = await railEvidence(page, 'c0.project');
  expectAcknowledgedTail(afterHydratedAcknowledgement, latestAddedApprovalSeq(afterHydratedAcknowledgement));
  expectAcknowledgedTail(afterSecondHydration, latestAddedApprovalSeq(afterSecondHydration));
  await attachEvidence(testInfo, 'notification-high-water-hydration.json', {
    hydratedObservation,
    afterHydratedAcknowledgement,
    secondHydratedObservation,
    afterSecondHydration,
  });
});

test('a filtered tail acknowledges the channel notification boundary', async ({ page, request }, testInfo) => {
  await reset(request, 0x4e_07);
  await login(page);
  const home = channel(page, 'c0');
  const project = channel(page, 'c0.project');

  await project.click();
  await page.getByTitle('只看我与 project-agent 的往来').click();
  await expect(page.getByTitle('取消只看 project-agent')).toHaveAttribute('aria-pressed', 'true');
  await home.click();
  await approval(request, 'c0.project');
  await approval(request, 'c0.project');
  await expect(project.locator('.unread-related')).toHaveText('2');

  await project.click();
  await expect(page.getByTitle('取消只看 project-agent')).toHaveAttribute('aria-pressed', 'true');
  await expect(project.locator('.unread-related')).toHaveText('2');
  const atFilteredTail = await railEvidence(page, 'c0.project');
  await home.click();
  await expect(project.locator('.unread-related')).toHaveText('2');
  await project.click();
  await page.getByTitle('取消只看 project-agent').click();
  const filteredScope = page.locator('.timeline-scope > button');
  await expect(filteredScope).toHaveText('与我相关');
  await filteredScope.click();
  await expect(filteredScope).toHaveText('全部');
  await expect(project.locator('.unread-related')).toHaveCount(0);
  const afterLeaving = await railEvidence(page, 'c0.project');

  expect(channelSnapshot(atFilteredTail).notificationHighWater)
    .toBeLessThan(latestAddedApprovalSeq(atFilteredTail));
  expectAcknowledgedTail(afterLeaving, latestAddedApprovalSeq(afterLeaving));
  expect(channelSnapshot(afterLeaving).notificationHighWater)
    .toBeGreaterThanOrEqual(channelSnapshot(atFilteredTail).notificationHighWater);
  await attachEvidence(testInfo, 'notification-high-water-filtered.json', {
    atFilteredTail,
    afterLeaving,
  });
});

test('a continuously followed related arrival advances only after the mounted tail presents it', async ({ page, request }, testInfo) => {
  await reset(request, 0x4e_08);
  await login(page);
  const project = channel(page, 'c0.project');
  await project.click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  const followingScope = page.locator('.timeline-scope > button');
  await expect(followingScope).toHaveText('与我相关');
  await followingScope.click();
  await expect(followingScope).toHaveText('全部');
  await expect(project.locator('.unread-related')).toHaveCount(0);
  const before = await railEvidence(page, 'c0.project');
  const beforeBoundary = Number(before.rail?.channels?.[0]?.notificationHighWater || 0);

  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'notification-presented-follow' }));
  await approval(request, 'c0.project');
  await expect.poll(async () => {
    const evidence = await railEvidence(page, 'c0.project');
    return Number(evidence.rail?.channels?.[0]?.notificationHighWater || 0);
  }).toBeGreaterThan(beforeBoundary);
  await expect(project.locator('.unread-related')).toHaveCount(0);
  const after = await railEvidence(page, 'c0.project');
  const afterChannel = channelSnapshot(after);
  expect(afterChannel).toMatchObject({
    authorityReady: true,
    counts: { related: 0, other: 0, pending: false, unknown: false },
  });
  const arrivalRow = afterChannel?.rows?.find((row) => (
    row.type === 'human.approve' && Number(row.seq) > beforeBoundary
  ));
  expect(arrivalRow, 'rail evidence must retain the continuously-followed approval').toBeTruthy();
  expect(arrivalRow.ackReason).toBe('high_water');
  // The current Reading owner publishes a typed DOM observation rather than
  // the retired useReadingSession diagnostic names. Require the observation to
  // contain this exact arrived row at a visible, mounted tail; the rail
  // high-water/ackReason above proves the same frozen receipt was accepted by
  // Feed. This preserves the obligation without asserting a deleted trace.
  expect(after.reading?.entries?.some((entry) => (
    entry.event === 'reading.observation'
      && entry.detail?.atTail === true
      && entry.detail?.surfaceVisible === true
      && entry.detail?.visibleRowIDs?.includes(arrivalRow.id)
  ))).toBe(true);
  await attachEvidence(testInfo, 'notification-presented-follow.json', { before, after });
});
