import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

async function sourceFingerprint() {
  const paths = [
    'src/ui/Timeline.jsx',
    'src/ui/timeline/useReadingSession.js',
    'src/model/history-scheduler.js',
  ];
  const hash = createHash('sha256');
  for (const path of paths) hash.update(path).update('\0').update(await readFile(path));
  return { paths, digest: hash.digest('hex') };
}

test('identity-pending all-scope underfill stays silent and resumes from scheduler progress', async ({ page }, testInfo) => {
  await page.goto('/tests/browser/fixtures/history-underfill-lifecycle.html');
  await page.waitForFunction(() => Boolean(window.historyUnderfillLifecycle));
  let snapshot = null;
  let failure = '';
  const path = testInfo.outputPath('history-underfill-lifecycle.json');
  try {
    await expect.poll(() => page.evaluate(() => window.historyUnderfillLifecycle.snapshot().requests.length))
      .toBe(1);
    snapshot = await page.evaluate(() => window.historyUnderfillLifecycle.snapshot());
    expect(snapshot.requests[0]).toMatchObject({
      reason: 'projection-underfill', intent: 'scroll-history', urgency: 'anticipatory', scope: 'all', selfId: '',
    });
    // The first request failed before the bounded cold-entry presentation
    // gate elapsed. It remains background-silent while the initial truthful
    // feedback is still "confirming", then degrades to the partial-copy state
    // without manufacturing another request from an unrelated React commit.
    expect(snapshot).toMatchObject({ foreground: false, partial: false, confirming: true });
    await expect.poll(() => page.evaluate(() => window.historyUnderfillLifecycle.snapshot().partial))
      .toBe(true);
    snapshot = await page.evaluate(() => window.historyUnderfillLifecycle.snapshot());
    expect(snapshot).toMatchObject({ foreground: false, partial: true, confirming: false });
    expect(snapshot.requests).toHaveLength(1);

    await page.evaluate(() => window.historyUnderfillLifecycle.publishSchedulerRetry());
    await expect.poll(() => page.evaluate(() => window.historyUnderfillLifecycle.snapshot().requests.length))
      .toBe(2);
    snapshot = await page.evaluate(() => window.historyUnderfillLifecycle.snapshot());
    expect(snapshot.requests[1]).toMatchObject({
      reason: 'projection-underfill', intent: 'scroll-history', urgency: 'anticipatory', scope: 'all', selfId: '',
    });
    expect(snapshot).toMatchObject({ foreground: false, partial: true, confirming: false });
  } catch (error) {
    failure = error?.stack || error?.message || String(error);
    throw error;
  } finally {
    snapshot ||= await page.evaluate(() => window.historyUnderfillLifecycle.snapshot()).catch(() => null);
    await mkdir(testInfo.outputDir, { recursive: true });
    await writeFile(path, JSON.stringify({ source: await sourceFingerprint(), failure, snapshot }, null, 2));
    await testInfo.attach('history-underfill-lifecycle.json', { path, contentType: 'application/json' });
  }
});
