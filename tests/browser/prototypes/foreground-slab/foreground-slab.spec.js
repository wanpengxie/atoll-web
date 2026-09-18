import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const FAST_DELTAS = [-700, -900, -1_300, -1_700];

async function startPaintProbe(page, selector) {
  const region = await page.locator(selector).evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      left: Math.ceil(rect.left + 2),
      top: Math.ceil(rect.top + 2),
      width: Math.floor(rect.width - 4),
      height: Math.floor(rect.height - 4),
      pageWidth: innerWidth,
      pageHeight: innerHeight,
    };
  });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (event) => {
    frames.push({ epochMs: Number(event.metadata?.timestamp || 0) * 1_000, data: event.data, metadata: event.metadata });
    await cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1_280, maxHeight: 720, everyNthFrame: 1 });
  await page.waitForTimeout(40);
  return { cdp, frames, region };
}

async function stopPaintProbe(page, probe, testInfo, prefix) {
  await probe.cdp.send('Page.stopScreencast');
  const paint = await page.evaluate(async ({ jpegFrames, region }) => {
    const load = (src) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = `data:image/jpeg;base64,${src}`;
    });
    const results = [];
    for (let index = 0; index < jpegFrames.length; index += 1) {
      const image = await load(jpegFrames[index]);
      const scaleX = image.naturalWidth / region.pageWidth;
      const scaleY = image.naturalHeight / region.pageHeight;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(region.width * scaleX));
      canvas.height = Math.max(1, Math.floor(region.height * scaleY));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, Math.floor(region.left * scaleX), Math.floor(region.top * scaleY), canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let foreground = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if ((255 - pixels[offset]) + (255 - pixels[offset + 1]) + (255 - pixels[offset + 2]) > 45) foreground += 1;
      }
      results.push({ index, width: canvas.width, height: canvas.height, foreground });
    }
    return results;
  }, { jpegFrames: probe.frames.map((frame) => frame.data), region: probe.region });
  const manifest = [];
  for (let index = 0; index < probe.frames.length; index += 1) {
    const name = `${prefix}-paint-${String(index).padStart(3, '0')}.jpeg`;
    const path = testInfo.outputPath(name);
    await writeFile(path, Buffer.from(probe.frames[index].data, 'base64'));
    manifest.push({ name, epochMs: probe.frames[index].epochMs, metadata: probe.frames[index].metadata, ...paint[index] });
  }
  return { region: probe.region, paint: manifest };
}

async function attachJSON(testInfo, name, value) {
  const path = testInfo.outputPath(name);
  await writeFile(path, JSON.stringify(value, null, 2));
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

function coverageViolations(frames) {
  return frames.filter((frame) => frame.emptyViewport || frame.visible?.length === 0);
}

function blankPaints(paint) {
  return paint.filter((frame) => frame.foreground < 100);
}

async function openBridge(page) {
  await page.goto('/tests/browser/prototypes/foreground-slab/bridge.html');
  await page.waitForFunction(() => window.bridgePrototype?.snapshot()?.visible?.length > 0);
  const root = page.locator('.bridge-root');
  await root.hover();
  await page.keyboard.press('Home');
  await expect.poll(() => root.evaluate((node) => node.scrollTop)).toBeLessThanOrEqual(1);
  return root;
}

test('bridge full lifecycle: top reveal then stable-ID Virtuoso handoff remains painted', async ({ page }, testInfo) => {
  const root = await openBridge(page);
  const beforePrepare = await page.evaluate(() => window.bridgePrototype.snapshot());
  const prepared = await page.evaluate(() => window.bridgePrototype.prepare(30));
  const afterPrepare = await page.evaluate(() => window.bridgePrototype.snapshot());
  expect(afterPrepare.scrollHeight).toBe(beforePrepare.scrollHeight);
  await page.evaluate(() => window.bridgePrototype.clearEvidence());
  const probe = await startPaintProbe(page, '.bridge-root');
  await page.evaluate(() => { window.bridgePrototype.revealAndHandoff(); });
  for (const delta of FAST_DELTAS) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(12);
  }
  await expect.poll(() => page.evaluate(() => window.bridgePrototype.snapshot().handoffs.length)).toBe(1);
  await page.waitForTimeout(180);
  const result = await page.evaluate(() => ({ snapshot: window.bridgePrototype.snapshot(), frames: window.bridgePrototype.takeFrames() }));
  const paint = await stopPaintProbe(page, probe, testInfo, 'bridge-full');
  const evidence = { prepared, beforePrepare, afterPrepare, ...result, paint };
  await attachJSON(testInfo, 'bridge-full-lifecycle.json', evidence);

  const mountedPreparedIDs = new Set(result.frames.flatMap((frame) => frame.visible || []).map((row) => row.id));
  expect(prepared.ids.some((id) => mountedPreparedIDs.has(id))).toBe(true);
  expect(result.frames.some((frame) => frame.phase === 'reveal')).toBe(true);
  expect(result.frames.some((frame) => frame.phase === 'post-handoff')).toBe(true);
  expect(coverageViolations(result.frames)).toEqual([]);
  expect(blankPaints(paint.paint), JSON.stringify(paint.paint)).toEqual([]);
  expect(result.snapshot.writers, JSON.stringify(result.snapshot.writers)).toEqual([]);
});

