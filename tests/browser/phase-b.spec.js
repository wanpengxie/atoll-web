import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { MOCK_ORIGIN } from './mock-origin.js';


async function reset(request, scenario = 'multi-channel', seed = 81) {
  const response = await request.post(`${MOCK_ORIGIN}/mock/control/reset`, { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function action(request, data) {
  const response = await request.post(`${MOCK_ORIGIN}/mock/control/action`, { data });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号' }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.getByRole('navigation', { name: '频道' })).toBeVisible();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
}

async function send(page, text) {
  const chooseAgent = page.getByRole('button', { name: '选择 Agent' });
  const recipient = page.getByRole('status', { name: '收件人' });
  // Receipt-order tests must first enter the submit path. During initial OBS
  // publication the composer can be readable before a default recipient is
  // known; wait for either a derived target or the real chooser instead of
  // racing it and asserting about a request that was never sent.
  await expect.poll(async () => (
    await chooseAgent.isVisible().catch(() => false)
      || !/无收件人/.test(await recipient.textContent().catch(() => '无收件人'))
  )).toBe(true);
  if (await chooseAgent.isVisible().catch(() => false)) {
    // A roster publication can replace the chooser with a derived recipient
    // between the visibility read and click. That is success, not a reason to
    // hold the test on a locator that no longer exists.
    const opened = await chooseAgent.click({ timeout: 1_000 }).then(() => true).catch(() => false);
    if (opened) {
      const menu = page.getByRole('menu', { name: '选择目标 Agent' });
      const steward = menu.getByRole('menuitem', { name: 'steward' });
      if (await steward.count()) await steward.click();
      else await menu.getByRole('menuitem').first().click();
    }
  }
  await page.getByLabel('消息').fill(text);
  await page.getByRole('button', { name: /发送/ }).click();
}

async function clearProductCache(page) {
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key !== 'atoll.principal') localStorage.removeItem(key);
    }
  });
}

test('B-BR-01 c0 根频道、内部 lobby 与标准 Actor 分别处理', async ({ page, request }) => {
  await reset(request);
  await login(page);
  const rail = page.locator('.channel-rail');
  await expect(rail.getByText('c0', { exact: true })).toBeVisible();
  await expect(rail.getByText('c0.project', { exact: true })).toBeVisible();
  await expect(rail.getByText('c0.public', { exact: true })).toBeVisible();
  await expect(rail.getByText(/lobby/i)).toHaveCount(0);
  await expect(page.locator('.roster-panel').getByText('system', { exact: true })).toHaveCount(0);
  await expect(page.locator('.roster-panel').getByText('registrar', { exact: true })).toHaveCount(0);
  await expect(page.locator('.roster-panel').getByText('svcactor', { exact: true })).toHaveCount(0);
});

test('B-BR-02 断线时进入 stale、保留账本并在重连后恢复', async ({ page, request, context }) => {
  await reset(request);
  await login(page);
  await expect(page.getByText(/c0 history 1/)).toBeVisible();
  await context.setOffline(true);
  await action(request, { type: 'drop' });
  await expect(page.getByText('RECONNECTING', { exact: true })).toBeVisible();
  await expect(page.getByText(/c0 history 1/)).toBeVisible();
  // A confirmed member owns the local draft even while transport is down.
  // Reconnecting revokes transmission, not editing or durable outbox
  // admission; live-only attachment entry is the transport-gated seam.
  await expect(page.getByLabel('消息')).toHaveAttribute('contenteditable', 'true');
  await expect(page.getByText(/离线编辑；发送会先保存到本机/)).toBeVisible();
  await expect(page.getByLabel('上传本机文件到频道')).toBeDisabled();
  await expect(page.getByRole('button', { name: '从频道文件选择' })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel('消息')).toHaveAttribute('contenteditable', 'true');
  await expect(page.getByText(/离线编辑；发送会先保存到本机/)).toHaveCount(0);
});

