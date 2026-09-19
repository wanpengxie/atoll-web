import React, {
  Component,
  cloneElement,
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Virtuoso } from 'react-virtuoso';
import { READING_MODE, resolveReadingBookmark } from '../../model/reading-session.js';
import { MessageLayoutScope } from './MessageLayoutState.jsx';
import { executeReadingDOMCommand } from './reading-dom-command-executor.js';
import {
  completeViewportUnits,
  installedHighSeq,
  isReadingSurfaceVisible,
  topVisibleBookmark,
  visibleRowEvidence,
} from './reading-geometry.js';
import { createReadingNavigationCoordinator } from './reading-navigation-coordinator.js';
import { useBrowsingReadingController } from './useBrowsingReadingController.js';

class RowErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidUpdate(previous) {
    if (previous.revision !== this.props.revision && this.state.failed) {
      // eslint-disable-next-line react/no-did-update-set-state
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return <div className="timeline-row-error" role="alert">这条消息暂时无法显示。内容更新后会自动重试。</div>;
    }
    return this.props.children;
  }
}

function RowContent({ row, revision, renderRow }) {
  const child = renderRow(row);
  if (!isValidElement(child)) return child;
  return cloneElement(child, {
    className: [child.props.className, 'presentation-row', `presentation-row-${row.layoutClass}`]
      .filter(Boolean).join(' '),
    'data-content-revision': row.contentRevision,
    'data-render-revision': revision,
    'data-settled': row.settled || undefined,
  });
}

const MessageRow = memo(function MessageRow({ row, revision, renderRow, presentationState }) {
  return <MessageLayoutScope rowID={row.id}>
    <div
      data-presentation-row-id={row.id}
      data-visual-slot-id={row.visualSlotID || row.id}
      data-presentation-state={presentationState || undefined}
      className="presentation-row-shell"
    >
      <RowErrorBoundary revision={revision}>
        <RowContent row={row} revision={revision} renderRow={renderRow} />
      </RowErrorBoundary>
    </div>
  </MessageLayoutScope>;
}, (left, right) => left.row === right.row
  && left.revision === right.revision
  && left.presentationState === right.presentationState);

const List = React.forwardRef(function List({ children, ...props }, ref) {
  return <div {...props} ref={ref}>{children}</div>;
});

function WaitingObstructionFooter() {
  return <div className="timeline-waiting-obstruction" aria-hidden="true" />;
}

function HistoryStartBoundary({ boundary }) {
  return <div className="timeline-history-boundary-slot" aria-hidden={boundary?.label ? undefined : 'true'}>
    {boundary?.label && <div
      className="timeline-history-boundary"
      data-phase="exhausted"
      data-generation={boundary.generation}
      role="status"
    >{boundary.label}</div>}
  </div>;
}

function HistoryHeader({ context }) {
  return <HistoryStartBoundary boundary={context?.historyStartBoundary} />;
}

const VIRTUOSO_COMPONENTS = Object.freeze({
  List,
  Footer: WaitingObstructionFooter,
  Header: HistoryHeader,
});

function directionFromKey(key) {
  if (['ArrowUp', 'PageUp', 'Home'].includes(key)) return 'older';
  if (['ArrowDown', 'PageDown', 'End'].includes(key)) return 'newer';
  return '';
}

/**
 * The sole vendor-list adapter. It owns refs, native input attribution and
 * typed DOM command execution; ReadingSession remains the only semantic
 * owner. No mode, bookmark, history or folding state is stored here.
 */
