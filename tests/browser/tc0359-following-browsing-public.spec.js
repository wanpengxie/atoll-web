import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';
import { READING_OWNER_SELECTOR } from './reading-owner.js';

const SEED = 0x35_09_22;
const TAIL_DISTANCE = 24;

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
  const marker = `TC0359 seed tail ${index}`;
  const text = [
    marker,
    '',
    `A rendered handoff row ${index}. `.repeat(2 + (index % 4)),
    '',
    ...Array.from({ length: 4 + (index % 5) }, (_, line) => `handoff content ${index}.${line + 1}`),
  ].join('\n');
  const response = await request.post(`${MOCK}/mock/control/action`, {
    data: {
      type: 'q_tail_append',
      channel_id: 'c0',
      ask: marker,
      text,
    },
  });
  expect(response.ok()).toBe(true);
  return { ...(await response.json()), marker };
}

async function publicState(page) {
  return page.locator(READING_OWNER_SELECTOR).evaluate((node) => ({
    mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
    gap: node.dataset.readingContainer === 'following-tail'
      ? Math.abs(Number(node.scrollTop || 0))
      : Math.max(0, Number(node.scrollHeight || 0) - Number(node.clientHeight || 0) - Number(node.scrollTop || 0)),
    rowCount: node.querySelectorAll('[data-presentation-row-id]').length,
    focused: document.activeElement === node,
  }));
}

async function startCapture(page) {
  await page.evaluate((selector) => {
    const state = { active: true, startedAt: performance.now(), frames: [] };
    const rowsVisibleAndHitTestable = (owner, ownerRect) => [...owner.querySelectorAll('[data-presentation-row-id]')]
      .filter((row) => {
        const rect = row.getBoundingClientRect();
        if (rect.bottom <= ownerRect.top + 1 || rect.top >= ownerRect.bottom - 1) return false;
        const x = Math.min(ownerRect.right - 1, Math.max(ownerRect.left + 1, (rect.left + rect.right) / 2));
        const y = Math.min(ownerRect.bottom - 1, Math.max(ownerRect.top + 1, (Math.max(rect.top, ownerRect.top) + Math.min(rect.bottom, ownerRect.bottom)) / 2));
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && (hit === row || row.contains(hit)));
      })
      .map((row) => row.dataset.presentationRowId || '')
      .filter(Boolean);
    const tick = () => {
      if (!state.active) return;
      const owner = document.querySelector(selector);
      const ownerRect = owner?.getBoundingClientRect();
      const mode = document.querySelector('.timeline')?.dataset.viewportMode || '';
      const gap = owner
        ? owner.dataset.readingContainer === 'following-tail'
          ? Math.abs(Number(owner.scrollTop || 0))
          : Math.max(0, Number(owner.scrollHeight || 0) - Number(owner.clientHeight || 0) - Number(owner.scrollTop || 0))
        : null;
      state.frames.push({
        elapsedMs: Math.round(performance.now() - state.startedAt),
        mode,
        ownerCount: document.querySelectorAll(selector).length,
        gap: gap == null ? null : Number(gap.toFixed(2)),
        rowCount: owner ? owner.querySelectorAll('[data-presentation-row-id]').length : 0,
        visibleRowIDs: owner && ownerRect ? rowsVisibleAndHitTestable(owner, ownerRect) : [],
        focused: Boolean(owner && document.activeElement === owner),
      });
      requestAnimationFrame(tick);
    };
    window.__TC0359_PUBLIC_CAPTURE__ = state;
    requestAnimationFrame(tick);
  }, READING_OWNER_SELECTOR);
}

async function stopCapture(page) {
  return page.evaluate(() => {
    const state = window.__TC0359_PUBLIC_CAPTURE__;
    if (!state) return [];
    state.active = false;
    return state.frames;
  });
}

