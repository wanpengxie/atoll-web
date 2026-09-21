import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'multi-channel', seed: 1601 },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.getByText('c0.project', { exact: true })).toBeVisible();
}

function isObservationRequest(request) {
  const path = new URL(request.url()).pathname;
  return path.startsWith('/obs/space/channels')
    || /\/obs\/channel\/[^/]+\/actors$/.test(path);
}

test('TC0277 WebSocket OPEN 后不会周期轮询频道与成员 OBS', async ({ page, request }, testInfo) => {
  await reset(request);
  const observations = [];
  page.on('request', (entry) => {
    if (isObservationRequest(entry)) observations.push({ path: new URL(entry.url()).pathname, at: Date.now() });
  });

  await login(page);

  // Keep the historical settled-window contract: the initial attach/OBS
  // publication may finish here, but a live WebSocket must not restart the
  // whole space/channel observation tree on a timer.
  await page.waitForTimeout(1_000);
  const settled = observations.splice(0);
  await page.waitForTimeout(2_200);
  await testInfo.attach('tc0277-observation-window.json', {
    body: JSON.stringify({ settled, afterSettled: observations }, null, 2),
    contentType: 'application/json',
  });
  expect(observations, 'OBS must not be polled after the initial settled window').toEqual([]);
});
