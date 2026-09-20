import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.locator('.timeline')).toBeVisible();
  await expect(page.locator('.timeline-reading-stack > .timeline-reading-layer.is-active > .timeline-message-list')).toHaveCount(1);
  await expect(page.locator('.top-error')).toHaveCount(0);
}

async function lifecycle(request, phase, extra = {}) {
  const response = await request.post('/mock/control/action', {
    data: { type: 'notification_lifecycle', channel_id: 'c0.project', phase, ...extra },
  });
  expect(response.ok()).toBe(true);
}

function channel(page, name) {
  return page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: new RegExp(`^${name.replace('.', '\\.')}$`) }) });
}

async function reloadEvidence(page) {
  return page.evaluate(async () => {
    const databaseName = 'atoll-channel-replica-v1';
    const request = indexedDB.open(databaseName);
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!db.objectStoreNames.contains('rows') || !db.objectStoreNames.contains('meta')) {
      db.close();
      return {
        rail: window.__ATOLL_DIAGNOSTICS__?.rail?.snapshot?.('c0.project'),
        reads: Object.fromEntries(Object.keys(localStorage)
          .filter((key) => key.startsWith('atoll.read'))
          .map((key) => [key, localStorage.getItem(key)])),
        meta: null,
        cachedSeqs: [],
      };
    }
    const transaction = db.transaction(['rows', 'meta'], 'readonly');
    const rowsRequest = transaction.objectStore('rows').getAll();
    const metaRequest = transaction.objectStore('meta').getAll();
    const [rows, metaRows] = await Promise.all([
      new Promise((resolve, reject) => {
        rowsRequest.onsuccess = () => resolve(rowsRequest.result);
        rowsRequest.onerror = () => reject(rowsRequest.error);
      }),
      new Promise((resolve, reject) => {
        metaRequest.onsuccess = () => resolve(metaRequest.result);
        metaRequest.onerror = () => reject(metaRequest.error);
      }),
    ]);
    db.close();
    return {
      rail: window.__ATOLL_DIAGNOSTICS__?.rail?.snapshot?.('c0.project'),
      reads: Object.fromEntries(Object.keys(localStorage)
        .filter((key) => key.startsWith('atoll.read'))
        .map((key) => [key, localStorage.getItem(key)])),
      meta: metaRows.find((row) => row.channelId === 'c0.project') || null,
      cachedSeqs: rows.filter((row) => row.channelId === 'c0.project').map((row) => row.seq).sort((a, b) => a - b),
    };
  });
}

