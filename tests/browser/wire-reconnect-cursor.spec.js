import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'deep-history', seed: 1487 },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

function parseFrame(payload) {
  try {
    const frame = JSON.parse(String(payload));
    return frame?.frame_type === 'attach' ? frame : null;
  } catch {
    return null;
  }
}

test('TC-1487 reconnect attach uses the latest public cursor snapshot', async ({ page, request }) => {
  const attachFrames = [];
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => {
      const frame = parseFrame(payload);
      if (frame) attachFrames.push(frame);
    });
  });

  await reset(request);
  await login(page);
  await page.locator('.channel-item').filter({
    has: page.locator('.channel-name', { hasText: /^c0\.project$/ }),
  }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.getByText('c0.project history 119: ask project-agent for PONG', { exact: true })).toBeVisible();

  const dropped = await request.post('/mock/control/action', { data: { type: 'drop' } });
  expect(dropped.ok()).toBe(true);
  await expect(page.locator('.connection-state')).toHaveClass(/state-reconnecting/, { timeout: 10_000 });
  await expect.poll(() => attachFrames.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);

  const initial = attachFrames[0];
  const resumed = attachFrames.at(-1);
  // The first attach starts before Feed has a local resume snapshot. After
  // the mounted timeline has caught up, a replacement attach must carry the
  // current cursor rather than replaying that empty initial snapshot.
  expect(initial.payload.since).toEqual({});
  expect(resumed.payload.since['c0.project']).toBeGreaterThan(0);
  expect(Object.values(resumed.payload.since).every((value) => Number(value) > 0)).toBe(true);
  expect(resumed.payload.generation).toBeGreaterThan(initial.payload.generation);
});
