import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

const SOURCES = [
  'src/ui/Composer.jsx', 'src/ui/Timeline.jsx',
  'src/ui/conversation/ConversationSurface.jsx',
  'src/ui/timeline/LegendMessageList.jsx',
  'src/ui/timeline/useReadingSession.js',
  'src/model/waiting-presentation.js', 'src/model/send-scroll-transaction.js',
  'src/styles/app-shell.css', 'src/styles/timeline.css',
  'tests/browser/waiting-obstruction.spec.js',
];

async function fingerprint() {
  const files = {};
  const combined = createHash('sha256');
  for (const path of SOURCES) {
    const source = await readFile(path);
    files[path] = createHash('sha256').update(source).digest('hex');
    combined.update(path).update('\0').update(source);
  }
  return { algorithm: 'sha256', digest: combined.digest('hex'), files };
}

async function reset(request, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'long-running-history', seed },
  });
  if (!response.ok()) throw new Error(`mock reset failed: ${response.status()} ${await response.text()}`);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await page.waitForFunction(() => document.querySelector('.connection-state.state-open'));
  await page.waitForFunction(() => {
    const root = document.querySelector('.timeline-message-list');
    return root && root.clientHeight > 0 && root.scrollHeight > root.clientHeight * 1.5;
  });
}

async function compose(page, text) {
  const editor = page.getByLabel('消息');
  await editor.fill('@st');
  await expect(page.getByRole('option', { name: /steward/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await editor.press('End');
  await editor.pressSequentially(text);
}

async function waitFrames(page, count = 4) {
  await page.evaluate(async (total) => {
    for (let index = 0; index < total; index += 1) await new Promise(requestAnimationFrame);
  }, count);
}

async function establishOwner(page) {
  await compose(page, 'fixed-reserve-running-owner');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForFunction(() => (
    [...document.querySelectorAll('[data-presentation-row-id]')]
      .some((row) => row.textContent?.includes('fixed-reserve-running-owner'))
    && [...document.querySelectorAll('.task-control-buttons button')]
      .some((button) => button.textContent === '停止')
  ));
  await page.waitForFunction(() => !document.querySelector('.agent-wait-layer'));
  await waitFrames(page, 10);
  const jump = page.getByRole('button', { name: /条新动态/ });
  if (await jump.count()) await jump.click();
  const root = page.locator('.timeline-message-list');
  await root.hover();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const gap = await root.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop);
    if (gap <= 1) break;
    await page.mouse.wheel(0, Math.max(900, gap + 100));
    await waitFrames(page, 2);
  }
  await expect.poll(() => root.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop))
    .toBeLessThanOrEqual(1);
}

