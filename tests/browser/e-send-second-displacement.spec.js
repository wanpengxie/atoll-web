import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { MOCK_ORIGIN as MOCK } from './mock-origin.js';

// Agent E diagnostic. e-send-scroll-writers proved there is exactly ONE
// JavaScript write on the timeline scroller after a send, yet the list moves
// twice. This spec answers the only remaining question: what moves it the
// second time. It records, at scroll-event and DOM-mutation resolution (not
// rAF resolution, which misses frames during the send burst):
//   - every scroll event with the geometry observed synchronously inside it,
//   - every style mutation of the virtualizer's own height carriers,
//   - the scroll-write ledger index at each of those moments.
// If a scrollTop change has no write and is preceded by a scrollHeight drop,
// the mover is the browser clamping to a transiently shorter document.

const OUT = process.env.ATOLL_E_OUT || '/tmp/E-20260918-3-out/run-diagnostic';

async function dump(name, value) {
  const path = resolve(OUT, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
  return path;
}

async function installWriteInterceptor(page) {
  await page.addInitScript(() => {
    const writes = [];
    const record = (kind, node, detail) => {
      writes.push({
        index: writes.length,
        at: performance.now(),
        kind,
        node: node?.className ? String(node.className) : String(node?.tagName || node),
        isTimelineList: Boolean(node?.classList?.contains?.('timeline-message-list')),
        detail,
        stack: String(new Error('write').stack || '').split('\n').slice(2, 12).join('\n'),
      });
    };
    const scrollToOriginal = Element.prototype.scrollTo;
    Element.prototype.scrollTo = function patchedScrollTo(...args) {
      const options = typeof args[0] === 'object' && args[0] !== null ? args[0] : { top: args[1] };
      record('scrollTo', this, { top: Number(options?.top ?? NaN), before: Number(this.scrollTop || 0), scrollHeight: Number(this.scrollHeight || 0) });
      return scrollToOriginal.apply(this, args);
    };
    const scrollByOriginal = Element.prototype.scrollBy;
    Element.prototype.scrollBy = function patchedScrollBy(...args) {
      const options = typeof args[0] === 'object' && args[0] !== null ? args[0] : { top: args[1] };
      record('scrollBy', this, { top: Number(options?.top ?? NaN), before: Number(this.scrollTop || 0) });
      return scrollByOriginal.apply(this, args);
    };
    const intoViewOriginal = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function patchedScrollIntoView(...args) {
      record('scrollIntoView', this, { arg: JSON.stringify(args[0] ?? null) });
      return intoViewOriginal.apply(this, args);
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
    window.__eWrites = {
      all: () => writes,
      timeline: () => writes.filter((entry) => entry.isTimelineList),
      count: () => writes.length,
    };
  });
}

async function startGeometryProbe(page) {
  await page.evaluate(() => {
    const root = document.querySelector('.timeline-message-list');
    const events = [];
    const heightCarrier = () => root.querySelector('[data-testid="virtuoso-item-list"]')
      || root.firstElementChild?.firstElementChild
      || root.firstElementChild;
    const geometry = (kind, extra = {}) => {
      const carrier = heightCarrier();
      const style = carrier ? carrier.getAttribute('style') || '' : '';
      return {
        kind,
        at: performance.now(),
        scrollTop: Number(root.scrollTop || 0),
        scrollHeight: Number(root.scrollHeight || 0),
        clientHeight: Number(root.clientHeight || 0),
        maxScrollTop: Number(root.scrollHeight || 0) - Number(root.clientHeight || 0),
        rows: root.querySelectorAll('[data-presentation-row-id]').length,
        firstRow: root.querySelector('[data-presentation-row-id]')?.dataset.presentationRowId || '',
        lastRow: [...root.querySelectorAll('[data-presentation-row-id]')].at(-1)?.dataset.presentationRowId || '',
        carrierStyle: style,
        carrierHeight: carrier ? Number(carrier.getBoundingClientRect().height.toFixed(1)) : null,
        innerScrollHeight: Number(root.firstElementChild?.scrollHeight || 0),
        writeCount: window.__eWrites?.count?.() || 0,
        lastWriteAt: window.__eWrites?.all?.().at(-1)?.at ?? null,
        mode: document.querySelector('.timeline')?.dataset.viewportMode || '',
        ...extra,
      };
    };
    const push = (kind, extra) => { if (events.length < 4000) events.push(geometry(kind, extra)); };
    root.addEventListener('scroll', () => push('scroll'), { passive: true, capture: true });
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        push('mutation', {
          mutation: record.type,
          target: record.target.nodeType === 1
            ? `${record.target.tagName.toLowerCase()}.${String(record.target.className || '')}`
            : String(record.target.nodeName),
          attribute: record.attributeName || '',
          added: record.addedNodes.length,
          removed: record.removedNodes.length,
        });
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ['style'], childList: true, subtree: true });
    const resize = new ResizeObserver(() => push('resize'));
    const carrier = heightCarrier();
    if (carrier) resize.observe(carrier);
    resize.observe(root);
    const tick = () => { push('frame'); if (events.length < 4000) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    window.__eGeometry = { stop() { observer.disconnect(); resize.disconnect(); return events; }, mark: (label) => push('mark', { label }) };
    push('baseline');
  });
}

async function reset(request, seed, scenario) {
  expect((await request.post(`${MOCK}/mock/control/reset`, { data: { scenario, seed } })).ok()).toBe(true);
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
  await expect(choose).toBeVisible();
  await choose.click();
  await page.getByRole('menu', { name: '选择目标 Agent' }).getByRole('menuitem', { name: 'steward' }).click();
}

test.describe('E second displacement', () => {
  test.beforeEach(async ({ page }) => {
    await installWriteInterceptor(page);
    await page.setViewportSize({ width: 1120, height: 620 });
  });

  test('following send: the second move has a cause on record', async ({ page, request }, testInfo) => {
    await reset(request, 0xe0_09_20, 'long-running-history');
    await login(page);
    await chooseSteward(page);
    await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.enable({ case: 'E-second-displacement' }));

    await page.getByTestId('composer-input').fill('E-20260918-3 second displacement probe');
    await expect(page.getByRole('button', { name: /发送/ })).toBeEnabled();
    await startGeometryProbe(page);
    await page.evaluate(() => window.__eGeometry.mark('before-click'));
    await page.getByRole('button', { name: /发送/ }).click();
    await page.waitForTimeout(1_500);

    const events = await page.evaluate(() => window.__eGeometry.stop());
    const writes = await page.evaluate(() => window.__eWrites.all());
    const trace = await page.evaluate(() => window.__ATOLL_DIAGNOSTICS__.reading.snapshot());

    // Every scrollTop change, with whatever was recorded immediately before it.
    const moves = [];
    for (let index = 1; index < events.length; index += 1) {
      const delta = events[index].scrollTop - events[index - 1].scrollTop;
      if (Math.abs(delta) > 1) {
        moves.push({
          delta,
          from: events[index - 1],
          to: events[index],
          context: events.slice(Math.max(0, index - 6), index + 4),
        });
      }
    }
    const report = {
      moves: moves.map((move) => ({
        delta: move.delta,
        fromKind: move.from.kind,
        toKind: move.to.kind,
        at: move.to.at,
        writeCountBefore: move.from.writeCount,
        writeCountAfter: move.to.writeCount,
        scrollHeightBefore: move.from.scrollHeight,
        scrollHeightAfter: move.to.scrollHeight,
        maxBefore: move.from.maxScrollTop,
        maxAfter: move.to.maxScrollTop,
        context: move.context,
      })),
      timelineWrites: writes.filter((entry) => entry.isTimelineList),
      readingTail: trace.entries.slice(-80).map((entry) => ({ sequence: entry.sequence, event: entry.event, detail: entry.detail })),
      events,
    };
    await dump('second-displacement.json', report);
    await testInfo.attach('second-displacement.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });

    const last = events.at(-1);
    expect(last.scrollHeight - last.clientHeight - last.scrollTop, JSON.stringify({ last, moves: report.moves.map((move) => ({ delta: move.delta, writes: move.writeCountAfter })) }, null, 2)).toBeLessThanOrEqual(24);
  });
});
