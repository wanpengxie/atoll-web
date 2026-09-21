import { expect, test } from '@playwright/test';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// ResizeObserver loop errors are observable through the page error event, not
// Playwright's pageerror/console channels.  This probe deliberately installs
// before App boot and then uses the real composer/timeline surface.
const installProbe = () => {
  window.__roProbe = { deliveries: 0, loops: [], unsettled: [], stage: 'boot' };
  const Native = window.ResizeObserver;
  const shape = (entry) => ({ height: Math.round(entry.contentRect.height), target: String(entry.target.className || '').slice(0, 80) });
  window.ResizeObserver = class ProbeResizeObserver extends Native {
    constructor(callback) {
      super((entries, observer) => {
        const before = entries.map(shape);
        callback(entries, observer);
        const after = entries.map((entry) => Math.round(entry.target.getBoundingClientRect().height));
        const moved = before.filter((entry, index) => entry.height && after[index] !== entry.height);
        if (moved.length) window.__roProbe.unsettled.push({ stage: window.__roProbe.stage, moved });
        window.__roProbe.deliveries += 1;
      });
    }
  };
  window.addEventListener('error', (event) => {
    if (/ResizeObserver loop/.test(String(event.message || ''))) window.__roProbe.loops.push({ stage: window.__roProbe.stage, message: event.message });
  });
};

async function login(page) {
  await page.goto('/');
  await page.getByRole('textbox', { name: '账号', exact: true }).fill('root');
  await page.getByLabel('密码').fill('root');
  await page.getByRole('button', { name: '进入 Atoll' }).click();
  await expect(page.locator('.connection-state')).toHaveClass(/state-open/);
  await expect(page.locator('main h1')).toHaveText('c0');
}

async function reset(request, scenario, seed) {
  const response = await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed } });
  expect(response.ok()).toBe(true);
}

// The first rows can be mounted in a hidden Virtuoso preparation layer while
// the public active layer is still acquiring its geometry.  A ResizeObserver
// delivery in that phase is initialization evidence, not growth evidence.
// Wait on the public surface itself: one active list, a visible and
// hit-tested presentation row, and the same public identity/geometry over
// consecutive paint frames.  This deliberately does not consult the
// diagnostics bridge, private Reading state, or a fixed timeout as a fence.
async function waitForPublicBootSettled(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const selector = '.timeline-reading-stack > .timeline-reading-layer.is-active > .timeline-message-list';
    const deadline = performance.now() + 60_000;

    const rectShape = (rect) => ({
      top: Math.round(rect.top),
      left: Math.round(rect.left),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });

    const sample = () => {
      const lists = [...document.querySelectorAll(selector)];
      if (lists.length !== 1) return { ready: false, reason: `active-list-count:${lists.length}` };
      const list = lists[0];
      const layer = list.closest('.timeline-reading-layer');
      const listRect = list.getBoundingClientRect();
      const listStyle = getComputedStyle(list);
      const layerStyle = layer ? getComputedStyle(layer) : null;
      const visible = (node, rect, style) => Boolean(
        node
        && rect.width > 0
        && rect.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) > 0.01,
      );
      if (!visible(list, listRect, listStyle) || !visible(layer, layer?.getBoundingClientRect(), layerStyle)) {
        return { ready: false, reason: 'active-list-not-visible' };
      }

      const row = [...list.querySelectorAll('[data-presentation-row-id]')].find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        const style = getComputedStyle(candidate);
        if (!visible(candidate, rect, style)) return false;
        const x = Math.min(window.innerWidth - 1, Math.max(0, rect.left + Math.min(rect.width / 2, 12)));
        const y = Math.min(window.innerHeight - 1, Math.max(0, Math.max(listRect.top, rect.top) + Math.min(rect.height / 2, 12)));
        if (x < listRect.left || x > listRect.right || y < listRect.top || y > listRect.bottom) return false;
        const hit = document.elementFromPoint(x, y);
        return hit === candidate || candidate.contains(hit);
      });
      if (!row) return { ready: false, reason: 'no-visible-hit-tested-row' };

      const rowRect = row.getBoundingClientRect();
      const revisionNode = list.matches('[data-reading-presentation-revision]')
        ? list
        : list.querySelector('[data-reading-presentation-revision]');
      const revision = revisionNode?.getAttribute('data-reading-presentation-revision') || '';
      return {
        ready: true,
        key: [
          row.getAttribute('data-presentation-row-id') || '',
          revision,
          Math.round(list.scrollTop),
          Math.round(list.scrollHeight),
          Math.round(list.clientHeight),
          ...Object.values(rectShape(listRect)),
          ...Object.values(rectShape(rowRect)),
        ].join('|'),
        list: rectShape(listRect),
        row: {
          id: row.getAttribute('data-presentation-row-id') || '',
          rect: rectShape(rowRect),
        },
        revision,
      };
    };

    const same = (left, right) => left.ready && right.ready && left.key === right.key;
    const check = () => {
      if (performance.now() > deadline) {
        reject(new Error('public active reading surface did not settle before timeout'));
        return;
      }
      const first = sample();
      if (!first.ready) {
        requestAnimationFrame(check);
        return;
      }
      requestAnimationFrame(() => {
        const second = sample();
        if (!same(first, second)) {
          check();
          return;
        }
        requestAnimationFrame(() => {
          const third = sample();
          if (same(second, third)) {
            resolve({ ...third, stablePaintFrames: 3 });
            return;
          }
          check();
        });
      });
    };

    check();
  }));
}