test('bridge trusted reverse wheel completes reveal once and leaves no stale replay', async ({ page }, testInfo) => {
  const root = await openBridge(page);
  const prepared = await page.evaluate(() => window.bridgePrototype.prepare(30));
  await page.evaluate(() => window.bridgePrototype.clearEvidence());
  const probe = await startPaintProbe(page, '.bridge-root');
  await page.evaluate(() => { window.bridgePrototype.revealAndHandoff(); });
  await page.waitForTimeout(48);
  const beforeWheel = await root.evaluate((node) => node.scrollTop);
  await page.mouse.wheel(0, 420);
  await expect.poll(() => page.evaluate(() => window.bridgePrototype.snapshot().handoffs.length)).toBe(1);
  await page.waitForTimeout(260);
  const after = await page.evaluate(() => ({ snapshot: window.bridgePrototype.snapshot(), frames: window.bridgePrototype.takeFrames() }));
  const paint = await stopPaintProbe(page, probe, testInfo, 'bridge-reverse');
  const evidence = { prepared, beforeWheel, ...after, paint };
  await attachJSON(testInfo, 'bridge-reverse-wheel.json', evidence);

  const reverseWrites = after.snapshot.ownerLayoutWrites.filter((entry) => entry.phase === 'trusted-reverse-complete');
  expect(reverseWrites).toHaveLength(1);
  expect(after.snapshot.handoffs).toHaveLength(1);
  expect(after.snapshot.scrollTop).toBeGreaterThan(beforeWheel);
  expect(coverageViolations(after.frames)).toEqual([]);
  expect(blankPaints(paint.paint), JSON.stringify(paint.paint)).toEqual([]);
  expect(after.snapshot.writers, JSON.stringify(after.snapshot.writers)).toEqual([]);
});

async function openSlab(page) {
  await page.goto('/tests/browser/prototypes/foreground-slab/index.html');
  await page.waitForFunction(() => window.foregroundSlab?.snapshot()?.mounted > 0);
  const root = page.locator('#scroll-root');
  await root.focus();
  await page.keyboard.press('End');
  await expect.poll(() => root.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
  return root;
}

test('bounded normal-flow slab: no-prepend wheel control remains painted', async ({ page }, testInfo) => {
  const root = await openSlab(page);
  await page.evaluate(() => window.foregroundSlab.clearFrames());
  const probe = await startPaintProbe(page, '#scroll-root');
  await root.hover();
  for (const delta of FAST_DELTAS) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(12);
  }
  await page.waitForTimeout(140);
  const result = await page.evaluate(() => ({ snapshot: window.foregroundSlab.snapshot(), frames: window.foregroundSlab.takeFrames() }));
  const paint = await stopPaintProbe(page, probe, testInfo, 'slab-no-prepend');
  await attachJSON(testInfo, 'slab-no-prepend.json', { ...result, paint });
  expect(coverageViolations(result.frames)).toEqual([]);
  expect(blankPaints(paint.paint), JSON.stringify(paint.paint)).toEqual([]);
  expect(result.snapshot.writers).toEqual([]);
});

test('bounded normal-flow slab: stationary top reveal keeps paint and DOM coverage', async ({ page }, testInfo) => {
  const root = await openSlab(page);
  await root.focus();
  await page.keyboard.press('Home');
  await expect.poll(() => root.evaluate((node) => node.scrollTop)).toBeLessThanOrEqual(1);
  const before = await page.evaluate(() => window.foregroundSlab.snapshot());
  await page.evaluate(() => window.foregroundSlab.prepareBatch(8));
  const prepared = await page.evaluate(() => window.foregroundSlab.snapshot());
  expect(prepared.scrollHeight).toBe(before.scrollHeight);
  await page.evaluate(() => window.foregroundSlab.clearFrames());
  const probe = await startPaintProbe(page, '#scroll-root');
  await page.evaluate(() => { window.foregroundSlab.revealPreparedAtTop(); });
  await expect.poll(() => page.evaluate(() => window.foregroundSlab.snapshot().revealEvents.length)).toBe(1);
  await page.waitForTimeout(120);
  const after = await page.evaluate(() => ({ snapshot: window.foregroundSlab.snapshot(), frames: window.foregroundSlab.takeFrames() }));
  const paint = await stopPaintProbe(page, probe, testInfo, 'slab-stationary');
  await attachJSON(testInfo, 'slab-stationary.json', { before, prepared, ...after, paint });
  expect(coverageViolations(after.frames)).toEqual([]);
  expect(blankPaints(paint.paint), JSON.stringify(paint.paint)).toEqual([]);
  expect(after.snapshot.writers).toEqual([]);
});

test('bounded normal-flow slab: 4101 fast top reveal stays painted under the real wheel burst', async ({ page }, testInfo) => {
  const root = await openSlab(page);
  await root.focus();
  await page.keyboard.press('Home');
  await expect.poll(() => root.evaluate((node) => node.scrollTop)).toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    window.foregroundSlab.prepareBatch(8);
    window.foregroundSlab.clearFrames();
  });
  const probe = await startPaintProbe(page, '#scroll-root');
  await page.evaluate(() => { window.foregroundSlab.revealPreparedAtTop(); });
  await root.hover();
  for (const delta of FAST_DELTAS) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(12);
  }
  await expect.poll(() => page.evaluate(() => window.foregroundSlab.snapshot().revealEvents.length)).toBe(1);
  await page.waitForTimeout(120);
  const result = await page.evaluate(() => ({ snapshot: window.foregroundSlab.snapshot(), frames: window.foregroundSlab.takeFrames() }));
  const paint = await stopPaintProbe(page, probe, testInfo, 'slab-fast');
  await attachJSON(testInfo, 'slab-fast-4101.json', { ...result, paint });
  expect(coverageViolations(result.frames)).toEqual([]);
  expect(blankPaints(paint.paint), JSON.stringify(paint.paint)).toEqual([]);
  expect(result.snapshot.writers).toEqual([]);
});

