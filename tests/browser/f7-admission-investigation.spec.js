import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const scenarios = [
  { id: 'atomic-30-control', action: 'atomic' },
  { id: 'sequential-30-public-ack', action: 'sequential' },
  { id: 'single-extreme-folded', action: 'extreme-folded' },
  { id: 'single-extreme-expanded', action: 'extreme-expanded' },
  { id: 'single-late-media-growth', action: 'late-media' },
];

async function openAtHistoryEdge(page) {
  await page.goto('/tests/browser/fixtures/admission-viewport.html');
  await page.waitForFunction(() => window.admissionFixture?.anchor().id);
  // Initial tail positioning completes asynchronously. Match the established
  // production fixture precondition before taking reading ownership.
  await page.waitForTimeout(120);
  await page.evaluate(async () => {
    window.admissionFixture.scroll(-100_000_000);
    window.admissionFixture.scroll(2_500);
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    window.__ATOLL_DIAGNOSTICS__.reading.enable({ case: 'admission-investigation' });
    window.__ATOLL_DIAGNOSTICS__.reading.clear();
  });
  return page.evaluate(async () => {
    const samples = [];
    for (let index = 0; index < 3; index += 1) {
      await new Promise(requestAnimationFrame);
      samples.push(window.admissionFixture.geometry());
    }
    return samples;
  });
}

async function waitForPublicAck(page, revision, afterSequence) {
  const started = Date.now();
  const result = await page.waitForFunction(({ expectedRevision, baseline }) => {
    const entries = window.__ATOLL_DIAGNOSTICS__.reading.snapshot().entries;
    const owner = entries.find((entry) => entry.sequence > baseline
      && entry.event === 'reading.owner-commit'
      && Number(entry.detail?.snapshotRevision) === expectedRevision);
    if (!owner) return null;
    const height = entries.find((entry) => entry.sequence > owner.sequence && entry.event === 'reading.total-height');
    if (!height) return null;
    const range = entries.find((entry) => entry.sequence > owner.sequence && entry.event === 'reading.range');
    if (!range) return null;
    return { owner, height, range };
  }, { expectedRevision: revision, baseline: afterSequence }, { timeout: 2_000 }).then((handle) => handle.jsonValue(), () => null);
  return { elapsedMs: Date.now() - started, result };
}

async function installDomProbe(page) {
  await page.evaluate(() => {
    const root = document.querySelector('.timeline-message-list');
    const frames = [];
    let running = true;
    const sample = () => {
      if (!running) return;
      const bounds = root.getBoundingClientRect();
      const visible = [...root.querySelectorAll('[data-presentation-row-id]')].flatMap((row) => {
        const rect = row.getBoundingClientRect();
        return rect.bottom > bounds.top && rect.top < bounds.bottom
          ? [{ id: row.dataset.presentationRowId || '', top: rect.top - bounds.top, bottom: rect.bottom - bounds.top }]
          : [];
      });
      frames.push({
        at: performance.now(),
        scrollTop: root.scrollTop,
        scrollHeight: root.scrollHeight,
        visible,
        itemCount: root.querySelectorAll('[data-item-index]').length,
      });
      requestAnimationFrame(sample);
    };
    window.__admissionProbe = { stop() { running = false; return frames; } };
    requestAnimationFrame(sample);
  });
}

async function analyzePaint(page, frames) {
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
      canvas.width = image.naturalWidth;
      canvas.height = Math.min(600, image.naturalHeight);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let darkPixels = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset] < 220 || pixels[offset + 1] < 220 || pixels[offset + 2] < 220) darkPixels += 1;
      }
      output.push({ index, darkPixels, width: canvas.width, height: canvas.height });
    }
    return output;
  }, frames.map((frame) => frame.jpegBase64));
}

