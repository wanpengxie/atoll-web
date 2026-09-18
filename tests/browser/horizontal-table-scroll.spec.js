import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

const SOURCE_PATHS = [
  'src/App.jsx',
  'src/ui/Timeline.jsx',
  'src/ui/MarkdownContent.jsx',
  'src/styles/timeline.css',
  'tests/browser/horizontal-table-scroll.spec.js',
];

async function fingerprint() {
  const hash = createHash('sha256');
  for (const path of SOURCE_PATHS) hash.update(path).update('\0').update(await readFile(path));
  return { algorithm: 'sha256', digest: hash.digest('hex'), paths: SOURCE_PATHS };
}

async function reset(request, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario: 'long-running-canonical', seed },
  });
  if (!response.ok()) throw new Error(`mock reset failed: ${response.status()} ${await response.text()}`);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await page.waitForFunction(() => document.querySelector('.connection-state.state-open'));
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'c0');
}

function wideTable(marker) {
  const headers = [marker, 'alpha', 'beta', 'gamma', 'delta', 'epsilon'];
  const cells = headers.map((header, index) => `${header}-${String(index).repeat(28)}`);
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    `| ${cells.join(' | ')} |`,
  ].join('\n');
}

async function publishWideTable(request, marker) {
  const dense = await request.post(`${MOCK}/mock/control/action`, {
    data: { type: 'dense_progress', channel_id: 'c0', count: 1 },
  });
  if (!dense.ok()) throw new Error(`dense progress failed: ${dense.status()} ${await dense.text()}`);
  const { request_id: requestId } = await dense.json();
  const terminal = await request.post(`${MOCK}/mock/control/action`, {
    data: {
      type: 'push_terminal', channel_id: 'c0', request_id: requestId,
      payload: { text: wideTable(marker) },
    },
  });
  if (!terminal.ok()) throw new Error(`terminal failed: ${terminal.status()} ${await terminal.text()}`);
  return requestId;
}

async function installProbe(page, marker) {
  await page.evaluate((needle) => {
    const IDs = new WeakMap();
    let nextID = 1;
    let raf = 0;
    let running = true;
    const idOf = (node) => {
      if (!node) return '';
      if (!IDs.has(node)) IDs.set(node, `${node.localName}-${nextID++}`);
      return IDs.get(node);
    };
    const findTable = () => [...document.querySelectorAll('.markdown-table-scroll')]
      .find((node) => node.textContent?.includes(needle)) || null;
    const probe = {
      schema: 1, marker: needle, startedAt: performance.now(),
      frames: [], markers: [], scrollEvents: [], writes: [], mutations: [],
    };
    const instrument = (node, owner) => {
      if (!node || node.dataset.horizontalProbe === 'true') return;
      node.dataset.horizontalProbe = 'true';
      const nativeScrollTo = node.scrollTo;
      const nativeScrollBy = node.scrollBy;
      node.scrollTo = function probedScrollTo(...args) {
        probe.writes.push({ at: performance.now(), owner, nodeID: idOf(this), method: 'scrollTo', args, stack: String(new Error().stack || '') });
        return nativeScrollTo.apply(this, args);
      };
      node.scrollBy = function probedScrollBy(...args) {
        probe.writes.push({ at: performance.now(), owner, nodeID: idOf(this), method: 'scrollBy', args, stack: String(new Error().stack || '') });
        return nativeScrollBy.apply(this, args);
      };
      let prototype = node;
      let descriptor = null;
      while (prototype && !descriptor) {
        prototype = Object.getPrototypeOf(prototype);
        descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, 'scrollLeft');
      }
      if (descriptor?.get && descriptor?.set) Object.defineProperty(node, 'scrollLeft', {
        configurable: true,
        get() { return descriptor.get.call(this); },
        set(value) {
          probe.writes.push({ at: performance.now(), owner, nodeID: idOf(this), method: 'scrollLeft=', args: [Number(value)], stack: String(new Error().stack || '') });
          return descriptor.set.call(this, value);
        },
      });
    };
    const sample = () => {
      const root = document.querySelector('.timeline-message-list');
      const table = findTable();
      instrument(root, 'root');
      instrument(table, 'table');
      probe.frames.push({
        index: probe.frames.length, at: performance.now(),
        root: root ? { nodeID: idOf(root), scrollLeft: root.scrollLeft, scrollTop: root.scrollTop, scrollWidth: root.scrollWidth, clientWidth: root.clientWidth } : null,
        table: table ? { nodeID: idOf(table), connected: table.isConnected, scrollLeft: table.scrollLeft, scrollWidth: table.scrollWidth, clientWidth: table.clientWidth } : null,
      });
      if (running) raf = requestAnimationFrame(sample);
    };
    const onScroll = (event) => {
      const root = document.querySelector('.timeline-message-list');
      const table = findTable();
      if (event.target !== root && event.target !== table) return;
      probe.scrollEvents.push({
        at: performance.now(), trusted: event.isTrusted,
        owner: event.target === table ? 'table' : 'root', nodeID: idOf(event.target),
        scrollLeft: event.target.scrollLeft, scrollTop: event.target.scrollTop,
      });
    };
    document.addEventListener('scroll', onScroll, true);
    const mutation = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of [...record.removedNodes, ...record.addedNodes]) {
          if (!(node instanceof Element)) continue;
          const candidates = [node, ...node.querySelectorAll('.markdown-table-scroll')]
            .filter((candidate) => candidate.matches?.('.markdown-table-scroll') && candidate.textContent?.includes(needle));
          for (const candidate of candidates) probe.mutations.push({
            at: performance.now(), kind: node.isConnected ? 'added' : 'removed',
            nodeID: idOf(candidate), connected: candidate.isConnected,
            scrollLeft: candidate.scrollLeft, scrollWidth: candidate.scrollWidth, clientWidth: candidate.clientWidth,
          });
        }
      }
    });
    mutation.observe(document.querySelector('.conversation-surface') || document.body, { childList: true, subtree: true });
    probe.mark = (name, detail = {}) => probe.markers.push({ at: performance.now(), name, detail });
    probe.stop = () => {
      running = false;
      cancelAnimationFrame(raf);
      mutation.disconnect();
      document.removeEventListener('scroll', onScroll, true);
      sample();
    };
    probe.snapshot = () => ({ ...probe });
    window.__horizontalTableProbe = probe;
    probe.mark('installed');
    sample();
  }, marker);
}