test('bounded normal-flow slab: trusted reverse wheel completes once and has no stale replay', async ({ page }, testInfo) => {
  const root = await openSlab(page);
  await root.focus();
  await page.keyboard.press('Home');
  await expect.poll(() => root.evaluate((node) => node.scrollTop)).toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    window.foregroundSlab.prepareBatch(8);
    window.foregroundSlab.clearFrames();
  });
  const probe = await startPaintProbe(page, '#scroll-root');
  await page.evaluate(() => { window.foregroundSlab.revealPreparedAtTop(); });
  await page.waitForTimeout(48);
  const beforeWheel = await root.evaluate((node) => node.scrollTop);
  await root.hover();
  await page.mouse.wheel(0, 420);
  await expect.poll(() => page.evaluate(() => window.foregroundSlab.snapshot().revealEvents.length)).toBe(1);
  await page.waitForTimeout(260);
  const result = await page.evaluate(() => ({ snapshot: window.foregroundSlab.snapshot(), frames: window.foregroundSlab.takeFrames() }));
  const paint = await stopPaintProbe(page, probe, testInfo, 'slab-reverse');
  await attachJSON(testInfo, 'slab-reverse.json', { beforeWheel, ...result, paint });
  expect(result.snapshot.ownerLayoutWrites.filter((entry) => entry.phase === 'trusted-reverse-complete')).toHaveLength(1);
  expect(result.snapshot.revealEvents).toHaveLength(1);
  expect(result.snapshot.scrollTop).toBeGreaterThan(beforeWheel);
  expect(result.snapshot.mode).toBe('browsing');
  expect(coverageViolations(result.frames)).toEqual([]);
  expect(blankPaints(paint.paint), JSON.stringify(paint.paint)).toEqual([]);
  expect(result.snapshot.writers).toEqual([]);
});

test('bounded normal-flow slab: one top wait-to-reveal lifecycle survives continuous then reverse trusted wheel', async ({ page }, testInfo) => {
  const root = await openSlab(page);
  await root.focus();
  await page.keyboard.press('Home');
  await expect.poll(() => root.evaluate((node) => node.scrollTop)).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.foregroundSlab.clearFrames());
  const probe = await startPaintProbe(page, '#scroll-root');
  const waiting = await page.evaluate(() => window.foregroundSlab.snapshot());
  await page.waitForTimeout(120);
  const beforePrepare = await page.evaluate(() => window.foregroundSlab.snapshot());
  const preparedBatch = await page.evaluate(() => window.foregroundSlab.prepareBatch(8));
  const prepared = await page.evaluate(() => window.foregroundSlab.snapshot());
  const overlayAudit = await page.evaluate(() => {
    const rootNode = document.querySelector('#scroll-root');
    const bounds = rootNode.getBoundingClientRect();
    return [...rootNode.querySelectorAll('*')].flatMap((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const overlaps = rect.right > bounds.left && rect.left < bounds.right
        && rect.bottom > bounds.top && rect.top < bounds.bottom;
      return overlaps && ['fixed', 'absolute', 'sticky'].includes(style.position)
        ? [{ tag: node.tagName, className: node.className, position: style.position,
          background: style.backgroundColor, zIndex: style.zIndex }]
        : [];
    });
  });
  await page.evaluate(() => { window.foregroundSlab.revealPreparedAtTop(); });
  await page.waitForTimeout(24);
  const wheelPoint = await root.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  const inputCDP = await page.context().newCDPSession(page);
  await inputCDP.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...wheelPoint });
  await Promise.all([-480, -720, 420].map((deltaY) => inputCDP.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', ...wheelPoint, deltaX: 0, deltaY,
  })));
  await inputCDP.detach();
  await expect.poll(() => page.evaluate(() => window.foregroundSlab.snapshot().revealEvents.length)).toBe(1);
  const settled = await page.evaluate(() => window.foregroundSlab.snapshot());
  await page.waitForTimeout(260);
  const result = await page.evaluate(() => ({ snapshot: window.foregroundSlab.snapshot(), frames: window.foregroundSlab.takeFrames() }));
  const paint = await stopPaintProbe(page, probe, testInfo, 'slab-top-wait-continuous-reverse');
  await attachJSON(testInfo, 'slab-top-wait-continuous-reverse.json', {
    waiting, beforePrepare, preparedBatch, prepared, overlayAudit, settled, ...result, paint,
  });

  expect(beforePrepare.scrollHeight).toBe(waiting.scrollHeight);
  expect(prepared.scrollHeight).toBe(beforePrepare.scrollHeight);
  expect(prepared.prepared).toEqual([{ batch: preparedBatch.batch, count: 8 }]);
  expect(overlayAudit).toEqual([]);
  expect(result.snapshot.trustedInputs.map((entry) => entry.deltaY)).toEqual([-480, -720, 420]);
  expect(result.snapshot.trustedInputs.slice(0, 2).every((entry) => (
    entry.revealPhase === 'revealing' && entry.scrollTop <= 1 && entry.completedReveal === false
  ))).toBe(true);
  expect(result.snapshot.trustedInputs.at(-1)).toMatchObject({
    revealPhase: 'revealing', completedReveal: true, mode: 'browsing',
  });
  expect(result.snapshot.scrollTop).toBeGreaterThan(0);
  expect(result.snapshot.revealEvents).toHaveLength(1);
  expect(result.snapshot.revealEvents[0].reason).toBe('trusted-reverse-wheel');
  expect(result.snapshot.ownerLayoutWrites).toEqual(settled.ownerLayoutWrites);
  expect(result.snapshot.writers).toEqual([]);
  expect(coverageViolations(result.frames)).toEqual([]);
  expect(blankPaints(paint.paint), JSON.stringify(paint.paint)).toEqual([]);
});

