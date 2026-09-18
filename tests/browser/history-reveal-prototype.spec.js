import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const fixturePath = '/tests/browser/fixtures/history-reveal-prototype.html';

async function sourceFingerprint() {
  const paths = [
    'tests/browser/fixtures/history-reveal-prototype.html',
    'tests/browser/fixtures/history-reveal-prototype.jsx',
    'tests/browser/history-reveal-prototype.spec.js',
    'package-lock.json',
  ];
  const hash = createHash('sha256');
  for (const path of paths) hash.update(path).update('\0').update(await readFile(path));
  return { paths, digest: hash.digest('hex') };
}

async function openFixture(page) {
  await page.goto(fixturePath);
  await page.waitForFunction(() => Boolean(window.historyRevealPrototype?.root()));
  await page.waitForFunction(() => document.querySelectorAll('[data-current-row]').length > 0);
  await page.waitForTimeout(80);
}

async function installProbe(page, name) {
  await page.evaluate((scenario) => {
    const root = window.historyRevealPrototype.root();
    const nodeIDs = new WeakMap();
    let nextNodeID = 0;
    let running = true;
    const frames = [];
    const writes = [];
    const events = [];
    const mutations = [];
    const nodeID = (node) => {
      if (!node) return null;
      if (!nodeIDs.has(node)) nodeIDs.set(node, ++nextNodeID);
      return nodeIDs.get(node);
    };
    const recordWrite = (method, args) => writes.push({
      at: performance.now(), method, args: [...args], stack: new Error().stack,
    });
    const nativeScrollTo = root.scrollTo.bind(root);
    const nativeScrollBy = root.scrollBy.bind(root);
    root.scrollTo = (...args) => { recordWrite('scrollTo', args); return nativeScrollTo(...args); };
    root.scrollBy = (...args) => { recordWrite('scrollBy', args); return nativeScrollBy(...args); };
    const scrollTopDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    if (scrollTopDescriptor?.get && scrollTopDescriptor?.set) {
      Object.defineProperty(root, 'scrollTop', {
        configurable: true,
        get: () => scrollTopDescriptor.get.call(root),
        set: (value) => {
          recordWrite('scrollTop=', [value]);
          scrollTopDescriptor.set.call(root, value);
        },
      });
    }
    const wheel = (event) => events.push({
      type: 'wheel', at: performance.now(), trusted: event.isTrusted,
      deltaX: event.deltaX, deltaY: event.deltaY, scrollTop: root.scrollTop,
    });
    root.addEventListener('wheel', wheel, { capture: true, passive: true });
    const observer = new MutationObserver((records) => {
      for (const record of records) mutations.push({
        at: performance.now(),
        target: record.target instanceof Element ? record.target.className : record.target.nodeName,
        added: [...record.addedNodes].map((node) => node instanceof Element
          ? { node: node.tagName, className: node.className, id: nodeID(node) }
          : { node: node.nodeName }),
        removed: [...record.removedNodes].map((node) => node instanceof Element
          ? { node: node.tagName, className: node.className, id: nodeID(node) }
          : { node: node.nodeName }),
      });
    });
    observer.observe(root, { childList: true, subtree: true });
    const sample = () => {
      if (!running) return;
      const prefix = root.querySelector('.history-reveal-prefix');
      const status = root.querySelector('.history-reveal-status');
      const clip = root.querySelector('.history-reveal-clip');
      const firstCurrent = root.querySelector('[data-current-row]');
      const prefixRect = prefix?.getBoundingClientRect();
      const currentRect = firstCurrent?.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const clipStyle = clip ? getComputedStyle(clip) : null;
      const snapshot = window.historyRevealPrototype.snapshot();
      frames.push({
        at: performance.now(),
        phase: snapshot.phase,
        status: snapshot.status,
        rootID: nodeID(root),
        prefixID: nodeID(prefix),
        statusID: nodeID(status),
        clipID: nodeID(clip),
        firstCurrentID: nodeID(firstCurrent),
        firstCurrentKey: firstCurrent?.dataset.currentRow || '',
        rootTop: rootRect.top,
        scrollTop: root.scrollTop,
        scrollHeight: root.scrollHeight,
        clientHeight: root.clientHeight,
        prefixHeight: prefixRect?.height || 0,
        clipHeight: clip?.getBoundingClientRect().height || 0,
        clipBlockSize: clipStyle?.blockSize || '',
        clipDuration: clipStyle?.transitionDuration || '',
        firstCurrentTop: currentRect?.top ?? null,
        renderedCurrent: root.querySelectorAll('[data-current-row]').length,
        renderedHistory: root.querySelectorAll('[data-history-unit]').length,
        active: snapshot.active,
        queued: snapshot.queued,
        committed: snapshot.committed,
        offDOMCount: snapshot.offDOMCount,
        range: snapshot.range,
      });
      requestAnimationFrame(sample);
    };
    window.__historyRevealProbe = {
      mark(label, detail = {}) { events.push({ type: 'mark', label, at: performance.now(), ...detail }); },
      stop() {
        running = false;
        observer.disconnect();
        root.removeEventListener('wheel', wheel, { capture: true });
        root.scrollTo = nativeScrollTo;
        root.scrollBy = nativeScrollBy;
        delete root.scrollTop;
        return { scenario, frames, writes, events, mutations };
      },
    };
    events.push({ type: 'mark', label: 'probe-start', at: performance.now() });
    requestAnimationFrame(sample);
  }, name);
}

