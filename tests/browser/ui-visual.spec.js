import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

const SCREENSHOT_OPTIONS = { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixels: 10 };

function pageScreenshotOptions(page) {
  return {
    ...SCREENSHOT_OPTIONS,
    // Ledger contents and its async SEQ are behavioural facts, not shell
    // geometry. Mask both with stable owning boxes so a newer page cannot
    // change an otherwise identical workspace baseline.
    mask: [page.locator('.timeline'), page.locator('.seq-label')],
    maskColor: '#f7f2e8',
  };
}

async function expectConversationSurfaceContract(page) {
  const geometry = await page.locator('.conversation-surface').evaluate((surface) => {
    const reading = surface.querySelector('.conversation-reading-slot').getBoundingClientRect();
    const stack = surface.querySelector('.conversation-bottom-stack').getBoundingClientRect();
    const input = surface.querySelector('.conversation-input-slot').getBoundingClientRect();
    return {
      gap: stack.top - reading.bottom,
      stackHeight: stack.height,
      inputHeight: input.height,
      constrained: surface.classList.contains('is-input-constrained'),
      maxHeight: Number.parseFloat(getComputedStyle(surface).getPropertyValue('--conversation-input-max-height')),
    };
  });
  // Baseline evidence (real Chromium, 1280x720): both fae8b70 and exact
  // d9050df measure a physical 30px reading/stack gap. The 32px CSS token is
  // part of the fixed 132px bottom reserve; the natural 102px input stack
  // leaves 30px on screen. Keep the remaining geometry invariants strict.
  expect(geometry.gap).toBe(30);
  expect(geometry.stackHeight).toBeGreaterThan(0);
  expect(Math.abs(geometry.stackHeight - geometry.inputHeight)).toBeLessThanOrEqual(1);
  expect(geometry.constrained).toBe(false);
  expect(geometry.stackHeight).toBeLessThanOrEqual(geometry.maxHeight);
}

async function reset(request, scenario, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号' }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('main h1')).toHaveText('c0');
}

async function openChannelPanel(page, tab = '成员') {
  await page.getByRole('button', { name: '频道操作' }).click();
  await page.getByRole('menuitem', { name: '频道详情' }).click();
  const panel = page.getByRole('complementary', { name: /频道治理/ });
  await expect(panel).toBeVisible();
  await panel.getByRole('tab', { name: tab, exact: true }).click();
  return panel;
}

test('UI-VIS-01 桌面三栏工作台视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 'multi-channel', 901);
  await login(page);
  await expectConversationSurfaceContract(page);
  await expect(page).toHaveScreenshot('desktop-workspace.png', pageScreenshotOptions(page));
});

for (const [tab, filename] of [['概览', 'channel-overview.png'], ['成员', 'channel-members.png'], ['危险操作', 'channel-danger.png']]) {
  test(`UI-VIS-02 频道管理 ${tab} 视觉基线`, async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await reset(request, 'actor-governance', 902);
    await login(page);
    const panel = await openChannelPanel(page, tab);
    await expect(panel).toHaveScreenshot(filename, SCREENSHOT_OPTIONS);
  });
}

test('UI-VIS-03 新建频道独立任务视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 'channel-governance', 907);
  await login(page);
  await page.getByRole('button', { name: '新建频道' }).click();
  const panel = page.getByRole('complementary', { name: /频道治理/ });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: '创建子频道', exact: true })).toBeVisible();
  await expect(panel.getByLabel('频道模板')).toBeVisible();
  await expect(panel).toHaveScreenshot('channel-create.png', SCREENSHOT_OPTIONS);
});

test('UI-VIS-04 空间管理视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 'space-administration', 903);
  await login(page);
  await page.getByRole('button', { name: '空间管理' }).click();
  const panel = page.getByRole('complementary', { name: '空间管理' });
  await expect(panel).toBeVisible();
  await expect(panel).toHaveScreenshot('space-administration.png', SCREENSHOT_OPTIONS);
});