test('bounded normal-flow slab: ten non-top batches retain semantic anchor and bounded DOM', async ({ page }, testInfo) => {
  const root = await openSlab(page);
  await root.focus();
  await page.mouse.wheel(0, -1_800);
  await page.waitForTimeout(60);
  await page.evaluate(() => {
    window.foregroundSlab.pinSelection('live-12');
    window.foregroundSlab.focus('live-12');
    window.foregroundSlab.clearFrames();
  });
  const probe = await startPaintProbe(page, '#scroll-root');
  const selectionBefore = await page.evaluate(() => window.foregroundSlab.snapshot().selection);
  const admissions = [];
  for (let batch = 0; batch < 10; batch += 1) {
    await page.evaluate(() => window.foregroundSlab.prepareBatch(8));
    admissions.push(await page.evaluate(() => window.foregroundSlab.admitPrepared()));
    await page.waitForTimeout(40);
    if (batch === 4) {
      await page.mouse.wheel(0, -900);
      await page.waitForTimeout(50);
      await page.mouse.wheel(0, 900);
    }
  }
  await page.waitForTimeout(160);
  const pinnedSnapshot = await page.evaluate(() => window.foregroundSlab.snapshot());
  await page.evaluate(() => window.foregroundSlab.unpin());
  await root.hover();
  for (let step = 0; step < 20; step += 1) {
    await page.mouse.wheel(0, -700);
    await page.waitForTimeout(32);
    if (await root.evaluate((node) => node.scrollTop <= 1)) break;
  }
  await expect.poll(() => page.evaluate(() => window.foregroundSlab.snapshot().range[0])).toBeLessThanOrEqual(1);
  const rematerializedTop = await page.evaluate(() => window.foregroundSlab.snapshot());
  for (let step = 0; step < 20; step += 1) {
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(32);
    if (await root.evaluate((node) => node.scrollTop >= node.scrollHeight - node.clientHeight - 1)) break;
  }
  await expect.poll(() => page.evaluate(() => {
    const state = window.foregroundSlab.snapshot();
    return state.range[1] >= state.units - 2;
  })).toBe(true);
  const result = await page.evaluate(() => ({ snapshot: window.foregroundSlab.snapshot(), frames: window.foregroundSlab.takeFrames() }));
  const paint = await stopPaintProbe(page, probe, testInfo, 'slab-ten-batches');
  await attachJSON(testInfo, 'slab-ten-batches.json', { admissions, selectionBefore, pinnedSnapshot, rematerializedTop, ...result, paint });
  expect(admissions.filter((entry) => entry.delta !== null).every((entry) => Math.abs(entry.delta) <= 1)).toBe(true);
  expect(pinnedSnapshot.selection.text).toBe(selectionBefore.text);
  expect(pinnedSnapshot.focusID).toBe('live-12');
  expect(rematerializedTop.range[0]).toBeLessThanOrEqual(1);
  expect(result.snapshot.writers).toEqual([]);
  expect(result.snapshot.peakUnits).toBeLessThanOrEqual(48);
  expect(coverageViolations(result.frames)).toEqual([]);
  expect(blankPaints(paint.paint), JSON.stringify(paint.paint)).toEqual([]);
});

test('bounded normal-flow slab: production-length fold expand/collapse has no white frame or reverse jump', async ({ page }, testInfo) => {
  const root = await openSlab(page);
  await root.hover();
  await page.mouse.wheel(0, -1_200);
  await page.waitForTimeout(80);
  const longRow = page.locator('[data-unit-id="live-12"]');
  await expect.poll(() => longRow.evaluate((node) => {
    const root = document.querySelector('#scroll-root').getBoundingClientRect();
    const row = node.getBoundingClientRect();
    return row.bottom > root.top && row.top < root.bottom;
  })).toBe(true);
  await page.evaluate(() => window.foregroundSlab.clearFrames());
  const probe = await startPaintProbe(page, '#scroll-root');
  const expand = await page.evaluate(() => window.foregroundSlab.setFold('live-12', false));
  await page.waitForTimeout(100);
  const collapse = await page.evaluate(() => window.foregroundSlab.setFold('live-12', true));
  await page.waitForTimeout(140);
  const result = await page.evaluate(() => ({ snapshot: window.foregroundSlab.snapshot(), frames: window.foregroundSlab.takeFrames() }));
  const paint = await stopPaintProbe(page, probe, testInfo, 'slab-fold');
  await attachJSON(testInfo, 'slab-fold.json', { expand, collapse, ...result, paint });
  expect(expand.after.bodyBottom).toBeGreaterThan(expand.before.firstTextBottom);
  expect(expand.after.rowTop).toBeGreaterThanOrEqual(expand.before.rowTop - 1);
  expect(collapse.nativeScrollDelta).toBeGreaterThanOrEqual(-collapse.necessaryClamp - 1);
  expect(coverageViolations(result.frames)).toEqual([]);
  expect(blankPaints(paint.paint), JSON.stringify(paint.paint)).toEqual([]);
  expect(result.snapshot.writers).toEqual([]);
});

