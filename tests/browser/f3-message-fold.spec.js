import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

async function sendToSteward(page, text) {
  const editor = page.getByTestId('composer-input');
  await editor.fill('@st');
  await page.getByRole('option', { name: /steward/ }).click();
  await editor.press('End');
  await page.keyboard.insertText(text);
  await page.getByRole('button', { name: /发送/ }).click();
}

test('F7 收起虚拟列表里的长消息时，读者点下的控件不跳出原位', async ({ page, request }) => {
  const reset = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario: 'deep-history', seed: 1311 } });
  expect(reset.ok()).toBe(true);
  await login(page);

  const longMessage = Array.from({ length: 45 }, (_, index) => `第 ${index + 1} 行：用于验证收起定位。`).join('\n');
  await sendToSteward(page, longMessage);
  await sendToSteward(page, '后一条短消息，让长消息进入默认折叠状态。');

  const expand = page.locator('.message-fold-toggle[aria-expanded="false"]').last();
  await expect(expand).toBeVisible();
  await expand.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await expand.click();

  const collapse = page.locator('.message-fold-toggle[aria-expanded="true"]').last();
  await expect(collapse).toBeVisible();
  await collapse.evaluate((node) => node.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(100);
  const rowID = await collapse.evaluate((node) => node.closest('[data-presentation-row-id]')?.dataset.presentationRowId || '');
  const row = page.locator(`[data-presentation-row-id=${JSON.stringify(rowID)}]`);
  const scroller = page.locator('.timeline-message-list');
  const expandedHeight = await row.evaluate((node) => node.getBoundingClientRect().height);
  const anchorTop = await collapse.evaluate((node) => node.getBoundingClientRect().top);
  await collapse.evaluate((node) => {
    window.__foldPaintTops = [];
    window.__foldPaintRunning = true;
    const sample = () => {
      if (!window.__foldPaintRunning) return;
      window.__foldPaintTops.push({ connected: node.isConnected, top: node.getBoundingClientRect().top });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  await collapse.click();
  await expect(page.getByRole('button', { name: /展开全文 · 45 行/ }).last()).toBeVisible();
  await expect.poll(() => row.evaluate((node) => node.getBoundingClientRect().height)).toBeLessThan(expandedHeight * 0.75);
  await page.waitForTimeout(150);
  const frames = await page.evaluate(() => {
    window.__foldPaintRunning = false;
    return window.__foldPaintTops;
  });

  expect(frames.length).toBeGreaterThan(1);
  expect(frames.every((frame) => frame.connected && Math.abs(frame.top - anchorTop) <= 1)).toBe(true);

  // Collapsing must remove the physical height, not merely hide its content
  // inside an expanded virtual item. The next user gesture must immediately
  // move the real scroller.
  const beforeWheel = await scroller.evaluate((node) => node.scrollTop);
  await scroller.hover();
  await page.mouse.wheel(0, -320);
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeLessThan(beforeWheel - 20);
});
