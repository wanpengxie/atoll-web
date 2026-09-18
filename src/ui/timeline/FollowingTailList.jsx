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
} from 'react';
import { isReadingTraceEnabled, readingTrace } from '../../model/diagnostics.js';
import { READING_MODE } from '../../model/reading-session.js';
import { MessageLayoutScope } from './MessageLayoutState.jsx';
import {
  completeViewportUnits,
  installedHighSeq,
  isReadingSurfaceVisible,
  topVisibleBookmark,
  visibleRowEvidence,
} from './reading-geometry.js';

// The following container.
//
// Ruling (SUPERVISOR.md 15:28): sticking to the bottom is a STRUCTURAL
// property, not a correction. This container is a plain DOM scroller whose
// `flex-direction: column-reverse` puts the scroll origin at the BOTTOM, so:
//
//   scrollTop === 0  <=>  the viewport is at the tail
//
// and it stays 0 through every height change the browser can produce — a row
// appended at the tail, the tail row's own text growing, an image or code block
// resolving late, the composer stack getting taller, the waiting dock coming
// and going. Measured on this machine's Chromium before a line was written
// (see Q.md 里程碑 0). Consequently this file contains NO geometry writer:
// no scrollTop assignment, no scrollTo/scrollBy/scrollIntoView, no rAF
// catch-up, no timer. Searching this file for a write is the cheapest way to
// falsify that claim.
//
// Everything it does write is an OBSERVATION back to ReadingSession through the
// existing public entry points. It owns no reading state of its own.

export const FOLLOWING_TAIL_WINDOW = 80;

// scrollTop is 0 at the tail and NEGATIVE going up. A couple of pixels of
// sub-pixel/elastic noise must not be read as "the user left".
const LEAVE_TAIL_THRESHOLD = 3;

function isAtTail(root) {
  if (!root) return false;
  return Math.abs(Number(root.scrollTop || 0)) <= 1;
}

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

