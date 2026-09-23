import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

async function attachJSON(testInfo, name, value) {
  const path = testInfo.outputPath(name);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

async function reset(request, seed, scenario = 'multi-channel') {
  const response = await request.post('/mock/control/reset', {
    data: { scenario, seed },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

async function contentRevisions(page) {
  return page.locator('.timeline-message-list [data-content-revision]').evaluateAll((nodes) => (
    nodes.map((node) => `${node.closest('[data-presentation-row-id]')?.dataset.presentationRowId || ''}:${node.dataset.contentRevision || ''}`)
  ));
}

async function toggleFiles(page) {
  const desktopToggle = page.locator('#workspace-files-toggle');
  if (await desktopToggle.isVisible()) {
    await desktopToggle.click();
    return;
  }
  await page.getByRole('button', { name: '频道操作' }).click();
  await page.getByRole('menuitem', { name: /^(打开|关闭)文件$/ }).click();
}

async function pushTerminal(request, channelId = 'c0') {
  const response = await request.post('/mock/control/action', {
    data: {
      // `pulse` is intentionally not presentable and a terminal update for a
      // seeded request is lifecycle state, not a new root. Approval is the
      // mock's canonical user-visible arrival path.
      type: 'approval',
      channel_id: channelId,
    },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function chooseChannel(page, channelId) {
  const channelButton = page.locator('button.channel-item').filter({ hasText: channelId }).first();
  if (!await channelButton.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: '打开频道列表' }).click();
  }
  await channelButton.click();
}

test('UX-A09 covered Surface remounts current history before exposing a hidden-surface arrival', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await reset(request, 29101);
  await login(page);
  await expect(page.locator('.timeline-message-list [data-presentation-row-id]').last()).toBeVisible();
  const before = await contentRevisions(page);

  await toggleFiles(page);
  const terminal = await pushTerminal(request);
  const messagePane = page.locator('.dynamic-message-pane');
  const readingSlot = page.locator('.dynamic-message-pane .conversation-reading-slot');
  const floatingSlot = page.locator('.dynamic-message-pane .conversation-floating-slot');
  // Mobile Files keeps the mounted Conversation pane as an inert transparent
  // overlay for the Composer. The semantic surface is hidden through the
  // public data attribute, while the actual reading/floating slots are hidden
  // and cannot receive pointer input.
  await expect(messagePane).toHaveAttribute('data-surface-visible', 'false');
  await expect(messagePane).toHaveCSS('pointer-events', 'none');
  await expect(readingSlot).toHaveCSS('visibility', 'hidden');
  await expect(readingSlot).toHaveCSS('pointer-events', 'none');
  await expect(floatingSlot).toHaveCSS('visibility', 'hidden');
  await expect(floatingSlot).toHaveCSS('pointer-events', 'none');
  // On the compact surface, opening Files suspends the conversation owner and
  // its live arrival consumer. The hidden view therefore cannot manufacture a
  // viewport notice; reopening it must hydrate the canonical history instead.
  const latest = page.locator('.timeline-jump-latest');
  const hiddenEvidence = await page.evaluate(() => ({
    paneVisibility: getComputedStyle(document.querySelector('.dynamic-message-pane')).visibility,
    surfaceVisible: document.querySelector('.dynamic-message-pane')?.dataset.surfaceVisible || '',
    panePointerEvents: getComputedStyle(document.querySelector('.dynamic-message-pane')).pointerEvents,
    readingVisibility: getComputedStyle(document.querySelector('.conversation-reading-slot')).visibility,
    readingPointerEvents: getComputedStyle(document.querySelector('.conversation-reading-slot')).pointerEvents,
    floatingVisibility: getComputedStyle(document.querySelector('.conversation-floating-slot')).visibility,
    floatingPointerEvents: getComputedStyle(document.querySelector('.conversation-floating-slot')).pointerEvents,
    jumpText: document.querySelector('.timeline-jump-latest')?.textContent || '',
    rowIDs: [...document.querySelectorAll('.timeline-message-list [data-presentation-row-id]')]
      .map((node) => node.dataset.presentationRowId),
    contentRevisions: [...document.querySelectorAll('.timeline-message-list [data-content-revision]')]
      .map((node) => `${node.closest('[data-presentation-row-id]')?.dataset.presentationRowId || ''}:${node.dataset.contentRevision || ''}`),
  }));
  await attachJSON(testInfo, 'ux-a09-hidden-surface.json', { terminal, before, hiddenEvidence });

  expect(hiddenEvidence.surfaceVisible).toBe('false');
  expect(hiddenEvidence.panePointerEvents).toBe('none');
  expect(hiddenEvidence.readingVisibility).toBe('hidden');
  expect(hiddenEvidence.readingPointerEvents).toBe('none');
  expect(hiddenEvidence.floatingVisibility).toBe('hidden');
  expect(hiddenEvidence.floatingPointerEvents).toBe('none');
  expect(hiddenEvidence.jumpText).toBe('');
  await expect(latest).toHaveCount(0);

  await toggleFiles(page);
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/, { timeout: 15_000 });
  await expect(messagePane).toHaveAttribute('data-surface-visible', 'true');
  await expect.poll(() => readingSlot.evaluate((node) => getComputedStyle(node).visibility)).toBe('visible');
  await expect.poll(() => floatingSlot.evaluate((node) => getComputedStyle(node).visibility)).toBe('visible');

  await expect(page.getByText('Approve live mock action', { exact: true })).toBeVisible();
  // The arrival became part of canonical history while the surface was
  // suspended. A fresh following-tail observation consumes it without a
  // stale jump notice.
  const viewport = page.locator('.timeline-message-list');
  await page.waitForFunction(() => {
    const node = document.querySelector('.timeline-message-list');
    return !document.querySelector('.timeline-jump-latest')
      && node.scrollHeight - node.clientHeight - node.scrollTop <= 24;
  });
  const visibleEvidence = await page.evaluate(() => {
    const node = document.querySelector('.timeline-message-list');
    return {
      paneVisibility: getComputedStyle(document.querySelector('.dynamic-message-pane')).visibility,
      surfaceVisible: document.querySelector('.dynamic-message-pane')?.dataset.surfaceVisible || '',
      panePointerEvents: getComputedStyle(document.querySelector('.dynamic-message-pane')).pointerEvents,
      readingVisibility: getComputedStyle(document.querySelector('.conversation-reading-slot')).visibility,
      readingPointerEvents: getComputedStyle(document.querySelector('.conversation-reading-slot')).pointerEvents,
      floatingVisibility: getComputedStyle(document.querySelector('.conversation-floating-slot')).visibility,
      floatingPointerEvents: getComputedStyle(document.querySelector('.conversation-floating-slot')).pointerEvents,
      jumpText: document.querySelector('.timeline-jump-latest')?.textContent || '',
      tailDistance: node.scrollHeight - node.clientHeight - node.scrollTop,
      rowIDs: [...node.querySelectorAll('[data-presentation-row-id]')].map((row) => row.dataset.presentationRowId),
    };
  });
  await attachJSON(testInfo, 'ux-a09-visible-surface.json', visibleEvidence);
  await expect(latest).toHaveCount(0);
  expect(visibleEvidence.surfaceVisible).toBe('true');
  expect(visibleEvidence.paneVisibility).toBe('visible');
  expect(visibleEvidence.readingVisibility).toBe('visible');
  expect(visibleEvidence.readingPointerEvents).not.toBe('none');
  expect(visibleEvidence.floatingVisibility).toBe('visible');
  expect(visibleEvidence.tailDistance).toBeLessThanOrEqual(24);
});


test('UX-A09 history, replay, reconnect, filters and channel switches never manufacture viewport unseen', async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await reset(request, 29105);

  // Seed a large folded history before a viewport exists. These rows exercise
  // the real attach/history path, but none is a live arrival for this reading
  // activation. The terminal gives us an immutable envelope to replay later;
  // Replica de-duplication must reject it before the arrival-journal seam.
  const dense = await request.post('/mock/control/action', {
    data: { type: 'dense_progress', channel_id: 'c0', count: 1_100 },
  });
  expect(dense.ok()).toBe(true);
  const denseBody = await dense.json();
  const terminalBody = await pushTerminal(request, 'c0');

  await login(page);
  const latest = page.locator('.timeline-jump-latest');
  const checkpoints = [];
  const capture = async (stage) => {
    const value = await page.evaluate((label) => {
      const pane = document.querySelector('.dynamic-message-pane');
      const reading = document.querySelector('.conversation-reading-slot');
      const floating = document.querySelector('.conversation-floating-slot');
      return {
        stage: label,
        channel: document.querySelector('main h1')?.textContent || '',
        jump: document.querySelector('.timeline-jump-latest')?.textContent || '',
        mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
        paneVisibility: pane ? getComputedStyle(pane).visibility : '',
        surfaceVisible: pane?.dataset.surfaceVisible || '',
        panePointerEvents: pane ? getComputedStyle(pane).pointerEvents : '',
        readingVisibility: reading ? getComputedStyle(reading).visibility : '',
        readingPointerEvents: reading ? getComputedStyle(reading).pointerEvents : '',
        floatingVisibility: floating ? getComputedStyle(floating).visibility : '',
        floatingPointerEvents: floating ? getComputedStyle(floating).pointerEvents : '',
        materialized: [...document.querySelectorAll('.timeline-message-list [data-presentation-row-id]')]
          .map((node) => node.dataset.presentationRowId),
      };
    }, stage);
    checkpoints.push(value);
    expect(value.jump).toBe('');
  };
  await expect(latest).toHaveCount(0);
  await capture('large-history-attached');

  const filters = page.getByRole('group', { name: '按成员过滤' });
  const filter = filters.getByRole('button', { name: 'steward', exact: true });
  await filter.click();
  await expect(filter).toHaveAttribute('aria-pressed', 'true');
  await expect(latest).toHaveCount(0);
  await capture('filter-on');
  await filter.click();
  await expect(filter).toHaveAttribute('aria-pressed', 'false');
  await expect(latest).toHaveCount(0);
  await capture('filter-off');

  await toggleFiles(page);
  await expect(page.locator('.dynamic-message-pane')).toHaveAttribute('data-surface-visible', 'false');
  await expect(page.locator('.dynamic-message-pane')).toHaveCSS('pointer-events', 'none');
  await expect.poll(() => page.locator('.conversation-reading-slot').evaluate(
    (node) => getComputedStyle(node).visibility,
  )).toBe('hidden');
  await expect.poll(() => page.locator('.conversation-reading-slot').evaluate(
    (node) => getComputedStyle(node).pointerEvents,
  )).toBe('none');
  await expect.poll(() => page.locator('.conversation-floating-slot').evaluate(
    (node) => getComputedStyle(node).visibility,
  )).toBe('hidden');
  const replay = await request.post('/mock/control/action', {
    data: {
      type: 'replay_envelope',
      channel_id: 'c0',
      envelope_id: terminalBody.id,
    },
  });
  expect(replay.ok()).toBe(true);
  const hiddenProgress = await request.post('/mock/control/action', {
    data: { type: 'dense_progress', channel_id: 'c0', count: 700 },
  });
  expect(hiddenProgress.ok()).toBe(true);
  const hiddenProgressBody = await hiddenProgress.json();
  await expect(latest).toHaveCount(0);
  await capture('surface-hidden-after-duplicate-and-progress');

  const dropped = await request.post('/mock/control/action', { data: { type: 'drop' } });
  expect(dropped.ok()).toBe(true);
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/, { timeout: 15_000 });
  await expect(latest).toHaveCount(0);
  await capture('reconnected-hidden');

  await toggleFiles(page);
  await expect(page.locator('.dynamic-message-pane')).toHaveAttribute('data-surface-visible', 'true');
  await expect.poll(() => page.locator('.conversation-reading-slot').evaluate(
    (node) => getComputedStyle(node).visibility,
  )).toBe('visible');
  await expect(latest).toHaveCount(0);
  await capture('surface-visible');

  await chooseChannel(page, 'c0.project');
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(latest).toHaveCount(0);
  await capture('channel-b');
  await chooseChannel(page, 'c0');
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(latest).toHaveCount(0);
  await capture('channel-a-restored');

  await attachJSON(testInfo, 'ux-a09-no-false-unseen.json', {
    seededHistory: denseBody.count,
    hiddenProgress: hiddenProgressBody.count,
    replayedEnvelope: terminalBody.id,
    checkpoints,
  });
});

test('UX-A01 stale exact-incarnation filter remains named and removable', async ({ page, request }, testInfo) => {
  await reset(request, 29102);
  await login(page);

  // Seed the exact old-incarnation preference through the product's persisted
  // ViewSession shape, then reload. It remains an applied predicate until the
  // reader explicitly removes it; the roster may not silently remap it.
  await page.evaluate(() => {
    const key = 'atoll.view-session.v3.root';
    const value = JSON.parse(localStorage.getItem(key) || '{"schema":3,"preferences":{},"readings":{}}');
    value.schema = 3;
    value.preferences ||= {};
    value.readings ||= {};
    value.preferences.c0 = {
      ...(value.preferences.c0 || {}),
      scope: 'mine',
      actorFilter: ['agent:steward:old-incarnation'],
    };
    localStorage.setItem(key, JSON.stringify(value));
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('.connection-state')?.classList.contains('state-open')
    && document.querySelector('.timeline-actor-filter .is-stale'));
  const stale = page.locator('.timeline-actor-filter .is-stale');
  const staleEvidence = await page.evaluate(() => ({
    emptyState: Boolean(document.querySelector('.timeline-actor-filter .is-stale')),
    staleLabel: document.querySelector('.timeline-actor-filter .is-stale')?.textContent || '',
    pressed: document.querySelector('.timeline-actor-filter .is-stale')?.getAttribute('aria-pressed') || '',
    visibleRowIDs: [...document.querySelectorAll('.timeline-message-list [data-presentation-row-id]')]
      .map((row) => row.dataset.presentationRowId),
  }));
  await attachJSON(testInfo, 'ux-a01-stale-filter-before-remove.json', staleEvidence);
  expect(staleEvidence.emptyState).toBe(true);
  expect(staleEvidence.pressed).toBe('true');
  await expect(stale).toHaveAttribute('aria-pressed', 'true');
  await stale.click();
  await page.waitForFunction(() => !document.querySelector('.timeline-actor-filter .is-stale')
    && document.querySelector('.timeline-message-list [data-presentation-row-id]'));
  const removedEvidence = await page.evaluate(() => ({
    stalePresent: Boolean(document.querySelector('.timeline-actor-filter .is-stale')),
    visibleRowIDs: [...document.querySelectorAll('.timeline-message-list [data-presentation-row-id]')]
      .map((row) => row.dataset.presentationRowId),
  }));
  await attachJSON(testInfo, 'ux-a01-stale-filter-after-remove.json', removedEvidence);
  expect(removedEvidence.stalePresent).toBe(false);
  expect(removedEvidence.visibleRowIDs.length).toBeGreaterThan(0);
});

