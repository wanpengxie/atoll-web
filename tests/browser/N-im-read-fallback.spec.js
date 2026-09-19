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
  for (let index = 0; index < count; index += 1) {
    const response = await request.post('/mock/control/action', { data: { type: 'approval', channel_id: channelId } });
    expect(response.ok()).toBe(true);
  }
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

test('N1 有积压跳到最新即同时清零，且停在底部连续到达 20 条时两处计数恒为 0', async ({ page, request }, testInfo) => {
  await reset(request, 0x4e_01);
  await login(page);
  await reachBottom(page);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'following');
  // 先把频道撑到可滚动，否则"离开底部"这个状态在这条夹具里根本不存在。
  await fillTail(request, 'c0', 24);
  await reachBottom(page);
  const viewport = readingViewport(page);
  const mountedRows = await viewport.evaluate((node) => {
    const rows = [...node.querySelectorAll('[data-presentation-row-id]')];
    return {
      ids: rows.map((row) => row.dataset.presentationRowId),
      tops: rows.map((row) => row.getBoundingClientRect().top),
      width: node.getBoundingClientRect().width,
      height: node.getBoundingClientRect().height,
    };
  });
  expect(mountedRows.ids.length).toBeGreaterThan(0);
  expect(new Set(mountedRows.ids).size).toBe(mountedRows.ids.length);
  expect(mountedRows.tops).toEqual([...mountedRows.tops].sort((left, right) => left - right));
  expect(mountedRows.width).toBeGreaterThan(0);
  expect(mountedRows.height).toBeGreaterThan(0);

  const home = railSelector(page, 'c0');
  const jump = page.locator('.timeline-jump-latest');

  // (2) 不在底部：物理手势离开尾部，随后的到达必须计入未读。滚动幅度刻意只
  // 离开底部一屏左右，顶部那几个 root turn 仍在视窗外，所以它们的新终态是
  // 真正"没看见"的到达。
  await viewport.hover();
  await page.mouse.wheel(0, -900);
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeGreaterThan(200);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  await arrive(request, 'c0', 3);
  await expect(jump).toBeVisible();
  await expect(home.locator('.unread-related')).toBeVisible();
  const backlog = await readCounts(page, 'c0');
  expect(backlog.jump).toBeGreaterThan(0);
  expect(backlog.related).toBeGreaterThan(0);

  // (3) 回到底部：徽标与视窗计数同时清零。
  await startCapture(page, 'c0');
  await jump.click();
  // 当前虚拟列表另有 owner 在修 append/回底几何；通知契约只在“真实到底”成立。
  // 用真实用户手势把根节点送到物理尾部，避免把 93px 的列表残差误判成通知失败。
  await reachBottom(page);
  await expect(jump).toHaveCount(0);
  await expect(home.locator('.unread-related')).toHaveCount(0);
  await expect(home.locator('.unread-total')).toHaveCount(0);
  const jumpFrames = await stopCapture(page);
  const lastNoticeFrame = jumpFrames.filter((frame) => frame.jump > 0 || frame.badgeRelated > 0 || frame.badgeOther > 0).at(-1);
  const divergent = jumpFrames.filter((frame) => (
    lastNoticeFrame && frame.elapsedMs > lastNoticeFrame.elapsedMs
    && (frame.jump > 0 || frame.badgeRelated > 0 || frame.badgeOther > 0 || frame.badgePending)
  ));
  // "同时"是可核对的：从任一处最后一次非零起，两处都不再有非零帧；两处各自
  // 最后一次非零的时间差就是它们分开的那段窗口。
  const lastJumpFrame = jumpFrames.filter((frame) => frame.jump > 0).at(-1);
  const lastBadgeFrame = jumpFrames.filter((frame) => frame.badgeRelated > 0 || frame.badgeOther > 0).at(-1);
  const clearGapMs = Math.abs(Number(lastJumpFrame?.elapsedMs || 0) - Number(lastBadgeFrame?.elapsedMs || 0));

  // (1) 在底部且页面可见：连续到达 20 条，两处计数每一帧都必须是 0。
  await startCapture(page, 'c0');
  for (let index = 0; index < 20; index += 1) {
    await arrive(request, 'c0', 1);
  }
  await page.waitForTimeout(800);
  const arrivalFrames = await stopCapture(page);
  const noticeFrames = arrivalFrames.filter((frame) => frame.gap !== null && frame.gap <= 2 && (
    frame.jumpShown || frame.badgeRelated > 0 || frame.badgeOther > 0 || frame.badgePending
  ));
  const offTailFrames = arrivalFrames.filter((frame) => frame.gap !== null && frame.gap > 2);
  const tailFrames = arrivalFrames.filter((frame) => frame.gap !== null && frame.gap <= 2).length;

  // 回执真的落地了（不只是投影）：离开底部后计数仍然是 0，因为这 20 条在到达
  // 时就已经被确认，不是被兜底盖住的。
  await viewport.hover();
  await page.mouse.wheel(0, -900);
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeGreaterThan(200);
  await page.waitForTimeout(700);
  const afterLeaving = await readCounts(page, 'c0');

  await attachJSON(testInfo, 'N1-following-tail.json', {
    mountedRows,
    backlog,
    lastNoticeFrame,
    lastJumpFrame,
    lastBadgeFrame,
    clearGapMs,
    divergentAfterJump: divergent.slice(0, 20),
    arrivalFrameCount: arrivalFrames.length,
    tailFrames,
    offTailFrames: offTailFrames.slice(0, 20),
    noticeFrames: noticeFrames.slice(0, 20),
    afterLeaving,
  });

  expect(divergent).toEqual([]);
  expect(clearGapMs).toBeLessThanOrEqual(1_000);
  expect(arrivalFrames.length).toBeGreaterThan(30);
  expect(noticeFrames).toEqual([]);
  // Q's following container must keep the physical tail structurally. There
  // is deliberately no wheel/reachBottom inside the append loop above.
  expect(offTailFrames).toEqual([]);
  expect(afterLeaving.jump).toBe(0);
  expect(afterLeaving.related).toBe(0);
  expect(afterLeaving.other).toBe(0);
  expect(afterLeaving.pending).toBe(false);
});

