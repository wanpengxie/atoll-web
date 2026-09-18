// @vitest-environment jsdom
import React, { startTransition, Suspense } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { READING_MODE } from '../src/model/reading-session.js';
import { MessageList } from '../src/ui/timeline/LegendMessageList.jsx';

const legendHarness = vi.hoisted(() => ({
  props: null,
  scrollTo: vi.fn(),
  scrollToIndex: vi.fn(),
  commitHeight: 0,
  commitHeights: [],
}));

// This test isolates React's commit/abandon boundary. The production
// virtualizer's geometry is covered in Chromium; here the list adapter still
// receives the original data and a real captured scroller node.
vi.mock('react-virtuoso', async () => {
  const ReactModule = await import('react');
  const Virtuoso = ReactModule.forwardRef(function LifecycleVirtuoso(props, ref) {
    const nodeRef = ReactModule.useRef(null);
    ReactModule.useImperativeHandle(ref, () => ({
      scrollToIndex: legendHarness.scrollToIndex,
    }), []);
    ReactModule.useLayoutEffect(() => {
      const heights = legendHarness.commitHeights.length
        ? legendHarness.commitHeights
        : legendHarness.commitHeight > 0 ? [legendHarness.commitHeight] : [];
      heights.forEach((height) => props.totalListHeightChanged?.(height));
    }, [props.data, props.totalListHeightChanged]);
    ReactModule.useLayoutEffect(() => {
      legendHarness.props = props;
      nodeRef.current.scrollTo = (options) => {
        legendHarness.scrollTo(options);
        nodeRef.current.scrollTop = Math.max(0, nodeRef.current.scrollHeight - nodeRef.current.clientHeight);
      };
      props.scrollerRef?.(nodeRef.current);
      return () => props.scrollerRef?.(null);
    }, [props]);
    const List = props.components?.List || 'div';
    return <div ref={nodeRef} className={props.className} role={props.role} aria-label={props['aria-label']}>
      <List context={props.context}>{props.data.map((value, index) => (
        <div data-known-size="132" key={props.computeItemKey(index + props.firstItemIndex, value)}>{props.itemContent(index + props.firstItemIndex, value)}</div>
      ))}</List>
    </div>;
  });
  return { Virtuoso };
});

afterEach(() => {
  cleanup();
  delete globalThis.__ATOLL_READING_TRACE__;
  legendHarness.props = null;
  legendHarness.scrollTo.mockReset();
  legendHarness.scrollToIndex.mockReset();
  legendHarness.commitHeight = 0;
  legendHarness.commitHeights = [];
  vi.unstubAllGlobals();
});

function row(id, seq) {
  return {
    id,
    seqLow: seq,
    seqHigh: seq,
    contentRevision: 1,
    layoutClass: 'standalone',
    settled: true,
  };
}

function snapshot(rows, revision) {
  return {
    rows,
    firstItemIndex: 100 - rows.length,
    revision,
    changes: { kind: 'append', inserted: rows.map((item) => item.id), updated: [], removed: [] },
  };
}

function reading(onReadingObservation, activationID = 'activation:a', bookmark = null) {
  const session = {
    activationID,
    mode: READING_MODE.browsing,
    inputEpoch: 3,
    geometryRevision: 7,
    bookmark,
    bottomIntent: { id: '', inputEpoch: 0 },
  };
  const owner = {
    activationID: session.activationID,
    session,
    initializing: false,
    bottomReady: true,
    onReadingObservation,
    onUserControl: vi.fn(),
    onAtTop: vi.fn(),
    onNearTop: vi.fn(),
    consumeBottomIntent: vi.fn(() => false),
    isFollowing: () => false,
    getSession: () => session,
  };
  owner.beginNavigation = vi.fn((input) => {
    owner.onUserControl(input);
    return { inputGeneration: session.inputEpoch };
  });
  owner.updateNavigation = vi.fn(() => true);
  owner.finishNavigation = vi.fn(() => true);
  owner.cancelNavigation = vi.fn(() => true);
  return owner;
}

function FormalRangeSubject({ activationID, rows = [row('formal-row', 1)], surfaceVisible = true }) {
  return <>
    <div data-testid="other-loading" role="status">正在读取更早动态…</div>
    <MessageList
      snapshot={snapshot(rows, 1)}
      reading={reading(vi.fn(), activationID)}
      surfaceVisible={surfaceVisible}
      renderRow={(value) => <article>{value.id}</article>}
    />
  </>;
}

it('does not describe a fresh following activation as restoring an old reading position', () => {
  const owner = followingReading({ activationID: 'activation:fresh-following' });
  owner.initializing = true;
  owner.restorePending = false;

  render(<MessageList snapshot={snapshot([], 0)} reading={owner} renderRow={() => null} />);

  expect(screen.queryByText('正在恢复上次阅读位置…')).toBeNull();
  expect(screen.getByRole('region', { name: '频道动态' })).toBeTruthy();
});

it('uses one row measurement revision for the item subtree and its formal certificate', () => {
  const owner = reading(vi.fn());
  const item = row('measured', 1);
  const rowRevision = vi.fn((index, value) => `${index}:${value.id}:layout-7`);

  render(
    <MessageList
      snapshot={snapshot([item], 1)}
      reading={owner}
      rowRevision={rowRevision}
      renderRow={(value) => <article>{value.id}</article>}
    />,
  );

  const externalIndex = 99;
  expect(legendHarness.props.computeItemMeasurementKey(externalIndex, item)).toBe('99:measured:layout-7');
  expect(rowRevision).toHaveBeenCalledWith(externalIndex, item);
  expect(screen.getByText('measured')).toBeTruthy();
});

it('scopes formal range feedback to its activation without clearing unrelated loading', () => {
  const view = render(<FormalRangeSubject activationID="activation:formal-a" surfaceVisible={false} />);
  const activationACallback = legendHarness.props.formalRangeStateChange;

  act(() => activationACallback({ phase: 'pending', blocking: true, generation: 1, reason: 'inline-size' }));
  expect(screen.queryByText('正在准备频道内容…')).toBeNull();

  view.rerender(<FormalRangeSubject activationID="activation:formal-a" />);
  expect(screen.getByText('正在准备频道内容…')).toBeTruthy();

  view.rerender(<FormalRangeSubject activationID="activation:formal-b" />);
  const activationBCallback = legendHarness.props.formalRangeStateChange;
  expect(activationBCallback).not.toBe(activationACallback);
  expect(screen.queryByText('正在准备频道内容…')).toBeNull();

  act(() => activationBCallback({ phase: 'pending', blocking: true, generation: 1, reason: 'item-size' }));
  expect(screen.getByText('正在准备频道内容…')).toBeTruthy();

  act(() => activationACallback({ phase: 'ready', blocking: false, generation: 2 }));
  expect(screen.getByText('正在准备频道内容…')).toBeTruthy();
  act(() => activationACallback({ phase: 'failed', blocking: true, generation: 3, reason: 'duplicate-key' }));
  expect(screen.getByText('正在准备频道内容…')).toBeTruthy();
  expect(screen.queryByText('频道内容准备失败')).toBeNull();

  act(() => activationBCallback({ phase: 'ready', blocking: false, generation: 2 }));
  expect(screen.queryByText('正在准备频道内容…')).toBeNull();
  expect(screen.getByTestId('other-loading')).toBeTruthy();

  act(() => activationBCallback({ phase: 'failed', blocking: true, generation: 3, reason: 'duplicate-key' }));
  expect(screen.getByRole('alert').textContent).toBe('频道内容准备失败');

  act(() => activationBCallback({ phase: 'pending', blocking: false, generation: 4, reason: 'item-size' }));
  expect(screen.queryByText('正在准备频道内容…')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByTestId('other-loading')).toBeTruthy();
});

it('keeps the empty presentation independent of formal range feedback', () => {
  render(<FormalRangeSubject activationID="activation:formal-empty" rows={[]} />);

  expect(screen.getByRole('region', { name: '频道动态' }).getAttribute('data-empty')).toBe('true');
  expect(screen.queryByText('正在准备频道内容…')).toBeNull();
  expect(screen.getByTestId('other-loading')).toBeTruthy();
});

it('keeps the explicit restore status while a browsing bookmark has no rows yet', () => {
  const owner = reading(vi.fn(), 'activation:bookmark-pending', {
    messageID: 'not-installed-yet',
    rowViewportOffset: -24,
  });
  owner.initializing = true;
  owner.restorePending = true;

  render(<MessageList snapshot={snapshot([], 0)} reading={owner} renderRow={() => null} />);

  expect(screen.getByRole('status').textContent).toBe('正在恢复上次阅读位置…');
});

it('passes initial restore as a data-relative index when prepend continuity uses a nonzero firstItemIndex', () => {
  const rows = [row('first', 1), row('target', 2), row('last', 3)];
  const owner = reading(vi.fn(), 'activation:restore', {
    messageID: 'target',
    rowViewportOffset: -24,
  });
  render(<MessageList snapshot={snapshot(rows, 1)} reading={owner} renderRow={(value) => <article>{value.id}</article>} />);

  expect(legendHarness.props.firstItemIndex).toBe(97);
  expect(legendHarness.props.initialTopMostItemIndex).toEqual({
    index: 1,
    align: 'start',
    offset: 24,
  });
});

it('does not reuse an initial location computed by an abandoned activation render', async () => {
  const committedRows = [row('a-first', 1), row('a-last', 2)];
  const committedOwner = reading(vi.fn(), 'activation:a', {
    messageID: 'a-last', rowViewportOffset: -8,
  });
  const view = render(
    <Suspense fallback={<p>loading</p>}>
      <MessageList
        snapshot={snapshot(committedRows, 1)}
        reading={committedOwner}
        renderRow={(value) => <article>{value.id}</article>}
      />
    </Suspense>,
  );
  expect(legendHarness.props.initialTopMostItemIndex).toMatchObject({ index: 1, offset: 8 });

  const candidateRows = [row('b-first', 11), row('b-last', 12)];
  const suspended = new Promise(() => {});
  const speculativeRender = vi.fn();
  const speculativeOwner = reading(vi.fn(), 'activation:b', {
    messageID: 'b-first', rowViewportOffset: -16,
  });
  startTransition(() => {
    view.rerender(
      <Suspense fallback={<p>loading</p>}>
        <MessageList
          snapshot={snapshot(candidateRows, 2)}
          reading={speculativeOwner}
          renderRow={(value) => {
            speculativeRender(value.id);
            throw suspended;
          }}
        />
      </Suspense>,
    );
  });
  await waitFor(() => expect(speculativeRender).toHaveBeenCalled());
  expect(screen.getByText('a-first')).toBeTruthy();

  const committedSuccessor = reading(vi.fn(), 'activation:b', {
    messageID: 'b-last', rowViewportOffset: -32,
  });
  view.rerender(
    <Suspense fallback={<p>loading</p>}>
      <MessageList
        snapshot={snapshot(candidateRows, 2)}
        reading={committedSuccessor}
        renderRow={(value) => <article>{value.id}</article>}
      />
    </Suspense>,
  );

  expect(legendHarness.props.initialTopMostItemIndex).toEqual({
    index: 1,
    align: 'start',
    offset: 32,
  });
});