async function startPaintCapture(page) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (event) => {
    frames.push({
      atEpochMs: Number(event.metadata?.timestamp || 0) * 1_000,
      metadata: event.metadata,
      jpegBase64: event.data,
    });
    await cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg', quality: 90, maxWidth: 800, maxHeight: 640, everyNthFrame: 1,
  });
  return {
    frames,
    async stop() { await cdp.send('Page.stopScreencast'); },
  };
}

async function analysePaints(page, paints) {
  return page.evaluate(async (jpegFrames) => {
    const decode = (base64) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = `data:image/jpeg;base64,${base64}`;
    });
    const output = [];
    for (let index = 0; index < jpegFrames.length; index += 1) {
      const image = await decode(jpegFrames[index]);
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(760, image.naturalWidth);
      canvas.height = Math.min(600, image.naturalHeight);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let darkPixels = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset] < 220 || pixels[offset + 1] < 220 || pixels[offset + 2] < 220) darkPixels += 1;
      }
      output.push({ index, width: canvas.width, height: canvas.height, darkPixels });
    }
    return output;
  }, paints.map((frame) => frame.jpegBase64));
}

async function persistTrajectory(testInfo, name, result, paints) {
  await mkdir(testInfo.outputDir, { recursive: true });
  const paintManifest = [];
  for (let index = 0; index < paints.length; index += 1) {
    const resourceName = `${name}-paint-${String(index).padStart(3, '0')}.jpeg`;
    const path = testInfo.outputPath(resourceName);
    await writeFile(path, Buffer.from(paints[index].jpegBase64, 'base64'));
    paintManifest.push({ index, resourceName, atEpochMs: paints[index].atEpochMs, metadata: paints[index].metadata });
  }
  const artifact = { ...result, paintFrames: paintManifest };
  const path = testInfo.outputPath(`${name}.json`);
  await writeFile(path, JSON.stringify(artifact, null, 2));
  await testInfo.attach(`${name}.json`, { path, contentType: 'application/json' });
  for (const frame of paintManifest) await testInfo.attach(frame.resourceName, {
    path: testInfo.outputPath(frame.resourceName), contentType: 'image/jpeg',
  });
  return artifact;
}

function uniqueRounded(values) {
  return [...new Set(values.filter(Number.isFinite).map((value) => Math.round(value)))];
}

test('normal-flow history reveal prototype has one spatial owner and no blank paint', async ({ page }, testInfo) => {
  await openFixture(page);
  await installProbe(page, 'animated-queued-batches');
  const capture = await startPaintCapture(page);
  await page.evaluate(() => {
    window.__historyRevealProbe.mark('deliver-first');
    window.historyRevealPrototype.deliver(4, 'alpha');
  });
  await page.waitForFunction(() => window.historyRevealPrototype.snapshot().phase === 'revealing');
  await page.evaluate(() => {
    window.__historyRevealProbe.mark('deliver-during-reveal');
    window.historyRevealPrototype.deliver(3, 'beta');
  });
  await page.waitForFunction(() => {
    const snapshot = window.historyRevealPrototype.snapshot();
    return snapshot.phase === 'committed' && snapshot.committed.length === 7;
  });
  await page.waitForTimeout(80);
  await capture.stop();
  const probe = await page.evaluate(() => window.__historyRevealProbe.stop());
  const final = await page.evaluate(() => window.historyRevealPrototype.snapshot());
  const paintAnalysis = await analysePaints(page, capture.frames);
  const revealFrames = probe.frames.filter((frame) => frame.phase === 'revealing');
  const currentTops = probe.frames.map((frame) => frame.firstCurrentTop).filter(Number.isFinite);
  const backwardCurrentSteps = currentTops.slice(1).filter((top, index) => top < currentTops[index] - 0.5);
  const result = await persistTrajectory(testInfo, 'history-reveal-animated', {
    source: await sourceFingerprint(), probe, final, paintAnalysis,
    oracle: {
      distinctRevealHeights: uniqueRounded(revealFrames.map((frame) => frame.clipHeight)),
      distinctStatusIDs: [...new Set(probe.frames.map((frame) => frame.statusID))],
      distinctPrefixIDs: [...new Set(probe.frames.map((frame) => frame.prefixID))],
      blankPaints: paintAnalysis.filter((frame) => frame.darkPixels < 100),
      emptyRanges: probe.frames.filter((frame) => !frame.range || frame.renderedCurrent === 0),
      maxForegroundUnits: Math.max(...probe.frames.map((frame) => frame.renderedHistory)),
      currentTopStart: currentTops[0],
      currentTopEnd: currentTops.at(-1),
      backwardCurrentSteps,
    },
  }, capture.frames);

  expect(result.probe.writes).toEqual([]);
  expect(result.oracle.distinctStatusIDs).toHaveLength(1);
  expect(result.oracle.distinctPrefixIDs).toHaveLength(1);
  expect(result.oracle.distinctRevealHeights.length).toBeGreaterThanOrEqual(3);
  expect(result.oracle.blankPaints).toEqual([]);
  expect(result.oracle.emptyRanges).toEqual([]);
  expect(result.oracle.maxForegroundUnits).toBeLessThanOrEqual(24);
  expect(result.oracle.currentTopEnd - result.oracle.currentTopStart).toBeGreaterThan(400);
  expect(result.oracle.backwardCurrentSteps).toEqual([]);
  expect(result.final).toMatchObject({ committed: expect.arrayContaining(['alpha-1', 'beta-5']), offDOMCount: 0 });
  expect(result.probe.frames.every((frame) => frame.scrollTop === 0)).toBe(true);
});

