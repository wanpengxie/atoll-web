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
  const editor = page.getByRole('textbox', { name: '消息', exact: true });
  await page.getByLabel('目标 Agent').selectOption('steward');
  await editor.fill(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
}

test('用户展开长消息后，切频道返回与后续消息都保留选择', async ({ page, request }) => {
  const reset = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'deep-history', seed: 1314 },
  });
  expect(reset.ok()).toBe(true);
  await login(page);

  const marker = 'LATEST-EXPLICIT-EXPANSION';
  await sendToSteward(page, [
    marker,
    ...Array.from({ length: 44 }, (_, index) => `显式选择第 ${index + 1} 行`),
  ].join('\n'));

  const article = page.getByRole('article').filter({ hasText: marker }).last();
  const expand = article.getByRole('button', { name: /展开全文/ });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expand.click();
  const collapse = article.getByRole('button', { name: '收起', exact: true });
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');

  await page.getByRole('navigation', { name: '频道' }).getByText('c0.project', { exact: true }).click();
  await page.getByRole('navigation', { name: '频道' }).getByText('c0', { exact: true }).click();
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');

  await sendToSteward(page, '后续消息不得推翻我刚才的显式展开。');
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
});
