// TC-0183 successor: preserve the original user action through the current
// production reading/presentation owner.  The deleted fae case used
// data-presentation-row-id and a private-era fold id; this case keeps the same
// collapse → channel handoff → append observables on the live App.
import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'deep-history', seed: 1314 },
  });
  expect(response.ok()).toBe(true);
}

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
  const chooser = page.getByRole('button', { name: '选择 Agent' });
  if (await chooser.isVisible().catch(() => false)) {
    await chooser.click();
    await page.getByRole('menu', { name: '选择目标 Agent' })
      .getByRole('menuitem', { name: 'steward' }).click();
  }
  await expect(steward).toBeVisible();
}

async function sendToSteward(page, text) {
  await chooseSteward(page);
  const editor = page.getByRole('textbox', { name: '消息', exact: true });
  await editor.fill(text);
  await page.getByRole('button', { name: '发送', exact: true }).click();
}

function currentRow(page, marker) {
  return page.locator('.timeline-reading-layer.is-active [data-presentation-row-id]')
    .filter({ hasText: marker }).last();
}

async function channel(page, name) {
  await page.getByRole('navigation', { name: '频道' }).getByText(name, { exact: true }).click();
  await expect(page.locator('main h1')).toHaveText(name);
  await expect(page.locator('.timeline-reading-layer.is-active .timeline-message-list')).toBeVisible();
}

test('用户显式收起 current entry 后，切频道返回与后续 append 都保留 override', async ({ page, request }) => {
  await reset(request);
  await login(page);

  const marker = 'LATEST-EXPLICIT-COLLAPSE';
  await sendToSteward(page, [
    marker,
    ...Array.from({ length: 44 }, (_, index) => `显式选择第 ${index + 1} 行`),
  ].join('\n'));

  const row = currentRow(page, marker);
  const toggle = row.locator('.message-fold-toggle').first();
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await toggle.click();
  await expect(row.locator('.message-fold-toggle').first()).toHaveAttribute('aria-expanded', 'false');

  await channel(page, 'c0.project');
  await channel(page, 'c0');
  const returned = currentRow(page, marker);
  await expect(returned.locator('.message-fold-toggle').first()).toHaveAttribute('aria-expanded', 'false');

  await sendToSteward(page, '后续 append 不得推翻我刚才的显式收起。');
  await expect(currentRow(page, marker).locator('.message-fold-toggle').first())
    .toHaveAttribute('aria-expanded', 'false');
});