test('rail follows presented lifecycle roots and persists only unacknowledged exact identities', async ({ page, request }, testInfo) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'multi-channel', seed: 2631 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  const home = channel(page, 'c0');
  const project = channel(page, 'c0.project');
  const related = project.locator('.unread-related');
  const other = project.locator('.unread-total:not(.unread-pending)');
  await expect(related).toHaveCount(0);
  await expect(other).toHaveCount(0);

  // Keep a real scrollable presentation so the current filter's visible-row
  // acknowledgement is exercised through the production viewport adapter.
  await lifecycle(request, 'tail', { count: 24 });
  await expect(related).toHaveCount(0);
  await expect(other).toHaveCount(0);

  // Browser operation streams are ledger facts, not person-visible messages.
  await lifecycle(request, 'ui');
  await expect(related).toHaveCount(0);
  await expect(other).toHaveCount(0);

  // An agent-owned task has no human conversation edge while it is waiting.
  await lifecycle(request, 'request');
  await lifecycle(request, 'queued');
  await expect(related).toHaveCount(0);
  await expect(other).toHaveCount(0);

  // Processing installs/updates a row in the all-ledger view, but it is still
  // lifecycle state rather than a new message notification. Later progress
  // remains quiet as well.
  await lifecycle(request, 'processing');
  await expect(related).toHaveCount(0);
  await expect(other).toHaveCount(0);
  await lifecycle(request, 'progress');
  await expect(other).toHaveCount(0);

  await project.click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(other).toHaveCount(0);
  const scope = page.locator('.timeline-scope > button');
  await expect(scope).toHaveText('与我相关');
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'notification-policy' }));
  await scope.click();
  await expect(scope).toHaveText('全部');
  await expect(page.locator('[data-presentation-row-id="c0.project-notification-agent-task"]')).toBeVisible();
  await page.waitForTimeout(1_000);
  const processingEvidence = await page.evaluate(() => ({
    rail: window.__ATOLL_DIAGNOSTICS__?.rail?.snapshot?.('c0.project'),
    reading: window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.(),
    viewSession: localStorage.getItem('atoll.view-session.v3.root'),
    geometry: (() => {
      const root = document.querySelector('.timeline-message-list');
      if (!root) return null;
      const rootRect = root.getBoundingClientRect();
      return {
        root: { top: rootRect.top, bottom: rootRect.bottom, left: rootRect.left, right: rootRect.right },
        rows: [...root.querySelectorAll('[data-presentation-row-id]')].map((node) => {
          const rect = node.getBoundingClientRect();
          const x = (Math.max(rootRect.left, rect.left) + Math.min(rootRect.right, rect.right)) / 2;
          const y = (Math.max(rootRect.top, rect.top) + Math.min(rootRect.bottom - 48, rect.bottom)) / 2;
          const hit = document.elementFromPoint(x, y);
          return {
            id: node.dataset.presentationRowId,
            rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
            hit: { tag: hit?.tagName || '', className: String(hit?.className || '') },
            ownsHit: Boolean(hit && (hit === node || node.contains(hit))),
          };
        }),
      };
    })(),
  }));
  const evidencePath = testInfo.outputPath('notification-processing-evidence.json');
  await writeFile(evidencePath, `${JSON.stringify(processingEvidence, null, 2)}\n`, 'utf8');
  await testInfo.attach('notification-processing-evidence.json', { path: evidencePath, contentType: 'application/json' });
  await expect(other).toHaveCount(0);

  // A later terminal response is the user-facing content notification. It
  // remains unread across reload until that exact row is physically visible.
  await home.click();
  await lifecycle(request, 'progress');
  await expect(other).toHaveCount(0);
  await lifecycle(request, 'final');
  // The current rail exposes one personal unread badge; the retired total
  // badge is reserved for pending/unknown state and never carries counts.
  await expect(related).toHaveText('1');
  // The live feed's checkpoint and row are persisted behind an async storage
  // fence. Reload only after that durable boundary can represent the case.
  await page.waitForTimeout(500);
  const beforeReload = await reloadEvidence(page);
  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await page.waitForTimeout(1_000);
  const afterReload = await reloadEvidence(page);
  const reloadPath = testInfo.outputPath('notification-reload-evidence.json');
  await writeFile(reloadPath, `${JSON.stringify({ beforeReload, afterReload }, null, 2)}\n`, 'utf8');
  await testInfo.attach('notification-reload-evidence.json', { path: reloadPath, contentType: 'application/json' });
  await expect(related).toHaveText('1');

  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'notification-policy-restored' }));
  await project.click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  const restoredScope = page.locator('.timeline-scope > button');
  if (await restoredScope.textContent() === '与我相关') await restoredScope.click();
  const restoredFinal = page.locator('[data-presentation-row-id="c0.project-notification-agent-task"]');
  await expect(restoredFinal).toBeVisible();
  // Virtuoso may mount the final inside overscan while restoring an older
  // bookmark. CSS visibility is not reading evidence; put the exact row in
  // the physical viewport before requiring its identity acknowledgement.
  await restoredFinal.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(1_000);
  const restoredEvidence = await page.evaluate(() => ({
    rail: window.__ATOLL_DIAGNOSTICS__?.rail?.snapshot?.('c0.project'),
    reading: window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.(),
  }));
  const restoredPath = testInfo.outputPath('notification-restored-visible-evidence.json');
  await writeFile(restoredPath, `${JSON.stringify(restoredEvidence, null, 2)}\n`, 'utf8');
  await testInfo.attach('notification-restored-visible-evidence.json', { path: restoredPath, contentType: 'application/json' });
  await expect(other).toHaveCount(0);
});

