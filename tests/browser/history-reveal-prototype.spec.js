import { expect, test } from '@playwright/test';

// The former reveal fixture modelled a private dual-list widget.  These cases
// keep its user contracts on the real App -> ConversationSurface -> reading
// container: rows stay painted, trusted input owns the viewport, and a channel
// activation cannot replay a stale history token.

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
  await expect(page.locator('.timeline-message-list')).toBeVisible();
}

function viewport(page) {
  return page.locator('.timeline-message-list');
}

async function visibleEvidence(page) {
  return page.evaluate(() => {
    const list = document.querySelector('.timeline-message-list');
    const root = list?.getBoundingClientRect();
    const rows = [...(list?.querySelectorAll('[data-presentation-row-id]') || [])].map((node) => {
      const rect = node.getBoundingClientRect();
      return { id: node.dataset.presentationRowId || '', top: rect.top, bottom: rect.bottom };
    });
    return {
      activeLayers: document.querySelectorAll('.timeline-reading-layer.is-active').length,
      activeLists: document.querySelectorAll('.timeline-reading-layer.is-active .timeline-message-list').length,
      connected: Boolean(list?.isConnected),
      rowCount: rows.length,
      visibleRows: rows.filter((row) => row.bottom > (root?.top || 0) + 1 && row.top < (root?.bottom || 0)).length,
      scrollTop: Number(list?.scrollTop || 0),
      scrollHeight: Number(list?.scrollHeight || 0),
      clientHeight: Number(list?.clientHeight || 0),
      mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
    };
  });
}

test('history reveal keeps one spatial owner and never paints an empty active surface', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1120, height: 620 });
  await reset(request, 'deep-history-delayed', 0x92_41_21);
  await login(page);
  const list = viewport(page);
  const frames = [];
  for (let index = 0; index < 6; index += 1) {
    await list.hover();
    await page.mouse.wheel(0, -420);
    await page.waitForTimeout(90);
    frames.push(await visibleEvidence(page));
  }
  await page.waitForTimeout(900);
  const final = await visibleEvidence(page);
  await testInfo.attach('history-reveal-single-owner.json', {
    body: JSON.stringify({ frames, final }, null, 2), contentType: 'application/json',
  });
  expect(frames.every((frame) => frame.connected && frame.activeLayers === 1 && frame.activeLists === 1 && frame.visibleRows > 0)).toBe(true);
  expect(final.activeLayers).toBe(1);
  expect(final.activeLists).toBe(1);
  expect(final.visibleRows).toBeGreaterThan(0);
});

test('trusted wheel takeover has no post-takeover writer; pre-wheel writes are separated', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1120, height: 620 });
  await reset(request, 'deep-history-delayed', 0x92_41_22);
  await login(page);
  await page.evaluate(() => {
    const writes = [];
    const nativeScrollTo = Element.prototype.scrollTo;
    const nativeScrollBy = Element.prototype.scrollBy;
    Element.prototype.scrollTo = function (...args) { writes.push({ at: performance.now(), method: 'scrollTo', args }); return nativeScrollTo.apply(this, args); };
    Element.prototype.scrollBy = function (...args) { writes.push({ at: performance.now(), method: 'scrollBy', args }); return nativeScrollBy.apply(this, args); };
    window.__historyRevealWrites = { writes, restore: () => { Element.prototype.scrollTo = nativeScrollTo; Element.prototype.scrollBy = nativeScrollBy; } };
  });
  const list = viewport(page);
  await list.hover();
  const beforeFirstWheel = await page.evaluate(() => window.__historyRevealWrites.writes.length);
  await page.mouse.wheel(0, -2_000);
  await page.waitForTimeout(100);
  const beforeTakeover = await visibleEvidence(page);
  const beforeSecondWheel = await page.evaluate(() => window.__historyRevealWrites.writes.length);
  await page.mouse.wheel(0, 520);
  await page.waitForTimeout(900);
  const evidence = await page.evaluate(() => ({
    writes: window.__historyRevealWrites.writes,
    mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
    demand: document.querySelector('.timeline-history-demand')?.dataset.phase || 'idle',
    list: (() => { const node = document.querySelector('.timeline-message-list'); return node ? { connected: node.isConnected, scrollTop: node.scrollTop } : null; })(),
  }));
  // Markers are captured outside the page function so the two physical wheel
  // boundaries remain explicit in the attached evidence. The first wheel may
  // legitimately materialize history; only the post-takeover phase is the
  // old pending-writer contract.
  evidence.beforeFirstWheel = await page.evaluate((index) => window.__historyRevealWrites.writes.slice(0, index), beforeFirstWheel);
  evidence.firstWheelToTakeover = await page.evaluate(({ start, end }) => window.__historyRevealWrites.writes.slice(start, end), {
    start: beforeFirstWheel,
    end: beforeSecondWheel,
  });
  evidence.postTakeover = await page.evaluate((index) => window.__historyRevealWrites.writes.slice(index), beforeSecondWheel);
  await page.evaluate(() => window.__historyRevealWrites.restore());
  await testInfo.attach('history-reveal-wheel-takeover.json', {
    body: JSON.stringify({ beforeTakeover, evidence }, null, 2), contentType: 'application/json',
  });
  expect(beforeTakeover.connected).toBe(true);
  expect(evidence.list?.connected).toBe(true);
  expect(evidence.mode).toBe('browsing');
  // A writer before the first wheel is not evidence that takeover failed. A
  // writer after the takeover wheel is: it would replay the old height/anchor
  // transaction over the user's native input. Keep every phase visible in the
  // artifact instead of collapsing all writes into a false red aggregate.
  expect(evidence.postTakeover, JSON.stringify({ beforeTakeover, evidence })).toEqual([]);
});