test('trusted wheel takes over an active reveal without replay or scroll compensation', async ({ page }, testInfo) => {
  await openFixture(page);
  await installProbe(page, 'trusted-wheel-takeover');
  const capture = await startPaintCapture(page);
  await page.evaluate(() => window.historyRevealPrototype.deliver(8, 'wheel'));
  await page.waitForFunction(() => {
    const snapshot = window.historyRevealPrototype.snapshot();
    return snapshot.phase === 'revealing' && snapshot.clipHeight > 30 && snapshot.clipHeight < snapshot.targetHeight;
  });
  await page.mouse.move(380, 260);
  await page.mouse.wheel(0, 220);
  await page.waitForFunction(() => window.historyRevealPrototype.snapshot().phase === 'committed');
  await page.waitForTimeout(180);
  await capture.stop();
  const probe = await page.evaluate(() => window.__historyRevealProbe.stop());
  const final = await page.evaluate(() => window.historyRevealPrototype.snapshot());
  const paintAnalysis = await analysePaints(page, capture.frames);
  const wheelEvent = probe.events.find((event) => event.type === 'wheel');
  const afterWheel = wheelEvent ? probe.frames.filter((frame) => frame.at >= wheelEvent.at) : [];
  const result = await persistTrajectory(testInfo, 'history-reveal-wheel-takeover', {
    source: await sourceFingerprint(), probe, final, paintAnalysis,
    oracle: {
      wheelEvent,
      postWheelScrollTops: uniqueRounded(afterWheel.map((frame) => frame.scrollTop)),
      postWheelInstantFrames: afterWheel.filter((frame) => frame.clipDuration === '0s').length,
      blankPaints: paintAnalysis.filter((frame) => frame.darkPixels < 100),
    },
  }, capture.frames);

  expect(result.oracle.wheelEvent?.trusted).toBe(true);
  expect(result.probe.writes).toEqual([]);
  expect(Math.max(...result.oracle.postWheelScrollTops)).toBeGreaterThan(0);
  expect(result.oracle.postWheelInstantFrames).toBeGreaterThan(0);
  expect(result.oracle.blankPaints).toEqual([]);
  expect(result.final.phase).toBe('committed');
});

