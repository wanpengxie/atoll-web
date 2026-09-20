import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

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
  await expect(page.locator('main h1')).toHaveText('c0');
}

async function chooseSteward(page) {
  const choose = page.getByRole('button', { name: '选择 Agent' });
  await expect(choose).toBeVisible();
  await choose.click();
  await page.getByRole('menu', { name: '选择目标 Agent' })
    .getByRole('menuitem', { name: 'steward' }).click();
}

async function capturePaint(page, region, frames) {
  return page.evaluate(async ({ region: paintRegion, frames: encoded }) => {
    const decode = (base64) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = `data:image/jpeg;base64,${base64}`;
    });
    const result = [];
    for (let index = 0; index < encoded.length; index += 1) {
      const image = await decode(encoded[index]);
      const scaleX = image.naturalWidth / paintRegion.pageWidth;
      const scaleY = image.naturalHeight / paintRegion.pageHeight;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(paintRegion.width * scaleX));
      canvas.height = Math.max(1, Math.floor(paintRegion.height * scaleY));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(
        image,
        Math.floor(paintRegion.left * scaleX), Math.floor(paintRegion.top * scaleY), canvas.width, canvas.height,
        0, 0, canvas.width, canvas.height,
      );
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let foreground = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        const difference = Math.abs(pixels[offset] - paintRegion.color[0])
          + Math.abs(pixels[offset + 1] - paintRegion.color[1])
          + Math.abs(pixels[offset + 2] - paintRegion.color[2]);
        if (difference > 45) foreground += 1;
      }
      result.push({ index, foreground, width: canvas.width, height: canvas.height });
    }
    return result;
  }, { region, frames });
}