async function mark(page, name, detail = {}) {
  await page.evaluate(({ marker, value }) => window.__horizontalTableProbe?.mark(marker, value), { marker: name, value: detail });
}

async function persist(page, testInfo, operationFailure) {
  const snapshot = await page.evaluate(() => {
    window.__horizontalTableProbe?.stop?.();
    return window.__horizontalTableProbe?.snapshot?.() || null;
  });
  const markerTime = (name) => snapshot?.markers.find((entry) => entry.name === name)?.at || 0;
  const framesAfter = (name) => snapshot?.frames.filter((frame) => frame.at >= markerTime(name)) || [];
  const scrolledFrames = framesAfter('native-scroll-settled');
  const sourceNodeID = scrolledFrames[0]?.table?.nodeID || '';
  const sourceScrollLeft = scrolledFrames[0]?.table?.scrollLeft || 0;
  const summary = {
    sourceNodeID,
    sourceScrollLeft,
    minimumScrollLeftAfterNativeInput: Math.min(...scrolledFrames.map((frame) => frame.table?.scrollLeft ?? Number.POSITIVE_INFINITY)),
    nodeIDsAfterNativeInput: [...new Set(scrolledFrames.map((frame) => frame.table?.nodeID).filter(Boolean))],
    trustedTableScrollEvents: snapshot?.scrollEvents.filter((event) => event.owner === 'table' && event.trusted).length || 0,
    tableProgrammaticWrites: snapshot?.writes.filter((entry) => entry.owner === 'table') || [],
    rootProgrammaticWrites: snapshot?.writes.filter((entry) => entry.owner === 'root') || [],
    tableMutations: snapshot?.mutations || [],
  };
  const artifact = {
    schema: 1, capturedAt: new Date().toISOString(),
    oracle: {
      nativeInput: 'Shift+wheel over the overflow table',
      settleMs: 1200,
      horizontalTolerancePx: 1,
      artifactOrdering: 'writeFile-and-attach-before-business-expect',
    },
    source: await fingerprint(),
    operationFailure: operationFailure ? { message: operationFailure.message, stack: operationFailure.stack } : null,
    summary,
    snapshot,
  };
  const path = testInfo.outputPath('horizontal-table-scroll.json');
  await writeFile(path, JSON.stringify(artifact, null, 2));
  await testInfo.attach('horizontal-table-scroll', { path, contentType: 'application/json' });
  if (operationFailure) throw new Error(`trajectory failed after artifact persisted at ${path}: ${operationFailure.message}`);
  return summary;
}

test('wide Markdown table keeps native horizontal reading position through background App updates', async ({ page, request }, testInfo) => {
  test.slow();
  await page.setViewportSize({ width: 1120, height: 760 });
  await reset(request, 0x92_19_01);
  await login(page);
  const marker = 'horizontal-table-marker';
  await publishWideTable(request, marker);
  const table = page.locator('.markdown-table-scroll').filter({ hasText: marker });
  await expect(table).toBeVisible();
  await expect.poll(() => table.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeGreaterThan(300);
  await installProbe(page, marker);
  let operationFailure = null;
  try {
    await table.hover();
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, 760);
    await page.keyboard.up('Shift');
    await expect.poll(() => table.evaluate((node) => node.scrollLeft)).toBeGreaterThan(100);
    await page.waitForTimeout(80);
    await mark(page, 'native-scroll-settled');
    await page.waitForTimeout(1200);
    await mark(page, 'idle-settled');

    const pulse = await request.post(`${MOCK}/mock/control/action`, { data: { type: 'pulse' } });
    if (!pulse.ok()) throw new Error(`pulse failed: ${pulse.status()} ${await pulse.text()}`);
    await page.waitForTimeout(300);
    await mark(page, 'background-append-settled');

    const dense = await request.post(`${MOCK}/mock/control/action`, {
      data: { type: 'dense_progress', channel_id: 'c0', count: 2 },
    });
    if (!dense.ok()) throw new Error(`stream parent update failed: ${dense.status()} ${await dense.text()}`);
    await page.waitForTimeout(300);
    await mark(page, 'stream-parent-settled');

    await page.setViewportSize({ width: 1040, height: 720 });
    await page.waitForTimeout(180);
    await mark(page, 'resize-settled');
  } catch (error) {
    operationFailure = error;
    await mark(page, 'operation-failure', { message: error.message }).catch(() => {});
  }
  const summary = await persist(page, testInfo, operationFailure);
  expect(summary.trustedTableScrollEvents).toBeGreaterThan(0);
  expect(summary.sourceScrollLeft).toBeGreaterThan(100);
  expect(summary.minimumScrollLeftAfterNativeInput).toBeGreaterThanOrEqual(summary.sourceScrollLeft - 1);
  expect(summary.nodeIDsAfterNativeInput).toEqual([summary.sourceNodeID]);
  expect(summary.tableProgrammaticWrites).toEqual([]);
});