test('status identity, background isolation, bounded queue, and reduced motion stay explicit', async ({ page }, testInfo) => {
  await openFixture(page);
  await page.evaluate(() => { window.__historyStableStatusNode = document.querySelector('.history-reveal-status'); });
  const initial = await page.evaluate(() => window.historyRevealPrototype.snapshot());
  await page.evaluate(() => window.historyRevealPrototype.error());
  await page.waitForFunction(() => window.historyRevealPrototype.snapshot().status === 'error');
  const error = await page.evaluate(() => window.historyRevealPrototype.snapshot());
  await page.evaluate(() => window.historyRevealPrototype.eof());
  await page.waitForFunction(() => window.historyRevealPrototype.snapshot().status === 'eof');
  const eof = await page.evaluate(() => window.historyRevealPrototype.snapshot());
  const statusIdentityStable = await page.evaluate(() => (
    window.__historyStableStatusNode === document.querySelector('.history-reveal-status')
  ));
  await page.evaluate(() => window.historyRevealPrototype.scrollMiddle());
  await page.waitForTimeout(80);
  await installProbe(page, 'background-and-reduced-motion');
  const capture = await startPaintCapture(page);
  await page.evaluate(() => window.historyRevealPrototype.appendBackground());
  await page.waitForTimeout(120);
  const beforeReduced = await page.evaluate(() => window.historyRevealPrototype.snapshot());
  await page.evaluate(async () => {
    window.historyRevealPrototype.setReduced(true);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    window.__historyRevealProbe.mark('reduced-deliver');
    window.historyRevealPrototype.deliver(30, 'reduced');
  });
  await page.waitForFunction(() => window.historyRevealPrototype.snapshot().phase === 'committed');
  await page.waitForTimeout(80);
  await capture.stop();
  const probe = await page.evaluate(() => window.__historyRevealProbe.stop());
  const final = await page.evaluate(() => window.historyRevealPrototype.snapshot());
  const paintAnalysis = await analysePaints(page, capture.frames);
  const backgroundFrames = probe.frames.filter((frame) => frame.at < (probe.events.find((event) => event.label === 'reduced-deliver')?.at || -1));
  const result = await persistTrajectory(testInfo, 'history-reveal-status-reduced', {
    source: await sourceFingerprint(), initial, error, eof, beforeReduced, probe, final, paintAnalysis,
    oracle: {
      statusHeights: [initial.prefixHeight, error.prefixHeight, eof.prefixHeight],
      statusIdentityStable,
      statusIDs: uniqueRounded(probe.frames.map((frame) => frame.statusID)),
      animatedIntermediateFrames: probe.frames.filter((frame) => frame.phase === 'revealing' && frame.clipDuration !== '0s'),
      blankPaints: paintAnalysis.filter((frame) => frame.darkPixels < 100),
      maxRenderedHistory: Math.max(...probe.frames.map((frame) => frame.renderedHistory)),
      backgroundFrames,
    },
  }, capture.frames);

  expect(new Set(result.oracle.statusHeights.map(Math.round)).size).toBe(1);
  expect(result.oracle.statusIdentityStable).toBe(true);
  expect(result.probe.writes).toEqual([]);
  expect(new Set(result.oracle.backgroundFrames.map((frame) => frame.phase))).toEqual(new Set(['eof']));
  expect(new Set(result.oracle.backgroundFrames.map((frame) => Math.round(frame.prefixHeight))).size).toBe(1);
  expect(Math.max(...result.oracle.backgroundFrames.map((frame) => frame.scrollTop))
    - Math.min(...result.oracle.backgroundFrames.map((frame) => frame.scrollTop))).toBeLessThanOrEqual(1);
  expect(result.oracle.animatedIntermediateFrames).toEqual([]);
  expect(result.oracle.blankPaints).toEqual([]);
  expect(result.oracle.maxRenderedHistory).toBeLessThanOrEqual(24);
  expect(result.final).toMatchObject({ committed: expect.any(Array), offDOMCount: 6 });
  expect(result.final.committed).toHaveLength(24);
});

test('activation replacement drops an in-flight reveal token without replay', async ({ page }, testInfo) => {
  await openFixture(page);
  await installProbe(page, 'activation-replacement');
  const capture = await startPaintCapture(page);
  await page.evaluate(() => window.historyRevealPrototype.deliver(6, 'obsolete'));
  await page.waitForFunction(() => {
    const snapshot = window.historyRevealPrototype.snapshot();
    return snapshot.phase === 'revealing' && snapshot.clipHeight > 20;
  });
  await page.evaluate(() => window.historyRevealPrototype.switchActivation());
  await page.waitForFunction(() => {
    const snapshot = window.historyRevealPrototype.snapshot();
    return snapshot.activation === 2 && snapshot.phase === 'loading' && snapshot.renderedUnits === 0;
  });
  await page.waitForTimeout(360);
  await capture.stop();
  const probe = await page.evaluate(() => window.__historyRevealProbe.stop());
  const final = await page.evaluate(() => window.historyRevealPrototype.snapshot());
  const paintAnalysis = await analysePaints(page, capture.frames);
  const result = await persistTrajectory(testInfo, 'history-reveal-activation-replacement', {
    source: await sourceFingerprint(), probe, final, paintAnalysis,
    oracle: {
      obsoleteCommits: probe.frames.filter((frame) => frame.committed.some((id) => id.startsWith('obsolete-'))),
      blankPaints: paintAnalysis.filter((frame) => frame.darkPixels < 100),
    },
  }, capture.frames);

  expect(result.probe.writes).toEqual([]);
  expect(result.oracle.obsoleteCommits).toEqual([]);
  expect(result.oracle.blankPaints).toEqual([]);
  expect(result.final).toMatchObject({ activation: 2, phase: 'loading', committed: [], active: [], queued: [] });
});
