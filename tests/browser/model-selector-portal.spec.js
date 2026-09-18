import { expect, test } from '@playwright/test';

async function installVisualViewport(page) {
  await page.addInitScript(() => {
    const viewport = new EventTarget();
    Object.assign(viewport, {
      width: 390, height: 844, offsetTop: 0, offsetLeft: 0, pageTop: 0, pageLeft: 0, scale: 1,
    });
    Object.defineProperty(globalThis, 'visualViewport', { configurable: true, value: viewport });
    globalThis.__setSyntheticVisualViewport = (patch) => {
      Object.assign(viewport, patch);
      viewport.dispatchEvent(new Event('resize'));
    };
  });
}

async function growEditor(page) {
  const editor = page.getByLabel('消息');
  await editor.focus();
  for (let index = 0; index < 14; index += 1) {
    if (index > 0) await editor.press('Shift+Enter');
    await editor.pressSequentially(`portal-${index}`);
  }
  return editor;
}

function hitEvidence(page, locator) {
  return locator.evaluate((node) => {
    const bounds = node.getBoundingClientRect();
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    const portal = node.closest('[data-model-selector-portal="true"]');
    const portalBounds = portal?.getBoundingClientRect();
    return {
      ownsHit: hit === node || node.contains(hit),
      item: bounds.toJSON(),
      portal: portalBounds?.toJSON() || null,
      insideInputScrollport: Boolean(node.closest('.conversation-input-slot')),
      visualTop: visualViewport.offsetTop,
      visualBottom: visualViewport.offsetTop + visualViewport.height,
    };
  });
}

for (const height of [500, 320, 200]) {
  test(`ModelSelector portal remains clickable at visual viewport ${height}px`, async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await installVisualViewport(page);
    await page.goto('/tests/browser/fixtures/composer-short-viewport.html');
    await growEditor(page);
    await page.evaluate((nextHeight) => globalThis.__setSyntheticVisualViewport({ height: nextHeight }), height);
    await expect(page.locator('.shell.mobile-shell')).toHaveAttribute('data-visual-viewport-owned', 'true');
    await expect.poll(() => page.locator('.shell').evaluate((node) => node.getBoundingClientRect().bottom))
      .toBeCloseTo(height, 0);

    const beforeReading = await page.locator('.conversation-reading-slot').evaluate((node) => node.clientHeight);
    await page.getByRole('button', { name: '取消回复' }).click();
    const trigger = page.getByRole('button', { name: /Agent One，模型 Model One，推理强度 中等/ });
    await trigger.click();
    const modelEntry = page.getByRole('menuitem', { name: /模型/ });
    await expect(modelEntry).toBeVisible();
    const menuEvidence = await hitEvidence(page, modelEntry);
    expect(menuEvidence.insideInputScrollport).toBe(false);
    expect(menuEvidence.ownsHit).toBe(true);
    expect(menuEvidence.portal.top).toBeGreaterThanOrEqual(menuEvidence.visualTop - 1);
    expect(menuEvidence.portal.bottom).toBeLessThanOrEqual(menuEvidence.visualBottom + 1);
    await modelEntry.click();

    const modelTwo = page.getByRole('menuitemradio', { name: 'Model Two' });
    await expect(modelTwo).toBeVisible();
    const optionEvidence = await hitEvidence(page, modelTwo);
    expect(optionEvidence.insideInputScrollport).toBe(false);
    expect(optionEvidence.ownsHit).toBe(true);
    expect(optionEvidence.portal.top).toBeGreaterThanOrEqual(optionEvidence.visualTop - 1);
    expect(optionEvidence.portal.bottom).toBeLessThanOrEqual(optionEvidence.visualBottom + 1);
    await modelTwo.click();

    await expect(page.getByTestId('selection-count')).toHaveText('1');
    await expect(page.locator('[data-model-selector-portal="true"]')).toHaveCount(0);
    const updatedTrigger = page.getByRole('button', { name: /Agent One，模型 Model Two，推理强度 高/ });
    await expect(updatedTrigger).toBeFocused();
    const afterReading = await page.locator('.conversation-reading-slot').evaluate((node) => node.clientHeight);
    expect(afterReading).toBe(beforeReading);
  });
}