test('B-BR-02b 慢 OBS 不阻塞缓存首屏，档案补全不重建消息连接', async ({ page, request }) => {
  await reset(request, 'multi-channel', 811);
  await login(page);
  await expect(page.getByText(/c0 history 1/)).toBeVisible();

  const fault = await request.post(`${MOCK_ORIGIN}/mock/control/fault`, {
    data: { target: 'obs', mode: 'delay', delay_ms: 2_500, count: 20 },
  });
  expect(fault.ok()).toBe(true);
  const sockets = [];
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname === '/ws') sockets.push(socket.url());
  });

  await page.reload();
  // Session identity + attach membership are enough to show the IndexedDB tail.
  // Neither principal presentation nor the channel profile may sit on this path.
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible({ timeout: 1_500 });
  await expect(page.getByText(/c0 history 1/)).toBeVisible({ timeout: 1_500 });

  // The delayed principal profile now lands and replaces the presentation
  // object. The stable principal id must keep the original socket and history.
  await page.waitForTimeout(2_700);
  expect(sockets).toHaveLength(1);
  await expect(page.getByText(/c0 history 1/)).toBeVisible();
});

test('B-BR-02a 刷新进入频道后固定在最新处，后台历史预取不推动页面', async ({ page, request }) => {
  await reset(request, 'multi-channel', 812);
  await login(page);
  await page.getByRole('tab', { name: '动态' }).click();
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  await expect(page.locator('.timeline')).toBeVisible();
  // 虚拟列表首屏挂载晚于 .timeline 可见：第一采样可能落在 0 行。等首行出现再采。
  // 缓存先画、attach 后补齐权威网络缺口时，行数和高度允许增量增长；不变量是
  // 阅读位置始终钉在真实尾部，后台水合不能把人推离最新消息。
  await expect(page.locator('.timeline-entry').first()).toBeVisible();
  const samples = await page.evaluate(async () => {
    const viewport = document.querySelector('.timeline');
    const rows = [];
    for (let index = 0; index < 30; index += 1) {
      rows.push({
        top: viewport.scrollTop,
        bottom: viewport.scrollHeight - viewport.clientHeight,
        height: viewport.scrollHeight,
        entries: viewport.querySelectorAll('.timeline-entry').length,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return rows;
  });
  expect(samples.every((row) => Math.abs(row.bottom - row.top) <= 2)).toBe(true);
  expect(samples.every((row) => row.entries > 0), JSON.stringify(samples)).toBe(true);
  expect(new Set(samples.map((row) => row.height)).size, JSON.stringify(samples)).toBe(1);
  expect(new Set(samples.map((row) => row.entries)).size, JSON.stringify(samples)).toBe(1);
});

test('B-BR-03 unavailable、partial OBS、权限撤销和退役分别收敛', async ({ page, request }) => {
  await reset(request);
  await login(page);
  await page.getByRole('button', { name: /c0\.project/ }).click();
  await action(request, { type: 'set_channel_open', channel_id: 'c0.project', open: false });
  await expect(page.getByText('暂不可用', { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/频道暂不可用，历史记录仍可查看/)).toBeVisible();
  // Runtime availability is orthogonal to the already-confirmed member's
  // local draft authority. Keep the editor/outbox seam, but withhold every
  // live-only action until the channel is open again.
  await expect(page.getByLabel('消息')).toHaveAttribute('contenteditable', 'true');
  await expect(page.getByText(/离线编辑；发送会先保存到本机/)).toBeVisible();
  await expect(page.getByLabel('上传本机文件到频道')).toBeDisabled();
  await expect(page.getByRole('button', { name: '从频道文件选择' })).toBeDisabled();

  await action(request, { type: 'set_channel_open', channel_id: 'c0.project', open: true });
  await expect(page.getByText(/离线编辑；发送会先保存到本机/)).toHaveCount(0, { timeout: 5_000 });
  await action(request, { type: 'set_obs_complete', complete: false });
  await action(request, { type: 'retire_channel', channel_id: 'c0.project' });
  await page.waitForTimeout(1_700);
  await expect(page.locator('.channel-rail').getByText('c0.project', { exact: true })).toBeVisible();
  await action(request, { type: 'set_obs_complete', complete: true });
  await expect(page.locator('.channel-rail').getByText('c0.project', { exact: true })).toHaveCount(0, { timeout: 5_000 });
  await expect(page.getByText(/c0\.project 已退役/)).toBeVisible();

  await reset(request);
  await clearProductCache(page);
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /c0\.project/ }).click();
  await action(request, { type: 'revoke_membership', channel_id: 'c0.project' });
  await expect(page.getByText(/频道访问权限已被撤销/)).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.channel-rail').getByText('无权访问', { exact: true })).toBeVisible();
  await expect(page.getByLabel('消息')).toBeDisabled();

  await reset(request);
});

test('B-BR-04 真实后端形态下不猜 self，发送 feed 后自动识别', async ({ page, request }) => {
  await reset(request, 'real-backend-shape');
  await login(page);
  await page.getByRole('button', { name: '成员', exact: true }).click();
  const members = page.getByRole('complementary', { name: /频道管理/ });
  await expect(members.getByText('我', { exact: true })).toHaveCount(0);
  await members.getByRole('button', { name: '关闭频道详情' }).click();
  const message = `self-map-${Date.now()}`;
  await send(page, message);
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '成员', exact: true }).click();
  await expect(page.getByRole('complementary', { name: /频道管理/ }).getByText('我', { exact: true })).toBeVisible();
  await expect(page.getByText(/正在确认你在本频道中的 Actor 身份/)).toHaveCount(0);
});

