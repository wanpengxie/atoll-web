// @vitest-environment jsdom

import React, { startTransition, Suspense } from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FollowingTailList } from '../src/ui/timeline/FollowingTailList.jsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete Element.prototype.animate;
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

it('keeps committed reading and snapshot ownership when a candidate render suspends', async () => {
  const frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const committedReading = readingPort();
  const candidateReading = readingPort();
  const committedSnapshot = snapshot(4);
  const never = new Promise(() => {});
  let candidateRendered = false;
  function Suspender({ active }) {
    if (active) {
      candidateRendered = true;
      throw never;
    }
    return null;
  }
  function Harness() {
    const [candidate, setCandidate] = React.useState(false);
    return <>
      <button type="button" onClick={() => startTransition(() => setCandidate(true))}>candidate</button>
      <Suspense fallback={<p>pending</p>}>
        <FollowingTailList
          snapshot={candidate ? { ...committedSnapshot, revision: 8 } : committedSnapshot}
          reading={candidate ? candidateReading : committedReading}
          rowRevision={(index) => String(index)}
          renderRow={(row) => <div>{row.id}</div>}
          active={!candidate}
          surfaceVisible={!candidate}
        />
        <Suspender active={candidate} />
      </Suspense>
    </>;
  }
  const view = render(<Harness />);
  act(() => frames.splice(0).forEach((callback) => callback()));
  committedReading.onReadingObservation.mockClear();

  fireEvent.click(view.getByRole('button', { name: 'candidate' }));
  await waitFor(() => expect(candidateRendered).toBe(true));
  expect(view.queryByText('pending')).toBeNull();

  const root = view.container.querySelector('.timeline-message-list');
  Object.defineProperty(root, 'scrollTop', { configurable: true, value: -10 });
  act(() => root.dispatchEvent(new Event('scroll', { bubbles: true })));
  expect(frames.length).toBeGreaterThan(0);
  act(() => frames.splice(0).forEach((callback) => callback()));

  expect(committedReading.onReadingObservation).toHaveBeenCalled();
  expect(candidateReading.onReadingObservation).not.toHaveBeenCalled();
});

it('preserves descendant focus when a presentation rerender requests following focus', () => {
  const reading = readingPort();
  const props = {
    snapshot: snapshot(1),
    reading,
    rowRevision: (index) => String(index),
    renderRow: (row) => <button type="button">{row.id}</button>,
    surfaceVisible: true,
    active: true,
  };
  const view = render(<FollowingTailList {...props} focusOnMount={false} />);
  const button = view.getByRole('button');
  button.focus();
  expect(document.activeElement).toBe(button);

  view.rerender(<FollowingTailList {...props} focusOnMount />);

  expect(document.activeElement).toBe(button);
});

it('focuses following when a real handoff requests focus from outside the adapter', () => {
  const reading = readingPort();
  const { container } = render(<FollowingTailList
    snapshot={snapshot(1)}
    reading={reading}
    rowRevision={(index) => String(index)}
    renderRow={(row) => <button type="button">{row.id}</button>}
    surfaceVisible
    active
    focusOnMount
  />);

  expect(document.activeElement).toBe(container.querySelector('.timeline-following-tail'));
});

it('reopens one short-list demand when supply advances without a Presentation revision', async () => {
  const onUnderfill = vi.fn();
  const baseStatus = {
    hasOlder: true,
    sourceLease: '1:2:9',
    completedPages: 1,
    revealVersion: 1,
    buffered: 0,
  };
  const props = {
    snapshot: snapshot(2),
    rowRevision: (index) => String(index),
    renderRow: (row) => <div>{row.id}</div>,
    surfaceVisible: true,
    active: true,
  };
  const view = render(<FollowingTailList
    {...props}
    reading={readingPort({ status: baseStatus, onUnderfill })}
  />);
  await waitFor(() => expect(onUnderfill).toHaveBeenCalledTimes(1));

  view.rerender(<FollowingTailList
    {...props}
    reading={readingPort({
      status: { ...baseStatus, completedPages: 2, buffered: 148 },
      onUnderfill,
    })}
  />);
  await waitFor(() => expect(onUnderfill).toHaveBeenCalledTimes(2));

  // Demand phase/owner rerenders do not consume the same supply twice.
  view.rerender(<FollowingTailList
    {...props}
    reading={readingPort({
      status: {
        ...baseStatus,
        completedPages: 2,
        buffered: 148,
        historyDemand: { revision: 7, phase: 'idle' },
      },
      onUnderfill,
    })}
  />);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(onUnderfill).toHaveBeenCalledTimes(2);
});

