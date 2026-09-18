import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// This suite intentionally has no production-side test hook.  The fixture half
// drives the public reading adapter, while the integration half uses the same
// controls a reader and the mock Gateway use.  Run it only after the production
// owners freeze their changes, on ports/output dedicated to this file:
//
//   ATOLL_TEST_WEB_PORT=15291 ATOLL_TEST_MOCK_PORT=18951 \
//     npx playwright test tests/browser/conversation-ux-fuzz.spec.js \
//     --output docs/evidence/conversation-ux-fuzz/playwright

const FIXTURE_SEEDS = [0x71_05_21, 0x71_05_2d, 0x71_05_3b];
const INTEGRATION_SEEDS = [0x81_06_17, 0x81_06_29];
const SEND_WAITING_CASES = [
  { seed: 0x91_07_13, mode: 'following' },
  { seed: 0x91_07_27, mode: 'browsing' },
];
const FRAMES_PER_ACTION = Number(process.env.ATOLL_UX_FUZZ_FRAMES || 3);
const SCREENSHOT_RING_SIZE = Number(process.env.ATOLL_UX_FUZZ_SCREENSHOTS || 96);
const SOURCE_BOUNDARY_FILES = [
  'src/ui/timeline/LegendMessageList.jsx',
  'src/ui/timeline/useReadingSession.js',
  'src/ui/Timeline.jsx',
  'src/ui/Composer.jsx',
  'src/app/hooks/useSubmissions.js',
  'tests/browser/conversation-ux-fuzz.spec.js',
];

async function sourceBoundary() {
  return Object.fromEntries(await Promise.all(SOURCE_BOUNDARY_FILES.map(async (path) => {
    try {
      const body = await readFile(path);
      return [path, createHash('sha256').update(body).digest('hex')];
    } catch (error) {
      return [path, `unavailable:${error?.code || error?.name || 'error'}`];
    }
  })));
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0x1_0000_0000;
  };
}