test('UI-VIS-06 定时动作视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 'scheduled-action', 905);
  await login(page);
  await page.getByRole('tab', { name: '任务', exact: true }).click();
  await page.getByRole('button', { name: '安排自动动作' }).click();
  const panel = page.getByRole('complementary', { name: '定时动作' });
  await expect(panel).toBeVisible();
  await expect(panel).toHaveScreenshot('channel-automation.png', SCREENSHOT_OPTIONS);
});

test('UI-VIS-06 本设备自动动作取消入口保持可执行', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 'scheduled-action', 1403);
  await login(page);
  await page.getByRole('tab', { name: '任务', exact: true }).click();
  await page.getByRole('button', { name: '安排自动动作' }).click();
  const automation = page.getByRole('complementary', { name: '定时动作' });
  await automation.getByLabel('定时延迟毫秒').fill('60000');
  await automation.getByLabel('定时 Payload JSON').fill('{"text":"round43-cancel"}');
  await automation.getByRole('button', { name: '创建定时动作' }).click();
  await automation.getByRole('button', { name: '关闭定时动作' }).click();

  const tasks = page.getByRole('tabpanel', { name: '任务' });
  const task = tasks.getByRole('button', { name: /round43-cancel/ });
  await expect(task).toBeVisible();
  const scheduledBefore = await (await request.get(`${MOCK}/mock/control/state`)).json();
  const timerBefore = scheduledBefore.scheduled?.find((row) => row.type === 'timer' && row.channel_id === 'c0');
  expect(timerBefore?.timer_id).toBeTruthy();
  await task.click();
  const context = page.getByRole('complementary', { name: '工作项详情' });
  await expect(context).toContainText('不代表频道共享或跨设备的完整事实');
  // A visible cancel control is not enough: the real task owner must expose a
  // live command port so the user can actually cancel the timer receipt.
  const cancel = context.getByRole('button', { name: '取消本设备自动动作' });
  await expect(cancel).toBeVisible();
  await expect(cancel).toBeEnabled();
  await cancel.click();
  // A successful timer.cancel is a terminal user result, not merely a receipt:
  // the local fact must converge to 已取消 and the waiting-only action must
  // disappear from the detail owner. This prevents a stale enabled button from
  // surviving a real cancel receipt.
  await expect(context.locator('.work-item-context-state')).toContainText('已取消');
  await expect(context.getByRole('button', { name: '取消本设备自动动作' })).toHaveCount(0);
  await expect(context).toContainText('当前事实没有声明可用操作。');
  await expect.poll(async () => {
    const state = await (await request.get(`${MOCK}/mock/control/state`)).json();
    return state.scheduled?.some((row) => row.type === 'timer' && row.timer_id === timerBefore.timer_id) || false;
  }).toBe(false);
});

