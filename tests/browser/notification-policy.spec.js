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
  await scope.click();
  await expect(scope).toHaveText('全部');
  await expect(page.locator('[data-presentation-row-id="c0.project-notification-agent-task"]')).toBeVisible();
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
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(related).toHaveText('1');

  await project.click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  const restoredScope = page.locator('.timeline-scope > button');
  if (await restoredScope.textContent() === '与我相关') await restoredScope.click();
  const restoredFinal = page.locator('[data-presentation-row-id="c0.project-notification-agent-task"]');
  await expect(restoredFinal).toBeVisible();
  // Virtuoso may mount the final inside overscan while restoring an older
  // bookmark. CSS visibility is not reading evidence; put the exact row in
  // the physical viewport before requiring its identity acknowledgement.
  await restoredFinal.scrollIntoViewIfNeeded();
  await expect(restoredFinal).toBeVisible();
  await expect(related).toHaveCount(0);
  await expect(other).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(related).toHaveCount(0);
  await expect(other).toHaveCount(0);
  const evidencePath = testInfo.outputPath('notification-processing-evidence.json');
  await writeFile(evidencePath, `${JSON.stringify({
    contract: 'public-dom',
    quietLifecycle: { related: 0, other: 0 },
    terminalAfterReload: { related: 1, other: 0 },
    afterExactPresentation: { related: 0, other: 0 },
    afterAcknowledgementReload: { related: 0, other: 0 },
  }, null, 2)}\n`, 'utf8');
  await testInfo.attach('notification-processing-evidence.json', {
    path: evidencePath,
    contentType: 'application/json',
  });
});

