import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

const SEED = 0x51_09_18;
const OWNER_SELECTOR = '.timeline-reading-stack > .timeline-reading-layer.is-active > .timeline-message-list';

async function reset(request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'long-running-history', seed: SEED },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

function owner(page) {
  return page.locator(OWNER_SELECTOR);
}

async function append(request, text) {
  const response = await request.post(`${MOCK}/mock/control/action`, {
    data: {
      type: 'q_tail_append',
      channel_id: 'c0',
      ask: 'TC0380 selection append',
      text,
    },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function selectionState(page) {
  return page.evaluate(() => {
    const selection = window.getSelection();
    const rowFor = (node) => {
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      return element?.closest?.('[data-presentation-row-id]');
    };
    const anchor = rowFor(selection?.anchorNode);
    const focus = rowFor(selection?.focusNode);
    return {
      text: selection?.toString() || '',
      anchorConnected: Boolean(anchor?.isConnected),
      focusConnected: Boolean(focus?.isConnected),
      anchorID: anchor?.getAttribute('data-presentation-row-id') || '',
      focusID: focus?.getAttribute('data-presentation-row-id') || '',
      mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
    };
  });
}

test('TC-0380 a native visible selection survives browsing tail append', async ({ page, request }) => {
  test.setTimeout(90_000);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));

  await page.setViewportSize({ width: 1120, height: 620 });
  await reset(request);
  await login(page);

  const viewport = owner(page);
  await expect(viewport).toHaveCount(1);
  await expect(viewport.locator('[data-presentation-row-id]').last()).toBeVisible();
  await viewport.hover();
  await page.mouse.wheel(0, -1_200);
  await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing', { timeout: 10_000 });

  const visibleRows = viewport.locator('[data-presentation-row-id]:visible');
  await expect.poll(() => visibleRows.count(), { timeout: 10_000 }).toBeGreaterThan(1);
  // Playwright's native selectText is a real browser selection gesture on the
  // rendered message row; unlike a test-only Range injection it exercises the
  // same Selection object that a user can copy.
  await visibleRows.nth(0).selectText();
  await page.keyboard.down('Shift');
  for (let index = 0; index < 8; index += 1) await page.keyboard.press('ArrowDown');
  await page.keyboard.up('Shift');

  const before = await selectionState(page);
  expect(before.mode).toBe('browsing');
  expect(before.text.trim().length).toBeGreaterThan(10);
  expect(before.anchorConnected).toBe(true);
  expect(before.focusConnected).toBe(true);
  expect(before.anchorID).not.toBe(before.focusID);

  const marker = `TC0380 live append ${Date.now()}`;
  const appended = await append(request, marker);
  await page.waitForTimeout(300);
  const appendedRow = page.locator(`[data-presentation-row-id="${appended.request_id}"]`);
  await expect.poll(() => appendedRow.count()).toBe(1);
  await expect(appendedRow).toContainText(marker);
  const after = await selectionState(page);

  expect(after.mode, JSON.stringify({ before, after, appended })).toBe('browsing');
  expect(after.text, JSON.stringify({ before, after, appended })).toBe(before.text);
  expect(after.anchorConnected, JSON.stringify({ before, after, appended })).toBe(true);
  expect(after.focusConnected, JSON.stringify({ before, after, appended })).toBe(true);
  expect(pageErrors).toEqual([]);
});