export function VendorListExecutor({
  snapshot,
  reading,
  surfaceVisible = false,
  historyStartBoundary = null,
  rowRevision,
  rowPresentationState,
  renderRow,
  focusOnMount = false,
}) {
  const virtuosoRef = useRef(null);
  const rootRef = useRef(null);
  const [rootNode, setRootNode] = useState(null);
  const geometryRevisionRef = useRef(0);
  const observationFrameRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const consumedCommandRef = useRef('');
  const touchRef = useRef(null);
  const readingController = useBrowsingReadingController({ reading, snapshot });
  const { navigationPolicy, reportDomEvidence } = readingController;
  const readingRef = useRef(reading);
  const snapshotRef = useRef(snapshot);
  const bindScroller = useCallback((node) => {
    rootRef.current = node;
    setRootNode((current) => current === node ? current : node);
  }, []);
  const listContext = useMemo(() => ({ historyStartBoundary }), [historyStartBoundary]);

  useLayoutEffect(() => {
    readingRef.current = reading;
    snapshotRef.current = snapshot;
  }, [reading, snapshot]);

  const observe = useCallback((source = 'layout', settled = false) => {
    const root = rootRef.current;
    const owner = readingRef.current;
    const data = snapshotRef.current;
    if (!root || !surfaceVisible) return;
    const visibleRows = visibleRowEvidence(root, data.rows);
    const atTail = root.scrollHeight - root.clientHeight - root.scrollTop <= 24;
    reportDomEvidence(Object.freeze({
      type: 'reading-observation',
      activationID: owner.activationID,
      bookmark: topVisibleBookmark(root, data.rows),
      atTail,
      surfaceVisible: isReadingSurfaceVisible(root),
      installedHighSeq: installedHighSeq(root, data.rows),
      visibleRows,
      source,
      settled,
      inputEpoch: owner.getSession().inputEpoch,
      geometryRevision: geometryRevisionRef.current,
    }));
  }, [reportDomEvidence, surfaceVisible]);

  const scheduleObserve = useCallback((source = 'layout', settled = false) => {
    if (observationFrameRef.current) globalThis.cancelAnimationFrame?.(observationFrameRef.current);
    observationFrameRef.current = globalThis.requestAnimationFrame?.(() => {
      observationFrameRef.current = 0;
      observe(source, settled);
    }) || 0;
  }, [observe]);

  const coordinator = useMemo(() => createReadingNavigationCoordinator({
    activationID: reading.activationID,
    onBegin(transaction) {
      const result = readingRef.current.beginNavigation({
        direction: transaction.direction,
        gestureID: transaction.id,
        geometryRevision: geometryRevisionRef.current,
      });
      return result?.inputGeneration || 0;
    },
    onUpdate(transaction, reason) {
      readingRef.current.updateNavigation({
        inputGeneration: transaction.inputGeneration,
        direction: transaction.direction,
        gestureID: transaction.id,
        geometryRevision: geometryRevisionRef.current,
      });
      navigationPolicy.onNavigationUpdate(transaction, reason);
    },
    onEnd(transaction) {
      navigationPolicy.onNavigationEnd(transaction);
      readingRef.current.finishNavigation(transaction);
      scheduleObserve('user', true);
    },
    onCancel(transaction, reason) {
      navigationPolicy.onNavigationCancel();
      readingRef.current.cancelNavigation({
        inputGeneration: transaction.inputGeneration,
        gestureID: transaction.id,
        reason,
      });
    },
  }), [navigationPolicy, reading.activationID, scheduleObserve]);

  useEffect(() => {
    coordinator.replaceActivation(reading.activationID);
  }, [coordinator, reading.activationID]);

  const enforceFollowingTail = useCallback((source = 'layout') => {
    const root = rootRef.current;
    const current = readingRef.current.getSession();
    const input = navigationPolicy.currentInput();
    if (!root
      || current.mode !== READING_MODE.following
      // A newer-direction native gesture that has already reached the physical
      // tail is the same reading intent as following. Keep that intent alive if
      // an append lands before the coordinator's quiet deadline; older input
      // still revokes the writer immediately.
      || (input.active && input.direction !== 'newer')
      || root.scrollHeight - root.clientHeight - root.scrollTop <= 24) return false;
    const executed = executeReadingDOMCommand(
      Object.freeze({ type: 'scroll-tail' }),
      { virtuoso: virtuosoRef.current, root },
    );
    if (executed) scheduleObserve(source, true);
    return executed;
  }, [navigationPolicy, scheduleObserve]);

  useLayoutEffect(() => {
    if (!rootNode || typeof globalThis.MutationObserver !== 'function') return undefined;
    // Virtuoso commits its measured spacer in a DOM mutation before paint.
    // Consume the already-owned following intent at that boundary, rather
    // than waiting for the vendor's next-frame followOutput callback.
    const observer = new globalThis.MutationObserver(() => {
      enforceFollowingTail('layout');
    });
    observer.observe(rootNode, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style'],
    });
    return () => observer.disconnect();
  }, [enforceFollowingTail, rootNode]);

  useEffect(() => {
    const root = rootNode;
    if (!root) return undefined;
    const host = { activationID: reading.activationID, hostRole: 'conversation', hostToken: root };
    const wheel = (event) => {
      if (!event.deltaY) return;
      const direction = event.deltaY < 0 ? 'older' : 'newer';
      const atTail = root.scrollHeight - root.clientHeight - root.scrollTop <= 24;
      const current = readingRef.current.getSession();
      // A max-scroll wheel produces no native scroll event. Once following has
      // already been committed, keep that semantic state instead of repeatedly
      // demoting/re-promoting it for every wheel tick at the clamp.
      if (direction === 'newer' && atTail && current.mode === READING_MODE.following) return;
      coordinator.recordInput({ ...host, source: 'wheel', direction });
      const input = navigationPolicy.currentInput();
      // A wheel at an already-clamped tail emits no scroll event. Publish the
      // same physical-tail evidence here so the input cannot transiently demote
      // an otherwise-following session to browsing before a live append lands.
      if (input.active && input.direction === 'newer' && atTail) observe('user', true);
    };
    const keydown = (event) => {
      const direction = directionFromKey(event.key);
      if (!direction) return;
      coordinator.recordInput({ ...host, source: 'key', sourceID: event.key, direction });
      coordinator.endContact({ ...host, source: 'key', sourceID: event.key });
    };
    const touchstart = (event) => {
      const touch = event.touches?.[0];
      if (!touch) return;
      touchRef.current = { id: touch.identifier, y: touch.clientY };
      coordinator.beginPotential({ ...host, source: 'touch', sourceID: touch.identifier, direction: 'browse' });
    };
    const touchmove = (event) => {
      const current = touchRef.current;
      const touch = [...(event.touches || [])].find((item) => item.identifier === current?.id);
      if (!current || !touch || Math.abs(touch.clientY - current.y) < 2) return;
      const direction = touch.clientY > current.y ? 'older' : 'newer';
      current.y = touch.clientY;
      coordinator.recordInput({ ...host, source: 'touch', sourceID: current.id, direction });
    };
    const touchend = () => {
      const current = touchRef.current;
      if (!current) return;
      coordinator.endContact({ ...host, source: 'touch', sourceID: current.id });
      touchRef.current = null;
    };
    const scroll = () => {
      const top = Number(root.scrollTop || 0);
      const direction = top < lastScrollTopRef.current ? 'older' : top > lastScrollTopRef.current ? 'newer' : '';
      lastScrollTopRef.current = top;
      const input = navigationPolicy.currentInput();
      if (input.active) coordinator.recordScroll({ ...host, direction, bookmark: topVisibleBookmark(root, snapshotRef.current.rows) });
      reportDomEvidence(Object.freeze({
        type: 'scroll-position',
        activationID: readingRef.current.activationID,
        inputEpoch: input.inputEpoch,
        direction,
        atTop: top <= 1,
        scrollTop: top,
        scrollHeight: Number(root.scrollHeight || 0),
        clientHeight: Number(root.clientHeight || 0),
        demandUnits: completeViewportUnits(root),
      }));
      scheduleObserve(input.active ? 'user' : 'layout');
    };
    root.addEventListener('wheel', wheel, { passive: true });
    root.addEventListener('keydown', keydown);
    root.addEventListener('touchstart', touchstart, { passive: true });
    root.addEventListener('touchmove', touchmove, { passive: true });
    root.addEventListener('touchend', touchend, { passive: true });
    root.addEventListener('touchcancel', touchend, { passive: true });
    root.addEventListener('scroll', scroll, { passive: true });
    const scrollend = () => coordinator.recordScrollEnd(host);
    root.addEventListener('scrollend', scrollend);
    return () => {
      root.removeEventListener('wheel', wheel);
      root.removeEventListener('keydown', keydown);
      root.removeEventListener('touchstart', touchstart);
      root.removeEventListener('touchmove', touchmove);
      root.removeEventListener('touchend', touchend);
      root.removeEventListener('touchcancel', touchend);
      root.removeEventListener('scroll', scroll);
      root.removeEventListener('scrollend', scrollend);
      coordinator.cancel('host-unmounted');
    };
  }, [coordinator, navigationPolicy, observe, reading.activationID, reportDomEvidence, rootNode, scheduleObserve]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const current = reading.getSession();
    if (!root || !snapshot.rows.length) return;
    const intent = current.bottomIntent;
    if (intent.id && intent.inputEpoch === current.inputEpoch) {
      const key = `tail:${current.activationID}:${intent.id}`;
      if (consumedCommandRef.current !== key && executeReadingDOMCommand(
        Object.freeze({ type: 'scroll-tail' }),
        { virtuoso: virtuosoRef.current, root },
      )) {
        consumedCommandRef.current = key;
        reading.consumeBottomIntent(intent);
        scheduleObserve('layout', true);
      }
      return;
    }
    if (current.mode === READING_MODE.following) {
      enforceFollowingTail('layout');
      return;
    }
    if (current.mode !== READING_MODE.browsing || !current.bookmark) return;
    // Native navigation owns the viewport for the lifetime of its input
    // transaction. The bookmark recorded from that same motion is evidence,
    // not a request to replay a position command back into the list.
    if (navigationPolicy.currentInput().active) return;
    const resolved = resolveReadingBookmark(snapshot.rows, current.bookmark);
    if (!resolved) return;
    const key = `row:${current.activationID}:${current.inputEpoch}:${snapshot.revision}:${resolved.messageID}`;
    if (consumedCommandRef.current === key) return;
    if (executeReadingDOMCommand(Object.freeze({
      type: 'position-row',
      // Virtuoso's imperative location is data-local even when firstItemIndex
      // gives rendered rows a large logical origin for prepend stability.
      index: resolved.index,
      viewportOffset: resolved.rowViewportOffset,
    }), { virtuoso: virtuosoRef.current, root })) {
      consumedCommandRef.current = key;
      scheduleObserve('layout', true);
    }
  }, [enforceFollowingTail, navigationPolicy, reading, scheduleObserve, snapshot]);

  useLayoutEffect(() => {
    if (focusOnMount && rootNode) executeReadingDOMCommand({ type: 'claim-focus' }, { root: rootNode });
  }, [focusOnMount, rootNode]);

  useEffect(() => () => {
    if (observationFrameRef.current) globalThis.cancelAnimationFrame?.(observationFrameRef.current);
  }, []);

  if (reading.restorePending && !snapshot.rows.length) {
    return <div className="timeline-message-list timeline-reading-restore" role="status">正在恢复上次阅读位置…</div>;
  }
  if (!snapshot.rows.length) {
    return <div className="timeline-message-list" data-empty="true" role="region" aria-label="频道动态" />;
  }

  return <Virtuoso
    ref={virtuosoRef}
    className="timeline-message-list"
    role="region"
    aria-label="频道动态"
    data-reading-container="conversation-list"
    data-reading-mode={reading.session.mode}
    tabIndex={0}
    data={snapshot.rows}
    firstItemIndex={Number(snapshot.firstItemIndex || 1)}
    initialTopMostItemIndex={reading.session.mode === READING_MODE.following
      ? Math.max(0, snapshot.rows.length - 1)
      : resolveReadingBookmark(snapshot.rows, reading.session.bookmark)?.index || 0}
    computeItemKey={(_index, row) => row.id}
    itemContent={(index, row) => <MessageRow
      row={row}
      revision={rowRevision?.(index, row) || String(row.contentRevision)}
      renderRow={renderRow}
      presentationState={rowPresentationState?.(row) || ''}
    />}
    followOutput={false}
    defaultItemHeight={132}
    increaseViewportBy={900}
    overscan={900}
    scrollerRef={bindScroller}
    components={VIRTUOSO_COMPONENTS}
    context={listContext}
    rangeChanged={(range) => {
      reportDomEvidence(Object.freeze({
        type: 'materialized-range',
        activationID: reading.activationID,
        presentationRevision: Number(snapshot.revision || 0),
        startIndex: Number(range.startIndex),
        endIndex: Number(range.endIndex),
      }));
      const root = rootRef.current;
      if (root) reportDomEvidence(Object.freeze({
        type: 'viewport-coverage',
        activationID: reading.activationID,
        presentationRevision: Number(snapshot.revision || 0),
        hasBothBoundaries: range.startIndex === 0 && range.endIndex >= snapshot.rows.length - 1,
        underfilled: root.scrollHeight <= root.clientHeight + 1,
        scrollHeight: Number(root.scrollHeight || 0),
        clientHeight: Number(root.clientHeight || 0),
        demandUnits: completeViewportUnits(root),
        onWake: () => scheduleObserve('layout'),
      }));
      scheduleObserve('layout');
    }}
    totalListHeightChanged={() => {
      geometryRevisionRef.current += 1;
      enforceFollowingTail('layout');
      scheduleObserve('layout');
    }}
    atBottomStateChange={() => scheduleObserve('layout')}
  />;
}
