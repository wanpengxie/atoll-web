import { expect, test } from '@playwright/test';

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

async function captureVisibleAnchor(page) {
  return page.locator('.timeline-message-list').evaluate((node) => {
    const top = node.getBoundingClientRect().top;
    const row = [...node.querySelectorAll('[data-presentation-row-id]')]
      .map((candidate) => ({
        id: candidate.dataset.presentationRowId,
        top: candidate.getBoundingClientRect().top - top,
        bottom: candidate.getBoundingClientRect().bottom - top,
      }))
      .filter((candidate) => candidate.bottom > 0 && candidate.top < node.clientHeight)
      .sort((left, right) => left.top - right.top)[0];
    return row || null;
  });
}

async function persistedBookmark(page, channelID, viewKeyPrefix) {
  return page.evaluate(({ channelID: channel, prefix }) => {
    const readings = JSON.parse(localStorage.getItem('atoll.view-session.v2.root') || 'null')?.readings || {};
    const key = Object.keys(readings).find((candidate) => candidate.startsWith(`${channel}\u0000${prefix}`));
    return key ? readings[key]?.bookmark || null : null;
  }, { channelID, prefix: viewKeyPrefix });
}

async function expectAnchorRestored(page, anchor) {
  const viewport = page.locator('.timeline-message-list');
  await expect.poll(() => viewport.evaluate((node, expected) => {
    const row = [...node.querySelectorAll('[data-presentation-row-id]')]
      .find((candidate) => candidate.dataset.presentationRowId === expected.id);
    if (!row) return false;
    const rect = row.getBoundingClientRect();
    const root = node.getBoundingClientRect();
    return rect.bottom > root.top && rect.top < root.bottom;
  }, anchor)).toBe(true);
  const samples = await viewport.evaluate((node, expected) => new Promise((resolve) => {
    const values = [];
    const rootTop = () => node.getBoundingClientRect().top;
    const collect = () => {
      const row = [...node.querySelectorAll('[data-presentation-row-id]')]
        .find((candidate) => candidate.dataset.presentationRowId === expected.id);
      values.push(row ? row.getBoundingClientRect().top - rootTop() : null);
      if (values.length >= 8) resolve(values);
      else requestAnimationFrame(collect);
    };
    requestAnimationFrame(collect);
  }), anchor);
  expect(samples.every(Number.isFinite), JSON.stringify(samples)).toBe(true);
  expect(Math.abs(samples.at(-1) - anchor.top), JSON.stringify({ anchor, samples })).toBeLessThanOrEqual(32);
  expect(Math.max(...samples) - Math.min(...samples), JSON.stringify(samples)).toBeLessThanOrEqual(2);
}

test('TC0222 F7 reader can reverse direction immediately after a history prepend', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'mixed-height-history', seed: 1715 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  await page.mouse.wheel(0, -100_000);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .some((entry) => entry.event === 'history.intent_satisfied'))).toBe(true);

  const beforeReverse = await viewport.evaluate((node) => node.scrollTop);
  await page.mouse.wheel(0, 640);
  await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(beforeReverse + 20);
});

test('TC0223 F7 oldest-history boundary stays inert under repeated upward input', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1716 } });
  expect(reset.ok()).toBe(true);
  await login(page);

  const viewport = page.locator('.timeline-message-list');
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  for (let step = 0; step < 30; step += 1) {
    await viewport.hover();
    await page.mouse.wheel(0, -100_000);
    await page.waitForTimeout(30);
  }
  await expect(page.getByText('c0 history 1: ask steward for PONG', { exact: true })).toBeVisible();
  await viewport.hover();
  await page.mouse.wheel(0, -100_000);
  await expect.poll(() => viewport.evaluate((node) => Math.round(node.scrollTop))).toBe(0);

  const before = await page.evaluate(() => {
    const node = document.querySelector('.timeline-message-list');
    const first = node.querySelector('[data-presentation-row-id]');
    return {
      top: node.scrollTop,
      rowID: first?.dataset.presentationRowId || '',
      rowTop: first?.getBoundingClientRect().top - node.getBoundingClientRect().top,
      starts: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event === 'history.intent_started').length,
    };
  });
  for (let step = 0; step < 12; step += 1) await page.mouse.wheel(0, -720);
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => {
    const node = document.querySelector('.timeline-message-list');
    const first = node.querySelector('[data-presentation-row-id]');
    return {
      top: node.scrollTop,
      rowID: first?.dataset.presentationRowId || '',
      rowTop: first?.getBoundingClientRect().top - node.getBoundingClientRect().top,
      starts: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event === 'history.intent_started').length,
    };
  });
  expect(after.top).toBe(0);
  expect(after.rowID).toBe(before.rowID);
  expect(Math.abs(after.rowTop - before.rowTop)).toBeLessThanOrEqual(1);
  expect(after.starts).toBe(before.starts);
});