test('bounded normal-flow slab: near-max collapse is exactly the necessary native clamp', async ({ page }, testInfo) => {
  const root = await openSlab(page);
  const target = page.locator('[data-unit-id="live-22"]');
  await expect.poll(() => target.evaluate((node) => {
    const viewport = document.querySelector('#scroll-root').getBoundingClientRect();
    const row = node.getBoundingClientRect();
    return row.bottom > viewport.top && row.top < viewport.bottom;
  })).toBe(true);
  await page.evaluate(() => window.foregroundSlab.clearFrames());
  const probe = await startPaintProbe(page, '#scroll-root');
  const expand = await page.evaluate(() => window.foregroundSlab.setFold('live-22', false));
  await root.focus();
  await page.keyboard.press('End');
  await expect.poll(() => root.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
  const atMax = await page.evaluate(() => window.foregroundSlab.snapshot());
  const collapse = await page.evaluate(() => window.foregroundSlab.setFold('live-22', true));
  await page.waitForTimeout(140);
  const result = await page.evaluate(() => ({ snapshot: window.foregroundSlab.snapshot(), frames: window.foregroundSlab.takeFrames() }));
  const paint = await stopPaintProbe(page, probe, testInfo, 'slab-near-max-clamp');
  await attachJSON(testInfo, 'slab-near-max-clamp.json', { expand, atMax, collapse, ...result, paint });

  expect(collapse.necessaryClamp).toBeGreaterThan(100);
  expect(Math.abs(collapse.nativeScrollDelta + collapse.necessaryClamp)).toBeLessThanOrEqual(1);
  expect(coverageViolations(result.frames)).toEqual([]);
  expect(blankPaints(paint.paint), JSON.stringify(paint.paint)).toEqual([]);
  expect(result.snapshot.writers).toEqual([]);
});

test('bounded normal-flow slab: detached image load and visible font resize remeasure before sealed reuse', async ({ page }, testInfo) => {
  await page.goto('/tests/browser/prototypes/foreground-slab/index.html');
  await page.waitForFunction(() => window.foregroundSlab?.snapshot()?.mountedIDs.includes('live-4'));
  const root = page.locator('#scroll-root');
  const initial = await page.evaluate(() => window.foregroundSlab.snapshot());
  await page.waitForTimeout(80);
  await root.focus();
  await page.keyboard.press('End');
  await expect.poll(() => page.evaluate(() => !window.foregroundSlab.snapshot().mountedIDs.includes('live-4'))).toBe(true);
  const evicted = await page.evaluate(() => window.foregroundSlab.snapshot());
  await page.evaluate(() => {
    window.foregroundSlab.clearFrames();
    window.foregroundSlab.clearDynamicEvidence();
  });
  const probe = await startPaintProbe(page, '#scroll-root');
  const detachedLoad = await page.evaluate(() => window.foregroundSlab.loadDetachedImage('live-4'));
  expect(detachedLoad.after.contentRevision).toBe(detachedLoad.before.contentRevision);
  expect(detachedLoad.after.sealed).toBe(detachedLoad.before.sealed);
  expect(detachedLoad.after.scrollHeight).toBe(detachedLoad.before.scrollHeight);

  await root.hover();
  for (let step = 0; step < 20; step += 1) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(34);
    if (await page.evaluate(() => window.foregroundSlab.snapshot().mountedIDs.includes('live-4'))) break;
  }
  await expect.poll(() => page.evaluate(() => window.foregroundSlab.snapshot().mountedIDs.includes('live-4'))).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const snapshot = window.foregroundSlab.snapshot();
    const event = snapshot.rematerializations.find((entry) => entry.id === 'live-4');
    return Boolean(event && event.measuredAfter > event.sealedBefore + 100);
  })).toBe(true);
  const safetyMounted = await page.evaluate(() => window.foregroundSlab.snapshot());
  const mediaRematerialization = safetyMounted.rematerializations.find((entry) => entry.id === 'live-4');
  expect(mediaRematerialization.visibleAtMount).toBe(false);
  const stableAnchorBefore = safetyMounted.anchor;
  await page.waitForTimeout(120);
  const stableAnchorAfter = await page.evaluate(() => window.foregroundSlab.snapshot().anchor);
  expect(stableAnchorAfter.id).toBe(stableAnchorBefore.id);
  expect(Math.abs(stableAnchorAfter.offset - stableAnchorBefore.offset)).toBeLessThanOrEqual(1);

  for (let step = 0; step < 12; step += 1) {
    const visible = await page.locator('[data-unit-id="live-4"]').evaluate((node) => {
      const viewport = document.querySelector('#scroll-root').getBoundingClientRect();
      const row = node.getBoundingClientRect();
      return row.bottom > viewport.top && row.top < viewport.bottom;
    }).catch(() => false);
    if (visible) break;
    await page.mouse.wheel(0, -180);
    await page.waitForTimeout(34);
  }
  await expect.poll(() => page.locator('[data-unit-id="live-4"]').evaluate((node) => {
    const viewport = document.querySelector('#scroll-root').getBoundingClientRect();
    const row = node.getBoundingClientRect();
    return row.bottom > viewport.top && row.top < viewport.bottom;
  })).toBe(true);
  const fontResize = await page.evaluate(() => window.foregroundSlab.changeFontScale('live-4', 1.35));
  await page.waitForTimeout(120);
  const result = await page.evaluate(() => ({ snapshot: window.foregroundSlab.snapshot(), frames: window.foregroundSlab.takeFrames() }));
  const paint = await stopPaintProbe(page, probe, testInfo, 'slab-late-media-font');
  await attachJSON(testInfo, 'slab-late-media-font.json', { initial, evicted, detachedLoad, safetyMounted, fontResize, ...result, paint });

  expect(fontResize.after.height).toBeGreaterThan(fontResize.before.height);
  expect(fontResize.after.anchor.id).toBe(fontResize.before.anchor.id);
  expect(Math.abs(fontResize.after.anchor.offset - fontResize.before.anchor.offset)).toBeLessThanOrEqual(1);
  expect(result.snapshot.dynamicEvents.some((entry) => entry.type === 'detached-image-loaded' && entry.mounted === false)).toBe(true);
  expect(coverageViolations(result.frames)).toEqual([]);
  expect(blankPaints(paint.paint), JSON.stringify(paint.paint)).toEqual([]);
  expect(result.snapshot.writers).toEqual([]);
  expect(result.snapshot.longTasks).toEqual([]);
});

