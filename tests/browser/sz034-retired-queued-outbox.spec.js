import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// SZ-034 public successor for the retired queued-submission path.  The mock
// submit fault stands in for the backend's authoritative retired response;
// the directory projection is delivered separately through the public retire
// action.  The oracle is limited to visible Composer/Shell DOM, client submit
// frames, and the server error frame.  It intentionally does not inspect
// IndexedDB, React state, diagnostics, or any private owner handle.

async function reset(request, seed = 3401) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
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
  await expect(page.locator('main h1')).toHaveText('c0');
}

function frameText(frame) {
  if (typeof frame === 'string') return frame;
  if (typeof frame?.payload === 'string') return frame.payload;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(frame)) return frame.toString('utf8');
  if (frame instanceof Uint8Array) return new TextDecoder().decode(frame);
  return '';
}

function captureAgentAskFrames(page) {
  const frames = [];
  page.on('websocket', (socket) => {
    socket.on('framesent', (frame) => {
      const raw = frameText(frame);
      if (typeof raw !== 'string') return;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.frame_type !== 'submit' || parsed.payload?.msg_type !== 'agent.ask') return;
        frames.push({
          channelId: parsed.payload.channel_id,
          text: parsed.payload.payload?.text,
        });
      } catch {
        // Handshake/control traffic is outside the public submit oracle.
      }
    });
  });
  return frames;
}

function captureSubmitErrors(page) {
  const errors = [];
  page.on('websocket', (socket) => {
    socket.on('framereceived', (frame) => {
      const raw = frameText(frame);
      if (typeof raw !== 'string') return;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.frame_type !== 'error' || parsed.payload?.frame !== 'submit') return;
        errors.push({ code: parsed.payload.code, detail: parsed.payload.detail || '' });
      } catch {
        // Non-JSON websocket payloads are outside the public submit oracle.
      }
    });
  });
  return errors;
}

test('SZ-034 backend retired rejection preserves draft and never revives queued send', async ({ context, page, request }) => {
  const sends = captureAgentAskFrames(page);
  const errors = captureSubmitErrors(page);
  const queuedText = 'SZ034 queued intent must not revive';
  const draftText = 'SZ034 draft remains visible while retirement settles';

  await reset(request);
  await login(page);

  const navigation = page.getByRole('navigation', { name: '频道' });
  await navigation.getByRole('button').filter({ hasText: 'c0.project' }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');

  // Establish a durable offline queue before the reconnect.  This is the
  // public lifecycle that admits the queued send.
  const connection = page.locator('.connection-state');
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  const dropped = await request.post(`${MOCK}/mock/control/action`, { data: { type: 'drop' } });
  expect(dropped.ok()).toBe(true);
  // The browser network boundary is the queueing seam.  The visual badge can
  // retain its last OPEN paint while the close task is delivered, so do not
  // make the fixture depend on that asynchronous label.
  await page.waitForTimeout(1_000);

  const editor = page.getByRole('textbox', { name: '消息', exact: true });
  await editor.fill(queuedText);
  await page.getByRole('button', { name: '发送' }).click();
  await expect(editor).toHaveText('', { exact: true });
  await page.waitForTimeout(400);

  // Keep a distinct, user-visible draft so the retirement path cannot claim
  // that consuming the queued submission also consumed unrelated input.
  await editor.fill(draftText);
  await expect(editor).toHaveText(draftText, { exact: true });

  const draftRetainedBeforeReconnect = (await editor.innerText()).trim() === draftText;

  // The backend is the retired-channel authority.  Inject its definitive
  // rejection before the normal directory projection; a valid client may
  // send once, but must settle the row as a bounded failure rather than retry
  // or resurrect it.  This is a mock timing seam, not a frontend authority
  // oracle.
  const rejection = await request.post(`${MOCK}/mock/control/fault`, {
    data: {
      target: 'submit',
      mode: 'reject',
      code: 'channel_not_found',
      count: 1,
    },
  });
  expect(rejection.ok()).toBe(true);

  await context.setOffline(false);
  await expect(connection).toHaveClass(/state-open/, { timeout: 15_000 });
  await expect.poll(() => errors.filter((error) => error.code === 'channel_not_found').length, { timeout: 15_000 }).toBe(1);
  const composerError = page.locator('.composer-error');
  await page.waitForTimeout(500);
  const composerErrorVisible = await composerError.isVisible();
  const feedback = page.locator('.top-error, .channel-notice, .composer-error').first();
  const feedbackText = await feedback.count() ? (await feedback.innerText()).trim() : '';
  const draftRetainedAfterRejection = (await editor.innerText()).trim() === draftText;
  await page.waitForTimeout(1_500);

  const sendsAfterRejection = sends.length;

  // Publish the ordinary retired projection only after the backend rejection
  // has been rendered.  This verifies the public handoff without requiring
  // the frontend projection to race the backend's authoritative answer.
  const retired = await request.post(`${MOCK}/mock/control/action`, {
    data: { type: 'retire_channel', channel_id: 'c0.project' },
  });
  expect(retired.ok()).toBe(true);
  await expect(page.locator('main h1')).toHaveText('c0', { timeout: 15_000 });
  const retiredNotice = page.getByText(/c0\.project 已退役，已切换到其他可用频道/);
  await expect(retiredNotice).toBeVisible({ timeout: 10_000 });
  const retiredNoticeVisible = await retiredNotice.isVisible();
  await page.waitForTimeout(1_000);

  const sendsAfterProjection = sends.length;
  await page.reload();
  await expect(connection).toHaveClass(/state-open/, { timeout: 15_000 });
  await page.waitForTimeout(800);
  const sendsAfterReload = sends.length;

  // Soft assertions keep the complete public evidence in the failing report:
  // draft retention, server rejection, bounded retired notice, and the
  // no-retry/revival observations.
  expect.soft(draftRetainedBeforeReconnect, 'draft must remain visible until the backend rejection').toBe(true);
  expect.soft(draftRetainedAfterRejection, 'draft must remain visible after a definitive server rejection').toBe(true);
  expect.soft(sends[0], 'the one allowed wire attempt must target the retired channel').toMatchObject({ channelId: 'c0.project', text: queuedText });
  expect.soft(sendsAfterRejection, 'server-rejected intent must not retry before retirement projection').toBe(1);
  expect.soft(errors.filter((error) => error.code === 'channel_not_found'), 'backend must return the retired-channel rejection').toHaveLength(1);
  expect.soft(composerErrorVisible, 'Composer must show an explicit bounded server failure').toBe(true);
  expect.soft(feedbackText, 'server rejection must not be presented as an uncertain retry').not.toMatch(/待确认|重连账本核对/);
  expect.soft(retiredNoticeVisible, 'retired projection must remain a bounded public failure').toBe(true);
  expect.soft(sendsAfterProjection, 'rejected intent must not revive after retirement projection').toBe(1);
  expect.soft(sendsAfterReload, 'rejected intent must not revive after reload').toBe(1);
});