test('UI-VIS-07 850px 频道管理抽屉视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 850, height: 720 });
  await reset(request, 'actor-governance', 905);
  await login(page);
  const panel = await openChannelPanel(page, '成员');
  // Keep the responsive case a user contract in addition to its preserved
  // screenshot: at 850px the governance panel must retain the member route,
  // public roster controls, participant picker, and viewport containment even
  // when the current successor wraps row actions differently from fae8b70.
  await expect(panel.getByRole('tab', { name: '成员', exact: true })).toHaveAttribute('aria-selected', 'true');
  for (const name of ['system', 'registrar', 'svcactor']) {
    await expect(panel.getByText(name, { exact: true })).toHaveCount(0);
  }
  await expect(panel.getByRole('button', { name: '刷新', exact: true })).toBeVisible();
  await expect(panel.getByRole('combobox', { name: '选择参与者' })).toBeVisible();
  await expect(panel.getByRole('button', { name: '添加到频道', exact: true })).toBeVisible();
  const geometry = await page.evaluate(() => ({
    viewport: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    panel: document.querySelector('[aria-label="频道治理"]')?.getBoundingClientRect().toJSON(),
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.panel?.right).toBeLessThanOrEqual(geometry.viewport);
  await expect(page).toHaveScreenshot('channel-members-850.png', SCREENSHOT_OPTIONS);
});

test('UI-VIS-08 600px 选择用户菜单视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 600, height: 720 });
  await reset(request, 'actor-governance', 906);
  await login(page);
  const panel = await openChannelPanel(page, '成员');
  const select = panel.getByRole('combobox', { name: '选择参与者' });
  await expect(select).toBeVisible();
  await select.click();
  const listbox = panel.getByRole('listbox', { name: '选择参与者选项' });
  await expect(listbox).toBeVisible();
  await expect(panel.getByRole('option', { name: /Alice · 用户/ })).toBeVisible();
  await expect(panel.getByRole('option', { name: /Analyst Agent · Agent/ })).toBeVisible();
  await expect(panel.getByRole('option', { name: /svcactor/ })).toHaveCount(0);
  // fae8b70's public directory owner sorted principal/declaration candidates by
  // display name. Preserve that observable order: current receipt insertion
  // order places Steward before Analyst/Search Tool, which changes discovery
  // even though the same buttons remain clickable.
  const optionLabels = await listbox.getByRole('option').allTextContents();
  expect(optionLabels.map((label) => label.trim())).toEqual([
    '搜索用户、Agent 或工具',
    'Alice · 用户',
    'Bob · 用户',
    'Analyst Agent · Agent',
    'Claude · Agent',
    'Search Tool · 工具',
    'Steward · Agent',
  ]);
  const geometry = await page.evaluate(() => ({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scrollWidth: document.documentElement.scrollWidth,
    listbox: document.querySelector('[role="listbox"][aria-label="选择参与者选项"]')?.getBoundingClientRect().toJSON(),
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.listbox?.left).toBeGreaterThanOrEqual(0);
  expect(geometry.listbox?.right).toBeLessThanOrEqual(geometry.viewport.width);
  await page.keyboard.press('Escape');
  await expect(listbox).toHaveCount(0);
  await select.click();
  await expect(listbox).toBeVisible();
  await expect(page).toHaveScreenshot('channel-members-select-600.png', SCREENSHOT_OPTIONS);
});

test('UI-VIS-08 600px 候选 popover fit 与排序分离', async ({ page, request }) => {
  await page.setViewportSize({ width: 600, height: 720 });
  await reset(request, 'actor-governance', 906);
  await login(page);
  const panel = await openChannelPanel(page, '成员');
  const select = panel.getByRole('combobox', { name: '选择参与者' });
  await select.click();
  const listbox = panel.getByRole('listbox', { name: '选择参与者选项' });
  await expect(listbox).toBeVisible();
  const geometry = await page.evaluate(() => {
    const rectOf = (node) => {
      const rect = node?.getBoundingClientRect();
      return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
    };
    const overlaps = (a, b) => Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
    const listNode = document.querySelector('[role="listbox"][aria-label="选择参与者选项"]');
    const triggerNode = document.querySelector('[role="combobox"][aria-label="选择参与者"]');
    const cards = [...document.querySelectorAll('[aria-label="频道治理"] .panel-card')];
    const card = (heading) => cards.find((node) => node.querySelector('h3')?.textContent?.trim() === heading);
    const list = rectOf(listNode);
    const trigger = rectOf(triggerNode);
    const roster = rectOf(card('当前成员与 Actor'));
    const add = rectOf(card('添加参与者'));
    return {
      placement: listNode?.className || '',
      viewport: { width: window.innerWidth, height: window.innerHeight },
      list,
      trigger,
      roster,
      add,
      overlapsRoster: overlaps(list, roster),
      overlapsAdd: overlaps(list, add),
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  // Placement is a separate fit contract: it must keep the menu and trigger
  // bounded and non-overlapping even while the canonical option-order contract
  // is allowed to fail independently in the visual/order test above.
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.list?.left).toBeGreaterThanOrEqual(0);
  expect(geometry.list?.right).toBeLessThanOrEqual(geometry.viewport.width);
  expect(geometry.list?.top).toBeGreaterThanOrEqual(0);
  expect(geometry.list?.bottom).toBeLessThanOrEqual(geometry.viewport.height);
  if (geometry.placement.includes('placement-top')) expect(geometry.list?.bottom).toBeLessThanOrEqual(geometry.trigger?.top || 0);
  else expect(geometry.list?.top).toBeGreaterThanOrEqual(geometry.trigger?.bottom || 0);
  console.log(`[UI-VIS-08 popover geometry] ${JSON.stringify(geometry)}`);
  await page.keyboard.press('Escape');
  await expect(listbox).toHaveCount(0);
});

test('UI-VIS-09 用户消息与 Agent 答案气泡视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 'actor-capability', 908);
  await login(page);
  // Enter browsing mode through the same input path as a reader. Asking
  // Playwright to scroll an off-screen locator while the timeline still owns
  // tail-following creates two competing scroll commands and screenshots the
  // wrong physical viewport beneath the stale locator box.
  await page.locator('.timeline-message-list').hover();
  await page.mouse.wheel(0, -1_000);
  const turn = page.locator('.agent-conversation-turn[data-request-id="c0-history-request-1"]');
  await expect(turn).toBeVisible();
  await expect(turn).toContainText('c0 history 1: ask steward for PONG');
  await expect(turn).toContainText('c0 PONG 1');
  const horizontal = await turn.evaluate((node) => {
    const viewport = node.closest('.timeline-message-list');
    const viewportRect = viewport.getBoundingClientRect();
    const owned = [...node.querySelectorAll('.request-text, .response-content, .task-control-buttons button')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      });
    return {
      viewportClientWidth: viewport.clientWidth,
      viewportScrollWidth: viewport.scrollWidth,
      viewportLeft: viewportRect.left,
      viewportRight: viewportRect.right,
      minOwnedLeft: Math.min(...owned.map((rect) => rect.left)),
      maxOwnedRight: Math.max(...owned.map((rect) => rect.right)),
      zeroWidthOwned: owned.filter((rect) => rect.width <= 0).length,
    };
  });
  expect(horizontal.viewportScrollWidth).toBeLessThanOrEqual(horizontal.viewportClientWidth + 1);
  expect(horizontal.minOwnedLeft).toBeGreaterThanOrEqual(horizontal.viewportLeft - 1);
  expect(horizontal.maxOwnedRight).toBeLessThanOrEqual(horizontal.viewportRight + 1);
  expect(horizontal.zeroWidthOwned).toBe(0);
  // The wheel entry point intentionally hovers the scroller. Move away before
  // capturing so transient row affordances/tooltips are not mistaken for the
  // stable message/answer geometry this baseline owns.
  await page.mouse.move(1, 1);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await turn.evaluate((node) => node.matches(':hover'))).toBe(false);
  await expect(turn).toHaveScreenshot('flat-ledger-turn.png', SCREENSHOT_OPTIONS);
});

test('UI-VIS-10 全局活动中心视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 'approval-schema', 909);
  await login(page);
  await page.getByRole('button', { name: '打开活动中心' }).click();
  const center = page.getByRole('complementary', { name: '全局活动' });
  await expect(center).toBeVisible();
  await expect(center.getByRole('tab', { name: '活动', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(center.getByRole('tab', { name: '操作', exact: true })).toHaveAttribute('aria-selected', 'false');
  const activityList = center.locator('.activity-list');
  await expect(activityList).toBeVisible();
  expect(await activityList.getByRole('button').count()).toBeGreaterThan(0);
  await expect(center).toHaveScreenshot('global-activity.png', {
    ...SCREENSHOT_OPTIONS,
    // The activity rows are live data and have their own behavioural tests;
    // mask the fixed scroll viewport rather than their variable-height list.
    // Header and tabs remain real pixels in this baseline.
    mask: [center.locator('.side-panel-scroll')],
  });
});

test('UI-VIS-11 600px 全局搜索视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 600, height: 720 });
  await reset(request, 'multi-channel', 910);
  await login(page);
  await page.getByRole('button', { name: '打开频道列表' }).click();
  await page.getByRole('button', { name: '全局搜索' }).click();
  const search = page.getByRole('dialog', { name: '全局搜索' });
  await search.getByLabel('搜索频道、消息、文件、任务或成员').fill('history 1');
  await expect(search.getByRole('button', { name: /c0\.project history 1/ })).toBeVisible();
  await expect(search.getByRole('button', { name: /c0\.public/ })).toHaveCount(0);
  await expect(search).toHaveScreenshot('global-search-600.png', {
    ...SCREENSHOT_OPTIONS,
    // Cross-channel result availability is a data/access contract, not part
    // of this dialog's visual baseline.
    mask: [search.locator('.global-search-results')],
  });
  await search.getByRole('button', { name: /c0\.project history 1/ }).click();
  await expect(search).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('c0.project');
});

test('UI-VIS-11 搜索后台兴趣由 Feed 持有并可在关闭时取消', async ({ page, request }) => {
  await page.setViewportSize({ width: 600, height: 720 });
  await page.addInitScript(() => {
    window.__ATOLL_SEARCH_HISTORY_FRAMES = [];
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = function WrappedWebSocket(...args) {
      const socket = new NativeWebSocket(...args);
      const send = socket.send.bind(socket);
      socket.send = (data) => {
        if (typeof data === 'string') {
          try {
            const frame = JSON.parse(data);
            if (frame?.frame_type === 'history_before' || frame?.frame_type === 'history_cancel') {
              window.__ATOLL_SEARCH_HISTORY_FRAMES.push(frame);
            }
          } catch { /* wire frames outside this probe are irrelevant */ }
        }
        return send(data);
      };
      return socket;
    };
    window.WebSocket.prototype = NativeWebSocket.prototype;
    for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
      Object.defineProperty(window.WebSocket, key, { value: NativeWebSocket[key] });
    }
  });
  await reset(request, 'deep-history-delayed', 920);
  await login(page);
  await page.getByRole('button', { name: '打开频道列表' }).click();
  await page.getByRole('button', { name: '全局搜索' }).click();
  const search = page.getByRole('dialog', { name: '全局搜索' });
  await expect.poll(() => page.evaluate(() => window.__ATOLL_SEARCH_HISTORY_FRAMES.some((frame) => (
    frame.frame_type === 'history_before'
      && frame.payload?.channel_id === 'c0.project'
      && frame.payload?.priority === 'background'
  ))), { timeout: 10_000 }).toBe(true);
  const before = await page.evaluate(() => window.__ATOLL_SEARCH_HISTORY_FRAMES.find((frame) => (
    frame.frame_type === 'history_before' && frame.payload?.channel_id === 'c0.project'
  )));
  expect(before.payload.purpose).toBe('initial-tail');
  expect(await page.evaluate(() => window.__ATOLL_SEARCH_HISTORY_FRAMES.some((frame) => (
    frame.frame_type === 'history_before' && frame.payload?.channel_id === 'c0.public'
  )))).toBe(false);
  await search.getByRole('button', { name: '关闭全局搜索' }).click();
  await expect(search).toHaveCount(0);
  await expect.poll(() => page.evaluate((targetRef) => window.__ATOLL_SEARCH_HISTORY_FRAMES.some((frame) => (
    frame.frame_type === 'history_cancel' && frame.payload?.channel_id === 'c0.project'
      && frame.payload?.target_ref === targetRef
  )), before.ref), { timeout: 10_000 }).toBe(true);
});

test('UI-VIS-11 断线窗口释放 Search lease 不产生未处理拒绝', async ({ page, request }) => {
  await page.setViewportSize({ width: 600, height: 720 });
  await page.addInitScript(() => {
    window.__ATOLL_SEARCH_DISCONNECT_FRAMES = [];
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = function WrappedWebSocket(...args) {
      const socket = new NativeWebSocket(...args);
      const send = socket.send.bind(socket);
      socket.send = (data) => {
        if (typeof data === 'string') {
          try {
            const frame = JSON.parse(data);
            if (frame?.frame_type === 'history_before' || frame?.frame_type === 'history_cancel') {
              window.__ATOLL_SEARCH_DISCONNECT_FRAMES.push(frame);
            }
          } catch { /* non-protocol frames are outside this probe */ }
        }
        return send(data);
      };
      return socket;
    };
    window.WebSocket.prototype = NativeWebSocket.prototype;
    for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
      Object.defineProperty(window.WebSocket, key, { value: NativeWebSocket[key] });
    }
  });
  await reset(request, 'deep-history-delayed', 926);
  await login(page);
  await page.getByRole('button', { name: '打开频道列表' }).click();
  await page.getByRole('button', { name: '全局搜索' }).click();
  const search = page.getByRole('dialog', { name: '全局搜索' });
  await expect.poll(() => page.evaluate(() => Boolean(window.__ATOLL_SEARCH_DISCONNECT_FRAMES.find((frame) => (
    frame.frame_type === 'history_before'
      && frame.payload?.channel_id === 'c0.project'
      && frame.payload?.priority === 'background'
  )))), { timeout: 10_000 }).toBe(true);
  const before = await page.evaluate(() => window.__ATOLL_SEARCH_DISCONNECT_FRAMES.find((frame) => (
    frame.frame_type === 'history_before'
      && frame.payload?.channel_id === 'c0.project'
      && frame.payload?.priority === 'background'
  )));

  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.clear?.());
  const dropped = await request.post(`${MOCK}/mock/control/action`, { data: { type: 'drop' } });
  expect(dropped.ok()).toBe(true);
  await expect(page.locator('.connection-state')).toHaveClass(/state-reconnecting/, { timeout: 10_000 });
  // The Search dialog stays mounted while its Feed-owned lease is released by
  // the wire-state effect. Close it during this detached/reconnect window so
  // both cleanup paths exercise the same physical cancellation owner.
  await search.getByRole('button', { name: '关闭全局搜索' }).click();
  await expect(search).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.snapshot?.().some((entry) => (
    entry.event === 'wire.attached' && Number(entry.detail?.generation) >= 2
  ))), { timeout: 15_000 }).toBe(true);
  await page.waitForTimeout(250);

  const evidence = await page.evaluate((targetRef) => {
    const diagnostics = window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || [];
    return {
      targetRef,
      frames: window.__ATOLL_SEARCH_DISCONNECT_FRAMES,
      lifecycle: diagnostics.filter((entry) => ['wire.closed', 'wire.reconnect_scheduled', 'wire.attached', 'window.unhandled_rejection'].includes(entry.event)),
      unhandled: diagnostics.filter((entry) => entry.event === 'window.unhandled_rejection'),
    };
  }, before.ref);
  expect(evidence.lifecycle.some((entry) => entry.event === 'wire.closed')).toBe(true);
  expect(evidence.lifecycle.some((entry) => entry.event === 'wire.attached' && Number(entry.detail?.generation) >= 2)).toBe(true);
  expect(evidence.unhandled).toEqual([]);
  expect(evidence.frames.filter((frame) => frame.frame_type === 'history_before'
    && frame.payload?.channel_id === 'c0.project')).toHaveLength(1);
  // A detached wire has no opportunity to transmit a cancel frame. The
  // operation is nevertheless settled locally; the unit owner contract above
  // checks historyDemand -> idle, while this browser oracle proves the real
  // reconnect window emitted no unhandled rejection.
  expect(evidence.targetRef).toBeTruthy();
});

