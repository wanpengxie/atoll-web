import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// User report (2026-09-18):
//   (1) scrolling to the top of history gets stuck and stops loading;
//   (2) after a fast top -> bottom round trip, messages look lost.
// This spec drives the production entry (App -> Timeline -> MessageList) on a
// long mixed-height ledger with rapid native wheel input and records evidence
// per step. The default gate is deliberately only the normal 120-turn,
// no-injected-delay contract: huge-history and transport-delay variants need a
// separately budgeted slow contract and are not selected by this test.

const SCENARIO = 'mixed-height-history';
const SEED = Number(process.env.ATOLL_TB_SEED || 1918);
const UP_STEPS = Number(process.env.ATOLL_TB_UP_STEPS || 400);
const TOTAL_TURNS = 120;
const NEWEST = `c0 history ${TOTAL_TURNS}: ask steward for PONG`;
// Consecutive wheel steps at scrollTop<=1 with no older turn arriving and no
// "channel start" chip. ~60 steps is >1.5s of continuous user input.
const STUCK_STEPS = 60;

// Every worker shares one working tree with the rest of the fleet, so another
// agent saving a file can make the dev server reload this page mid-run. That
// invalidates the evidence without being a product defect, so count it and
// say so instead of letting it masquerade as a blank viewport.
const reloadRecords = new WeakMap();

test.beforeEach(async ({ page }) => {
  reloadRecords.set(page, []);
});

// Sample the DOM, surviving a reload that destroys the execution context.
async function sample(page) {
  try {
    return await page.evaluate(sampleScript);
  } catch (error) {
    if (!/Execution context was destroyed|Target (page|closed)/.test(String(error?.message || ''))) throw error;
    return { missing: true, at: 0, turns: [], contextLost: true };
  }
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
}

function sampleScript() {
  const node = document.querySelector('.timeline-message-list');
  // A vanished list root is itself evidence ("messages look lost"), so report
  // it as a sample instead of throwing the run away.
  if (!node) return { missing: true, at: Math.round(performance.now()), turns: [] };
  const rootRect = node.getBoundingClientRect();
  const rows = [...node.querySelectorAll('[data-presentation-row-id]')].map((row) => {
    const rect = row.getBoundingClientRect();
    return {
      id: row.dataset.presentationRowId || '',
      top: Math.round(rect.top - rootRect.top),
      bottom: Math.round(rect.bottom - rootRect.top),
      text: (row.textContent || '').slice(0, 48),
    };
  }).sort((a, b) => a.top - b.top);
  const visible = rows.filter((row) => row.bottom > 0 && row.top < node.clientHeight);
  // Gap detection inside the viewport: any vertical band >= 48px with no row
  // is an "empty hole" the user perceives as missing messages.
  let cursor = 0;
  let maxGap = 0;
  for (const row of visible) {
    if (row.top - cursor > maxGap) maxGap = row.top - cursor;
    cursor = Math.max(cursor, row.bottom);
  }
  if (node.clientHeight - cursor > maxGap) maxGap = node.clientHeight - cursor;
  // The row text is a presentation of the user's content, but it also starts
  // with the row action labels (复制 / 回复 / 查看过程).  Parsing only the
  // first 48 characters therefore stopped seeing `history N:` as soon as the
  // current production row action chrome was mounted.  The presentation row
  // id is the production identity contract and remains stable through
  // virtualization/recycling; seeded history request ids carry the turn
  // number without depending on incidental text order.
  const turns = rows.map((row) => Number(row.id.match(/(?:^|-)history-request-(\d+)$/)?.[1] || 0)).filter(Boolean);
  const demand = document.querySelector('.timeline-history-demand');
  const status = document.querySelector('.timeline-history-status');
  return {
    missing: false,
    at: Math.round(performance.now()),
    scrollTop: Math.round(node.scrollTop),
    scrollHeight: Math.round(node.scrollHeight),
    clientHeight: Math.round(node.clientHeight),
    materialized: rows.length,
    visibleCount: visible.length,
    firstVisible: visible[0]?.text || '',
    lastVisible: visible.at(-1)?.text || '',
    maxGap,
    demandPhase: demand?.dataset.phase || 'idle',
    demandText: (demand?.textContent || status?.textContent || '').slice(0, 40),
    oldestTurn: turns.length ? Math.min(...turns) : 0,
    newestTurn: turns.length ? Math.max(...turns) : 0,
    turns,
  };
}

