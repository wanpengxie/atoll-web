import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';
import { installReadingOwnerHelper } from './reading-owner.js';

// Agent Q. Frame-by-frame acceptance of the ruling "following = plain DOM tail
// window + flex-direction: column-reverse".
//
// The claim under test is structural, so the test is structural too:
//
//   1. EVERY frame, in every following-mode scenario, the viewport is at the
//      tail. Not "ends up at the tail" — every single frame. Two independent
//      witnesses are recorded per frame so the claim cannot be satisfied by the
//      definition of one of them:
//        scrollGap  = -scrollTop            (column-reverse: 0 == at tail)
//        visualGap  = root.bottom - content.bottom   (pure geometry, no scroll)
//   2. ZERO application scroll writes. Every scroll entry point is patched
//      before the app boots and every call is recorded with its stack. The
//      following container is supposed to contain no writer at all, so any
//      entry attributed to it is a failure, not a tolerance.
//
// Nothing here waits on a timer for a state to become true. Timeouts are
// recording windows; every assertion reads a recorded value.

const OUT = process.env.ATOLL_Q_OUT || '/tmp/Q-05142523-out/frames';
const SEED = 0x51_09_18;

async function dump(name, value) {
  const path = resolve(OUT, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
  return path;
}

async function installWriteInterceptor(page) {
  await page.addInitScript(() => {
    const writes = [];
    const describe = (node) => {
      if (!node || node.nodeType !== 1) return String(node);
      const classes = String(node.className || '');
      return `${node.tagName.toLowerCase()}${classes ? `.${classes.trim().split(/\s+/).join('.')}` : ''}`;
    };
    const stackOf = () => String(new Error('write').stack || '').split('\n').slice(2, 12).join('\n');
    const record = (kind, node, detail) => {
      writes.push({
        index: writes.length,
        at: performance.now(),
        kind,
        node: describe(node),
        phase: window.__qPhase || '',
        isList: Boolean(node?.classList?.contains?.('timeline-message-list')),
        inList: Boolean(node?.closest?.('.timeline-message-list')),
        followingContainer: Boolean(node?.closest?.('[data-reading-container="following-tail"]')
          || node?.dataset?.readingContainer === 'following-tail'),
        detail,
        stack: stackOf(),
      });
    };
    for (const name of ['scrollTo', 'scroll', 'scrollBy']) {
      const original = Element.prototype[name];
      Element.prototype[name] = function patched(...args) {
        const options = typeof args[0] === 'object' && args[0] !== null ? args[0] : { top: args[1] };
        record(name, this, { top: Number(options?.top ?? NaN), before: Number(this.scrollTop || 0) });
        return original.apply(this, args);
      };
    }
    const intoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function patched(...args) {
      record('scrollIntoView', this, { arg: JSON.stringify(args[0] ?? null) });
      return intoView.apply(this, args);
    };
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() { return descriptor.get.call(this); },
      set(value) {
        record('scrollTop-set', this, { top: Number(value), before: Number(descriptor.get.call(this) || 0) });
        return descriptor.set.call(this, value);
      },
    });
    window.__qWrites = {
      all: () => writes,
      count: () => writes.length,
      since: (from) => writes.slice(from),
    };
    window.__qPhase = 'boot';
  });
}

