import { expect, test } from '@playwright/test';

async function openFixture(page) {
  await page.goto('/tests/browser/fixtures/answer-slot.html');
  await page.waitForFunction(() => window.answerSlot?.ready());
}

for (const mode of ['same', 'continued']) {
  test(`terminal ${mode} answer keeps the logical answer slot and native selection`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openFixture(page);
    expect(await page.evaluate(() => window.answerSlot.select())).toBe('answer');
    await page.evaluate((value) => window.answerSlot.finish(value), mode);
    expect(await page.evaluate(() => window.answerSlot.identity())).toEqual({
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

test('a rewritten terminal stays a distinct slot instead of claiming text-node continuity', async ({ page }) => {
  await openFixture(page);
  expect(await page.evaluate(() => window.answerSlot.select())).toBe('answer');
  await page.evaluate(() => window.answerSlot.finish('rewritten'));
  expect(await page.evaluate(() => window.answerSlot.identity())).toEqual({
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
      'terminal:terminal-1:body',
    ],
  });
});

test('only the matching last stage hands off; earlier conversation stages remain separate', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => window.answerSlot.addSecondStage());
  expect(await page.evaluate(() => window.answerSlot.select('second sealed answer target'))).toBe('answer');
  await page.evaluate(() => window.answerSlot.finish('second-same'));
  expect(await page.evaluate(() => window.answerSlot.identity())).toEqual({
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
  expect(await page.evaluate(() => window.answerSlot.slotState())).toEqual([
    {
      kind: 'progress',
      text: expect.stringContaining('sealed answer target'),
      contentKey: 'answer:request-1:stage-text-1:body',
    },
    {
      kind: 'final',
      text: 'second sealed answer target',
      contentKey: 'answer:request-1:stage-text-2:body',
    },
  ]);
});