function shuffled(values, seed) {
  const random = seededRandom(seed);
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function fixturePlan(seed) {
  const sources = ['append', 'prepend', 'resize-tail', 'resize-viewport'];
  return [
    { type: 'follow', origin: 'user-command' },
    ...shuffled(sources, seed).map((type) => ({ type, origin: 'program-source', expectedMode: 'following' })),
    { type: 'browse', origin: 'user-displacement' },
    ...shuffled(sources, seed ^ 0xa5a5_a5a5).map((type) => ({ type, origin: 'program-source', expectedMode: 'browsing' })),
    { type: 'selection', origin: 'user-displacement', expectedMode: 'browsing' },
    ...shuffled(sources, seed ^ 0x5a5a_5a5a).slice(0, 2)
      .map((type) => ({ type, origin: 'program-source', expectedMode: 'browsing' })),
    { type: 'follow', origin: 'user-command' },
    { type: 'selection', origin: 'user-displacement', expectedMode: 'browsing' },
  ];
}

class ReadingReferenceModel {
  constructor(channel = 'fixture') {
    this.channel = channel;
    this.visible = true;
    this.channels = new Map([[channel, { mode: 'following', anchor: '' }]]);
  }

  current() {
    if (!this.channels.has(this.channel)) {
      this.channels.set(this.channel, { mode: 'following', anchor: '' });
    }
    return this.channels.get(this.channel);
  }

  apply(action) {
    const current = this.current();
    if (action.type === 'browse' || action.type === 'selection' || action.type === 'fold') {
      current.mode = 'browsing';
    } else if (action.type === 'follow' || action.type === 'send') {
      current.mode = 'following';
    } else if (action.type === 'switch') {
      this.channel = action.channel;
      this.current();
    } else if (action.type === 'hide') {
      this.visible = false;
    } else if (action.type === 'show') {
      this.visible = true;
    }
    return { channel: this.channel, visible: this.visible, mode: this.current().mode };
  }
}

function conciseError(error) {
  return {
    name: error?.name || 'Error',
    message: String(error?.message || error),
    stack: String(error?.stack || '').split('\n').slice(0, 12).join('\n'),
  };
}

class FrameEvidence {
  constructor(page, seed, kind) {
    this.page = page;
    this.seed = seed;
    this.kind = kind;
    this.frames = [];
    this.screenshots = [];
    this.console = [];
    this.programmaticWrites = [];
    this.userDisplacements = [];
    this.userCommands = [];
    this.extra = {};
    this.startedAt = new Date().toISOString();
    page.on('console', (message) => {
      this.console.push({ at: Date.now(), type: message.type(), text: message.text() });
    });
    page.on('pageerror', (error) => {
      this.console.push({ at: Date.now(), type: 'pageerror', text: String(error?.stack || error) });
    });
  }

  noteAction(action, before, after) {
    const row = {
      index: this.actionIndex,
      action,
      before,
      after,
      // A virtualizer's compensating scroll is explicitly not a reader move.
      observedScrollDelta: Number(after?.scrollTop || 0) - Number(before?.scrollTop || 0),
      observedInputEpochDelta: Number(after?.inputEpoch || 0) - Number(before?.inputEpoch || 0),
    };
    if (action.origin === 'program-source') this.programmaticWrites.push(row);
    else if (action.origin === 'user-displacement') this.userDisplacements.push(row);
    else this.userCommands.push(row);
  }

  async capture(actionIndex, action, phase, frameIndex, inspect) {
    this.actionIndex = actionIndex;
    await this.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const snapshot = await inspect();
    const frame = {
      sequence: this.frames.length,
      actionIndex,
      action,
      phase,
      frameIndex,
      consoleCursor: this.console.length,
      ...snapshot,
    };
    this.frames.push(frame);

    const box = await this.page.locator('.dynamic-message-pane, .timeline-message-list').first().boundingBox()
      || await this.page.locator('main').boundingBox();
    const viewport = this.page.viewportSize();
    if (box && viewport) {
      const x = Math.max(0, box.x);
      const y = Math.max(0, box.y);
      const width = Math.min(viewport.width - x, box.width);
      const height = Math.min(viewport.height - y, box.height);
      if (width > 1 && height > 1) {
        const body = await this.page.screenshot({
          type: 'jpeg',
          quality: 64,
          animations: 'disabled',
          clip: { x, y, width, height },
        });
        this.screenshots.push({
          name: `${String(actionIndex).padStart(2, '0')}-${action.type}-${phase}-${frameIndex}.jpeg`,
          body,
        });
        if (this.screenshots.length > SCREENSHOT_RING_SIZE) this.screenshots.shift();
      }
    }
    return frame;
  }

  async captureFrames(actionIndex, action, phase, inspect, count = FRAMES_PER_ACTION) {
    const values = [];
    for (let frameIndex = 0; frameIndex < count; frameIndex += 1) {
      values.push(await this.capture(actionIndex, action, phase, frameIndex, inspect));
    }
    return values;
  }

  async attach(testInfo, error) {
    const timelineName = `${this.kind}-${this.seed}-timeline.json`;
    const timelinePath = testInfo.outputPath(timelineName);
    await writeFile(timelinePath, JSON.stringify({
        schema: 1,
        kind: this.kind,
        seed: this.seed,
        startedAt: this.startedAt,
        sourceBoundary: await sourceBoundary(),
        failed: Boolean(error),
        error: error ? conciseError(error) : null,
        attribution: {
          programmaticWrites: this.programmaticWrites,
          userDisplacements: this.userDisplacements,
          userCommands: this.userCommands,
        },
        extra: this.extra,
        frames: this.frames,
        console: this.console,
      }, null, 2));
    await testInfo.attach(timelineName, {
      path: timelinePath,
      contentType: 'application/json',
    });
    if (!error) return;
    for (const screenshot of this.screenshots) {
      const screenshotPath = testInfo.outputPath(`${this.kind}-${this.seed}-${screenshot.name}`);
      await writeFile(screenshotPath, screenshot.body);
      await testInfo.attach(`${this.kind}-${this.seed}-${screenshot.name}`, {
        path: screenshotPath,
        contentType: 'image/jpeg',
      });
    }
  }
}

async function inspectFixture(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.timeline-message-list');
    const bounds = root?.getBoundingClientRect();
    const rows = root ? [...root.querySelectorAll('[data-presentation-row-id]')] : [];
    const visible = rows.filter((row) => {
      const rect = row.getBoundingClientRect();
      return bounds && rect.bottom > bounds.top + 0.5 && rect.top < bounds.bottom - 0.5;
    });
    const anchor = window.readingFixture?.anchor?.() || {};
    const session = window.readingFixture?.state?.() || {};
    return {
      href: location.href,
      mode: session.mode || '',
      inputEpoch: Number(session.inputEpoch || 0),
      activationID: session.activationID || '',
      anchor: { id: anchor.id || '', offset: Number(anchor.offset || 0) },
      selection: getSelection()?.toString() || '',
      scrollTop: Number(root?.scrollTop || 0),
      scrollHeight: Number(root?.scrollHeight || 0),
      clientHeight: Number(root?.clientHeight || 0),
      gap: Number((root?.scrollHeight || 0) - (root?.clientHeight || 0) - (root?.scrollTop || 0)),
      materializedIDs: rows.map((row) => row.dataset.presentationRowId || ''),
      visibleDOM: visible.map((row) => ({
        id: row.dataset.presentationRowId || '',
        top: row.getBoundingClientRect().top - bounds.top,
        bottom: row.getBoundingClientRect().bottom - bounds.top,
        html: row.outerHTML.slice(0, 2_000),
      })),
    };
  });
}

