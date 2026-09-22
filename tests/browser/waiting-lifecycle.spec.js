import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

async function login(page, request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario: 'long-running-history', seed: 4301 } });
  expect(response.ok()).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('.timeline-message-list [data-presentation-row-id]:visible').first()).toBeVisible();
  const picker = page.getByRole('button', { name: /选择 Agent/ });
  if (await picker.count()) {
    await picker.click();
    await page.getByRole('menuitemradio', { name: /steward/ }).or(page.getByRole('option', { name: /steward/ }))
      .or(page.getByRole('menuitem', { name: /steward/ })).first().click();
  }
}

// Record, frame by frame, which request texts the dock and the timeline hold.
async function startRecording(page) {
  await page.evaluate(() => {
    const frames = [];
    window.__waitingFrames = frames;
    const sample = () => {
      const dock = [...document.querySelectorAll('.agent-wait-item strong')].map((node) => node.textContent);
      const labels = [...document.querySelectorAll('.agent-wait-local-state')].map((node) => node.textContent);
      const timeline = [...document.querySelectorAll('.timeline-message-list .request-text')].map((node) => node.textContent);
      const list = document.querySelector('.timeline-message-list');
      const rowsAnywhere = [...document.querySelectorAll('[data-presentation-row-id]')].map((node) => node.dataset.presentationRowId + (node.closest('.timeline-message-list') ? '' : '@outside'));
      frames.push({ at: performance.now(), dock, labels, timeline, empty: list?.dataset.empty || '', rowsAnywhere, listRows: list?.querySelectorAll('[data-presentation-row-id]').length || 0 });
      window.__waitingRaf = requestAnimationFrame(sample);
    };
    sample();
  });
}
const stopRecording = (page) => page.evaluate(() => { cancelAnimationFrame(window.__waitingRaf); return window.__waitingFrames; });

async function send(page, text) {
  const editor = page.getByRole('textbox', { name: '消息' });
  await editor.click();
  await editor.type(text);
  await page.keyboard.press('Enter');
}

test('a send to an idle agent goes to the timeline; a send behind a running one waits and stays', async ({ page, request }) => {
  await login(page, request);
  await startRecording(page);
  await send(page, 'first-to-idle');
  await expect(page.locator('.timeline-message-list .request-text', { hasText: 'first-to-idle' })).toBeVisible();
  await page.waitForTimeout(800);
  let frames = await stopRecording(page);
  expect(frames.some((frame) => frame.dock.some((text) => text.includes('first-to-idle')))).toBe(false);
  const firstShown = frames.findIndex((frame) => frame.timeline.some((text) => text.includes('first-to-idle')));
  expect(firstShown).toBeGreaterThanOrEqual(0);
  // Once shown, never gone.
  expect(frames.slice(firstShown).every((frame) => frame.timeline.some((text) => text.includes('first-to-idle')))).toBe(true);

  await startRecording(page);
  await send(page, 'second-behind-busy');
  await expect(page.locator('.agent-wait-item', { hasText: 'second-behind-busy' })).toBeVisible();
  await page.waitForTimeout(1500);
  frames = await stopRecording(page);
  const shown = frames.findIndex((frame) => frame.dock.some((text) => text.includes('second-behind-busy')));
  expect(shown).toBeGreaterThanOrEqual(0);
  expect(frames.slice(shown).every((frame) => frame.dock.some((text) => text.includes('second-behind-busy')))).toBe(true);
  expect(frames.some((frame) => frame.timeline.some((text) => text.includes('second-behind-busy')))).toBe(false);
  // A normal send shows no transport state on its way in.
  expect(frames.flatMap((frame) => frame.labels)).toEqual([]);
  console.log(`frames recorded: ${frames.length}`);
});
