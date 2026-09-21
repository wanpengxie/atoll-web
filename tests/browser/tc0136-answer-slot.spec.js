import { expect, test } from '@playwright/test';

async function openFixture(page) {
  await page.goto('/tests/browser/fixtures/tc0136-answer-slot.html');
  await page.waitForFunction(() => window.answerSlot?.ready());
}

test('TC-0136 rewritten terminal stays a distinct slot without stealing selection identity', async ({ page }) => {
  await openFixture(page);
  expect(await page.evaluate(() => window.answerSlot.select())).toBe('answer');
  await page.evaluate(() => window.answerSlot.rewrite());
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
  expect(await page.evaluate(() => window.answerSlot.rewriteState())).toEqual({
    progressSlots: 1,
    finalSlots: 1,
    terminalText: 'a genuinely rewritten terminal answer',
    terminalContentSameSelected: false,
    contentKeys: [
      'answer:request-1:stage-text-1:body',
      'answer:request-1:terminal:body',
    ],
  });
});