async function installProbe(page, label, needle) {
  await page.evaluate(({ caseLabel, targetNeedle }) => {
    const root = document.querySelector('.timeline-message-list');
    if (!root) throw new Error('missing production scroller');
    const ids = new WeakMap();
    let nextID = 1;
    const id = (node) => {
      if (!node) return '';
      if (!ids.has(node)) ids.set(node, `${node.localName}-${nextID++}`);
      return ids.get(node);
    };
    const rect = (node) => {
      if (!node) return null;
      const value = node.getBoundingClientRect();
      return {
        nodeID: id(node), top: value.top, right: value.right, bottom: value.bottom,
        left: value.left, width: value.width, height: value.height,
      };
    };
    const cssNumber = (node, property) => {
      if (!node) return null;
      const value = Number.parseFloat(getComputedStyle(node).getPropertyValue(property));
      return Number.isFinite(value) ? value : null;
    };
    const stack = () => String(new Error().stack || '').split('\n').slice(2, 9).join('\n');
    const probe = {
      schema: 3, label: caseLabel, frames: [], markers: [], writes: [], scrollEvents: [],
      browseAnchorRowID: '',
    };
    const nativeScrollTo = root.scrollTo;
    const nativeScrollBy = root.scrollBy;
    root.scrollTo = function scrollTo(...args) {
      probe.writes.push({ at: performance.now(), method: 'scrollTo', args, stack: stack() });
      return nativeScrollTo.apply(this, args);
    };
    root.scrollBy = function scrollBy(...args) {
      probe.writes.push({ at: performance.now(), method: 'scrollBy', args, stack: stack() });
      return nativeScrollBy.apply(this, args);
    };
    const onScroll = (event) => probe.scrollEvents.push({
      at: performance.now(), top: Number(root.scrollTop), isTrusted: event.isTrusted,
    });
    root.addEventListener('scroll', onScroll, { passive: true });
    let running = true;
    let raf = 0;
    const sample = () => {
      const rootRect = root.getBoundingClientRect();
      const rows = [...root.querySelectorAll('[data-presentation-row-id]')];
      const visible = rows.filter((row) => {
        const value = row.getBoundingClientRect();
        return value.bottom > rootRect.top + 0.5 && value.top < rootRect.bottom - 0.5;
      }).sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);
      const anchor = visible[0];
      const lastRow = [...rows].sort((left, right) => right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom)[0];
      const targetRow = rows.find((row) => row.textContent?.includes(targetNeedle));
      const browseAnchor = rows.find((row) => row.dataset.presentationRowId === probe.browseAnchorRowID);
      const targetWait = [...document.querySelectorAll('.agent-wait-item')]
        .find((item) => item.textContent?.includes(targetNeedle));
      const surface = document.querySelector('.conversation-surface');
      const floating = document.querySelector('.conversation-floating-slot');
      const footer = root.querySelector('.timeline-waiting-obstruction');
      const waiting = document.querySelector('.agent-wait-layer');
      const handoffOnly = waiting?.classList.contains('is-handoff-only') || false;
      const controls = handoffOnly ? [] : [...(waiting?.querySelectorAll('button') || [])].map((control) => {
        const value = control.getBoundingClientRect();
        const hit = value.width > 0 && value.height > 0
          ? document.elementFromPoint(value.left + value.width / 2, value.top + value.height / 2) : null;
        return { ...rect(control), label: String(control.textContent || '').trim(), hitOwned: control.contains(hit) };
      });
      const waitingRect = waiting?.getBoundingClientRect();
      const waitingHit = waitingRect
        ? document.elementFromPoint(waitingRect.left + waitingRect.width / 2, waitingRect.top + 1) : null;
      probe.frames.push({
        index: probe.frames.length, at: performance.now(),
        mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
        reserve: cssNumber(surface, '--conversation-waiting-reserve'),
        surface: rect(surface), reading: rect(document.querySelector('.conversation-reading-slot')),
        input: rect(document.querySelector('.conversation-input-slot')),
        composer: rect(document.querySelector('.composer-wrap')),
        floating: rect(floating), footer: rect(footer), waiting: rect(waiting),
        waitingHandoffOnly: handoffOnly,
        waitingHitOwned: waiting ? waiting.contains(waitingHit) : null,
        controls,
        clipPath: floating ? getComputedStyle(floating).clipPath : null,
        scroll: {
          top: Number(root.scrollTop), height: Number(root.scrollHeight), client: Number(root.clientHeight),
          gap: Number(root.scrollHeight - root.clientHeight - root.scrollTop),
        },
        lastRow: rect(lastRow), targetRow: rect(targetRow), targetWait: rect(targetWait),
        browseAnchor: browseAnchor ? {
          ...rect(browseAnchor), rowID: browseAnchor.dataset.presentationRowId || '',
          topInScroller: browseAnchor.getBoundingClientRect().top - rootRect.top,
        } : null,
        anchor: anchor ? {
          nodeID: id(anchor), rowID: anchor.dataset.presentationRowId || '',
          top: anchor.getBoundingClientRect().top - rootRect.top,
        } : null,
      });
      if (running) raf = requestAnimationFrame(sample);
    };
    probe.mark = (name) => probe.markers.push({ name, at: performance.now(), frame: probe.frames.length });
    probe.captureBrowseAnchor = () => {
      const bounds = root.getBoundingClientRect();
      const candidate = [...root.querySelectorAll('[data-presentation-row-id]')].find((row) => {
        const value = row.getBoundingClientRect();
        return value.top >= bounds.top + 1 && value.bottom <= bounds.bottom - 1;
      });
      probe.browseAnchorRowID = candidate?.dataset.presentationRowId || '';
      return probe.browseAnchorRowID;
    };
    probe.stop = () => {
      running = false;
      cancelAnimationFrame(raf);
      root.removeEventListener('scroll', onScroll);
      sample();
    };
    window.__waitingReserveProbe = probe;
    sample();
  }, { caseLabel: label, targetNeedle: needle });
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const finiteRect = (value) => value != null
  && ['top', 'right', 'bottom', 'left', 'width', 'height'].every((key) => finite(value[key]));

