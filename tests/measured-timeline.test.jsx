// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VirtualTimelineAdapter } from '../src/ui/timeline/VirtualTimelineAdapter.jsx';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function fixture(count = 100) {
  return Array.from({ length: count }, (_, i) => ({
    id: `r-${i}`, height: [37, 140, 809, 62, 311, 1200, 28][i % 7], contentRevision: 1,
  }));
}

function mount(initialRows, { following = true, snapshot } = {}) {
  const observers = [];
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { observers.push(callback); }
    observe() {} unobserve() {} disconnect() {}
  });
  let follows = following;
  const viewport = {
    adapterRef: { current: null }, measurementSnapshot: snapshot,
    isFollowing: () => follows,
    handleUserIntent: (intent) => { if (intent === 'older' || intent === 'browse') follows = false; },
    handleAdapterSnapshot: vi.fn(), handleAnchorObserved: vi.fn(),
    handleAtTopChange: vi.fn(), handleAtBottomChange: vi.fn(), handleRangeChanged: vi.fn(),
  };
  const renderRow = (_index, row) => <div className="timeline-virtual-item" data-test-height={row.height}>{row.id}</div>;
  const element = (rows, listKey = 'channel:all') => <VirtualTimelineAdapter
    listKey={listKey} rows={rows} viewport={viewport} renderRow={renderRow}
  />;
  const view = render(element(initialRows));
  const scroller = () => view.container.querySelector('.timeline-message-list');
  return {
    view, viewport, scroller,
    update: (rows, listKey) => view.rerender(element(rows, listKey)),
    resize: () => act(() => observers.at(-1)([])),
    browse: (distance = 450) => act(() => {
      fireEvent.wheel(scroller(), { deltaY: -distance });
      scroller().scrollTop -= distance;
      fireEvent.scroll(scroller());
    }),
    follow: () => { follows = true; act(() => viewport.adapterRef.current.latest()); },
  };
}

function anchor(scroller) {
  const row = [...scroller.querySelectorAll('[data-presentation-row-id]')]
    .find((node) => node.getBoundingClientRect().bottom > 0);
  return { id: row?.dataset.presentationRowId, offset: row?.getBoundingClientRect().top, node: row };
}
function expectSameAnchor(scroller, before) {
  const after = anchor(scroller);
  expect(after.id).toBe(before.id);
  expect(after.offset).toBeCloseTo(before.offset, 6);
  expect(after.node).toBe(before.node);
}

describe('owned timeline layout transactions', () => {
  it('starts at the real heterogeneous tail with bounded DOM', () => {
    const f = mount(fixture(5000));
    expect(f.view.container.textContent).toContain('r-4999');
    expect(f.view.container.querySelectorAll('[data-presentation-row-id]').length).toBeLessThan(100);
    expect(anchor(f.scroller()).id).toBeTruthy();
  });

  it('preserves motion since the last scroll callback when a cold prefix arrives', () => {
    const rows = fixture();
    const f = mount(rows);
    f.browse(850);
    // Native scrolling has progressed but no scroll event has been delivered.
    f.scroller().scrollTop -= 137;
    const before = anchor(f.scroller());
    const prefix = fixture(30).map((row) => ({ ...row, id: `older-${row.id}` }));
    f.update([...prefix, ...rows]);
    expectSameAnchor(f.scroller(), before);
    const position = f.scroller().scrollTop;
    f.resize();
    expect(f.scroller().scrollTop).toBe(position);
  });

  it('does not reposition browsing for live append or growth below the reader', () => {
    const rows = fixture();
    const f = mount(rows);
    f.browse(900);
    const before = anchor(f.scroller());
    const next = rows.map((row, i) => i === rows.length - 1 ? { ...row, height: row.height + 930, contentRevision: 2 } : row);
    f.update([...next, { id: 'live', height: 630, contentRevision: 1 }]);
    expectSameAnchor(f.scroller(), before);
    f.resize();
    expectSameAnchor(f.scroller(), before);
  });

  it('compensates measured growth above the reader once, including late ResizeObserver delivery', () => {
    const f = mount(fixture());
    f.browse(500);
    const before = anchor(f.scroller());
    const above = before.node.previousElementSibling;
    expect(above.dataset.presentationRowId).toBeTruthy();
    above.dataset.testHeight = String(Number(above.dataset.testHeight) + 419);
    f.resize();
    expectSameAnchor(f.scroller(), before);
    const position = f.scroller().scrollTop;
    f.resize();
    expect(f.scroller().scrollTop).toBe(position);
  });

  it('cancels queued navigation on new input; later measurements cannot replay it', () => {
    const f = mount(fixture());
    f.browse();
    const before = anchor(f.scroller());
    act(() => {
      f.viewport.adapterRef.current.focus({ rowID: 'r-5' });
      fireEvent.wheel(f.scroller(), { deltaY: -10 });
    });
    expectSameAnchor(f.scroller(), before);
    f.resize();
    expectSameAnchor(f.scroller(), before);
  });

  it('navigates by ID and restores a negative within-row offset with the correct sign', () => {
    const f = mount(fixture());
    f.browse();
    act(() => f.viewport.adapterRef.current.restore({ rowID: 'r-45', offset: -17 }));
    expect(anchor(f.scroller())).toMatchObject({ id: 'r-45', offset: -17 });
    const before = anchor(f.scroller());
    f.resize();
    expectSameAnchor(f.scroller(), before);
  });

  it('keeps the tail while following, and stores measurements without a physical destination', () => {
    const rows = fixture();
    const f = mount(rows);
    f.update([...rows, { id: 'new-tail', height: 93, contentRevision: 1 }]);
    expect(f.view.container.querySelector('[data-presentation-row-id="new-tail"]').getBoundingClientRect().bottom).toBe(720);
    f.view.unmount();
    const cache = f.viewport.handleAdapterSnapshot.mock.calls.at(-1)[0];
    expect(cache).toMatchObject({ version: 1, width: 800 });
    expect(cache.rows.length).toBeGreaterThan(0);
    expect(cache).not.toHaveProperty('scrollTop');
  });

  it('recycles a long list through alternating scroll directions without retaining the whole DOM', () => {
    const f = mount(fixture(1000));
    for (let step = 0; step < 35; step++) {
      f.browse(step % 4 === 3 ? -420 : 910);
      expect(anchor(f.scroller()).id).toBeTruthy();
      expect(f.view.container.querySelectorAll('[data-presentation-row-id]').length).toBeLessThan(100);
    }
  });
});
