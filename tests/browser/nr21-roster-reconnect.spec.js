import { expect, test } from '@playwright/test';

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'multi-channel', seed: 2103 },
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

test('NR21 roster self is fenced while detached and restored by the new attach', async ({ page, request }) => {
  await reset(request);
  await login(page);

  await page.getByRole('button', { name: '成员', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '频道成员' });
  const selfMarker = panel.locator('.roster-row strong em');
  await expect(panel).toBeVisible();
  await expect(selfMarker).toHaveCount(1);

  // The detached interval can be shorter than a Playwright polling turn once
  // the successor socket is already accepted. Observe the public DOM seam
  // itself so the contract is checked at every reconnecting publication,
  // rather than requiring the test runner to catch that interval by timing.
  await page.evaluate(() => {
    const observations = [];
    const observe = () => {
      const state = document.querySelector('.connection-state')?.className || '';
      if (!state.includes('state-reconnecting')) return;
      observations.push({
        selfCount: document.querySelectorAll('[aria-label="频道成员"] .roster-row strong em').length,
      });
    };
    const observer = new MutationObserver(observe);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    observe();
    window.__NR21_ROSTER_RECONNECT_OBSERVATIONS = observations;
    window.__NR21_ROSTER_RECONNECT_OBSERVER = observer;
  });

  for (let index = 0; index < 10; index += 1) {
    await page.evaluate(() => window.__NR21_ROSTER_RECONNECT_OBSERVATIONS.splice(0));
    const dropped = await request.post('/mock/control/action', { data: { type: 'drop' } });
    expect(dropped.ok()).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__NR21_ROSTER_RECONNECT_OBSERVATIONS.length), { timeout: 10_000 }).toBeGreaterThan(0);
    const detached = await page.evaluate(() => window.__NR21_ROSTER_RECONNECT_OBSERVATIONS.slice());
    expect(detached.length).toBeGreaterThan(0);
    expect(detached.every(({ selfCount }) => selfCount === 0)).toBe(true);
    await expect(page.locator('.connection-state')).toHaveClass(/state-open/, { timeout: 15_000 });
    await expect(selfMarker).toHaveCount(1);
  }
  await page.evaluate(() => window.__NR21_ROSTER_RECONNECT_OBSERVER?.disconnect());
});
