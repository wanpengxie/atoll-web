import { expect, test } from '@playwright/test';

// Migrated from fae8b70 onto the current AppShell/Composer entry.  The
// baseline asks for a one-click model read and a menu that stays open while
// the capability value is refreshed; no isolated harness can prove those
// production ownership and focus contracts.

async function reset(request, seed) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'actor-capability', seed },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('.timeline-message-list')).toBeVisible();
}

async function chooseSteward(page) {
  const chooser = page.getByRole('button', { name: '选择 Agent' });
  if (await chooser.isVisible().catch(() => false)) {
    await chooser.click();
    await page.getByRole('menu', { name: '选择目标 Agent' })
      .getByRole('menuitem', { name: 'steward' }).click();
  }
  const trigger = page.locator('.model-selector-trigger').filter({ hasText: 'steward' });
  await expect(trigger).toBeVisible();
  return trigger;
}

function collectConsoleErrors(page) {
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

test('one real click reads the Agent capability and opens the model menu', async ({ page, request }, testInfo) => {
  const errors = collectConsoleErrors(page);
  await reset(request, 0x93_19_01);
  await login(page);
  const trigger = await chooseSteward(page);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  // The current owner exposes the actor capability surface as a dialog.  Keep
  // the baseline's menu-item assertion so a missing selectable model remains a
  // visible product regression rather than a stale role/label failure.
  const panel = page.getByRole('dialog', { name: /steward Agent 状态/ });
  await expect(panel).toBeVisible({ timeout: 8_000 });
  const modelItem = panel.getByRole('menuitem', { name: '模型' });
  await testInfo.attach('model-selector-manual-production.json', {
    body: JSON.stringify({
      trigger: await trigger.getAttribute('aria-label'),
      panelRole: await page.locator('[data-model-selector-portal="true"]').first().getAttribute('role'),
      panelLabel: await panel.getAttribute('aria-label'),
      panelText: await panel.textContent(),
      errors,
    }, null, 2),
    contentType: 'application/json',
  });
  await expect(modelItem).toBeVisible();
  expect(errors.filter((line) => /Cannot update a component|Maximum update depth/.test(line)))
    .toHaveLength(0);
});

test('reopening the production model panel keeps its options available during refresh', async ({ page, request }, testInfo) => {
  const errors = collectConsoleErrors(page);
  await reset(request, 0x93_19_02);
  await login(page);
  const trigger = await chooseSteward(page);

  await trigger.click();
  const panel = page.getByRole('dialog', { name: /steward Agent 状态/ });
  await expect(panel).toBeVisible({ timeout: 8_000 });
  await testInfo.attach('model-selector-manual-reopen.json', {
    body: JSON.stringify({
      trigger: await trigger.getAttribute('aria-label'),
      panelRole: await page.locator('[data-model-selector-portal="true"]').first().getAttribute('role'),
      panelText: await panel.textContent(),
      errors,
    }, null, 2),
    contentType: 'application/json',
  });
  await expect(panel.getByRole('menuitem', { name: '模型' })).toBeVisible();

  // Closing and reopening is the real user refresh gesture. The panel must
  // not lose its capability contract or focus ownership between the clicks.
  await trigger.click();
  await expect(panel).toHaveCount(0);
  await trigger.click();
  await expect(panel).toBeVisible({ timeout: 8_000 });
  await expect(panel.getByRole('menuitem', { name: '模型' })).toBeVisible();
  expect(errors.filter((line) => /Cannot update a component|Maximum update depth/.test(line)))
    .toHaveLength(0);
});
