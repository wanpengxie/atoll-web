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
}

test('opaque member filter keeps a whole historical turn across roster and human incarnations', async ({ page, request }, testInfo) => {
  // The fae8b70 case used a fixture to manufacture an old-incarnation roster.
  // The current production session persists that preference through the same
  // ViewSession contract, so exercise the real AppShell and real history rows.
  await reset(request, 'deep-history', 29_210);
  await login(page);
  await expect(page.locator('main h1')).toHaveText('c0');
  // Deep-history admits its canonical rows asynchronously. Seed the
  // persisted filter only after the public history owner has exposed the
  // target turn; otherwise the initial preferences write can race the test's
  // localStorage replacement during the reload boundary.
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const key = 'atoll.view-session.v3.root';
    const value = JSON.parse(localStorage.getItem(key) || '{"schema":3,"preferences":{},"readings":{}}');
    value.schema = 3;
    value.preferences ||= {};
    value.readings ||= {};
    value.preferences.c0 = {
      ...(value.preferences.c0 || {}),
      scope: 'mine',
      actorFilter: ['agent:steward:old-incarnation'],
    };
    localStorage.setItem(key, JSON.stringify(value));
  });
  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);

  const stale = page.locator('.timeline-actor-filter .is-stale');
  await expect(stale).toBeVisible();
  await expect(stale).toHaveAttribute('aria-pressed', 'true');
  await stale.click();
  // The user-visible contract is that removing the stale exact-incarnation
  // choice clears its control. Do not use the virtualized row set as a
  // same-frame oracle: it may briefly be empty while the stable article is
  // being retained/repositioned.
  await expect(stale).toHaveCount(0);

  const historyQuestion = page.getByText('c0 history 120: ask steward for PONG', { exact: true });
  await expect(historyQuestion).toBeVisible();
  const turn = page.locator('[data-presentation-row-id]').filter({ hasText: 'c0 history 120: ask steward for PONG' }).first();
  const historicalArticle = turn.locator('article.message-row').first();
  await expect(turn).toBeVisible();
  await expect(historicalArticle).toBeVisible();
  await expect(historicalArticle).toHaveAttribute('tabindex', '0');
  await historicalArticle.focus();
  await expect(historicalArticle).toBeFocused();
  const steward = page.getByRole('group', { name: '按成员过滤' })
    .getByRole('button', { name: 'steward', exact: true });
  await expect(steward).toBeVisible();
  await steward.click();
  await expect(steward).toHaveAttribute('aria-pressed', 'true');

  await expect(turn).toBeVisible();
  await expect(turn).toContainText('c0 PONG 120');
  const filtered = await page.evaluate(() => ({
    selected: [...document.querySelectorAll('.timeline-actor-filter button[aria-pressed="true"]')]
      .map((node) => node.textContent?.trim() || ''),
    scopeText: document.querySelector('[aria-label="动态范围"]')?.textContent || '',
  }));
  await testInfo.attach('member-filter-production-timeline.json', {
    body: JSON.stringify({ filtered }, null, 2),
    contentType: 'application/json',
  });
  expect(filtered.selected).toContain('steward');
  expect(filtered.scopeText).not.toContain('正在确认频道内容');

  await steward.click();
  await expect(steward).toHaveAttribute('aria-pressed', 'false');
  await expect(turn).toContainText('c0 PONG 120');
});

test('member filter keeps the selected Agent conversation visible and can be cleared', async ({ page, request }) => {
  await reset(request, 'deep-history', 29_211);
  await login(page);
  await page.locator('.channel-item').filter({
    has: page.locator('.channel-name', { hasText: /^c0\.project$/ }),
  }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');

  const latestConversation = page.getByText(
    'c0.project history 120: ask project-agent for PONG',
    { exact: true },
  );
  await expect(latestConversation).toBeVisible();

  const filter = page.getByRole('group', { name: '动态范围' })
    .getByRole('button', { name: 'project-agent', exact: true });
  await filter.click();
  await expect(filter).toHaveAttribute('aria-pressed', 'true');
  await expect(latestConversation).toBeVisible();
  await expect(page.getByText('c0.project PONG 120', { exact: true })).toBeVisible();

  await filter.click();
  await expect(filter).toHaveAttribute('aria-pressed', 'false');
  await expect(latestConversation).toBeVisible();
});