test('bounded normal-flow slab: deep bookmark cancels stale work and restores from 100k metadata within budget', async ({ page }, testInfo) => {
  const root = await openSlab(page);
  await page.evaluate(() => window.foregroundSlab.clearFrames());
  const probe = await startPaintProbe(page, '#scroll-root');
  const metadataInstall = await page.evaluate(() => window.foregroundSlab.installMetadata(100_000));
  await page.waitForTimeout(80);
  const oldContent = await page.evaluate(() => window.foregroundSlab.snapshot());
  const cancelledRequest = await page.evaluate(() => window.foregroundSlab.requestBookmark('meta-75321', 180));
  const pending = await page.evaluate(() => window.foregroundSlab.snapshot());
  expect(pending.bookmark.status).toContain('meta-75321');
  expect(pending.bookmark.events.find((event) => event.token === cancelledRequest.token && event.type === 'request')?.mounted).toBe(false);
  expect(pending.writers).toEqual([]);
  await root.hover();
  await page.mouse.wheel(0, -240);
  await expect.poll(() => page.evaluate((token) => window.foregroundSlab.snapshot().bookmark.events
    .some((event) => event.type === 'cancel' && event.token === token), cancelledRequest.token)).toBe(true);
  await page.waitForTimeout(240);
  const afterCancel = await page.evaluate(() => window.foregroundSlab.snapshot());
  expect(afterCancel.bookmark.events.some((event) => event.type === 'position' && event.token === cancelledRequest.token)).toBe(false);
  expect(afterCancel.units).toBe(24);
  expect(afterCancel.mountedIDs.every((id) => id.startsWith('live-'))).toBe(true);
  expect(afterCancel.writers).toEqual([]);

  await root.focus();
  await page.keyboard.press('Home');
  await expect.poll(() => root.evaluate((node) => node.scrollTop)).toBeLessThanOrEqual(1);
  const acceptedRequest = await page.evaluate(() => window.foregroundSlab.requestBookmark('meta-75321', 0));
  await expect.poll(() => page.evaluate((token) => window.foregroundSlab.snapshot().bookmark.events
    .some((event) => event.type === 'position' && event.token === token), acceptedRequest.token)).toBe(true);
  await page.waitForTimeout(120);
  const result = await page.evaluate(() => ({ snapshot: window.foregroundSlab.snapshot(), frames: window.foregroundSlab.takeFrames() }));
  const paint = await stopPaintProbe(page, probe, testInfo, 'slab-bookmark-100k');
  const timings = result.snapshot.reconcileTimings.map((entry) => entry.duration).sort((left, right) => left - right);
  const reconcile = {
    count: timings.length,
    p95: timings.length ? timings[Math.min(timings.length - 1, Math.floor(timings.length * 0.95))] : 0,
    max: timings.at(-1) || 0,
  };
  await attachJSON(testInfo, 'slab-bookmark-100k.json', {
    metadataInstall, oldContent, cancelledRequest, pending, afterCancel, acceptedRequest, reconcile, ...result, paint,
  });

  const ready = result.snapshot.bookmark.events.find((event) => event.type === 'ready' && event.token === acceptedRequest.token);
  const position = result.snapshot.bookmark.events.find((event) => event.type === 'position' && event.token === acceptedRequest.token);
  expect(ready.positionWriterCount).toBe(0);
  expect(position.positionWriterCount).toBe(0);
  expect(position.targetID).toBe('meta-75321');
  expect(position.exactActivation).toBe(true);
  expect(position.exactSourceRevision).toBe(true);
  expect(position.sameObjects).toBe(true);
  expect(Math.abs(position.targetOffset - 1)).toBeLessThanOrEqual(1);
  expect(result.snapshot.metadata.count).toBe(100_000);
  expect(metadataInstall.approximateBytes).toBeLessThanOrEqual(5_000_000);
  expect(metadataInstall.duration).toBeLessThanOrEqual(50);
  expect(result.snapshot.peakUnits).toBeLessThanOrEqual(48);
  expect(result.snapshot.peakElements).toBeLessThanOrEqual(500);
  expect(reconcile.p95).toBeLessThanOrEqual(4);
  expect(reconcile.max).toBeLessThanOrEqual(16);
  expect(result.snapshot.longTasks).toEqual([]);
  expect(coverageViolations(result.frames)).toEqual([]);
  expect(blankPaints(paint.paint), JSON.stringify(paint.paint)).toEqual([]);
  expect(result.snapshot.writers).toEqual([]);
});

