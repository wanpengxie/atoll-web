import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// "ResizeObserver loop completed with undelivered notifications."
//
// Chromium raises this only through the in-page `error` event. Playwright's
// `pageerror` and `console` channels never see it — the first test in this file
// proves that by building a loop on purpose and reading all four channels. A
// spec that watches only the Playwright channels cannot claim the error is
// absent, so everything below reads the two channels that were shown to work:
// the in-page `error` listener and the app's own `window.resize_observer_loop`
// diagnostic.
//
// `unsettled` is the structural form of the same defect and fires earlier than
// the browser error: a box that is still changing size after its own observer
// callback returned is, by definition, a notification that delivery pass could
// not deliver.

const INSTRUMENT = () => {
  const log = { frame: 0, stage: 'boot', loops: [], unsettled: [], deliveries: 0 };
  window.__roProbe = log;
  const tick = () => { log.frame += 1; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const Native = window.ResizeObserver;
  const shape = (entry) => ({
    cls: String(entry.target.className || '').slice(0, 70),
    tid: entry.target.getAttribute?.('data-testid') || '',
    content: Math.round(entry.contentRect.height),
    border: Math.round(entry.borderBoxSize?.[0]?.blockSize ?? 0),
  });
  window.ResizeObserver = class InstrumentedResizeObserver extends Native {
    constructor(callback) {
      super((entries, observer) => {
        const before = entries.map(shape);
        callback(entries, observer);
        const after = entries.map((entry) => Math.round(entry.target.getBoundingClientRect().height));
        const moved = before
          .map((row, index) => (row.border && after[index] !== row.border ? { ...row, after: after[index] } : null))
          .filter(Boolean);
        if (moved.length) {
          log.unsettled.push({ frame: log.frame, stage: log.stage, moved });
          if (log.unsettled.length > 400) log.unsettled.splice(0, 200);
        }
        log.deliveries += 1;
      });
    }
  };
  window.addEventListener('error', (event) => {
    if (!/ResizeObserver loop/.test(String(event.message || ''))) return;
    const surface = document.querySelector('.conversation-surface');
    log.loops.push({
      frame: log.frame,
      stage: log.stage,
      message: String(event.message),
      growth: surface?.getAttribute('data-input-resize-growth') || '',
      phase: surface?.getAttribute('data-input-resize-transition') || '',
    });
  });
};

const readProbe = (page) => page.evaluate(() => ({
  loops: window.__roProbe.loops,
  unsettled: window.__roProbe.unsettled,
  deliveries: window.__roProbe.deliveries,
  diagnostics: (window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || [])
    .filter((entry) => entry.event === 'window.resize_observer_loop').length,
}));

const mark = (page, stage) => page.evaluate((value) => { window.__roProbe.stage = value; }, stage);

test('the detector is live: a deliberate loop is seen on both production channels', async ({ page }) => {
  const playwrightChannels = [];
  page.on('pageerror', (error) => {
    if (/ResizeObserver loop/.test(String(error?.message || error))) playwrightChannels.push('pageerror');
  });
  page.on('console', (message) => {
    if (/ResizeObserver loop/.test(message.text())) playwrightChannels.push('console');
  });
  await page.addInitScript(INSTRUMENT);
  await page.goto('/');
  await page.evaluate(() => {
    const outer = document.createElement('div');
    const inner = document.createElement('div');
    inner.style.height = '10px';
    outer.append(inner);
    document.body.append(outer);
    let grown = 0;
    // Depth-ordered feedback: the callback resizes a deeper observed element,
    // so the pass ends with a notification it could not deliver.
    const observer = new ResizeObserver(() => {
      if (grown >= 40) return;
      grown += 1;
      inner.style.height = `${10 + grown * 7}px`;
      inner.getBoundingClientRect();
    });
    observer.observe(outer);
    observer.observe(inner);
    window.__roControl = () => {
      outer.style.paddingTop = `${grown % 2 === 0 ? 4 : 9}px`;
    };
  });
  for (let round = 0; round < 12; round += 1) {
    await page.evaluate(() => window.__roControl());
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(400);
  const probe = await readProbe(page);
  console.log(JSON.stringify({ control: { ...probe, unsettled: probe.unsettled.length, loops: probe.loops.length }, playwrightChannels }));
  expect(probe.deliveries, 'the wrapper must actually wrap the app-visible ResizeObserver').toBeGreaterThan(0);
  expect(probe.loops.length, 'in-page error listener').toBeGreaterThan(0);
  expect(probe.diagnostics, "the app's own window.resize_observer_loop diagnostic").toBeGreaterThan(0);
  expect(probe.unsettled.length, 'same-delivery size-change detector').toBeGreaterThan(0);
  // Recorded, not a bug in the app: this is why the assertions below never use
  // Playwright's own error channels.
  expect(playwrightChannels, 'Playwright channels are blind to this error').toEqual([]);
});

async function reset(request, scenario, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed } });
  if (!response.ok()) throw new Error(`mock reset failed: ${response.status()} ${await response.text()}`);
}

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await page.waitForFunction(() => document.querySelector('.connection-state.state-open'));
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'c0');
  await page.waitForFunction(() => document.querySelector('.timeline-message-list')?.clientHeight > 0);
}