it('positions an exact bookmark through the public list handle when a semantic activation reuses the channel host', () => {
  const firstRows = [row('a-first', 1), row('a-target', 2), row('a-last', 3)];
  const firstOwner = reading(vi.fn(), 'activation:a', {
    messageID: 'a-target', rowViewportOffset: -12,
  });
  const view = render(
    <MessageList snapshot={snapshot(firstRows, 1)} reading={firstOwner} renderRow={(value) => <article>{value.id}</article>} />,
  );
  expect(legendHarness.props.initialTopMostItemIndex).toMatchObject({ index: 1, offset: 12 });

  const nextRows = [row('b-first', 11), row('b-middle', 12), row('b-target', 13), row('b-last', 14)];
  const nextOwner = reading(vi.fn(), 'activation:b', {
    messageID: 'b-target', rowViewportOffset: -28,
  });
  nextOwner.initializing = true;
  view.rerender(
    <MessageList snapshot={snapshot(nextRows, 2)} reading={nextOwner} renderRow={(value) => <article>{value.id}</article>} />,
  );
  expect(screen.queryByRole('status')).toBeNull();
  act(() => legendHarness.props.rangeChanged({ startIndex: 0, endIndex: 3 }));
  expect(legendHarness.scrollToIndex).toHaveBeenLastCalledWith({
    index: 2,
    align: 'start',
    offset: 28,
  });
  act(() => legendHarness.props.rangeChanged({ startIndex: 0, endIndex: 3 }));
  expect(legendHarness.scrollToIndex).toHaveBeenCalledTimes(1);

  nextOwner.initializing = false;
  view.rerender(
    <MessageList snapshot={snapshot(nextRows, 2)} reading={nextOwner} renderRow={(value) => <article>{value.id}</article>} />,
  );
  expect(legendHarness.props.initialTopMostItemIndex).toEqual({
    index: 2,
    align: 'start',
    offset: 28,
  });
});

it('keeps installed rows readable and restores a late exact bookmark once it arrives', () => {
  const owner = reading(vi.fn(), 'activation:late', {
    messageID: 'late-target', rowViewportOffset: -36,
  });
  owner.initializing = true;
  owner.restorePending = true;
  const view = render(
    <MessageList snapshot={snapshot([row('fallback', 1)], 1)} reading={owner} renderRow={(value) => <article>{value.id}</article>} />,
  );

  expect(screen.getByText('fallback')).toBeTruthy();
  expect(screen.queryByRole('status')).toBeNull();
  expect(legendHarness.scrollToIndex).not.toHaveBeenCalled();

  owner.initializing = false;
  view.rerender(
    <MessageList
      snapshot={snapshot([row('fallback', 1), row('late-target', 2)], 2)}
      reading={owner}
      renderRow={(value) => <article>{value.id}</article>}
    />,
  );

  act(() => legendHarness.props.rangeChanged({ startIndex: 0, endIndex: 1 }));
  expect(legendHarness.scrollToIndex).not.toHaveBeenCalled();
  owner.restorePending = false;
  view.rerender(
    <MessageList
      snapshot={snapshot([row('fallback', 1), row('late-target', 2)], 2)}
      reading={owner}
      renderRow={(value) => <article>{value.id}</article>}
    />,
  );

  expect(legendHarness.scrollToIndex).toHaveBeenCalledTimes(1);
  expect(legendHarness.scrollToIndex).toHaveBeenCalledWith({
    index: 1,
    align: 'start',
    offset: 36,
  });
});

it('cancels a late bookmark restore after native input changes the activation epoch', () => {
  const owner = reading(vi.fn(), 'activation:late-cancelled', {
    messageID: 'late-target', rowViewportOffset: -36,
  });
  owner.initializing = true;
  const view = render(
    <MessageList snapshot={snapshot([row('fallback', 1)], 1)} reading={owner} renderRow={(value) => <article>{value.id}</article>} />,
  );

  owner.session.inputEpoch += 1;
  owner.initializing = false;
  view.rerender(
    <MessageList
      snapshot={snapshot([row('fallback', 1), row('late-target', 2)], 2)}
      reading={owner}
      renderRow={(value) => <article>{value.id}</article>}
    />,
  );

  expect(legendHarness.scrollToIndex).not.toHaveBeenCalled();
});

it('settles a provisional bookmark after its target materializes without a second position command', async () => {
  const firstOwner = reading(vi.fn(), 'activation:before', {
    messageID: 'before-target', rowViewportOffset: -12,
  });
  const view = render(
    <MessageList snapshot={snapshot([row('before-target', 1)], 1)} reading={firstOwner} renderRow={(value) => <article>{value.id}</article>} />,
  );
  legendHarness.scrollToIndex.mockClear();
  const nextOwner = reading(vi.fn(), 'activation:after', {
    messageID: 'after-target', rowViewportOffset: -20,
  });
  view.rerender(
    <MessageList snapshot={snapshot([row('before-target', 1), row('after-target', 2)], 2)} reading={nextOwner} renderRow={(value) => <article>{value.id}</article>} />,
  );
  await act(async () => { await Promise.resolve(); });
  expect(legendHarness.scrollToIndex).toHaveBeenCalledTimes(1);
  const scroller = screen.getByRole('region', { name: '频道动态' });
  scroller.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 });
  const target = [...scroller.querySelectorAll('[data-presentation-row-id]')]
    .find((node) => node.dataset.presentationRowId === 'after-target');
  target.getBoundingClientRect = () => ({ top: 36, bottom: 100, left: 0, right: 800, width: 800, height: 64 });
  act(() => legendHarness.props.rangeChanged({ startIndex: 0, endIndex: 1 }));
  expect(legendHarness.scrollToIndex).toHaveBeenCalledTimes(1);
  target.getBoundingClientRect = () => ({ top: -20, bottom: 44, left: 0, right: 800, width: 800, height: 64 });
  act(() => legendHarness.props.rangeChanged({ startIndex: 0, endIndex: 1 }));
  act(() => legendHarness.props.rangeChanged({ startIndex: 0, endIndex: 1 }));
  expect(legendHarness.scrollToIndex).toHaveBeenCalledTimes(1);
});

it('admits a handoff only from the exact settled target after materialization, formal geometry, and paint', () => {
  const frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const ownerToken = {};
  const rows = [row('handoff-target', 1)];
  const owner = reading(vi.fn(), 'activation:handoff', {
    messageID: 'handoff-target', rowViewportOffset: -12,
  });
  const receipt = vi.fn();
  const activeTarget = {
    ownerToken,
    activationID: owner.activationID,
    inputGeneration: owner.session.inputEpoch,
    transactionID: 'navigation:1',
    hostToken: 9,
    targetRevision: 1,
    presentationRevision: 1,
    bookmark: { messageID: 'handoff-target', rowViewportOffset: -12 },
    phase: 'active',
  };
  const props = {
    snapshot: snapshot(rows, 1),
    reading: owner,
    renderRow: (value) => <article data-reading-block-id={`block:${value.id}`}>{value.id}</article>,
    handoffPending: true,
    onNavigationRevealReceipt: receipt,
  };
  const view = render(<MessageList {...props} navigationTarget={activeTarget} />);
  expect(legendHarness.props.initialTopMostItemIndex).toBeUndefined();
  expect(legendHarness.scrollToIndex).not.toHaveBeenCalled();
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1000, scrollTop: 400 });
  scroller.getBoundingClientRect = () => ({
    top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600,
  });
  const targetNode = scroller.querySelector('[data-presentation-row-id="handoff-target"]');
  let targetTop = 36;
  targetNode.getBoundingClientRect = () => ({
    top: targetTop, bottom: targetTop + 132, left: 0, right: 800, width: 800, height: 132,
  });
  targetNode.querySelector('[data-reading-block-id]').getBoundingClientRect = () => ({
    top: 0, bottom: 40, left: 8, right: 400, width: 392, height: 40,
  });

  act(() => legendHarness.props.formalRangeStateChange({
    phase: 'ready', blocking: false, generation: 4,
  }));
  act(() => legendHarness.props.rangeChanged({ startIndex: 99, endIndex: 99 }));
  expect(legendHarness.scrollToIndex).toHaveBeenCalledWith({
    index: 0, align: 'start', offset: 12,
  });
  targetTop = -12;
  act(() => legendHarness.props.rangeChanged({ startIndex: 99, endIndex: 99 }));
  act(() => frames.splice(0).forEach((callback) => callback()));
  act(() => frames.splice(0).forEach((callback) => callback()));
  expect(receipt).not.toHaveBeenCalled();

  view.rerender(<MessageList {...props} navigationTarget={{ ...activeTarget, phase: 'settled' }} />);
  act(() => frames.splice(0).forEach((callback) => callback()));
  act(() => frames.splice(0).forEach((callback) => callback()));

  expect(receipt).toHaveBeenCalledTimes(1);
  expect(receipt).toHaveBeenCalledWith(expect.objectContaining({
    ownerToken,
    activationID: owner.activationID,
    inputGeneration: owner.session.inputEpoch,
    transactionID: 'navigation:1',
    hostToken: 9,
    targetRevision: 1,
    presentationRevision: 1,
    materializedPresentationRevision: 1,
    targetID: 'handoff-target',
    targetBlockID: 'block:handoff-target',
    targetViewportOffset: -12,
    desiredViewportOffset: -12,
    installedRange: { startIndex: 99, endIndex: 99 },
    formalGeneration: 4,
    materialized: true,
    paintRevision: 1,
  }));
});