test('bounded normal-flow slab: chunked 100k metadata stays outside extent and permits trusted pre-ready cancel', async ({ page }, testInfo) => {
  const root = await openSlab(page);
  await page.evaluate(() => window.foregroundSlab.clearFrames());
  const beforePrepare = await page.evaluate(() => window.foregroundSlab.snapshot());
  const probe = await startPaintProbe(page, '#scroll-root');
  const cancelledRequest = await page.evaluate(() => {
    window.__chunkInstallPromise = window.foregroundSlab.installMetadataChunked(100_000, 2_000);
    return window.foregroundSlab.requestBookmark('meta-75321', 500);
  });
  const whilePreparing = await page.evaluate(() => window.foregroundSlab.snapshot());
  expect(whilePreparing.metadata.count).toBe(0);
  expect(whilePreparing.bookmark.status).toContain('meta-75321');
  await root.hover();
  // At the bottom, a positive trusted wheel cancels restore without changing geometry.
  await page.mouse.wheel(0, 240);
  await expect.poll(() => page.evaluate((token) => window.foregroundSlab.snapshot().bookmark.events
    .some((event) => event.type === 'cancel' && event.token === token), cancelledRequest.token)).toBe(true);
  const metadataInstall = await page.evaluate(() => window.__chunkInstallPromise);
  await page.waitForTimeout(540);
  const afterReady = await page.evaluate(() => window.foregroundSlab.snapshot());
  expect(afterReady.bookmark.events.some((event) => event.type === 'position' && event.token === cancelledRequest.token)).toBe(false);

  await root.focus();
  await page.keyboard.press('Home');
  await expect.poll(() => root.evaluate((node) => node.scrollTop)).toBeLessThanOrEqual(1);
  const acceptedRequest = await page.evaluate(() => window.foregroundSlab.requestBookmark('meta-75321', 0));
  await expect.poll(() => page.evaluate((token) => window.foregroundSlab.snapshot().bookmark.events
    .some((event) => event.type === 'position' && event.token === token), acceptedRequest.token)).toBe(true);
  await page.waitForTimeout(120);
  const result = await page.evaluate(() => ({ snapshot: window.foregroundSlab.snapshot(), frames: window.foregroundSlab.takeFrames() }));
  const paint = await stopPaintProbe(page, probe, testInfo, 'slab-bookmark-100k-chunked');
  const timings = result.snapshot.reconcileTimings.map((entry) => entry.duration).sort((left, right) => left - right);
  const reconcile = {
    count: timings.length,
    p95: timings.length ? timings[Math.min(timings.length - 1, Math.floor(timings.length * 0.95))] : 0,
    max: timings.at(-1) || 0,
  };
  const evidence = {
    beforePrepare, whilePreparing, cancelledRequest, metadataInstall, afterReady,
    acceptedRequest, reconcile, ...result, paint,
  };
  await attachJSON(testInfo, 'slab-bookmark-100k-chunked.json', evidence);

  const position = result.snapshot.bookmark.events.find((event) => event.type === 'position' && event.token === acceptedRequest.token);
  expect(metadataInstall.chunkMax).toBeLessThanOrEqual(8);
  expect(metadataInstall.scrollHeightAfter).toBe(metadataInstall.scrollHeightBefore);
  expect(metadataInstall.reconcileDelta).toBe(0);
  expect(afterReady.units).toBe(beforePrepare.units);
  expect(afterReady.mountedIDs.every((id) => id.startsWith('live-'))).toBe(true);
  expect(position.exactActivation).toBe(true);
  expect(position.exactSourceRevision).toBe(true);
  expect(position.sameObjects).toBe(true);
  expect(Math.abs(position.targetOffset - 1)).toBeLessThanOrEqual(1);
  expect(result.snapshot.metadata.count).toBe(100_000);
  expect(metadataInstall.approximateBytes).toBeLessThanOrEqual(5_000_000);
  expect(result.snapshot.peakUnits).toBeLessThanOrEqual(48);
  expect(result.snapshot.peakElements).toBeLessThanOrEqual(500);
  expect(reconcile.max).toBeLessThanOrEqual(8);
  expect(result.snapshot.longTasks.filter((entry) => entry.duration > 50)).toEqual([]);
  expect(coverageViolations(result.frames)).toEqual([]);
  expect(blankPaints(paint.paint), JSON.stringify(paint.paint)).toEqual([]);
  expect(result.snapshot.writers).toEqual([]);
});

