import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

test('a process record opens the one process panel, uncovered, on that record', async ({ page, request }) => {
  await request.post(`${MOCK}/mock/control/reset`, { data: { scenario: 'progress-demo', seed: 4401 } });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  const picker = page.getByRole('button', { name: /选择 Agent/ });
  if (await picker.count()) {
    await picker.click();
    await page.getByRole('menuitemradio', { name: /steward/ }).or(page.getByRole('option', { name: /steward/ }))
      .or(page.getByRole('menuitem', { name: /steward/ })).first().click();
  }
  const editor = page.getByRole('textbox', { name: '消息' });
  await editor.click(); await editor.type('show me the process'); await page.keyboard.press('Enter');
  const header = page.locator('.progress-running-header').first();
  await expect(header).toBeVisible({ timeout: 15_000 });
  await header.click();
  const row = page.locator('.progress-trail-list .progress-row button').first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const line = (await row.locator('.progress-row-line').textContent()).trim();
  await row.click();

  const panel = page.getByRole('complementary', { name: '回合详情' });
  await expect(panel).toBeVisible();
  await expect(panel.locator('.process-record.is-selected .process-record-line')).toContainText(line);
  const covered = await page.evaluate(() => {
    const panelNode = document.querySelector('.turn-detail-page');
    const rect = panelNode.getBoundingClientRect();
    const points = [[0.5, 0.5], [0.5, 0.9], [0.9, 0.9], [0.2, 0.95]];
    return points.map(([x, y]) => {
      const hit = document.elementFromPoint(rect.left + rect.width * x, rect.top + rect.height * y);
      return panelNode.contains(hit);
    });
  });
  await page.screenshot({ path: 'test-results/process-panel.png' });
  expect(covered).toEqual([true, true, true, true]);
  // The in-list drawer is gone.
  await expect(page.locator('.progress-drawer-backdrop')).toHaveCount(0);
});