it('transfers focus only in the atomic reveal commit, not while incoming is inert', () => {
  const owner = reading(vi.fn(), 'activation:focus-handoff');
  const props = {
    snapshot: snapshot([row('focus-target', 1)], 1),
    reading: owner,
    renderRow: (value) => <article>{value.id}</article>,
    focusOnMount: true,
  };
  const view = render(<>
    <button type="button">outgoing focus</button>
    <MessageList {...props} handoffPending />
  </>);
  const outgoing = screen.getByRole('button', { name: 'outgoing focus' });
  outgoing.focus();
  expect(document.activeElement).toBe(outgoing);

  view.rerender(<>
    <button type="button">outgoing focus</button>
    <MessageList {...props} handoffPending={false} />
  </>);

  expect(document.activeElement).toBe(screen.getByRole('region', { name: '频道动态' }));
});

function followingReading({
  activationID = 'activation:follow',
  bottomIntent = { id: '', inputEpoch: 0 },
} = {}) {
  let session = {
    activationID,
    mode: READING_MODE.following,
    inputEpoch: 0,
    geometryRevision: 0,
    bookmark: null,
    bottomIntent,
  };
  const owner = {
    activationID: session.activationID,
    session,
    initializing: false,
    bottomReady: true,
    onReadingObservation: vi.fn(),
    onUserControl: vi.fn(() => {
      session = { ...session, mode: READING_MODE.browsing, inputEpoch: session.inputEpoch + 1, bottomIntent: { id: '', inputEpoch: 0 } };
      owner.session = session;
    }),
    onAtTop: vi.fn(),
    onNearTop: vi.fn(),
    consumeBottomIntent: vi.fn((intent) => {
      if (intent.id !== session.bottomIntent.id || intent.inputEpoch !== session.inputEpoch) return false;
      session = { ...session, bottomIntent: { id: '', inputEpoch: 0 } };
      owner.session = session;
      return true;
    }),
    isFollowing: () => session.mode === READING_MODE.following,
    getSession: () => session,
    setBottomIntent(intent) {
      session = { ...session, bottomIntent: intent };
      owner.session = session;
    },
    returnToBottom() {
      session = { ...session, mode: READING_MODE.following, bookmark: null };
      owner.session = session;
    },
  };
  owner.beginNavigation = vi.fn((input) => {
    owner.onUserControl(input);
    return { inputGeneration: session.inputEpoch };
  });
  owner.updateNavigation = vi.fn(() => true);
  owner.finishNavigation = vi.fn(() => true);
  owner.cancelNavigation = vi.fn(() => true);
  return owner;
}

function setScrollerGeometry(node, { clientHeight = 600, scrollHeight = 1000, scrollTop = 400 } = {}) {
  Object.defineProperties(node, {
    offsetHeight: { configurable: true, value: clientHeight },
    clientHeight: { configurable: true, value: clientHeight },
    scrollHeight: { configurable: true, value: scrollHeight },
    scrollTop: { configurable: true, writable: true, value: scrollTop },
  });
}

it('disables built-in follow and lets the committed following owner issue one synchronous DOM bottom write', async () => {
  const owner = followingReading();
  const renderRow = (value) => <article>{value.id}</article>;
  const first = row('first', 1);
  const view = render(<MessageList snapshot={snapshot([first], 1)} reading={owner} renderRow={renderRow} />);
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller);
  expect(legendHarness.props.followOutput).toBe(false);
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();
  setScrollerGeometry(scroller, { scrollHeight: 1200, scrollTop: 400 });
  view.rerender(<MessageList snapshot={snapshot([first, row('appended', 2)], 2)} reading={owner} renderRow={renderRow} />);
  act(() => legendHarness.props.totalListHeightChanged(1200));
  await waitFor(() => expect(legendHarness.scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: 'auto' }));

  const callsAfterAppend = legendHarness.scrollTo.mock.calls.length;
  owner.onUserControl();
  setScrollerGeometry(scroller, { scrollHeight: 1200, scrollTop: 400 });
  act(() => legendHarness.props.totalListHeightChanged(1200));
  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(callsAfterAppend);
});

it('joins a role-only presentation commit to its public height before following once', () => {
  const events = [];
  globalThis.__ATOLL_READING_TRACE__ = (event) => events.push(event);
  const owner = followingReading();
  const first = row('first', 1);
  const renderRow = (value) => <article>{value.id}</article>;
  const view = render(
    <MessageList
      snapshot={{ ...snapshot([first], 1), roleRevision: 0, roleChanges: { updated: [] } }}
      reading={owner}
      renderRow={renderRow}
    />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { scrollHeight: 1200, scrollTop: 400 });

  view.rerender(
    <MessageList
      snapshot={{
        ...snapshot([{ ...first }], 1),
        roleRevision: 1,
        roleChanges: { updated: ['first'] },
      }}
      reading={owner}
      renderRow={renderRow}
    />,
  );
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();
  act(() => legendHarness.props.totalListHeightChanged(1200));

  expect(legendHarness.scrollTo).toHaveBeenCalledOnce();
  expect(events.filter((event) => event.stage === 'issuer-write')).toEqual([
    expect.objectContaining({ authorization: 'presentation-role' }),
  ]);
});

it('joins a child-first role height and cancels it when native input wins', () => {
  const owner = followingReading();
  const first = row('first', 1);
  const renderRow = (value) => <article>{value.id}</article>;
  const view = render(
    <MessageList
      snapshot={{ ...snapshot([first], 1), roleRevision: 0, roleChanges: { updated: [] } }}
      reading={owner}
      renderRow={renderRow}
    />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { scrollHeight: 1200, scrollTop: 400 });
  legendHarness.commitHeights = [1200];
  view.rerender(
    <MessageList
      snapshot={{
        ...snapshot([{ ...first }], 1),
        roleRevision: 1,
        roleChanges: { updated: ['first'] },
      }}
      reading={owner}
      renderRow={renderRow}
    />,
  );
  expect(legendHarness.scrollTo).toHaveBeenCalledOnce();

  legendHarness.scrollTo.mockReset();
  legendHarness.commitHeights = [];
  view.rerender(
    <MessageList
      snapshot={{
        ...snapshot([{ ...first }], 1),
        roleRevision: 2,
        roleChanges: { updated: ['first'] },
      }}
      reading={owner}
      renderRow={renderRow}
    />,
  );
  fireEvent.wheel(scroller, { deltaY: -80 });
  act(() => legendHarness.props.totalListHeightChanged(1260));
  expect(owner.getSession().mode).toBe(READING_MODE.browsing);
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();
});

it('does not let a role-only height bypass an active send join', () => {
  const intent = {
    id: 'composer:send-start:role-blocked', inputEpoch: 0,
    afterPresentationRevision: 1, targetMessageIDs: ['send-target'],
  };
  const owner = followingReading({ bottomIntent: intent });
  const first = row('first', 1);
  const renderRow = (value) => <article>{value.id}</article>;
  const view = render(
    <MessageList
      snapshot={{ ...snapshot([first], 1), roleRevision: 0, roleChanges: { updated: [] } }}
      reading={owner}
      renderRow={renderRow}
    />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { scrollHeight: 1200, scrollTop: 400 });
  view.rerender(
    <MessageList
      snapshot={{
        ...snapshot([{ ...first }], 1),
        roleRevision: 1,
        roleChanges: { updated: ['first'] },
      }}
      reading={owner}
      renderRow={renderRow}
    />,
  );
  act(() => legendHarness.props.totalListHeightChanged(1200));
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();
  expect(owner.consumeBottomIntent).not.toHaveBeenCalled();
});

it('keeps the sole bottom writer live when an opt-in test trace sink throws', async () => {
  globalThis.__ATOLL_READING_TRACE__ = () => { throw new Error('diagnostic sink failed'); };
  const owner = followingReading();
  const first = row('first', 1);
  const view = render(
    <MessageList snapshot={snapshot([first], 1)} reading={owner} renderRow={(value) => <article>{value.id}</article>} />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller);
  setScrollerGeometry(scroller, { scrollHeight: 1200, scrollTop: 400 });
  view.rerender(
    <MessageList snapshot={snapshot([first, row('appended', 2)], 2)} reading={owner} renderRow={(value) => <article>{value.id}</article>} />,
  );
  act(() => legendHarness.props.totalListHeightChanged(1200));
  await waitFor(() => expect(legendHarness.scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: 'auto' }));
});

it('keeps text-point DOM walks out of hot layout observations and samples once at scroll end', async () => {
  const observations = [];
  const owner = reading((observation) => observations.push(observation));
  render(
    <MessageList
      snapshot={snapshot([row('first', 1)], 1)}
      reading={owner}
      surfaceVisible
      renderRow={(value) => <article data-reading-block-id={`block:${value.id}`}>first message text</article>}
    />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller);
  scroller.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600 });
  const rowNode = scroller.querySelector('[data-presentation-row-id]');
  const block = scroller.querySelector('[data-reading-block-id]');
  rowNode.getBoundingClientRect = () => ({ top: 0, bottom: 132, left: 0, right: 800, width: 800, height: 132 });
  block.getBoundingClientRect = () => ({ top: 8, bottom: 40, left: 8, right: 400, width: 392, height: 32 });
  const textNode = block.firstChild;
  document.caretRangeFromPoint ||= () => null;
  const caret = vi.spyOn(document, 'caretRangeFromPoint').mockReturnValue({
    startContainer: textNode,
    startOffset: 3,
    getBoundingClientRect: () => ({ top: 8 }),
  });
  const walkers = vi.spyOn(document, 'createTreeWalker');

  await act(async () => {
    legendHarness.props.rangeChanged({ startIndex: 99, endIndex: 99 });
    await new Promise(requestAnimationFrame);
  });
  expect(caret).not.toHaveBeenCalled();
  expect(walkers).not.toHaveBeenCalled();
  expect(observations.at(-1)).toMatchObject({
    bookmark: { messageID: 'first', rowViewportOffset: 0 },
    surfaceVisible: true,
    installedHighSeq: 1,
  });

  await act(async () => {
    scroller.dispatchEvent(new Event('scrollend'));
    await new Promise(requestAnimationFrame);
  });
  expect(caret).toHaveBeenCalledTimes(1);
  expect(walkers).toHaveBeenCalledTimes(1);
  expect(observations.at(-1)?.bookmark).toMatchObject({
    messageID: 'first',
    blockID: 'block:first',
    textOffset: 3,
    rowViewportOffset: 0,
  });
  caret.mockRestore();
  walkers.mockRestore();
});

