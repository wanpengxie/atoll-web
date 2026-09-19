import { expect, test } from '@playwright/test';

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

async function reset(request, seed) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'long-running-history', seed },
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
  await expect(page.locator('.timeline-message-list')).toBeVisible();
}

async function sendToSteward(page, text) {
  const choose = page.getByRole('button', { name: '选择 Agent' });
  if (await choose.isVisible().catch(() => false)) {
    await choose.click();
    await page.getByRole('menu', { name: '选择目标 Agent' })
      .getByRole('menuitem', { name: 'steward' }).click();
  }
  const editor = page.getByLabel('消息');
  await editor.fill(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
}

async function geometry(page, stage) {
  return page.evaluate((label) => {
    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return { top: box.top, right: box.right, bottom: box.bottom, left: box.left, width: box.width, height: box.height };
    };
    const hit = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return { ownsHit: Boolean(target && (target === node || node.contains(target))), target: target?.className || '' };
    };
    const list = document.querySelector('.timeline-message-list');
    return {
      stage: label,
      viewport: { width: innerWidth, height: innerHeight },
      topology: document.querySelector('.shell')?.dataset.shellTopology || '',
      documentWidth: document.documentElement.scrollWidth,
      surface: rect('.conversation-surface'),
      reading: rect('.conversation-reading-slot'),
      list: rect('.timeline-message-list'),
      waiting: rect('.agent-wait-layer'),
      composer: rect('.composer-wrap'),
      inputSlot: rect('.conversation-input-slot'),
      editor: rect('[aria-label="消息"]'),
      send: rect('.send-button'),
      waitingEdit: rect('.agent-wait-item .agent-wait-actions button'),
      inputScroll: (() => {
        const node = document.querySelector('.conversation-input-slot');
        return node ? { clientHeight: node.clientHeight, scrollHeight: node.scrollHeight } : null;
      })(),
      mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
      hit: { send: hit('.send-button'), waitingEdit: hit('.agent-wait-item .agent-wait-actions button') },
      activeLabel: document.activeElement?.getAttribute?.('aria-label') || '',
    };
  }, stage);
}

function assertSurface(sample) {
  expect(sample.documentWidth, `${sample.stage}: page overflow`).toBeLessThanOrEqual(sample.viewport.width);
  expect(sample.reading?.height, `${sample.stage}: reading surface`).toBeGreaterThan(0);
  expect(sample.editor?.top, `${sample.stage}: editor top`).toBeGreaterThanOrEqual(0);
  expect(sample.editor?.bottom, `${sample.stage}: editor bottom`).toBeLessThanOrEqual(sample.viewport.height + 1);
  expect(sample.send?.bottom, `${sample.stage}: send bottom`).toBeLessThanOrEqual(sample.viewport.height + 1);
  expect(sample.inputScroll?.scrollHeight, `${sample.stage}: input does not own page overflow`).toBeLessThanOrEqual(sample.inputScroll?.clientHeight || 0);
  expect(sample.hit.send?.ownsHit, `${sample.stage}: send owns hit target`).toBe(true);
  expect(sample.hit.waitingEdit?.ownsHit, `${sample.stage}: waiting action owns hit target`).toBe(true);
  expect(sample.waiting?.bottom, `${sample.stage}: waiting overlaps composer`).toBeLessThanOrEqual((sample.composer?.top || 0) + 1);
  expect(sample.send?.width, `${sample.stage}: send target width`).toBeGreaterThanOrEqual(44);
  expect(sample.send?.height, `${sample.stage}: send target height`).toBeGreaterThanOrEqual(44);
}

test('mobile keyboard resize, rotation and touch takeover keep Waiting and Composer isolated', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  await reset(request, 0x92_20_01);
  await login(page);
  await sendToSteward(page, 'mobile active task');
  await expect(page.locator('.turn-card').filter({ hasText: 'mobile active task' })).toBeVisible();
  await sendToSteward(page, 'mobile queued task');
  await expect(page.getByRole('region', { name: '等待区' })).toContainText('mobile queued task');

  await page.locator('.timeline-message-list').evaluate((node) => { window.__MOBILE_LIST__ = node; });
  const editor = page.getByLabel('消息');
  await editor.focus();
  const portrait = await geometry(page, 'portrait');

  await page.setViewportSize({ width: 390, height: 500 });
  await expect.poll(() => page.evaluate(() => innerHeight)).toBe(500);
  const keyboard = await geometry(page, 'keyboard-resize');
  expect(keyboard.activeLabel).toBe('消息');

  const client = await page.context().newCDPSession(page);
  const box = await page.locator('.timeline-message-list').boundingBox();
  expect(box).not.toBeNull();
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + Math.min(box.height - 30, box.height / 2));
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + 80, radiusX: 4, radiusY: 4, force: 1, id: 1 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  const touch = await geometry(page, 'touch-takeover');

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('.shell')).toHaveAttribute('data-shell-topology', 'compact');
  const landscape = await geometry(page, 'landscape');
  const sameAfterRotation = await page.evaluate(() => window.__MOBILE_LIST__ === document.querySelector('.timeline-message-list'));

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.shell')).toHaveAttribute('data-shell-topology', 'mobile');
  const restored = await geometry(page, 'portrait-restored');
  const sameAfterRestore = await page.evaluate(() => window.__MOBILE_LIST__ === document.querySelector('.timeline-message-list'));

  await testInfo.attach('mobile-ux-isolation.json', {
    body: JSON.stringify({ portrait, keyboard, touch, landscape, restored, sameAfterRotation, sameAfterRestore, evidence: 'Chromium mobile emulation' }, null, 2),
    contentType: 'application/json',
  });
  for (const sample of [portrait, keyboard, touch, landscape, restored]) assertSurface(sample);
  expect(touch.mode).toBe('browsing');
  expect(landscape.mode).toBe('browsing');
  expect(restored.mode).toBe('browsing');
  expect(sameAfterRotation).toBe(true);
  expect(sameAfterRestore).toBe(true);
});
