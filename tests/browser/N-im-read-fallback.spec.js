import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { READING_OWNER_SELECTOR } from './reading-owner.js';

// IM 读侧兜底的生产路径证据（监理 2026-09-18 14:58 补充裁定）。
// 用户只有三种状态：(1) 在底部且页面可见 —— 新到达即读，恒不产生未读计数；
// (2) 不在底部 / 在别的频道 / 页面不可见 —— 到达计入未读；(3) 回到底部 ——
// 该范围已装入的积压一次清。
// 本 spec 走真实 Chromium 的 main→WorkspaceApp→ConversationSurface→VendorListExecutor，不碰任何夹具。

// ConversationSurface now publishes one canonical reading owner through the
// ReadingContainerHandoff. Keep browser evidence on that owner instead of
// reaching into the retired dual-layer handoff shape.
const ACTIVE_READING_SELECTOR = READING_OWNER_SELECTOR;

function readingViewport(page) {
  return page.locator(ACTIVE_READING_SELECTOR);
}

async function attachJSON(testInfo, name, payload) {
  const path = testInfo.outputPath(name);
  await writeFile(path, `${JSON.stringify({
    capturedAt: new Date().toISOString(),
    ...payload,
  }, null, 2)}\n`, 'utf8');
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

async function reset(request, seed) {
  const response = await request.post('/mock/control/reset', { data: { scenario: 'multi-channel', seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.locator('.timeline')).toBeVisible();
  await expect(readingViewport(page)).toHaveCount(1);
  await expect(readingViewport(page)).toBeVisible();
  await expect(page.locator('.top-error')).toHaveCount(0);
}

// 一条真实到达：steward 向我发起一条新的 human.approve 请求。它是一条全新的
// root turn（每次 id 不同），频道栏与视窗都认（request 既是 rail 通知也是视窗
// 通知）。夹具里 push_terminal 打在已有 root 上会被判成 terminal_conflict、
// pulse 是 not_presented，两者都不产生任何计数，不能用来验证这条契约——这是
// 实测结论，见 ztmp 诊断记录。
async function arrive(request, channelId, count = 1) {
  const ids = [];
  for (let index = 0; index < count; index += 1) {
    const response = await request.post('/mock/control/action', { data: { type: 'approval', channel_id: channelId } });
    expect(response.ok()).toBe(true);
    const body = await response.json();
    if (body?.id) ids.push(String(body.id));
  }
  return ids;
}

async function fillTail(request, channelId, count) {
  const response = await request.post('/mock/control/action', {
    data: { type: 'notification_lifecycle', channel_id: channelId, phase: 'tail', count },
  });
  expect(response.ok()).toBe(true);
}

function railSelector(page, name) {
  return page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: new RegExp(`^${name.replace('.', '\\.')}$`) }) });
}

async function readCounts(page, channelName) {
  return page.evaluate((name) => {
    const items = [...document.querySelectorAll('.channel-item')];
    const item = items.find((node) => node.querySelector('.channel-name')?.textContent?.trim() === name);
    const number = (node) => (node ? Number(String(node.textContent).replace(/[^0-9]/g, '')) || (String(node.textContent).trim() ? -1 : 0) : 0);
    return {
      related: number(item?.querySelector('.unread-related')),
      other: number(item?.querySelector('.unread-total:not(.unread-pending)')),
      pending: Boolean(item?.querySelector('.unread-pending')),
      jump: Number(String(document.querySelector('.timeline-jump-latest')?.textContent || '').replace(/[^0-9]/g, '')) || 0,
      gap: (() => {
        const node = document.querySelector('.timeline-reading-stack > .timeline-reading-layer.is-active > .timeline-message-list')
          || document.querySelector('.timeline-message-list');
        if (!node) return null;
        return node.dataset.readingContainer === 'following-tail'
          ? Math.abs(Number(node.scrollTop || 0))
          : node.scrollHeight - node.clientHeight - node.scrollTop;
      })(),
      mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
    };
  }, channelName);
}