it('materializes a fixed Waiting reserve and excludes rows behind its readable bottom', async () => {
  const observations = [];
  const owner = reading((observation) => observations.push(observation));
  render(
    <MessageList
      snapshot={snapshot([row('covered', 1)], 1)}
      reading={owner}
      surfaceVisible
      renderRow={(value) => <article>{value.id}</article>}
    />,
  );
  const Footer = legendHarness.props.components.Footer;
  const footer = render(<Footer />);
  expect(footer.container.querySelector('.timeline-waiting-obstruction')).toBeTruthy();

  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller);
  scroller.style.setProperty('--conversation-waiting-reserve', '100px');
  scroller.getBoundingClientRect = () => ({
    top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600,
  });
  const rowNode = scroller.querySelector('[data-presentation-row-id]');
  rowNode.getBoundingClientRect = () => ({
    top: 520, bottom: 590, left: 0, right: 800, width: 800, height: 70,
  });
  const originalElementFromPoint = document.elementFromPoint;
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => rowNode),
  });

  await act(async () => {
    legendHarness.props.rangeChanged({ startIndex: 99, endIndex: 99 });
    await new Promise(requestAnimationFrame);
  });
  expect(observations.at(-1)?.visibleRows).toEqual([]);

  if (originalElementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: originalElementFromPoint,
    });
  } else {
    delete document.elementFromPoint;
  }
});

it('resamples a promoted short-list row from the List commit without accepting its viewport wrapper', async () => {
  const observations = [];
  const owner = reading((observation) => observations.push(observation));
  render(
    <MessageList
      snapshot={snapshot([row('short-row', 1)], 1)}
      reading={owner}
      surfaceVisible
      renderRow={(value) => <article>{value.id}</article>}
    />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 600, scrollTop: 0 });
  scroller.getBoundingClientRect = () => ({
    top: 0, bottom: 600, left: 0, right: 800, width: 800, height: 600,
  });
  const rowNode = scroller.querySelector('[data-presentation-row-id]');
  rowNode.getBoundingClientRect = () => ({
    top: 0, bottom: 132, left: 0, right: 800, width: 800, height: 132,
  });
  const viewport = scroller.firstElementChild;
  viewport.setAttribute('data-viewport-type', 'element');
  const obstruction = document.createElement('div');
  scroller.append(obstruction);
  const originalElementFromPoint = document.elementFromPoint;
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => viewport),
  });

  observations.length = 0;
  await act(async () => {
    legendHarness.props.rangeChanged({ startIndex: 99, endIndex: 99 });
    await new Promise(requestAnimationFrame);
  });
  expect(observations.at(-1)?.visibleRows).toEqual([]);

  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => rowNode),
  });
  await act(async () => {
    legendHarness.props.context.onListCommit();
    await Promise.resolve();
    await new Promise(requestAnimationFrame);
  });
  expect(observations.at(-1)?.visibleRows).toEqual([{ messageID: 'short-row', seqHigh: 1 }]);

  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => obstruction),
  });
  await act(async () => {
    legendHarness.props.rangeChanged({ startIndex: 99, endIndex: 99 });
    await new Promise(requestAnimationFrame);
  });
  expect(observations.at(-1)?.visibleRows).toEqual([]);

  if (originalElementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: originalElementFromPoint,
    });
  } else {
    delete document.elementFromPoint;
  }
});

it('rechecks one committed list height at the microtask boundary when root geometry publishes late', async () => {
  const owner = followingReading();
  render(
    <MessageList
      snapshot={snapshot([row('tail', 1)], 1)}
      reading={owner}
      renderRow={(value) => <article>{value.id}</article>}
    />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1000, scrollTop: 400 });
  act(() => legendHarness.props.totalListHeightChanged(1000));

  act(() => legendHarness.props.totalListHeightChanged(1031));
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();

  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1031, scrollTop: 400 });
  await act(async () => { await Promise.resolve(); });
  expect(legendHarness.scrollTo).toHaveBeenCalledOnce();
  expect(legendHarness.scrollTo).toHaveBeenCalledWith({ top: 1031, behavior: 'auto' });
});

it('starts one bounded runway demand only from real upward input near the physical revealed edge', () => {
  const owner = reading(vi.fn());
  render(
    <MessageList
      snapshot={snapshot([row('first', 1), row('second', 2)], 1)}
      reading={owner}
      renderRow={(value) => <article>{value.id}</article>}
    />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 2400, scrollTop: 900 });

  act(() => legendHarness.props.rangeChanged({ startIndex: 98, endIndex: 99 }));
  expect(owner.onNearTop).not.toHaveBeenCalled();
  act(() => scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 })));
  expect(owner.onNearTop).not.toHaveBeenCalled();

  scroller.scrollTop = 700;
  act(() => scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 })));
  expect(owner.onNearTop).toHaveBeenCalledTimes(1);
  // The mocked owner keeps the same inputEpoch and the visible frontier has
  // not advanced, so another native callback cannot drain another segment.
  act(() => scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 })));
  expect(owner.onNearTop).toHaveBeenCalledTimes(1);
});

it('uses live gesture evidence when native momentum crosses the runway and stops after scrollend', () => {
  const owner = reading(vi.fn());
  const renderRow = (value) => <article>{value.id}</article>;
  const view = render(
    <MessageList
      snapshot={snapshot([row('first', 1), row('second', 2)], 1)}
      reading={owner}
      renderRow={renderRow}
    />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 2600, scrollTop: 1200 });
  act(() => scroller.dispatchEvent(new Event('scroll')));

  act(() => scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -600 })));
  expect(owner.onNearTop).not.toHaveBeenCalled();
  scroller.scrollTop = 700;
  act(() => scroller.dispatchEvent(new Event('scroll')));
  expect(owner.onNearTop).toHaveBeenCalledTimes(1);

  act(() => scroller.dispatchEvent(new Event('scrollend')));
  view.rerender(
    <MessageList
      snapshot={snapshot([row('older', 0), row('first', 1), row('second', 2)], 2)}
      reading={owner}
      renderRow={renderRow}
    />,
  );
  scroller.scrollTop = 500;
  act(() => scroller.dispatchEvent(new Event('scroll')));
  expect(owner.onNearTop).toHaveBeenCalledTimes(1);
});

it('keeps following for a downward no-op at the real tail but older movement takes control', () => {
  const owner = followingReading();
  render(
    <MessageList
      snapshot={snapshot([row('first', 1)], 1)}
      reading={owner}
      renderRow={(value) => <article>{value.id}</article>}
    />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1000, scrollTop: 400 });

  act(() => scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 120 })));
  expect(owner.onUserControl).not.toHaveBeenCalled();
  expect(owner.getSession().mode).toBe(READING_MODE.following);

  act(() => scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 })));
  expect(owner.onUserControl).toHaveBeenCalledTimes(1);
  expect(owner.getSession().mode).toBe(READING_MODE.browsing);
});

it('keeps content selection autoscroll browsing and never converts it into tail following', async () => {
  const owner = followingReading();
  render(
    <MessageList
      snapshot={snapshot([row('first', 1)], 1)}
      reading={owner}
      renderRow={(value) => <article data-testid="selection-content">{value.id}</article>}
    />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  const content = screen.getByTestId('selection-content');
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1200, scrollTop: 500 });
  const pointer = (type, y) => {
    const event = new Event(type, { bubbles: true });
    Object.defineProperties(event, {
      pointerType: { value: 'mouse' },
      button: { value: 0 },
      clientX: { value: 20 },
      clientY: { value: y },
    });
    return event;
  };

  act(() => content.dispatchEvent(pointer('pointerdown', 100)));
  act(() => content.dispatchEvent(pointer('pointermove', 130)));
  expect(owner.onUserControl).toHaveBeenCalledTimes(1);
  expect(owner.getSession().mode).toBe(READING_MODE.browsing);

  scroller.scrollTop = 600;
  await act(async () => {
    scroller.dispatchEvent(new Event('scroll'));
    await new Promise(requestAnimationFrame);
  });
  expect(owner.onUserControl).toHaveBeenCalledTimes(1);
  expect(owner.getSession().mode).toBe(READING_MODE.browsing);
});

it('keeps an explicit bottom intent pending across zero geometry and retries it from the next committed height signal', () => {
  const intent = { id: 'bottom:1', inputEpoch: 0 };
  const owner = followingReading({ bottomIntent: intent });
  render(<MessageList snapshot={snapshot([row('first', 1)], 1)} reading={owner} renderRow={(value) => <article>{value.id}</article>} />);
  const scroller = screen.getByRole('region', { name: '频道动态' });
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();
  expect(owner.consumeBottomIntent).not.toHaveBeenCalled();

  setScrollerGeometry(scroller, { scrollHeight: 1000, scrollTop: 300 });
  act(() => legendHarness.props.totalListHeightChanged(1000));
  expect(legendHarness.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'auto' });
  expect(owner.consumeBottomIntent).toHaveBeenCalledWith(intent);

  const secondIntent = { id: 'bottom:2', inputEpoch: 0 };
  owner.setBottomIntent(secondIntent);
  scroller.scrollTop = 300;
  act(() => legendHarness.props.totalListHeightChanged(1000));
  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(2);
  expect(owner.consumeBottomIntent).toHaveBeenLastCalledWith(secondIntent);
});

it('keeps explicit latest following through a later public tail-height commit', async () => {
  const owner = followingReading();
  const current = snapshot([row('first', 1)], 1);
  const view = render(
    <MessageList snapshot={current} reading={owner} renderRow={(value) => <article>{value.id}</article>} />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1200, scrollTop: 300 });
  const intent = { id: 'latest:explicit-1', inputEpoch: 0, afterPresentationRevision: 1 };
  owner.setBottomIntent(intent);

  view.rerender(
    <MessageList snapshot={current} reading={owner} renderRow={(value) => <article>{value.id}</article>} />,
  );

  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(1);
  expect(legendHarness.scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: 'auto' });
  expect(owner.consumeBottomIntent).toHaveBeenCalledWith(intent);
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1218, scrollTop: 600 });
  act(() => legendHarness.props.totalListHeightChanged(1218));
  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(2);
  expect(legendHarness.scrollTo).toHaveBeenLastCalledWith({ top: 1218, behavior: 'auto' });
  await act(async () => { await new Promise(requestAnimationFrame); });
  expect(owner.onReadingObservation).toHaveBeenCalled();
});

