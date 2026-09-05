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

test('研究消息里的 LaTeX 括号语法渲染为数学公式且不撑破窄屏', async ({ page, request }) => {
  const reset = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario: 'deep-history', seed: 1312 } });
  expect(reset.ok()).toBe(true);
  await page.setViewportSize({ width: 320, height: 720 });
  await login(page);

  await sendToSteward(page, [
    '行内公式：\\(M_t = \\operatorname{Fold}_R(H_t)\\)',
    '',
    '\\[',
    '\\text{Problem}\\rightarrow\\text{Constructional Model}\\rightarrow\\text{Machine}\\rightarrow\\text{Running Witness}',
    '\\]',
  ].join('\n'));

  const message = page.locator('.turn-card.self > .request-message').last();
  await expect(message.locator('.katex')).toHaveCount(2);
  await expect(message.locator('.katex-display')).toBeVisible();
  const layout = await message.evaluate((row) => {
    const display = row.querySelector('.katex-display');
    return {
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      displayClientWidth: display?.clientWidth || 0,
      displayScrollWidth: display?.scrollWidth || 0,
      overflowX: display ? getComputedStyle(display).overflowX : '',
    };
  });
  expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.displayClientWidth).toBeGreaterThan(0);
  expect(layout.displayScrollWidth).toBeGreaterThanOrEqual(layout.displayClientWidth);
  expect(layout.overflowX).toBe('auto');
});
