import { expect, test } from '@playwright/test';

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

async function captureVisibleAnchor(page) {
  return page.locator('.timeline-message-list').evaluate((node) => {
    const top = node.getBoundingClientRect().top;
    const row = [...node.querySelectorAll('[data-presentation-row-id]')]
      .map((candidate) => ({
        id: candidate.dataset.presentationRowId,
        top: candidate.getBoundingClientRect().top - top,
        bottom: candidate.getBoundingClientRect().bottom - top,
      }))
      .filter((candidate) => candidate.bottom > 0 && candidate.top < node.clientHeight)
      .sort((left, right) => left.top - right.top)[0];
    return row || null;
  });
}

async function persistedBookmark(page, channelID, viewKeyPrefix) {
  return page.evaluate(({ channelID: channel, prefix }) => {
    for (const storageKey of ['atoll.view-session.v3.root', 'atoll.view-session.v2.root']) {
      const readings = JSON.parse(localStorage.getItem(storageKey) || 'null')?.readings || {};
      const key = Object.keys(readings).find((candidate) => candidate.startsWith(`${channel}\u0000${prefix}`));
      if (key && readings[key]?.bookmark) return readings[key].bookmark;
    }
    return null;
  }, { channelID, prefix: viewKeyPrefix });
}

async function expectAnchorRestored(page, anchor) {
  const viewport = page.locator('.timeline-message-list');
  await expect.poll(() => viewport.evaluate((node, expected) => {
    const row = [...node.querySelectorAll('[data-presentation-row-id]')]
      .find((candidate) => candidate.dataset.presentationRowId === expected.id);
    if (!row) return false;
    const rect = row.getBoundingClientRect();
    const root = node.getBoundingClientRect();
    return rect.bottom > root.top && rect.top < root.bottom;
  }, anchor)).toBe(true);
  const samples = await viewport.evaluate((node, expected) => new Promise((resolve) => {
    const values = [];
    const rootTop = () => node.getBoundingClientRect().top;
    const collect = () => {
      const row = [...node.querySelectorAll('[data-presentation-row-id]')]
        .find((candidate) => candidate.dataset.presentationRowId === expected.id);
      values.push(row ? row.getBoundingClientRect().top - rootTop() : null);
      if (values.length >= 8) resolve(values);
      else requestAnimationFrame(collect);
    };
    requestAnimationFrame(collect);
  }), anchor);
  expect(samples.every(Number.isFinite), JSON.stringify(samples)).toBe(true);
  expect(Math.abs(samples.at(-1) - anchor.top), JSON.stringify({ anchor, samples })).toBeLessThanOrEqual(32);
  expect(Math.max(...samples) - Math.min(...samples), JSON.stringify(samples)).toBeLessThanOrEqual(2);
}

async function expectAnchorNotRestored(page, anchor) {
  const viewport = page.locator('.timeline-message-list');
  await page.waitForTimeout(500);
  const samples = await viewport.evaluate((node, expected) => new Promise((resolve) => {
    const values = [];
    const collect = () => {
      const row = [...node.querySelectorAll('[data-presentation-row-id]')]
        .find((candidate) => candidate.dataset.presentationRowId === expected.id);
      const root = node.getBoundingClientRect();
      const rect = row?.getBoundingClientRect();
      values.push(Boolean(rect && rect.bottom > root.top && rect.top < root.bottom));
      if (values.length >= 8) resolve(values);
      else requestAnimationFrame(collect);
    };
    requestAnimationFrame(collect);
  }), anchor);
  expect(samples, JSON.stringify({ anchor, samples })).toEqual(samples.map(() => false));
}

async function chooseSteward(page) {
  const existing = page.locator('.model-selector-trigger').filter({ hasText: 'steward' });
  if (await existing.isVisible().catch(() => false)) return;
  const choose = page.getByRole('button', { name: '选择 Agent' });
  if (!await choose.isVisible().catch(() => false)) return;
  await choose.click();
  await page.getByRole('menu', { name: '选择目标 Agent' })
    .getByRole('menuitem', { name: 'steward' }).click();
  await expect(existing).toBeVisible();
}