async function inspectApp(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const bounds = node.getBoundingClientRect();
      return {
        connected: node.isConnected,
        top: bounds.top,
        right: bounds.right,
        bottom: bounds.bottom,
        left: bounds.left,
        width: bounds.width,
        height: bounds.height,
      };
    };
    const pane = document.querySelector('.dynamic-message-pane');
    const timeline = document.querySelector('.timeline');
    const root = document.querySelector('.timeline-message-list');
    const bounds = root?.getBoundingClientRect();
    const rows = root ? [...root.querySelectorAll('[data-presentation-row-id]')] : [];
    const visible = rows.filter((row) => {
      const rect = row.getBoundingClientRect();
      return bounds && rect.bottom > bounds.top + 0.5 && rect.top < bounds.bottom - 0.5;
    });
    const anchorNode = visible.sort((left, right) => (
      left.getBoundingClientRect().top - right.getBoundingClientRect().top
    ))[0];
    const anchorRect = anchorNode?.getBoundingClientRect();
    const diagnostics = window.__ATOLL_DIAGNOSTICS__?.reading?.snapshot?.();
    const applicationDiagnostics = window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || [];
    const traceEntries = diagnostics?.entries || [];
    const bottomIntents = (diagnostics?.entries || [])
      .filter((entry) => entry.event === 'reading.bottom-intent');
    const lastInput = [...traceEntries].reverse()
      .find((entry) => entry.event === 'reading.input-owner');
    const lastActivation = [...traceEntries].reverse()
      .find((entry) => entry.detail?.activationID)?.detail?.activationID || '';
    const lastObservation = [...traceEntries].reverse()
      .find((entry) => entry.event === 'reading.observation')?.detail || null;
    const issuerWrites = traceEntries.filter((entry) => entry.event === 'reading.issuer-write');
    const submissionEvents = applicationDiagnostics.filter((entry) => entry.event?.startsWith('submission.'));
    return {
      href: location.href,
      channel: document.querySelector('main h1')?.textContent || '',
      paneVisibility: pane ? getComputedStyle(pane).visibility : 'missing',
      mode: timeline?.dataset.viewportMode || '',
      inputEpoch: Number(lastInput?.detail?.inputEpoch || 0),
      activationID: lastActivation,
      anchor: {
        id: anchorNode?.dataset.presentationRowId || '',
        offset: anchorRect && bounds ? anchorRect.top - bounds.top : 0,
      },
      selection: getSelection()?.toString() || '',
      scrollTop: Number(root?.scrollTop || 0),
      scrollHeight: Number(root?.scrollHeight || 0),
      clientHeight: Number(root?.clientHeight || 0),
      gap: Number((root?.scrollHeight || 0) - (root?.clientHeight || 0) - (root?.scrollTop || 0)),
      materializedIDs: rows.map((row) => row.dataset.presentationRowId || ''),
      visibleDOM: visible.map((row) => ({
        id: row.dataset.presentationRowId || '',
        top: row.getBoundingClientRect().top - bounds.top,
        bottom: row.getBoundingClientRect().bottom - bounds.top,
        html: row.outerHTML.slice(0, 2_000),
      })),
      diagnosticsCursor: Number(diagnostics?.entries?.at(-1)?.sequence || 0),
      bottomIntentCount: bottomIntents.length,
      bottomIntentReasons: bottomIntents.map((entry) => entry.detail?.reason || entry.reason || ''),
      unseenArrivalCount: traceEntries
        .filter((entry) => entry.event === 'reading.unseen-arrival').length,
      installedHighSeq: Number(lastObservation?.installedHighSeq || 0),
      observationSurface: lastObservation ? {
        source: lastObservation.source || '',
        atTail: Boolean(lastObservation.atTail),
        activationID: lastObservation.activationID || '',
      } : null,
      jumpLatestText: document.querySelector('.timeline-jump-latest')?.textContent || '',
      issuerWriteCount: issuerWrites.length,
      issuerWrites: issuerWrites.map((entry) => ({
        sequence: entry.sequence,
        source: entry.detail?.source || '',
        intentID: entry.detail?.intentID || '',
        scrollTop: Number(entry.detail?.scrollTop || 0),
        scrollHeight: Number(entry.detail?.scrollHeight || 0),
        clientHeight: Number(entry.detail?.clientHeight || 0),
      })),
      bottomIntentIDs: traceEntries.flatMap((entry) => {
        const id = entry.detail?.bottomIntentID || entry.detail?.intentID || '';
        return id ? [id] : [];
      }),
      submissionPhases: Object.fromEntries([
        'submission.outbox_accepted',
        'submission.transmit_started',
        'submission.receipt_accepted',
        'submission.feed_landed',
      ].map((event) => [event, submissionEvents.filter((entry) => entry.event === event).length])),
      submissionTail: submissionEvents.slice(-12).map((entry) => ({ event: entry.event, detail: entry.detail })),
      waiting: {
        mounted: Boolean(document.querySelector('.agent-wait-layer')),
        itemCount: document.querySelectorAll('.agent-wait-item').length,
        geometry: rect('.agent-wait-layer'),
      },
      bottomGeometry: {
        stack: rect('.conversation-bottom-stack'),
        input: rect('.composer-surface'),
        floating: rect('.conversation-floating-slot'),
        composer: rect('.composer-wrap'),
      },
      historySatisfiedCount: applicationDiagnostics
        .filter((entry) => entry.event === 'history.intent_satisfied').length,
      recentApplicationEvents: applicationDiagnostics.slice(-12).map((entry) => ({
        event: entry.event,
        detail: entry.detail,
      })),
    };
  });
}

