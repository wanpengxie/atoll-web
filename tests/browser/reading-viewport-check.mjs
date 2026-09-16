// Isolated geometry validation: a random localhost port, synthetic rows, no
// application backend, login, channel operations or existing service processes.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const server = await createServer({ configFile: false, plugins: [react()], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const failures = [];
  for (const width of [1100, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    page.on('pageerror', (error) => failures.push(error.message));
    await page.goto(server.resolvedUrls.local[0] + 'tests/browser/fixtures/reading-viewport.html');
    await page.waitForFunction(() => Boolean(window.readingFixture));
    const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await settle();
    await page.evaluate(() => window.readingFixture.scroll(-1100));
    await settle();
    for (let step = 0; step < 12; step++) {
      const before = await page.evaluate(() => window.readingFixture.anchor());
      await page.evaluate((step) => step % 2 ? window.readingFixture.append() : window.readingFixture.prepend(), step);
      // Check every sampled frame, not just the eventual resting position.
      const frames = await page.evaluate(async () => {
        const values = [window.readingFixture.anchor()];
        for (let i = 0; i < 4; i++) {
          await new Promise(requestAnimationFrame);
          values.push(window.readingFixture.anchor());
        }
        return values;
      });
      for (const frame of frames) {
        assert.equal(frame.id, before.id, `width=${width}, step=${step}, anchor`);
        assert.ok(Math.abs(frame.offset - before.offset) <= 1, `width=${width}, step=${step}, offset ${frame.offset} != ${before.offset}`);
      }
      await page.evaluate(() => window.readingFixture.scroll(-173));
      await settle();
    }
    const before = await page.evaluate(() => window.readingFixture.anchor());
    await page.evaluate(() => window.readingFixture.growAbove());
    await settle();
    const after = await page.evaluate(() => window.readingFixture.anchor());
    assert.equal(after.id, before.id);
    assert.ok(Math.abs(after.offset - before.offset) <= 1, `late measurement preserves offset: ${JSON.stringify({ width, before, after })}`);
    await page.evaluate(() => window.readingFixture.cancelNavigation('row-5'));
    await settle();
    const cancelled = await page.evaluate(() => window.readingFixture.anchor());
    assert.equal(cancelled.id, after.id);
    assert.ok(Math.abs(cancelled.offset - after.offset) <= 1);
    await page.evaluate(() => window.readingFixture.focus('row-45'));
    await settle();
    assert.ok(await page.locator('[data-presentation-row-id="row-45"]').count());
    await page.evaluate(() => window.readingFixture.follow());
    await settle();
    assert.ok(await page.evaluate(() => {
      const node = document.querySelector('.timeline-message-list');
      return Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop) <= 1;
    }));
    assert.ok(await page.locator('[data-presentation-row-id]').count() < 100);
    // Unlike fixture.scroll(), these are browser-delivered wheel inputs. Watch
    // common DOM rows every frame for reverse motion while scrolling upward.
    await page.evaluate(() => window.readingFixture.focus('row-250'));
    await settle();
    await page.evaluate(() => {
      const node = document.querySelector('.timeline-message-list');
      const trace = { reversals: [], samples: 0 };
      let previous = new Map();
      function sample() {
        const bounds = node.getBoundingClientRect();
        const current = new Map([...node.querySelectorAll('[data-presentation-row-id]')]
          .map((row) => [row.dataset.presentationRowId, row.getBoundingClientRect()])
          .filter(([, rect]) => rect.bottom > bounds.top && rect.top < bounds.bottom)
          .map(([id, rect]) => [id, rect.top]));
        for (const [id, top] of current) {
          if (previous.has(id) && top - previous.get(id) < -1) trace.reversals.push({ id, delta: top - previous.get(id) });
        }
        previous = current;
        trace.samples++;
        trace.frame = requestAnimationFrame(sample);
      }
      window.nativeWheelTrace = trace;
      trace.frame = requestAnimationFrame(sample);
    });
    await page.mouse.move(width / 2, 300);
    for (let step = 0; step < 30; step++) {
      await page.mouse.wheel(0, -260);
      await page.waitForTimeout(18);
    }
    await settle();
    const trace = await page.evaluate(() => {
      cancelAnimationFrame(window.nativeWheelTrace.frame);
      return window.nativeWheelTrace;
    });
    assert.ok(trace.samples > 10);
    assert.deepEqual(trace.reversals, [], `width=${width}, native upward wheel must not reverse visible rows`);
    await page.close();
    console.log(`PASS: ${width}px, cold history/live frame stability, resize, navigation cancellation, bounded DOM, native wheel (${trace.samples} frames)`);
  }
  assert.deepEqual(failures, []);
} finally {
  await browser?.close();
  await server.close();
}
