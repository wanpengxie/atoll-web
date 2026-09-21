import { expect, test } from '@playwright/test';

async function openFixture(page) {
  await page.goto('/tests/browser/fixtures/tc0137-answer-slot.html');
  await page.waitForFunction(() => window.answerSlot?.ready());
}

test('TC-0137 only the matching last stage hands off while earlier stages remain separate', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => window.answerSlot.addSecondStage());
  expect(await page.evaluate(() => window.answerSlot.select('second sealed answer target'))).toBe('answer');
  await page.evaluate(() => window.answerSlot.finish());
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
  const slots = await page.evaluate(() => window.answerSlot.slotState());
  expect(slots).toHaveLength(2);
  expect(slots[0]).toMatchObject({
    kind: 'progress',
    contentKey: 'answer:request-1:stage-text-1:body',
  });
  expect(slots[0].text).toContain('sealed answer target');
  expect(slots[1]).toEqual({
    kind: 'final',
    text: 'second sealed answer target',
    contentKey: 'answer:request-1:stage-text-2:body',
  });
});