function frameViolations(frame, { requireVisible = true } = {}) {
  const failures = [];
  const ids = frame.materializedIDs || [];
  if (new Set(ids).size !== ids.length) failures.push({ kind: 'duplicate-semantic-row', frame });
  if (requireVisible && frame.paneVisibility !== 'hidden' && !frame.visibleDOM?.length) {
    failures.push({ kind: 'empty-visible-roi', frame });
  }
  return failures;
}

async function openFixture(page) {
  await page.goto('/tests/browser/fixtures/reading-viewport.html');
  await page.waitForFunction(() => window.readingFixture?.anchor().id);
  await page.waitForTimeout(160);
}

async function selectVisibleText(page) {
  const points = await page.evaluate(() => {
    const root = document.querySelector('.timeline-message-list');
    const bounds = root.getBoundingClientRect();
    const blocks = [...root.querySelectorAll('[data-reading-block-id]')].filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.top > bounds.top + 30 && rect.bottom < bounds.bottom - 30;
    });
    const start = blocks[0]?.getBoundingClientRect();
    const end = blocks[Math.min(2, blocks.length - 1)]?.getBoundingClientRect();
    return start && end ? {
      start: { x: start.left + 8, y: start.top + 8 },
      end: { x: Math.min(end.right - 8, end.left + 120), y: end.bottom - 8 },
    } : null;
  });
  if (!points) throw new Error('no stable visible text blocks for native selection');
  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 6 });
  await page.mouse.up();
}

async function applyFixtureAction(page, action, viewportState) {
  if (action.type === 'follow') {
    await page.evaluate(() => window.readingFixture.returnToBottom());
  } else if (action.type === 'browse') {
    await page.locator('.timeline-message-list').hover();
    await page.mouse.wheel(0, -720);
  } else if (action.type === 'selection') {
    await selectVisibleText(page);
  } else if (action.type === 'append') {
    await page.evaluate(() => window.readingFixture.append());
  } else if (action.type === 'prepend') {
    await page.evaluate(() => window.readingFixture.prepend());
  } else if (action.type === 'resize-tail') {
    await page.evaluate(() => window.readingFixture.growTail());
  } else if (action.type === 'resize-viewport') {
    viewportState.tall = !viewportState.tall;
    await page.evaluate((height) => {
      document.getElementById('root').style.height = `${height}px`;
      window.dispatchEvent(new Event('resize'));
    }, viewportState.tall ? 660 : 540);
  } else {
    throw new Error(`unknown fixture fuzz action: ${action.type}`);
  }
}

for (const seed of FIXTURE_SEEDS) {
  test(`UX-FUZZ fixture reference model keeps source writes separate from reader movement seed=${seed}`, async ({ page }, testInfo) => {
    const evidence = new FrameEvidence(page, seed, 'fixture');
    const model = new ReadingReferenceModel();
    const viewportState = { tall: false };
    let failure = null;
    try {
      await openFixture(page);
      await page.evaluate((value) => window.__ATOLL_DIAGNOSTICS__.reading.enable({
        case: 'conversation-ux-reference-fuzz',
        seed: value,
      }), seed);
      const violations = [];
      const plan = fixturePlan(seed);
      for (let index = 0; index < plan.length; index += 1) {
        const action = plan[index];
        const before = await inspectFixture(page);
        const expected = model.apply(action);
        await applyFixtureAction(page, action, viewportState);
        const frames = await evidence.captureFrames(index, action, 'after', () => inspectFixture(page));
        const after = frames.at(-1);
        evidence.noteAction(action, before, after);
        for (const frame of frames) violations.push(...frameViolations(frame));

        if (after.mode !== expected.mode) {
          violations.push({ kind: 'reference-mode-mismatch', action, expected, before, frames });
        }
        if (action.origin === 'program-source' && after.inputEpoch !== before.inputEpoch) {
          violations.push({ kind: 'program-write-claimed-input-epoch', action, before, after });
        }
        if (action.origin === 'program-source' && expected.mode === 'browsing'
          && before.anchor.id && action.type !== 'resize-viewport') {
          if (after.anchor.id !== before.anchor.id || Math.abs(after.anchor.offset - before.anchor.offset) > 2) {
            violations.push({ kind: 'browsing-anchor-drift', action, before, frames });
          }
        }
        if (action.origin === 'program-source' && expected.mode === 'following' && after.gap > 24) {
          violations.push({ kind: 'following-tail-lost', action, before, frames });
        }
        if (action.type === 'selection' && after.selection.length < 2) {
          violations.push({ kind: 'native-selection-missing', action, before, frames });
        }
        if (action.type === 'browse' && after.scrollTop >= before.scrollTop - 1) {
          violations.push({ kind: 'native-wheel-did-not-move', action, before, frames });
        }
      }
      evidence.extra.violations = violations;
      expect(
        violations.map((violation) => violation.kind),
        JSON.stringify({ seed, violations: violations.map((violation) => violation.kind) }),
      ).toEqual([]);
    } catch (error) {
      failure = error;
      try {
        await evidence.capture(999, { type: 'failure', origin: 'observation' }, 'failure', 0, () => inspectFixture(page));
      } catch (captureError) {
        evidence.console.push({ at: Date.now(), type: 'evidence-error', text: String(captureError?.stack || captureError) });
      }
      throw error;
    } finally {
      await evidence.attach(testInfo, failure);
    }
  });
}

