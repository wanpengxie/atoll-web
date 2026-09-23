import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// A phone in the background keeps a dead socket; coming back, the page
// re-attaches and live resumes after the attach head. Whatever landed in
// between must be fetched, or its final never shows.
test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

async function openWithPausableFeed(page, request, scenario) {
  const feed = { paused: false, clients: [] };
  await page.routeWebSocket(/\/ws(\?|$)/, (ws) => {
    const server = ws.connectToServer();
    feed.clients.push(ws);
    server.onMessage((message) => { if (!feed.paused) ws.send(message); });
    ws.onMessage((message) => server.send(message));
  });
  await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed: 4401 } });
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  const choose = page.getByRole('button', { name: '选择 Agent' });
  if (await choose.isVisible().catch(() => false)) {
    await choose.click();
    await page.getByRole('menuitem', { name: /steward/ }).or(page.getByRole('menuitemradio', { name: /steward/ })).first().click();
  }
  return feed;
}

async function sendThenBackground(page, feed, text) {
  const editor = page.getByRole('textbox', { name: '消息' });
  await editor.click(); await editor.type(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText(text).first()).toBeAttached();
  await page.waitForTimeout(300);
  feed.paused = true;
  await page.waitForTimeout(4000);
}

async function wake(page, feed) {
  feed.paused = false;
  for (const ws of feed.clients.splice(0)) await ws.close({ code: 1006 }).catch(() => {});
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/, { timeout: 15_000 });
}

test('a final that landed while the phone was away shows after it comes back', async ({ page, request }) => {
  const feed = await openWithPausableFeed(page, request, 'progress-real');
  await sendThenBackground(page, feed, 'while away');
  await wake(page, feed);
  await expect(page.getByText('检查完毕')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.progress-running-header')).toHaveCount(0);
});

test('a stretch longer than one history page is fetched whole', async ({ page, request }) => {
  const feed = await openWithPausableFeed(page, request, 'progress-real-long');
  await sendThenBackground(page, feed, 'long while away');
  await wake(page, feed);
  await expect(page.getByText('检查完毕')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.progress-running-header')).toHaveCount(0);
});