function presentation(rows, revision, changes) {
  return {
    rows,
    entities: new Map(rows.map((row) => [row.id, row])),
    revision,
    sourceRevision: revision,
    roleRevision: 1,
    firstItemIndex: 900,
    epoch: 'c0:1',
    viewID: 'c0:mine',
    changes,
  };
}

it('grows only exact live back inserts in the existing row DOM and settles before navigation', () => {
  const animations = [];
  Element.prototype.animate = vi.fn(function animate(keyframes, options) {
    let resolveFinished;
    const finished = new Promise((resolve) => { resolveFinished = resolve; });
    const animation = {
      node: this,
      keyframes,
      options,
      finished,
      finish: vi.fn(() => resolveFinished()),
      cancel: vi.fn(),
    };
    animations.push(animation);
    return animation;
  });
  const reading = readingPort();
  const oldRow = snapshot(1).rows[0];
  const initial = presentation([oldRow], 1, {
    kind: 'rebase', backInsertedIDs: [], frontInsertedIDs: [], updated: [], removed: [],
  });
  const props = {
    reading,
    rowRevision: (index) => String(index),
    rowPresentationState: () => '',
    renderRow: (row) => <button type="button">{row.id}</button>,
    surfaceVisible: true,
    active: true,
  };
  const view = render(<FollowingTailList
    {...props}
    snapshot={initial}
    livePresentationArrivals={{ revision: 0, events: [] }}
  />);
  const oldNode = view.container.querySelector('[data-presentation-row-id="row-0"]');
  const liveRow = { ...oldRow, id: 'live-row', contentRevision: 2, seqLow: 2, seqHigh: 2 };
  const appended = presentation([oldRow, liveRow], 2, {
    kind: 'append', backInsertedIDs: ['live-row'], frontInsertedIDs: [],
    inserted: ['live-row'], updated: [], removed: [],
  });
  view.rerender(<FollowingTailList
    {...props}
    snapshot={appended}
    livePresentationArrivals={{
      revision: 1,
      events: [{ revision: 1, rowIDs: ['live-row'], sourceRevision: 2 }],
    }}
  />);

  expect(view.container.querySelector('[data-presentation-row-id="row-0"]')).toBe(oldNode);
  expect(Element.prototype.animate).toHaveBeenCalledTimes(1);
  expect(animations[0].keyframes).toEqual([
    { gridTemplateRows: '0fr' },
    { gridTemplateRows: '1fr' },
  ]);
  expect(animations[0].node.dataset.liveEntryTransition).toBe('running');

  view.getByRole('button', { name: 'live-row' }).focus();
  expect(animations[0].finish).toHaveBeenCalledTimes(1);
  expect(animations[0].node.dataset.liveEntryTransition).toBeUndefined();

  const browsing = readingPort({
    session: { ...reading.session, mode: 'browsing' },
    getSession: () => ({ ...reading.session, mode: 'browsing' }),
  });
  view.rerender(<FollowingTailList
    {...props}
    reading={browsing}
    snapshot={appended}
    livePresentationArrivals={{ revision: 1, events: [] }}
  />);
  expect(animations[0].finish).toHaveBeenCalledTimes(1);
  expect(animations[0].cancel).toHaveBeenCalledTimes(1);
  expect(animations[0].node.dataset.liveEntryTransition).toBeUndefined();
});

