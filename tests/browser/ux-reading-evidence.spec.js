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

async function pushTerminal(request, channelId = 'c0', index = 3) {
  const response = await request.post('/mock/control/action', {
    data: {
      type: 'push_terminal',
      channel_id: channelId,
      request_id: `${channelId}-history-request-${index}`,
    },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

test('UX-A09 covered Surface keeps arrival unseen until a fresh visible materialized-tail observation', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await reset(request, 29101);
  await login(page);
  await expect(page.locator('.timeline-message-list [data-presentation-row-id]').last()).toBeVisible();
  const before = await contentRevisions(page);

  await toggleFiles(page);
  const terminal = await pushTerminal(request);
  await page.waitForFunction((previous) => {
    const pane = document.querySelector('.dynamic-message-pane');
    const revisions = [...document.querySelectorAll('.timeline-message-list [data-content-revision]')]
      .map((node) => `${node.closest('[data-presentation-row-id]')?.dataset.presentationRowId || ''}:${node.dataset.contentRevision || ''}`);
    return getComputedStyle(pane).visibility === 'hidden'
      && JSON.stringify(revisions) !== JSON.stringify(previous)
      && document.querySelector('.timeline-jump-latest')?.textContent?.includes('1 条新动态');
  }, before);
  // The list stays mounted and may commit hidden DOM. Neither that commit nor
  // the old at-tail evidence is permission to consume the viewport notice.
  const latest = page.locator('.timeline-jump-latest');
  const hiddenEvidence = await page.evaluate(() => ({
    paneVisibility: getComputedStyle(document.querySelector('.dynamic-message-pane')).visibility,
    jumpText: document.querySelector('.timeline-jump-latest')?.textContent || '',
    rowIDs: [...document.querySelectorAll('.timeline-message-list [data-presentation-row-id]')]
      .map((node) => node.dataset.presentationRowId),
    contentRevisions: [...document.querySelectorAll('.timeline-message-list [data-content-revision]')]
      .map((node) => `${node.closest('[data-presentation-row-id]')?.dataset.presentationRowId || ''}:${node.dataset.contentRevision || ''}`),
    diagnostics: window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || [],
  }));
  await attachJSON(testInfo, 'ux-a09-hidden-surface.json', { terminal, before, hiddenEvidence });

  expect(hiddenEvidence.paneVisibility).toBe('hidden');
  expect(hiddenEvidence.contentRevisions).not.toEqual(before);
  expect(hiddenEvidence.jumpText).toBe('↓ 1 条新动态');

  await toggleFiles(page);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.dynamic-message-pane')).visibility === 'visible');

  // If the adapter's fresh visible commit has already acknowledged the now
  // materialized row, the button may be gone. Otherwise the user's explicit
  // bottom action is the sole issuer and must settle it once.
  if (await latest.count()) await latest.click();
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
      jumpText: document.querySelector('.timeline-jump-latest')?.textContent || '',
      tailDistance: node.scrollHeight - node.clientHeight - node.scrollTop,
      rowIDs: [...node.querySelectorAll('[data-presentation-row-id]')].map((row) => row.dataset.presentationRowId),
      diagnostics: window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || [],
    };
  });
  await attachJSON(testInfo, 'ux-a09-visible-surface.json', visibleEvidence);
  await expect(latest).toHaveCount(0);
  expect(visibleEvidence.paneVisibility).toBe('visible');
  expect(visibleEvidence.tailDistance).toBeLessThanOrEqual(24);
});