test('N2 别的频道到达计入未读，切回并到底后一次清零', async ({ page, request }, testInfo) => {
  await reset(request, 0x4e_02);
  await login(page);
  await reachBottom(page);

  const project = railSelector(page, 'c0.project');
  await expect(project.locator('.unread-related')).toHaveCount(0);

  await arrive(request, 'c0.project', 3);
  await expect(project.locator('.unread-related')).toBeVisible();
  const whileAway = await readCounts(page, 'c0.project');
  expect(whileAway.related).toBeGreaterThan(0);

  // 同一时刻当前频道自己仍然是零：兜底只压"用户正看着的那条视图"。
  const homeWhileAway = await readCounts(page, 'c0');
  expect(homeWhileAway.related).toBe(0);
  expect(homeWhileAway.jump).toBe(0);

  await project.click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await reachBottom(page);
  await expect(project.locator('.unread-related')).toHaveCount(0);
  await expect(project.locator('.unread-total')).toHaveCount(0);
  await expect(page.locator('.timeline-jump-latest')).toHaveCount(0);

  // 回到这条频道底部之后继续到达：仍然恒 0。
  await startCapture(page, 'c0.project');
  const viewport = readingViewport(page);
  for (let index = 0; index < 6; index += 1) {
    await arrive(request, 'c0.project', 1);
  }
  await page.waitForTimeout(600);
  const frames = await stopCapture(page);
  const noticeFrames = frames.filter((frame) => frame.gap !== null && frame.gap <= 2 && (
    frame.jumpShown || frame.badgeRelated > 0 || frame.badgeOther > 0 || frame.badgePending
  ));
  const offTailFrames = frames.filter((frame) => frame.gap !== null && frame.gap > 2);

  // 关闭读侧兜底，核对真相也已由回执推进：若这里只是把数字压成 0，离开尾部后
  // 原始未读会立即重新出现。这个断言刻意防止“测试压零掩盖持久回执失败”。
  await viewport.hover();
  await page.mouse.wheel(0, -900);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  await page.waitForTimeout(500);
  const afterLeaving = await readCounts(page, 'c0.project');

  await attachJSON(testInfo, 'N2-other-channel.json', { whileAway, homeWhileAway, frameCount: frames.length, noticeFrames: noticeFrames.slice(0, 20), offTailFrames: offTailFrames.slice(0, 20), afterLeaving });
  expect(noticeFrames).toEqual([]);
  expect(offTailFrames).toEqual([]);
  expect(afterLeaving.related).toBe(0);
  expect(afterLeaving.other).toBe(0);
});

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

