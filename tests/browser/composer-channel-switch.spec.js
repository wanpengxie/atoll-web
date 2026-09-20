import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', { data: { scenario: 'multi-channel', seed: 0x4e_02 } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.locator('.composer-richtext')).toBeVisible();
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
        // Handshake/control traffic is outside the submit contract.
      }
    });
  });
  return frames;
}

test('channel replacement keeps the Composer mounted through the EditorView handoff', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await reset(request);
  await login(page);

  await page.getByRole('button', { name: '# c0.project', exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.locator('.composer-richtext')).toBeVisible();

  await page.getByRole('button', { name: '# c0', exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.locator('.composer-richtext')).toBeVisible();
  expect(errors.filter((line) => /editor view is not available|Cannot read properties of null/.test(line))).toEqual([]);
});

test('literal @ text stays in the Tiptap body and submits to the default Agent', async ({ page, request }, testInfo) => {
  const submits = captureSubmitFrames(page);
  const text = '联系 ops@atoll.local 看下 @ts-ignore';
  await reset(request);
  await login(page);

  const input = page.getByLabel('消息');
  await input.click();
  await input.pressSequentially(text);
  await expect(input).toHaveText(text);
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await input.press('Enter');

  const submitted = () => submits.find((frame) => frame?.msg_type === 'agent.ask' && frame?.payload?.text === text);
  await expect.poll(submitted, { timeout: 10_000 }).toMatchObject({
    channel_id: 'c0',
    msg_type: 'agent.ask',
    kind: 'request',
    payload: { text },
    audience: ['steward'],
    visibility: 'public',
  });
  await expect(input).toHaveText('');
  await expect(page.locator('article.request-message .request-text').filter({ hasText: text })).toBeVisible();
  await testInfo.attach('composer-literal-at-submit.json', {
    body: JSON.stringify(submitted(), null, 2),
    contentType: 'application/json',
  });
});

test('@ target leaves the Tiptap body, becomes a recipient chip, and submits to that Agent', async ({ page, request }, testInfo) => {
  const submits = captureSubmitFrames(page);
  const text = '请处理';
  await reset(request);
  await login(page);

  const input = page.getByLabel('消息');
  await input.click();
  await input.pressSequentially('@Cl');
  const option = page.getByRole('listbox').getByRole('option').filter({ hasText: 'Claude' }).first();
  await expect(option).toBeVisible();
  await option.click();
  await expect(input).toHaveText('');
  await expect(page.locator('.composer-target-pill.is-picked')).toHaveText('@Claude');

  await input.pressSequentially(text);
  await input.press('Enter');
  const submitted = () => submits.find((frame) => frame?.msg_type === 'agent.ask' && frame?.payload?.text === text);
  await expect.poll(submitted, { timeout: 10_000 }).toMatchObject({
    channel_id: 'c0',
    msg_type: 'agent.ask',
    kind: 'request',
    payload: { text },
    audience: ['claude'],
    visibility: 'public',
  });
  await expect(input).toHaveText('');
  await expect(page.locator('article.request-message .request-text').filter({ hasText: text })).toBeVisible();
  await testInfo.attach('composer-mention-submit.json', {
    body: JSON.stringify(submitted(), null, 2),
    contentType: 'application/json',
  });
});

test('Escape dismisses an @ suggestion and sends the restored literal address', async ({ page, request }, testInfo) => {
  const submits = captureSubmitFrames(page);
  const text = '@steward@example.com';
  await reset(request);
  await login(page);

  const input = page.getByLabel('消息');
  await input.click();
  await input.pressSequentially('@st');
  const option = page.getByRole('listbox').getByRole('option').filter({ hasText: 'steward' }).first();
  await expect(option).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);

  await input.pressSequentially('eward@example.com');
  await expect(input).toHaveText(text);
  await expect(page.locator('.composer-target-pill.is-picked')).toHaveCount(0);
  await input.press('Enter');

  const submitted = () => submits.find((frame) => frame?.msg_type === 'agent.ask' && frame?.payload?.text === text);
  await expect.poll(submitted, { timeout: 10_000 }).toMatchObject({
    channel_id: 'c0',
    msg_type: 'agent.ask',
    kind: 'request',
    payload: { text },
    audience: ['steward'],
    visibility: 'public',
  });
  await expect(input).toHaveText('');
  await expect(page.locator('article.request-message .request-text').filter({ hasText: text })).toBeVisible();
  await testInfo.attach('composer-mention-escape-submit.json', {
    body: JSON.stringify(submitted(), null, 2),
    contentType: 'application/json',
  });
});

test('recipient chips remove one-by-one and with Backspace before the remaining default target submits', async ({ page, request }, testInfo) => {
  const submits = captureSubmitFrames(page);
  const text = '移除后发送';
  await reset(request);
  await login(page);

  const input = page.getByTestId('composer-input');
  await input.click();
  await input.pressSequentially('@Cl');
  const claudeOption = page.getByRole('listbox').getByRole('option').filter({ hasText: 'Claude' }).first();
  await expect(claudeOption).toBeVisible();
  await claudeOption.click();
  await expect(input).toHaveText('');
  await expect(page.locator('.composer-target-pill.is-picked')).toHaveText('@Claude');

  await input.pressSequentially('@st');
  const stewardOption = page.getByRole('listbox').getByRole('option').first();
  await expect(stewardOption).toBeVisible();
  await stewardOption.click();
  await expect(input).toHaveText('');
  await expect(page.locator('.composer-target-pill.is-picked')).toHaveCount(2);

  await page.getByRole('button', { name: '移除收件人 @Claude' }).click();
  await expect(page.locator('.composer-target-pill.is-picked')).toHaveText('@steward');
  await input.click();
  await input.press('Backspace');
  await expect(page.locator('.composer-target-pill.is-picked')).toHaveCount(0);
  await expect(page.getByRole('status', { name: '收件人' })).toContainText('@steward');

  await input.pressSequentially(text);
  await input.press('Enter');
  const submitted = () => submits.find((frame) => frame?.msg_type === 'agent.ask' && frame?.payload?.text === text);
  await expect.poll(submitted, { timeout: 10_000 }).toMatchObject({
    channel_id: 'c0',
    msg_type: 'agent.ask',
    kind: 'request',
    payload: { text },
    audience: ['steward'],
    visibility: 'public',
  });
  await expect(input).toHaveText('');
  await expect(page.locator('article.request-message .request-text').filter({ hasText: text })).toBeVisible();
  await testInfo.attach('composer-recipient-chip-removal-submit.json', {
    body: JSON.stringify(submitted(), null, 2),
    contentType: 'application/json',
  });
});
