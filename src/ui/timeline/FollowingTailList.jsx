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
import { diagnostic, isReadingTraceEnabled, readingTrace } from '../../model/diagnostics.js';
import { READING_MODE } from '../../model/reading-session.js';
import { MessageLayoutScope } from './MessageLayoutState.jsx';
import { useReadingNavigationHost } from './ReadingNavigationOwner.jsx';
import { HistoryStartBoundary } from './HistoryStartBoundary.jsx';
import {
  completeViewportUnits,
  installedHighSeq,
  isReadingSurfaceVisible,
  topVisibleBookmark,
  visibleRowEvidence,
} from './reading-geometry.js';
import { consumeHistoryConsumerResult } from './history-consumer-demand.js';

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
const LIVE_ENTRY_DURATION_MS = 180;

function isAtTail(root) {
  if (!root) return false;
  return Math.abs(Number(root.scrollTop || 0)) <= 1;
}

function isAtHistoryStart(root) {
  if (!root) return false;
  const extent = Math.max(0, Number(root.scrollHeight || 0) - Number(root.clientHeight || 0));
  return Math.abs(Number(root.scrollTop || 0)) >= extent - 1;
}

function ownsActiveInteraction(root) {
  if (!root) return false;
  const activeElement = globalThis.document?.activeElement;
  if (activeElement && (activeElement === root || root.contains(activeElement))) return true;
  const selection = globalThis.getSelection?.();
  if (!selection || selection.isCollapsed) return false;
  return Boolean(
    (selection.anchorNode && root.contains(selection.anchorNode))
    || (selection.focusNode && root.contains(selection.focusNode)),
  );
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
  livePresentationArrivals = null,
  historyStartBoundary = null,
}) {
  const rootRef = useRef(null);
  const [rootNode, setRootNode] = useState(null);
  const committedRef = useRef({
    reading,
    snapshot,
    active,
    surfaceVisible: surfaceVisible === true,
    windowSize,
  });
  const observationFrameRef = useRef(0);
  const consumedIntentRef = useRef('');
  const underfillKeyRef = useRef('');
  const liveEntryAnimationsRef = useRef(new Map());
  const liveEntryRevisionRef = useRef({ revision: -1, ids: new Set() });
  const liveEntryOwnerRef = useRef('');
  const bindRoot = useCallback((node) => {
    rootRef.current = node;
    setRootNode(node);
  }, []);

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

  const settleLiveEntries = useCallback((reason = 'settled') => {
    const activeEntries = liveEntryAnimationsRef.current;
    const settledCount = activeEntries.size;
    for (const [rowID, entry] of activeEntries) {
      activeEntries.delete(rowID);
      try { entry.animation.finish(); } catch { /* already idle/replaced */ }
      try { entry.animation.cancel(); } catch { /* detached animation */ }
      if (entry.node?.dataset) delete entry.node.dataset.liveEntryTransition;
    }
    if (settledCount > 0 && isReadingTraceEnabled()) {
      readingTrace('reading.live-entry-settled', {
        activationID: committedRef.current.reading?.activationID || '',
        reason,
        count: settledCount,
      });
    }
  }, []);

  // ---- observation (read-only) --------------------------------------------

  const publishObservation = useCallback((source) => {
    const root = rootRef.current;
    const committed = committedRef.current;
    const owner = committed.reading;
    if (!committed.active || !root || !owner) return;
    const current = owner.getSession?.() || owner.session;
    const data = committed.snapshot;
    const visible = committed.surfaceVisible && isReadingSurfaceVisible(root);
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

  const onScroll = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    scheduleObservation(Math.abs(Number(root.scrollTop || 0)) > LEAVE_TAIL_THRESHOLD ? 'user' : 'layout');
  }, [scheduleObservation]);

  const navigationHost = useMemo(() => ({
    // ReadingNavigationOwner calls this synchronously before the one canonical
    // bookmark read for real physical navigation. Settling changes no scroll
    // position; it only releases the visual layout effect to final geometry.
    prepareNavigationRead: () => settleLiveEntries('physical-navigation'),
    readBookmark: () => topVisibleBookmark(rootRef.current, committedRef.current.snapshot.rows),
    presentationRevision: () => Number(committedRef.current.snapshot.revision || 0),
    ownsFocus: () => {
      const root = rootRef.current;
      return root === globalThis.document?.activeElement
        || root?.contains?.(globalThis.document?.activeElement);
    },
    geometryRevision: () => 0,
    isEffectiveMotion: (_previous, next) => Number(next) <= -LEAVE_TAIL_THRESHOLD,
    onNavigationUpdate(transaction, reason) {
      if (reason !== 'begin') return;
      const root = rootRef.current;
      const committedOwner = committedRef.current;
      const owner = committedOwner.reading;
      if (!root || !owner) return;
      const atTail = isAtTail(root);
      owner.onReadingObservation?.({
        activationID: transaction.activationID,
        source: 'user',
        inputEpoch: transaction.inputGeneration,
        geometryRevision: 0,
        atTail,
        atTop: false,
        surfaceVisible: committedOwner.surfaceVisible,
        installedHighSeq: installedHighSeq(root, committedOwner.snapshot.rows),
        visibleRows: Object.freeze([]),
        bookmark: atTail
          ? null
          : transaction.latestBookmark || topVisibleBookmark(root, committedOwner.snapshot.rows),
      });
      // The following surface can consume the one native displacement that
      // activates browsing before Virtuoso becomes the visible owner. Preserve
      // the DATA consequence of that same input here: an absolute Home command
      // is semantic top demand, while a wheel/touch demand needs the committed
      // physical start boundary. ReadingSession deduplicates both against the
      // one active history consumer operation.
      if (transaction.canRequestHistory !== false
        && transaction.direction === 'older'
        && ((transaction.source === 'key' && transaction.sourceID === 'Home')
          || isAtHistoryStart(root))) {
        void owner.onAtTop?.({ demandUnits: completeViewportUnits(root) });
      }
      if (isReadingTraceEnabled()) {
        const committed = owner.getSession?.() || owner.session;
        readingTrace('reading.following-handoff', {
          activationID: transaction.activationID,
          inputEpoch: transaction.inputGeneration,
          scrollTop: Number(root.scrollTop || 0),
          scrollHeight: Number(root.scrollHeight || 0),
          clientHeight: Number(root.clientHeight || 0),
          bookmark: transaction.latestBookmark,
          committedMode: committed.mode,
          committedBookmark: committed.bookmark,
        });
      }
    },
  }), [settleLiveEntries]);
  useReadingNavigationHost('following', navigationHost, rootNode);

  // ---- lifecycle -----------------------------------------------------------

  useLayoutEffect(() => {
    committedRef.current = {
      reading,
      snapshot,
      active,
      surfaceVisible: surfaceVisible === true,
      windowSize,
    };
    if (active && surfaceVisible !== true) reading.onSurfaceVisibilityChange?.(false);
  }, [active, reading, snapshot, surfaceVisible, windowSize]);

  const issueUnderfillIfCurrent = useCallback((expectedWakeKey = '') => {
    const root = rootRef.current;
    const committed = committedRef.current;
    const owner = committed.reading;
    const status = owner?.status || {};
    const scrollHeight = Number(root?.scrollHeight || 0);
    const clientHeight = Number(root?.clientHeight || 0);
    // A real browser publishes physical extent. jsdom/SSR-style hosts do not;
    // in that case a full bounded consumer batch is the only conservative
    // evidence that this activation no longer owes another acquisition.
    const geometryUnderfilled = clientHeight > 0 || scrollHeight > 0
      ? scrollHeight <= clientHeight + 1
      : committed.snapshot.rows.length <= completeViewportUnits(root);
    if (!committed.active
      || committed.surfaceVisible !== true
      || !root
      || !owner
      || status.hasOlder !== true
      || committed.snapshot.rows.length > Number(committed.windowSize || FOLLOWING_TAIL_WINDOW)
      || !geometryUnderfilled) {
      underfillKeyRef.current = '';
      return;
    }
    // A typed receipt belongs to the exact consumer wake that issued it. If a
    // newer supply/geometry edge has already become the DOM owner's debt, the
    // older receipt must not replay over that newer measurement.
    if (expectedWakeKey && underfillKeyRef.current !== expectedWakeKey) return;
    const wakeKey = JSON.stringify([
      owner.activationID,
      committed.snapshot.rows.length,
      String(committed.snapshot.rows[0]?.id || ''),
      String(committed.snapshot.rows[committed.snapshot.rows.length - 1]?.id || ''),
      String(status.sourceLease || ''),
      Number(status.completedPages || 0),
      Number(status.revealVersion || 0),
      Number(status.buffered || 0),
      status.hasOlder === true,
      status.loading === true,
      String(status.error || ''),
      Number(status.retryAt || 0),
      clientHeight,
      scrollHeight,
    ]);
    if (!expectedWakeKey && underfillKeyRef.current === wakeKey) return;
    underfillKeyRef.current = wakeKey;
    diagnostic('debug', 'history.viewport_underfilled', {
      channelId: status.channelId || '',
      clientHeight,
      scrollHeight,
      rowCount: committed.snapshot.rows.length,
      attached: status.attached === true,
      messageCurrent: status.messageCurrent === true,
      bottomReady: owner.bottomReady === true,
      hasOlder: status.hasOlder === true,
    });
    const pending = owner.onUnderfill?.({ demandUnits: completeViewportUnits(root) });
    void consumeHistoryConsumerResult(pending, () => issueUnderfillIfCurrent(wakeKey));
  }, []);

  // A visual-entry transaction decorates only exact live identities that this
  // committed Presentation appended at the back. The row DOM and final layout
  // already exist. Animating a grid fraction makes that one box contribute
  // continuously from zero to its natural height; if late content changes the
  // natural height during the effect, the same effect follows it rather than
  // freezing a stale pixel target or starting another queue item.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const current = reading.getSession?.() || reading.session;
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    const presentationRevision = Number(snapshot.revision || 0);
    const ownerKey = `${reading.activationID}\u001f${snapshot.epoch || ''}\u001f${snapshot.viewID || ''}`;
    if (liveEntryOwnerRef.current !== ownerKey) {
      settleLiveEntries('owner-replaced');
      liveEntryOwnerRef.current = ownerKey;
      liveEntryRevisionRef.current = { revision: -1, ids: new Set() };
    }
    if (liveEntryRevisionRef.current.revision !== presentationRevision) {
      liveEntryRevisionRef.current = { revision: presentationRevision, ids: new Set() };
    }
    if (!active
      || !root
      || surfaceVisible !== true
      || globalThis.document?.visibilityState === 'hidden'
      || current.mode !== READING_MODE.following
      || !isAtTail(root)
      || ownsActiveInteraction(root)
      || reduced
      || typeof root.animate !== 'function') {
      settleLiveEntries('ineligible');
      return;
    }
    const liveIDs = new Set((livePresentationArrivals?.events || [])
      .flatMap((event) => event.rowIDs || []));
    if (!liveIDs.size) return;
    const tailIDs = new Set(tailRows.map((row) => row.id));
    const appended = snapshot.changes?.backInsertedIDs || [];
    for (const rowID of appended) {
      if (!liveIDs.has(rowID)
        || !tailIDs.has(rowID)
        || liveEntryRevisionRef.current.ids.has(rowID)) continue;
      const row = snapshot.entities?.get?.(rowID)
        || tailRows.find((candidate) => candidate.id === rowID);
      // Waiting already owns an explicit handoff for this stable identity.
      // Keep that state untouched and never stack a second entry treatment.
      if (!row || rowPresentationState?.(row)) continue;
      const node = [...root.querySelectorAll('[data-presentation-row-id]')]
        .find((candidate) => candidate.dataset.presentationRowId === rowID);
      if (!node) continue;
      liveEntryRevisionRef.current.ids.add(rowID);
      node.dataset.liveEntryTransition = 'running';
      const animation = node.animate([
        { gridTemplateRows: '0fr' },
        { gridTemplateRows: '1fr' },
      ], {
        duration: LIVE_ENTRY_DURATION_MS,
        easing: 'cubic-bezier(.2, .75, .25, 1)',
        fill: 'none',
      });
      const entry = { animation, node };
      liveEntryAnimationsRef.current.set(rowID, entry);
      const release = () => {
        if (liveEntryAnimationsRef.current.get(rowID) !== entry) return;
        liveEntryAnimationsRef.current.delete(rowID);
        // fill:none releases visual authority at the timeline boundary even if
        // no event callback arrives; cancel only drops the completed object.
        try { animation.cancel(); } catch { /* detached animation */ }
        if (node.dataset) delete node.dataset.liveEntryTransition;
        scheduleObservation('layout');
      };
      animation.finished.then(release, release);
    }
  }, [
    active,
    livePresentationArrivals,
    reading,
    rowPresentationState,
    scheduleObservation,
    settleLiveEntries,
    snapshot,
    surfaceVisible,
    tailRows,
  ]);

  useLayoutEffect(() => {
    const media = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onVisibility = () => {
      if (globalThis.document?.visibilityState === 'hidden') settleLiveEntries('document-hidden');
    };
    const onMotion = (event) => {
      if (event.matches) settleLiveEntries('reduced-motion');
    };
    globalThis.document?.addEventListener?.('visibilitychange', onVisibility);
    media?.addEventListener?.('change', onMotion);
    return () => {
      globalThis.document?.removeEventListener?.('visibilitychange', onVisibility);
      media?.removeEventListener?.('change', onMotion);
    };
  }, [settleLiveEntries]);

  useLayoutEffect(() => {
    if (!active || !focusOnMount) return;
    const root = rootRef.current;
    // A presentation choice can rerender Timeline while its disclosure button
    // already owns focus inside this still-active Following DOM. focusOnMount
    // is also used for a real adapter handoff; it must not turn an ordinary
    // fold/details commit into a focus transfer to the scroller.
    if (!root || root.contains(globalThis.document?.activeElement)) return;
    root.focus?.({ preventScroll: true });
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
    const observer = new globalThis.ResizeObserver(() => {
      scheduleObservation('layout');
      issueUnderfillIfCurrent();
    });
    observer.observe(root);
    const content = root.firstElementChild;
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [active, issueUnderfillIfCurrent, scheduleObservation]);

  useEffect(() => () => {
    if (observationFrameRef.current) globalThis.cancelAnimationFrame?.(observationFrameRef.current);
    settleLiveEntries('unmounted');
  }, [settleLiveEntries]);

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

  // Underfill is a persistent DOM-owned DATA demand, not a position. Supply,
  // admission settlement and viewport resize all return here to remeasure the
  // current committed surface before any acquisition is started.
  const hasOlder = reading.status?.hasOlder === true;
  useEffect(() => {
    issueUnderfillIfCurrent();
  }, [active, hasOlder, issueUnderfillIfCurrent, reading, snapshot.revision, surfaceVisible, windowTruncated]);

  if (reading.restorePending && !snapshot.rows.length) {
    return <div className="timeline-message-list timeline-reading-restore" role="status">正在恢复上次阅读位置…</div>;
  }
  if (!snapshot.rows.length) {
    return <div className="timeline-message-list" data-empty="true" role="region" aria-label="频道动态" />;
  }

  return <div
    ref={bindRoot}
    className="timeline-message-list timeline-following-tail"
    role="region"
    aria-label="频道动态"
    data-reading-container="following-tail"
    data-tail-window={tailRows.length}
    data-tail-truncated={windowTruncated || undefined}
    tabIndex={active ? 0 : -1}
    onScroll={active ? onScroll : undefined}
    onFocusCapture={active ? () => {
      if (liveEntryAnimationsRef.current.size > 0) settleLiveEntries('focus-entered');
    } : undefined}
  >
    {/* One wrapper child keeps DOM order natural (oldest -> newest) while the
      * scroller's column-reverse still puts the scroll origin at the bottom.
      * Reading order, Tab order and cross-row selection stay correct; the
      * reversed-children variant would break all three for no extra benefit.
      * Both variants were measured; see Q.md 里程碑 0. */}
    <div className="timeline-following-tail-content">
      {!windowTruncated && <HistoryStartBoundary boundary={historyStartBoundary} />}
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
