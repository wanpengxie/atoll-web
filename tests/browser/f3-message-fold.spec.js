import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

async function sendToSteward(page, text) {
  const editor = page.getByTestId('composer-input');
  // The recipient banner already selects the sole steward. `@` in the editor
  // is deliberately literal text now; recipient selection is not encoded in
  // or stripped from the message body.
  await editor.fill(text);
  await page.getByRole('button', { name: /发送/ }).click();
}

test('权威当前消息的长正文首次进入即展开，成为历史后按默认折叠', async ({ page, request }) => {
  const reset = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario: 'deep-history', seed: 1313 } });
  expect(reset.ok()).toBe(true);
  await login(page);

  const marker = 'LATEST-AUTHORITY-ENTRY';
  const longMessage = [marker, ...Array.from({ length: 44 }, (_, index) => `当前消息第 ${index + 1} 行`)].join('\n');
  await sendToSteward(page, longMessage);
  const row = page.locator('[data-presentation-row-id]').filter({ hasText: marker });
  const toggle = row.locator(`.message-fold-toggle[data-fold-id$=":request"]`);
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(row.locator('.message-fold.is-folded')).toHaveCount(0);

  await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0\.project$/ }) }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0$/ }) }).click();
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  await sendToSteward(page, '把上一条变成历史，但不写入永久展开默认。');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(row.locator('.message-fold.is-folded')).toHaveCount(1);
});

test('用户显式收起 current entry 后，切频道返回与后续 append 都保留 override', async ({ page, request }) => {
  const reset = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario: 'deep-history', seed: 1314 } });
  expect(reset.ok()).toBe(true);
  await login(page);

  const marker = 'LATEST-EXPLICIT-COLLAPSE';
  await sendToSteward(page, [marker, ...Array.from({ length: 44 }, (_, index) => `显式选择第 ${index + 1} 行`)].join('\n'));
  const row = page.locator('[data-presentation-row-id]').filter({ hasText: marker });
  const toggle = row.locator('.message-fold-toggle[data-fold-id$=":request"]');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0\.project$/ }) }).click();
  await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0$/ }) }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await sendToSteward(page, '后续 append 不得推翻我刚才的显式收起。');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('Presentation authority rejects intermediate batches and blesses only the covered semantic tail', async ({ page }) => {
  await page.goto('/tests/browser/fixtures/fold-authority.html');
  await page.waitForFunction(() => Boolean(window.foldAuthority));

  const states = [];
  states.push({ phase: 'batch-1', rows: await page.evaluate(() => window.foldAuthority.snapshot()) });
  await page.evaluate(() => window.foldAuthority.batch2());
  states.push({ phase: 'batch-2', rows: await page.evaluate(() => window.foldAuthority.snapshot()) });
  await page.evaluate(() => window.foldAuthority.authoritativeTail());
  states.push({ phase: 'tail', rows: await page.evaluate(() => window.foldAuthority.snapshot()) });
  await page.evaluate(() => window.foldAuthority.prepend());
  states.push({ phase: 'prepend', rows: await page.evaluate(() => window.foldAuthority.snapshot()) });
  await page.evaluate(() => window.foldAuthority.filteredGap());
  await expect(page.locator('[data-presentation-row-id]').filter({ hasText: 'LATEST-DEEP-MATCH' })).toHaveCount(1);
  states.push({ phase: 'filter-gap', rows: await page.evaluate(() => window.foldAuthority.snapshot()) });
  await page.evaluate(() => window.foldAuthority.filteredSettled());
  await expect(page.locator('[data-presentation-row-id]').filter({ hasText: 'LATEST-DEEP-MATCH' }).locator('.message-fold-toggle[aria-expanded="true"]')).toBeVisible();
  states.push({ phase: 'filter-settled', rows: await page.evaluate(() => window.foldAuthority.snapshot()) });

  const byPhase = Object.fromEntries(states.map((entry) => [entry.phase, entry.rows]));
  expect(byPhase['batch-1'].find((row) => row.id === 'mid-1')?.folded).toBeGreaterThan(0);
  expect(byPhase['batch-2'].find((row) => row.id === 'mid-2')?.folded).toBeGreaterThan(0);
  expect(byPhase.tail.find((row) => row.id === 'tail')?.folded).toBe(0);
  expect(byPhase.tail.filter((row) => row.folded === 0).map((row) => row.id)).toEqual(['tail']);
  expect(byPhase.prepend.find((row) => row.id === 'tail')?.folded).toBe(0);
  expect(byPhase['filter-gap'].find((row) => row.text.includes('LATEST-DEEP-MATCH'))?.folded).toBeGreaterThan(0);
  expect(byPhase['filter-settled'].filter((row) => row.folded === 0).map((row) => row.text.includes('LATEST-DEEP-MATCH'))).toEqual([true]);
});