test('TC0222 F7 reader can reverse direction immediately after a history prepend', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'mixed-height-history', seed: 1715 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  // Read upward until an older page has been prepended (an older row shows).
  const oldestShown = () => page.evaluate(() => Math.min(...[...document.querySelectorAll('.timeline-message-list .request-text')]
    .map((node) => Number(/history (\d+):/.exec(node.textContent || '')?.[1] || Infinity))));
  const startOldest = await oldestShown();
  for (let notch = 0; notch < 10 && await oldestShown() >= startOldest; notch += 1) {
    await page.mouse.wheel(0, -2_400);
    await page.waitForTimeout(150);
  }
  await expect.poll(oldestShown).toBeLessThan(startOldest);

  const beforeReverse = await viewport.evaluate((node) => node.scrollTop);
  await page.mouse.wheel(0, 640);
  await expect.poll(() => viewport.evaluate((node) => node.scrollTop)).toBeGreaterThan(beforeReverse + 20);
});

test('TC0223 F7 oldest-history boundary stays inert under repeated upward input', async ({ page, request }) => {
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1716 } });
  expect(reset.ok()).toBe(true);
  await login(page);

  const viewport = page.locator('.timeline-message-list');
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();
  for (let step = 0; step < 30; step += 1) {
    await viewport.hover();
    await page.mouse.wheel(0, -100_000);
    await page.waitForTimeout(30);
  }
  await expect(page.getByText('c0 history 1: ask steward for PONG', { exact: true })).toBeVisible();
  await viewport.hover();
  await page.mouse.wheel(0, -100_000);
  await expect.poll(() => viewport.evaluate((node) => Math.round(node.scrollTop))).toBe(0);

  const before = await page.evaluate(() => {
    const node = document.querySelector('.timeline-message-list');
    const first = node.querySelector('[data-presentation-row-id]');
    return {
      top: node.scrollTop,
      rowID: first?.dataset.presentationRowId || '',
      rowTop: first?.getBoundingClientRect().top - node.getBoundingClientRect().top,
      starts: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event === 'history.intent_started').length,
    };
  });
  for (let step = 0; step < 12; step += 1) await page.mouse.wheel(0, -720);
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => {
    const node = document.querySelector('.timeline-message-list');
    const first = node.querySelector('[data-presentation-row-id]');
    return {
      top: node.scrollTop,
      rowID: first?.dataset.presentationRowId || '',
      rowTop: first?.getBoundingClientRect().top - node.getBoundingClientRect().top,
      starts: window.__ATOLL_DIAGNOSTICS__.snapshot().filter((entry) => entry.event === 'history.intent_started').length,
    };
  });
  expect(after.top).toBe(0);
  expect(after.rowID).toBe(before.rowID);
  expect(Math.abs(after.rowTop - before.rowTop)).toBeLessThanOrEqual(1);
  expect(after.starts).toBe(before.starts);
});



test('TC0225 F7 Composer send-start cancels a filtered successor and never restores the old browsing row', async ({ page, request }) => {
  test.setTimeout(60_000);
  const reset = await request.post('/mock/control/reset', { data: { scenario: 'deep-history', seed: 1725 } });
  expect(reset.ok()).toBe(true);
  await login(page);
  await expect(page.getByText('c0 history 120: ask steward for PONG', { exact: true })).toBeVisible();

  const viewport = page.locator('.timeline-message-list');
  await viewport.hover();
  await page.mouse.wheel(0, -2_400);
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeGreaterThan(24);
  const oldAnchor = await captureVisibleAnchor(page);
  expect(oldAnchor?.id).toBeTruthy();

  const steward = page.getByRole('group', { name: '按成员过滤' }).getByRole('button', { name: 'steward' });
  await steward.click();
  await expect(steward).toHaveAttribute('aria-pressed', 'true');
  await chooseSteward(page);
  const marker = 'TC0225 send-start cancels scope successor';
  await page.getByRole('textbox', { name: '消息', exact: true }).fill(marker);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText(marker, { exact: true })).toBeVisible();
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);

  await steward.click();
  await expect(steward).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
  await expectAnchorNotRestored(page, oldAnchor);
});