test('TC0212 F7 production runway folds one oversized raw record and keeps compositor coverage', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  await reset(request, 'extreme-height-history', 1731);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  const viewport = page.locator('.timeline-message-list');
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  const paintRegion = await viewport.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const color = getComputedStyle(node).backgroundColor.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [255, 255, 255];
    return {
      left: rect.left + 48,
      top: rect.top + 64,
      width: Math.max(1, rect.width - 96),
      height: Math.max(1, rect.height - 96),
      pageWidth: innerWidth,
      pageHeight: innerHeight,
      color,
    };
  });
  await page.evaluate(() => {
    window.__ATOLL_EXTREME_FRAMES__ = [];
    window.__ATOLL_EXTREME_RUNNING__ = true;
    const node = document.querySelector('.timeline-message-list');
    const sample = () => {
      if (!window.__ATOLL_EXTREME_RUNNING__) return;
      const root = node.getBoundingClientRect();
      const visible = [...node.querySelectorAll('[data-presentation-row-id]')].flatMap((row) => {
        const rect = row.getBoundingClientRect();
        return rect.bottom > root.top && rect.top < root.bottom
          ? [{ id: row.dataset.presentationRowId || '', top: rect.top - root.top, bottom: rect.bottom - root.top }]
          : [];
      });
      window.__ATOLL_EXTREME_FRAMES__.push({
        at: performance.now(),
        scrollTop: node.scrollTop,
        scrollHeight: node.scrollHeight,
        visible,
        rowCount: node.querySelectorAll('.timeline-virtual-item').length,
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  const cdp = await page.context().newCDPSession(page);
  const screencast = [];
  cdp.on('Page.screencastFrame', async (event) => {
    screencast.push({ epochMs: Number(event.metadata?.timestamp || 0) * 1_000, metadata: event.metadata, data: event.data });
    await cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 });
  await viewport.hover();
  let runwayStarted = false;
  let runwayIntentCount = 0;
  let extremeInstalled = false;
  let extremeGeometry = null;
  for (let step = 0; step < 90; step += 1) {
    await page.mouse.wheel(0, -480);
    await page.waitForTimeout(18);
    runwayIntentCount = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
      .filter((entry) => entry.event === 'history.intent_started' && entry.detail?.reason === 'runway').length);
    runwayStarted = runwayIntentCount > 0;
    if (!extremeInstalled) {
      extremeGeometry = await page.evaluate(() => {
        const entry = document.querySelector('[data-entry-id="c0-history-request-104"]');
        if (!entry?.textContent?.includes('c0 PONG 104')) return null;
        const row = entry.closest('.timeline-virtual-item')?.getBoundingClientRect();
        const root = entry.closest('.timeline-message-list')?.getBoundingClientRect();
        return {
          itemHeight: Number(row?.height || 0),
          viewportHeight: Number(root?.height || 0),
          foldedBodies: entry.querySelectorAll('.message-fold.is-folded').length,
          hasExpandControl: Boolean(entry.querySelector('.message-fold-toggle[aria-expanded="false"]')),
        };
      });
      if (extremeGeometry) {
        expect(extremeGeometry).toMatchObject({ hasExpandControl: true });
        expect(extremeGeometry.foldedBodies).toBeGreaterThan(0);
        expect(extremeGeometry.itemHeight).toBeGreaterThan(0);
        expect(extremeGeometry.viewportHeight).toBeGreaterThan(0);
        extremeInstalled = true;
      }
    }
    const committedBatchCount = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
      .filter((entry) => entry.event === 'history.admission_commit' && entry.detail?.stagedIDs?.length > 0).length);
    if (runwayIntentCount >= 3 && committedBatchCount >= 3 && extremeInstalled) break;
  }
  await page.waitForTimeout(320);
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  const evidence = await page.evaluate(() => {
    window.__ATOLL_EXTREME_RUNNING__ = false;
    return {
      diagnostics: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event.startsWith('history.')),
      reading: window.__ATOLL_DIAGNOSTICS__.reading.snapshot(),
      frames: window.__ATOLL_EXTREME_FRAMES__ || [],
    };
  });
  const paint = await capturePaint(page, paintRegion, screencast.map((frame) => frame.data));
  const manifest = [];
  await mkdir(testInfo.outputDir, { recursive: true });
  for (let index = 0; index < screencast.length; index += 1) {
    const name = `extreme-turn-paint-${String(index).padStart(3, '0')}.jpeg`;
    await writeFile(testInfo.outputPath(name), Buffer.from(screencast[index].data, 'base64'));
    manifest.push({ index, epochMs: screencast[index].epochMs, metadata: screencast[index].metadata, name });
  }
  const artifact = { paintRegion, paint, paintFrames: manifest, runwayStarted, runwayIntentCount, extremeInstalled, extremeGeometry, ...evidence };
  await testInfo.attach('extreme-turn-production-evidence.json', {
    body: Buffer.from(JSON.stringify(artifact, null, 2)), contentType: 'application/json',
  });
  const started = evidence.diagnostics.filter((entry) => entry.event === 'history.intent_started' && entry.detail?.reason === 'runway');
  const checks = evidence.diagnostics.filter((entry) => entry.event === 'history.projection_checked');
  expect(runwayStarted, JSON.stringify({ started, checks })).toBe(true);
  expect(runwayIntentCount, JSON.stringify({ started, checks })).toBeGreaterThanOrEqual(3);
  expect(extremeInstalled, JSON.stringify({ started, checks })).toBe(true);
  expect(extremeGeometry).toMatchObject({ hasExpandControl: true });
  expect(extremeGeometry.foldedBodies).toBeGreaterThan(0);
  expect(evidence.diagnostics.filter((entry) => entry.event === 'history.admission_commit' && entry.detail?.stagedIDs?.length > 0).length).toBeGreaterThanOrEqual(3);
  expect(started.length).toBeGreaterThan(0);
  expect(checks.length).toBeGreaterThan(0);
  expect(checks.every((entry) => Number(entry.detail?.released) > 0 && Number(entry.detail?.released) <= 8)).toBe(true);
  expect(evidence.reading.entries.filter((entry) => entry.event === 'reading.issuer-write')).toHaveLength(0);
  expect(Math.max(...evidence.frames.map((frame) => frame.rowCount))).toBeLessThan(100);
  expect(evidence.frames.some((frame) => frame.visible.length === 0)).toBe(false);
  expect(paint.length).toBeGreaterThan(2);
  const baseline = paint.find((frame) => frame.foreground > 0)?.foreground || 0;
  const minimumRequired = Math.max(100, Math.floor(baseline * 0.05));
  expect(paint.filter((frame) => frame.foreground < minimumRequired), JSON.stringify({ baseline, minimumRequired, paint })).toEqual([]);
});