async function reset(request, seed, scenario = 'deep-history') {
  const response = await request.post(`${MOCK}/mock/control/reset`, {
    data: { scenario, seed },
  });
  expect(response.ok()).toBe(true);
}

async function login(page, { requireRows = true } = {}) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
  if (requireRows) await expect(page.locator('.timeline-message-list [data-presentation-row-id]').first()).toBeVisible();
}

async function chooseSteward(page) {
  const choose = page.getByRole('button', { name: '选择 Agent' });
  if (!await choose.isVisible().catch(() => false)) return;
  await choose.click();
  await page.getByRole('menu', { name: '选择目标 Agent' })
    .getByRole('menuitem', { name: 'steward' }).click();
}

async function settleFrames(page, evidence, index, action) {
  return evidence.captureFrames(index, action, 'after', () => inspectApp(page));
}

async function integrationAction({ action, page, request, seed, index, model, evidence }) {
  let before = await inspectApp(page);
  const expected = model.apply(action);
  const actionEvidence = {};

  if (action.type === 'browse') {
    await page.locator('.timeline-message-list').hover();
    await page.mouse.wheel(0, -900);
  } else if (action.type === 'append') {
    for (let pulse = 0; pulse < (action.count || 1); pulse += 1) {
      const response = await request.post(`${MOCK}/mock/control/action`, { data: { type: 'pulse' } });
      expect(response.ok()).toBe(true);
    }
    if (!expected.visible) await expect(page.locator('.timeline-jump-latest')).toHaveText(/条新动态/);
  } else if (action.type === 'resize-viewport') {
    await page.setViewportSize(action.size);
  } else if (action.type === 'fold') {
    const toggle = page.locator('.message-fold-toggle').filter({ hasText: action.expand ? /展开全文/ : /收起/ }).last();
    await expect(toggle).toBeVisible();
    actionEvidence.foldBefore = await toggle.evaluate((node) => ({
      foldID: node.dataset.foldId || '',
      rowID: node.closest('[data-presentation-row-id]')?.dataset.presentationRowId || '',
      top: node.getBoundingClientRect().top,
      expanded: node.getAttribute('aria-expanded'),
      connected: node.isConnected,
    }));
    await toggle.click();
  } else if (action.type === 'send') {
    const text = action.long
      ? Array.from({ length: 45 }, (_, line) => `UX fuzz ${seed} line ${line + 1}`).join('\n')
      : `UX fuzz ${seed} submit ${index}`;
    await page.getByTestId('composer-input').fill(text);
    await page.getByRole('button', { name: /发送/ }).click();
    actionEvidence.sendVisible = await page.getByText(text.split('\n')[0], { exact: false }).last()
      .waitFor({ state: 'visible', timeout: 2_500 }).then(() => true, () => false);
  } else if (action.type === 'hide' || action.type === 'show') {
    if (action.type === 'hide') await page.setViewportSize({ width: 390, height: 844 });
    // Both actions begin on the mobile viewport.  Avoid racing the responsive
    // desktop toggle between isVisible() and click() while CSS is settling.
    await page.getByRole('button', { name: '频道操作' }).click();
    await page.getByRole('menuitem', { name: action.type === 'hide' ? '打开文件' : '关闭文件' }).click();
    await expect.poll(() => page.locator('.dynamic-message-pane').evaluate(
      (node) => getComputedStyle(node).visibility,
    )).toBe(action.type === 'hide' ? 'hidden' : 'visible');
    if (action.type === 'show') await page.setViewportSize({ width: 1120, height: 760 });
  } else if (action.type === 'switch') {
    const target = page.locator('.channel-item').filter({
      has: page.locator('.channel-name', { hasText: new RegExp(`^${action.channel.replace('.', '\\.')}$`) }),
    });
    await target.click();
    await expect(page.locator('main h1')).toHaveText(action.channel);
    await expect(page.locator('.timeline-message-list [data-presentation-row-id]').first()).toBeVisible();
  } else if (action.type === 'selection') {
    const points = await page.evaluate(() => {
      const root = document.querySelector('.timeline-message-list');
      const bounds = root.getBoundingClientRect();
      const textNodes = [...root.querySelectorAll('[data-presentation-row-id] p, [data-presentation-row-id] .markdown-body')]
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return node.textContent.trim().length > 12 && rect.top > bounds.top + 20 && rect.bottom < bounds.bottom - 20;
        });
      const start = textNodes[0]?.getBoundingClientRect();
      const end = textNodes[Math.min(1, textNodes.length - 1)]?.getBoundingClientRect();
      return start && end ? {
        start: { x: start.left + 6, y: start.top + Math.min(12, start.height / 2) },
        end: { x: Math.min(end.right - 6, end.left + 140), y: end.bottom - Math.min(8, end.height / 3) },
      } : null;
    });
    if (!points) throw new Error('no integration text nodes available for selection');
    await page.mouse.move(points.start.x, points.start.y);
    await page.mouse.down();
    await page.mouse.move(points.end.x, points.end.y, { steps: 6 });
    await page.mouse.up();
  } else if (action.type === 'prepend') {
    const satisfiedCount = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
      .filter((entry) => entry.event === 'history.intent_satisfied').length);
    const demandBefore = before;
    await page.locator('.timeline-message-list').hover();
    await page.mouse.wheel(0, -100_000);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const demandAfter = await inspectApp(page);
    evidence.noteAction({ type: 'history-demand', origin: 'user-displacement' }, demandBefore, demandAfter);
    // Attribute the native displacement above to the reader.  Everything from
    // this point through the new prefix commit is the program/source write.
    before = demandAfter;
    await expect.poll(() => page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.snapshot()
      .filter((entry) => entry.event === 'history.intent_satisfied').length)).toBeGreaterThan(satisfiedCount);
  } else {
    throw new Error(`unknown integration fuzz action: ${action.type}`);
  }

  const frames = await settleFrames(page, evidence, index, action);
  const after = frames.at(-1);
  if (action.type === 'fold') {
    actionEvidence.foldAfter = await page.evaluate((foldID) => {
      const node = [...document.querySelectorAll('.message-fold-toggle')]
        .find((candidate) => candidate.dataset.foldId === foldID);
      return node ? {
        foldID,
        rowID: node.closest('[data-presentation-row-id]')?.dataset.presentationRowId || '',
        top: node.getBoundingClientRect().top,
        expanded: node.getAttribute('aria-expanded'),
        connected: node.isConnected,
      } : { foldID, rowID: '', top: null, expanded: null, connected: false };
    }, actionEvidence.foldBefore.foldID);
  }
  evidence.noteAction(action, before, after);
  return { before, after, frames, expected, actionEvidence };
}

