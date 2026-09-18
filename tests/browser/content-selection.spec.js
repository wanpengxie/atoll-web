import { expect, test } from '@playwright/test';

async function openFixture(page) {
  await page.goto('/tests/browser/fixtures/content-selection.html');
  await page.waitForFunction(() => window.contentSelectionFixture?.ready());
}

test('content plan preserves a real native selection in unchanged blocks during stream and prefix updates', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openFixture(page);
  expect(await page.evaluate(() => window.contentSelectionFixture.select())).toBe('sealed');
  await page.evaluate(() => window.contentSelectionFixture.appendTail());
  await page.evaluate(() => window.contentSelectionFixture.prependBlock());
  expect(await page.evaluate(() => window.contentSelectionFixture.selectionState())).toEqual({
    selection: 'sealed',
    blockSame: true,
    textSame: true,
    anchorSame: true,
    anchorConnected: true,
  });
  await page.keyboard.press('Control+C');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('sealed');
});

test('content bookmark resolves the surviving passage after a local edit and width reflow', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => window.contentSelectionFixture.capturePoint());
  await page.evaluate(() => window.contentSelectionFixture.leave());
  await page.evaluate(() => window.contentSelectionFixture.editPointBlock());
  expect(await page.evaluate(() => window.contentSelectionFixture.reflowWidth())).toBeLessThanOrEqual(120);
  await page.evaluate(() => window.contentSelectionFixture.return());
  expect(await page.evaluate(() => window.contentSelectionFixture.resolvedPoint())).toEqual({
    blockText: 'new first sealed target',
    textOffset: 17,
    suffix: 'target',
    blockMatch: 'id',
    textMatch: 'context',
  });
});