// One rAF sampler for the whole run. It only reads, and it reads the two
// independent witnesses plus enough context to name the frame that broke.
async function armFrames(page) {
  await page.evaluate(() => {
    const frames = [];
    let stopped = false;
    const read = () => {
      const owners = window.__ATOLL_TEST_READING_OWNER__.nodes();
      const root = owners.length === 1 ? owners[0] : null;
      if (!root) return { container: 'none', ownerCount: owners.length };
      const container = root.dataset.readingContainer || 'virtuoso';
      const rootRect = root.getBoundingClientRect();
      const scrollTop = Number(root.scrollTop || 0);
      const scrollHeight = Number(root.scrollHeight || 0);
      const clientHeight = Number(root.clientHeight || 0);
      const content = root.querySelector('.timeline-following-tail-content');
      const rowNodes = root.querySelectorAll('[data-presentation-row-id]');
      const lastRow = rowNodes[rowNodes.length - 1] || null;
      return {
        ownerCount: owners.length,
        container,
        scrollTop: Number(scrollTop.toFixed(2)),
        scrollHeight: Number(scrollHeight.toFixed(2)),
        clientHeight: Number(clientHeight.toFixed(2)),
        // Column-reverse puts the origin at the bottom: 0 IS the tail.
        scrollGap: container === 'following-tail'
          ? Number((-scrollTop).toFixed(2))
          : Number((scrollHeight - clientHeight - scrollTop).toFixed(2)),
        // Independent witness: where the content box actually ends relative to
        // the viewport box. Needs no knowledge of the scroll convention.
        visualGap: content
          ? Number((rootRect.bottom - content.getBoundingClientRect().bottom).toFixed(2))
          : null,
        lastRowToBottom: lastRow
          ? Number((rootRect.bottom - lastRow.getBoundingClientRect().bottom).toFixed(2))
          : null,
        rows: rowNodes.length,
        waiting: document.querySelectorAll('.agent-wait-item').length,
        inputHeight: Number((document.querySelector('.conversation-bottom-stack')
          ?.getBoundingClientRect().height || 0).toFixed(1)),
      };
    };
    const tick = () => {
      if (stopped) return;
      frames.push({ frame: frames.length, at: Number(performance.now().toFixed(1)), phase: window.__qPhase || '', writes: window.__qWrites.count(), ...read() });
      if (frames.length < 40_000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__qFrames = { stop() { stopped = true; return frames; }, peek: () => frames.length };
  });
}

const phase = (page, name) => page.evaluate((value) => { window.__qPhase = value; }, name);

async function reset(request, scenario = 'long-running-history') {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed: SEED } });
  expect(response.ok()).toBe(true);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
  await expect(page.locator('.timeline-message-list [data-presentation-row-id]').last()).toBeVisible();
}

async function chooseSteward(page) {
  const choose = page.getByRole('button', { name: '选择 Agent' });
  if (!await choose.isVisible().catch(() => false)) return;
  await choose.click();
  await page.getByRole('menu', { name: '选择目标 Agent' })
    .getByRole('menuitem', { name: 'steward' }).click();
}

const append = (request, data) => request.post(`${MOCK}/mock/control/action`, {
  data: { type: 'q_tail_append', channel_id: 'c0', ...data },
});

// Mixed heights on purpose: one-liners, paragraphs, lists and a long block.
function liveText(index) {
  if (index % 5 === 0) return `live ${index} 短`;
  if (index % 5 === 1) return `live ${index} ${'中等长度的一段回答，'.repeat(3)}`;
  if (index % 5 === 2) return `live ${index}\n\n- 一\n- 二\n- 三\n- 四`;
  if (index % 5 === 3) return `live ${index} ${'这是一段明显更长的回答，用来制造不同的行高。'.repeat(8)}`;
  return `live ${index}\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |`;
}