test('B-BR-04b 首次本机发送的 live echo 不计为新动态且保持同一消息身份', async ({ page, request }, testInfo) => {
  await reset(request, 'real-backend-shape', 814);
  const received = [];
  page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
    try { received.push(JSON.parse(String(payload))); } catch { /* binary/non-JSON frame */ }
  }));
  await login(page);
  await page.evaluate(() => {
    window.__ATOLL_DIAGNOSTICS__.clear();
    window.__ATOLL_DIAGNOSTICS__.reading.enable({ case: 'first-local-echo' });
  });
  const message = `first-local-echo-${Date.now()}`;
  await send(page, message);
  await expect(page.getByText(message, { exact: true })).toBeVisible();
  await page.waitForFunction(() => {
    const entries = window.__ATOLL_DIAGNOSTICS__.snapshot();
    const startIndex = entries.map((entry) => entry.event).lastIndexOf('submission.composer_send_started');
    const acceptedOffset = entries.slice(startIndex + 1)
      .findIndex((entry) => entry.event === 'submission.outbox_accepted');
    const acceptedIndex = acceptedOffset < 0 ? -1 : startIndex + 1 + acceptedOffset;
    const accepted = entries[acceptedIndex];
    const messageId = accepted?.detail?.messageIds?.[0];
    return Boolean(messageId && entries.slice(acceptedIndex + 1).some((entry) => (
      entry.event === 'submission.feed_landed'
        && entry.detail?.messageIds?.includes(messageId)
    )));
  });
  await expect(page.getByText(message, { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /条新动态/ })).toHaveCount(0);

  const application = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot());
  const reading = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.snapshot());
  const composerStartIndex = application.map((entry) => entry.event).lastIndexOf('submission.composer_send_started');
  const accepted = application.slice(composerStartIndex + 1)
    .find((entry) => entry.event === 'submission.outbox_accepted');
  const messageId = accepted?.detail?.messageIds?.[0] || '';
  expect(messageId).toBeTruthy();
  await expect.poll(() => received.some((frame) => (
    frame.frame_type === 'feed'
      && frame.payload?.source === 'live'
      && frame.payload?.envelope?.id === messageId
  ))).toBe(true);
  const requestFrame = received.find((frame) => (
    frame.frame_type === 'feed'
      && frame.payload?.source === 'live'
      && frame.payload?.envelope?.id === messageId
  ));
  const requestSeq = Number(requestFrame?.payload?.seq || 0);
  expect(requestSeq).toBeGreaterThan(0);
  const ownRequestArrivals = (reading.entries || [])
    .filter((entry) => entry.event === 'reading.unseen-arrival')
    .flatMap((entry) => entry.detail?.records || [])
    .filter((record) => record.key === messageId && Number(record.seq) === requestSeq);
  expect(ownRequestArrivals).toEqual([]);

  const evidencePath = testInfo.outputPath('first-local-echo.json');
  await writeFile(evidencePath, JSON.stringify({ messageId, requestSeq, ownRequestArrivals, application, reading }, null, 2));
  await testInfo.attach('first-local-echo.json', { path: evidencePath, contentType: 'application/json' });
});