function integrationPlan(seed) {
  const resizes = shuffled([
    { width: 1120, height: 760 },
    { width: 980, height: 690 },
  ], seed);
  return [
    { type: 'send', long: true, origin: 'user-command' },
    // All untouched long bodies, including latest, default folded.  Exercise
    // both directions explicitly before the later source/layout events.
    { type: 'fold', expand: true, origin: 'user-command' },
    { type: 'fold', expand: false, origin: 'user-command' },
    { type: 'send', origin: 'user-command' },
    { type: 'hide', origin: 'user-command' },
    { type: 'append', count: 1, origin: 'program-source' },
    { type: 'show', origin: 'user-command' },
    { type: 'browse', origin: 'user-displacement' },
    { type: 'append', count: 2, origin: 'program-source' },
    { type: 'resize-viewport', size: resizes[0], origin: 'program-source' },
    { type: 'selection', origin: 'user-displacement' },
    { type: 'switch', channel: 'c0.project', origin: 'user-command' },
    { type: 'browse', origin: 'user-displacement' },
    { type: 'resize-viewport', size: resizes[1], origin: 'program-source' },
    { type: 'switch', channel: 'c0', origin: 'user-command' },
    { type: 'prepend', origin: 'program-source' },
  ];
}

for (const seed of INTEGRATION_SEEDS) {
  test(`UX-FUZZ integrated fold/send/channel/hidden/selection model seed=${seed}`, async ({ page, request }, testInfo) => {
    test.slow();
    const evidence = new FrameEvidence(page, seed, 'integration');
    const model = new ReadingReferenceModel('c0');
    let failure = null;
    try {
      await page.setViewportSize({ width: 1120, height: 760 });
      await reset(request, seed);
      await login(page);
      await page.evaluate((value) => window.__ATOLL_DIAGNOSTICS__.reading.enable({
        case: 'conversation-ux-integration-fuzz',
        seed: value,
      }), seed);
      const violations = [];
      const plan = integrationPlan(seed);
      for (let index = 0; index < plan.length; index += 1) {
        const action = plan[index];
        const result = await integrationAction({ action, page, request, seed, index, model, evidence });
        for (const frame of result.frames) {
          violations.push(...frameViolations(frame, { requireVisible: result.expected.visible }));
        }
        if (result.after.channel !== result.expected.channel) {
          violations.push({ kind: 'channel-model-mismatch', action, result });
        }
        if (result.after.paneVisibility !== (result.expected.visible ? 'visible' : 'hidden')) {
          violations.push({ kind: 'surface-visibility-mismatch', action, result });
        }
        if (result.after.mode !== result.expected.mode) {
          violations.push({ kind: 'reading-mode-mismatch', action, result });
        }
        if (action.origin === 'program-source' && result.before.mode === 'browsing'
          && result.after.mode !== 'browsing') {
          violations.push({ kind: 'program-source-reclaimed-reader', action, result });
        }
        if (action.type === 'send'
          && result.after.bottomIntentCount - result.before.bottomIntentCount !== 1) {
          violations.push({ kind: 'send-did-not-mint-exactly-one-bottom-intent', action, result });
        }
        if (action.type === 'send' && !result.actionEvidence.sendVisible) {
          violations.push({ kind: 'send-not-visible-after-click', action, result });
        }
        if (action.origin === 'program-source'
          && result.after.bottomIntentCount > result.before.bottomIntentCount) {
          violations.push({ kind: 'late-source-minted-bottom-intent', action, result });
        }
        if (action.type === 'append' && result.expected.visible === false
          && !result.after.jumpLatestText.trim()) {
          violations.push({ kind: 'hidden-arrival-was-acknowledged-by-old-dom', action, result });
        }
        if (action.type === 'switch' && result.before.activationID
          && result.after.activationID === result.before.activationID) {
          violations.push({ kind: 'channel-switch-reused-activation', action, result });
        }
        if (action.type === 'selection' && result.after.selection.length < 2) {
          violations.push({ kind: 'selection-lost-before-observation', action, result });
        }
        if (action.type === 'fold' && action.expand === false) {
          const foldBefore = result.actionEvidence.foldBefore;
          const foldAfter = result.actionEvidence.foldAfter;
          if (!foldAfter.connected || foldAfter.rowID !== foldBefore.rowID
            || Math.abs(Number(foldAfter.top) - Number(foldBefore.top)) > 1) {
            violations.push({ kind: 'collapse-control-jumped-or-disconnected', action, result });
          }
        }
      }
      evidence.extra.violations = violations;
      expect(
        violations.map((violation) => violation.kind),
        JSON.stringify({ seed, violations: violations.map((violation) => violation.kind) }),
      ).toEqual([]);
    } catch (error) {
      failure = error;
      try {
        await evidence.capture(999, { type: 'failure', origin: 'observation' }, 'failure', 0, () => inspectApp(page));
      } catch (captureError) {
        evidence.console.push({ at: Date.now(), type: 'evidence-error', text: String(captureError?.stack || captureError) });
      }
      throw error;
    } finally {
      await evidence.attach(testInfo, failure);
    }
  });
}

