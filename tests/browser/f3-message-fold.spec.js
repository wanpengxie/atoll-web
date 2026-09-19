import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

async function chooseSteward(page) {
  const steward = page.locator('.model-selector-trigger').filter({ hasText: 'steward' });
  if (await steward.isVisible().catch(() => false)) return;

  // Delivery is owned by the composer's public model-selector menu. The old
  // labelled <select> belonged to the retired recipient compatibility path.
  const choose = page.getByRole('button', { name: '选择 Agent' });
  if (await choose.isVisible().catch(() => false)) {
    await choose.click();
    await page.getByRole('menu', { name: '选择目标 Agent' })
      .getByRole('menuitem', { name: 'steward' }).click();
  }
  await expect(steward).toBeVisible();
}

async function sendToSteward(page, text) {
  await chooseSteward(page);
  await page.getByRole('textbox', { name: '消息', exact: true }).fill(text);
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
  // The latest entry is intentionally expanded by the fae authority rule. Add
  // a real follow-up so the marker becomes historical before testing the
  // user's explicit expansion override across the channel handoff.
  await sendToSteward(page, '先把上一条变成历史，再由用户展开它。');

  const activeLayer = page.locator('.timeline-reading-layer.is-active');
  const article = activeLayer.getByRole('article').filter({ hasText: marker }).last();
  const expand = article.getByRole('button', { name: /展开全文/ });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expand.click();
  const collapse = article.getByRole('button', { name: '收起', exact: true });
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');

  await page.getByRole('navigation', { name: '频道' }).getByText('c0.project', { exact: true }).click();
  // A channel handoff is only real when the current production surface has
  // mounted the destination; keeping the outgoing row in the DOM is not UX
  // continuity and would let a stale locator make this case pass.
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.locator('.timeline-reading-layer.is-active .timeline-message-list')).toBeVisible();
  await page.getByRole('navigation', { name: '频道' }).getByText('c0', { exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.locator('.timeline-reading-layer.is-active .timeline-message-list')).toBeVisible();
  const returnedCollapse = page.locator('.timeline-reading-layer.is-active [data-presentation-row-id]')
    .filter({ hasText: marker }).getByRole('button', { name: '收起', exact: true }).first();
  await expect(returnedCollapse).toHaveAttribute('aria-expanded', 'true');

  await sendToSteward(page, '后续消息不得推翻我刚才的显式展开。');
  await expect(page.locator('.timeline-reading-layer.is-active [data-presentation-row-id]')
    .filter({ hasText: marker }).getByRole('button', { name: '收起', exact: true }).first())
    .toHaveAttribute('aria-expanded', 'true');
});
