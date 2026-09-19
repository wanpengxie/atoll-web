import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const SOURCE_PATHS = [
  'src/App.jsx',
  'src/app/hooks/useChannelFeed.js',
  'src/model/channel-feed-runtime.js',
  'src/model/cursors.js',
  'src/model/history-demand.js',
  'src/ui/timeline/useReadingSession.js',
];

async function sourceDigest() {
  const hash = createHash('sha256');
  for (const path of SOURCE_PATHS) hash.update(path).update('\0').update(await readFile(path));
  return hash.digest('hex');
}

async function attachEvidence(testInfo, name, payload) {
  const path = testInfo.outputPath(name);
  await writeFile(path, `${JSON.stringify({ sourceDigest: await sourceDigest(), ...payload }, null, 2)}\n`, 'utf8');
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

async function reset(request, seed) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'multi-channel', seed },
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

function channel(page, name) {
  return page.locator('.channel-item').filter({
    has: page.locator('.channel-name', {
      hasText: new RegExp(`^${name.replace('.', '\\.')}$`),
    }),
  });
}

async function approval(request, channelID) {
  const response = await request.post('/mock/control/action', {
    data: { type: 'approval', channel_id: channelID },
  });
  expect(response.ok()).toBe(true);
}

async function railEvidence(page, channelID) {
  return page.evaluate((id) => ({
    rail: window.__ATOLL_DIAGNOSTICS__?.rail?.snapshot?.(id),
    reading: window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.(),
    mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
    jump: document.querySelector('.timeline-jump-latest')?.textContent || '',
  }), channelID);
}

test('tail acknowledgement survives channel switches and reload while a future row notifies', async ({ page, request }, testInfo) => {
  await reset(request, 0x4e_05);

  // Bind the browser run to the served implementation, not merely the files
  // fingerprinted by the Node-side evidence attachment.
  const [servedFeed, servedRuntime, servedApp] = await Promise.all([
    request.get('/src/app/hooks/useChannelFeed.js').then((response) => response.text()),
    request.get('/src/model/channel-feed-runtime.js').then((response) => response.text()),
    request.get('/src/App.jsx').then((response) => response.text()),
  ]);
  expect(servedFeed).toContain('createChannelFeedRuntime');
  expect(servedRuntime).toContain('notificationHighWater');
  expect(servedRuntime).toContain('acknowledgeNotifications');
  expect(servedApp).not.toContain('projectChannelUnread');

  await login(page);
  const home = channel(page, 'c0');
  const project = channel(page, 'c0.project');
  await approval(request, 'c0.project');
  await approval(request, 'c0.project');
  await expect(project.locator('.unread-related')).toHaveText('2');

  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'notification-high-water-persistence' }));
  await project.click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(project.locator('.unread-related')).toHaveCount(0);
  const afterAcknowledgement = await railEvidence(page, 'c0.project');

  await home.click();
  await expect(project.locator('.unread-related')).toHaveCount(0);
  await project.click();
  await expect(project.locator('.unread-related')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(project.locator('.unread-related')).toHaveCount(0);
  const afterReload = await railEvidence(page, 'c0.project');

  await home.click();
  await approval(request, 'c0.project');
  await expect(project.locator('.unread-related')).toHaveText('1');
  const futureUnread = await railEvidence(page, 'c0.project');
  await project.click();
  await expect(project.locator('.unread-related')).toHaveCount(0);
  const afterFutureAcknowledgement = await railEvidence(page, 'c0.project');

  const channelSnapshot = (evidence) => evidence.rail?.channels?.[0];
  expect(channelSnapshot(afterAcknowledgement)).toMatchObject({
    readSeq: 25,
    notificationHighWater: 27,
    counts: { related: 0, total: 0 },
  });
  expect(channelSnapshot(afterReload)).toMatchObject({
    notificationHighWater: 27,
    counts: { related: 0, total: 0 },
  });
  expect(channelSnapshot(futureUnread)).toMatchObject({
    notificationHighWater: 27,
    counts: { related: 1, total: 1 },
  });
  expect(channelSnapshot(afterFutureAcknowledgement)).toMatchObject({
    notificationHighWater: 28,
    counts: { related: 0, total: 0 },
  });
  await attachEvidence(testInfo, 'notification-high-water-persistence.json', {
    afterAcknowledgement,
    afterReload,
    futureUnread,
    afterFutureAcknowledgement,
  });
});

