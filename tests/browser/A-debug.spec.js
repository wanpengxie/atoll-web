import { expect, test } from '@playwright/test';
async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}
async function arrive(request, index) {
  const created = await request.post('/mock/control/action', { data: { type: 'dense_progress', channel_id: 'c0.project', count: 1 } });
  const { request_id: requestId } = await created.json();
  await request.post('/mock/control/action', { data: { type: 'push_terminal', channel_id: 'c0.project', request_id: requestId, payload: { text: `到达 ${index}` } } });
}
test('debug badge', async ({ page, request }) => {
  test.setTimeout(120_000);
  await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 5703 } });
  await login(page);
  const project = page.locator('.channel-item').filter({ has: page.locator('.channel-name', { hasText: /^c0\.project$/ }) });
  await project.click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  const viewport = page.locator('.timeline-message-list');
  await expect.poll(() => viewport.evaluate((n) => n.scrollHeight - n.clientHeight - n.scrollTop)).toBeLessThanOrEqual(24);
  for (let i = 1; i <= 3; i += 1) {
    await arrive(request, i);
    await page.waitForTimeout(700);
    const relatedBadge = project.locator('.unread-related');
    console.log(i,
      'related', await relatedBadge.count(), (await relatedBadge.allTextContents()).join(''),
      'total', await project.locator('.unread-total').count(),
      'tail', JSON.stringify(await page.evaluate(() => window.__A_TAIL || null)),
      'jump', await page.getByRole('button', { name: /条新动态/ }).count());
  }
  console.log('log', JSON.stringify((await page.evaluate(() => window.__A_TAIL_LOG || [])).slice(-8)));
  const presence = await page.evaluate(() => (window.__A_PRESENCE || []).slice(-25));
  for (const row of presence) console.log('PRESENCE', JSON.stringify(row));
  console.log('calls', await page.evaluate(() => window.__A_PRESENCE_CALLS || 0));
  console.log('rail', await page.evaluate(() => JSON.stringify(window.__ATOLL_DIAGNOSTICS__?.rail?.snapshot?.('c0.project')?.channels?.[0]?.counts)));
});
