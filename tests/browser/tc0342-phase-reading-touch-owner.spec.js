import { expect, test } from '@playwright/test';

const SEED = 0x4a_de_37;

async function reset(request) {
  const response = await request.post('/mock/control/reset', {
    data: { scenario: 'deep-history-delayed', seed: SEED },
  });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

test('TC-0342 ordinary browsing touch stays on the active reading surface', async ({ page, request }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1120, height: 620 });
  await reset(request);
  await login(page);

  await page.locator('button.channel-item').filter({ hasText: 'c0.project' }).first().click();
  await expect(page.locator('main h1')).toHaveText('c0.project');

  const timeline = page.locator('.timeline');
  const list = page.locator('.timeline-message-list');
  await expect(list.locator('[data-presentation-row-id]:visible').first()).toBeVisible();
  await expect(timeline).toHaveAttribute('data-viewport-mode', 'following', { timeout: 10_000 });
  const surface = () => page.evaluate(() => {
    const lists = document.querySelectorAll('.timeline-message-list');
    const root = lists[0]?.getBoundingClientRect();
    const rows = lists[0] ? [...lists[0].querySelectorAll('[data-presentation-row-id]')].filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.bottom > (root?.top || 0) && rect.top < (root?.bottom || 0) && getComputedStyle(node).visibility !== 'hidden';
    }).map((node) => node.dataset.presentationRowId || '') : [];
    const history = rows.map((id) => Number(id.match(/history-request-(\d+)$/)?.[1])).filter(Number.isFinite);
    return { mode: document.querySelector('.timeline')?.dataset.viewportMode || '', lists: lists.length, rows: rows.length, oldest: history.length ? Math.min(...history) : Infinity };
  });

  // Reading upward with the wheel: a few ordinary notches leave the tail.
  await list.hover();
  // Until browsing holds: a follow the vendor armed before the first notch
  // may still pull the list back once, so settle and re-check.
  for (let notch = 0; notch < 10; notch += 1) {
    await page.mouse.wheel(0, -260);
    await page.waitForTimeout(150);
    if ((await surface()).mode !== 'browsing') continue;
    await page.waitForTimeout(400);
    if ((await surface()).mode === 'browsing') break;
  }
  const afterWheel = await surface();
  expect(afterWheel.mode).toBe('browsing');
  expect(afterWheel.lists).toBe(1);
  expect(afterWheel.rows).toBeGreaterThan(0);

  // Then the finger: dragging down reads further up, on the same one surface,
  // and the reader stays browsing throughout.
  const box = await list.boundingBox();
  const client = await page.context().newCDPSession(page);
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 3);
  for (let drag = 0; drag < 3; drag += 1) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 7, radiusX: 4, radiusY: 4, force: 1 }] });
    for (const offset of [80, 160, 240]) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + offset, id: 7, radiusX: 4, radiusY: 4, force: 1 }] });
      await page.waitForTimeout(30);
      const during = await surface();
      expect(during.mode).toBe('browsing');
      expect(during.lists).toBe(1);
      expect(during.rows).toBeGreaterThan(0);
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(150);
  }
  const afterTouch = await surface();
  expect(afterTouch.mode).toBe('browsing');
  expect(afterTouch.oldest).toBeLessThan(afterWheel.oldest);
});