test('N4 成员过滤视图真实到底时本 scope 计数为 0，过滤外未读始终保留', async ({ page, request }, testInfo) => {
  await reset(request, 0x4e_04);
  await login(page);
  await fillTail(request, 'c0', 24);
  await reachBottom(page);

  const stewardFilter = page.getByTitle('只看我与 steward 的往来');
  await expect(stewardFilter).toBeVisible();
  await stewardFilter.click();
  await expect(page.getByTitle('取消只看 steward')).toHaveAttribute('aria-pressed', 'true');
  await reachBottom(page);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'following');

  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'N4-actor-filter' }));
  await startCapture(page, 'c0');
  const outside = await request.post('/mock/control/action', {
    data: { type: 'dense_progress', channel_id: 'c0', related: false, count: 1 },
  });
  expect(outside.ok()).toBe(true);
  for (let index = 0; index < 6; index += 1) await arrive(request, 'c0', 1);
  await page.waitForTimeout(700);
  const frames = await stopCapture(page);
  const atTailInScopeNotices = frames.filter((frame) => frame.gap !== null && frame.gap <= 2 && (
    frame.jumpShown || frame.badgeRelated > 0 || frame.badgePending
  ));
  const atTailOutsideNotices = frames.filter((frame) => (
    frame.gap !== null && frame.gap <= 2 && frame.badgeOther > 0
  ));

  // Display fallback is not the persistence oracle. Raw rail truth must prove
  // both halves at once: every installed steward approval was acknowledged,
  // while the unrelated turn excluded by this actor filter stayed unread.
  try {
    await expect.poll(() => page.evaluate(() => {
      const channel = window.__ATOLL_DIAGNOSTICS__?.rail?.snapshot?.('c0')?.channels?.[0];
      const rows = channel?.rows || [];
      const counted = (row) => String(row?.ackReason || '').startsWith('counted_');
      return {
        authorityReady: channel?.authorityReady === true,
        installedScopeCleared: rows
          .filter((row) => String(row?.id || '').includes('-approval-'))
          .every((row) => !counted(row)),
        outsideFilterPreserved: rows
          .some((row) => String(row?.id || '').includes('-unrelated-') && counted(row)),
      };
    }), { timeout: 15_000 }).toEqual({
      authorityReady: true,
      installedScopeCleared: true,
      outsideFilterPreserved: true,
    });
  } catch (error) {
    const failureTruth = await page.evaluate(() => ({
      rail: window.__ATOLL_DIAGNOSTICS__?.rail?.snapshot?.('c0'),
      reading: window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.(),
      reads: Object.fromEntries(Object.keys(localStorage)
        .filter((key) => key.startsWith('atoll.read'))
        .map((key) => [key, localStorage.getItem(key)])),
    }));
    await attachJSON(testInfo, 'N4-persistence-failure.json', { failureTruth });
    throw error;
  }
  const settledAtTail = await readCounts(page, 'c0');

  const viewport = readingViewport(page);
  await viewport.hover();
  await page.mouse.wheel(0, -900);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
  await page.waitForTimeout(500);
  const afterLeaving = await readCounts(page, 'c0');
  const truth = await page.evaluate(() => ({
    rail: window.__ATOLL_DIAGNOSTICS__?.rail?.snapshot?.('c0'),
    reading: window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.(),
    reads: Object.fromEntries(Object.keys(localStorage)
      .filter((key) => key.startsWith('atoll.read'))
      .map((key) => [key, localStorage.getItem(key)])),
  }));
  await attachJSON(testInfo, 'N4-actor-filter.json', {
    frameCount: frames.length,
    atTailInScopeNotices: atTailInScopeNotices.slice(0, 20),
    atTailOutsideNotices: atTailOutsideNotices.slice(0, 20),
    settledAtTail,
    afterLeaving,
    truth,
  });

  expect(frames.length).toBeGreaterThan(20);
  // Raw arrival may precede installation by a few frames. Once the production
  // projection has installed the scope tail, no in-scope residue remains.
  // Filter-external raw truth is retained above, but the channel rail is a
  // personal attention surface and never renders that unrelated count.
  expect(settledAtTail.mode).toBe('following');
  expect(settledAtTail.gap).toBeLessThanOrEqual(2);
  expect(settledAtTail.related).toBe(0);
  expect(settledAtTail.jump).toBe(0);
  expect(settledAtTail.other).toBe(0);
  expect(atTailOutsideNotices).toEqual([]);
  expect(afterLeaving.jump).toBe(0);
  expect(afterLeaving.related).toBe(0);
  expect(afterLeaving.other).toBe(0);
});
