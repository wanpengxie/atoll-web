import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const baseURL = process.env.ATOLL_PERF_URL || 'http://127.0.0.1:24279';
const runs = Number(process.env.ATOLL_PERF_RUNS || 5);
const recordReactCommits = process.env.ATOLL_PERF_REACT_COMMITS === '1';
const expected = 'c0.project history 120: ask project-agent for PONG';
const sourcePaths = [
  'src/app/hooks/useChannelFeed.js',
  'src/model/history-scheduler.js',
  'src/model/timeline-projection.js',
  'src/model/conversation-presentation.js',
  'src/ui/Timeline.jsx',
  'src/ui/timeline/useReadingSession.js',
  'src/ui/timeline/LegendMessageList.jsx',
  'src/ui/MarkdownContent.jsx',
  'src/ui/PreparedMarkdown.jsx',
];

async function sourceFingerprint() {
  const files = {};
  const combined = createHash('sha256');
  for (const path of sourcePaths) {
    const contents = await readFile(path);
    files[path] = createHash('sha256').update(contents).digest('hex');
    combined.update(path).update('\0').update(contents);
  }
  return { digest: combined.digest('hex'), files };
}

async function hasCachedEnvelopeText(page, channelId, text) {
  return page.evaluate(async ({ id, expectedText }) => {
    const database = await new Promise((resolve, reject) => {
      const open = indexedDB.open('atoll-feed-v8');
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('rows', 'readonly');
      const rows = transaction.objectStore('rows').getAll(IDBKeyRange.bound(
        [id, 0], [id, Number.MAX_SAFE_INTEGER],
      ));
      rows.onsuccess = () => resolve(rows.result.some((row) => row.envelope?.payload?.text === expectedText));
      rows.onerror = () => reject(rows.error);
    });
  }, { id: channelId, expectedText: text });
}

async function prepareCachedHistory(page) {
  await page.goto(baseURL);
  await page.getByRole('textbox', { name: '账号' }).fill('root@atoll.local');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await page.locator('.connection-state.state-open').waitFor();
  await page.getByRole('button', { name: '# c0.project', exact: true }).click();
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (await hasCachedEnvelopeText(page, 'c0.project', expected)) return;
    await page.waitForTimeout(100);
  }
  throw new Error('history did not enter IndexedDB cache');
}

async function returnToColdStart(page) {
  await page.getByRole('button', { name: '# c0', exact: true }).click();
  await page.reload();
  await page.locator('.connection-state.state-open').waitFor();
  await page.getByRole('heading', { name: 'c0', exact: true }).waitFor();
}

async function measureOne(page, cdp) {
  await page.evaluate(() => {
    window.__COLD_PROD__ = {
      startedAt: performance.now(), frames: [], longTasks: [],
      commitCursor: window.__ATOLL_REACT_COMMITS__?.length || 0,
    };
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__COLD_PROD__.longTasks.push({
          at: entry.startTime - window.__COLD_PROD__.startedAt,
          duration: entry.duration,
        });
      }
    });
    observer.observe({ type: 'longtask' });
    window.__COLD_PROD__.observer = observer;
    const frame = () => {
      const text = document.querySelector('.timeline-entry')?.textContent || '';
      const heading = document.querySelector('main h1')?.textContent || '';
      const status = document.querySelector('.timeline-history-status, .timeline-reading-restore')?.textContent || '';
      const empty = document.querySelector('.empty-ledger')?.textContent || '';
      window.__COLD_PROD__.frames.push({
        at: performance.now() - window.__COLD_PROD__.startedAt,
        heading,
        status,
        empty,
        readable: text.includes('c0.project history'),
        rows: document.querySelectorAll('[data-presentation-row-id]').length,
      });
      if (!text.includes('c0.project history')) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  const before = await cdp.send('Performance.getMetrics');
  await page.getByRole('button', { name: '# c0.project', exact: true }).click();
  await page.getByText(/c0\.project history/, { exact: false }).first().waitFor({ state: 'visible' });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  const after = await cdp.send('Performance.getMetrics');
  return page.evaluate(({ beforeMetrics, afterMetrics }) => {
    const state = window.__COLD_PROD__;
    state.observer.disconnect();
    const beforeMap = Object.fromEntries(beforeMetrics.metrics.map(({ name, value }) => [name, value]));
    const afterMap = Object.fromEntries(afterMetrics.metrics.map(({ name, value }) => [name, value]));
    const firstReadableFrame = state.frames.find((frame) => frame.readable)?.at ?? null;
    const targetFrames = state.frames.filter((frame) => frame.heading === 'c0.project');
    const deltas = {};
    for (const name of ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration']) {
      deltas[name] = afterMap[name] - beforeMap[name];
    }
    const commits = (window.__ATOLL_REACT_COMMITS__ || []).slice(state.commitCursor);
    const componentCommits = {};
    for (const commit of commits) {
      for (const [name, count] of Object.entries(commit.counts)) {
        componentCommits[name] = (componentCommits[name] || 0) + count;
      }
    }
    return {
      firstReadableFrame,
      firstHeadingFrame: targetFrames[0]?.at ?? null,
      firstFeedbackFrame: targetFrames.find((frame) => frame.status || frame.readable)?.at ?? null,
      blankTargetFrames: targetFrames.filter((frame) => !frame.status && !frame.readable).length,
      emptyTargetFrames: targetFrames.filter((frame) => Boolean(frame.empty)).length,
      longTasks: state.longTasks,
      frameCount: state.frames.length,
      maxFrameGap: state.frames.reduce((max, frame, index, values) => (
        index ? Math.max(max, frame.at - values[index - 1].at) : max
      ), 0),
      materializedRows: document.querySelectorAll('[data-presentation-row-id]').length,
      markdownContents: document.querySelectorAll('.markdown-content').length,
      markdownBlocks: document.querySelectorAll('[data-reading-block-id]').length,
      domElements: document.querySelectorAll('*').length,
      react: {
        commitCount: commits.length,
        commits: commits.map((commit) => ({
          at: commit.at - state.startedAt,
          componentTypes: Object.keys(commit.counts).length,
          renderedFibers: Object.values(commit.counts).reduce((sum, count) => sum + count, 0),
        })),
        componentCommits,
      },
      metrics: deltas,
    };
  }, { beforeMetrics: before, afterMetrics: after });
}

