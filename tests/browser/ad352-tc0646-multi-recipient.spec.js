import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', { data: { scenario: 'multi-channel', seed: 0xad352 } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.getByLabel('消息')).toBeVisible();
}

function captureSubmitFrames(page) {
  const frames = [];
  page.on('websocket', (socket) => {
    socket.on('framesent', (frame) => {
      const raw = typeof frame === 'string' ? frame : frame?.payload;
      if (typeof raw !== 'string') return;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.frame_type === 'submit') frames.push(parsed.payload);
      } catch {
        // WebSocket control frames are outside the submit contract.
      }
    });
  });
  return frames;
}

test('AD-352/TC-0646 public multi-recipient send splits one body into one frame per target', async ({ page, request }, testInfo) => {
  const submits = captureSubmitFrames(page);
  const text = '多目标拆发';
  await reset(request);
  await login(page);

  const input = page.getByLabel('消息');
  await input.fill('/admit alice');
  await input.press('Enter');
  await expect.poll(() => submits.find((frame) => frame?.msg_type === 'system.member.admit'), { timeout: 10_000 }).toMatchObject({
    channel_id: 'c0',
    msg_type: 'system.member.admit',
    audience: ['system'],
    payload: { principal: 'alice' },
  });
  await input.fill('');

  await input.click();
  await input.pressSequentially('@al');
  await page.getByRole('listbox').getByRole('option').filter({ hasText: 'alice' }).first().click();
  await expect(input).toHaveText('');

  await input.pressSequentially('@Cl');
  await page.getByRole('listbox').getByRole('option').filter({ hasText: 'Claude' }).first().click();
  await expect(input).toHaveText('');
  await expect(page.locator('.composer-target-pill.is-picked')).toHaveCount(2);

  await input.pressSequentially(text);
  await input.press('Enter');

  const sent = () => submits.filter((frame) => frame?.payload?.text === text);
  await expect.poll(sent, { timeout: 10_000 }).toHaveLength(2);
  const matching = sent();
  expect(matching.every((frame) => frame.kind === 'request')).toBe(true);
  expect(matching.every((frame) => frame.channel_id === 'c0')).toBe(true);
  expect(matching.every((frame) => frame.visibility === 'public')).toBe(true);
  expect(matching.map((frame) => frame.msg_type).sort()).toEqual(['agent.ask', 'human.message'].sort());
  expect(matching.map((frame) => frame.audience).sort()).toEqual([['alice-home'], ['claude']].sort());
  expect(new Set(matching.map((frame) => frame.id)).size).toBe(2);

  await expect(input).toHaveText('');
  await expect(page.locator('article.request-message .request-text').filter({ hasText: text })).toHaveCount(2);
  await testInfo.attach('ad352-tc0646-multi-recipient-submit.json', {
    body: JSON.stringify(matching, null, 2),
    contentType: 'application/json',
  });
});