function marker(snapshot, name) {
  return snapshot.markers.find((entry) => entry.name === name)?.at ?? null;
}

function between(snapshot, from, to = null) {
  const start = marker(snapshot, from) ?? -Infinity;
  const end = to == null ? Infinity : marker(snapshot, to) ?? Infinity;
  return snapshot.frames.filter((frame) => frame.at >= start && frame.at <= end);
}

function anchorSteps(frames) {
  return frames.slice(1).flatMap((frame, index) => {
    const before = frames[index];
    return frame.anchor?.rowID && frame.anchor.rowID === before.anchor?.rowID
      ? [frame.anchor.top - before.anchor.top] : [];
  });
}

async function run({ page, request, testInfo, browsing = false, reducedMotion = false }) {
  const label = reducedMotion ? 'fixed-reserve-reduced' : browsing ? 'fixed-reserve-browsing' : 'fixed-reserve-following';
  const target = `${label}-target`;
  await page.setViewportSize({ width: 1120, height: 760 });
  await reset(request, reducedMotion ? 0x92_19_13 : browsing ? 0x92_19_12 : 0x92_19_11);
  await login(page);
  await establishOwner(page);
  if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  await installProbe(page, label, target);
  await waitFrames(page, 4);
  await page.evaluate(() => window.__waitingReserveProbe.mark('baseline'));
  await compose(page, target);
  await page.evaluate(() => window.__waitingReserveProbe.mark('send-before'));
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForFunction((value) => [...document.querySelectorAll('.agent-wait-item')]
    .some((item) => item.textContent?.includes(value)), target);
  await page.evaluate(() => window.__waitingReserveProbe.mark('waiting-visible'));
  await waitFrames(page, 6);
  if (browsing) {
    const root = page.locator('.timeline-message-list');
    await root.hover();
    await page.evaluate(() => window.__waitingReserveProbe.mark('wheel-before'));
    await page.mouse.wheel(0, -900);
    await page.waitForFunction(() => document.querySelector('.timeline')?.dataset.viewportMode === 'browsing');
    await page.evaluate(() => {
      window.__waitingReserveProbe.captureBrowseAnchor();
      window.__waitingReserveProbe.mark('wheel-takeover');
    });
    await waitFrames(page, 4);
  }
  await page.getByRole('button', { name: '收起', exact: true }).click();
  await page.evaluate(() => window.__waitingReserveProbe.mark('collapsed'));
  await waitFrames(page, 6);
  await page.getByRole('button', { name: '展开', exact: true }).click();
  await page.evaluate(() => window.__waitingReserveProbe.mark('expanded'));
  await waitFrames(page, 6);
  await page.evaluate(() => window.__waitingReserveProbe.mark('handoff-before'));
  for (let index = 0; index < 3; index += 1) {
    const response = await request.post(`${MOCK}/mock/control/advance`, { data: { ms: 0, compute: { channel_id: 'c0' } } });
    if (!response.ok()) throw new Error(`advance failed: ${response.status()} ${await response.text()}`);
    await waitFrames(page, 5);
  }
  await page.waitForFunction((value) => (
    [...document.querySelectorAll('[data-presentation-row-id]')].some((row) => row.textContent?.includes(value))
    && ![...document.querySelectorAll('.agent-wait-item')].some((item) => item.textContent?.includes(value))
  ), target);
  await page.evaluate(() => window.__waitingReserveProbe.mark('handoff-settled'));
  await waitFrames(page, 6);
  const snapshot = await page.evaluate(() => {
    window.__waitingReserveProbe.stop();
    return window.__waitingReserveProbe;
  });

  const lifecycle = snapshot.frames.filter((frame) => (
    frame.at >= (marker(snapshot, 'baseline') ?? -Infinity)
    && frame.at < (marker(snapshot, 'handoff-before') ?? Infinity)
    && !frame.targetRow
  ));
  const beforeWheel = browsing
    ? between(snapshot, 'baseline', 'wheel-before').filter((frame) => !frame.targetRow)
    : lifecycle;
  const afterWheel = browsing
    ? between(snapshot, 'wheel-takeover', 'handoff-before').filter((frame) => !frame.targetRow)
    : lifecycle;
  const handoff = between(snapshot, 'handoff-before', 'handoff-settled');
  const wheelAt = marker(snapshot, 'wheel-takeover');
  const postWheelFrames = wheelAt == null ? [] : snapshot.frames.filter((frame) => frame.at >= wheelAt);
  const sharedAnchorSteps = postWheelFrames.slice(1).flatMap((frame, index) => {
    const before = postWheelFrames[index];
    return frame.browseAnchor?.rowID === before.browseAnchor?.rowID
      ? [frame.browseAnchor.topInScroller - before.browseAnchor.topInScroller]
      : [];
  });
  const artifact = {
    schema: 2, capturedAt: new Date().toISOString(), label,
    source: await fingerprint(),
    oracle: {
      reservePx: 48,
      reserveDerivation: '40px collapsed Waiting height + 8px compact design spacing',
      artifactOrdering: 'writeFile-and-attach-before-business-expect', reducedMotion,
    },
    summary: {
      waitingFrameCount: snapshot.frames.filter((frame) => frame.waiting).length,
      footerIDs: [...new Set(lifecycle.map((frame) => frame.footer?.nodeID).filter(Boolean))],
      preWheelScrollHeights: [...new Set(beforeWheel.map((frame) => frame.scroll.height))],
      postWheelScrollHeights: [...new Set(afterWheel.map((frame) => frame.scroll.height))],
      handoffHasDual: handoff.some((frame) => frame.targetRow && frame.targetWait),
      handoffHasEmpty: handoff.some((frame) => !frame.targetRow && !frame.targetWait),
      writesAfterWheel: wheelAt == null ? [] : snapshot.writes.filter((entry) => entry.at > wheelAt + 0.5),
      scrollEventsAfterWheel: wheelAt == null ? [] : snapshot.scrollEvents.filter((entry) => entry.at > wheelAt + 0.5),
      scrollTopStepsAfterWheel: postWheelFrames.slice(1).map((frame, index) => (
        frame.scroll.top - postWheelFrames[index].scroll.top
      )),
      anchorStepsAfterWheel: wheelAt == null ? [] : anchorSteps(snapshot.frames.filter((frame) => frame.at >= wheelAt)),
      browseAnchorRowID: snapshot.browseAnchorRowID,
      browseAnchorStepsAfterWheel: sharedAnchorSteps,
    },
    snapshot,
  };
  const path = testInfo.outputPath(`${label}.json`);
  await writeFile(path, JSON.stringify(artifact, null, 2));
  await testInfo.attach(`${label}.json`, { path, contentType: 'application/json' });

  expect(snapshot.frames.length, 'trajectory contains frames').toBeGreaterThan(0);
  expect(artifact.summary.waitingFrameCount, 'trajectory contains Waiting frames').toBeGreaterThan(0);
  for (const frame of snapshot.frames) {
    expect(finite(frame.reserve), `frame ${frame.index}: reserve is finite`).toBe(true);
    expect(frame.reserve, `frame ${frame.index}: reserve is fixed`).toBe(48);
    expect(finiteRect(frame.footer), `frame ${frame.index}: Footer rect is finite`).toBe(true);
    expect(frame.footer.height, `frame ${frame.index}: Footer remains fixed`).toBe(48);
    expect(frame.clipPath, `frame ${frame.index}: floating Waiting is not clipped`).toBe('none');
    if (!frame.waiting) continue;
    expect(finiteRect(frame.waiting), `frame ${frame.index}: Waiting rect is finite`).toBe(true);
    if (frame.waitingHandoffOnly) {
      expect(frame.waitingHitOwned, `frame ${frame.index}: inert handoff owns no hit`).toBe(false);
      expect(frame.controls, `frame ${frame.index}: inert handoff has no controls`).toEqual([]);
    } else {
      expect(frame.waitingHitOwned, `frame ${frame.index}: active Waiting owns its surface`).toBe(true);
      expect(frame.controls.length, `frame ${frame.index}: active Waiting has controls`).toBeGreaterThan(0);
      expect(frame.controls.every((control) => finiteRect(control) && control.hitOwned),
        `frame ${frame.index}: every Waiting control is measurable and reachable`).toBe(true);
    }
    if (frame.mode === 'following' && frame.lastRow && !(frame.targetRow && frame.targetWait)) {
      expect(frame.lastRow.bottom, `frame ${frame.index}: fixed reserve keeps the tail readable`)
        .toBeLessThanOrEqual(frame.waiting.top + 1);
    }
  }
  expect(artifact.summary.footerIDs.length, 'one stable Footer serves the lifecycle').toBe(1);
  expect(artifact.summary.preWheelScrollHeights.length,
    'Waiting mount does not change list extent before trusted browsing').toBe(1);
  expect(artifact.summary.postWheelScrollHeights.length,
    'Waiting collapse/expand do not change list extent after trusted browsing').toBe(1);
  expect(artifact.summary.handoffHasEmpty, 'handoff never paints neither destination').toBe(false);
  expect(artifact.summary.handoffHasDual,
    reducedMotion ? 'reduced motion retains no visual exit' : 'normal motion has one inert visual exit').toBe(!reducedMotion);
  if (browsing) {
    expect(artifact.summary.writesAfterWheel, 'trusted browsing receives no later programmatic write').toEqual([]);
    expect(artifact.summary.browseAnchorRowID, 'trusted browsing captures one semantic anchor').not.toBe('');
    expect(postWheelFrames.every((frame) => finiteRect(frame.browseAnchor)
      && frame.browseAnchor.rowID === artifact.summary.browseAnchorRowID),
    'the same semantic browsing anchor stays materialized and measurable').toBe(true);
    expect(Math.max(0, ...artifact.summary.scrollTopStepsAfterWheel.map(Math.abs)),
      'no hidden native or Virtuoso compensation changes scrollTop').toBeLessThanOrEqual(1);
    expect(Math.max(0, ...artifact.summary.browseAnchorStepsAfterWheel.map(Math.abs)),
      'the shared semantic browsing anchor stays fixed').toBeLessThanOrEqual(1);
    expect(Math.max(0, ...artifact.summary.anchorStepsAfterWheel.map(Math.abs)),
      'browsing anchor stays fixed').toBeLessThanOrEqual(1);
  }
}

test('following keeps a fixed Waiting reserve through mount, controls and handoff', async ({ page, request }, testInfo) => {
  test.slow();
  await run({ page, request, testInfo });
});

test('browsing keeps its anchor while the fixed Waiting reserve stays unchanged', async ({ page, request }, testInfo) => {
  test.slow();
  await run({ page, request, testInfo, browsing: true });
});

test('reduced motion uses the same fixed Waiting reserve without hidden controls', async ({ page, request }, testInfo) => {
  test.slow();
  await run({ page, request, testInfo, reducedMotion: true });
});