test('UI-VIS-11 Search lease handoff 不重绑旧 activation', async ({ page, request }) => {
  await page.setViewportSize({ width: 600, height: 720 });
  await page.addInitScript(() => {
    window.__ATOLL_SEARCH_HANDOFF_FRAMES = [];
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = function WrappedWebSocket(...args) {
      const socket = new NativeWebSocket(...args);
      const send = socket.send.bind(socket);
      socket.send = (data) => {
        if (typeof data === 'string') {
          try {
            const frame = JSON.parse(data);
            if (frame?.frame_type === 'history_before' || frame?.frame_type === 'history_cancel') {
              window.__ATOLL_SEARCH_HANDOFF_FRAMES.push(frame);
            }
          } catch { /* non-protocol frames are outside this probe */ }
        }
        return send(data);
      };
      return socket;
    };
    window.WebSocket.prototype = NativeWebSocket.prototype;
    for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']) {
      Object.defineProperty(window.WebSocket, key, { value: NativeWebSocket[key] });
    }
  });
  await reset(request, 'deep-history-delayed', 927);
  await login(page);
  await page.getByRole('button', { name: '打开频道列表' }).click();
  await page.getByRole('button', { name: '全局搜索' }).click();
  const search = page.getByRole('dialog', { name: '全局搜索' });
  await expect.poll(() => page.evaluate(() => window.__ATOLL_SEARCH_HANDOFF_FRAMES.some((frame) => (
    frame.frame_type === 'history_before'
      && frame.payload?.channel_id === 'c0.project'
      && frame.payload?.priority === 'background'
  ))), { timeout: 10_000 }).toBe(true);
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.clear?.());

  const dropped = await request.post(`${MOCK}/mock/control/action`, { data: { type: 'drop' } });
  expect(dropped.ok()).toBe(true);
  await expect(page.locator('.connection-state')).toHaveClass(/state-reconnecting/, { timeout: 10_000 });
  await search.getByRole('button', { name: '关闭全局搜索' }).click();
  await expect(search).toHaveCount(0);

  // Reopen the mobile rail and switch immediately after cleanup. This creates
  // a new Search/active-channel activation while the Feed command port is
  // crossing the reconnect owner handoff.
  await page.getByRole('button', { name: '打开频道列表' }).click();
  await page.getByRole('button', { name: /c0\.project/ }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/, { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => {
    const snapshot = window.__ATOLL_DIAGNOSTICS__?.coldEntry?.snapshot?.() || {};
    return snapshot.history?.demand?.phase === 'idle' && snapshot.history?.loading === false;
  }), { timeout: 15_000 }).toBe(true);
  await page.waitForTimeout(200);

  const evidence = await page.evaluate(() => {
    const diagnostics = window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || [];
    return {
      frames: window.__ATOLL_SEARCH_HANDOFF_FRAMES,
      unhandled: diagnostics.filter((entry) => entry.event === 'window.unhandled_rejection'),
      errors: diagnostics.filter((entry) => entry.event === 'window.error'),
    };
  });
  expect(evidence.unhandled).toEqual([]);
  expect(evidence.errors).toEqual([]);
  expect(evidence.frames.filter((frame) => frame.frame_type === 'history_before'
    && frame.payload?.channel_id === 'c0.project'
    && frame.payload?.priority === 'background'
    && frame.payload?.purpose === 'initial-tail')).toHaveLength(1);
});

