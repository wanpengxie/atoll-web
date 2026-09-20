import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'long-running', seed: 0xad027 },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('.timeline-message-list')).toBeVisible();
}

async function send(page, value) {
  const editor = page.getByRole('textbox', { name: '消息', exact: true });
  await editor.fill('@st');
  const option = page.getByRole('option', { name: /steward/ });
  if (await option.isVisible().catch(() => false)) await option.click();
  await editor.press('End');
  await editor.pressSequentially(value);
  await page.getByRole('button', { name: '发送', exact: true }).click();
}

async function installImperativeScrollProbe(page) {
  await page.evaluate(() => {
    const writes = [];
    for (const method of ['scrollTo', 'scrollBy', 'scrollIntoView']) {
      const original = Element.prototype[method];
      Element.prototype[method] = function patchedReadingProbe(...args) {
        if (this.closest?.('.timeline-reading-stack') || this.classList?.contains?.('timeline-reading-stack')) {
          writes.push({ method, node: this.className || this.tagName, args });
        }
        return original.apply(this, args);
      };
    }
    window.__ad027ImperativeScrollWrites = writes;
  });
}

test('AD027 processing edit keeps committed Reading owner and Composer handoff', async ({ page, request }) => {
  await page.setViewportSize({ width: 1120, height: 760 });
  await reset(request);
  await login(page);

  const taskText = 'AD027 processing edit keeps reading owner';
  await send(page, taskText);
  const turn = page.locator('.turn-card').filter({ hasText: taskText }).last();
  await expect(turn.getByRole('button', { name: '编辑', exact: true })).toBeVisible();

  const editor = page.getByRole('textbox', { name: '消息', exact: true });
  const ordinaryDraft = 'ordinary draft survives processing edit';
  await editor.fill(ordinaryDraft);
  const reading = page.locator('.timeline-reading-stack');
  await expect(reading).toHaveCount(1);
  await reading.evaluate((node) => { node.dataset.ad027Probe = 'same'; });
  await installImperativeScrollProbe(page);

  const targetID = await turn.getAttribute('data-request-id');
  await turn.getByRole('button', { name: '编辑', exact: true }).click();
  expect(targetID).not.toBeNull();

  await expect(page.getByRole('button', { name: '取消编辑', exact: true })).toBeVisible();
  await expect(editor).toContainText(taskText);
  await expect(editor).toBeFocused();
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'following');
  await expect(page.locator('[data-ad027-probe="same"]')).toHaveCount(1);
  expect(await page.evaluate(() => window.__ad027ImperativeScrollWrites)).toEqual([]);

  await editor.fill('replacement text remains edit-only');
  await page.getByRole('button', { name: '取消编辑', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消编辑', exact: true })).toHaveCount(0);
  await expect(editor).toContainText(ordinaryDraft);
  await expect(editor).toBeFocused();
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'following');
  await expect(page.locator('[data-ad027-probe="same"]')).toHaveCount(1);
  expect(await page.evaluate(() => window.__ad027ImperativeScrollWrites)).toEqual([]);
});