it('follows an exact forward tail extension even when the presentation revision is mixed', () => {
  const owner = followingReading();
  const first = row('first', 1);
  const partialTail = row('partial-tail', 2);
  const current = snapshot([first, partialTail], 1);
  const view = render(
    <MessageList snapshot={current} reading={owner} renderRow={(value) => <article>{value.id}</article>} />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1000, scrollTop: 400 });

  view.rerender(
    <MessageList
      snapshot={{
        ...snapshot([first, partialTail, row('installed-tail', 3)], 2),
        changes: {
          kind: 'mixed',
          inserted: ['installed-tail'],
          updated: ['first'],
          removed: [],
        },
      }}
      reading={owner}
      renderRow={(value) => <article>{value.id}</article>}
    />,
  );
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1132, scrollTop: 400 });
  act(() => legendHarness.props.totalListHeightChanged(1132));

  expect(legendHarness.scrollTo).toHaveBeenCalledOnce();
  expect(legendHarness.scrollTo).toHaveBeenCalledWith({ top: 1132, behavior: 'auto' });
});

it('finishes at the current physical tail when following readiness becomes committed', () => {
  const owner = followingReading();
  owner.bottomReady = false;
  const current = snapshot([row('first', 1)], 1);
  const view = render(
    <MessageList snapshot={current} reading={owner} renderRow={(value) => <article>{value.id}</article>} />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1218, scrollTop: 600 });

  owner.bottomReady = true;
  view.rerender(
    <MessageList snapshot={current} reading={owner} renderRow={(value) => <article>{value.id}</article>} />,
  );

  expect(legendHarness.scrollTo).toHaveBeenCalledOnce();
  expect(legendHarness.scrollTo).toHaveBeenCalledWith({ top: 1218, behavior: 'auto' });
});

it('releases a role height blocked by explicit latest after that exact intent is consumed', () => {
  const owner = followingReading();
  const first = row('first', 1);
  const renderRow = (value) => <article>{value.id}</article>;
  const view = render(
    <MessageList
      snapshot={{ ...snapshot([first], 1), roleRevision: 0, roleChanges: { updated: [] } }}
      reading={owner}
      renderRow={renderRow}
    />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1200, scrollTop: 300 });
  const intent = { id: 'latest:role-height', inputEpoch: 0, afterPresentationRevision: 1 };
  owner.setBottomIntent(intent);

  view.rerender(
    <MessageList
      snapshot={{
        ...snapshot([{ ...first }], 1),
        roleRevision: 1,
        roleChanges: { updated: ['first'] },
      }}
      reading={owner}
      renderRow={renderRow}
    />,
  );

  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(1);
  expect(owner.consumeBottomIntent).toHaveBeenCalledWith(intent);
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1218, scrollTop: 600 });
  act(() => legendHarness.props.totalListHeightChanged(1218));
  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(2);
  expect(legendHarness.scrollTo).toHaveBeenLastCalledWith({ top: 1218, behavior: 'auto' });
});

it('executes explicit latest immediately against current geometry without waiting for tail readiness', () => {
  const owner = followingReading();
  owner.bottomReady = false;
  owner.initializing = true;
  const current = snapshot([row('first', 1)], 1);
  const view = render(
    <MessageList snapshot={current} reading={owner} renderRow={(value) => <article>{value.id}</article>} />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1200, scrollTop: 300 });
  const intent = { id: 'latest:direct', inputEpoch: 0, afterPresentationRevision: 1 };
  owner.setBottomIntent(intent);

  view.rerender(
    <MessageList snapshot={current} reading={owner} renderRow={(value) => <article>{value.id}</article>} />,
  );

  expect(legendHarness.scrollTo).toHaveBeenCalledOnce();
  expect(legendHarness.scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: 'auto' });
  expect(owner.consumeBottomIntent).toHaveBeenCalledWith(intent);
});

it('satisfies explicit latest at the physical tail without issuing a redundant DOM write', () => {
  const owner = followingReading();
  const current = snapshot([row('first', 1)], 1);
  const view = render(
    <MessageList snapshot={current} reading={owner} renderRow={(value) => <article>{value.id}</article>} />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1200, scrollTop: 600 });
  const intent = { id: 'latest:already-there', inputEpoch: 0, afterPresentationRevision: 1 };
  owner.setBottomIntent(intent);

  view.rerender(
    <MessageList snapshot={current} reading={owner} renderRow={(value) => <article>{value.id}</article>} />,
  );

  expect(legendHarness.scrollTo).not.toHaveBeenCalled();
  expect(owner.consumeBottomIntent).toHaveBeenCalledWith(intent);
});

it('cancels a pending following height write when native input takes control first', () => {
  const owner = followingReading();
  render(<MessageList snapshot={snapshot([row('first', 1)], 1)} reading={owner} renderRow={(value) => <article>{value.id}</article>} />);
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1200, scrollTop: 600 });
  act(() => scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 })));
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1218, scrollTop: 500 });
  act(() => legendHarness.props.totalListHeightChanged(1218));
  expect(owner.getSession().mode).toBe(READING_MODE.browsing);
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();
});

it('keeps ordinary following authority until the committed root reaches the public list height', async () => {
  const owner = followingReading();
  const first = row('first', 1);
  const renderRow = (value) => <article>{value.id}</article>;
  const view = render(
    <MessageList snapshot={snapshot([first], 1)} reading={owner} renderRow={renderRow} />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1000, scrollTop: 400 });

  view.rerender(
    <MessageList snapshot={snapshot([first, row('appended', 2)], 2)} reading={owner} renderRow={renderRow} />,
  );
  act(() => legendHarness.props.totalListHeightChanged(1200));
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();

  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1200, scrollTop: 400 });
  await act(async () => {
    legendHarness.props.context.onListCommit();
    await Promise.resolve();
  });
  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(1);
  expect(legendHarness.scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: 'auto' });
});

for (const takeover of [false, true]) it(`joins browsing send to same-revision Waiting without a synthetic follow height (takeover=${takeover})`, async () => {
  const owner = followingReading();
  owner.onUserControl();
  const current = snapshot([row('existing-tail', 1)], 6);
  const renderRow = (value) => <article>{value.id}</article>;
  const view = render(<MessageList snapshot={current} reading={owner} renderRow={renderRow} />);
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { scrollTop: 100 });
  await act(async () => { await Promise.resolve(); });
  const intent = {
    id: 'composer:send-start:browsing-baseline', inputEpoch: owner.session.inputEpoch,
    afterPresentationRevision: 6, targetMessageIDs: [],
  };
  owner.setBottomIntent(intent);
  owner.returnToBottom();
  view.rerender(<MessageList snapshot={current} reading={owner} renderRow={renderRow} />);
  await act(async () => { await Promise.resolve(); });
  expect(scroller.scrollTop).toBe(100);
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();
  expect(owner.consumeBottomIntent).not.toHaveBeenCalled();

  const bound = { ...intent, targetMessageIDs: ['queued-request'] };
  owner.setBottomIntent(bound);
  if (takeover) owner.onUserControl();
  view.rerender(<MessageList snapshot={current} reading={owner} renderRow={renderRow}
    bottomIntentPresentation={{
      intentID: intent.id, activationID: owner.activationID, inputEpoch: intent.inputEpoch,
      presentationRevision: 6, ready: true,
      destinations: [{ messageID: 'queued-request', destination: 'waiting' }],
    }} />);
  await act(async () => { await Promise.resolve(); });
  expect(scroller.scrollTop).toBe(takeover ? 100 : 400);
  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(takeover ? 0 : 1);
  if (!takeover) expect(owner.consumeBottomIntent).toHaveBeenCalledWith(bound);
});

it('keeps real viewport and public height obligations while an existing follower waits for send readiness', async () => {
  const observers = [];
  const OriginalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(callback) { observers.push(callback); }
    observe() {}
    disconnect() {}
  };
  try {
    const intent = { id: 'composer:send-start:real-geometry', inputEpoch: 0,
      afterPresentationRevision: 6, targetMessageIDs: [] };
    const owner = followingReading({ bottomIntent: intent });
    render(<MessageList snapshot={snapshot([row('tail', 1)], 6)} reading={owner}
      renderRow={(value) => <article>{value.id}</article>} />);
    const scroller = screen.getByRole('region', { name: '频道动态' });
    setScrollerGeometry(scroller);
    act(() => observers.forEach((callback) => callback()));
    expect(legendHarness.scrollTo).not.toHaveBeenCalled();
    setScrollerGeometry(scroller, { clientHeight: 500 });
    act(() => observers.forEach((callback) => callback()));
    expect(scroller.scrollTop).toBe(500);
    setScrollerGeometry(scroller, { clientHeight: 500, scrollTop: 500, scrollHeight: 1200 });
    act(() => legendHarness.props.totalListHeightChanged(1200));
    await act(async () => { await Promise.resolve(); });
    expect(scroller.scrollTop).toBe(700);
    expect(owner.consumeBottomIntent).not.toHaveBeenCalled();
    owner.onUserControl();
    setScrollerGeometry(scroller, { clientHeight: 450, scrollTop: 300, scrollHeight: 1400 });
    act(() => {
      observers.forEach((callback) => callback());
      legendHarness.props.totalListHeightChanged(1400);
    });
    expect(scroller.scrollTop).toBe(300);
  } finally {
    globalThis.ResizeObserver = OriginalResizeObserver;
  }
});

it('follows the real tail when readiness arrives after explicit latest consumed its intent', () => {
  const owner = followingReading();
  owner.bottomReady = false;
  const current = snapshot([row('tail', 1)], 6);
  const renderRow = (value) => <article>{value.id}</article>;
  const view = render(<MessageList snapshot={current} reading={owner} renderRow={renderRow} />);
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { scrollTop: 100 });
  owner.setBottomIntent({ id: 'latest:before-ready', inputEpoch: 0, afterPresentationRevision: 6 });
  view.rerender(<MessageList snapshot={current} reading={owner} renderRow={renderRow} />);
  expect(scroller.scrollTop).toBe(400);
  expect(owner.session.bottomIntent.id).toBe('');
  setScrollerGeometry(scroller, { scrollTop: 400, scrollHeight: 1300 });
  act(() => legendHarness.props.totalListHeightChanged(1300));
  expect(scroller.scrollTop).toBe(400);
  owner.bottomReady = true;
  view.rerender(<MessageList snapshot={current} reading={owner} renderRow={renderRow} />);
  expect(scroller.scrollTop).toBe(700);
});