test('UI-VIS-12 频道挂载文件主页面视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 'resource-workflow', 911);
  await login(page);
  await page.locator('#workspace-files-toggle').click();
  const files = page.getByRole('region', { name: '频道文件' });
  await files.getByLabel('选择要上传到当前目录的文件').setInputFiles({
    name: '频道交付说明.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('这是当前频道默认挂载目录中的文件。'),
  });
  await expect(files.getByText('频道交付说明.txt', { exact: true })).toBeVisible();
  await expect(files).toHaveScreenshot('channel-files-mounted.png', SCREENSHOT_OPTIONS);
});

test('UI-VIS-13 频道挂载文件预览视觉基线', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await reset(request, 'resource-workflow', 912);
  await login(page);
  await page.locator('#workspace-files-toggle').click();
  const files = page.getByRole('region', { name: '频道文件' });
  await files.getByLabel('选择要上传到当前目录的文件').setInputFiles({
    name: '可预览说明.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# 文件预览\n\n挂载目录文件可以直接在右侧面板中预览。'),
  });
  await files.locator('.channel-file-row').filter({ hasText: '可预览说明.md' }).locator('.finder-name-cell').click();
  const detail = page.getByRole('complementary', { name: '文件详情' });
  await expect(detail).toContainText('可预览说明.md');
  await expect(detail).toContainText('挂载目录文件可以直接在右侧面板中预览');
  await expectConversationSurfaceContract(page);
  await expect(page).toHaveScreenshot('channel-files-preview.png', pageScreenshotOptions(page));
});
