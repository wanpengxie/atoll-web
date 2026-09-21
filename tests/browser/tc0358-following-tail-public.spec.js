import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';
import { READING_OWNER_SELECTOR } from './reading-owner.js';

const SEED = 0x35_08_22;

async function attachJSON(testInfo, name, value) {
  const path = testInfo.outputPath(name);
  await writeFile(path, `${JSON.stringify({ capturedAt: new Date().toISOString(), ...value }, null, 2)}\n`, 'utf8');
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

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
  await expect(page.locator(READING_OWNER_SELECTOR)).toHaveCount(1);
  await expect(page.locator(READING_OWNER_SELECTOR)).toBeVisible();
}

async function append(request, index) {
  const text = [
    `TC0358 public tail ${index}`,
    '',
    `This is a visible tail update ${index}. `.repeat(3 + index),
    '',
    ...Array.from({ length: 3 + index }, (_, line) => `layout line ${index}.${line + 1}`),
  ].join('\n');
  const response = await request.post(`${MOCK}/mock/control/action`, {
    data: {
      type: 'q_tail_append',
      channel_id: 'c0',
      ask: `TC0358 public tail ${index}`,
      text,
    },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}

async function startCapture(page) {
  await page.evaluate((selector) => {
    const state = { active: true, startedAt: performance.now(), frames: [] };
    const visibleRows = (owner, ownerRect) => [...owner.querySelectorAll('[data-presentation-row-id]')]
      .filter((row) => {
        const rect = row.getBoundingClientRect();
        if (rect.bottom <= ownerRect.top + 1 || rect.top >= ownerRect.bottom - 1) return false;
        const x = Math.min(ownerRect.right - 1, Math.max(ownerRect.left + 1, (rect.left + rect.right) / 2));
        const y = Math.min(ownerRect.bottom - 1, Math.max(ownerRect.top + 1, (Math.max(rect.top, ownerRect.top) + Math.min(rect.bottom, ownerRect.bottom)) / 2));
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && (hit === row || row.contains(hit)));
      })
      .map((row) => row.dataset.presentationRowId || '');
    const tick = () => {
      if (!state.active) return;
      const owner = document.querySelector(selector);
      const ownerRect = owner?.getBoundingClientRect();
      const gap = owner
        ? owner.dataset.readingContainer === 'following-tail'
          ? Math.abs(Number(owner.scrollTop || 0))
          : Math.max(0, Number(owner.scrollHeight || 0) - Number(owner.clientHeight || 0) - Number(owner.scrollTop || 0))
        : null;
      state.frames.push({
        elapsedMs: Math.round(performance.now() - state.startedAt),
        mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
        container: owner?.dataset.readingContainer || '',
        gap: gap == null ? null : Number(gap.toFixed(2)),
        rows: owner ? owner.querySelectorAll('[data-presentation-row-id]').length : 0,
        visibleRowIDs: owner && ownerRect ? visibleRows(owner, ownerRect) : [],
      });
      requestAnimationFrame(tick);
    };
    window.__TC0358_PUBLIC_CAPTURE__ = state;
    requestAnimationFrame(tick);
  }, READING_OWNER_SELECTOR);
}

async function stopCapture(page) {
  return page.evaluate(() => {
    const state = window.__TC0358_PUBLIC_CAPTURE__;
    if (!state) return [];
    state.active = false;
    return state.frames;
  });
}

async function publicTail(page) {
  return page.locator(READING_OWNER_SELECTOR).evaluate((node) => ({
    mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
    container: node.dataset.readingContainer || '',
    gap: node.dataset.readingContainer === 'following-tail'
      ? Math.abs(Number(node.scrollTop || 0))
      : Math.max(0, Number(node.scrollHeight || 0) - Number(node.clientHeight || 0) - Number(node.scrollTop || 0)),
    rowCount: node.querySelectorAll('[data-presentation-row-id]').length,
  }));
}

test.describe('TC0358 public following-tail continuity', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1120, height: 620 });
  });

  test('following remains at the visible tail while real arrivals grow the surface', async ({ page, request }, testInfo) => {
    test.setTimeout(90_000);
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));

    await reset(request);
    await login(page);
    await expect.poll(() => publicTail(page).then((value) => value.mode)).toBe('following');
    await expect.poll(() => publicTail(page).then((value) => value.gap)).toBeLessThanOrEqual(24);

    await startCapture(page);
    const arrivals = [];
    for (let index = 0; index < 6; index += 1) {
      const arrival = await append(request, index);
      arrivals.push(arrival);
      const row = page.locator(`[data-presentation-row-id="${arrival.request_id}"]`);
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(`TC0358 public tail ${index}`);
      await expect.poll(() => publicTail(page).then((value) => value.mode)).toBe('following');
      await expect.poll(() => publicTail(page).then((value) => value.gap)).toBeLessThanOrEqual(24);
    }
    await page.waitForTimeout(500);
    const frames = await stopCapture(page);
    const followingFrames = frames.filter((frame) => frame.mode === 'following');
    const badTailFrames = followingFrames.filter((frame) => frame.gap == null || frame.gap > 24);
    const blankFrames = followingFrames.filter((frame) => frame.visibleRowIDs.length === 0);
    const result = {
      arrivals: arrivals.map((arrival) => ({ requestID: arrival.request_id })),
      totalFrames: frames.length,
      followingFrames: followingFrames.length,
      firstFrame: frames[0] || null,
      lastFrame: frames.at(-1) || null,
      badTailFrames: badTailFrames.slice(0, 10),
      badTailFrameCount: badTailFrames.length,
      blankFrames: blankFrames.slice(0, 10),
      blankFrameCount: blankFrames.length,
      final: await publicTail(page),
      pageErrors,
    };
    await attachJSON(testInfo, 'tc0358-public-tail.json', result);

    expect(pageErrors, JSON.stringify(result)).toEqual([]);
    expect(followingFrames.length, JSON.stringify(result)).toBeGreaterThan(0);
    expect(badTailFrames, JSON.stringify(result)).toEqual([]);
    expect(blankFrames, JSON.stringify(result)).toEqual([]);
    expect(result.final.mode, JSON.stringify(result)).toBe('following');
    expect(result.final.gap, JSON.stringify(result)).toBeLessThanOrEqual(24);
  });
});