async function startSendPhaseProbe(page) {
  await page.evaluate(() => {
    const frames = [];
    let running = true;
    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const value = node.getBoundingClientRect();
      return { top: value.top, bottom: value.bottom, left: value.left, right: value.right, width: value.width, height: value.height };
    };
    const sample = (at) => {
      if (!running) return;
      const root = document.querySelector('.timeline-message-list');
      const reading = window.__ATOLL_DIAGNOSTICS__.reading.snapshot();
      const application = window.__ATOLL_DIAGNOSTICS__.snapshot();
      const relevant = reading.entries.filter((entry) => [
        'reading.bottom-intent',
        'reading.issuer-enter',
        'reading.issuer-write',
        'reading.issuer-reject',
        'reading.list-height',
        'reading.scroller-resize',
        'reading.range',
        'reading.scroll-observed',
      ].includes(entry.event));
      const submissions = application.filter((entry) => entry.event?.startsWith('submission.'));
      frames.push({
        frame: frames.length,
        at,
        mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
        scrollTop: Number(root?.scrollTop || 0),
        scrollHeight: Number(root?.scrollHeight || 0),
        clientHeight: Number(root?.clientHeight || 0),
        gap: Number((root?.scrollHeight || 0) - (root?.clientHeight || 0) - (root?.scrollTop || 0)),
        rowIDs: [...(root?.querySelectorAll('[data-presentation-row-id]') || [])]
          .map((node) => node.dataset.presentationRowId || ''),
        waitingMounted: Boolean(document.querySelector('.agent-wait-layer')),
        waitingItems: document.querySelectorAll('.agent-wait-item').length,
        waitingText: document.querySelector('.agent-wait-layer')?.textContent || '',
        waitingItemTexts: [...document.querySelectorAll('.agent-wait-item')]
          .map((node) => node.textContent || ''),
        geometry: {
          stack: rect('.conversation-bottom-stack'),
          input: rect('.composer-surface'),
          floating: rect('.conversation-floating-slot'),
          composer: rect('.composer-wrap'),
          waiting: rect('.agent-wait-layer'),
        },
        bottomIntentCount: relevant.filter((entry) => entry.event === 'reading.bottom-intent').length,
        issuerWriteCount: relevant.filter((entry) => entry.event === 'reading.issuer-write').length,
        readingEvents: relevant.map((entry) => ({ sequence: entry.sequence, event: entry.event, detail: entry.detail })),
        submissionEvents: submissions.map((entry) => ({ event: entry.event, detail: entry.detail })),
      });
      if (frames.length < 240) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    window.__uxSendPhaseProbe = {
      stop() {
        running = false;
        return frames;
      },
    };
  });
}