test('cached hydration cannot resurrect a tail-acknowledged notification', async ({ page, request }, testInfo) => {
  await reset(request, 0x4e_06);
  await login(page);
  const project = channel(page, 'c0.project');
  await approval(request, 'c0.project');
  await approval(request, 'c0.project');
  await expect(project.locator('.unread-related')).toHaveText('2');

  // Cross the async row/checkpoint persistence boundary before testing cold
  // hydration, then acknowledge from the hydrated channel tail.
  await page.waitForTimeout(600);
  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(project.locator('.unread-related')).toHaveText('2');
  await project.click();
  await expect(project.locator('.unread-related')).toHaveCount(0);
  const afterHydratedAcknowledgement = await railEvidence(page, 'c0.project');

  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(project.locator('.unread-related')).toHaveCount(0);
  const afterSecondHydration = await railEvidence(page, 'c0.project');
  expect(afterHydratedAcknowledgement.rail?.channels?.[0]).toMatchObject({
    notificationHighWater: 27,
    counts: { related: 0, total: 0 },
  });
  expect(afterSecondHydration.rail?.channels?.[0]).toMatchObject({
    notificationHighWater: 27,
    counts: { related: 0, total: 0 },
  });
  await attachEvidence(testInfo, 'notification-high-water-hydration.json', {
    afterHydratedAcknowledgement,
    afterSecondHydration,
  });
});

test('a filtered tail acknowledges the channel notification boundary', async ({ page, request }, testInfo) => {
  await reset(request, 0x4e_07);
  await login(page);
  const home = channel(page, 'c0');
  const project = channel(page, 'c0.project');

  await project.click();
  await page.getByTitle('只看我与 project-agent 的往来').click();
  await expect(page.getByTitle('取消只看 project-agent')).toHaveAttribute('aria-pressed', 'true');
  await home.click();
  await approval(request, 'c0.project');
  await approval(request, 'c0.project');
  await expect(project.locator('.unread-related')).toHaveText('2');

  await project.click();
  await expect(page.getByTitle('取消只看 project-agent')).toHaveAttribute('aria-pressed', 'true');
  await expect(project.locator('.unread-related')).toHaveCount(0);
  const atFilteredTail = await railEvidence(page, 'c0.project');
  await home.click();
  await expect(project.locator('.unread-related')).toHaveCount(0);
  const afterLeaving = await railEvidence(page, 'c0.project');

  expect(atFilteredTail.rail?.channels?.[0]).toMatchObject({
    notificationHighWater: 27,
    counts: { related: 0, total: 0 },
  });
  expect(afterLeaving.rail?.channels?.[0]).toMatchObject({
    notificationHighWater: 27,
    counts: { related: 0, total: 0 },
  });
  await attachEvidence(testInfo, 'notification-high-water-filtered.json', {
    atFilteredTail,
    afterLeaving,
  });
});

test('a continuously followed related arrival advances only after the mounted tail presents it', async ({ page, request }, testInfo) => {
  await reset(request, 0x4e_08);
  await login(page);
  const project = channel(page, 'c0.project');
  await project.click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(project.locator('.unread-related')).toHaveCount(0);
  const before = await railEvidence(page, 'c0.project');
  const beforeBoundary = Number(before.rail?.channels?.[0]?.notificationHighWater || 0);

  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'notification-presented-follow' }));
  await approval(request, 'c0.project');
  await expect.poll(async () => {
    const evidence = await railEvidence(page, 'c0.project');
    return Number(evidence.rail?.channels?.[0]?.notificationHighWater || 0);
  }).toBeGreaterThan(beforeBoundary);
  await expect(project.locator('.unread-related')).toHaveCount(0);
  const after = await railEvidence(page, 'c0.project');
  expect(after.rail?.channels?.[0]).toMatchObject({ counts: { related: 0, total: 0 } });
  expect(after.reading?.entries?.some((entry) => (
    entry.event === 'reading.installed-tail-ack'
      || entry.event === 'reading.arrival-resolution'
  ))).toBe(true);
  await attachEvidence(testInfo, 'notification-presented-follow.json', { before, after });
});
