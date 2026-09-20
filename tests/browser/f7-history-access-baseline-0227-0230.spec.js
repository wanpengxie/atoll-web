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
}

test('TC0227 F7 revoked active channel sends no freshness request and a later grant resumes exactly once', async ({ page, request }, testInfo) => {
  await reset(request, 'deep-history', 1717);
  let accessPhase = 'initial';
  const sockets = [];
  const metaFrames = [];
  page.on('websocket', (socket) => {
    sockets.push({ phase: accessPhase, url: socket.url() });
    socket.on('framesent', ({ payload }) => {
      try {
        const frame = JSON.parse(String(payload));
        if (frame?.frame_type === 'channel_meta') {
          metaFrames.push({ phase: accessPhase, channelId: frame.payload?.channel_id, generation: frame.payload?.generation });
        }
      } catch {
        // Binary/non-JSON frames are outside the Gateway request contract.
      }
    });
  });
  await login(page);
  await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0\.project$/ }) }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.getByText('c0.project history 119: ask project-agent for PONG', { exact: true })).toBeVisible();

  const socketsBeforeRevoke = sockets.length;
  accessPhase = 'revoked';
  const revoked = await request.post('/mock/control/action', { data: { type: 'revoke_membership', channel_id: 'c0.project' } });
  expect(revoked.ok()).toBe(true);
  await expect(page.getByText('频道内容不可访问', { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(500);
  expect(metaFrames.filter((frame) => frame.phase === 'revoked' && frame.channelId === 'c0.project')).toEqual([]);
  expect(sockets).toHaveLength(socketsBeforeRevoke + 1);

  accessPhase = 'granted';
  const granted = await request.post('/mock/control/action', { data: { type: 'grant_membership', channel_id: 'c0.project' } });
  expect(granted.ok()).toBe(true);
  await expect(page.locator('.timeline-message-list')).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => metaFrames.filter((frame) => (
    frame.phase === 'granted' && frame.channelId === 'c0.project'
  )).length).toBe(1);
  expect(sockets).toHaveLength(socketsBeforeRevoke + 2);

  await testInfo.attach('access-interest-lifecycle.json', {
    body: JSON.stringify({ sockets, metaFrames }, null, 2),
    contentType: 'application/json',
  });
});

for (const seed of [1722, 1723, 1724]) {
  test(`TC${String(228 + (seed - 1722)).padStart(4, '0')} F7 delayed initial pages keep the access activation at latest (seed ${seed})`, async ({ page, request }, testInfo) => {
    test.setTimeout(45_000);
    await reset(request, 'deep-history-delayed', seed);
    await login(page);
    await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.clear());
    await page.evaluate(() => {
      window.__ATOLL_ACCESS_INITIAL_TRACE__ = [];
      const started = performance.now();
      const sample = () => {
        const viewport = document.querySelector('.timeline-message-list');
        const rows = [...(viewport?.querySelectorAll('[data-presentation-row-id]') || [])];
        window.__ATOLL_ACCESS_INITIAL_TRACE__.push({
          at: Math.round(performance.now() - started),
          channel: document.querySelector('main h1')?.textContent || '',
          ledgerSeq: document.querySelector('.seq-label')?.textContent || '',
          restoring: Boolean(document.querySelector('.timeline-reading-restore')),
          rowCount: rows.length,
          first: rows[0]?.dataset.presentationRowId || '',
          last: rows.at(-1)?.dataset.presentationRowId || '',
          mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
          gap: viewport ? Math.round(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop) : null,
        });
        if (performance.now() - started < 4_000) window.__ATOLL_ACCESS_INITIAL_RAF__ = requestAnimationFrame(sample);
      };
      window.__ATOLL_ACCESS_INITIAL_RAF__ = requestAnimationFrame(sample);
    });
    await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0\.project$/ }) }).click();
    await expect(page.locator('main h1')).toHaveText('c0.project');

    let failure = null;
    try {
      await expect(page.getByText('c0.project history 119: ask project-agent for PONG', { exact: true })).toBeVisible({ timeout: 12_000 });
      const viewport = page.locator('.timeline-message-list');
      await expect.poll(() => viewport.evaluate((node) => Math.round(node.scrollHeight - node.clientHeight - node.scrollTop))).toBeLessThanOrEqual(24);
    } catch (error) {
      failure = error;
    } finally {
      await page.waitForTimeout(4_050);
      const evidence = await page.evaluate(() => ({
        samples: window.__ATOLL_ACCESS_INITIAL_TRACE__ || [],
        diagnostics: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => [
          'reading.initialization_ready',
          'reading.initialization_degraded',
          'history.segment_requested',
          'history.batch_complete',
        ].includes(entry.event)),
      }));
      const evidencePath = testInfo.outputPath('access-initial-evidence.json');
      await mkdir(testInfo.outputDir, { recursive: true });
      await writeFile(evidencePath, JSON.stringify({ seed, historyDelayMs: 750, ...evidence }, null, 2));
      await testInfo.attach('access-initial-evidence.json', {
        path: evidencePath,
        contentType: 'application/json',
      });
    }
    if (failure) throw failure;
  });
}