test('history status identity and reduced-motion tail stay readable during background activity', async ({ page, request }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1120, height: 620 });
  await reset(request, 'history-boundary', 0x92_41_23);
  await login(page);
  const list = viewport(page);
  await list.hover();
  for (let index = 0; index < 14; index += 1) {
    await page.mouse.wheel(0, -5_000);
    await page.waitForTimeout(120);
  }
  const status = page.locator('.timeline-history-boundary[data-phase="exhausted"]');
  await expect(status).toBeVisible();
  await page.evaluate(() => {
    window.__historyBoundaryNode = document.querySelector('.timeline-history-boundary[data-phase="exhausted"]');
  });
  const initial = await visibleEvidence(page);
  const pulse = await request.post('/mock/control/action', { data: { type: 'pulse' } });
  expect(pulse.ok()).toBe(true);
  await page.waitForTimeout(500);
  const final = await visibleEvidence(page);
  const identity = await status.evaluate((node) => ({ same: node === window.__historyBoundaryNode }));
  await testInfo.attach('history-reveal-status.json', {
    body: JSON.stringify({ initial, final, identity }, null, 2), contentType: 'application/json',
  });
  expect(initial.visibleRows).toBeGreaterThan(0);
  expect(final.visibleRows).toBeGreaterThan(0);
  expect(final.activeLayers).toBe(1);
  expect(identity.same).toBe(true);
});

test('channel activation replacement drops in-flight history without replaying old rows', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1120, height: 620 });
  await reset(request, 'deep-history-delayed', 0x92_41_24);
  await login(page);
  const list = viewport(page);
  await list.hover();
  await page.mouse.wheel(0, -2_000);
  await page.waitForTimeout(120);
  const oldIDs = await list.locator('[data-presentation-row-id]').evaluateAll((nodes) => nodes.map((node) => node.dataset.presentationRowId));
  const project = page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0\.project$/ }) });
  await project.click();
  await page.waitForTimeout(1_000);
  await testInfo.attach('history-reveal-activation-replacement.json', {
    body: JSON.stringify({
      oldIDs,
      heading: await page.locator('main h1').textContent().catch(() => null),
      activeLists: await page.locator('.timeline-reading-layer.is-active .timeline-message-list').count(),
      errors: await page.locator('.top-error').allTextContents().catch(() => []),
    }, null, 2),
    contentType: 'application/json',
  });
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.locator('.timeline-message-list')).toBeVisible();
  const projectIDs = await viewport(page).locator('[data-presentation-row-id]').evaluateAll((nodes) => nodes.map((node) => node.dataset.presentationRowId));
  const home = page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0$/ }) });
  await home.click();
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(viewport(page)).toBeVisible();
  const restoredIDs = await viewport(page).locator('[data-presentation-row-id]').evaluateAll((nodes) => nodes.map((node) => node.dataset.presentationRowId));
  expect(projectIDs.every((id) => !oldIDs.includes(id))).toBe(true);
  expect(restoredIDs.length).toBeGreaterThan(0);
});
