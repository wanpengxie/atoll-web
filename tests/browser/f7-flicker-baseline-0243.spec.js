import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// TC-0243 used a retired reading-viewport fixture.  The user contract is not
// the fixture API: during real history browsing and prepend races, the current
// production reading surface must remain covered both in DOM and at compositor
// paint.  Keep the old timing matrix as public wheel actions against the real
// AppShell instead of recreating the deleted fixture owner.
const CASES = [
  {
    name: 'delayed-fast-burst',
    scenario: 'deep-history-delayed',
    seed: 0x24_31,
    deltas: [-700, -900, -1_300, -1_700],
    intervalMs: 12,
  },
  {
    name: 'delayed-late-prepend',
    scenario: 'deep-history-delayed',
    seed: 0x24_32,
    deltas: [-900, -1_400, -1_900, -2_200],
    intervalMs: 8,
  },
  {
    name: 'delayed-slow-burst',
    scenario: 'deep-history-delayed',
    seed: 0x24_33,
    deltas: [-1_100, -1_600, -2_100, -2_500],
    intervalMs: 32,
  },
  {
    name: 'variable-height-prepend',
    scenario: 'mixed-height-history',
    seed: 0x24_34,
    deltas: [-1_100, -1_600, -2_100, -2_500],
    intervalMs: 6,
  },
  {
    name: 'history-boundary-burst',
    scenario: 'history-boundary',
    seed: 0x24_35,
    deltas: [-2_700, -1_200],
    intervalMs: 0,
  },
];

const selectedSeed = Number(process.env.ATOLL_FLICKER_SEED || 0);
const cases = selectedSeed ? CASES.filter(({ seed }) => seed === selectedSeed) : CASES;

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

async function moveToHistoryEdge(page) {
  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  // This is deliberately a real pointer/wheel setup, not a direct scrollTop
  // write or a retired fixture command.  It leaves the production list near
  // the physical history edge before the observed burst starts.
  for (let index = 0; index < 10; index += 1) {
    await page.mouse.wheel(0, -2_400);
    await page.waitForTimeout(18);
  }
  await page.waitForTimeout(120);
  return viewport;
}

async function installFrameProbe(page, metadata) {
  return page.evaluate((caseMetadata) => {
    const root = document.querySelector('.timeline-message-list');
    if (!root) throw new Error('timeline message list is not mounted');
    const frames = [];
    let running = true;
    const sample = () => {
      if (!running) return;
      const viewport = root.getBoundingClientRect();
      const list = root.firstElementChild;
      const items = [...root.querySelectorAll('[data-presentation-row-id]')];
      const visible = items.flatMap((item) => {
        const rect = item.getBoundingClientRect();
        if (rect.bottom <= viewport.top + 0.5 || rect.top >= viewport.bottom - 0.5) return [];
        return [{
          id: item.dataset.presentationRowId || '',
          top: rect.top - viewport.top,
          bottom: rect.bottom - viewport.top,
        }];
      }).sort((left, right) => left.top - right.top);
      const first = visible[0];
      const last = visible.at(-1);
      const boundarySlot = root.querySelector('.timeline-history-boundary-slot');
      const boundaryRect = boundarySlot?.getBoundingClientRect() || null;
      const boundaryContainerRect = boundarySlot?.parentElement?.getBoundingClientRect() || null;
      // The header scrolls with the virtualized content.  Its viewport bottom
      // is therefore not the reserve; measure the slot bottom from the
      // content origin so a scrolled header still contributes its 35px
      // HistoryStartBoundary reserve.
      const boundaryBottom = boundaryRect && boundaryContainerRect
        ? boundaryRect.bottom - boundaryContainerRect.top
        : 0;
      const topGap = first ? first.top - boundaryBottom : root.clientHeight;
      const coverageTolerance = 2;
      const rootStyle = getComputedStyle(root);
      const listStyle = list ? getComputedStyle(list) : null;
      frames.push({
        at: performance.now(),
        case: caseMetadata.name,
        connected: root.isConnected,
        activeLayers: document.querySelectorAll('.timeline-reading-layer.is-active').length,
        activeLists: document.querySelectorAll('.timeline-reading-layer.is-active .timeline-message-list').length,
        mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
        scrollTop: root.scrollTop,
        scrollHeight: root.scrollHeight,
        clientHeight: root.clientHeight,
        itemCount: items.length,
        visible,
        historyBoundary: boundaryRect ? {
          top: boundaryContainerRect ? boundaryRect.top - boundaryContainerRect.top : null,
          bottom: boundaryBottom,
          height: boundaryRect.height,
        } : null,
        topGap,
        coverageTolerance,
        emptyViewport: visible.length === 0,
        undefinedVisibleSlot: visible.some((row) => !row.id),
        uncoveredTop: root.scrollTop > 1 && topGap > coverageTolerance,
        uncoveredBottom: root.scrollHeight - root.clientHeight - root.scrollTop > 24
          && (!last || last.bottom < root.clientHeight - 1),
        rootVisibility: rootStyle.visibility,
        rootOpacity: rootStyle.opacity,
        listVisibility: listStyle?.visibility || '',
        listOpacity: listStyle?.opacity || '',
      });
      requestAnimationFrame(sample);
    };
    window.__TC0243_FRAME_PROBE__ = {
      stop() {
        running = false;
        return { case: caseMetadata, frames };
      },
    };
    requestAnimationFrame(sample);
  }, metadata);
}

