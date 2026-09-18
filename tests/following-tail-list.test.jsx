// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FollowingTailList } from '../src/ui/timeline/FollowingTailList.jsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function readingPort(overrides = {}) {
  const session = {
    activationID: 'activation-1',
    inputEpoch: 2,
    geometryRevision: 0,
    mode: 'following',
    bottomIntent: null,
  };
  return {
    activationID: session.activationID,
    session,
    getSession: () => session,
    onPresentationMaterialized: vi.fn(),
    onReadingObservation: vi.fn(),
    onSurfaceVisibilityChange: vi.fn(),
    onUserControl: vi.fn(),
    ...overrides,
  };
}

function snapshot(count = 100) {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    contentRevision: index + 1,
    seqLow: index + 1,
    seqHigh: index + 1,
    layoutClass: 'message',
  }));
  return { rows, revision: 7, roleRevision: 3, firstItemIndex: 900 };
}

it('uses the presentation absolute coordinate for tail row revisions and materialization', () => {
  const reading = readingPort();
  const revisionIndices = [];
  const { container } = render(<FollowingTailList
    snapshot={snapshot()}
    reading={reading}
    rowRevision={(index, row) => { revisionIndices.push([index, row.id]); return String(index); }}
    renderRow={(row) => <div>{row.id}</div>}
    surfaceVisible
  />);

  expect(container.querySelectorAll('[data-presentation-row-id]')).toHaveLength(80);
  expect(revisionIndices.at(0)).toEqual([920, 'row-20']);
  expect(revisionIndices.at(-1)).toEqual([999, 'row-99']);
  expect(reading.onPresentationMaterialized).toHaveBeenCalledWith({
    activationID: 'activation-1',
    presentationRevision: 7,
    startIndex: 920,
    endIndex: 999,
  });
});

it('removes the outgoing scroll subscription when the following adapter is dormant', () => {
  const reading = readingPort();
  const { container } = render(<FollowingTailList
    snapshot={snapshot(4)}
    reading={reading}
    rowRevision={(index) => String(index)}
    renderRow={(row) => <div>{row.id}</div>}
    active={false}
    surfaceVisible={false}
  />);
  const root = container.querySelector('.timeline-message-list');
  Object.defineProperty(root, 'scrollTop', { configurable: true, value: -100 });
  act(() => root.dispatchEvent(new Event('scroll', { bubbles: true })));
  expect(root.tabIndex).toBe(-1);
  expect(reading.onUserControl).not.toHaveBeenCalled();
  expect(reading.onReadingObservation).not.toHaveBeenCalled();
  expect(reading.onPresentationMaterialized).not.toHaveBeenCalled();
});

it('drops a queued following observation after the adapter becomes outgoing', () => {
  const frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const reading = readingPort();
  const props = {
    snapshot: snapshot(4),
    reading,
    rowRevision: (index) => String(index),
    renderRow: (row) => <div>{row.id}</div>,
    surfaceVisible: true,
  };
  const view = render(<FollowingTailList {...props} active />);
  expect(frames.length).toBeGreaterThan(0);
  view.rerender(<FollowingTailList {...props} active={false} surfaceVisible={false} />);
  act(() => frames.forEach((callback) => callback()));
  expect(reading.onReadingObservation).not.toHaveBeenCalled();
});
