import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const SOURCE_PATHS = [
  'index.html',
  'src/app/SurfaceShell.jsx',
  'src/app/AppShell.jsx',
  'src/ui/conversation/ConversationSurface.jsx',
  'src/ui/Timeline.jsx',
  'src/ui/Composer.jsx',
  'src/ui/timeline/LegendMessageList.jsx',
  'src/styles/base.css',
  'src/styles/app-shell.css',
  'src/styles/composer.css',
  'src/styles/responsive.css',
  'src/styles/timeline.css',
];

async function fingerprint() {
  const hash = createHash('sha256');
  for (const path of SOURCE_PATHS) hash.update(path).update('\0').update(await readFile(path));
  return { algorithm: 'sha256', digest: hash.digest('hex'), paths: SOURCE_PATHS };
}

async function attachJSON(testInfo, name, payload) {
  const path = testInfo.outputPath(name);
  await writeFile(path, `${JSON.stringify({
    capturedAt: new Date().toISOString(),
    source: await fingerprint(),
    evidenceKind: 'Chromium mobile emulation; not a physical Android device',
    ...payload,
  }, null, 2)}\n`, 'utf8');
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

async function attachScreenshot(page, testInfo, name) {
  const path = testInfo.outputPath(name);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function reset(request, scenario, seed) {
  const response = await request.post('/mock/control/reset', { data: { scenario, seed } });
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
  const editor = page.getByLabel('消息');
  await editor.fill('@st');
  const option = page.getByRole('option', { name: /steward/ });
  if (await option.isVisible().catch(() => false)) await option.click();
  await editor.press('End');
  await editor.pressSequentially(` ${text}`);
  await page.getByRole('button', { name: /发送/ }).click();
}

async function geometry(page, stage) {
  return page.evaluate((label) => {
    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const value = node.getBoundingClientRect();
      return {
        top: value.top, right: value.right, bottom: value.bottom, left: value.left,
        width: value.width, height: value.height,
      };
    };
    const hit = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return {
        selector,
        target: target ? `${target.localName}.${target.className || ''}` : '',
        ownsHit: Boolean(target && (node === target || node.contains(target))),
      };
    };
    const viewport = document.querySelector('.timeline-message-list');
    return {
      stage: label,
      inner: { width: innerWidth, height: innerHeight },
      visualViewport: globalThis.visualViewport ? {
        width: visualViewport.width, height: visualViewport.height,
        offsetTop: visualViewport.offsetTop, offsetLeft: visualViewport.offsetLeft,
      } : null,
      inputCapability: {
        pointerCoarse: matchMedia('(pointer: coarse)').matches,
        anyPointerCoarse: matchMedia('(any-pointer: coarse)').matches,
        hoverNone: matchMedia('(hover: none)').matches,
      },
      shellTopology: document.querySelector('.shell')?.dataset.shellTopology || '',
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
      root: rect('#root'),
      surface: rect('.conversation-surface'),
      reading: rect('.conversation-reading-slot'),
      viewport: rect('.timeline-message-list'),
      waiting: rect('.agent-wait-layer'),
      bottomStack: rect('.conversation-bottom-stack'),
      inputSlot: rect('.conversation-input-slot'),
      inputSlotScroll: (() => {
        const node = document.querySelector('.conversation-input-slot');
        return node ? {
          clientHeight: node.clientHeight,
          scrollHeight: node.scrollHeight,
          scrollTop: node.scrollTop,
        } : null;
      })(),
      composer: rect('.composer-wrap'),
      editor: rect('[aria-label="消息"]'),
      send: rect('.send-button'),
      waitingEdit: rect('.agent-wait-item .agent-wait-actions button'),
      mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
      gap: viewport ? viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop : null,
      activeLabel: document.activeElement?.getAttribute?.('aria-label') || '',
      hits: {
        send: hit('.send-button'),
        waitingEdit: hit('.agent-wait-item .agent-wait-actions button'),
      },
      safeAreaPolicy: {
        viewportMeta: document.querySelector('meta[name="viewport"]')?.content || '',
        envSupported: CSS.supports('padding-bottom: env(safe-area-inset-bottom)'),
        composerPaddingBottom: getComputedStyle(document.querySelector('.composer-wrap')).paddingBottom,
      },
    };
  }, stage);
}

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test('mobile keyboard-size, rotation, Waiting/Composer hit targets, and touch takeover remain isolated', async ({ browser, page, request }, testInfo) => {
  test.setTimeout(60_000);
  await reset(request, 'long-running-history', 0x92_20_01);
  await login(page);

  await sendToSteward(page, 'mobile active task');
  await expect(page.locator('.turn-card').filter({ hasText: 'mobile active task' })).toBeVisible();
  await sendToSteward(page, 'mobile queued task');
  await expect(page.getByRole('region', { name: '等待区' })).toContainText('mobile queued task');

  await page.locator('.timeline-message-list').evaluate((node) => {
    window.__MOBILE_UX_SCROLLER__ = node;
  });

  const editor = page.getByLabel('消息');
  await editor.focus();
  const portrait = await geometry(page, 'portrait');
  await attachScreenshot(page, testInfo, 'portrait.png');

  // This models the layout-viewport resize path exposed by automation. A real
  // IME may instead shrink only visualViewport; that requires device evidence.
  await page.setViewportSize({ width: 390, height: 500 });
  await expect.poll(() => page.evaluate(() => innerHeight)).toBe(500);
  const keyboardResize = await geometry(page, 'keyboard-layout-resize');
  await attachScreenshot(page, testInfo, 'keyboard-layout-resize.png');

  const client = await page.context().newCDPSession(page);
  const box = await page.locator('.timeline-message-list').boundingBox();
  expect(box).not.toBeNull();
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + Math.min(box.height - 30, box.height / 2));
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }],
  });
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x, y: y + 80, radiusX: 4, radiusY: 4, force: 1, id: 1 }],
  });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  const touch = await geometry(page, 'after-touch-takeover');

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('.shell')).toHaveAttribute('data-shell-topology', 'compact');
  const landscape = await geometry(page, 'landscape');
  await attachScreenshot(page, testInfo, 'landscape.png');
  const identityAfterRotation = await page.evaluate(() => window.__MOBILE_UX_SCROLLER__ === document.querySelector('.timeline-message-list'));

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.shell')).toHaveAttribute('data-shell-topology', 'mobile');
  const restored = await geometry(page, 'portrait-restored');
  await attachScreenshot(page, testInfo, 'portrait-restored.png');
  const identityAfterRestore = await page.evaluate(() => window.__MOBILE_UX_SCROLLER__ === document.querySelector('.timeline-message-list'));

  const desktopContext = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    hasTouch: false,
    isMobile: false,
    viewport: { width: 1280, height: 800 },
  });
  const desktopPage = await desktopContext.newPage();
  await login(desktopPage);
  await expect(desktopPage.getByRole('region', { name: '等待区' })).toBeVisible();
  const desktopDensity = await geometry(desktopPage, 'desktop-mouse-density');
  await desktopContext.close();

  await attachJSON(testInfo, 'mobile-ux-isolation.json', {
    physicalDevice: { available: false, reason: 'adb/xcrun/devicectl are unavailable in this environment' },
    portrait, keyboardResize, touch, landscape, restored,
    desktopDensity,
    identityAfterRotation, identityAfterRestore,
  });

  for (const sample of [portrait, keyboardResize, touch, landscape, restored]) {
    expect(sample.inputCapability.pointerCoarse || sample.inputCapability.anyPointerCoarse, `${sample.stage}:coarse pointer`).toBe(true);
    expect(sample.documentWidth, sample.stage).toBeLessThanOrEqual(sample.inner.width);
    expect(sample.reading.height, sample.stage).toBeGreaterThan(0);
    expect(sample.editor.top, `${sample.stage}:editor top`).toBeGreaterThanOrEqual(0);
    expect(sample.editor.bottom, `${sample.stage}:editor bottom`).toBeLessThanOrEqual(sample.inner.height + 0.5);
    expect(sample.send.bottom, `${sample.stage}:send bottom`).toBeLessThanOrEqual(sample.inner.height + 0.5);
    expect(sample.composer.bottom, `${sample.stage}:composer bottom`).toBeLessThanOrEqual(sample.surface.bottom + 0.5);
    expect(sample.inputSlotScroll.scrollHeight, `${sample.stage}:input slot overflow`).toBeLessThanOrEqual(sample.inputSlotScroll.clientHeight);
    expect(sample.hits.send?.ownsHit, `${sample.stage}:send hit`).toBe(true);
    expect(sample.hits.waitingEdit?.ownsHit, `${sample.stage}:waiting hit`).toBe(true);
    expect(sample.waiting.bottom, `${sample.stage}:waiting/composer overlap`).toBeLessThanOrEqual(sample.composer.top + 0.5);
    expect.soft(sample.send.width, `${sample.stage}:send touch width`).toBeGreaterThanOrEqual(44);
    expect.soft(sample.send.height, `${sample.stage}:send touch height`).toBeGreaterThanOrEqual(44);
    expect.soft(sample.waitingEdit.width, `${sample.stage}:waiting touch width`).toBeGreaterThanOrEqual(44);
    expect.soft(sample.waitingEdit.height, `${sample.stage}:waiting touch height`).toBeGreaterThanOrEqual(44);
  }
  expect(keyboardResize.activeLabel).toBe('消息');
  expect(touch.mode).toBe('browsing');
  expect(landscape.mode).toBe('browsing');
  expect(restored.mode).toBe('browsing');
  expect(identityAfterRotation).toBe(true);
  expect(identityAfterRestore).toBe(true);
  expect(desktopDensity.inputCapability.pointerCoarse || desktopDensity.inputCapability.anyPointerCoarse).toBe(false);
  expect(desktopDensity.send.width).toBe(32);
  expect(desktopDensity.send.height).toBe(32);
  expect(desktopDensity.waitingEdit.width).toBe(40);
  expect(desktopDensity.waitingEdit.height).toBe(30);
});