it('joins timeline readiness before its public item measurement and writes exactly once', async () => {
  const intent = {
    id: 'composer:send-start:ready-first',
    inputEpoch: 0,
    afterPresentationRevision: 1,
    targetMessageIDs: ['target'],
  };
  const owner = followingReading({ bottomIntent: intent });
  const first = row('first', 1);
  const target = { ...row('target', 2), body: { local: false } };
  const renderRow = (value) => <article>{value.id}</article>;
  const view = render(<MessageList snapshot={snapshot([first], 1)} reading={owner} renderRow={renderRow} />);
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1000, scrollTop: 400 });

  view.rerender(
    <MessageList
      snapshot={snapshot([first, target], 2)}
      reading={owner}
      bottomIntentPresentation={{
        intentID: intent.id,
        activationID: owner.activationID,
        inputEpoch: 0,
        presentationRevision: 2,
        ready: true,
        destinations: [{ messageID: 'target', destination: 'timeline' }],
      }}
      renderRow={renderRow}
    />,
  );
  await act(async () => { await Promise.resolve(); });
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();

  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1132, scrollTop: 400 });
  act(() => legendHarness.props.totalListHeightChanged(1132));
  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(1);
  expect(owner.consumeBottomIntent).toHaveBeenCalledWith(intent);
});

it('treats a later same-revision public height as ordinary follow while the send join remains pending', async () => {
  const intent = {
    id: 'composer:send-start:media-after-baseline', inputEpoch: 0,
    afterPresentationRevision: 1, targetMessageIDs: ['target'],
  };
  const owner = followingReading({ bottomIntent: intent });
  const first = row('first', 1);
  const target = { ...row('target', 2), body: { local: false } };
  const renderRow = (value) => <article>{value.id}</article>;
  const view = render(<MessageList snapshot={snapshot([first], 1)} reading={owner} renderRow={renderRow} />);
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1000, scrollTop: 400 });

  view.rerender(
    <MessageList
      snapshot={snapshot([first, target], 2)}
      reading={owner}
      bottomIntentPresentation={{
        intentID: intent.id, activationID: owner.activationID, inputEpoch: 0,
        presentationRevision: 2, ready: false, destinations: [],
      }}
      renderRow={renderRow}
    />,
  );
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1132, scrollTop: 400 });
  act(() => legendHarness.props.totalListHeightChanged(1132));
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();

  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1200, scrollTop: 400 });
  act(() => legendHarness.props.totalListHeightChanged(1200));
  expect(legendHarness.scrollTo).toHaveBeenCalledOnce();
  expect(owner.consumeBottomIntent).not.toHaveBeenCalled();
});

it('records an equal-height target baseline before following a later same-revision resize', () => {
  const intent = {
    id: 'composer:send-start:equal-baseline', inputEpoch: 0,
    afterPresentationRevision: 1, targetMessageIDs: ['target'],
  };
  const owner = followingReading({ bottomIntent: intent });
  const first = row('first', 1);
  const target = { ...row('target', 2), body: { local: false } };
  const renderRow = (value) => <article>{value.id}</article>;
  const view = render(<MessageList snapshot={snapshot([first], 1)} reading={owner} renderRow={renderRow} />);
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1000, scrollTop: 400 });
  act(() => legendHarness.props.totalListHeightChanged(1000));
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();

  view.rerender(
    <MessageList
      snapshot={snapshot([first, target], 2)}
      reading={owner}
      bottomIntentPresentation={{
        intentID: intent.id, activationID: owner.activationID, inputEpoch: 0,
        presentationRevision: 2, ready: false, destinations: [],
      }}
      renderRow={renderRow}
    />,
  );
  act(() => legendHarness.props.totalListHeightChanged(1000));
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();

  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1100, scrollTop: 400 });
  act(() => legendHarness.props.totalListHeightChanged(1100));
  expect(legendHarness.scrollTo).toHaveBeenCalledOnce();
  expect(owner.consumeBottomIntent).not.toHaveBeenCalled();
});

it('keeps the first child-first target ack as baseline and the latest ack as ordinary layout', () => {
  const intent = {
    id: 'composer:send-start:child-first-pair', inputEpoch: 0,
    afterPresentationRevision: 1, targetMessageIDs: ['target'],
  };
  const owner = followingReading({ bottomIntent: intent });
  const first = row('first', 1);
  const target = { ...row('target', 2), body: { local: false } };
  const renderRow = (value) => <article>{value.id}</article>;
  const view = render(<MessageList snapshot={snapshot([first], 1)} reading={owner} renderRow={renderRow} />);
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1200, scrollTop: 400 });
  legendHarness.commitHeights = [1132, 1200];

  view.rerender(
    <MessageList
      snapshot={snapshot([first, target], 2)}
      reading={owner}
      bottomIntentPresentation={{
        intentID: intent.id, activationID: owner.activationID, inputEpoch: 0,
        presentationRevision: 2, ready: false, destinations: [],
      }}
      renderRow={renderRow}
    />,
  );

  expect(legendHarness.scrollTo).toHaveBeenCalledOnce();
  expect(legendHarness.scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: 'auto' });
  expect(owner.consumeBottomIntent).not.toHaveBeenCalled();
});

it('does not overwrite a later same-revision height token when a send is revoked', async () => {
  const intent = {
    id: 'composer:send-start:revoke-after-media', inputEpoch: 0,
    afterPresentationRevision: 1, targetMessageIDs: ['target'],
  };
  const owner = followingReading({ bottomIntent: intent });
  const first = row('first', 1);
  const target = { ...row('target', 2), body: { local: false } };
  const renderRow = (value) => <article>{value.id}</article>;
  const view = render(<MessageList snapshot={snapshot([first], 1)} reading={owner} renderRow={renderRow} />);
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1132, scrollTop: 400 });
  view.rerender(
    <MessageList
      snapshot={snapshot([first, target], 2)}
      reading={owner}
      bottomIntentPresentation={{
        intentID: intent.id, activationID: owner.activationID, inputEpoch: 0,
        presentationRevision: 2, ready: false, destinations: [],
      }}
      renderRow={renderRow}
    />,
  );
  act(() => legendHarness.props.totalListHeightChanged(1132));
  act(() => legendHarness.props.totalListHeightChanged(1200));
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();

  owner.setBottomIntent({ id: '', inputEpoch: 0 });
  view.rerender(<MessageList snapshot={snapshot([first, target], 2)} reading={owner} renderRow={renderRow} />);
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();

  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1200, scrollTop: 400 });
  act(() => legendHarness.props.context.onListCommit());
  await act(async () => { await Promise.resolve(); });
  expect(legendHarness.scrollTo).toHaveBeenCalledOnce();
  expect(legendHarness.scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: 'auto' });
});

it('releases an owned baseline to ordinary follow when its send intent is revoked', () => {
  const intent = {
    id: 'composer:send-start:revoked', inputEpoch: 0,
    afterPresentationRevision: 1, targetMessageIDs: ['target'],
  };
  const owner = followingReading({ bottomIntent: intent });
  const first = row('first', 1);
  const target = { ...row('target', 2), body: { local: false } };
  const renderRow = (value) => <article>{value.id}</article>;
  const view = render(<MessageList snapshot={snapshot([first], 1)} reading={owner} renderRow={renderRow} />);
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1132, scrollTop: 400 });
  view.rerender(
    <MessageList
      snapshot={snapshot([first, target], 2)}
      reading={owner}
      bottomIntentPresentation={{
        intentID: intent.id, activationID: owner.activationID, inputEpoch: 0,
        presentationRevision: 2, ready: false, destinations: [],
      }}
      renderRow={renderRow}
    />,
  );
  act(() => legendHarness.props.totalListHeightChanged(1132));
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();

  owner.setBottomIntent({ id: '', inputEpoch: 0 });
  view.rerender(
    <MessageList snapshot={snapshot([first, target], 2)} reading={owner} renderRow={renderRow} />,
  );
  expect(legendHarness.scrollTo).toHaveBeenCalledOnce();
  expect(legendHarness.scrollTo).toHaveBeenCalledWith({ top: 1132, behavior: 'auto' });
});

it('preserves a parent-first ordinary tail obligation in a mixed send-target commit', () => {
  const intent = {
    id: 'composer:send-start:mixed-tail', inputEpoch: 0,
    afterPresentationRevision: 1, targetMessageIDs: ['target'],
  };
  const owner = followingReading({ bottomIntent: intent });
  const previousTail = row('unrelated-tail', 1);
  const target = { ...row('target', 2), body: { local: false } };
  const renderRow = (value) => <article>{value.id}</article>;
  const view = render(
    <MessageList snapshot={snapshot([previousTail], 1)} reading={owner} renderRow={renderRow} />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1100, scrollTop: 400 });

  view.rerender(
    <MessageList
      snapshot={{
        ...snapshot([target], 2),
        changes: {
          kind: 'mixed', inserted: ['target'], updated: [], removed: ['unrelated-tail'],
        },
      }}
      reading={owner}
      bottomIntentPresentation={{
        intentID: intent.id, activationID: owner.activationID, inputEpoch: 0,
        presentationRevision: 2, ready: false, destinations: [],
      }}
      renderRow={renderRow}
    />,
  );
  act(() => legendHarness.props.totalListHeightChanged(1100));

  expect(legendHarness.scrollTo).toHaveBeenCalledOnce();
  expect(owner.consumeBottomIntent).not.toHaveBeenCalled();
});

