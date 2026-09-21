import { expect, test } from '@playwright/test';

const SEED = 0x4a_de_37;

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'deep-history-delayed', seed: SEED },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

test('TC-0340 cold entry then real upward wheel paints the reverse reading surface', async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1120, height: 620 });
  await reset(request);
  await login(page);

  const timeline = page.locator('.timeline');
  const activeLayer = page.locator('.timeline-reading-layer.is-active');
  const activeList = activeLayer.locator('.timeline-message-list');
  await page.locator('button.channel-item').filter({ hasText: 'c0.project' }).first().click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(activeList.locator('[data-presentation-row-id]').last()).toBeVisible();
  await activeList.focus();
  await page.mouse.move(560, 300);

  for (const delta of [-120, -160, -220, -260]) {
    await page.mouse.wheel(0, delta);
    await page.waitForTimeout(12);
    // Each real input must leave a user-visible active row; a hidden
    // handoff/blank frame cannot satisfy the reverse-entry contract.
    await expect(page.locator('.timeline-reading-layer.is-active .timeline-message-list [data-presentation-row-id]:visible').first())
      .toBeVisible({ timeout: 5_000 });
  }

  await expect(timeline).toHaveAttribute('data-viewport-mode', 'browsing', { timeout: 10_000 });
  // The contract is the user's first reverse result, not which list
  // implementation renders it.  The current public surface uses the
  // conversation-list owner while retaining the same visible history row.
  const reverseRow = activeList.getByText('c0.project history 119: ask project-agent for PONG', { exact: true });
  await expect(reverseRow).toBeVisible({ timeout: 10_000 });
  await expect(reverseRow).toHaveCount(1);
  await expect(activeList).not.toContainText('加载中', { timeout: 10_000 });
});
