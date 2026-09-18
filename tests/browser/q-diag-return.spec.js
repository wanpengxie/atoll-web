import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// Throwaway diagnostic (Q): does ordinary wheel-down-to-bottom return the
// session to following? Run with the following container ON and OFF to tell a
// regression from a pre-existing behaviour.
const OUT = process.env.ATOLL_Q_OUT || '/tmp/Q-05142523-out/diag';
const LABEL = process.env.ATOLL_Q_LABEL || 'with-following-tail';

test('wheel back to the tail returns to following', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1120, height: 620 });
  expect((await request.post(`${MOCK}/mock/control/reset`, { data: { scenario: 'long-running-history', seed: 0x51_09_18 } })).ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.locator('.timeline-message-list [data-presentation-row-id]').last()).toBeVisible();
  await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.reading?.enable?.({ case: 'q-diag-return' }));

  for (let index = 0; index < 12; index += 1) {
    expect((await request.post(`${MOCK}/mock/control/action`, { data: {
      type: 'q_tail_append', channel_id: 'c0', ask: `diag fixture ${index}`,
      text: `diag ${index} ${'mixed-height content '.repeat((index % 5 + 1) * 8)}`,
    } })).ok()).toBe(true);
  }
  await page.waitForTimeout(1_000);

  const geo = () => page.evaluate(() => {
    const root = document.querySelector('.timeline-message-list');
    return {
      container: root.dataset.readingContainer || 'virtuoso',
      mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
      scrollTop: Number(root.scrollTop.toFixed(2)),
      scrollHeight: Number(root.scrollHeight.toFixed(2)),
      clientHeight: Number(root.clientHeight.toFixed(2)),
      gap: Number((root.scrollHeight - root.clientHeight - root.scrollTop).toFixed(2)),
      rows: root.querySelectorAll('[data-presentation-row-id]').length,
    };
  });

  const start = await geo();
  await page.mouse.move(560, 300);
  await page.mouse.wheel(0, -260);
  await page.waitForTimeout(500);
  const up = await geo();
  const upTrace = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.() || { entries: [] });
  const handoff = [...upTrace.entries].reverse().find((entry) => entry.event === 'reading.following-handoff')?.detail || null;
  const anchorAfter = await page.evaluate((messageID) => {
    const root = document.querySelector('.timeline-message-list');
    const node = [...root.querySelectorAll('[data-presentation-row-id]')]
      .find((candidate) => candidate.dataset.presentationRowId === messageID);
    if (!root || !node) return null;
    return Number((node.getBoundingClientRect().top - root.getBoundingClientRect().top).toFixed(2));
  }, handoff?.bookmark?.messageID || '');

  const steps = [];
  for (let push = 0; push < 14; push += 1) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(90);
    steps.push(await geo());
  }
  await page.waitForTimeout(800);
  const end = await geo();
  const trace = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.() || { entries: [] });

  const report = {
    label: LABEL, start, up, handoff, anchorAfter, steps, end,
    upTrace: upTrace.entries.map((entry) => ({ sequence: entry.sequence, event: entry.event, detail: entry.detail })),
    trace: trace.entries.slice(-90).map((entry) => ({ sequence: entry.sequence, event: entry.event, detail: entry.detail })),
  };
  const path = resolve(OUT, `${LABEL}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2));
  await testInfo.attach(`${LABEL}.json`, { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  console.log(LABEL, 'start', JSON.stringify(start), 'up', JSON.stringify(up), 'end', JSON.stringify(end));
  expect(end.mode).toBe('following');
});
