import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

async function attachJSON(testInfo, name, value) {
  const path = testInfo.outputPath(name);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

async function reset(request, seed) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'deep-history', seed },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.locator('.timeline-message-list [data-presentation-row-id]').last()).toBeVisible();
}

async function approval(request) {
  const response = await request.post('/mock/control/action', {
    data: { type: 'approval', channel_id: 'c0' },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function persistedReading(page) {
  return page.evaluate(() => {
    const storage = JSON.parse(localStorage.getItem('atoll.view-session.v3.root') || 'null');
    const readings = storage?.readings || {};
    const key = Object.keys(readings).find((candidate) => candidate.startsWith('c0\u0000c0:mine:')) || '';
    return { key, value: key ? readings[key] : null };
  });
}

async function evidence(page, stage) {
  return page.evaluate((label) => {
    const viewport = document.querySelector('.timeline-message-list');
    const reading = JSON.parse(localStorage.getItem('atoll.view-session.v3.root') || 'null');
    const readings = reading?.readings || {};
    const key = Object.keys(readings).find((candidate) => candidate.startsWith('c0\u0000c0:mine:')) || '';
    return {
      stage: label,
      saved: key ? readings[key] : null,
      jumpText: document.querySelector('.timeline-jump-latest')?.textContent || '',
      mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
      tailDistance: viewport
        ? viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
        : null,
      latestVisible: [...(viewport?.querySelectorAll('[data-presentation-row-id]') || [])]
        .at(-1)?.textContent || '',
      documentVisibility: document.visibilityState,
    };
  }, stage);
}

test('reload starts at the latest committed presentation and ignores stale persisted browsing hints', async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  await reset(request, 29109);
  await page.goto('/');

  // The product deliberately persists preferences and durable identity only;
  // a reload must not resurrect an old physical position or manufacture a
  // viewport notice from malformed historical fields.
  await page.evaluate(() => {
    localStorage.setItem('atoll.view-session.v3.root', JSON.stringify({
      schema: 3,
      preferences: { c0: { scope: 'mine', actorFilter: [], foldOverrides: [], foldDefaults: [], layoutChoices: [] } },
      readings: {
        'c0\u0000c0:mine:': {
          revision: 7,
          mode: 'browsing',
          bookmark: { messageID: 'c0-history-request-40', rowViewportOffset: -12, seq: 79 },
          unseenTail: 7,
          unseenKeys: ['legacy-key-only'],
          unseenRecords: [['legacy-key-only', 0], ['malformed', 'Infinity']],
        },
      },
    }));
  });

  await login(page);
  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  await page.mouse.wheel(0, -2_000);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');

  const arrival = await approval(request);
  await expect(page.getByRole('button', { name: /1 条新动态/ })).toBeVisible();
  const beforeReload = await evidence(page, 'before-reload');
  await attachJSON(testInfo, 'ux-unseen-persistence-before-reload.json', { arrival, beforeReload });
  expect(beforeReload.mode).toBe('browsing');
  expect(beforeReload.jumpText).toBe('↓ 1 条新动态');

  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.getByRole('button', { name: /条新动态/ })).toHaveCount(0);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'following');
  await expect(page.getByText('Approve live mock action', { exact: true })).toBeVisible();

  const restored = await persistedReading(page);
  const afterReload = await evidence(page, 'after-reload');
  await attachJSON(testInfo, 'ux-unseen-persistence-after-reload.json', { arrival, beforeReload, restored, afterReload });
  expect(restored.key).toBeTruthy();
  expect(restored.value?.mode).toBe('following');
  expect(restored.value?.bookmark).toBeNull();
  expect(afterReload.jumpText).toBe('');
  expect(afterReload.mode).toBe('following');
  expect(afterReload.tailDistance).toBeLessThanOrEqual(24);
  expect(afterReload.documentVisibility).toBe('visible');
});