async function capturePaint(page, region, encodedFrames) {
  return page.evaluate(async ({ paintRegion, frames }) => {
    const decode = (base64) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = `data:image/jpeg;base64,${base64}`;
    });
    const result = [];
    for (let index = 0; index < frames.length; index += 1) {
      const image = await decode(frames[index]);
      const scaleX = image.naturalWidth / paintRegion.pageWidth;
      const scaleY = image.naturalHeight / paintRegion.pageHeight;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(paintRegion.width * scaleX));
      canvas.height = Math.max(1, Math.floor(paintRegion.height * scaleY));
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(
        image,
        Math.floor(paintRegion.left * scaleX), Math.floor(paintRegion.top * scaleY),
        canvas.width, canvas.height,
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
  }, { paintRegion: region, frames: encodedFrames });
}

async function runCase({ page, request, testInfo }, scenario) {
  await reset(request, scenario.scenario, scenario.seed);
  await login(page);
  const viewport = await moveToHistoryEdge(page);
  const paintRegion = await viewport.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const color = getComputedStyle(node).backgroundColor.match(/[\d.]+/g)?.slice(0, 3).map(Number)
      || [255, 255, 255];
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
  await installFrameProbe(page, scenario);
  const cdp = await page.context().newCDPSession(page);
  const screencast = [];
  cdp.on('Page.screencastFrame', async (event) => {
    screencast.push({
      epochMs: Number(event.metadata?.timestamp || 0) * 1_000,
      metadata: event.metadata,
      data: event.data,
    });
    await cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg', quality: 90, maxWidth: 1_280, maxHeight: 720, everyNthFrame: 1,
  });
  await page.waitForTimeout(40);

  for (let index = 0; index < scenario.deltas.length; index += 1) {
    await page.mouse.wheel(0, scenario.deltas[index]);
    if (index + 1 < scenario.deltas.length) await page.waitForTimeout(scenario.intervalMs);
  }
  await page.waitForTimeout(520);
  await cdp.send('Page.stopScreencast');
  const probe = await page.evaluate(() => window.__TC0243_FRAME_PROBE__.stop());
  await cdp.detach();
  const paint = await capturePaint(page, paintRegion, screencast.map((frame) => frame.data));
  const visualFailures = probe.frames.filter((frame) => (
    !frame.connected
    || frame.activeLayers !== 1
    || frame.activeLists !== 1
    || frame.emptyViewport
    || frame.undefinedVisibleSlot
    || frame.uncoveredTop
    || frame.uncoveredBottom
    || frame.rootVisibility === 'hidden'
    || Number(frame.rootOpacity) === 0
    || frame.listVisibility === 'hidden'
    || Number(frame.listOpacity) === 0
  ));
  const baseline = paint.find((frame) => frame.foreground > 0)?.foreground || 0;
  const minimumRequired = Math.max(100, Math.floor(baseline * 0.05));
  const blankPaints = paint.filter((frame) => frame.foreground < minimumRequired);
  const evidence = {
    scenario,
    paintRegion,
    frames: probe.frames,
    paintFrames: screencast.map((frame, index) => ({ index, epochMs: frame.epochMs, metadata: frame.metadata })),
    paint,
    baseline,
    minimumRequired,
    visualFailures,
    blankPaints,
  };
  const artifactPath = testInfo.outputPath(`tc0243-${scenario.name}.json`);
  await mkdir(testInfo.outputDir, { recursive: true });
  await writeFile(artifactPath, JSON.stringify(evidence, null, 2));
  await testInfo.attach(`tc0243-${scenario.name}.json`, { path: artifactPath, contentType: 'application/json' });
  await testInfo.attach('tc0243-summary.json', {
    body: JSON.stringify({
      scenario,
      frameCount: probe.frames.length,
      paintFrameCount: paint.length,
      visualFailureCount: visualFailures.length,
      blankPaintCount: blankPaints.length,
    }, null, 2),
    contentType: 'application/json',
  });
  expect(probe.frames.length, JSON.stringify(evidence)).toBeGreaterThan(0);
  // CDP emits a frame only when the compositor submits one.  A static
  // covered surface can legitimately produce one frame while the rAF probe
  // samples the entire interaction; zero frames would provide no compositor
  // evidence and must fail closed.
  expect(screencast.length, JSON.stringify(evidence)).toBeGreaterThan(0);
  expect(visualFailures, JSON.stringify(evidence)).toEqual([]);
  expect(blankPaints, JSON.stringify(evidence)).toEqual([]);
}

if (selectedSeed && cases.length === 0) {
  test('TC0243 unknown seed fails closed', async () => {
    expect(cases, `unknown ATOLL_FLICKER_SEED=${selectedSeed}`).not.toEqual([]);
  });
} else {
  for (const scenario of cases) {
    test(`TC0243 ${scenario.name}: compositor and DOM stay continuously covered`, async ({ page, request }, testInfo) => {
      test.setTimeout(60_000);
      await runCase({ page, request, testInfo }, scenario);
    });
  }
}