function summarizeProfile(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const totals = new Map();
  for (let index = 0; index < (profile.samples?.length || 0); index += 1) {
    const frame = nodes.get(profile.samples[index])?.callFrame;
    const key = frame
      ? `${frame.functionName || '(anonymous)'} — ${frame.url || '(native)'}:${Number(frame.lineNumber) + 1}:${Number(frame.columnNumber) + 1}`
      : '(native/idle)';
    totals.set(key, (totals.get(key) || 0) + Number(profile.timeDeltas?.[index] || 0) / 1000);
  }
  return [...totals.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 40)
    .map(([frame, milliseconds]) => ({ frame, milliseconds }));
}

const reset = await fetch(`${baseURL}/mock/control/reset`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ scenario: 'deep-history-delayed', seed: 2921 }),
});
if (!reset.ok) throw new Error(`mock reset failed: ${reset.status}`);
const sourceBefore = await sourceFingerprint();

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
if (recordReactCommits) await page.addInitScript(() => {
  let rendererID = 0;
  const renderers = new Map();
  window.__ATOLL_REACT_COMMITS__ = [];
  Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
    configurable: true,
    value: {
      supportsFiber: true,
      renderers,
      inject(renderer) {
        rendererID += 1;
        renderers.set(rendererID, renderer);
        return rendererID;
      },
      onCommitFiberRoot(_id, root) {
        const counts = {};
        const visit = (fiber) => {
          if (!fiber) return;
          if ((fiber.flags & 1) === 1) {
            const name = fiber.type?.displayName || fiber.type?.name || (typeof fiber.type === 'string' ? fiber.type : 'anonymous');
            counts[name] = (counts[name] || 0) + 1;
          }
          visit(fiber.child);
          visit(fiber.sibling);
        };
        visit(root.current);
        window.__ATOLL_REACT_COMMITS__.push({ at: performance.now(), counts });
      },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
    },
  });
});
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');
try {
  await prepareCachedHistory(page);
  const results = [];
  for (let index = 0; index < runs; index += 1) {
    await returnToColdStart(page);
    results.push(await measureOne(page, cdp));
  }
  await returnToColdStart(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
  const profiledRun = await measureOne(page, cdp);
  const { profile } = await cdp.send('Profiler.stop');
  const values = results.map((result) => result.firstReadableFrame).sort((left, right) => left - right);
  const evidence = {
    baseURL,
    source: {
      before: sourceBefore,
      after: await sourceFingerprint(),
    },
    results,
    medianFirstReadableFrame: values[Math.floor(values.length / 2)],
    profiledRun,
    cpu: summarizeProfile(profile),
  };
  evidence.source.stable = evidence.source.before.digest === evidence.source.after.digest;
  const outputPath = process.env.ATOLL_PERF_OUTPUT;
  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  }
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  await browser.close();
}