test('B-BR-05 完整 provisional、命名空间状态和第一终态权威性', async ({ page, request }) => {
  await reset(request, 'business-provisional');
  await login(page);
  const businessText = `business-status-${Date.now()}`;
  await send(page, businessText);
  const businessTurn = page.locator('.turn-card').filter({ hasText: businessText });
  await expect(businessTurn.locator('.agent-turn-bubble')).toBeVisible();
  await expect(page.getByText('PONG', { exact: true })).toBeVisible();

  await reset(request, 'terminal-conflict');
  await clearProductCache(page);
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  await send(page, `terminal-first-${Date.now()}`);
  await expect(page.getByText('PONG', { exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  const latestTurn = page.locator('.turn-card').last();
  await expect(latestTurn.getByText('PONG', { exact: true })).toBeVisible();
  await expect(latestTurn.getByText('FAILED', { exact: true })).toHaveCount(0);
});

test('B-BR-06 receipt 先到与 feed 先到都只产生一个请求', async ({ page, request }) => {
  await reset(request, 'feed-delayed');
  await login(page);
  const delayed = `feed-delayed-${Date.now()}`;
  await send(page, delayed);
  await expect(page.getByText(delayed, { exact: true })).toHaveCount(1);
  await expect(page.getByText('PONG', { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(delayed, { exact: true })).toHaveCount(1);

  await reset(request, 'receipt-delayed');
  await clearProductCache(page);
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  const receiptDelayed = `receipt-delayed-${Date.now()}`;
  await send(page, receiptDelayed);
  await expect(page.locator('.turn-card').getByText(receiptDelayed, { exact: true })).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(page.locator('.timeline').getByText(receiptDelayed, { exact: true })).toHaveCount(1);
});

test('B-BR-06a 名册未就绪的早发送明确受阻，目标到达后原草稿可发送', async ({ page, request }) => {
  await reset(request, 'feed-delayed', 818);
  await login(page);
  const fault = await request.post(`${MOCK_ORIGIN}/mock/control/fault`, {
    data: { target: 'obs', mode: 'delay', delay_ms: 2_500, count: 20 },
  });
  expect(fault.ok()).toBe(true);
  const sentFrames = [];
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => { try { sentFrames.push(JSON.parse(String(payload))); } catch { /* binary */ } });
  });
  await clearProductCache(page);
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();

  const message = `early-roster-${Date.now()}`;
  await page.getByLabel('消息').fill(message);
  await page.getByRole('button', { name: /发送/ }).click();
  await expect(page.getByText(/请 @ 一个成员，或在右下角选择目标 Agent/)).toBeVisible();
  expect(sentFrames.filter((frame) => (
    frame.frame_type === 'submit' && frame.payload?.msg_type === 'agent.ask'
  ))).toHaveLength(0);
  await expect(page.getByLabel('消息')).toHaveText(message);

  const chooseAgent = page.getByRole('button', { name: '选择 Agent' });
  await expect(chooseAgent).toBeVisible();
  await chooseAgent.click();
  const menu = page.getByRole('menu', { name: '选择目标 Agent' });
  await expect(menu.getByRole('menuitem').first()).toBeVisible({ timeout: 6_000 });
  const steward = menu.getByRole('menuitem', { name: 'steward' });
  if (await steward.count()) await steward.click();
  else await menu.getByRole('menuitem').first().click();
  await page.getByRole('button', { name: /发送/ }).click();
  await expect(page.getByText('PONG', { exact: true })).toBeVisible({ timeout: 8_000 });
  expect(sentFrames.filter((frame) => (
    frame.frame_type === 'submit' && frame.payload?.msg_type === 'agent.ask'
  ))).toHaveLength(1);
});

test('B-BR-07 receipt 丢失但 feed 已落账时直接以账本事实完成对账', async ({ page, request }) => {
  await reset(request, 'receipt-lost-feed-landed');
  await login(page);
  const message = `uncertain-${Date.now()}`;
  await send(page, message);
  // This fixture drops the receipt but deliberately delivers the feed without
  // delay. The ledger may reconcile the durable submission before the socket
  // close is observed, so inventing a mandatory uncertain frame would assert
  // timing rather than product state.
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.timeline').getByText(message, { exact: true })).toHaveCount(1);
  await expect(page.getByText('PONG', { exact: true })).toBeVisible();
  await expect(page.locator('.composer-status.state-uncertain')).toHaveCount(0);
});

test('B-BR-07a receipt 与 feed 都尚未确认时显示 uncertain，重连后按账本收敛', async ({ page, request }) => {
  await reset(request, 'message-flow', 817);
  const sentFrames = [];
  const receivedFrames = [];
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => { try { sentFrames.push(JSON.parse(String(payload))); } catch { /* binary */ } });
    socket.on('framereceived', ({ payload }) => { try { receivedFrames.push(JSON.parse(String(payload))); } catch { /* binary */ } });
  });
  await login(page);
  for (const data of [
    { target: 'feed', mode: 'delay', delay_ms: 1_200, count: 4, match_msg_type: 'agent.ask' },
    { target: 'receipt', mode: 'drop', count: 1, match_msg_type: 'agent.ask' },
  ]) {
    const response = await request.post(`${MOCK_ORIGIN}/mock/control/fault`, { data });
    expect(response.ok()).toBe(true);
  }
  await page.evaluate(() => {
    window.__ATOLL_SAW_UNCERTAIN__ = false;
    const sample = () => {
      if (document.querySelector('.composer-status.state-uncertain')) window.__ATOLL_SAW_UNCERTAIN__ = true;
    };
    new MutationObserver(sample).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  });
  const message = `uncertain-window-${Date.now()}`;
  await send(page, message);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_SAW_UNCERTAIN__)).toBe(true);
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.timeline').getByText(message, { exact: true })).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('.composer-status.state-uncertain')).toHaveCount(0);
  await expect(page.getByText(/现已通过频道账本确认/)).toBeVisible();
  const conflicts = receivedFrames.filter((frame) => frame.frame_type === 'error' && frame.payload?.code === 'idempotency_conflict');
  expect(conflicts, JSON.stringify({
    conflicts,
    retries: sentFrames.filter((frame) => frame.frame_type === 'submit').map((frame) => ({ ref: frame.ref, payload: frame.payload })),
  })).toEqual([]);
});

