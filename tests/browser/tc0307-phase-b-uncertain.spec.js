import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'message-flow', seed: 817 },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.getByRole('navigation', { name: '频道' })).toBeVisible();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

async function send(page, message) {
  const chooseAgent = page.getByRole('button', { name: '选择 Agent' });
  const recipient = page.getByRole('status', { name: '收件人' });
  await expect.poll(async () => (
    await chooseAgent.isVisible().catch(() => false)
      || !/无收件人/.test(await recipient.textContent().catch(() => '无收件人'))
  )).toBe(true);
  if (await chooseAgent.isVisible().catch(() => false)) {
    const opened = await chooseAgent.click({ timeout: 1_000 }).then(() => true).catch(() => false);
    if (opened) {
      const menu = page.getByRole('menu', { name: '选择目标 Agent' });
      const steward = menu.getByRole('menuitem', { name: 'steward' });
      if (await steward.count()) await steward.click();
      else await menu.getByRole('menuitem').first().click();
    }
  }
  const editor = page.getByLabel('消息');
  await expect(editor).toBeEnabled();
  await editor.fill(message);
  await page.getByRole('button', { name: '发送', exact: true }).click();
}

function parsedFrames(payloads) {
  return payloads.flatMap((payload) => {
    try { return [JSON.parse(String(payload))]; } catch { return []; }
  });
}

test('TC-0307 B-BR-07a converges one stable-origin send through public uncertain notice', async ({ page, request }) => {
  await reset(request);

  const sentPayloads = [];
  const receivedPayloads = [];
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.stack || error)));
  page.on('websocket', (socket) => {
    socket.on('framesent', ({ payload }) => sentPayloads.push(payload));
    socket.on('framereceived', ({ payload }) => receivedPayloads.push(payload));
  });

  await login(page);
  for (const data of [
    { target: 'feed', mode: 'delay', delay_ms: 1_200, count: 4, match_msg_type: 'agent.ask' },
    { target: 'receipt', mode: 'drop', count: 1, match_msg_type: 'agent.ask' },
  ]) {
    const response = await request.post(`${MOCK}/mock/control/fault`, { data });
    expect(response.ok()).toBe(true);
  }

  // The notice is a public Shell status surface.  Keep only its observed
  // text; do not reach into React state, outbox, or any private diagnostics.
  await page.evaluate(() => {
    window.__ATOLL_SAW_TC0307_UNCERTAIN__ = false;
    const sample = () => {
      const text = [...document.querySelectorAll('.channel-notice')]
        .map((node) => node.textContent || '')
        .join(' ');
      if (/发送结果待确认|待确认/.test(text)) window.__ATOLL_SAW_TC0307_UNCERTAIN__ = true;
    };
    new MutationObserver(sample).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  });

  const message = `uncertain-window-${Date.now()}`;
  await send(page, message);
  await expect.poll(() => page.evaluate(() => window.__ATOLL_SAW_TC0307_UNCERTAIN__)).toBe(true);

  const timeline = page.getByRole('region', { name: '频道动态', exact: true });
  await expect(timeline).toBeVisible();
  // The landed request row is the exact terminal public ledger fact for this
  // receipt/feed convergence path.  This fixture intentionally drops the
  // response rows broadcast before reconnect; requiring a response body here
  // would test a different replay contract and make the old B-BR-07a journey
  // depend on an unrelated fixture timing detail.
  await expect(timeline.getByText(message, { exact: true })).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('.channel-notice')).toHaveCount(0);
  await expect(page.locator('.composer-status.state-uncertain')).toHaveCount(0);

  const sent = parsedFrames(sentPayloads).filter((frame) => (
    frame.frame_type === 'submit'
      && frame.payload?.msg_type === 'agent.ask'
      && frame.payload?.payload?.text === message
  ));
  const received = parsedFrames(receivedPayloads);
  const conflicts = received.filter((frame) => (
    frame.frame_type === 'error' && frame.payload?.code === 'idempotency_conflict'
  ));
  expect(conflicts, JSON.stringify({ conflicts, sent })).toEqual([]);
  expect(sent.length, JSON.stringify({ sent })).toBeGreaterThanOrEqual(1);
  // A dropped receipt may trigger one physical retry.  Idempotency is judged
  // by one stable business identity and one live presentation row, not by a
  // brittle exactly-one transport attempt.
  expect(sent.length, JSON.stringify({ sent })).toBeLessThanOrEqual(2);
  expect(sent.map((frame) => frame.payload.id)).toEqual([sent[0].payload.id, ...sent.slice(1).map((frame) => sent[0].payload.id)]);
  expect(sent.every((frame) => frame.payload.payload?.origin)).toBe(true);
  expect(sent.slice(1).map((frame) => frame.payload.payload.origin)).toEqual(
    sent.slice(1).map(() => sent[0].payload.payload.origin),
  );

  // A request that landed while the socket was down reaches the page through
  // the reconnect refill (history), since live resumes after the attach head;
  // one that landed on an open socket arrives live. Either way exactly once.
  const landed = received.filter((frame) => (
    frame.frame_type === 'feed'
      && ['live', 'history'].includes(frame.payload?.source)
      && frame.payload?.envelope?.id === sent[0].payload.id
  ));
  expect(landed, JSON.stringify({ sent, landed })).toHaveLength(1);
  expect(pageErrors, JSON.stringify(pageErrors)).toEqual([]);
  await expect(timeline.getByText(message, { exact: true })).toHaveCount(1);
});
