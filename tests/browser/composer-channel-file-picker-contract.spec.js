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
