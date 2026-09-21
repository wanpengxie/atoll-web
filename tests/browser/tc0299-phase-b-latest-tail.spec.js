import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'multi-channel', seed: 812 },
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

test('TC-0299 B-BR-02a keeps a refreshed conversation at the latest public position', async ({ page, request }) => {
  await reset(request);
  await login(page);
  await page.getByRole('tab', { name: '动态', exact: true }).click();

  await page.reload();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  await expect(page.locator('.timeline')).toBeVisible();

  const viewport = page.getByRole('region', { name: '频道动态', exact: true });
  await expect(viewport).toBeVisible();
  await expect(page.locator('[data-presentation-row-id]').first()).toBeVisible();

  const samples = await viewport.evaluate(async (node) => {
    const rows = [];
    for (let index = 0; index < 30; index += 1) {
      rows.push({
        top: node.scrollTop,
        bottom: node.scrollHeight - node.clientHeight,
        height: node.scrollHeight,
        entries: node.querySelectorAll('[data-presentation-row-id]').length,
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return rows;
  });

  expect(samples.every((row) => Math.abs(row.bottom - row.top) <= 2), JSON.stringify(samples)).toBe(true);
  expect(samples.every((row) => row.entries > 0), JSON.stringify(samples)).toBe(true);
  expect(new Set(samples.map((row) => row.height)).size, JSON.stringify(samples)).toBe(1);
  expect(new Set(samples.map((row) => row.entries)).size, JSON.stringify(samples)).toBe(1);
});