async function rapidWheel(page, viewport, { deltaY, steps, waitMs, stopWhen }) {
  const samples = [];
  await viewport.hover();
  for (let step = 0; step < steps; step += 1) {
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(waitMs);
    const observed = await sample(page);
    const { turns, ...rest } = observed;
    samples.push({ step, ...rest });
    if (!observed.missing && stopWhen(observed, samples)) break;
  }
  return samples;
}

// Consecutive frames where the viewport holds no row at all. One such frame
// can be an honest remount; a run of them is the user's "messages are gone".
function blankRuns(phases) {
  const runs = [];
  for (const [phase, samples] of phases) {
    let run = null;
    for (const s of samples) {
      const blank = s.missing === true || s.visibleCount === 0;
      if (blank) run = run ? { ...run, length: run.length + 1 } : { phase, fromStep: s.step ?? -1, length: 1 };
      else {
        if (run && run.length >= 3) runs.push(run);
        run = null;
      }
    }
    if (run && run.length >= 3) runs.push(run);
  }
  return runs;
}

// Longest run of consecutive upward steps parked at the physical top where
// the oldest materialized turn never changed and no channel-start chip
// appeared: that is what "stuck at the top, no more loading" looks like.
function stuckRuns(samples) {
  const runs = [];
  let run = null;
  for (const s of samples) {
    if (s.missing) { run = null; continue; }
    const parked = s.scrollTop <= 1 && s.demandPhase !== 'exhausted';
    if (parked && run && run.oldestTurn === s.oldestTurn) run.length += 1;
    else {
      if (run && run.length >= STUCK_STEPS) runs.push(run);
      run = parked ? { fromStep: s.step, oldestTurn: s.oldestTurn, demandPhase: s.demandPhase, length: 1 } : null;
    }
  }
  if (run && run.length >= STUCK_STEPS) runs.push(run);
  return runs;
}