test('TC0213 F7 browsing send has one bottom intent and later user input defeats live completion', async ({ page, request }, testInfo) => {
  test.slow();
  await reset(request, 'long-running-history', 0x92_09_23);
  await login(page);
  const viewport = page.locator('.timeline-message-list');
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  await chooseSteward(page);
  await page.getByLabel('消息').fill('keep steward occupied for send takeover');
  await page.getByRole('button', { name: /发送/ }).click();
  await page.waitForFunction((needle) => (
    [...document.querySelectorAll('[data-presentation-row-id]')].some((row) => row.textContent?.includes(needle))
    && [...document.querySelectorAll('.task-control-buttons button')].some((button) => button.textContent === '停止')
  ), 'keep steward occupied for send takeover');
  await viewport.hover();
  await page.mouse.wheel(0, -3_000);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeGreaterThan(24);
  await chooseSteward(page);
  const marker = 'browse send returns to latest once';
  await page.getByLabel('消息').fill(marker);
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());
  await page.evaluate(() => {
    const writes = [];
    const originalScrollTo = Element.prototype.scrollTo;
    const originalScrollBy = Element.prototype.scrollBy;
    Element.prototype.scrollTo = function patchedScrollTo(...args) { writes.push({ method: 'scrollTo', at: performance.now(), node: this.className, args }); return originalScrollTo.apply(this, args); };
    Element.prototype.scrollBy = function patchedScrollBy(...args) { writes.push({ method: 'scrollBy', at: performance.now(), node: this.className, args }); return originalScrollBy.apply(this, args); };
    window.__TC0213_WRITES__ = { writes, restore: () => { Element.prototype.scrollTo = originalScrollTo; Element.prototype.scrollBy = originalScrollBy; } };
  });
  await page.getByRole('button', { name: /发送/ }).click();
  await expect(page.getByLabel('消息')).toHaveText('');
  await expect(page.locator('[data-presentation-row-id]').filter({ hasText: marker })).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.snapshot().entries.filter((entry) => entry.event === 'reading.issuer-write').length), { timeout: 20_000 }).toBeGreaterThan(0);
  await viewport.hover();
  await page.mouse.wheel(0, -2_000);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  for (let step = 0; step < 3; step += 1) {
    const advanced = await request.post('/mock/control/advance', { data: { ms: 0, compute: { channel_id: 'c0' } } });
    expect(advanced.ok()).toBe(true);
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(350);
  const evidence = await page.evaluate(() => {
    const reading = window.__ATOLL_DIAGNOSTICS__.reading.snapshot();
    const entries = reading.entries;
    const wheel = entries.filter((entry) => entry.event === 'reading.input-owner' && entry.detail?.type === 'wheel');
    const issuer = entries.filter((entry) => entry.event === 'reading.issuer-write');
    return {
      mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
      gap: (() => { const node = document.querySelector('.timeline-message-list'); return node ? node.scrollHeight - node.clientHeight - node.scrollTop : null; })(),
      bottomIntents: entries.filter((entry) => entry.event === 'reading.bottom-intent'),
      issuer,
      wheel,
      writes: window.__TC0213_WRITES__?.writes || [],
      submissions: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event?.startsWith('submission.')),
    };
  });
  await page.evaluate(() => window.__TC0213_WRITES__?.restore());
  await testInfo.attach('browsing-send-public-owner-evidence.json', {
    body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
  });
  expect(evidence.mode).toBe('browsing');
  expect(evidence.gap).toBeGreaterThan(24);
  expect(evidence.bottomIntents).toHaveLength(1);
  expect(evidence.issuer).toHaveLength(1);
  expect(evidence.wheel.length).toBeGreaterThan(0);
  expect(Math.max(...evidence.issuer.map((entry) => Number(entry.sequence))))
    .toBeLessThan(Number(evidence.wheel.at(-1).sequence));
  const required = ['submission.composer_send_started', 'submission.outbox_accepted', 'submission.composer_durable_accepted', 'submission.transmit_started', 'submission.receipt_accepted', 'submission.feed_landed'];
  for (const event of required) expect(evidence.submissions.some((entry) => entry.event === event), event).toBe(true);
});