test('bounded normal-flow slab: explicit first-full-text native anchor survives active font reflow', async ({ page }, testInfo) => {
  await page.goto('/tests/browser/prototypes/foreground-slab/index.html');
  await page.waitForFunction(() => window.foregroundSlab?.snapshot()?.mountedIDs.includes('live-4'));
  const root = page.locator('#scroll-root');
  await root.focus();
  await page.keyboard.press('End');
  await expect.poll(() => page.evaluate(() => !window.foregroundSlab.snapshot().mountedIDs.includes('live-4'))).toBe(true);
  await page.evaluate(() => {
    window.foregroundSlab.clearFrames();
    window.foregroundSlab.clearDynamicEvidence();
  });
  const probe = await startPaintProbe(page, '#scroll-root');
  await page.evaluate(() => window.foregroundSlab.loadDetachedImage('live-4'));
  await root.hover();
  for (let step = 0; step < 28; step += 1) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(34);
    const ready = await page.evaluate(() => {
      const viewport = document.querySelector('#scroll-root').getBoundingClientRect();
      const partial = document.querySelector('[data-unit-id="live-4"]')?.getBoundingClientRect();
      const full = document.querySelector('[data-unit-id="live-5"]')?.getBoundingClientRect();
      return Boolean(partial && full
        && partial.top < viewport.top && partial.bottom > viewport.top
        && full.top >= viewport.top && full.bottom <= viewport.bottom);
    });
    if (ready) break;
  }
  await expect.poll(() => page.evaluate(() => {
    const viewport = document.querySelector('#scroll-root').getBoundingClientRect();
    const partial = document.querySelector('[data-unit-id="live-4"]')?.getBoundingClientRect();
    const full = document.querySelector('[data-unit-id="live-5"]')?.getBoundingClientRect();
    return Boolean(partial && full
      && partial.top < viewport.top && partial.bottom > viewport.top
      && full.top >= viewport.top && full.bottom <= viewport.bottom);
  })).toBe(true);
  const anchorBefore = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.conversation-unit')];
    for (const row of rows) row.style.overflowAnchor = 'none';
    document.querySelector('#top-spacer').style.overflowAnchor = 'none';
    document.querySelector('#bottom-spacer').style.overflowAnchor = 'none';
    const anchorRow = document.querySelector('[data-unit-id="live-5"]');
    anchorRow.style.overflowAnchor = 'auto';
    for (const child of anchorRow.children) child.style.overflowAnchor = 'none';
    const text = anchorRow.querySelector('.unit-body');
    text.style.overflowAnchor = 'auto';
    const range = document.createRange();
    range.setStart(text.firstChild, 0);
    range.setEnd(text.firstChild, 1);
    const viewport = document.querySelector('#scroll-root').getBoundingClientRect();
    const partial = document.querySelector('[data-unit-id="live-4"]').getBoundingClientRect();
    const full = anchorRow.getBoundingClientRect();
    const point = range.getBoundingClientRect();
    return {
      id: 'live-5', text: text.firstChild.textContent.slice(0, 24),
      pointY: point.top - viewport.top,
      partial: { top: partial.top - viewport.top, bottom: partial.bottom - viewport.top },
      full: { top: full.top - viewport.top, bottom: full.bottom - viewport.top },
      scrollTop: document.querySelector('#scroll-root').scrollTop,
    };
  });
  const fontResize = await page.evaluate(() => window.foregroundSlab.changeFontScale('live-4', 1.35));
  const anchorAfter = await page.evaluate(() => {
    const anchorRow = document.querySelector('[data-unit-id="live-5"]');
    const text = anchorRow.querySelector('.unit-body');
    const range = document.createRange();
    range.setStart(text.firstChild, 0);
    range.setEnd(text.firstChild, 1);
    const viewport = document.querySelector('#scroll-root').getBoundingClientRect();
    return {
      id: 'live-5', text: text.firstChild.textContent.slice(0, 24),
      pointY: range.getBoundingClientRect().top - viewport.top,
      scrollTop: document.querySelector('#scroll-root').scrollTop,
    };
  });
  await page.waitForTimeout(120);
  const result = await page.evaluate(() => ({ snapshot: window.foregroundSlab.snapshot(), frames: window.foregroundSlab.takeFrames() }));
  const paint = await stopPaintProbe(page, probe, testInfo, 'slab-explicit-text-anchor-font');
  await attachJSON(testInfo, 'slab-explicit-text-anchor-font.json', { anchorBefore, fontResize, anchorAfter, ...result, paint });

  expect(anchorAfter.id).toBe(anchorBefore.id);
  expect(anchorAfter.text).toBe(anchorBefore.text);
  expect(Math.abs(anchorAfter.pointY - anchorBefore.pointY)).toBeLessThanOrEqual(1);
  expect(coverageViolations(result.frames)).toEqual([]);
  expect(blankPaints(paint.paint), JSON.stringify(paint.paint)).toEqual([]);
  expect(result.snapshot.writers).toEqual([]);
});