test('tool, timer, and public-event notifications follow independent readable roots', async ({ page, request }, testInfo) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'multi-channel', seed: 2632 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'notification-policy-kinds' }));

  const home = channel(page, 'c0');
  const project = channel(page, 'c0.project');
  const related = project.locator('.unread-related');
  const other = project.locator('.unread-total:not(.unread-pending)');
  await project.click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  const initialScope = page.locator('.timeline-scope > button');
  await expect(initialScope).toHaveText('与我相关');
  await initialScope.click();
  await expect(initialScope).toHaveText('全部');
  await home.click();
  const expectQuiet = async () => {
    await expect(related).toHaveCount(0);
    await expect(other).toHaveCount(0);
  };
  const acknowledge = async (entryID) => {
    await project.click();
    await expect(page.locator('main h1')).toHaveText('c0.project');
    const entry = page.locator(`[data-presentation-row-id="${entryID}"]`);
    await expect(entry).toBeVisible();
    await entry.evaluate((node) => node.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(500);
    await expect(related).toHaveCount(0);
    await expect(other).toHaveCount(0);
    await home.click();
  };

  // A child tool request/result mutates its existing root; neither transport
  // frame can wake a root that was already read.
  await lifecycle(request, 'request');
  await lifecycle(request, 'nested_tool');
  await lifecycle(request, 'nested_tool_final');
  await expectQuiet();

  // Scheduler fire/wake/control completion stays visible as activity but is not
  // itself a person's new message. The same applies to a non-readable activity
  // event even though both are public ledger facts.
  await lifecycle(request, 'timer_control');
  await lifecycle(request, 'activity_event');
  await expectQuiet();

  // A standalone readable event owns an independent viewport dynamic, but the
  // established channel rail remains request/final-only. Its physical row must
  // still join the exact visibility evidence used by the open viewport.
  await lifecycle(request, 'readable_event');
  await expectQuiet();
  await project.click();
  const readableEvent = page.locator('[data-presentation-row-id="c0.project-notification-readable-event"]');
  await expect(readableEvent).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    return window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.().entries?.some((entry) => (
      entry.event === 'reading.observation'
      && entry.detail?.visibleRowIDs?.includes('c0.project-notification-readable-event')
    )) === true;
  })).toBe(true);
  const visibilityEvidence = await page.evaluate(() => {
    const root = document.querySelector('.timeline-message-list');
    const rootRect = root?.getBoundingClientRect();
    return {
      root: rootRect ? {
        top: rootRect.top, bottom: rootRect.bottom, left: rootRect.left, right: rootRect.right,
      } : null,
      rows: [...(root?.querySelectorAll('[data-presentation-row-id]') || [])].map((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const x = (Math.max(rootRect.left, rect.left) + Math.min(rootRect.right, rect.right)) / 2;
        const readableBottom = rootRect.bottom - 48;
        const ys = [
          Math.max(rootRect.top, rect.top) + 1,
          (Math.max(rootRect.top, rect.top) + Math.min(readableBottom, rect.bottom)) / 2,
          Math.min(readableBottom, rect.bottom) - 1,
        ];
        return {
          id: node.getAttribute('data-presentation-row-id'),
          rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
          style: { display: style.display, visibility: style.visibility, opacity: style.opacity },
          checkVisibility: node.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) ?? null,
          probes: ys.map((y) => {
            const hit = document.elementFromPoint(x, y);
            return {
              x, y,
              hitTag: hit?.tagName || '',
              hitClassName: String(hit?.className || ''),
              ownsHit: Boolean(hit && (hit === node || node.contains(hit))),
            };
          }),
        };
      }),
      observations: window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.().entries?.filter((entry) => (
        entry.event === 'reading.observation'
      )).slice(-16),
    };
  });
  const evidencePath = testInfo.outputPath('notification-readable-event-visibility.json');
  await writeFile(evidencePath, `${JSON.stringify(visibilityEvidence, null, 2)}\n`, 'utf8');
  await testInfo.attach('notification-readable-event-visibility.json', {
    path: evidencePath,
    contentType: 'application/json',
  });
  const screenshotPath = testInfo.outputPath('notification-readable-event-visible.png');
  await page.screenshot({ path: screenshotPath });
  await testInfo.attach('notification-readable-event-visible.png', { path: screenshotPath, contentType: 'image/png' });
  await home.click();

  // A top-level tool turn is legitimate user-facing content. Its later result
  // is a newer revision of that same root and may notify again after the request
  // itself was exactly acknowledged.
  await lifecycle(request, 'top_tool');
  await expect(related).toHaveText('1');
  await acknowledge('c0.project-notification-top-tool');
  await lifecycle(request, 'top_tool_final');
  await expect(related).toHaveText('1');
  await acknowledge('c0.project-notification-top-tool');

  // Timer transport remains quiet, but an actually readable terminal body is
  // independent user content and follows the same exact-root rules.
  await lifecycle(request, 'timer_result');
  await expect(related).toHaveText('1');
  await project.click();
  const timerResult = page.locator('[data-presentation-row-id="timer:c0.project-notification-result-wake"]');
  await expect(timerResult).toBeVisible();
});