test('cache-first latest role commit follows the public height acknowledgement', async ({ page }, testInfo) => {
  await page.goto('/tests/browser/fixtures/fold-authority.html');
  await page.waitForFunction(() => Boolean(window.foldAuthority));
  await page.evaluate(() => {
    window.__ATOLL_DIAGNOSTICS__.reading.enable({ case: 'fold-role-commit' });
    window.foldAuthority.cacheFirst();
  });
  const row = page.locator('[data-presentation-row-id]').filter({ hasText: 'CACHE-FIRST-LATEST' });
  await expect(row.locator('.message-fold-toggle')).toHaveAttribute('aria-expanded', 'false');
  await page.evaluate(() => window.foldAuthority.authorizeCache());
  await expect(row.locator('.message-fold-toggle')).toHaveAttribute('aria-expanded', 'true');
  await page.waitForTimeout(120);

  const evidence = await page.evaluate(() => {
    const scroller = document.querySelector('.timeline-message-list');
    return {
      scrollTop: Number(scroller?.scrollTop || 0),
      scrollHeight: Number(scroller?.scrollHeight || 0),
      clientHeight: Number(scroller?.clientHeight || 0),
      trace: window.__ATOLL_DIAGNOSTICS__.reading.snapshot(),
    };
  });
  const evidencePath = testInfo.outputPath('fold-role-height-ack.json');
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  await testInfo.attach('fold-role-height-ack.json', { path: evidencePath, contentType: 'application/json' });
  expect(evidence.scrollHeight - evidence.clientHeight - evidence.scrollTop).toBeLessThanOrEqual(1);
  expect(evidence.trace.entries.filter((entry) => entry.event === 'reading.issuer-write'
    && entry.detail?.authorityLabel === 'presentation-role').length).toBe(1);
});

test('wheel takeover invalidates a pending latest-role height transaction', async ({ page }, testInfo) => {
  await page.goto('/tests/browser/fixtures/fold-authority.html');
  await page.waitForFunction(() => Boolean(window.foldAuthority));
  await page.evaluate(() => {
    window.__ATOLL_DIAGNOSTICS__.reading.enable({ case: 'fold-role-wheel' });
    window.foldAuthority.cacheFirst();
    window.foldAuthority.authorizeCache({ wheel: true });
  });
  await expect(page.locator('[data-presentation-row-id]').filter({ hasText: 'CACHE-FIRST-LATEST' })
    .locator('.message-fold-toggle')).toHaveAttribute('aria-expanded', 'true');
  await page.waitForTimeout(120);
  const evidence = await page.evaluate(() => ({
    mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
    trace: window.__ATOLL_DIAGNOSTICS__.reading.snapshot(),
  }));
  const evidencePath = testInfo.outputPath('fold-role-wheel.json');
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2));
  await testInfo.attach('fold-role-wheel.json', { path: evidencePath, contentType: 'application/json' });
  const input = evidence.trace.entries.find((entry) => entry.event === 'reading.input-owner');
  expect(input).toBeTruthy();
  expect(evidence.mode).toBe('browsing');
  expect(evidence.trace.entries.filter((entry) => entry.sequence > input.sequence
    && entry.event === 'reading.issuer-write')).toHaveLength(0);
});