test.describe('Q following tail: structural bottom', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1120, height: 620 });
    await installReadingOwnerHelper(page);
  });

  test('every following frame is at the tail and no app write touches the scroller', async ({ page, request }, testInfo) => {
    test.setTimeout(180_000);
    await installWriteInterceptor(page);
    await reset(request);
    await login(page);
    await chooseSteward(page);

    const container = await page.evaluate(() => document
      .querySelector('.timeline-message-list')?.dataset.readingContainer || 'virtuoso');
    expect(container, '入场应当是跟随态，挂的必须是 FollowingTailList').toBe('following-tail');

    await armFrames(page);
    const marks = [];
    const mark = async (name) => {
      await phase(page, name);
      marks.push({ name, frame: await page.evaluate(() => window.__qFrames.peek()) });
    };

    // (a) typing grows the fixed Composer overlay. The reading viewport must
    // stay fixed; only the overlay is allowed to change height.
    await mark('a-typing');
    const composer = page.getByTestId('composer-input');
    await composer.click();
    for (let line = 0; line < 6; line += 1) {
      await composer.pressSequentially(`第 ${line} 行，输入栈会因此长高。`, { delay: 8 });
      await page.keyboard.press('Shift+Enter');
    }
    await page.waitForTimeout(400);

    // (b) send: the input stack collapses and a local echo lands at the tail.
    await mark('b-send');
    await page.getByRole('button', { name: /发送/ }).click();
    await expect(page.getByText('第 0 行，输入栈会因此长高。').first()).toBeVisible();
    await page.waitForTimeout(600);

    // (c) twenty consecutive live arrivals of mixed height.
    await mark('c-live-append');
    for (let index = 0; index < 20; index += 1) {
      await append(request, { ask: `live ask ${index}`, text: liveText(index) });
      await page.waitForTimeout(90);
    }
    await page.waitForTimeout(400);

    // (d) the tail turn's own body grows: real production compute path.
    await mark('d-tail-stream');
    await composer.click();
    await composer.pressSequentially('请给我一个较长的回答用来观察尾行增长', { delay: 5 });
    await page.getByRole('button', { name: /发送/ }).click();
    await page.waitForTimeout(400);
    for (let step = 0; step < 4; step += 1) {
      await request.post(`${MOCK}/mock/control/advance`, { data: { ms: 0, compute: { channel_id: 'c0' } } });
      await page.waitForTimeout(260);
    }
    await page.waitForTimeout(400);

    // (e) a waiting task enters and then leaves the reserve. This must be the
    // production path: a synthetic ledger row without a local send intent never
    // reaches the Waiting dock, so driving it that way would record an empty
    // reserve and prove nothing (first run did exactly that — see Q.md).
    await mark('e-waiting-in');
    await composer.click();
    await composer.pressSequentially('等待区任务进出验收', { delay: 5 });
    await page.getByRole('button', { name: /发送/ }).click();
    await expect(page.locator('.agent-wait-item')).toHaveCount(1);
    await page.waitForTimeout(700);
    await mark('e-waiting-out');
    for (let step = 0; step < 4; step += 1) {
      await request.post(`${MOCK}/mock/control/advance`, { data: { ms: 0, compute: { channel_id: 'c0' } } });
      await page.waitForTimeout(260);
    }
    await expect(page.locator('.agent-wait-item')).toHaveCount(0);
    await page.waitForTimeout(700);

    // (f) rich content whose real height resolves after first paint.
    await mark('f-late-media');
    await append(request, {
      ask: '富内容',
      text: [
        '晚加载验收：',
        '',
        '![slow](/mock/asset/slow.svg?delay=700)',
        '',
        '```js',
        'const structural = true;',
        'for (let i = 0; i < 12; i += 1) console.log(i, structural);',
        '```',
        '',
        '```mermaid',
        'graph TD;A[开始]-->B[测量];B-->C[提交];C-->D[结束];',
        '```',
      ].join('\n'),
    });
    await page.waitForTimeout(3_000);
    await mark('settled');
    await page.waitForTimeout(600);

    const frames = await page.evaluate(() => window.__qFrames.stop());
    const writes = await page.evaluate(() => window.__qWrites.all());

    const following = frames.filter((entry) => entry.container === 'following-tail');
    const invalidOwners = frames.filter((entry) => entry.ownerCount !== 1);
    const bad = following.filter((entry) => Math.abs(entry.scrollGap) > 0.5
      || (entry.visualGap != null && Math.abs(entry.visualGap) > 0.5));
    const listWrites = writes.filter((entry) => entry.inList || entry.isList);

    // Each case must actually have perturbed the layout, or the frame evidence
    // for it is vacuous. Height range per phase proves the case did something.
    const perPhase = {};
    for (const entry of following) {
      const bucket = perPhase[entry.phase] || (perPhase[entry.phase] = {
        frames: 0, minHeight: Infinity, maxHeight: -Infinity, minClient: Infinity, maxClient: -Infinity,
        minRows: Infinity, maxRows: -Infinity, maxScrollGap: 0, maxVisualGap: 0,
        minInput: Infinity, maxInput: -Infinity,
        minWaiting: Infinity, maxWaiting: -Infinity, minTailToBottom: Infinity, maxTailToBottom: -Infinity,
      });
      bucket.frames += 1;
      bucket.minHeight = Math.min(bucket.minHeight, entry.scrollHeight);
      bucket.maxHeight = Math.max(bucket.maxHeight, entry.scrollHeight);
      bucket.minClient = Math.min(bucket.minClient, entry.clientHeight);
      bucket.maxClient = Math.max(bucket.maxClient, entry.clientHeight);
      bucket.minRows = Math.min(bucket.minRows, entry.rows);
      bucket.maxRows = Math.max(bucket.maxRows, entry.rows);
      bucket.maxScrollGap = Math.max(bucket.maxScrollGap, Math.abs(entry.scrollGap));
      bucket.maxVisualGap = Math.max(bucket.maxVisualGap, Math.abs(entry.visualGap ?? 0));
      bucket.minInput = Math.min(bucket.minInput, entry.inputHeight);
      bucket.maxInput = Math.max(bucket.maxInput, entry.inputHeight);
      bucket.minWaiting = Math.min(bucket.minWaiting, entry.waiting);
      bucket.maxWaiting = Math.max(bucket.maxWaiting, entry.waiting);
      if (entry.lastRowToBottom != null) {
        bucket.minTailToBottom = Math.min(bucket.minTailToBottom, entry.lastRowToBottom);
        bucket.maxTailToBottom = Math.max(bucket.maxTailToBottom, entry.lastRowToBottom);
      }
    }
    for (const bucket of Object.values(perPhase)) {
      bucket.heightSpan = Number((bucket.maxHeight - bucket.minHeight).toFixed(1));
      bucket.clientSpan = Number((bucket.maxClient - bucket.minClient).toFixed(1));
      bucket.rowSpan = bucket.maxRows - bucket.minRows;
      bucket.waitingSpan = bucket.maxWaiting - bucket.minWaiting;
      bucket.inputSpan = Number((bucket.maxInput - bucket.minInput).toFixed(1));
    }

    const report = {
      marks,
      totalFrames: frames.length,
      followingFrames: following.length,
      perPhase,
      offendingFrames: bad.slice(0, 40),
      offendingCount: bad.length,
      invalidOwners: invalidOwners.slice(0, 40),
      listWrites: listWrites.map((entry) => ({ kind: entry.kind, phase: entry.phase, node: entry.node, detail: entry.detail, stack: entry.stack })),
      otherWrites: writes.filter((entry) => !entry.inList && !entry.isList)
        .map((entry) => ({ kind: entry.kind, phase: entry.phase, node: entry.node })),
    };
    await dump('following-frames.json', report);
    await testInfo.attach('following-frames.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });

    const summary = JSON.stringify({
      perPhase,
      offendingCount: bad.length,
      first: bad.slice(0, 6),
      invalidOwners: report.invalidOwners,
      listWrites: report.listWrites,
    }, null, 2);
    expect(following.length, summary).toBeGreaterThan(600);
    expect(invalidOwners.length, summary).toBe(0);
    expect(bad.length, summary).toBe(0);
    expect(listWrites.length, summary).toBe(0);
    // The cases have to be real. Composer growth is an overlay-only change:
    // its own height changes while the reading viewport remains fixed.
    expect(perPhase['a-typing']?.inputSpan || 0, summary).toBeGreaterThan(20);
    expect(perPhase['a-typing']?.clientSpan ?? -1, summary).toBe(0);
    expect(perPhase['c-live-append']?.heightSpan || 0, summary).toBeGreaterThan(200);
    expect(perPhase['d-tail-stream']?.heightSpan || 0, summary).toBeGreaterThan(20);
    expect(perPhase['f-late-media']?.heightSpan || 0, summary).toBeGreaterThan(20);
    // (e) is only evidence if a task really entered and really left the reserve.
    expect(perPhase['e-waiting-in']?.maxWaiting || 0, summary).toBeGreaterThan(0);
    expect(perPhase['e-waiting-out']?.maxWaiting || 0, summary).toBeGreaterThan(0);
    expect(perPhase['e-waiting-out']?.minWaiting ?? -1, summary).toBe(0);
    expect(perPhase['settled']?.maxWaiting ?? -1, summary).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Switching. The two containers are different DOM, so the handoff has to be
// proved, not assumed: per frame we record every row's top offset relative to
// the viewport, keyed by row id. At the frame where the container changes, the
// maximum |delta| over the rows present on BOTH sides is the continuity error.
// A frame with zero rows in the list is a white frame.
async function armSwitchSampler(page) {
  await page.evaluate(() => {
    const frames = [];
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const owners = window.__ATOLL_TEST_READING_OWNER__.nodes();
      const root = owners.length === 1 ? owners[0] : null;
      if (root) {
        const rootRect = root.getBoundingClientRect();
        const offsets = {};
        for (const node of root.querySelectorAll('[data-presentation-row-id]')) {
          offsets[node.dataset.presentationRowId] = Number((node.getBoundingClientRect().top - rootRect.top).toFixed(2));
        }
        const container = root.dataset.readingContainer || 'virtuoso';
        frames.push({
          frame: frames.length,
          at: Number(performance.now().toFixed(1)),
          phase: window.__qPhase || '',
          container,
          mode: root.closest('.timeline')?.dataset.viewportMode || '',
          ownerCount: owners.length,
          scrollGap: Number(window.__ATOLL_TEST_READING_OWNER__.tailDistance(root).toFixed(2)),
          rowCount: Object.keys(offsets).length,
          offsets,
        });
      } else frames.push({
        frame: frames.length,
        at: Number(performance.now().toFixed(1)),
        phase: window.__qPhase || '',
        container: 'none',
        ownerCount: owners.length,
        rowCount: 0,
        offsets: {},
      });
      if (frames.length < 40_000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__qSwitch = { stop() { stopped = true; return frames; } };
  });
}

function analyseSwitches(frames) {
  const transitions = [];
  for (let index = 1; index < frames.length; index += 1) {
    const before = frames[index - 1];
    const after = frames[index];
    if (before.container === after.container) continue;
    const common = Object.keys(before.offsets).filter((id) => id in after.offsets);
    const worst = common.reduce((max, id) => {
      const delta = Math.abs(after.offsets[id] - before.offsets[id]);
      return delta > max.delta ? { id, delta: Number(delta.toFixed(2)) } : max;
    }, { id: '', delta: 0 });
    // Give the incoming container a few frames to publish its first measured
    // layout, then re-measure against the SAME pre-switch frame. Both numbers
    // are reported; neither is allowed to hide the other.
    const settled = frames[Math.min(frames.length - 1, index + 6)];
    const settledCommon = Object.keys(before.offsets).filter((id) => id in settled.offsets);
    const settledWorst = settledCommon.reduce((max, id) => {
      const delta = Math.abs(settled.offsets[id] - before.offsets[id]);
      return delta > max.delta ? { id, delta: Number(delta.toFixed(2)) } : max;
    }, { id: '', delta: 0 });
    transitions.push({
      frame: index,
      phase: after.phase,
      from: before.container,
      to: after.container,
      commonRows: common.length,
      immediate: worst,
      settled: settledWorst,
      settledCommonRows: settledCommon.length,
      afterGap: after.scrollGap,
      settledGap: settled.scrollGap,
      rowCountBefore: before.rowCount,
      rowCountAfter: after.rowCount,
      // A white frame is an actually-empty list, anywhere in the handoff window.
      whiteFrames: frames.slice(index - 1, index + 8).filter((entry) => entry.rowCount === 0).length,
    });
  }
  return transitions;
}

test.describe('Q following tail: mode switching', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1120, height: 620 });
    await installReadingOwnerHelper(page);
  });

  test('following -> browsing -> following ten times keeps the anchor and paints no empty frame', async ({ page, request }, testInfo) => {
    test.setTimeout(180_000);
    await installWriteInterceptor(page);
    await reset(request);
    await login(page);
    await chooseSteward(page);
    // A deeper tail than one viewport, so browsing has somewhere to be.
    for (let index = 0; index < 12; index += 1) {
      await append(request, { ask: `switch fixture ${index}`, text: liveText(index) });
    }
    await page.waitForTimeout(1_200);
    await expect(page.locator('.timeline-message-list')).toHaveAttribute('data-reading-container', 'following-tail');
    const expectedFollowingRows = await page.locator('.timeline-message-list [data-presentation-row-id]').count();

    await armSwitchSampler(page);
    const rounds = [];
    for (let round = 0; round < 10; round += 1) {
      await phase(page, `round-${round}-up`);
      await page.locator('.timeline-reading-layer.is-active .timeline-message-list').focus();
      await page.mouse.move(560, 300);
      await page.mouse.wheel(0, -260);
      await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
      await page.waitForTimeout(450);
      const browsing = await page.evaluate(() => {
        const root = document.querySelector('.timeline-reading-layer.is-active .timeline-message-list');
        return {
          container: root?.dataset.readingContainer || 'virtuoso',
          rows: root.querySelectorAll('[data-presentation-row-id]').length,
          focused: document.activeElement === root,
        };
      });

      await phase(page, `round-${round}-down`);
      // Return to the tail by ordinary input, exactly as a user would.
      // The fixture is intentionally much taller than one viewport and row
      // heights vary by several hundred pixels. A fixed eight notches only
      // covers 3200px and can stop in the middle of the dataset, which tests
      // the test's arithmetic rather than the handoff. Keep issuing ordinary
      // downward wheel input until ReadingSession observes the real tail.
      let pushes = 0;
      for (; pushes < 32; pushes += 1) {
        await page.mouse.wheel(0, 400);
        await page.waitForTimeout(60);
        const returned = await page.locator('.timeline-reading-layer.is-active .timeline-message-list')
          .getAttribute('data-reading-container');
        if (returned === 'following-tail') break;
      }
      await expect(page.locator('.timeline-reading-layer.is-active .timeline-message-list')).toHaveAttribute('data-reading-container', 'following-tail', { timeout: 10_000 });
      await page.waitForTimeout(400);
      const back = await page.evaluate(() => {
        const root = document.querySelector('.timeline-reading-layer.is-active .timeline-message-list');
        return {
          container: root.dataset.readingContainer || 'virtuoso',
          scrollTop: Number(root.scrollTop || 0),
          rows: root.querySelectorAll('[data-presentation-row-id]').length,
          focused: document.activeElement === root,
        };
      });
      rounds.push({ round, browsing, back, pushes: pushes + 1 });
    }

    const frames = await page.evaluate(() => window.__qSwitch.stop());
    const writes = await page.evaluate(() => window.__qWrites.all());
    const transitions = analyseSwitches(frames);
    const toBrowsing = transitions.filter((entry) => entry.to === 'virtuoso');
    const toFollowing = transitions.filter((entry) => entry.to === 'following-tail');
    const followingWrites = writes.filter((entry) => entry.followingContainer);

    const report = {
      rounds,
      totalFrames: frames.length,
      transitions,
      toBrowsingCount: toBrowsing.length,
      toFollowingCount: toFollowing.length,
      worstImmediate: transitions.reduce((max, entry) => Math.max(max, entry.immediate.delta), 0),
      worstSettled: transitions.reduce((max, entry) => Math.max(max, entry.settled.delta), 0),
      whiteFrameTotal: transitions.reduce((sum, entry) => sum + entry.whiteFrames, 0),
      emptyFrames: frames.filter((entry) => entry.rowCount === 0).length,
      followingWrites,
    };
    await dump('switch-rounds.json', report);
    await testInfo.attach('switch-rounds.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });

    const summary = JSON.stringify({
      toBrowsingCount: report.toBrowsingCount,
      toFollowingCount: report.toFollowingCount,
      worstImmediate: report.worstImmediate,
      worstSettled: report.worstSettled,
      whiteFrameTotal: report.whiteFrameTotal,
      transitions: transitions.slice(0, 6),
      rounds: rounds.slice(0, 3),
    }, null, 2);

    expect(report.toBrowsingCount, summary).toBe(10);
    expect(report.toFollowingCount, summary).toBe(10);
    // browsing -> following lands on the tail structurally, with no writer.
    for (const entry of rounds) {
      expect(Math.abs(entry.back.scrollTop), summary).toBeLessThanOrEqual(1);
      expect(entry.browsing.focused, summary).toBe(true);
      expect(entry.back.focused, summary).toBe(true);
      // A cold browsing mount must not manufacture a top/history request.
      expect(entry.back.rows, summary).toBe(expectedFollowingRows);
    }
    expect(followingWrites.length, summary).toBe(0);
    expect(report.whiteFrameTotal, summary).toBe(0);
    // Anchor continuity across the handoff, in CSS pixels.
    expect(report.worstSettled, summary).toBeLessThanOrEqual(8);
  });

  test('reverse input during a cold browsing mount cancels the handoff without blanking or history demand', async ({ page, request }, testInfo) => {
    test.setTimeout(90_000);
    await installWriteInterceptor(page);
    await reset(request);
    await login(page);
    await chooseSteward(page);
    for (let index = 0; index < 12; index += 1) {
      await append(request, { ask: `reverse fixture ${index}`, text: liveText(index) });
    }
    await page.waitForTimeout(1_000);
    const initialRows = await page.locator('.timeline-message-list [data-presentation-row-id]').count();
    await armSwitchSampler(page);

    const root = page.locator('.timeline-reading-layer.is-active .timeline-message-list');
    await root.focus();
    await page.mouse.move(560, 300);
    await page.mouse.wheel(0, -260);
    await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
    // Do not wait for readiness. The next real input is delivered to the
    // invisible incoming scroller while the outgoing paint remains visible.
    await page.mouse.wheel(0, 400);
    await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'following');
    await expect(page.locator('.timeline-reading-layer.is-active .timeline-message-list'))
      .toHaveAttribute('data-reading-container', 'following-tail');
    await page.waitForTimeout(350);

    const frames = await page.evaluate(() => window.__qSwitch.stop());
    const result = await page.evaluate(() => {
      const current = document.querySelector('.timeline-reading-layer.is-active .timeline-message-list');
      return {
        scrollTop: Number(current?.scrollTop || 0),
        rows: current?.querySelectorAll('[data-presentation-row-id]').length || 0,
        focused: document.activeElement === current,
      };
    });
    const report = {
      initialRows,
      result,
      totalFrames: frames.length,
      emptyFrames: frames.filter((entry) => entry.rowCount === 0).length,
    };
    await dump('reverse-handoff.json', report);
    await testInfo.attach('reverse-handoff.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    expect(report.emptyFrames, JSON.stringify(report)).toBe(0);
    expect(Math.abs(result.scrollTop), JSON.stringify(report)).toBeLessThanOrEqual(1);
    expect(result.rows, JSON.stringify(report)).toBe(initialRows);
    expect(result.focused, JSON.stringify(report)).toBe(true);
  });
});