for (const { seed, mode: startingMode } of SEND_WAITING_CASES) {
  test(`UX-FUZZ real ${startingMode} send to waiting has one intent and no waiting-owned geometry write seed=${seed}`, async ({ page, request }, testInfo) => {
  const evidence = new FrameEvidence(page, seed, `send-waiting-${startingMode}`);
  let failure = null;
  try {
    await page.setViewportSize({ width: 1120, height: 760 });
    await reset(request, seed, 'long-running');
    await login(page, { requireRows: false });
    await chooseSteward(page);

    const editor = page.getByTestId('composer-input');
    const activeText = startingMode === 'browsing'
      ? Array.from({ length: 45 }, (_, line) => `UX fuzz active ${seed} line ${line + 1}`).join('\n')
      : `UX fuzz active ${seed}`;
    await editor.fill(activeText);
    await page.getByRole('button', { name: /发送/ }).click();
    await expect(page.getByText(activeText.split('\n')[0], { exact: true })).toBeVisible();
    if (startingMode === 'browsing') {
      const activeRow = page.locator('[data-presentation-row-id]').filter({ hasText: activeText.split('\n')[0] });
      const expand = activeRow.locator('.message-fold-toggle[aria-expanded="false"]');
      await expect(expand).toBeVisible();
      await expand.click();
      await page.locator('.timeline-message-list').hover();
      await page.mouse.wheel(0, -900);
      await expect(page.locator('.timeline')).toHaveAttribute('data-viewport-mode', 'browsing');
    }

    await page.evaluate(({ value, startingMode: mode }) => window.__ATOLL_DIAGNOSTICS__.reading.enable({
      case: 'conversation-send-waiting-phase-fuzz',
      seed: value,
      startingMode: mode,
    }), { value: seed, startingMode });
    const text = `UX fuzz queued ${seed}`;
    await editor.fill(text);
    await expect(page.getByRole('button', { name: /发送/ })).toBeEnabled();
    const before = await evidence.capture(0, { type: 'send-waiting', origin: 'user-command' }, 'before-send', 0, () => inspectApp(page));
    await startSendPhaseProbe(page);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    await page.getByRole('button', { name: /发送/ }).click();
    const waitingItemBaseline = before.waiting.itemCount;
    const waitingItemMounted = await expect.poll(
      () => page.locator('.agent-wait-item').count(),
      { timeout: 1_500 },
    ).toBeGreaterThan(waitingItemBaseline).then(() => true, () => false);
    const afterFrames = await evidence.captureFrames(
      0,
      { type: 'send-waiting', origin: 'user-command' },
      'waiting-mounted',
      () => inspectApp(page),
      6,
    );
    await page.waitForTimeout(120);
    const phaseFrames = await page.evaluate(() => window.__uxSendPhaseProbe.stop());
    const after = afterFrames.at(-1);
    evidence.noteAction({ type: 'send-waiting', origin: 'user-command' }, before, after);
    evidence.extra.sendPhaseFrames = phaseFrames;

    const violations = [];
    if (after.bottomIntentCount - before.bottomIntentCount !== 1) {
      violations.push({ kind: 'send-phase-bottom-intent-count', before, after });
    }
    if (after.gap > 24) {
      violations.push({ kind: 'send-did-not-reach-tail', before, after, phaseFrames });
    }
    const firstProbe = phaseFrames[0];
    const finalProbe = phaseFrames.at(-1);
    const waitingIndex = phaseFrames.findIndex((frame) => (
      frame.waitingMounted && frame.waitingItems > waitingItemBaseline
    ));
    if (!waitingItemMounted || waitingIndex < 0) {
      violations.push({ kind: 'waiting-layer-never-mounted', phaseFrames });
    }
    if (waitingIndex > 0) {
      const prior = phaseFrames[waitingIndex - 1];
      const mounted = phaseFrames[waitingIndex];
      if (mounted.issuerWriteCount - firstProbe.issuerWriteCount > 1) {
        violations.push({ kind: 'send-issued-more-than-one-scroll-write', firstProbe, prior, mounted });
      }
      const postMountWrite = phaseFrames.slice(waitingIndex + 1)
        .find((frame) => frame.issuerWriteCount > mounted.issuerWriteCount);
      if (postMountWrite) {
        violations.push({ kind: 'post-waiting-mount-issued-scroll-write', mounted, postMountWrite });
      }
      for (const key of ['stack', 'input', 'composer']) {
        if (JSON.stringify(mounted.geometry[key]) !== JSON.stringify(prior.geometry[key])) {
          violations.push({ kind: 'waiting-mount-changed-input-geometry', key, prior, mounted });
        }
      }
    }
    if (finalProbe?.bottomIntentCount !== 1) {
      violations.push({ kind: 'accept-receipt-feed-minted-another-intent', phaseFrames });
    }
    for (const required of [
      'submission.outbox_accepted',
      'submission.transmit_started',
      'submission.receipt_accepted',
      'submission.feed_landed',
    ]) {
      const beforeCount = firstProbe?.submissionEvents.filter((entry) => entry.event === required).length || 0;
      const afterCount = finalProbe?.submissionEvents.filter((entry) => entry.event === required).length || 0;
      if (afterCount <= beforeCount) violations.push({ kind: 'missing-submission-phase', required, beforeCount, afterCount, phaseFrames });
    }
    evidence.extra.violations = violations;
    expect(
      violations.map((violation) => violation.kind),
      JSON.stringify({ seed, startingMode, violations: violations.map((violation) => violation.kind) }),
    ).toEqual([]);
  } catch (error) {
    failure = error;
    try {
      evidence.extra.sendPhaseFrames ||= await page.evaluate(() => window.__uxSendPhaseProbe?.stop?.() || []);
      await evidence.capture(999, { type: 'failure', origin: 'observation' }, 'failure', 0, () => inspectApp(page));
    } catch (captureError) {
      evidence.console.push({ at: Date.now(), type: 'evidence-error', text: String(captureError?.stack || captureError) });
    }
    throw error;
  } finally {
    await evidence.attach(testInfo, failure);
  }
  });
}