it('does not animate progress, history prepend, or a row owned by Waiting handoff', () => {
  Element.prototype.animate = vi.fn(() => ({
    finished: new Promise(() => {}), finish: vi.fn(), cancel: vi.fn(),
  }));
  const reading = readingPort();
  const row = snapshot(1).rows[0];
  const progress = presentation([{ ...row, contentRevision: 2 }], 2, {
    kind: 'revise', backInsertedIDs: [], frontInsertedIDs: [],
    inserted: [], updated: ['row-0'], removed: [],
  });
  const view = render(<FollowingTailList
    snapshot={progress}
    reading={reading}
    rowRevision={(index) => String(index)}
    rowPresentationState={() => ''}
    renderRow={(item) => <div>{item.id}</div>}
    livePresentationArrivals={{ revision: 1, events: [{ rowIDs: ['row-0'] }] }}
    surfaceVisible
  />);
  const history = { ...row, id: 'history', seqLow: 0, seqHigh: 0 };
  view.rerender(<FollowingTailList
    snapshot={presentation([history, row], 3, {
      kind: 'prepend', backInsertedIDs: [], frontInsertedIDs: ['history'],
      inserted: ['history'], updated: [], removed: [],
    })}
    reading={reading}
    rowRevision={(index) => String(index)}
    rowPresentationState={() => ''}
    renderRow={(item) => <div>{item.id}</div>}
    livePresentationArrivals={{ revision: 2, events: [{ rowIDs: ['history'] }] }}
    surfaceVisible
  />);
  const waiting = { ...row, id: 'waiting', seqLow: 3, seqHigh: 3 };
  view.rerender(<FollowingTailList
    snapshot={presentation([history, row, waiting], 4, {
      kind: 'append', backInsertedIDs: ['waiting'], frontInsertedIDs: [],
      inserted: ['waiting'], updated: [], removed: [],
    })}
    reading={reading}
    rowRevision={(index) => String(index)}
    rowPresentationState={(item) => item.id === 'waiting' ? 'handoff-enter' : ''}
    renderRow={(item) => <div>{item.id}</div>}
    livePresentationArrivals={{ revision: 3, events: [{ rowIDs: ['waiting'] }] }}
    surfaceVisible
  />);
  expect(Element.prototype.animate).not.toHaveBeenCalled();
});

it('installs directly when an existing row owns focus or a text selection', () => {
  Element.prototype.animate = vi.fn(() => ({
    finished: new Promise(() => {}), finish: vi.fn(), cancel: vi.fn(),
  }));
  const reading = readingPort();
  const oldRow = snapshot(1).rows[0];
  const initial = presentation([oldRow], 1, {
    kind: 'rebase', backInsertedIDs: [], frontInsertedIDs: [], updated: [], removed: [],
  });
  const props = {
    reading,
    rowRevision: (index) => String(index),
    rowPresentationState: () => '',
    renderRow: (row) => <button type="button">selectable {row.id}</button>,
    livePresentationArrivals: { revision: 0, events: [] },
    surfaceVisible: true,
  };
  const view = render(<FollowingTailList {...props} snapshot={initial} />);
  const oldButton = view.getByRole('button', { name: 'selectable row-0' });
  oldButton.focus();
  const focusedLive = { ...oldRow, id: 'focused-live', contentRevision: 2 };
  view.rerender(<FollowingTailList
    {...props}
    snapshot={presentation([oldRow, focusedLive], 2, {
      kind: 'append', backInsertedIDs: ['focused-live'], frontInsertedIDs: [],
      inserted: ['focused-live'], updated: [], removed: [],
    })}
    livePresentationArrivals={{ revision: 1, events: [{ rowIDs: ['focused-live'] }] }}
  />);
  expect(document.activeElement).toBe(oldButton);
  expect(Element.prototype.animate).not.toHaveBeenCalled();

  oldButton.blur();
  const text = oldButton.firstChild;
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, Math.min(6, text.textContent.length));
  const selection = globalThis.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const selectedLive = { ...oldRow, id: 'selected-live', contentRevision: 3 };
  view.rerender(<FollowingTailList
    {...props}
    snapshot={presentation([oldRow, focusedLive, selectedLive], 3, {
      kind: 'append', backInsertedIDs: ['selected-live'], frontInsertedIDs: [],
      inserted: ['selected-live'], updated: [], removed: [],
    })}
    livePresentationArrivals={{ revision: 2, events: [{ rowIDs: ['selected-live'] }] }}
  />);
  expect(selection.toString()).toContain('select');
  expect(Element.prototype.animate).not.toHaveBeenCalled();
  selection.removeAllRanges();
});
