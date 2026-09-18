import { expect, test } from '@playwright/test';

async function openFixture(page) {
  await page.goto('/tests/browser/fixtures/content-focus.html');
  await page.waitForFunction(() => window.contentFocus?.ready());
}

test('folded content keeps visible text selectable and removes only clipped controls from Tab order', async ({ page }) => {
  await openFixture(page);
  await expect.poll(() => page.evaluate(() => window.contentFocus.foldState())).toEqual({
    folded: true,
    visibleTabIndex: null,
    visibleAriaHidden: null,
    hiddenTabIndex: '-1',
    hiddenAriaHidden: 'true',
  });
  expect(await page.evaluate(() => window.contentFocus.selectPreview())).toBe('selectable preview text');

  await page.locator('body').press('Tab');
  await expect(page.locator('#visible-link')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.message-fold-toggle')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.contentFocus.foldState())).toEqual({
    folded: false,
    visibleTabIndex: null,
    visibleAriaHidden: null,
    hiddenTabIndex: null,
    hiddenAriaHidden: null,
  });
  await page.locator('#visible-link').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#hidden-action')).toBeFocused();
});

test('Mermaid source toggle keeps the same focused button node in both modes', async ({ page }) => {
  await openFixture(page);
  const toggle = page.locator('.mermaid-mode-toggle');
  await toggle.focus();
  expect(await page.evaluate(() => window.contentFocus.mermaidToggleIdentity())).toEqual({
    same: true,
    label: '查看源码',
    focused: true,
  });
  await toggle.press('Enter');
  expect(await page.evaluate(() => window.contentFocus.mermaidToggleIdentity())).toEqual({
    same: true,
    label: '查看图表',
    focused: true,
  });
  await toggle.press('Enter');
  expect(await page.evaluate(() => window.contentFocus.mermaidToggleIdentity())).toEqual({
    same: true,
    label: '查看源码',
    focused: true,
  });
});
