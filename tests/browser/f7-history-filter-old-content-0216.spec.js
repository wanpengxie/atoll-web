import { expect, test } from '@playwright/test';

async function reset(request, scenario, seed) {
  const response = await request.post('/mock/control/reset', { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

test('TC0216 public Claude filter reveals two physically separated old rows', async ({ page, request }) => {
  test.setTimeout(90_000);
  await reset(request, 'deep-history-delayed', 1731);
  for (const index of [1, 2]) {
    const oldTarget = await request.post('/mock/control/action', {
      data: {
        type: 'q_tail_append',
        channel_id: 'c0',
        agent_id: 'claude',
        ask: `public old Claude marker ${index}`,
        text: `public old Claude answer ${index}`,
      },
    });
    expect(oldTarget.ok()).toBe(true);
  }
  const firstNoise = await request.post('/mock/control/action', {
    data: { type: 'dense_progress', channel_id: 'c0', related: false, count: 320, tail_count: 0 },
  });
  expect(firstNoise.ok()).toBe(true);
  const newTarget = await request.post('/mock/control/action', {
    data: {
      type: 'dense_progress', channel_id: 'c0', related: false, count: 1,
      target_agent: 'claude', target_count: 8, tail_count: 0,
    },
  });
  expect(newTarget.ok()).toBe(true);
  const secondNoise = await request.post('/mock/control/action', {
    data: { type: 'dense_progress', channel_id: 'c0', related: false, count: 320, tail_count: 20 },
  });
  expect(secondNoise.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('visible tail 20', { exact: true })).toBeVisible({ timeout: 15_000 });

  const filter = page.getByTitle('只看我与 Claude 的往来');
  await expect(filter).toBeVisible();
  await filter.click();
  await expect(page.getByText('target claude question 8', { exact: true })).toBeVisible({ timeout: 30_000 });

  const viewport = page.locator('.timeline-message-list');
  const newestRow = page.locator('[data-presentation-row-id]').filter({ hasText: 'target claude question 8' }).last();
  const newestSequence = await newestRow.evaluate((node) => ({
    low: Number(node.querySelector('[data-seq-low]')?.getAttribute('data-seq-low') || 0),
    high: Number(node.querySelector('[data-seq-high]')?.getAttribute('data-seq-high') || 0),
  }));

  // The fixture places the old matching rows more than one physical 128-row
  // page behind the newest matching group. Native wheel input is the only
  // user action that may request that older filtered content.
  for (let step = 0; step < 120 && await page.getByText('public old Claude marker 1', { exact: true }).count() === 0; step += 1) {
    await viewport.hover();
    await page.mouse.wheel(0, -720);
    await page.waitForTimeout(24);
  }
  await expect(page.getByText('public old Claude marker 1', { exact: true })).toBeVisible({ timeout: 30_000 });

  const oldRows = page.locator('[data-presentation-row-id]').filter({ hasText: /public old Claude marker [12]/ });
  await expect(oldRows).toHaveCount(2);
  const oldSequence = await oldRows.evaluateAll((nodes) => nodes.map((node) => ({
    low: Number(node.querySelector('[data-seq-low]')?.getAttribute('data-seq-low') || 0),
    high: Number(node.querySelector('[data-seq-high]')?.getAttribute('data-seq-high') || 0),
  })));
  expect(newestSequence.low).toBeGreaterThan(0);
  expect(Math.abs(newestSequence.low - oldSequence[0].low)).toBeGreaterThan(128);
  await expect(page.locator('.timeline-history-demand')).toHaveCount(0);
});