test('TC0224 F7 switching channels restores the saved semantic reading anchor', async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1714 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  await page.mouse.wheel(0, -2_400);
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    document.addEventListener('pointerdown', (event) => {
      if (!event.target.closest?.('.channel-item')) return;
      const node = document.querySelector('.timeline-message-list');
      const viewportTop = node.getBoundingClientRect().top;
      const rows = [...node.querySelectorAll('[data-presentation-row-id]')]
        .map((row) => ({
          id: row.dataset.presentationRowId,
          top: row.getBoundingClientRect().top - viewportTop,
          bottom: row.getBoundingClientRect().bottom - viewportTop,
        }))
        .filter((row) => row.bottom > 0 && row.top < node.clientHeight)
        .sort((left, right) => left.top - right.top);
      window.__ATOLL_HANDOFF_ANCHOR__ = rows[0] || null;
    }, { capture: true, once: true });
  });

  await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0\.project$/ }) }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  const anchor = await page.evaluate(() => window.__ATOLL_HANDOFF_ANCHOR__ || null);
  expect(anchor?.id).toBeTruthy();
  const persistedAfterLeave = await persistedBookmark(page, 'c0', 'c0:mine:');
  expect(persistedAfterLeave, JSON.stringify({ anchor, persistedAfterLeave })).toBeNull();
  await page.evaluate((anchorID) => {
    const frames = [];
    const writes = [];
    const originalScrollTo = Element.prototype.scrollTo;
    const originalScrollBy = Element.prototype.scrollBy;
    const captureWrite = (method, original) => function (...args) {
      const owned = this.classList?.contains('timeline-message-list');
      const before = owned ? Number(this.scrollTop || 0) : null;
      const result = original.apply(this, args);
      if (owned) writes.push({ method, args, before, after: Number(this.scrollTop || 0), stack: new Error().stack || '' });
      return result;
    };
    if (typeof originalScrollTo === 'function') Element.prototype.scrollTo = captureWrite('scrollTo', originalScrollTo);
    if (typeof originalScrollBy === 'function') Element.prototype.scrollBy = captureWrite('scrollBy', originalScrollBy);
    let running = false;
    let animationFrame = 0;
    const sample = () => {
      if (!running) return;
      const node = document.querySelector('.timeline-message-list');
      const root = node?.getBoundingClientRect();
      const rows = [...(node?.querySelectorAll('[data-presentation-row-id]') || [])];
      const anchorRow = rows.find((candidate) => candidate.dataset.presentationRowId === anchorID);
      const rect = anchorRow?.getBoundingClientRect();
      frames.push({
        frame: frames.length,
        channel: document.querySelector('main h1')?.textContent || '',
        restoring: Boolean(document.querySelector('.timeline-reading-restore')),
        scrollTop: node?.scrollTop ?? null,
        firstRowID: rows[0]?.dataset.presentationRowId || '',
        lastRowID: rows.at(-1)?.dataset.presentationRowId || '',
        anchorTop: rect && root ? rect.top - root.top : null,
        anchorVisible: Boolean(rect && root && rect.bottom > root.top && rect.top < root.bottom),
      });
      if (frames.length < 120) animationFrame = requestAnimationFrame(sample);
    };
    document.addEventListener('pointerdown', (event) => {
      const channel = event.target.closest?.('.channel-item')?.querySelector('.channel-name')?.textContent?.trim();
      if (channel !== 'c0') return;
      running = true;
      animationFrame = requestAnimationFrame(sample);
    }, { capture: true, once: true });
    window.__ATOLL_RETURN_PAINTS__ = {
      stop() {
        running = false;
        cancelAnimationFrame(animationFrame);
        if (typeof originalScrollTo === 'function') Element.prototype.scrollTo = originalScrollTo;
        if (typeof originalScrollBy === 'function') Element.prototype.scrollBy = originalScrollBy;
        return { frames, writes, diagnostics: window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || [] };
      },
    };
  }, anchor.id);
  await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0$/ }) }).click();
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect.poll(() => viewport.evaluate((node, anchorID) => {
    const root = node.getBoundingClientRect();
    const row = [...node.querySelectorAll('[data-presentation-row-id]')]
      .find((candidate) => candidate.dataset.presentationRowId === anchorID);
    if (!row) return false;
    const rect = row.getBoundingClientRect();
    return rect.bottom > root.top && rect.top < root.bottom;
  }, anchor.id)).toBe(true);
  await page.waitForTimeout(500);
  const returnEvidence = await page.evaluate(() => window.__ATOLL_RETURN_PAINTS__?.stop?.() || ({ frames: [] }));
  await testInfo.attach('channel-return-paints.json', {
    body: JSON.stringify({ anchor, persistedAfterLeave, ...returnEvidence }, null, 2),
    contentType: 'application/json',
  });
  const returnFrames = returnEvidence.frames || [];
  const firstChannelFrame = returnFrames.find((frame) => frame.channel === 'c0');
  const firstVisibleIndex = returnFrames.findIndex((frame) => frame.channel === 'c0' && frame.anchorVisible);
  const visibleFrames = firstVisibleIndex < 0 ? [] : returnFrames.slice(firstVisibleIndex).filter((frame) => frame.channel === 'c0');
  expect(firstChannelFrame, JSON.stringify({ anchor, returnEvidence })).toBeTruthy();
  expect(firstVisibleIndex, JSON.stringify({ anchor, returnEvidence })).toBeGreaterThanOrEqual(0);
  expect(visibleFrames.every((frame) => frame.anchorVisible && Number.isFinite(frame.anchorTop)), JSON.stringify(returnEvidence)).toBe(true);
  const restoredTops = visibleFrames.map((frame) => frame.anchorTop);
  expect(Math.max(...restoredTops) - Math.min(...restoredTops), JSON.stringify(returnEvidence)).toBeLessThanOrEqual(2);
});

