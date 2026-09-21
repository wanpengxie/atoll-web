import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request, seed = 149766) {
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
  await expect(page.getByLabel('消息')).toBeVisible();
}

async function openPicker(page) {
  // This is deliberately the historical public Composer action. If the
  // owner has not wired it, the case must remain a real red at this line.
  await page.getByRole('button', { name: '从频道文件选择', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '从频道文件选择' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function draftText(page) {
  return page.getByLabel('消息').innerText();
}

test('picker focus remains inside the modal while the user tabs through controls', async ({ page, request }) => {
  await reset(request, 14976601);
  await login(page);
  const dialog = await openPicker(page);
  const close = dialog.getByRole('button', { name: '关闭频道文件选择' });
  await expect(close).toBeFocused();

  const focusable = dialog.locator('button, select, input, textarea, [tabindex]:not([tabindex="-1"])');
  const count = await focusable.count();
  expect(count).toBeGreaterThan(1);
  for (let index = 0; index < count + 2; index += 1) {
    await page.keyboard.press('Tab');
    await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }
});

test('Escape and backdrop cancellation leave the draft and attachment set unchanged', async ({ page, request }) => {
  await reset(request, 14976602);
  await login(page);
  const input = page.getByLabel('消息');
  await input.fill('picker cancellation keeps this draft');
  const before = await draftText(page);

  let dialog = await openPicker(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(input).toHaveText(before);
  await expect(page.getByLabel('待发送附件')).toHaveCount(0);

  dialog = await openPicker(page);
  await page.locator('.attachment-picker-backdrop').click({ position: { x: 1, y: 1 } });
  await expect(dialog).toHaveCount(0);
  await expect(input).toHaveText(before);
  await expect(page.getByLabel('待发送附件')).toHaveCount(0);
});

test('switching channel cancels the old picker request without attaching to either draft', async ({ page, request }) => {
  await reset(request, 14976603);
  await login(page);
  const input = page.getByLabel('消息');
  await input.fill('draft owned by c0');
  const dialog = await openPicker(page);

  // The modal backdrop intentionally owns pointer events, so a click on the
  // obscured rail must not masquerade as an external channel switch. Drive
  // the public canonical route instead: this is the same hash/popstate path
  // used by browser history/deep links and must cancel the old request.
  await page.evaluate(() => {
    window.history.pushState(window.history.state, '', '#/channels/c0.project/conversation');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.getByLabel('待发送附件')).toHaveCount(0);

  await page.evaluate(() => {
    window.history.pushState(window.history.state, '', '#/channels/c0/conversation');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.getByLabel('消息')).toHaveText('draft owned by c0');
  await expect(page.getByLabel('待发送附件')).toHaveCount(0);
});

test('choosing one public channel file closes the picker and creates exactly one draft attachment', async ({ page, request }) => {
  await reset(request, 14976604);
  await login(page);
  const dialog = await openPicker(page);
  const file = dialog.locator('.attachment-picker-row.file').first();
  await expect(file).toBeVisible();
  const name = (await file.locator('strong').innerText()).trim();
  await file.click();

  await expect(dialog).toHaveCount(0);
  const drafts = page.getByLabel('待发送附件');
  await expect(drafts).toContainText(name);
  await expect(drafts.locator('article')).toHaveCount(1);
});

test('choosing one public channel file preserves a multiline draft without an empty paragraph', async ({ page, request }) => {
  await reset(request, 14976605);
  await login(page);
  const input = page.getByLabel('消息');
  await input.fill('第一行\n第二行');
  const before = await input.locator('p').allTextContents();
  const dialog = await openPicker(page);
  await dialog.locator('.attachment-picker-row.file').first().click();

  await expect(dialog).toHaveCount(0);
  await expect.poll(() => input.locator('p').allTextContents()).toEqual(before);
  await expect(input.locator('p')).toHaveCount(before.length);
  await expect(page.getByLabel('待发送附件').locator('article')).toHaveCount(1);

  // The attachment must be materialized onto the durable draft, not only the
  // currently painted editor. Reloading is the public persistence boundary.
  await page.reload();
  await expect(page.getByLabel('消息')).toBeVisible();
  await expect.poll(() => page.getByLabel('消息').locator('p').allTextContents()).toEqual(before);
  await expect(page.getByLabel('消息').locator('p')).toHaveCount(before.length);
  await expect(page.getByLabel('待发送附件').locator('article')).toHaveCount(1);
});

test('TC-0651 / AD-357 keeps multiline text while attachment actions precede an accepted send', async ({ page, request }) => {
  await reset(request, 14976606);
  await login(page);
  const editor = page.getByLabel('消息');
  await editor.fill('@st');
  await page.getByRole('option', { name: /steward/ }).click();
  await editor.press('End');
  await editor.pressSequentially('第一行');
  await editor.press('Shift+Enter');
  await editor.pressSequentially('第二行');
  await expect(editor).toContainText('第一行');
  await expect(editor).toContainText('第二行');

  await page.getByLabel('上传本机文件到频道').setInputFiles({
    name: '本机证据.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('accepted attachment'),
  });
  const drafts = page.getByLabel('待发送附件');
  await expect(drafts).toContainText('本机证据.txt');

  await page.getByRole('button', { name: '从频道文件选择', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '从频道文件选择' });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: '关闭频道文件选择' }).click();
  await expect(picker).toHaveCount(0);
  await expect(editor).toContainText('第一行');
  await expect(editor).toContainText('第二行');
  await expect(drafts).toContainText('本机证据.txt');

  await editor.press('Enter');
  const turn = page.locator('.turn-card').filter({ hasText: '第一行' });
  await expect(turn).toBeVisible();
  await expect(turn).toContainText('第二行');
});