it('keeps a send transaction pending at the old tail and consumes it exactly once after its target presentation commit', async () => {
  const intent = {
    id: 'composer:send-start:1',
    inputEpoch: 0,
    afterPresentationRevision: 1,
    baselineTailID: 'first',
    targetMessageIDs: ['local-echo'],
  };
  const owner = followingReading({ bottomIntent: intent });
  const first = row('first', 1);
  const renderRow = (value) => <article>{value.id}</article>;
  const view = render(
    <MessageList snapshot={snapshot([first], 1)} reading={owner} renderRow={renderRow} />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1000, scrollTop: 400 });

  act(() => legendHarness.props.totalListHeightChanged(1000));
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();
  expect(owner.consumeBottomIntent).not.toHaveBeenCalled();

  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1132, scrollTop: 400 });
  const localEcho = { ...row('local-echo', 2), localState: 'queued', body: { local: true } };
  view.rerender(
    <MessageList
      snapshot={snapshot([first, localEcho], 2)}
      reading={owner}
      bottomIntentPresentation={{
        intentID: intent.id,
        activationID: owner.activationID,
        inputEpoch: 0,
        ready: false,
      }}
      renderRow={renderRow}
    />,
  );
  act(() => legendHarness.props.totalListHeightChanged(1132));
  await act(async () => { await Promise.resolve(); });

  expect(legendHarness.scrollTo).not.toHaveBeenCalled();
  expect(owner.consumeBottomIntent).not.toHaveBeenCalled();

  act(() => legendHarness.props.totalListHeightChanged(1132));
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();

  const landed = { ...row('local-echo', 2), body: { local: false } };
  view.rerender(
    <MessageList
      snapshot={{
        ...snapshot([first, landed], 3),
        changes: { kind: 'revise', inserted: [], updated: ['local-echo'], removed: [] },
      }}
      reading={owner}
      bottomIntentPresentation={{
        intentID: intent.id,
        activationID: owner.activationID,
        inputEpoch: 0,
        ready: false,
        destinations: [],
      }}
      renderRow={renderRow}
    />,
  );
  act(() => legendHarness.props.totalListHeightChanged(1132));
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();

  view.rerender(
    <MessageList
      snapshot={{
        ...snapshot([first, landed], 3),
        changes: { kind: 'revise', inserted: [], updated: ['local-echo'], removed: [] },
      }}
      reading={owner}
      bottomIntentPresentation={{
        intentID: intent.id,
        activationID: owner.activationID,
        inputEpoch: 0,
        ready: true,
        destinations: [{ messageID: 'local-echo', destination: 'timeline' }],
      }}
      renderRow={renderRow}
    />,
  );
  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(1);
  expect(legendHarness.scrollTo).toHaveBeenLastCalledWith({ top: 1132, behavior: 'auto' });
  expect(owner.consumeBottomIntent).toHaveBeenCalledTimes(1);
  expect(owner.consumeBottomIntent).toHaveBeenCalledWith(intent);

  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1264, scrollTop: 532 });
  view.rerender(
    <MessageList
      snapshot={{
        ...snapshot([{ ...first }, { ...landed, contentRevision: 2 }], 4),
        changes: { kind: 'revise', inserted: [], updated: ['local-echo'], removed: [] },
      }}
      reading={owner}
      renderRow={renderRow}
    />,
  );
  act(() => legendHarness.props.totalListHeightChanged(1264));
  // Once the exact send write has completed, a later timeline stream revision
  // is an ordinary following transaction.
  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(2);

  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1396, scrollTop: 664 });
  view.rerender(
    <MessageList
      snapshot={{
        ...snapshot([{ ...first }, { ...landed, contentRevision: 3 }], 5),
        changes: { kind: 'revise', inserted: [], updated: ['local-echo'], removed: [] },
      }}
      reading={owner}
      renderRow={renderRow}
    />,
  );
  act(() => legendHarness.props.totalListHeightChanged(1396));
  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(3);
});

it('lets an unrelated committed tail follow while a newer send target remains pending', async () => {
  const pendingIntent = {
    id: 'composer:send-start:pending-b',
    inputEpoch: 0,
    afterPresentationRevision: 1,
    targetMessageIDs: ['target-b'],
  };
  const owner = followingReading({ bottomIntent: pendingIntent });
  const first = row('first', 1);
  const renderRow = (value) => <article>{value.id}</article>;
  const view = render(
    <MessageList snapshot={snapshot([first], 1)} reading={owner} renderRow={renderRow} />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1000, scrollTop: 200 });

  const relocatedA = row('waiting-a', 2);
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1132, scrollTop: 400 });
  view.rerender(
    <MessageList
      snapshot={snapshot([first, relocatedA], 2)}
      reading={owner}
      bottomIntentPresentation={{
        intentID: pendingIntent.id,
        activationID: owner.activationID,
        inputEpoch: 0,
        presentationRevision: 2,
        ready: false,
        destinations: [],
      }}
      renderRow={renderRow}
    />,
  );
  act(() => legendHarness.props.totalListHeightChanged(1132));
  await waitFor(() => expect(legendHarness.scrollTo).toHaveBeenCalledTimes(1));
  expect(owner.consumeBottomIntent).not.toHaveBeenCalled();

  const targetB = { ...row('target-b', 3), localState: 'queued', body: { local: true } };
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1264, scrollTop: 532 });
  view.rerender(
    <MessageList
      snapshot={snapshot([first, relocatedA, targetB], 3)}
      reading={owner}
      bottomIntentPresentation={{
        intentID: pendingIntent.id,
        activationID: owner.activationID,
        inputEpoch: 0,
        presentationRevision: 3,
        ready: false,
        destinations: [],
      }}
      renderRow={renderRow}
    />,
  );
  act(() => legendHarness.props.totalListHeightChanged(1264));
  await act(async () => { await Promise.resolve(); });
  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(1);
  expect(owner.consumeBottomIntent).not.toHaveBeenCalled();
});

it('does not let a send target removal into Waiting bypass its destination-ready join', async () => {
  const intent = {
    id: 'composer:send-start:timeline-to-waiting',
    inputEpoch: 0,
    afterPresentationRevision: 1,
    targetMessageIDs: ['target'],
  };
  const owner = followingReading({ bottomIntent: intent });
  const first = row('first', 1);
  const target = { ...row('target', 2), localState: 'queued', body: { local: true } };
  const renderRow = (value) => <article>{value.id}</article>;
  const view = render(
    <MessageList snapshot={snapshot([first], 1)} reading={owner} renderRow={renderRow} />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1000, scrollTop: 200 });

  view.rerender(
    <MessageList
      snapshot={snapshot([first, target], 2)}
      reading={owner}
      bottomIntentPresentation={{
        intentID: intent.id, activationID: owner.activationID, inputEpoch: 0,
        presentationRevision: 2, ready: false, destinations: [],
      }}
      renderRow={renderRow}
    />,
  );
  act(() => legendHarness.props.totalListHeightChanged(1132));
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();

  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1000, scrollTop: 200 });
  view.rerender(
    <MessageList
      snapshot={{
        ...snapshot([first], 3),
        changes: { kind: 'mixed', inserted: [], updated: [], removed: ['target'] },
      }}
      reading={owner}
      bottomIntentPresentation={{
        intentID: intent.id, activationID: owner.activationID, inputEpoch: 0,
        presentationRevision: 3, ready: false, destinations: [],
      }}
      renderRow={renderRow}
    />,
  );
  act(() => legendHarness.props.totalListHeightChanged(1000));
  await act(async () => { await Promise.resolve(); });
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();

  view.rerender(
    <MessageList
      snapshot={{
        ...snapshot([first], 3),
        changes: { kind: 'mixed', inserted: [], updated: [], removed: ['target'] },
      }}
      reading={owner}
      bottomIntentPresentation={{
        intentID: intent.id, activationID: owner.activationID, inputEpoch: 0,
        presentationRevision: 3, ready: true,
        destinations: [{ messageID: 'target', destination: 'waiting' }],
      }}
      renderRow={renderRow}
    />,
  );
  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(1);
  expect(owner.consumeBottomIntent).toHaveBeenCalledWith(intent);
});

it('continues following committed Waiting-to-timeline growth and later same-id stream sizes', async () => {
  const intent = {
    id: 'composer:send-start:waiting',
    inputEpoch: 0,
    afterPresentationRevision: 1,
    targetMessageIDs: ['queued-request'],
  };
  const owner = followingReading({ bottomIntent: intent });
  const first = row('first', 1);
  const view = render(
    <MessageList snapshot={snapshot([first], 1)} reading={owner} renderRow={(value) => <article>{value.id}</article>} />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1000, scrollTop: 200 });
  view.rerender(
    <MessageList
      snapshot={snapshot([first], 1)}
      reading={owner}
      bottomIntentPresentation={{
        intentID: intent.id,
        activationID: owner.activationID,
        inputEpoch: 0,
        ready: true,
        destinations: [{ messageID: 'queued-request', destination: 'waiting' }],
      }}
      renderRow={(value) => <article>{value.id}</article>}
    />,
  );
  act(() => legendHarness.props.totalListHeightChanged(1000));
  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(1);
  expect(owner.consumeBottomIntent).toHaveBeenCalledWith(intent);

  const nextIntent = {
    id: 'composer:send-start:next',
    inputEpoch: 0,
    afterPresentationRevision: 1,
    targetMessageIDs: ['human-next'],
  };
  owner.setBottomIntent(nextIntent);
  const humanNext = { ...row('human-next', 2), body: { local: false } };
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1100, scrollTop: 400 });
  view.rerender(
    <MessageList
      snapshot={snapshot([first, humanNext], 3)}
      reading={owner}
      bottomIntentPresentation={{
        intentID: nextIntent.id,
        activationID: owner.activationID,
        inputEpoch: 0,
        presentationRevision: 3,
        ready: true,
        destinations: [{ messageID: 'human-next', destination: 'timeline' }],
      }}
      renderRow={(value) => <article>{value.id}</article>}
    />,
  );
  act(() => legendHarness.props.totalListHeightChanged(1100));
  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(2);
  expect(owner.consumeBottomIntent).toHaveBeenCalledWith(nextIntent);

  const running = row('queued-request', 2);
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1180, scrollTop: 400 });
  view.rerender(
    <MessageList
      snapshot={snapshot([first, humanNext, running], 4)}
      reading={owner}
      renderRow={(value) => <article>{value.id}</article>}
    />,
  );
  act(() => legendHarness.props.totalListHeightChanged(1180));
  await act(async () => { await Promise.resolve(); });
  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(3);

  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1312, scrollTop: 580 });
  view.rerender(
    <MessageList
      snapshot={{
        ...snapshot([{ ...first }, humanNext, { ...running, contentRevision: 2 }], 5),
        changes: { kind: 'revise', inserted: [], updated: ['queued-request'], removed: [] },
      }}
      reading={owner}
      renderRow={(value) => <article>{value.id}</article>}
    />,
  );
  act(() => legendHarness.props.totalListHeightChanged(1312));
  await waitFor(() => expect(legendHarness.scrollTo).toHaveBeenCalledTimes(4));
});

