import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

async function attachJSON(testInfo, name, value) {
  const path = testInfo.outputPath(name);
  await writeFile(path, `${JSON.stringify({
    capturedAt: new Date().toISOString(), ...value,
  }, null, 2)}\n`, 'utf8');
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

async function reset(request, scenario, seed) {
  const response = await request.post('/mock/control/reset', { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function approval(request, channelId = 'c0') {
  const response = await request.post('/mock/control/action', {
    data: { type: 'approval', channel_id: channelId },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.locator('.timeline-message-list')).toBeVisible();
}

async function sendToSteward(page, text) {
  const editor = page.getByLabel('消息');
  await editor.fill('@st');
  const option = page.getByRole('option', { name: /steward/ });
  if (await option.isVisible().catch(() => false)) await option.click();
  await editor.press('End');
  await editor.pressSequentially(` ${text}`);
  await page.getByRole('button', { name: /发送/ }).click();
}

async function wheelToPhysicalGap(page, desiredGap) {
  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  const gap = await viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
  let currentGap = gap;
  // Keep each native wheel bounded so Chromium does not coalesce one large
  // delta into a tail snap; the contract needs a real non-tail paint.
  for (let index = 0; index < 20 && currentGap > desiredGap + 80; index += 1) {
    await page.mouse.wheel(0, Math.min(160, Math.max(1, currentGap - desiredGap)));
    await page.waitForTimeout(100);
    currentGap = await viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
  }
  await expect.poll(() => viewport.evaluate((node) => (
    node.scrollHeight - node.clientHeight - node.scrollTop
  ))).toBeGreaterThan(1);
  return viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
}

async function evidence(page, needle) {
  return page.evaluate((text) => {
    const viewport = document.querySelector('.timeline-message-list');
    const viewportRect = viewport?.getBoundingClientRect();
    const row = [...(viewport?.querySelectorAll('[data-presentation-row-id]') || [])]
      .find((candidate) => candidate.textContent?.includes(text));
    const rowRect = row?.getBoundingClientRect();
    const waiting = document.querySelector('.agent-wait-layer');
    const waitingRect = waiting?.getBoundingClientRect();
    const overlapTop = Math.max(rowRect?.top || 0, waitingRect?.top || Number.POSITIVE_INFINITY);
    const overlapBottom = Math.min(rowRect?.bottom || 0, waitingRect?.bottom || Number.NEGATIVE_INFINITY);
    const overlapY = overlapBottom > overlapTop ? (overlapTop + overlapBottom) / 2 : null;
    const overlapTarget = overlapY == null || !rowRect
      ? null
      : document.elementFromPoint(rowRect.left + rowRect.width / 2, overlapY);
    const centerTarget = !rowRect
      ? null
      : document.elementFromPoint(rowRect.left + rowRect.width / 2, (rowRect.top + rowRect.bottom) / 2);
    const visibleTop = Math.max(rowRect?.top || 0, viewportRect?.top || 0);
    const visibleBottom = Math.min(rowRect?.bottom || 0, viewportRect?.bottom || 0);
    const visibleY = visibleBottom > visibleTop ? (visibleTop + visibleBottom) / 2 : null;
    const visibleTargets = visibleY == null || !rowRect ? [] : [0.1, 0.25, 0.75, 0.9]
      .map((ratio) => document.elementFromPoint(rowRect.left + rowRect.width * ratio, visibleY));
    return {
      needle: text,
      mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
      jump: document.querySelector('.timeline-jump-latest')?.textContent || '',
      gap: viewport ? viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop : null,
      viewport: viewportRect ? { top: viewportRect.top, bottom: viewportRect.bottom } : null,
      rowID: row?.dataset.presentationRowId || '',
      row: rowRect ? { top: rowRect.top, bottom: rowRect.bottom, left: rowRect.left, right: rowRect.right } : null,
      rowIntersectsViewport: Boolean(rowRect && viewportRect
        && rowRect.bottom > viewportRect.top + 0.5 && rowRect.top < viewportRect.bottom - 0.5),
      rowCenterOwnsHit: Boolean(row && centerTarget && (row === centerTarget || row.contains(centerTarget))),
      rowHasOwnedVisibleHit: Boolean(row && visibleTargets.some((target) => target && (row === target || row.contains(target)))),
      viewportVisiblePixels: Math.max(0, visibleBottom - visibleTop),
      waiting: waitingRect ? { top: waitingRect.top, bottom: waitingRect.bottom, left: waitingRect.left, right: waitingRect.right } : null,
      waitingOverlap: Math.max(0, overlapBottom - overlapTop),
      overlapOwnedByWaiting: Boolean(waiting && overlapTarget && (waiting === overlapTarget || waiting.contains(overlapTarget))),
    };
  }, needle);
}

test('wheel-visible committed arrival auto-acknowledges before exact physical tail', async ({ page, request }, testInfo) => {
  await reset(request, 'deep-history', 0x92_24_01);
  await login(page);
  const viewport = page.locator('.timeline-message-list');
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  await viewport.hover();
  await page.mouse.wheel(0, -800);
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeGreaterThan(24);

  await approval(request);
  await expect(page.getByRole('button', { name: /1 条新动态/ })).toBeVisible();
  await wheelToPhysicalGap(page, 12);
  await page.waitForTimeout(150);

  const sample = await evidence(page, 'Approve live mock action');
  await attachJSON(testInfo, 'visible-gap-unseen.json', { sample });
  expect(sample.gap).toBeGreaterThan(1);
  expect(sample.rowIntersectsViewport).toBe(true);
  expect(sample.viewportVisiblePixels).toBeGreaterThan(40);
  expect(sample.rowHasOwnedVisibleHit).toBe(true);
  expect(sample.jump).toBe('');
});

test('Waiting-covered committed arrival remains unseen until actually exposed', async ({ page, request }, testInfo) => {
  await reset(request, 'long-running-history', 0x92_24_02);
  await login(page);
  await sendToSteward(page, 'visible ack active task');
  await expect(page.locator('.task-control-buttons').getByRole('button', { name: '停止' })).toBeVisible();
  await sendToSteward(page, 'visible ack queued task');
  await expect(page.getByRole('region', { name: '等待区' })).toContainText('visible ack queued task');

  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  await page.mouse.wheel(0, -800);
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeGreaterThan(24);
  await approval(request);
  await expect(page.getByRole('button', { name: /1 条新动态/ })).toBeVisible();
  // Bring the arrival up in small notches until it has entered the list but
  // lies entirely behind the waiting dock: not on screen for the reader.
  const where = () => page.evaluate(() => {
    const list = document.querySelector('.timeline-message-list').getBoundingClientRect();
    const dock = document.querySelector('.agent-wait-layer')?.getBoundingClientRect();
    const card = [...document.querySelectorAll('[data-presentation-row-id]')]
      .find((node) => node.textContent.includes('Approve live mock action'))?.getBoundingClientRect();
    return { listBottom: list.bottom, dockTop: dock?.top ?? list.bottom, cardTop: card?.top ?? Infinity };
  });
  for (let step = 0; step < 80; step += 1) {
    const now = await where();
    if (now.cardTop < now.listBottom) break;
    await page.mouse.wheel(0, 40);
    await page.waitForTimeout(40);
  }
  const covered = await where();
  expect(covered.cardTop).toBeGreaterThanOrEqual(covered.dockTop);
  expect(covered.cardTop).toBeLessThan(covered.listBottom);
  await page.waitForTimeout(450);
  await expect(page.getByRole('button', { name: /1 条新动态/ })).toBeVisible();

  // Past the dock it is on screen, and it is read.
  for (let step = 0; step < 40 && (await where()).cardTop > (await where()).dockTop - 40; step += 1) {
    await page.mouse.wheel(0, 40);
    await page.waitForTimeout(40);
  }
  await expect(page.getByRole('button', { name: /1 条新动态/ })).toHaveCount(0, { timeout: 5_000 });
  await attachJSON(testInfo, 'waiting-covered-unseen.json', { covered });
});
