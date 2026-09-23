import { expect, test } from '@playwright/test';

// Switching away and back reopens a view as it was being read. Following
// (stuck to the bottom) reopens at the newest row, including what arrived
// while away; browsing reopens on the row that was at the top, at the same
// offset. The memory is the page's only: a reload opens following.

const LIST = '.timeline-message-list';

async function login(page, request) {
  await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1 } });
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

async function open(page, name) {
  await page.locator('.channel-item')
    .filter({ has: page.locator('.channel-name', { hasText: new RegExp(`^${name.replace('.', '\\.')}$`) }) })
    .click();
  await expect(page.locator('main h1')).toHaveText(name);
  await expect(page.locator(LIST)).toHaveAttribute('data-reading-mode', /following|browsing/);
}

const reading = (page) => page.evaluate((selector) => {
  const list = document.querySelector(selector);
  const edge = list.getBoundingClientRect().top;
  let anchor = null;
  for (const element of list.querySelectorAll('[data-presentation-row-id]')) {
    const rect = element.getBoundingClientRect();
    if (rect.height > 0 && rect.bottom > edge + 1) {
      anchor = { id: element.dataset.presentationRowId, offset: Math.round(edge - rect.top) };
      break;
    }
  }
  const rows = [...list.querySelectorAll('[data-presentation-row-id]')];
  return {
    gap: Math.round(list.scrollHeight - list.scrollTop - list.clientHeight),
    mode: list.getAttribute('data-reading-mode'),
    last: rows.at(-1)?.textContent || '',
    anchor,
  };
}, LIST);

async function settle(page) {
  // Two quiet frames after the vendor's own positioning.
  await page.waitForTimeout(400);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test('a following view reopens at its newest row, with what arrived while away', async ({ page, request }) => {
  await login(page, request);
  await open(page, 'c0.project');
  await settle(page);
  expect((await reading(page)).gap).toBeLessThanOrEqual(2);

  await open(page, 'c0');
  await request.post('/mock/control/action', {
    data: { type: 'notification_lifecycle', channel_id: 'c0.project', phase: 'tail', count: 12 },
  });
  await page.waitForTimeout(500);

  await open(page, 'c0.project');
  await expect(page.locator(LIST)).toContainText('notification tail 12');
  await settle(page);
  const back = await reading(page);
  expect(back.mode).toBe('following');
  expect(back.gap).toBeLessThanOrEqual(2);
  expect(back.last).toContain('notification tail 12');
});

test('a browsing view reopens on the row it was left at', async ({ page, request }) => {
  await login(page, request);
  await open(page, 'c0.project');
  await settle(page);
  const box = await page.locator(LIST).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let notch = 0; notch < 12; notch += 1) {
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(60);
  }
  await settle(page);
  const left = await reading(page);
  expect(left.mode).toBe('browsing');
  expect(left.gap).toBeGreaterThan(400);

  await open(page, 'c0');
  await settle(page);
  await page.evaluate(() => { globalThis.__rp = []; });
  await open(page, 'c0.project');
  await settle(page);
  const back = await reading(page);
  console.log(JSON.stringify(await page.evaluate(() => globalThis.__rp)));
  console.log('BACK', JSON.stringify(back));
  expect(back.mode).toBe('browsing');
  expect(back.anchor.id).toBe(left.anchor.id);
  expect(Math.abs(back.anchor.offset - left.anchor.offset)).toBeLessThanOrEqual(2);
});

test('a reload opens following, whatever the page remembered', async ({ page, request }) => {
  await login(page, request);
  await open(page, 'c0.project');
  await settle(page);
  const box = await page.locator(LIST).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let notch = 0; notch < 12; notch += 1) {
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(60);
  }
  await settle(page);
  expect((await reading(page)).mode).toBe('browsing');
  await open(page, 'c0');

  await page.reload();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await open(page, 'c0.project');
  await settle(page);
  const fresh = await reading(page);
  expect(fresh.mode).toBe('following');
  expect(fresh.gap).toBeLessThanOrEqual(2);
});