async function growEditor(page, prefix, lines = 5) {
  const editor = page.getByLabel('消息');
  await editor.click();
  for (let index = 0; index < lines; index += 1) {
    if (index) await editor.press('Shift+Enter');
    await editor.pressSequentially(`${prefix}-${index} 撑高输入区`);
  }
  await page.waitForTimeout(180);
  await editor.press('Control+A');
  await editor.press('Backspace');
}

test('the detector is live on both browser and application channels', async ({ page }) => {
  const playwrightChannels = [];
  page.on('pageerror', (error) => { if (/ResizeObserver loop/.test(String(error))) playwrightChannels.push('pageerror'); });
  page.on('console', (message) => { if (/ResizeObserver loop/.test(message.text())) playwrightChannels.push('console'); });
  await page.addInitScript(installProbe);
  await page.goto('/');
  await page.evaluate(() => {
    const outer = document.createElement('div');
    const inner = document.createElement('div');
    inner.style.height = '10px'; outer.append(inner); document.body.append(outer);
    let grown = 0;
    const observer = new ResizeObserver(() => {
      if (grown >= 40) return;
      grown += 1; inner.style.height = `${10 + grown * 7}px`; inner.getBoundingClientRect();
    });
    observer.observe(outer); observer.observe(inner);
    window.__roControl = () => { outer.style.paddingTop = `${grown % 2 ? 4 : 9}px`; };
  });
  for (let round = 0; round < 12; round += 1) { await page.evaluate(() => window.__roControl()); await page.waitForTimeout(80); }
  await page.waitForTimeout(350);
  const probe = await page.evaluate(() => ({
    ...window.__roProbe,
    diagnostics: (window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || []).filter((entry) => entry.event === 'window.resize_observer_loop'),
  }));
  expect(probe.deliveries).toBeGreaterThan(0);
  expect(probe.loops.length).toBeGreaterThan(0);
  expect(probe.diagnostics.length).toBeGreaterThan(0);
  expect(probe.unsettled.length).toBeGreaterThan(0);
  expect(playwrightChannels).toEqual([]);
});

for (const scenario of ['long-running-history', 'huge-history']) {
  for (let repetition = 1; repetition <= 5; repetition += 1) {
    test(`no ResizeObserver loop while the production surface grows — ${scenario} (repeat ${repetition}/5)`, async ({ page, request }, testInfo) => {
    test.setTimeout(180_000);
    await page.addInitScript(installProbe);
    await page.setViewportSize({ width: 1120, height: 760 });
    await reset(request, scenario, 0x92_09_30);
    await login(page);
    const bootFence = await waitForPublicBootSettled(page);
    const bootProbe = await page.evaluate(() => ({
      deliveries: window.__roProbe.deliveries,
      loops: [...window.__roProbe.loops],
      unsettled: [...window.__roProbe.unsettled],
      diagnostics: (window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || []).filter((entry) => entry.event === 'window.resize_observer_loop'),
    }));
    // Boot measurements are recorded separately.  Growth assertions start
    // only after the public active surface has been visible, hit-tested, and
    // stable over paint frames; boot evidence remains attached so a
    // regression in initialization is not silently discarded.
    await page.evaluate(() => {
      window.__roProbe.deliveries = 0;
      window.__roProbe.loops = [];
      window.__roProbe.unsettled = [];
      window.__ATOLL_DIAGNOSTICS__.clear();
    });
    for (let round = 0; round < 4; round += 1) {
      await page.evaluate((stage) => { window.__roProbe.stage = stage; }, `growth-${round}`);
      await growEditor(page, `${scenario}-${round}`);
      await page.setViewportSize({ width: 1120, height: 620 + round * 60 });
      await page.waitForTimeout(120);
    }
    await page.setViewportSize({ width: 1120, height: 760 });
    await page.waitForTimeout(300);
    const probe = await page.evaluate(() => ({
      ...window.__roProbe,
      diagnostics: (window.__ATOLL_DIAGNOSTICS__?.snapshot?.() || []).filter((entry) => entry.event === 'window.resize_observer_loop'),
    }));
    await testInfo.attach('resize-observer-loops.json', { body: JSON.stringify({ bootFence, bootProbe, growthProbe: probe }, null, 2), contentType: 'application/json' });
    expect(probe.deliveries).toBeGreaterThan(0);
    expect(probe.loops, JSON.stringify(probe.unsettled.slice(-10))).toEqual([]);
    expect(probe.diagnostics).toEqual([]);
    expect(probe.unsettled).toEqual([]);
    });
  }
}