test('B-BR-08 切频道不改变 pending 所属频道', async ({ page, request }) => {
  await reset(request, 'feed-delayed');
  await login(page);
  const message = `channel-bound-${Date.now()}`;
  await send(page, message);
  await page.getByRole('button', { name: /c0\.project/ }).click();
  await expect(page.locator('main').getByText(message, { exact: true })).toHaveCount(0);
  await page.waitForTimeout(1_000);
  await expect(page.locator('main').getByText(message, { exact: true })).toHaveCount(0);
  await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0$/ }) }).click();
  await expect(page.getByText(message, { exact: true })).toHaveCount(1);

  await reset(request);
  await clearProductCache(page);
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  const homeApproval = page.locator('.approval-card').first();
  await homeApproval.getByRole('button', { name: '批准' }).click();
  await page.getByRole('button', { name: /c0\.project/ }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.locator('.approval-card').first().getByText('已回执', { exact: true })).toHaveCount(0);
  await page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0$/ }) }).click();
  await expect(page.locator('.approval-card').first().getByText('已回执', { exact: true })).toBeVisible();
});

test('B-BR-09 结构化、空成功、失败与敏感字段都有可理解结果', async ({ page, request }) => {
  await reset(request, 'message-structured-success');
  await login(page);
  await send(page, `structured-${Date.now()}`);
  await expect(page.getByText('结构化结果', { exact: true })).toBeVisible();
  await expect(page.getByText('instance_id', { exact: true })).toBeHidden();
  await page.locator('.structured-result-details').filter({ hasText: '结构化结果' }).first().locator(':scope > summary').click();
  await expect(page.getByText('instance_id', { exact: true })).toBeVisible();
  await expect(page.getByText('已隐藏', { exact: true })).toBeVisible();
  await expect(page.getByText('25 项，先显示 20 项', { exact: true })).toBeVisible();

  await reset(request, 'message-empty-success');
  await clearProductCache(page);
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  await send(page, `empty-${Date.now()}`);
  await expect(page.locator('.completion-ack')).toContainText('已完成');

  await reset(request, 'message-failed');
  await clearProductCache(page);
  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  await send(page, `failure-${Date.now()}`);
  await expect(page.getByText('接收方不支持这个操作', { exact: true })).toBeVisible();
  await expect(page.getByText('type_unsupported', { exact: true })).toBeVisible();
  await expect(page.getByText(/mock failure requested/).first()).toBeVisible();

});

test('B-BR-10 普通频道通过 system actor 展示 channel.list', async ({ page, request }) => {
  await reset(request);
  await login(page);
  await page.getByRole('button', { name: /c0\.project/ }).click();
  await page.getByLabel('消息').fill('/channels');
  await page.getByRole('button', { name: /发送/ }).click();
  await expect(page.getByText(/channel\.list$/, { exact: true })).toBeVisible();
  await page.locator('.structured-result-details').filter({ hasText: /channel\.list/ }).last().locator(':scope > summary').click();
  await expect(page.locator('.structured-table').getByText('c0.public', { exact: true }).first()).toBeVisible();
});