test('TC0214 F7 history and progress publication do not manufacture new-dynamic notifications', async ({ page, request }) => {
  await reset(request, 'deep-history', 1718);
  await login(page);
  const viewport = page.locator('.timeline-message-list');
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  await viewport.hover();
  for (let index = 0; index < 4; index += 1) {
    await page.mouse.wheel(0, -100_000);
    await page.waitForTimeout(30);
  }
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  await expect(page.getByRole('button', { name: /条新动态/ })).toHaveCount(0);
  const progress = await request.post('/mock/control/action', {
    data: { type: 'dense_progress', channel_id: 'c0', count: 80 },
  });
  expect(progress.ok()).toBe(true);
  await page.waitForTimeout(250);
  await expect(page.getByRole('button', { name: /条新动态/ })).toHaveCount(0);
  const pulse = await request.post('/mock/control/action', { data: { type: 'pulse' } });
  expect(pulse.ok()).toBe(true);
  await expect(page.getByRole('button', { name: /1 条新动态/ })).toBeVisible();
});

test('TC0215 F7 continuous upward scrolling does not fight history prepend anchoring', async ({ page, request }) => {
  await reset(request, 'mixed-height-history', 1713);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  const viewport = page.locator('.timeline-message-list');
  await expect(viewport).toHaveCSS('overflow-anchor', 'none');
  const samplesPromise = page.evaluate(async () => {
    const node = document.querySelector('.timeline-message-list');
    const samples = [];
    for (let frame = 0; frame < 180; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const root = node.getBoundingClientRect();
      const positions = {};
      for (const entry of node.querySelectorAll('.timeline-entry')) {
        const rect = entry.getBoundingClientRect();
        if (rect.bottom > root.top && rect.top < root.bottom) positions[entry.dataset.entryId || ''] = rect.top - root.top;
      }
      samples.push({ frame, top: Math.round(node.scrollTop), height: Math.round(node.scrollHeight), positions });
    }
    return samples;
  });
  await viewport.hover();
  for (let step = 0; step < 40; step += 1) {
    await page.mouse.wheel(0, -360);
    await page.waitForTimeout(18);
    if (await viewport.evaluate((node) => node.scrollTop <= 1)) break;
  }
  const samples = await samplesPromise;
  const historySatisfied = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .some((entry) => entry.event === 'history.intent_satisfied'));
  const geometryCommands = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .filter((entry) => entry.event.startsWith('timeline.geometry_command')));
  const screenMotion = [];
  const motionFrames = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const shared = Object.keys(previous.positions).filter((id) => id && id in current.positions);
    if (!shared.length) continue;
    const movements = shared.map((id) => current.positions[id] - previous.positions[id]).sort((left, right) => left - right);
    const itemMovement = movements[Math.floor(movements.length / 2)];
    screenMotion.push(itemMovement);
    if (Math.abs(itemMovement) > 600 || itemMovement < -80) motionFrames.push({ previous: { ...previous, positions: undefined }, current: { ...current, positions: undefined }, itemMovement });
  }
  expect(historySatisfied).toBe(true);
  expect(Math.max(...screenMotion), JSON.stringify(motionFrames)).toBeLessThanOrEqual(600);
  expect(Math.min(...screenMotion), JSON.stringify({ motionFrames, geometryCommands })).toBeGreaterThanOrEqual(-80);
});