test.describe('TC0359 public following↔browsing handoff', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1120, height: 620 });
  });

  test('ten ordinary wheel handoffs keep a non-empty surface and return to tail', async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));

    await reset(request);
    await login(page);
    await expect.poll(() => publicState(page).then((value) => value.mode)).toBe('following');
    await expect.poll(() => publicState(page).then((value) => value.gap)).toBeLessThanOrEqual(TAIL_DISTANCE);

    const arrivals = [];
    for (let index = 0; index < 12; index += 1) {
      const arrival = await append(request, index);
      arrivals.push(arrival);
      await expect(page.locator(`[data-presentation-row-id="${arrival.request_id}"]`)).toHaveCount(1);
    }
    const latest = arrivals.at(-1);
    const latestRow = page.locator(`[data-presentation-row-id="${latest.request_id}"]`);
    await expect(latestRow).toContainText(latest.marker);
    await expect.poll(() => publicState(page).then((value) => value.mode)).toBe('following');
    await expect.poll(() => publicState(page).then((value) => value.gap)).toBeLessThanOrEqual(TAIL_DISTANCE);
    await page.waitForTimeout(300);

    await startCapture(page);
    const rounds = [];
    const viewport = page.locator(READING_OWNER_SELECTOR);
    for (let round = 0; round < 10; round += 1) {
      await viewport.focus();
      await viewport.hover();
      await page.mouse.move(560, 300);
      await page.mouse.wheel(0, -260);
      await expect.poll(() => publicState(page).then((value) => value.mode)).toBe('browsing');
      await expect.poll(() => publicState(page).then((value) => value.rowCount)).toBeGreaterThan(0);
      const browsing = await publicState(page);

      let pushes = 0;
      for (; pushes < 32; pushes += 1) {
        await page.mouse.wheel(0, 400);
        await page.waitForTimeout(60);
        if ((await publicState(page)).mode === 'following') break;
      }
      await expect.poll(() => publicState(page).then((value) => value.mode), { timeout: 10_000 }).toBe('following');
      await expect.poll(() => publicState(page).then((value) => value.gap)).toBeLessThanOrEqual(TAIL_DISTANCE);
      await expect(latestRow).toBeVisible();
      const following = await publicState(page);
      rounds.push({ round, browsing, following, pushes: pushes + 1 });
      await page.waitForTimeout(120);
    }
    const frames = await stopCapture(page);
    const nonEmptyFrames = frames.filter((frame) => frame.ownerCount === 1 && frame.visibleRowIDs.length > 0);
    const blankFrames = frames.filter((frame) => frame.ownerCount !== 1 || frame.visibleRowIDs.length === 0);
    const badFollowingFrames = frames.filter((frame) => frame.mode === 'following' && (frame.gap == null || frame.gap > TAIL_DISTANCE));
    const result = {
      arrivalCount: arrivals.length,
      latestRequestID: latest.request_id,
      rounds,
      totalFrames: frames.length,
      nonEmptyFrames: nonEmptyFrames.length,
      blankFrames: blankFrames.slice(0, 12),
      blankFrameCount: blankFrames.length,
      badFollowingFrames: badFollowingFrames.slice(0, 12),
      badFollowingFrameCount: badFollowingFrames.length,
      final: await publicState(page),
      pageErrors,
    };
    await attachJSON(testInfo, 'tc0359-public-handoff.json', result);

    expect(pageErrors, JSON.stringify(result)).toEqual([]);
    expect(rounds, JSON.stringify(result)).toHaveLength(10);
    expect(rounds.every((round) => round.browsing.mode === 'browsing'), JSON.stringify(result)).toBe(true);
    expect(rounds.every((round) => round.following.mode === 'following'), JSON.stringify(result)).toBe(true);
    expect(rounds.every((round) => round.following.gap <= TAIL_DISTANCE), JSON.stringify(result)).toBe(true);
    expect(blankFrames, JSON.stringify(result)).toEqual([]);
    expect(badFollowingFrames, JSON.stringify(result)).toEqual([]);
    expect(nonEmptyFrames.length, JSON.stringify(result)).toBeGreaterThan(0);
    expect(result.final.mode, JSON.stringify(result)).toBe('following');
    expect(result.final.gap, JSON.stringify(result)).toBeLessThanOrEqual(TAIL_DISTANCE);
  });
});
