import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('Production Virtuoso adapter keeps the reading anchor when a mounted row below the viewport grows 28px', async ({ page }, testInfo) => {
  await page.goto('/tests/browser/fixtures/reading-viewport.html');
  await page.waitForFunction(() => window.readingFixture?.anchor().id);
  await page.waitForTimeout(120);
  await page.mouse.move(320, 260);
  await page.mouse.wheel(0, -1_200);
  await expect.poll(() => page.evaluate(() => window.readingFixture.state().mode)).toBe('browsing');
  await page.waitForTimeout(80);

  const cdp = await page.context().newCDPSession(page);
  const paints = [];
  cdp.on('Page.screencastFrame', async (event) => {
    paints.push({ epochMs: Number(event.metadata?.timestamp || 0) * 1_000, data: event.data });
    await cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {
    format: 'jpeg', quality: 90, maxWidth: 1_280, maxHeight: 720, everyNthFrame: 1,
  });
  await page.waitForTimeout(40);
  const action = await page.evaluate(() => window.readingFixture.growBelowViewport(28));
  expect(action.id).not.toBe('');
  await page.waitForTimeout(320);
  await cdp.send('Page.stopScreencast');
  const after = await page.evaluate(() => window.readingFixture.anchor());
  const paintAnalysis = await page.evaluate(async (frames) => {
    const load = (src) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = `data:image/jpeg;base64,${src}`;
    });
    const results = [];
    for (let index = 0; index < frames.length; index += 1) {
      const image = await load(frames[index]);
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
      results.push({ index, darkPixels });
    }
    return results;
  }, paints.map((paint) => paint.data));
  const summary = {
    library: 'react-virtuoso@4.18.13',
    action,
    after,
    anchorOffsetDelta: after.offset - action.before.offset,
    paintFrames: paintAnalysis,
    blankPaints: paintAnalysis.filter((paint) => paint.darkPixels < 100),
  };
  const path = testInfo.outputPath('below-viewport-growth-summary.json');
  await writeFile(path, JSON.stringify(summary, null, 2));
  await testInfo.attach('below-viewport-growth-summary.json', { path, contentType: 'application/json' });
  expect(after.id).toBe(action.before.id);
  expect(Math.abs(summary.anchorOffsetDelta)).toBeLessThanOrEqual(1);
  expect(summary.blankPaints).toHaveLength(0);
});
