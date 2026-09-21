import { expect, test } from '@playwright/test';

async function openFixture(page) {
  await page.goto('/tests/browser/fixtures/tc0135-answer-slot.html');
  await page.waitForFunction(() => window.answerSlot?.ready());
}

for (const mode of ['same', 'continued']) {
  test(`TC-0135 terminal ${mode} answer keeps the logical answer slot and native selection`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openFixture(page);
    expect(await page.evaluate(() => window.answerSlot.select())).toBe('answer');
    await page.evaluate((value) => window.answerSlot.finish(value), mode);
    await expect.poll(() => page.evaluate(() => window.answerSlot.identity())).toEqual({
      selection: 'answer',
      anchorConnected: true,
      rowSame: true,
      cardSame: true,
      bubbleSame: true,
      wrapperSame: true,
      contentSame: true,
      blockSame: true,
      textSame: true,
      mermaidSame: true,
    });
    await page.keyboard.press('Control+C');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('answer');
  });
}