test('TC0225 F7 scope and participant-filter activation exits save and restore through the single list lifecycle', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1715 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  await page.mouse.wheel(0, -2_400);
  await page.waitForTimeout(150);

  const mineAnchor = await captureVisibleAnchor(page);
  expect(mineAnchor?.id).toBeTruthy();
  await page.getByRole('group', { name: '动态范围' }).getByRole('button', { name: '@我' }).click();
  await expect(page.getByRole('group', { name: '动态范围' }).getByRole('button', { name: '全部' })).toBeVisible();
  expect(await persistedBookmark(page, 'c0', 'c0:mine:')).toBeNull();
  await page.getByRole('group', { name: '动态范围' }).getByRole('button', { name: '全部' }).click();
  await expectAnchorRestored(page, mineAnchor);

  const unfilteredAnchor = await captureVisibleAnchor(page);
  const steward = page.getByRole('group', { name: '按成员过滤' }).getByRole('button', { name: 'steward' });
  await steward.click();
  await expect(steward).toHaveAttribute('aria-pressed', 'true');
  expect(await persistedBookmark(page, 'c0', 'c0:mine:')).toBeNull();
  await steward.click();
  await expect(steward).toHaveAttribute('aria-pressed', 'false');
  await expectAnchorRestored(page, unfilteredAnchor);
});

test('TC0226 F7 access loss saves the old activation and a later membership grant restores it', async ({ page, request }, testInfo) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1716 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'access-initial-current-tail' }));
  await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0\.project$/ }) }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await page.waitForTimeout(1_000);
  const initialEvidence = await page.evaluate(() => ({
    reading: window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.() || null,
    sequence: document.querySelector('.seq-label')?.textContent || '',
    rows: [...document.querySelectorAll('[data-presentation-row-id]')].map((row) => row.dataset.presentationRowId || ''),
  }));
  await testInfo.attach('access-initial-current-tail.json', {
    body: JSON.stringify(initialEvidence, null, 2), contentType: 'application/json',
  });
  await expect(page.getByText('c0.project history 119: ask project-agent for PONG', { exact: true })).toBeVisible();
  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  await page.mouse.wheel(0, -2_400);
  await page.waitForTimeout(150);
  const anchor = await captureVisibleAnchor(page);
  expect(anchor?.id).toBeTruthy();
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'access-restore-current-tail' }));

  const revoked = await request.post('/mock/control/action', { data: { type: 'revoke_membership', channel_id: 'c0.project' } });
  expect(revoked.ok()).toBe(true);
  await expect(page.getByText('频道内容不可访问', { exact: true })).toBeVisible({ timeout: 10_000 });
  expect(await persistedBookmark(page, 'c0.project', 'c0.project:mine:')).toBeNull();

  const granted = await request.post('/mock/control/action', { data: { type: 'grant_membership', channel_id: 'c0.project' } });
  expect(granted.ok()).toBe(true);
  await expect(page.locator('.timeline-message-list')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1_000);
  const restoreEvidence = await page.evaluate(() => ({
    reading: window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.() || null,
    diagnostics: window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || [],
    sequence: document.querySelector('.seq-label')?.textContent || '',
    rows: [...document.querySelectorAll('[data-presentation-row-id]')].map((row) => ({
      id: row.dataset.presentationRowId || '', text: row.textContent?.slice(0, 120) || '',
    })),
  }));
  await testInfo.attach('access-restore-current-tail.json', {
    body: JSON.stringify(restoreEvidence, null, 2), contentType: 'application/json',
  });
  const currentTailCommit = restoreEvidence.reading?.entries?.find((entry) => (
    entry.event === 'reading.owner-commit'
      && entry.detail?.insertedIDs?.includes('c0.project-history-request-119')
  ));
  expect(currentTailCommit, JSON.stringify(restoreEvidence, null, 2)).toBeTruthy();
  await expectAnchorRestored(page, anchor);
});