export function FollowingTailList({
  snapshot,
  reading,
  rowRevision,
  rowPresentationState,
  renderRow,
  surfaceVisible = false,
  window: windowSize = FOLLOWING_TAIL_WINDOW,
  active = true,
  focusOnMount = false,
  onHandoffStart,
}) {
  const rootRef = useRef(null);
  const readingRef = useRef(reading);
  const snapshotRef = useRef(snapshot);
  const activeRef = useRef(active);
  const observationFrameRef = useRef(0);
  const surfaceVisibleRef = useRef(surfaceVisible === true);
  const handedOffRef = useRef(false);
  const consumedIntentRef = useRef('');
  const underfillKeyRef = useRef('');

  readingRef.current = reading;
  snapshotRef.current = snapshot;
  // An already queued rAF/ResizeObserver callback can run between the browsing
  // commit and passive-effect cleanup. Read the committed adapter role through
  // a ref so that callback cannot publish one stale following observation.
  activeRef.current = active;

  const rows = snapshot.rows;
  // A pure derivation of the committed Presentation. No mirror, no cache: the
  // window is recomputed from the same rows the browsing container would show.
  const tailRows = useMemo(
    () => (rows.length > windowSize ? rows.slice(rows.length - windowSize) : rows),
    [rows, windowSize],
  );
  const tailStartIndex = rows.length - tailRows.length;
  const firstItemIndex = Number(snapshot.firstItemIndex || 0);
  const windowTruncated = rows.length > tailRows.length;

  // ---- observation (read-only) --------------------------------------------

  const publishObservation = useCallback((source) => {
    const root = rootRef.current;
    const owner = readingRef.current;
    if (!activeRef.current || !root || !owner) return;
    const current = owner.getSession?.() || owner.session;
    const data = snapshotRef.current;
    const visible = surfaceVisibleRef.current === true && isReadingSurfaceVisible(root);
    owner.onReadingObservation?.({
      activationID: current.activationID,
      source,
      inputEpoch: current.inputEpoch,
      // Following geometry never mints tail evidence: this container cannot
      // "arrive" at the tail, it IS the tail. Passing 0 keeps observeReading's
      // Math.max a no-op, so an ordinary layout observation never bumps the
      // session revision and never feeds a render loop.
      geometryRevision: 0,
      atTail: isAtTail(root),
      atTop: false,
      surfaceVisible: visible,
      installedHighSeq: installedHighSeq(root, data.rows),
      visibleRows: visible ? visibleRowEvidence(root, data.rows) : Object.freeze([]),
      bookmark: null,
    });
  }, []);

  const scheduleObservation = useCallback((source = 'layout') => {
    if (observationFrameRef.current) globalThis.cancelAnimationFrame?.(observationFrameRef.current);
    // Coalescing several commits in a frame into one read. This is a batching
    // window for READS, not a correction loop — nothing here can move the
    // scroller, and dropping the frame entirely would only delay a receipt.
    observationFrameRef.current = globalThis.requestAnimationFrame?.(() => {
      observationFrameRef.current = 0;
      publishObservation(source);
    }) || 0;
  }, [publishObservation]);

  // ---- following -> browsing handoff --------------------------------------

  // In following mode nothing but the user can change scrollTop: this file
  // never writes it, and column-reverse means no layout change moves it. A
  // non-zero scrollTop is therefore, by construction, a user gesture.
  const onScroll = useCallback(() => {
    const root = rootRef.current;
    const owner = readingRef.current;
    if (!root || !owner) return;
    const current = owner.getSession?.() || owner.session;
    if (current.mode !== READING_MODE.following) return;
    if (Number(root.scrollTop || 0) > -LEAVE_TAIL_THRESHOLD) {
      scheduleObservation('user');
      return;
    }
    if (handedOffRef.current) return;
    handedOffRef.current = true;
    // Read the anchor BEFORE the intent flips, while this container is still
    // the mounted one. This is the payload Virtuoso's initialTopMostItemIndex
    // consumes, so the browsing container mounts on the exact row the follower
    // was looking at.
    const bookmark = topVisibleBookmark(root, snapshotRef.current.rows);
    onHandoffStart?.({
      activationID: current.activationID,
      inputEpoch: current.inputEpoch,
      bookmark,
      focusOwned: root === globalThis.document?.activeElement
        || root.contains?.(globalThis.document?.activeElement),
    });
    owner.onUserControl?.({
      direction: 'older',
      gestureID: `following-tail:leave:${current.inputEpoch + 1}`,
      geometryRevision: current.geometryRevision,
    });
    // takeReadingControl already committed mode=browsing synchronously, so this
    // observation lands in the branch where observeReading stores the bookmark.
    owner.onReadingObservation?.({
      activationID: current.activationID,
      source: 'user',
      inputEpoch: current.inputEpoch + 1,
      geometryRevision: 0,
      atTail: false,
      atTop: false,
      surfaceVisible: surfaceVisibleRef.current === true,
      installedHighSeq: installedHighSeq(root, snapshotRef.current.rows),
      visibleRows: Object.freeze([]),
      bookmark,
    });
    if (isReadingTraceEnabled()) {
      const committed = owner.getSession?.() || owner.session;
      readingTrace('reading.following-handoff', {
        activationID: current.activationID,
        beforeInputEpoch: current.inputEpoch,
        inputEpoch: committed.inputEpoch,
        scrollTop: Number(root.scrollTop || 0),
        scrollHeight: Number(root.scrollHeight || 0),
        clientHeight: Number(root.clientHeight || 0),
        bookmark,
        committedMode: committed.mode,
        committedBookmark: committed.bookmark,
      });
    }
  }, [onHandoffStart, scheduleObservation]);

  // ---- lifecycle -----------------------------------------------------------

  useLayoutEffect(() => {
    if (!active) return;
    surfaceVisibleRef.current = surfaceVisible === true;
    if (surfaceVisible !== true) readingRef.current?.onSurfaceVisibilityChange?.(false);
  }, [active, surfaceVisible]);

  useLayoutEffect(() => {
    if (!active || !focusOnMount) return;
    rootRef.current?.focus?.({ preventScroll: true });
  }, [active, focusOnMount]);

  // Every committed presentation produces one observation. Appends, streaming
  // text and late media all arrive through here; none of them is allowed to
  // produce a positioning command.
  useLayoutEffect(() => {
    if (!active || !snapshot.rows.length) return;
    reading.onPresentationMaterialized?.({
      activationID: reading.activationID,
      presentationRevision: Number(snapshot.revision || 0),
      // Match Virtuoso's absolute item coordinate. Passing tail-local indices
      // here would acknowledge the wrong materialized interval after a
      // prepend, and would also feed rowRevision a different identity in the
      // two containers.
      startIndex: firstItemIndex + tailStartIndex,
      endIndex: firstItemIndex + rows.length - 1,
    });
    scheduleObservation('layout');
  }, [active, firstItemIndex, reading, rows.length, scheduleObservation, snapshot.revision, snapshot.roleRevision, tailRows.length, tailStartIndex]);

  // Rows whose intrinsic height resolves after first paint (images, code
  // blocks, fonts) still change the scroller's extent. Under column-reverse
  // that extent grows AWAY from the origin, so there is nothing to correct —
  // the resize only means a fresh installed-tail receipt is due.
  useEffect(() => {
    const root = rootRef.current;
    if (!active || !root || typeof globalThis.ResizeObserver !== 'function') return undefined;
    const observer = new globalThis.ResizeObserver(() => scheduleObservation('layout'));
    observer.observe(root);
    const content = root.firstElementChild;
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [active, scheduleObservation]);

  useEffect(() => () => {
    if (observationFrameRef.current) globalThis.cancelAnimationFrame?.(observationFrameRef.current);
  }, []);

  // A bottom intent (send-start, jump-to-latest) asks for the tail. Mounted
  // here the answer is already true, so the intent is retired rather than
  // executed. Retiring it is state hygiene through the owner's public entry
  // point, not a scroll.
  const bottomIntentID = reading.session.bottomIntent?.id || '';
  useLayoutEffect(() => {
    if (!active || !bottomIntentID || !snapshot.rows.length) return;
    const current = reading.getSession?.() || reading.session;
    if (current.bottomIntent?.id !== bottomIntentID
      || current.bottomIntent.inputEpoch !== current.inputEpoch
      || consumedIntentRef.current === bottomIntentID) return;
    const targets = current.bottomIntent.targetMessageIDs || [];
    const installed = !targets.length
      || targets.every((id) => snapshot.rows.some((row) => row.id === id));
    if (!installed) return;
    consumedIntentRef.current = bottomIntentID;
    reading.consumeBottomIntent?.({ id: bottomIntentID, inputEpoch: current.inputEpoch });
  }, [active, bottomIntentID, reading, snapshot.revision, snapshot.rows]);

  // Underfill is a DATA demand, not a position. If the whole projection is
  // shorter than the viewport and older content exists, ask for more.
  const hasOlder = reading.status?.hasOlder === true;
  useEffect(() => {
    const root = rootRef.current;
    if (!active || !root || !hasOlder || windowTruncated || surfaceVisible !== true) return;
    if (Number(root.scrollHeight || 0) > Number(root.clientHeight || 0) + 1) return;
    const key = `${reading.activationID}:${snapshot.revision}`;
    if (underfillKeyRef.current === key) return;
    underfillKeyRef.current = key;
    reading.onUnderfill?.({ demandUnits: completeViewportUnits(root) });
  }, [active, hasOlder, reading, snapshot.revision, surfaceVisible, windowTruncated]);

  if (reading.restorePending && !snapshot.rows.length) {
    return <div className="timeline-message-list timeline-reading-restore" role="status">正在恢复上次阅读位置…</div>;
  }
  if (!snapshot.rows.length) {
    return <div className="timeline-message-list" data-empty="true" role="region" aria-label="频道动态" />;
  }

  return <div
    ref={rootRef}
    className="timeline-message-list timeline-following-tail"
    role="region"
    aria-label="频道动态"
    data-reading-container="following-tail"
    data-tail-window={tailRows.length}
    data-tail-truncated={windowTruncated || undefined}
    tabIndex={active ? 0 : -1}
    onScroll={active ? onScroll : undefined}
  >
    {/* One wrapper child keeps DOM order natural (oldest -> newest) while the
      * scroller's column-reverse still puts the scroll origin at the bottom.
      * Reading order, Tab order and cross-row selection stay correct; the
      * reversed-children variant would break all three for no extra benefit.
      * Both variants were measured; see Q.md 里程碑 0. */}
    <div className="timeline-following-tail-content">
      {tailRows.map((row, index) => <MessageRow
        key={row.id}
        row={row}
        revision={rowRevision?.(firstItemIndex + tailStartIndex + index, row) || String(row.contentRevision)}
        renderRow={renderRow}
        presentationState={rowPresentationState?.(row) || ''}
      />)}
      <div className="timeline-waiting-obstruction" aria-hidden="true" />
    </div>
  </div>;
}
