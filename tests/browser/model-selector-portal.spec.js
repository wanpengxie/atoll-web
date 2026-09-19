import { expect, test } from '@playwright/test';

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

async function selector(page) {
  const chooser = page.getByRole('button', { name: '选择 Agent' });
  if (await chooser.isVisible().catch(() => false)) {
    await chooser.click();
    await page.getByRole('menu', { name: '选择目标 Agent' })
      .getByRole('menuitem', { name: 'steward' }).click();
  }
  const trigger = page.locator('.model-selector-trigger').filter({ hasText: 'steward' });
  await expect(trigger).toBeVisible();
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await expect(page.getByRole('menu', { name: '模型设置' })).toBeVisible({ timeout: 8_000 });
  return trigger;
}

async function bounds(page, item) {
  return item.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const portal = node.closest('[data-model-selector-portal="true"]')?.getBoundingClientRect()
      || node.parentElement?.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      item: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
      portal: portal ? { left: portal.left, right: portal.right, top: portal.top, bottom: portal.bottom } : null,
      ownsHit: Boolean(hit && (hit === node || node.contains(hit))),
      inComposerScrollport: Boolean(node.closest('.conversation-input-slot')),
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
}

for (const height of [500, 320, 200]) {
  test(`model selector portal remains reachable at ${height}px visual height`, async ({ page, request }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await reset(request, 0x93_10 + height);
    await login(page);
    await page.setViewportSize({ width: 390, height });
    const trigger = await selector(page);
    const panel = page.getByRole('menu', { name: '模型设置' });
    const panelBounds = await panel.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        ownsHit: Boolean(hit && (hit === node || node.contains(hit))),
        viewport: { width: innerWidth, height: innerHeight },
      };
    });
    await testInfo.attach(`model-selector-panel-${height}.json`, {
      body: JSON.stringify({ panelBounds }, null, 2), contentType: 'application/json',
    });
    expect(panelBounds.rect.left).toBeGreaterThanOrEqual(-1);
    expect(panelBounds.rect.right).toBeLessThanOrEqual(panelBounds.viewport.width + 1);
    expect(panelBounds.rect.top).toBeGreaterThanOrEqual(-1);
    expect(panelBounds.rect.bottom).toBeLessThanOrEqual(height + 1);
    const item = panel.getByRole('menuitem', { name: /模型/ });
    await expect(item).toBeVisible();
    const menuBounds = await bounds(page, item);
    expect(menuBounds.inComposerScrollport).toBe(false);
    expect(menuBounds.ownsHit).toBe(true);
    expect(menuBounds.portal?.top).toBeGreaterThanOrEqual(-1);
    expect(menuBounds.portal?.bottom).toBeLessThanOrEqual(height + 1);

    await item.click();
    const optionMenu = page.getByRole('menu', { name: '模型' });
    await expect(optionMenu).toBeVisible();
    const option = optionMenu.getByRole('menuitemradio').first();
    await expect(option).toBeVisible();
    const optionBounds = await bounds(page, option);
    await testInfo.attach(`model-selector-portal-${height}.json`, {
      body: JSON.stringify({ menuBounds, optionBounds }, null, 2), contentType: 'application/json',
    });
    expect(optionBounds.inComposerScrollport).toBe(false);
    expect(optionBounds.ownsHit).toBe(true);
    expect(optionBounds.portal?.top).toBeGreaterThanOrEqual(-1);
    expect(optionBounds.portal?.bottom).toBeLessThanOrEqual(height + 1);
    await option.click();
    await expect(page.locator('[data-model-selector-portal="true"]')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}