test('TC0216 F7 one boundary demand keeps one status DOM across filtered physical history pages', async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  await reset(request, 'deep-history-delayed', 1731);
  const dense = await request.post('/mock/control/action', {
    data: { type: 'dense_progress', channel_id: 'c0', count: 320, related: false, tail_count: 20 },
  });
  expect(dense.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('visible tail 20', { exact: true })).toBeVisible({ timeout: 15_000 });
  const viewport = page.locator('.timeline-message-list');
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await page.evaluate(() => {
    window.__TC0216__ = { statusNodes: new WeakMap(), next: 0, statusIDs: [], revisions: [], samples: [], running: true };
    const state = window.__TC0216__;
    const sample = () => {
      if (!state.running) return;
      const list = document.querySelector('.timeline-message-list');
      const status = document.querySelector('.timeline-history-demand');
      if (status && !state.statusNodes.has(status)) state.statusNodes.set(status, `status-${++state.next}`);
      const statusID = status ? state.statusNodes.get(status) : '';
      if (statusID && !state.statusIDs.includes(statusID)) state.statusIDs.push(statusID);
      const revision = status?.dataset.revision || '';
      if (revision && !state.revisions.includes(revision)) state.revisions.push(revision);
      state.samples.push({
        statusID,
        phase: status?.dataset.phase || '',
        revision,
        animationName: status ? getComputedStyle(status, '::before').animationName : '',
        sameList: list?.isConnected === true,
        listWidth: list?.getBoundingClientRect().width || 0,
        listHeight: list?.getBoundingClientRect().height || 0,
        presentationRows: list?.querySelectorAll('[data-presentation-row-id]').length || 0,
      });
      state.raf = requestAnimationFrame(sample);
    };
    state.raf = requestAnimationFrame(sample);
  });
  let statusSeen = false;
  for (let step = 0; step < 120; step += 1) {
    await viewport.hover();
    await page.mouse.wheel(0, -360);
    await page.waitForTimeout(18);
    statusSeen = await page.locator('.timeline-history-demand[data-phase="pending"]').isVisible().catch(() => false);
    if (statusSeen) break;
  }
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .some((entry) => entry.event === 'history.intent_satisfied'))).toBe(true);
  const evidence = await page.evaluate((seen) => {
    const state = window.__TC0216__;
    state.running = false;
    cancelAnimationFrame(state.raf);
    return {
      statusIDs: state.statusIDs,
      revisions: state.revisions,
      samples: state.samples,
      diagnostics: window.__ATOLL_DIAGNOSTICS__.snapshot(),
      statusSeen: seen,
    };
  }, statusSeen);
  await mkdir(testInfo.outputDir, { recursive: true });
  await writeFile(testInfo.outputPath('history-demand-multi-page.json'), JSON.stringify(evidence, null, 2));
  await testInfo.attach('history-demand-multi-page.json', { body: Buffer.from(JSON.stringify(evidence, null, 2)), contentType: 'application/json' });
  const started = evidence.diagnostics.findLast((entry) => entry.event === 'history.intent_started');
  const settled = evidence.diagnostics.find((entry) => entry.event === 'history.intent_satisfied' && entry.detail?.epoch === started?.detail?.epoch);
  const completedDuringDemand = evidence.diagnostics.filter((entry) => entry.event === 'history.batch_complete' && entry.detail?.channelId === 'c0');
  const pendingSamples = evidence.samples.filter((sample) => sample.statusID);
  expect(evidence.statusSeen).toBe(true);
  expect(started).toBeTruthy();
  expect(settled).toBeTruthy();
  expect(completedDuringDemand.length).toBeGreaterThanOrEqual(2);
  expect(evidence.statusIDs).toHaveLength(1);
  expect(evidence.revisions).toHaveLength(1);
  expect(pendingSamples.length).toBeGreaterThan(1);
  expect(pendingSamples.every((sample) => sample.phase === 'pending')).toBe(true);
  expect(pendingSamples.every((sample) => sample.animationName === 'history-status-spin')).toBe(true);
  expect(evidence.samples.every((sample) => sample.sameList)).toBe(true);
  expect(pendingSamples.every((sample) => sample.presentationRows > 0)).toBe(true);
});