// Reach the tail by the reader's own displacement — no scrollTo from the test.
async function settleAtTail(page) {
  await page.locator('.timeline-message-list').hover();
  const following = () => page.evaluate(
    () => document.querySelector('.timeline')?.dataset.viewportMode === 'following',
  );
  // How far the tail is depends on how far up the previous stage travelled and
  // on how much history the list has since materialized. Keep displacing until
  // the production reading session publishes `following`.
  for (let round = 0; round < 90 && !(await following()); round += 1) {
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(60);
  }
  await page.waitForFunction(
    () => document.querySelector('.timeline')?.dataset.viewportMode === 'following',
    null,
    { timeout: 20_000 },
  );
}

async function pushProgress(request, requestId, step) {
  const body = Array.from({ length: step * 2 }, (_, line) => (
    `第 ${step} 轮正文第 ${line + 1} 行，持续增长的流式输出，用来让这一行在测量之后改变高度。`
  )).join('\n\n');
  return request.post(`${MOCK}/mock/control/action`, {
    data: {
      type: 'push_provisional',
      channel_id: 'c0',
      request_id: requestId,
      status: 'processing',
      payload: {
        turn_index: 1,
        controls: ['agent.interrupt', 'agent.hold'],
        process: { kind: 'stage', stage: 'thinking', text: `步骤 ${step}` },
        text: body,
      },
    },
  });
}

async function growEditor(page, prefix, lines) {
  const editor = page.getByLabel('消息');
  for (let line = 0; line < lines; line += 1) {
    await editor.press('Shift+Enter');
    await editor.pressSequentially(`${prefix}-${line} 撑高输入区`);
  }
}

async function clearEditor(page) {
  const editor = page.getByLabel('消息');
  await editor.press('Control+A');
  await editor.press('Backspace');
}