test('UX-A09 an old channel activation cannot consume or publish unread state in the committed channel', async ({ page, request }, testInfo) => {
  await reset(request, 29103);
  await login(page);
  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  await page.mouse.wheel(0, -100_000);
  await page.waitForFunction(() => {
    const node = document.querySelector('.timeline-message-list');
    return node.scrollHeight - node.clientHeight - node.scrollTop > 24;
  });

  await pushTerminal(request);
  await page.waitForFunction(() => document.querySelector('.timeline-jump-latest')?.textContent?.includes('1 条新动态'));
  const originEvidence = await page.evaluate(() => {
    const node = document.querySelector('.timeline-message-list');
    return {
      channel: document.querySelector('main h1')?.textContent || '',
      jumpText: document.querySelector('.timeline-jump-latest')?.textContent || '',
      tailDistance: node.scrollHeight - node.clientHeight - node.scrollTop,
      rowIDs: [...node.querySelectorAll('[data-presentation-row-id]')].map((row) => row.dataset.presentationRowId),
      diagnostics: window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || [],
    };
  });
  await attachJSON(testInfo, 'ux-a09-origin-unseen.json', originEvidence);
  expect(originEvidence.tailDistance).toBeGreaterThan(24);
  expect(originEvidence.jumpText).toBe('↓ 1 条新动态');
  const project = page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0\.project$/ }) });
  await project.click();
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'c0.project');
  await page.waitForTimeout(100);
  const supersedingEvidence = await page.evaluate(() => ({
    channel: document.querySelector('main h1')?.textContent || '',
    jumpText: document.querySelector('.timeline-jump-latest')?.textContent || '',
    rowIDs: [...document.querySelectorAll('.timeline-message-list [data-presentation-row-id]')]
      .map((row) => row.dataset.presentationRowId),
    diagnostics: window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || [],
  }));
  await attachJSON(testInfo, 'ux-a09-superseding-activation.json', supersedingEvidence);
  expect(supersedingEvidence.channel).toBe('c0.project');
  expect(supersedingEvidence.jumpText).toBe('');

  const home = page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0$/ }) });
  await home.click();
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'c0'
    && document.querySelector('.timeline-jump-latest')?.textContent?.includes('1 条新动态'));
  const returnEvidence = await page.evaluate(() => ({
    channel: document.querySelector('main h1')?.textContent || '',
    jumpText: document.querySelector('.timeline-jump-latest')?.textContent || '',
    rowIDs: [...document.querySelectorAll('.timeline-message-list [data-presentation-row-id]')]
      .map((row) => row.dataset.presentationRowId),
    diagnostics: window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || [],
  }));
  await attachJSON(testInfo, 'ux-a09-returned-activation.json', returnEvidence);
  expect(returnEvidence.channel).toBe('c0');
  expect(returnEvidence.jumpText).toBe('↓ 1 条新动态');
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
  const terminal = await request.post('/mock/control/action', {
    data: { type: 'push_terminal', channel_id: 'c0', request_id: denseBody.request_id },
  });
  expect(terminal.ok()).toBe(true);
  const terminalBody = await terminal.json();

  await login(page);
  const latest = page.locator('.timeline-jump-latest');
  const checkpoints = [];
  const capture = async (stage) => {
    const value = await page.evaluate((label) => ({
      stage: label,
      channel: document.querySelector('main h1')?.textContent || '',
      jump: document.querySelector('.timeline-jump-latest')?.textContent || '',
      mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
      paneVisibility: document.querySelector('.dynamic-message-pane')
        ? getComputedStyle(document.querySelector('.dynamic-message-pane')).visibility
        : '',
      materialized: [...document.querySelectorAll('.timeline-message-list [data-presentation-row-id]')]
        .map((node) => node.dataset.presentationRowId),
    }), stage);
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
  await expect.poll(() => page.locator('.dynamic-message-pane').evaluate(
    (node) => getComputedStyle(node).visibility,
  )).toBe('hidden');
  const replay = await request.post('/mock/control/action', {
    data: {
      type: 'replay_envelope',
      channel_id: 'c0',
      envelope_id: terminalBody.row.envelope.id,
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
  await expect.poll(() => page.locator('.dynamic-message-pane').evaluate(
    (node) => getComputedStyle(node).visibility,
  )).toBe('visible');
  await expect(latest).toHaveCount(0);
  await capture('surface-visible');

  await page.getByRole('button', { name: '打开频道列表' }).click();
  const project = page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0\.project$/ }) });
  await project.click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(latest).toHaveCount(0);
  await capture('channel-b');
  await page.getByRole('button', { name: '打开频道列表' }).click();
  const home = page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0$/ }) });
  await home.click();
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(latest).toHaveCount(0);
  await capture('channel-a-restored');

  await attachJSON(testInfo, 'ux-a09-no-false-unseen.json', {
    seededHistory: denseBody.count,
    hiddenProgress: hiddenProgressBody.count,
    replayedEnvelope: terminalBody.row.envelope.id,
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
    const value = JSON.parse(localStorage.getItem(key) || '{"schema":2,"preferences":{},"readings":{}}');
    value.schema = 2;
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
    && document.body.textContent.includes('当前应用了已失效的成员筛选。'));
  const stale = page.getByRole('button', { name: '移除已失效成员筛选 agent:steward:old-incarnation' });
  const staleEvidence = await page.evaluate(() => ({
    emptyState: document.body.textContent.includes('当前应用了已失效的成员筛选。'),
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

test('UX-A06 selecting a settled member filters and acknowledges without a second control', async ({ page, request }, testInfo) => {
  await reset(request, 29104, 'long-running');
  await login(page);

  const editor = page.getByLabel('消息');
  await editor.fill('@st');
  await page.getByRole('option', { name: /steward/ }).click();
  await editor.press('End');
  await editor.pressSequentially('UX-A06 独立确认');
  await page.getByRole('button', { name: /发送/ }).click();
  const filters = page.getByRole('group', { name: '按成员过滤' });
  const steward = filters.getByRole('button', { name: 'steward', exact: true });
  // Completion may only settle activity that the current live generation has
  // first observed as running. Wait for that owner fact before driving the
  // mock computation; otherwise the terminal can race ahead of its progress
  // frame and this test never reaches the acknowledgement interaction.
  await page.waitForFunction(() => document.querySelector('.timeline-actor-filter button.activity-active')?.textContent?.includes('steward'));
  for (let index = 0; index < 3; index += 1) {
    const advanced = await request.post('/mock/control/advance', { data: { ms: 0, compute: { channel_id: 'c0' } } });
    expect(advanced.ok()).toBe(true);
  }

  await page.waitForFunction(() => document.querySelector('.timeline-actor-filter button.activity-settled')?.textContent?.includes('steward'));
  const listIdentityBefore = await page.locator('.timeline-message-list').evaluate((node) => ({
    mode: node.closest('.timeline')?.dataset.viewportMode || '',
    first: node.querySelector('[data-presentation-row-id]')?.dataset.presentationRowId || '',
  }));
  const beforeAcknowledge = await page.evaluate(() => ({
    filterPressed: document.querySelector('.timeline-actor-filter button.activity-settled')?.getAttribute('aria-pressed') || '',
    separateAcknowledgePresent: Boolean(document.querySelector('.agent-activity-ack')),
    rowIDs: [...document.querySelectorAll('.timeline-message-list [data-presentation-row-id]')]
      .map((row) => row.dataset.presentationRowId),
    diagnostics: window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || [],
  }));
  await attachJSON(testInfo, 'ux-a06-before-acknowledge.json', { listIdentityBefore, beforeAcknowledge });
  await expect(steward).toHaveClass(/activity-settled/);
  expect(beforeAcknowledge.filterPressed).toBe('false');
  expect(beforeAcknowledge.separateAcknowledgePresent).toBe(false);
  await steward.click();
  await expect(steward).toHaveAttribute('aria-pressed', 'true');
  await expect(steward).not.toHaveClass(/activity-settled/);
  const listIdentityAfter = await page.locator('.timeline-message-list').evaluate((node) => ({
    mode: node.closest('.timeline')?.dataset.viewportMode || '',
    first: node.querySelector('[data-presentation-row-id]')?.dataset.presentationRowId || '',
  }));
  const afterAcknowledge = await page.evaluate(() => ({
    filterPressed: [...document.querySelectorAll('.timeline-actor-filter button')]
      .find((button) => button.textContent?.includes('steward'))?.getAttribute('aria-pressed') || '',
    separateAcknowledgePresent: Boolean(document.querySelector('.agent-activity-ack')),
    rowIDs: [...document.querySelectorAll('.timeline-message-list [data-presentation-row-id]')]
      .map((row) => row.dataset.presentationRowId),
    diagnostics: window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || [],
  }));
  await attachJSON(testInfo, 'ux-a06-after-acknowledge.json', { listIdentityBefore, listIdentityAfter, afterAcknowledge });
  expect(afterAcknowledge.separateAcknowledgePresent).toBe(false);
  expect(afterAcknowledge.filterPressed).toBe('true');
  expect(listIdentityAfter.mode).toBe(listIdentityBefore.mode);
});