test('F7 收起虚拟列表里的长消息时，合法 clamp 后控件仍可用且没有第二次位移', async ({ page, request }, testInfo) => {
  const reset = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario: 'deep-history', seed: 1311 } });
  expect(reset.ok()).toBe(true);
  const ordinaryLayoutLogs = [];
  page.on('console', (message) => {
    const text = message.text();
    if (text.includes('Ordinary measured layout')) {
      ordinaryLayoutLogs.push({ type: message.type(), text });
    }
  });
  await page.addInitScript(() => {
    // WARN is intentionally enabled for candidate review. Coverage failures
    // are ERROR and fail the oracle; bounded clamp residuals remain evidence.
    globalThis.VIRTUOSO_LOG_LEVEL = 2;
  });
  await login(page);

  const longMessage = Array.from({ length: 45 }, (_, index) => `第 ${index + 1} 行：用于验证收起定位。`).join('\n');
  await sendToSteward(page, longMessage);
  await sendToSteward(page, '后一条短消息不能擅自改变长消息已经展示的高度。');
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.enable({
    case: 'fold-collapse',
    seed: 1311,
  }));

  const longRow = page.locator('[data-presentation-row-id]').filter({ hasText: '第 1 行：用于验证收起定位。' });
  // The later short message makes this long row historical, so it begins
  // folded. Expand explicitly to establish the collapse precondition.
  const expand = longRow.locator('.message-fold-toggle[aria-expanded="false"]');
  await expect(expand).toBeVisible();
  await expand.click();
  const collapse = longRow.locator('.message-fold-toggle[aria-expanded="true"]');
  await expect(collapse).toBeVisible();
  // Use Playwright's own actionability scroll without dispatching the click.
  // Native scrollIntoView can be reconciled by the virtualizer before the
  // next task, which would sample an off-screen coordinate rather than the
  // position at which the reader actually clicks.
  await collapse.click({ trial: true });
  const rowID = await collapse.evaluate((node) => node.closest('[data-presentation-row-id]')?.dataset.presentationRowId || '');
  const row = page.locator(`[data-presentation-row-id=${JSON.stringify(rowID)}]`);
  const foldID = await collapse.getAttribute('data-fold-id');
  const foldBody = row.locator(`[data-fold-id=${JSON.stringify(foldID)}]`).locator('..');
  const scroller = page.locator('.timeline-message-list');
  const expandedHeight = await foldBody.evaluate((node) => node.getBoundingClientRect().height);
  const anchorTop = await collapse.evaluate((node) => node.getBoundingClientRect().top);
  const initialGeometry = await scroller.evaluate((node) => ({
    scrollTop: node.scrollTop,
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
    maxScrollTop: node.scrollHeight - node.clientHeight,
  }));
  await collapse.evaluate((node) => {
    window.__foldPaintTops = [];
    window.__foldPaintRunning = true;
    const sample = () => {
      if (!window.__foldPaintRunning) return;
      const item = node.closest('[data-presentation-row-id]');
      const scroller = node.closest('.timeline-message-list');
      const buttonRect = node.getBoundingClientRect();
      const rowRect = item?.getBoundingClientRect();
      const list = item?.parentElement;
      const listRect = list?.getBoundingClientRect();
      const scrollerRect = scroller?.getBoundingClientRect();
      const rowStyle = item ? getComputedStyle(item) : null;
      const listStyle = list ? getComputedStyle(list) : null;
      window.__foldPaintTops.push({
        at: performance.now(),
        connected: node.isConnected,
        focused: document.activeElement === node,
        rowID: item?.dataset.presentationRowId || '',
        foldID: node.dataset.foldId || '',
        expanded: node.getAttribute('aria-expanded'),
        top: buttonRect.top,
        bottom: buttonRect.bottom,
        buttonHeight: buttonRect.height,
        rowTop: rowRect?.top,
        rowBottom: rowRect?.bottom,
        rowHeight: rowRect?.height,
        rowMarginTop: rowStyle?.marginTop,
        rowMarginBottom: rowStyle?.marginBottom,
        rowTransform: rowStyle?.transform,
        listTop: listRect?.top,
        listHeight: listRect?.height,
        listTransform: listStyle?.transform,
        listPaddingTop: listStyle?.paddingTop,
        listPaddingBottom: listStyle?.paddingBottom,
        scrollTop: scroller?.scrollTop,
        scrollHeight: scroller?.scrollHeight,
        clientHeight: scroller?.clientHeight,
        maxScrollTop: scroller ? scroller.scrollHeight - scroller.clientHeight : undefined,
        scrollerTop: scrollerRect?.top,
        scrollerBottom: scrollerRect?.bottom,
        devicePixelRatio: window.devicePixelRatio,
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  await collapse.click();
  await page.waitForTimeout(150);
  const frames = await page.evaluate(() => {
    window.__foldPaintRunning = false;
    return window.__foldPaintTops;
  });
  const finalGeometry = await page.evaluate(({ expectedRowID, expectedFoldID }) => {
    const scroller = document.querySelector('.timeline-message-list');
    const row = [...document.querySelectorAll('[data-presentation-row-id]')]
      .find((node) => node.dataset.presentationRowId === expectedRowID);
    const button = row
      ? [...row.querySelectorAll('.message-fold-toggle')]
        .find((node) => node.dataset.foldId === expectedFoldID)
      : null;
    const buttonRect = button?.getBoundingClientRect();
    const scrollerRect = scroller?.getBoundingClientRect();
    return {
      rowConnected: Boolean(row?.isConnected),
      buttonConnected: Boolean(button?.isConnected),
      focused: document.activeElement === button,
      expanded: button?.getAttribute('aria-expanded') || '',
      buttonTop: buttonRect?.top ?? null,
      buttonBottom: buttonRect?.bottom ?? null,
      scrollerTop: scrollerRect?.top ?? null,
      scrollerBottom: scrollerRect?.bottom ?? null,
      scrollTop: Number(scroller?.scrollTop || 0),
      scrollHeight: Number(scroller?.scrollHeight || 0),
      clientHeight: Number(scroller?.clientHeight || 0),
      maxScrollTop: scroller ? scroller.scrollHeight - scroller.clientHeight : 0,
    };
  }, { expectedRowID: rowID, expectedFoldID: foldID });
  const readingTrace = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.snapshot());
  const evidence = JSON.stringify({
    rowID,
    foldID,
    anchorTop,
    expandedHeight,
    initialGeometry,
    frames,
    finalGeometry,
    ordinaryLayoutLogs,
    readingTrace,
  }, null, 2);
  const evidencePath = testInfo.outputPath('fold-reading-trace.json');
  await writeFile(evidencePath, evidence);
  await testInfo.attach('fold-reading-trace.json', {
    path: evidencePath,
    contentType: 'application/json',
  });

  // Persist action-window evidence before any business assertion. A broken
  // fold render/measurement must leave a debuggable trace instead of aborting
  // before the artifact exists.
  const collapsedToggle = row.locator(`.message-fold-toggle[data-fold-id=${JSON.stringify(foldID)}][aria-expanded="false"]`);
  await expect(collapsedToggle).toBeVisible();
  await expect(collapsedToggle).toBeFocused();
  await expect.poll(() => foldBody.evaluate((node) => node.getBoundingClientRect().height)).toBeLessThan(expandedHeight * 0.75);
  expect(frames.length).toBeGreaterThan(1);

  // The control begins only a small distance below the expanded list's
  // maximum scroll position, while the fold removes more than that distance.
  // The browser must therefore clamp once; pixel-stationarity is impossible
  // and is not the product contract for this boundary case.
  const initialBottomRoom = initialGeometry.maxScrollTop - initialGeometry.scrollTop;
  expect(expandedHeight * 0.25).toBeGreaterThan(initialBottomRoom + 1);
  const clampedFrame = frames.find((frame) => frame.connected
    && frame.scrollHeight < initialGeometry.scrollHeight - 1
    && frame.scrollTop < initialGeometry.scrollTop - 1);
  expect(clampedFrame, JSON.stringify({ initialGeometry, frames })).toBeTruthy();

  // Clamp is legal; a second full-extent compensation is not. The exact
  // semantic control must remain usable and focused in the viewport, and the
  // settled position must not jump farther toward history after the clamp.
  expect(frames.every((frame) => frame.connected
    && frame.rowID === rowID
    && frame.foldID === foldID
    && frame.top >= frame.scrollerTop - 1
    && frame.bottom <= frame.scrollerBottom + 1), JSON.stringify({ rowID, foldID, frames })).toBe(true);
  expect(finalGeometry).toMatchObject({
    rowConnected: true,
    buttonConnected: true,
    focused: true,
    expanded: 'false',
  });
  expect(finalGeometry.buttonTop).toBeGreaterThanOrEqual(finalGeometry.scrollerTop - 1);
  expect(finalGeometry.buttonBottom).toBeLessThanOrEqual(finalGeometry.scrollerBottom + 1);
  expect(finalGeometry.scrollTop).toBeGreaterThanOrEqual(clampedFrame.scrollTop - 2);
  expect(ordinaryLayoutLogs.filter((entry) => entry.type === 'error')).toEqual([]);

  // Collapsing must remove the physical height, not merely hide its content
  // inside an expanded virtual item. The next user gesture must immediately
  // move the real scroller.
  const beforeWheel = await scroller.evaluate((node) => node.scrollTop);
  await scroller.hover();
  await page.mouse.wheel(0, -320);
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeLessThan(beforeWheel - 20);
});