test(`rapid top->bottom round trip on ${SCENARIO} keeps history loading and keeps every message reachable`, async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const reset = await request.post('/mock/control/reset', { data: { scenario: SCENARIO, seed: SEED } });
  expect(reset.ok()).toBe(true);
  await login(page);
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) reloadRecords.get(page)?.push(Date.now());
  });
  await expect(page.getByText(NEWEST, { exact: true })).toBeVisible();
  const viewport = page.locator('.timeline-message-list');
  await expect.poll(() => viewport.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('00-start-tail.png') });

  // Phase 1: hammer the wheel upwards. Stop only when the oldest turn is in
  // the DOM at scrollTop<=1, or after the step budget (that is the "stuck").
  const upward = await rapidWheel(page, viewport, {
    deltaY: -2_400,
    steps: UP_STEPS,
    waitMs: 16,
    stopWhen: (s) => s && s.oldestTurn === 1 && s.scrollTop <= 1,
  });
  const oldestReached = Math.min(...upward.map((s) => (s.missing ? Infinity : s.oldestTurn || Infinity)));
  await page.screenshot({ path: testInfo.outputPath('01-after-upward.png') });
  // Give the pipeline a quiet window with no input. If the user is at the top
  // and history is still owed, this is where "stuck, no more loading" shows.
  const quietBefore = await sample(page);
  await page.waitForTimeout(1_500);
  const quietAfter = await sample(page);
  await page.screenshot({ path: testInfo.outputPath('02-after-quiet.png') });

  // Phase 2: hammer the wheel downwards back to the tail.
  const downward = await rapidWheel(page, viewport, {
    deltaY: 2_400,
    steps: 400,
    waitMs: 16,
    stopWhen: (s) => s && s.newestTurn === TOTAL_TURNS && s.scrollHeight - s.clientHeight - s.scrollTop <= 2,
  });
  await page.screenshot({ path: testInfo.outputPath('03-after-downward.png') });
  await page.waitForTimeout(600);
  const settledBottom = await sample(page);
  await page.screenshot({ path: testInfo.outputPath('04-bottom-settled.png') });

  // Phase 3: walk from bottom back up to the oldest turn phase 1 reached and
  // count every distinct turn the DOM ever materialized. Every turn in that
  // window must still be reachable after the round trip.
  const seen = new Set();
  const walk = [];
  await viewport.hover();
  for (let step = 0; step < 1_500; step += 1) {
    const observed = await sample(page);
    for (const turn of observed.turns) seen.add(turn);
    const { turns, ...rest } = observed;
    walk.push(rest);
    // Walk until the scroller is physically back at its top AND the oldest
    // turn phase 1 reached is materialized again. The earlier form short-cut
    // on `oldestReached > 1` and therefore exited on step 0 of every deep
    // ledger, which is exactly the run where "messages look lost" lives.
    // A frame with nothing in the viewport is not an arrival: stopping there
    // would report every turn above it as unreachable for the wrong reason.
    if (!observed.missing && observed.visibleCount > 0
      && observed.oldestTurn <= oldestReached && observed.scrollTop <= 1) break;
    await page.mouse.wheel(0, -700);
    await page.waitForTimeout(24);
  }
  const missingTurns = [];
  for (let turn = oldestReached; turn <= TOTAL_TURNS; turn += 1) if (!seen.has(turn)) missingTurns.push(turn);

  const reloads = reloadRecords.get(page) || [];
  const evidence = {
    scenario: SCENARIO,
    seed: SEED,
    upward,
    quietBefore,
    quietAfter,
    downward,
    settledBottom,
    oldestReached,
    walkSteps: walk.length,
    walkTail: walk.slice(-5),
    seenTurnCount: seen.size,
    missingTurns,
    reloadsDuringRun: reloads.length,
  };
  const artifactPath = testInfo.outputPath('top-bottom-rapid-evidence.json');
  await writeFile(artifactPath, JSON.stringify(evidence, null, 2));
  await testInfo.attach('top-bottom-rapid-evidence.json', { path: artifactPath, contentType: 'application/json' });

  const stuck = stuckRuns(upward);
  const blank = blankRuns([['upward', upward], ['downward', downward], ['walk', walk]]);
  const missingRootFrames = [...upward, ...downward, ...walk].filter((s) => s.missing).length;
  const summary = {
    scenario: SCENARIO,
    missingRootFrames,
    upwardSteps: upward.length,
    oldestReached,
    stuck,
    blank,
    quiet: { before: quietBefore, after: quietAfter },
    downwardSteps: downward.length,
    settledBottom,
    missingTurns,
    reloadsDuringRun: reloads.length,
  };
  console.log(`[top-bottom-rapid] ${JSON.stringify(summary)}`);

  // Environment gate, checked before any product assertion: a page the dev
  // server reloaded mid-run produces blank frames and lost turns that say
  // nothing about the product. Fail loudly and distinctly instead.
  expect(
    reloads.length,
    `dev server reloaded the page ${reloads.length}x mid-run (shared working tree); evidence invalid, re-run`,
  ).toBe(0);

  // (1) Top must not get stuck: the oldest turn is reached and the loading
  // status is not left hanging once nothing is owed.
  expect(stuck, `stuck at top: ${JSON.stringify(stuck)}`).toEqual([]);
  if (UP_STEPS >= 400 && TOTAL_TURNS <= 200) expect(oldestReached, `did not reach oldest turn; last=${JSON.stringify(upward.at(-1))}`).toBe(1);
  expect(['idle', 'exhausted'], `history demand still ${quietAfter.demandPhase} after quiet window`).toContain(quietAfter.demandPhase);
  // (2) Bottom must be the real tail with no blank band inside the viewport
  // and nothing lost on the way back.
  expect(settledBottom.newestTurn, JSON.stringify(settledBottom)).toBe(TOTAL_TURNS);
  expect(settledBottom.scrollHeight - settledBottom.clientHeight - settledBottom.scrollTop).toBeLessThanOrEqual(24);
  expect(settledBottom.visibleCount, JSON.stringify(settledBottom)).toBeGreaterThan(0);
  expect(settledBottom.maxGap, `blank band of ${settledBottom.maxGap}px in viewport at bottom`).toBeLessThan(96);
  const blankDown = downward.filter((s) => s.visibleCount === 0 || s.maxGap >= s.clientHeight * 0.5);
  expect(blankDown, `blank viewport frames while scrolling down: ${JSON.stringify(blankDown.slice(0, 5))}`).toEqual([]);
  expect(missingTurns, 'history turns unreachable after round trip').toEqual([]);
  expect(blank, `viewport held no row for consecutive frames: ${JSON.stringify(blank)}`).toEqual([]);
  expect(missingRootFrames, 'message list root disappeared mid-scroll').toBe(0);
});
