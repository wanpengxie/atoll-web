import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

const OUT = process.env.ATOLL_STAGE2_OUT || '/tmp/q-stage2-atomic-handoff';
const SEED = Number(process.env.ATOLL_UPWARD_SEED || 0x4a_de_37);

async function enterProject(page, request) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'deep-history-delayed', seed: SEED },
  });
  expect(response.ok()).toBe(true);
  await page.setViewportSize({ width: 1120, height: 620 });
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'stage2-atomic-handoff' }));
  await page.getByRole('button', { name: '# c0.project', exact: true }).click();
  await expect(page.locator('main h1')).toHaveText('c0.project');
  await expect(page.locator('.timeline-following-tail [data-presentation-row-id]').last()).toBeVisible();
}

async function armProbe(page) {
  await page.evaluate(() => {
    const events = [];
    const frames = [];
    const rows = (root) => root ? [...root.querySelectorAll('[data-presentation-row-id]')].map((row) => {
      const box = row.getBoundingClientRect();
      const viewport = root.getBoundingClientRect();
      return { id: row.dataset.presentationRowId, top: Number((box.top - viewport.top).toFixed(2)) };
    }) : [];
    const describe = (event) => {
      const root = event.target?.closest?.('.timeline-message-list');
      events.push({
        at: performance.now(),
        type: event.type,
        key: event.key || '',
        deltaY: Number(event.deltaY || 0),
        container: root?.dataset.readingContainer || (root ? 'virtuoso' : ''),
        scrollTop: Number(root?.scrollTop || 0),
      });
    };
    for (const type of ['wheel', 'touchmove', 'keydown', 'keyup', 'scroll']) {
      addEventListener(type, describe, { capture: true, passive: true });
    }
    let running = true;
    const tick = () => {
      if (!running) return;
      const stack = document.querySelector('.timeline-reading-stack');
      const outgoing = document.querySelector('.timeline-reading-layer.is-outgoing .timeline-message-list');
      const active = document.querySelector('.timeline-reading-layer.is-active .timeline-message-list');
      const incoming = document.querySelector('.timeline-reading-layer.is-incoming .timeline-message-list');
      const visible = outgoing || active;
      frames.push({
        at: performance.now(),
        pending: stack?.dataset.handoffPending || '',
        ready: stack?.dataset.handoffReady || '',
        container: visible?.dataset.readingContainer || (visible ? 'virtuoso' : ''),
        scrollTop: Number(visible?.scrollTop || 0),
        rows: rows(visible),
        focused: visible === document.activeElement,
        incoming: incoming ? {
          scrollTop: Number(incoming.scrollTop || 0),
          scrollHeight: Number(incoming.scrollHeight || 0),
          rows: rows(incoming),
        } : null,
      });
      requestAnimationFrame(tick);
    };
    window.__STAGE2_PROBE__ = {
      stop() {
        running = false;
        return {
          events,
          frames,
          trace: window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.() || { entries: [] },
        };
      },
    };
    requestAnimationFrame(tick);
  });
}

function motions(frames) {
  const result = [];
  for (let index = 1; index < frames.length; index += 1) {
    const before = frames[index - 1];
    const after = frames[index];
    const beforeByID = new Map(before.rows.map((row) => [row.id, row.top]));
    const deltas = after.rows.flatMap((row) => (
      beforeByID.has(row.id) ? [Number((row.top - beforeByID.get(row.id)).toFixed(2))] : []
    )).sort((left, right) => left - right);
    if (!deltas.length) continue;
    result.push({
      at: after.at,
      previousContainer: before.container,
      container: after.container,
      shared: deltas.length,
      median: deltas[Math.floor(deltas.length / 2)],
    });
  }
  return result;
}

async function freeze(page, testInfo, name) {
  const evidence = await page.evaluate(() => window.__STAGE2_PROBE__.stop());
  evidence.motion = motions(evidence.frames);
  await mkdir(OUT, { recursive: true });
  const path = resolve(OUT, `${name}-${SEED}.json`);
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  await testInfo.attach(`${name}.json`, { path, contentType: 'application/json' });
  return evidence;
}

test('keyboard stays on the visible owner and transfers focus only with the atomic reveal', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  await enterProject(page, request);
  await armProbe(page);
  const following = page.locator('.timeline-reading-layer.is-active .timeline-following-tail');
  await following.focus();
  await page.keyboard.down('ArrowUp');
  await expect(page.locator('.timeline-reading-stack')).toHaveAttribute('data-handoff-pending', 'true');
  const outgoing = page.locator('.timeline-reading-layer.is-outgoing .timeline-following-tail');
  await expect.poll(() => outgoing.evaluate((node) => document.activeElement === node)).toBe(true);
  await page.keyboard.up('ArrowUp');
  const becameReady = await page.locator('.timeline-reading-stack')
    .waitFor({ state: 'attached', timeout: 10_000 })
    .then(() => page.waitForFunction(() => (
      document.querySelector('.timeline-reading-stack')?.dataset.handoffReady === 'true'
    ), null, { timeout: 1_500 }))
    .then(() => true).catch(() => false);
  if (!becameReady) {
    const evidence = await freeze(page, testInfo, 'keyboard-handoff-red');
    throw new Error(`keyboard handoff did not reveal: ${JSON.stringify(evidence.trace.entries.slice(-20))}`);
  }
  const active = page.locator('.timeline-reading-layer.is-active .timeline-message-list');
  await expect.poll(() => active.evaluate((node) => document.activeElement === node)).toBe(true);
  const before = await active.evaluate((node) => Number(node.scrollTop || 0));
  await page.keyboard.press('PageUp');
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => active.evaluate((node) => Number(node.scrollTop || 0))).toBeLessThan(before);
  await expect.poll(() => active.evaluate((node) => document.activeElement === node)).toBe(true);
  await page.waitForTimeout(200);

  const evidence = await freeze(page, testInfo, 'keyboard-handoff');
  const reveal = evidence.motion.find((entry) => (
    entry.previousContainer === 'following-tail' && entry.container === 'virtuoso'
  ));
  const reverse = evidence.motion.filter((entry) => entry.median < -2);
  const keyBegins = evidence.trace.entries.filter((entry) => (
    entry.event === 'reading.input-owner'
      && entry.detail?.source === 'key'
      && entry.detail?.reason === 'begin'
  ));
  expect(evidence.frames.some((frame) => frame.pending === 'true' && frame.container === 'following-tail')).toBe(true);
  expect(reveal?.shared || 0).toBeGreaterThan(0);
  expect(Math.abs(Number(reveal?.median || 0))).toBeLessThanOrEqual(2);
  expect(reverse, JSON.stringify(reverse, null, 2)).toEqual([]);
  // The first key is represented by the exact Following navigation target;
  // the two post-reveal keys are ordinary browsing input-owner transactions.
  expect(keyBegins.length).toBeGreaterThanOrEqual(2);
  expect(evidence.frames.at(-1)?.ready).toBe('true');
  expect(evidence.frames.at(-1)?.container).toBe('virtuoso');
  expect(evidence.frames.at(-1)?.focused).toBe(true);
});
