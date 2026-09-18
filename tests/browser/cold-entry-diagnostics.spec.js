import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request, scenario, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed } });
  if (!response.ok()) throw new Error(`mock reset failed: ${response.status()} ${await response.text()}`);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await page.waitForFunction(() => document.querySelector('.connection-state.state-open'));
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'c0');
}

test('every channel entry reports current work and the scheduler plan', async ({ page, request }, testInfo) => {
  await reset(request, 'message-flow', 2923);
  await login(page);
  await page.getByRole('button', { name: '# c0.project', exact: true }).click();
  await expect(page.locator('.empty-ledger')).toContainText('这本账还没有可见条目');

  const empty = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.coldEntry.snapshot());
  expect(empty.channelId).toBe('c0.project');
  expect(empty.classification).toBe('authoritative-empty');
  expect(empty.presentation.rows).toBe(0);
  expect(empty.dom.visibleRows).toBe(0);
  expect(empty.feed.scheduler.global.occupants.length).toBeLessThanOrEqual(2);
  expect(empty.work).toMatchObject({
    state: 'not-needed',
    reason: 'authoritative-eof',
    replicaReady: true,
    presentationVisible: false,
  });
  await expect.poll(async () => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .filter((entry) => entry.event === 'cold_entry.snapshot'
      && entry.detail.trigger === 'entry'
      && entry.detail.channelId === 'c0.project')
    .at(-1)?.level)).toBe('info');

  await page.getByRole('button', { name: '# c0', exact: true }).click();
  await expect.poll(async () => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
    .filter((entry) => entry.event === 'cold_entry.snapshot'
      && entry.detail.trigger === 'entry'
      && entry.detail.channelId === 'c0')
    .at(-1)?.level)).toBe('info');
  const current = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.coldEntry.snapshot());
  await testInfo.attach('cold-entry-current-work.json', {
    body: JSON.stringify(current, null, 2),
    contentType: 'application/json',
  });
  expect(current.channelId).toBe('c0');
  expect(['running', 'planned', 'blocked', 'not-needed']).toContain(current.work.state);
});