it('follows child-first and repeated committed heights while Waiting moves into timeline', async () => {
  const intent = {
    id: 'composer:send-start:child-first-waiting',
    inputEpoch: 0,
    afterPresentationRevision: 1,
    targetMessageIDs: ['queued-request'],
  };
  const owner = followingReading({ bottomIntent: intent });
  const first = row('first', 1);
  const renderRow = (value) => <article>{value.id}</article>;
  const view = render(
    <MessageList snapshot={snapshot([first], 1)} reading={owner} renderRow={renderRow} />,
  );
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1000, scrollTop: 200 });
  view.rerender(
    <MessageList
      snapshot={snapshot([first], 1)}
      reading={owner}
      bottomIntentPresentation={{
        intentID: intent.id,
        activationID: owner.activationID,
        inputEpoch: 0,
        presentationRevision: 2,
        ready: true,
        destinations: [{ messageID: 'queued-request', destination: 'waiting' }],
      }}
      renderRow={renderRow}
    />,
  );
  await waitFor(() => expect(legendHarness.scrollTo).toHaveBeenCalledTimes(1));

  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1180, scrollTop: 400 });
  legendHarness.commitHeight = 1180;
  view.rerender(
    <MessageList
      snapshot={snapshot([first, row('queued-request', 2)], 3)}
      reading={owner}
      renderRow={renderRow}
    />,
  );
  await act(async () => { await Promise.resolve(); });
  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(2);

  legendHarness.commitHeight = 0;
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1240, scrollTop: 580 });
  act(() => legendHarness.props.totalListHeightChanged(1240));
  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(3);

  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1280, scrollTop: 640 });
  act(() => legendHarness.props.totalListHeightChanged(1280));
  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(4);

  legendHarness.commitHeight = 1312;
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1312, scrollTop: 680 });
  view.rerender(
    <MessageList
      snapshot={{
        ...snapshot([first, { ...row('queued-request', 2), contentRevision: 2 }], 4),
        changes: { kind: 'revise', inserted: [], updated: ['queued-request'], removed: [] },
      }}
      reading={owner}
      renderRow={renderRow}
    />,
  );
  await waitFor(() => expect(legendHarness.scrollTo).toHaveBeenCalledTimes(5));
});

it('does not follow Waiting-to-timeline growth after user input takes ownership', async () => {
  const intent = {
    id: 'composer:send-start:waiting-takeover',
    inputEpoch: 0,
    afterPresentationRevision: 1,
    targetMessageIDs: ['queued-request'],
  };
  const owner = followingReading({ bottomIntent: intent });
  const first = row('first', 1);
  const renderRow = (value) => <article>{value.id}</article>;
  const view = render(<MessageList snapshot={snapshot([first], 1)} reading={owner} renderRow={renderRow} />);
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1000, scrollTop: 200 });
  view.rerender(
    <MessageList
      snapshot={snapshot([first], 2)}
      reading={owner}
      bottomIntentPresentation={{
        intentID: intent.id,
        activationID: owner.activationID,
        inputEpoch: 0,
        ready: true,
        destinations: [{ messageID: 'queued-request', destination: 'waiting' }],
      }}
      renderRow={renderRow}
    />,
  );
  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(1);

  owner.onUserControl();
  setScrollerGeometry(scroller, { clientHeight: 600, scrollHeight: 1180, scrollTop: 400 });
  view.rerender(
    <MessageList snapshot={snapshot([first, row('queued-request', 2)], 3)} reading={owner} renderRow={renderRow} />,
  );
  act(() => legendHarness.props.totalListHeightChanged(1180));
  await act(async () => { await Promise.resolve(); });
  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(1);
});

it('re-reads user control before a queued list commit can write', async () => {
  const owner = followingReading();
  render(<MessageList snapshot={snapshot([row('first', 1)], 1)} reading={owner} renderRow={(value) => <article>{value.id}</article>} />);
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller);
  act(() => legendHarness.props.atBottomStateChange(true));

  // Drain the mount's coalesced List notification before isolating this turn.
  await act(async () => { await Promise.resolve(); });
  legendHarness.scrollTo.mockReset();
  setScrollerGeometry(scroller, { scrollHeight: 1200, scrollTop: 400 });
  await act(async () => {
    legendHarness.props.context.onListCommit();
    owner.onUserControl();
    await Promise.resolve();
  });

  expect(owner.getSession().mode).toBe(READING_MODE.browsing);
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();
});

it('drops a queued list commit when its host unmounts or a new activation replaces it', async () => {
  const firstOwner = followingReading({ activationID: 'activation:first' });
  const firstSnapshot = snapshot([row('first', 1)], 1);
  const renderRow = (value) => <article>{value.id}</article>;
  const view = render(
    <MessageList key={firstOwner.activationID} snapshot={firstSnapshot} reading={firstOwner} renderRow={renderRow} />,
  );
  const firstScroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(firstScroller);
  act(() => legendHarness.props.atBottomStateChange(true));
  await act(async () => { await Promise.resolve(); });
  legendHarness.scrollTo.mockReset();
  setScrollerGeometry(firstScroller, { scrollHeight: 1200, scrollTop: 400 });

  const staleContext = legendHarness.props.context;
  const successor = followingReading({ activationID: 'activation:successor' });
  act(() => {
    staleContext.onListCommit();
    view.rerender(
      <MessageList key={successor.activationID} snapshot={snapshot([row('successor', 2)], 2)} reading={successor} renderRow={renderRow} />,
    );
  });
  await act(async () => { await Promise.resolve(); });
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();

  const successorScroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(successorScroller, { scrollHeight: 1100, scrollTop: 400 });
  act(() => legendHarness.props.atBottomStateChange(true));
  const successorContext = legendHarness.props.context;
  act(() => {
    successorContext.onListCommit();
    view.unmount();
  });
  await act(async () => { await Promise.resolve(); });
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();
});

it('rejects a late public layout callback after unmount without touching detached geometry', () => {
  const owner = followingReading();
  const view = render(
    <MessageList
      snapshot={snapshot([row('first', 1)], 1)}
      reading={owner}
      renderRow={(value) => <article>{value.id}</article>}
    />,
  );
  const lateHeightCallback = legendHarness.props.totalListHeightChanged;
  view.unmount();

  expect(() => lateHeightCallback(1200)).not.toThrow();
  expect(legendHarness.scrollTo).not.toHaveBeenCalled();
});

it('coalesces a scroll-induced list commit without a microtask retry loop', async () => {
  const owner = followingReading();
  const first = row('first', 1);
  const renderRow = (value) => <article>{value.id}</article>;
  const view = render(<MessageList snapshot={snapshot([first], 1)} reading={owner} renderRow={renderRow} />);
  const scroller = screen.getByRole('region', { name: '频道动态' });
  setScrollerGeometry(scroller);
  act(() => legendHarness.props.atBottomStateChange(true));
  await act(async () => { await Promise.resolve(); });
  legendHarness.scrollTo.mockReset();
  setScrollerGeometry(scroller, { scrollHeight: 1200, scrollTop: 400 });

  // Model a component commit caused by the public scroll write. Its queued
  // delivery must be rejected by the same geometry key instead of recurring.
  legendHarness.scrollTo.mockImplementation(() => {
    legendHarness.props.context.onListCommit();
  });
  act(() => {
    view.rerender(
      <MessageList snapshot={snapshot([first, row('appended', 2)], 2)} reading={owner} renderRow={renderRow} />,
    );
  });
  await act(async () => {
    legendHarness.props.totalListHeightChanged(1200);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(1);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(legendHarness.scrollTo).toHaveBeenCalledTimes(1);
});

it('an abandoned same-activation render cannot replace the committed lifecycle bookmark rows', async () => {
  const committedObservations = [];
  const speculativeObservations = [];
  const successorObservations = [];
  const committedOwner = reading((observation) => committedObservations.push(observation));
  // Same activation is deliberate: the abandoned render must not mutate the
  // committed binding merely because the application owner object changed.
  const speculativeOwner = reading((observation) => speculativeObservations.push(observation));
  const successorOwner = reading((observation) => successorObservations.push(observation), 'activation:b');
  const committed = row('committed-row', 1);
  const speculative = row('speculative-row', 2);
  const suspended = new Promise(() => {});
  const speculativeRender = vi.fn();
  const renderRow = (value) => {
    if (value.id === speculative.id) {
      speculativeRender();
      throw suspended;
    }
    return <article data-reading-block-id={`block:${value.id}`} data-test-height="132">{value.id}</article>;
  };
  const view = render(
    <Suspense fallback={<p>loading</p>}>
      <MessageList snapshot={snapshot([committed], 1)} reading={committedOwner} renderRow={renderRow} />
    </Suspense>,
  );
  await screen.findByText(committed.id);

  startTransition(() => {
    view.rerender(
      <Suspense fallback={<p>loading</p>}>
        <MessageList snapshot={snapshot([speculative], 2)} reading={speculativeOwner} renderRow={renderRow} />
      </Suspense>,
    );
  });
  await waitFor(() => expect(speculativeRender).toHaveBeenCalled());
  expect(screen.getByText(committed.id)).toBeTruthy();

  // Commit a real activation boundary while keeping the old host geometry
  // readable. Its cleanup must still belong to the last committed A owner,
  // never the A owner from the render React abandoned above.
  view.rerender(
    <Suspense fallback={<p>loading</p>}>
      <MessageList snapshot={snapshot([committed], 1)} reading={successorOwner} renderRow={renderRow} />
    </Suspense>,
  );
  const lifecycle = committedObservations.filter((observation) => observation.source === 'lifecycle');
  expect(lifecycle).toHaveLength(1);
  expect(lifecycle[0]).toMatchObject({ activationID: 'activation:a' });
  expect(speculativeObservations.filter((observation) => observation.source === 'lifecycle')).toHaveLength(0);
  expect(successorObservations.filter((observation) => observation.source === 'lifecycle')).toHaveLength(0);
});