for (const scenario of ['long-running-history', 'huge-history']) {
  test(`no ResizeObserver loop on the production path — ${scenario}`, async ({ page, request }, testInfo) => {
    test.setTimeout(240_000);
    await page.addInitScript(INSTRUMENT);
    await page.setViewportSize({ width: 1120, height: 760 });
    await reset(request, scenario, 0x92_09_30);
    await login(page);

    const stages = [];
    const record = async (stage) => {
      const probe = await readProbe(page);
      const row = { stage, loops: probe.loops.length, unsettled: probe.unsettled.length, diagnostics: probe.diagnostics, deliveries: probe.deliveries };
      stages.push(row);
      console.log('STAGE ' + JSON.stringify(row));
    };
    await record('boot');

    await mark(page, 'tail');
    await settleAtTail(page);
    await page.waitForTimeout(400);
    await record('tail');

    // Input growth while following: the surface installs the tail spacer and
    // the transform on Virtuoso's own List element.
    await mark(page, 'growth-following');
    await page.getByLabel('消息').click();
    for (let round = 0; round < 3; round += 1) {
      await growEditor(page, `follow-${round}`, 5);
      await page.waitForTimeout(350);
      await clearEditor(page);
      await page.waitForTimeout(300);
    }
    await record('growth-following');

    // Message sync and page layout on the same element at the same time.
    await mark(page, 'stream-during-growth');
    for (let round = 1; round <= 4; round += 1) {
      await Promise.all([
        growEditor(page, `collide-${round}`, 4),
        (async () => {
          for (let step = 1; step <= 5; step += 1) {
            await pushProgress(request, `ro-${round}-${step}`, step);
            await page.waitForTimeout(35);
          }
        })(),
      ]);
      await page.waitForTimeout(200);
      await clearEditor(page);
      await page.waitForTimeout(220);
    }
    await record('stream-during-growth');

    // Viewport changes inside the 160ms transition window, so the scroller
    // observer's authorized bottom write lands in the same frames as the
    // spacer animation.
    await mark(page, 'resize-during-growth');
    const heights = [720, 660, 820, 600, 880, 700, 760];
    let index = 0;
    for (let round = 0; round < 5; round += 1) {
      await Promise.all([
        growEditor(page, `resize-${round}`, 3),
        (async () => {
          for (let step = 0; step < 3; step += 1) {
            index = (index + 1) % heights.length;
            await page.setViewportSize({ width: 1120, height: heights[index] });
            await page.waitForTimeout(45);
          }
        })(),
      ]);
      await page.waitForTimeout(150);
      await clearEditor(page);
      await page.waitForTimeout(150);
    }
    await page.setViewportSize({ width: 1120, height: 760 });
    await page.waitForTimeout(400);
    await record('resize-during-growth');

    // Constrained input: --conversation-input-max-height and
    // .is-input-constrained are written onto the surface from inside the
    // surface's own observer callback, and both resize the observed slot.
    await mark(page, 'constrained-boundary');
    await growEditor(page, 'constrain', 24);
    await page.waitForTimeout(500);
    for (let height = 460; height <= 900; height += 10) {
      await page.setViewportSize({ width: 1120, height });
      await page.waitForTimeout(35);
    }
    for (let height = 900; height >= 460; height -= 10) {
      await page.setViewportSize({ width: 1120, height });
      await page.waitForTimeout(35);
    }
    await page.setViewportSize({ width: 1120, height: 760 });
    await page.waitForTimeout(400);
    await clearEditor(page);
    await page.waitForTimeout(300);
    await record('constrained-boundary');

    // Browsing mode: the reader is away from the tail while the same growth
    // decoration is applied to the List.
    await mark(page, 'growth-browsing');
    await page.locator('.timeline-message-list').hover();
    for (let round = 0; round < 10; round += 1) {
      await page.mouse.wheel(0, -700);
      await page.waitForTimeout(50);
    }
    await page.waitForFunction(() => document.querySelector('.timeline')?.dataset.viewportMode === 'browsing');
    await page.getByLabel('消息').click();
    for (let round = 0; round < 3; round += 1) {
      await growEditor(page, `browse-${round}`, 5);
      await page.waitForTimeout(350);
      await clearEditor(page);
      await page.waitForTimeout(300);
    }
    await record('growth-browsing');

    // History prepend, then back to the tail.
    await mark(page, 'prepend');
    await page.locator('.timeline-message-list').hover();
    for (let round = 0; round < 24; round += 1) {
      await page.mouse.wheel(0, -700);
      await page.waitForTimeout(45);
    }
    await page.waitForTimeout(900);
    await record('prepend');

    await mark(page, 'return-to-tail');
    await settleAtTail(page);
    await page.waitForTimeout(600);
    await record('return-to-tail');

    const probe = await readProbe(page);
    await testInfo.attach('resize-observer-loops.json', {
      body: JSON.stringify({ scenario, stages, loops: probe.loops, unsettled: probe.unsettled.slice(-40) }, null, 2),
      contentType: 'application/json',
    });
    console.log(JSON.stringify({ scenario, stages: stages.at(-1), loopCount: probe.loops.length }));
    for (const loop of probe.loops.slice(0, 6)) console.log('LOOP ' + JSON.stringify(loop));
    for (const row of probe.unsettled.slice(0, 10)) console.log('UNSETTLED ' + JSON.stringify(row));

    expect(probe.deliveries, 'the instrumented observer must have run').toBeGreaterThan(0);
    expect(probe.loops, `in-page ResizeObserver loop errors: ${JSON.stringify(stages)}`).toEqual([]);
    expect(probe.diagnostics, `window.resize_observer_loop diagnostics: ${JSON.stringify(stages)}`).toBe(0);
    expect(probe.unsettled, `boxes still resizing after their own delivery: ${JSON.stringify(stages)}`).toEqual([]);
  });
}