test('A: single-root admission public ack prerequisites', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const report = [];
  for (const scenario of scenarios) {
    const scenarioStartedAt = Date.now();
    const initialStability = await openAtHistoryEdge(page);
    const openingAnchor = await page.evaluate(() => window.admissionFixture.anchor());
    await installDomProbe(page);
    const cdp = await page.context().newCDPSession(page);
    const screencast = [];
    cdp.on('Page.screencastFrame', async (event) => {
      screencast.push({
        epochMs: Number(event.metadata?.timestamp || 0) * 1_000,
        metadata: event.metadata,
        jpegBase64: event.data,
      });
      await cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1_280, maxHeight: 720, everyNthFrame: 1 });
    await page.waitForTimeout(40);
    await page.mouse.move(320, 260);
    await page.mouse.wheel(0, -2_700);
    await page.waitForTimeout(16);
    const preAdmission = await page.evaluate(async () => {
      await new Promise(requestAnimationFrame);
      return {
        epochMs: Date.now(),
        anchor: window.admissionFixture.anchor(),
        geometry: window.admissionFixture.geometry(),
      };
    });
    expect(preAdmission.anchor.id).toBe('row-0');
    expect(preAdmission.geometry.scrollTop).toBeLessThanOrEqual(1);
    expect(preAdmission.geometry.visible.length).toBeGreaterThan(0);

    const admissions = [];
    const invokeAndAck = async (expression, argument) => {
      const before = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.snapshot().entries.at(-1)?.sequence || 0);
      const committed = await page.evaluate(({ method, value }) => window.admissionFixture[method](...(value || [])), { method: expression, value: argument });
      const ack = await waitForPublicAck(page, committed.revision, before);
      admissions.push({ committed, ack });
      return ack;
    };

    if (scenario.action === 'atomic') {
      await invokeAndAck('atomicPrepend', []);
    } else if (scenario.action === 'sequential') {
      // Reverse insertion order produces the exact same final old-0..old-29
      // data as the atomic control while exposing one root per React commit.
      for (let index = 29; index >= 0; index -= 1) {
        await invokeAndAck('prependOne', [index]);
        if (index % 5 === 0) await page.mouse.wheel(0, -480);
      }
    } else if (scenario.action === 'extreme-folded') {
      await invokeAndAck('prependExtreme', [{ expanded: false }]);
    } else if (scenario.action === 'extreme-expanded') {
      await invokeAndAck('prependExtreme', [{ expanded: true }]);
    } else if (scenario.action === 'late-media') {
      await invokeAndAck('prependOne', [29, { lines: 2, expanded: true }]);
      await invokeAndAck('grow', ['old-1-29', { mediaHeight: 4_000, expanded: true }]);
    }
    await page.waitForTimeout(520);
    await cdp.send('Page.stopScreencast');
    await cdp.detach();

    const domFrames = await page.evaluate(() => window.__admissionProbe.stop());
    const reading = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.snapshot());
    const paint = await analyzePaint(page, screencast);
    const blankPaints = paint.filter((frame) => frame.darkPixels < 100);
    const entry = {
      scenario,
      elapsedMs: Date.now() - scenarioStartedAt,
      initialStability,
      openingAnchor,
      preAdmission,
      admissions,
      geometry: await page.evaluate(() => window.admissionFixture.geometry()),
      domFrames,
      reading,
      paint,
      blankPaints,
    };
    report.push(entry);
    for (let index = 0; index < screencast.length; index += 1) {
      const name = `${scenario.id}-paint-${String(index).padStart(3, '0')}.jpeg`;
      await writeFile(testInfo.outputPath(name), Buffer.from(screencast[index].jpegBase64, 'base64'));
    }
    await writeFile(testInfo.outputPath(`${scenario.id}.json`), JSON.stringify(entry, null, 2));
  }
  await writeFile(testInfo.outputPath('admission-summary.json'), JSON.stringify(report.map((entry) => ({
    id: entry.scenario.id,
    blankPaints: entry.blankPaints.map((frame) => frame.index),
    // A frame is eligible only after the recorded user action/prepend
    // precondition and after an actual composited content frame. This does not
    // discard a frame merely because it happens to be first.
    blankAfterActionAndContent: entry.blankPaints
      .filter((frame) => entry.preAdmission.epochMs <= entry.paint[frame.index].epochMs)
      .filter((frame) => entry.paint.slice(0, frame.index).some((prior) => prior.darkPixels >= 100))
      .map((frame) => frame.index),
    openingAnchor: entry.openingAnchor,
    preAdmission: entry.preAdmission,
    paintFrames: entry.paint.length,
    domEmptyFrames: entry.domFrames.filter((frame) => frame.visible.length === 0).length,
    maxItems: Math.max(...entry.domFrames.map((frame) => frame.itemCount)),
    ackMissing: entry.admissions.filter((entry) => !entry.ack.result).length,
    ackLatencyMs: entry.admissions.map((entry) => entry.ack.elapsedMs),
    elapsedMs: entry.elapsedMs,
  })), null, 2));

  expect(report).toHaveLength(scenarios.length);
});