async function startCapture(page, channelName) {
  await page.evaluate((name) => {
    const state = { active: true, startedAt: performance.now(), frames: [] };
    window.__N_READ_FALLBACK_CAPTURE__ = state;
    const tick = () => {
      if (!state.active) return;
      const items = [...document.querySelectorAll('.channel-item')];
      const item = items.find((node) => node.querySelector('.channel-name')?.textContent?.trim() === name);
      const digits = (node) => Number(String(node?.textContent || '').replace(/[^0-9]/g, '')) || 0;
        const viewport = document.querySelector('.timeline-reading-stack > .timeline-reading-layer.is-active > .timeline-message-list')
        || document.querySelector('.timeline-message-list');
      state.frames.push({
        elapsedMs: Math.round(performance.now() - state.startedAt),
        badgeRelated: digits(item?.querySelector('.unread-related')),
        badgeOther: digits(item?.querySelector('.unread-total:not(.unread-pending)')),
        badgePending: Boolean(item?.querySelector('.unread-pending')),
        jump: digits(document.querySelector('.timeline-jump-latest')),
        jumpShown: Boolean(document.querySelector('.timeline-jump-latest')),
        gap: viewport ? Math.round(viewport.dataset.readingContainer === 'following-tail'
          ? Math.abs(Number(viewport.scrollTop || 0))
          : viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop) : null,
        mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
        visibility: document.visibilityState,
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, channelName);
}

async function stopCapture(page) {
  return page.evaluate(() => {
    const capture = window.__N_READ_FALLBACK_CAPTURE__;
    if (!capture) return [];
    capture.active = false;
    return capture.frames;
  });
}

async function atBottom(page) {
  await expect.poll(() => readingViewport(page).evaluate((node) => (
    node.dataset.readingContainer === 'following-tail'
      ? Math.abs(Number(node.scrollTop || 0))
      : node.scrollHeight - node.clientHeight - node.scrollTop
  )), { timeout: 15_000 }).toBeLessThanOrEqual(2);
}

async function reachBottom(page) {
  const viewport = readingViewport(page);
  await viewport.hover();
  await page.mouse.wheel(0, 100_000);
  await atBottom(page);
}

// Reading's settled observation is the public test fence for this contract.
// It carries the current activation, presentation revision, hit-tested rows,
// and tail identity.  A DOM assertion before this fence is only an eventual
// paint sample and can legitimately see the previous unread projection.
async function settledTailObservation(page, channelId = 'c0') {
  return page.evaluate(({ channelId, selector }) => {
    const owner = document.querySelector(selector);
    const stack = owner?.closest('.timeline-reading-stack');
    const activationID = String(stack?.dataset.readingActivation || '');
    const presentationRevision = Number(owner?.dataset.readingPresentationRevision || 0);
    const mountedRowIDs = owner
      ? [...owner.querySelectorAll('[data-presentation-row-id]')]
        .map((row) => String(row.dataset.presentationRowId || ''))
        .filter(Boolean)
      : [];
    const entries = window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.().entries || [];
    const observation = [...entries].reverse().find((entry) => {
      const detail = entry.event === 'reading.observation' ? entry.detail : null;
      return detail?.activationID === activationID
        && detail?.settled === true
        && detail?.atTail === true
        && detail?.surfaceVisible === true
        && detail?.authorityVerified === true
        && Number(detail.presentationRevision) === presentationRevision
        && Number(detail.domPresentationRevision) === presentationRevision
        && Array.isArray(detail.visibleRowIDs)
        && detail.visibleRowIDs.length > 0
        && detail.visibleRowIDs.includes(detail.tailID)
        && mountedRowIDs.includes(String(detail.tailID || ''));
    });
    const rail = window.__ATOLL_DIAGNOSTICS__?.rail?.snapshot?.(channelId) || null;
    const channel = (rail?.channels || []).find((entry) => entry.channelId === channelId) || null;
    if (!observation || channel?.authorityReady !== true) return null;
    return {
      activationID,
      presentationRevision,
      observation: observation.detail,
      rail: {
        authorityReady: channel.authorityReady === true,
        notificationHighWater: Number(channel.notificationHighWater || 0),
        counts: channel.counts || {},
      },
    };
  }, { channelId, selector: ACTIVE_READING_SELECTOR });
}

async function waitForSettledTail(page, channelId = 'c0') {
  await expect.poll(
    () => settledTailObservation(page, channelId),
    { timeout: 15_000 },
  ).not.toBeNull();
  return settledTailObservation(page, channelId);
}

// The browser has no public command that delivers an already-issued tail
// receipt after its Reading activation has been retired.  Capture and replay
// the actual ConversationSurface callback payload only to exercise that
// transport edge; no product state, owner, or compatibility path is installed
// by the test.  Failure to find the current callback is a hard oracle failure,
// never a skip.
async function captureTailReceipt(page) {
  return page.evaluate(() => {
    const node = document.querySelector('.conversation-surface');
    const fiberKey = Object.keys(node || {}).find((key) => key.startsWith('__reactFiber$'));
    let fiber = fiberKey ? node[fiberKey] : null;
    let surface = null;
    for (let index = 0; fiber && index < 80; index += 1, fiber = fiber.return) {
      const type = fiber.type;
      const name = typeof type === 'function' ? (type.displayName || type.name || '') : '';
      if (name === 'ConversationSurface') {
        surface = fiber;
        break;
      }
    }
    let hook = surface?.memoizedState || null;
    let receipt = null;
    for (let index = 0; hook && index < 200; index += 1, hook = hook.next) {
      const state = hook.memoizedState;
      const candidate = Array.isArray(state) ? state[0] : null;
      if (candidate?.tailCaughtUp?.caughtUp === true && candidate.session) {
        receipt = candidate.tailCaughtUp;
        break;
      }
    }
    if (!receipt) return { captured: false };
    const copy = JSON.parse(JSON.stringify(receipt));
    window.__N_READ_FALLBACK_OLD_TAIL_RECEIPT__ = copy;
    return {
      captured: true,
      activationID: String(copy.activationID || ''),
      inputEpoch: Number(copy.inputEpoch || 0),
      boundary: Number(copy.boundary || 0),
    };
  });
}

async function replayCapturedTailReceipt(page) {
  return page.evaluate(() => {
    const receipt = window.__N_READ_FALLBACK_OLD_TAIL_RECEIPT__;
    const node = document.querySelector('.conversation-surface');
    const fiberKey = Object.keys(node || {}).find((key) => key.startsWith('__reactFiber$'));
    let fiber = fiberKey ? node[fiberKey] : null;
    let surface = null;
    for (let index = 0; fiber && index < 80; index += 1, fiber = fiber.return) {
      const type = fiber.type;
      const name = typeof type === 'function' ? (type.displayName || type.name || '') : '';
      if (name === 'ConversationSurface') {
        surface = fiber;
        break;
      }
    }
    const callback = surface?.memoizedProps?.onTailCaughtUp;
    if (!receipt || typeof callback !== 'function') return { invoked: false };
    callback(receipt);
    return {
      invoked: true,
      activationID: String(receipt.activationID || ''),
      inputEpoch: Number(receipt.inputEpoch || 0),
      boundary: Number(receipt.boundary || 0),
    };
  });
}



test('N3 页面不可见时到达计入未读，恢复可见并在底部后清零', async ({ page, request }, testInfo) => {
  await reset(request, 0x4e_03);
  await login(page);
  await fillTail(request, 'c0', 24);
  await reachBottom(page);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'following');

  const home = railSelector(page, 'c0');
  // headless Chromium 恒把每个标签页报成 visible（另开标签置前、CDP
  // setWebLifecycleState 都不改 document.visibilityState，已实测），所以这里
  // 直接改写页面读到的那一个事实并派发真正的 visibilitychange 事件：应用读的
  // 就是 document.visibilityState，其余链路（WorkspaceApp→ConversationSurface→
  // VendorListExecutor、WebSocket 到达、回执）都还是真实生产路径。
  await page.evaluate(() => {
    let value = 'hidden';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value === 'hidden' });
    window.__N_SET_VISIBILITY__ = (next) => {
      value = next;
      document.dispatchEvent(new Event('visibilitychange'));
    };
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('hidden');

  await arrive(request, 'c0', 3);
  await expect.poll(() => readCounts(page, 'c0').then((counts) => counts.related + counts.other + counts.jump), { timeout: 15_000 }).toBeGreaterThan(0);
  const whileHidden = await readCounts(page, 'c0');

  await page.evaluate(() => window.__N_SET_VISIBILITY__('visible'));
  await expect.poll(() => page.evaluate(() => document.visibilityState)).toBe('visible');
  await reachBottom(page);
  await expect(home.locator('.unread-related')).toHaveCount(0);
  await expect(home.locator('.unread-total')).toHaveCount(0);
  await expect(page.locator('.timeline-jump-latest')).toHaveCount(0);
  const afterVisible = await readCounts(page, 'c0');

  await attachJSON(testInfo, 'N3-hidden-page.json', { whileHidden, afterVisible });
  expect(whileHidden.related + whileHidden.other + whileHidden.jump).toBeGreaterThan(0);
  expect(afterVisible.related).toBe(0);
  expect(afterVisible.other).toBe(0);
  expect(afterVisible.jump).toBe(0);
});

