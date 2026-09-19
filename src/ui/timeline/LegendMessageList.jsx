import React, {
  Component,
  cloneElement,
  forwardRef,
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
import { isReadingTraceEnabled, readingTrace } from '../../model/diagnostics.js';
import { READING_MODE, resolveReadingBookmark } from '../../model/reading-session.js';
import { HistoryStartBoundary } from './HistoryStartBoundary.jsx';
import { MessageLayoutScope } from './MessageLayoutState.jsx';
import { useReadingNavigationHost } from './ReadingNavigationOwner.jsx';
import { useBrowsingReadingController } from './useBrowsingReadingController.js';
import { executeReadingDOMCommand } from './reading-dom-command-executor.js';

function traceReadingAdapter(stage, detail = {}) {
  const sink = globalThis.__ATOLL_READING_TRACE__;
  if (!isReadingTraceEnabled() && typeof sink !== 'function') return;
  let resolvedDetail;
  try {
    resolvedDetail = typeof detail === 'function' ? detail() : detail;
  } catch {
    readingTrace('reading.adapter-detail-error', { stage });
    return;
  }
  readingTrace(`reading.${stage}`, resolvedDetail);
  if (typeof sink !== 'function') return;
  try {
    sink({ stage, at: globalThis.performance?.now?.() || Date.now(), ...resolvedDetail });
  } catch {
    readingTrace('reading.test-sink-error', { stage });
  }
}

const READING_TRACE_CONFIG = Object.freeze({
  version: 4,
  library: 'react-virtuoso@4.18.13',
  maintainVisibleContentPosition: null,
  maintainScrollAtEndOwner: 'reading-session-sync-dom',
  estimatedItemSize: 132,
  drawDistance: 900,
  atBottomThreshold: 24,
});

const CommitAwareList = forwardRef(function CommitAwareList({ children, context, ...props }, ref) {
  useLayoutEffect(() => {
    context?.onListCommit?.();
  });
  return <div {...props} ref={ref}>{children}</div>;
});

function WaitingObstructionFooter() {
  return <div className="timeline-waiting-obstruction" aria-hidden="true" />;
}

const VIRTUOSO_COMPONENTS = Object.freeze({
  List: CommitAwareList,
  Footer: WaitingObstructionFooter,
});

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

function textPointAt(node, x, y) {
  const range = document.caretRangeFromPoint?.(x, y);
  if (!range || !node.contains(range.startContainer)) return { offset: 0, top: null };
  const walker = document.createTreeWalker(node, globalThis.NodeFilter?.SHOW_TEXT || 4);
  let offset = 0;
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current === range.startContainer) {
      const rect = range.getBoundingClientRect?.();
      return { offset: offset + range.startOffset, top: Number.isFinite(rect?.top) ? rect.top : null };
    }
    offset += current.textContent?.length || 0;
  }
  return { offset: 0, top: null };
}

function firstVisible(root, selector, viewportTop = root?.getBoundingClientRect?.().top || 0) {
  if (!root) return null;
  return [...root.querySelectorAll(selector)]
    .filter((node) => node.getBoundingClientRect().bottom > viewportTop + 0.5)
    .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)[0] || null;
}

function isAtTail(root) {
  if (!root) return false;
  return Number(root.scrollHeight || 0) - Number(root.clientHeight || 0) - Number(root.scrollTop || 0) <= 1;
}

function completeViewportUnits(root) {
  if (!root) return 1;
  const viewport = root.getBoundingClientRect?.();
  if (!viewport) return 1;
  const complete = [...root.querySelectorAll('[data-presentation-row-id]')]
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.top >= viewport.top - 0.5 && rect.bottom <= viewport.bottom + 0.5;
    }).length;
  return Math.max(1, Math.min(24, complete));
}

function fixedWaitingReserve(root) {
  if (!root || root.nodeType !== 1) return 0;
  return Math.max(0, Number.parseFloat(
    globalThis.getComputedStyle?.(root)?.getPropertyValue('--conversation-waiting-reserve') || '0',
  ) || 0);
}

function isReadingSurfaceVisible(root) {
  if (!root) return false;
  const rect = root.getBoundingClientRect?.();
  const style = globalThis.getComputedStyle?.(root);
  return Boolean(
    rect?.width > 0
    && rect?.height > 0
    && style?.display !== 'none'
    && style?.visibility !== 'hidden',
  );
}

function installedHighSeq(root, rows) {
  if (!root || !rows?.length) return 0;
  const seqByID = new Map(rows.map((row) => [String(row.id), Number(row.seqHigh || 0)]));
  let high = 0;
  for (const node of root.querySelectorAll('[data-presentation-row-id]')) {
    high = Math.max(high, seqByID.get(String(node.dataset.presentationRowId || '')) || 0);
  }
  return high;
}

function presentationRowNode(root, messageID) {
  if (!root || !messageID) return null;
  return [...root.querySelectorAll('[data-presentation-row-id]')]
    .find((node) => String(node.dataset.presentationRowId || '') === String(messageID)) || null;
}

function visibleRowEvidence(root, rows) {
  if (!root || !rows?.length || typeof globalThis.document?.elementFromPoint !== 'function') return [];
  const rootRect = root.getBoundingClientRect?.();
  if (!rootRect || rootRect.width <= 0 || rootRect.height <= 0) return [];
  const reserve = fixedWaitingReserve(root);
  const readableBottom = Math.max(rootRect.top, rootRect.bottom - reserve);
  const rowByID = new Map(rows.map((row) => [String(row.id), row]));
  const visible = [];
  for (const node of root.querySelectorAll('[data-presentation-row-id]')) {
    const messageID = String(node.dataset.presentationRowId || '');
    const row = rowByID.get(messageID);
    if (!row) continue;
    const style = globalThis.getComputedStyle?.(node);
    const hiddenAncestor = node.closest?.('[hidden], [inert], [aria-hidden="true"]');
    const painted = !hiddenAncestor
      && style?.display !== 'none'
      && style?.visibility !== 'hidden'
      && Number.parseFloat(style?.opacity || '1') > 0
      && (typeof node.checkVisibility !== 'function' || node.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
      }));
    if (!painted) continue;
    const rect = node.getBoundingClientRect();
    const left = Math.max(rootRect.left, rect.left);
    const right = Math.min(rootRect.right, rect.right);
    const top = Math.max(rootRect.top, rect.top);
    const bottom = Math.min(readableBottom, rect.bottom);
    if (right - left <= 1 || bottom - top <= 1) continue;
    // The row shell spans the whole virtual track, including empty side
    // gutters. A floating Waiting surface can cover all semantic content while
    // those gutters still hit the row. Only the content-axis center is valid
    // reading evidence; multiple vertical probes retain partial-row support.
    const xs = [(left + right) / 2];
    const ys = [top + 1, (top + bottom) / 2, bottom - 1];
    const ownsVisiblePoint = ys.some((y) => xs.some((x) => {
      const hit = globalThis.document.elementFromPoint(x, y);
      return Boolean(hit && (hit === node || node.contains(hit)));
    }));
    if (!ownsVisiblePoint) continue;
    visible.push(Object.freeze({
      messageID,
      seqHigh: Number(row.seqHigh || 0),
    }));
  }
  return Object.freeze(visible);
}

function visibleBookmark(root, rows, { detailed = false, previous = null } = {}) {
  const viewportTop = root?.getBoundingClientRect?.().top || 0;
  const candidates = root ? [...root.querySelectorAll('[data-presentation-row-id]')] : [];
  const rowNode = candidates
    .filter((node) => node.getBoundingClientRect().bottom > viewportTop + 0.5)
    .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)[0] || null;
  if (!rowNode) return null;
  const rootRect = root.getBoundingClientRect();
  const messageID = rowNode.dataset.presentationRowId;
  const index = rows.findIndex((row) => row.id === messageID);
  const row = rows[index];
  const rowRect = rowNode.getBoundingClientRect();
  const common = {
    ...(previous?.messageID === messageID ? previous : {}),
    messageID,
    rowViewportOffset: rowRect.top - rootRect.top,
    seq: Number(row?.seqLow || 0),
    predecessorID: index > 0 ? rows[index - 1].id : '',
    successorID: index >= 0 && index + 1 < rows.length ? rows[index + 1].id : '',
  };
  // The runtime restore contract consumes the stable row identity and its
  // row-local viewport offset. Text-point discovery walks every text node and
  // forces a Range geometry read, so keep it out of scroll/range/layout
  // observations. A settled gesture, lifecycle exit, or explicit diagnostic
  // sample may still attach the richer evidence without changing restoration.
  if (!detailed) return common;
  const block = firstVisible(rowNode, '[data-reading-block-id]', rootRect.top);
  const anchor = block || rowNode;
  const rect = anchor.getBoundingClientRect();
  const textPoint = block
    ? textPointAt(block, rect.left + 2, Math.max(rect.top, rootRect.top) + 2)
    : { offset: 0, top: null };
  const blockText = block?.textContent || '';
  return {
    ...common,
    blockID: block?.dataset.readingBlockId || '',
    textOffset: textPoint.offset,
    textBefore: blockText.slice(Math.max(0, textPoint.offset - 48), textPoint.offset),
    textAfter: blockText.slice(textPoint.offset, textPoint.offset + 48),
    blockTextStart: blockText.slice(0, 96),
    blockTextEnd: blockText.slice(-96),
    viewportOffset: rect.top - rootRect.top,
    textViewportOffset: textPoint.top == null ? null : textPoint.top - rootRect.top,
  };
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

const MessageRow = memo(function MessageRow({ row, revision, renderRow, presentationState, preserveReplacementGeometry }) {
  const shellRef = useRef(null);
  const visualSlotID = String(row.visualSlotID || row.id);
  // This ref is commit evidence only. An abandoned render may read the last
  // committed shell geometry, but it cannot publish a new slot or height.
  const committedGeometryRef = useRef({ semanticID: String(row.id), visualSlotID, blockSize: 0, heldBlockSize: 0 });
  const committed = committedGeometryRef.current;
  const inheritsCommittedSlot = preserveReplacementGeometry === true
    && committed.visualSlotID === visualSlotID
    && committed.semanticID !== String(row.id);
  const heldBlockSize = preserveReplacementGeometry !== true
    ? 0
    : inheritsCommittedSlot
      ? committed.blockSize
      : committed.semanticID === String(row.id) && committed.visualSlotID === visualSlotID
        ? committed.heldBlockSize
        : 0;
  useLayoutEffect(() => {
    traceReadingAdapter('row-commit', { rowID: row.id, revision });
    committedGeometryRef.current = {
      semanticID: String(row.id),
      visualSlotID,
      blockSize: Number(shellRef.current?.getBoundingClientRect?.().height || 0),
      heldBlockSize,
    };
  }, [heldBlockSize, revision, row.id, visualSlotID]);
  return <MessageLayoutScope rowID={row.id}>
    <div
      ref={shellRef}
      data-presentation-row-id={row.id}
      data-visual-slot-id={visualSlotID}
      data-presentation-state={presentationState || undefined}
      className="presentation-row-shell"
      style={heldBlockSize > 0 ? { minBlockSize: `${heldBlockSize}px` } : undefined}
    >
      <RowErrorBoundary key={row.id} revision={revision}>
        <RowContent row={row} revision={revision} renderRow={renderRow} />
      </RowErrorBoundary>
    </div>
  </MessageLayoutScope>;
}, (left, right) => left.row === right.row
  && left.revision === right.revision
  && left.presentationState === right.presentationState
  && left.preserveReplacementGeometry === right.preserveReplacementGeometry);

function sameNavigationTarget(left, right) {
  return Boolean(
    left
    && right
    && left.ownerToken === right.ownerToken
    && left.activationID === right.activationID
    && Number(left.inputGeneration) === Number(right.inputGeneration)
    && left.transactionID === right.transactionID
    && left.hostToken === right.hostToken
    && Number(left.targetRevision) === Number(right.targetRevision)
    && Number(left.presentationRevision) === Number(right.presentationRevision),
  );
}

function MessageListBody({
  snapshot,
  reading,
  readingController,
  rowRevision,
  rowPresentationState,
  renderRow,
  surfaceVisible = false,
  handoffPending = false,
  navigationTarget = null,
  focusOnMount = false,
  onNavigationRevealReceipt,
  historyStartBoundary = null,
}) {
  const virtuosoRef = useRef(null);
  const scrollerRef = useRef(null);
  const [scrollerNode, setScrollerNode] = useState(null);
  const formalRangeOwner = useMemo(
    () => Object.freeze({ activationID: reading.activationID }),
    [reading.activationID],
  );
  const formalRangeStatesRef = useRef(new WeakMap());
  const [formalRangeRevision, setFormalRangeRevision] = useState(0);
  const readingRef = useRef(reading);
  const snapshotRef = useRef(snapshot);
  const surfaceVisibleRef = useRef(surfaceVisible === true);
  const activationOwnerRef = useRef(null);
  const delayedRestoreRef = useRef(null);
  const handoffPendingRef = useRef(handoffPending === true);
  const handoffTargetRef = useRef(null);
  const revealFrameRef = useRef([0, 0]);
  const paintRevisionRef = useRef(0);
  const deliveredReceiptKeyRef = useRef('');
  const scheduleRevealReceiptRef = useRef(null);
  const focusClaimedRef = useRef(false);
  const materializationAckRef = useRef(null);
  const observationFrameRef = useRef(0);
  const coverageFrameRef = useRef(0);
  const pendingObservationRef = useRef(null);
  const geometryRevisionRef = useRef(0);
  const scheduleObserveRef = useRef(null);
  const listCommitMicrotaskRef = useRef(0);

  const positionDelayedBookmark = useCallback((source) => {
    const pending = delayedRestoreRef.current;
    if (!pending) return false;
    const owner = readingRef.current;
    const current = owner.getSession();
    const data = snapshotRef.current;
    const ack = materializationAckRef.current;
    const handoffTarget = pending.navigationTarget === true ? handoffTargetRef.current : null;
    if (pending.activationID !== current.activationID
      || pending.inputEpoch !== current.inputEpoch
      || (pending.navigationTarget === true && !sameNavigationTarget(pending, handoffTarget))) {
      delayedRestoreRef.current = null;
      traceReadingAdapter('restore-reject', {
        activationID: current.activationID,
        inputEpoch: current.inputEpoch,
        targetID: pending.targetID,
        reason: 'stale-owner',
      });
      return false;
    }
    const committedList = source === 'list-commit';
    if (owner.restorePending === true
      || (!committedList && (
        ack?.activationID !== current.activationID
        || ack?.presentationRevision !== Number(data.revision || 0)
      ))) return false;
    let targetIndex = data.rows.findIndex((row) => row.id === pending.targetID);
    let targetID = pending.targetID;
    let desiredOffset = Number.isFinite(pending.rowViewportOffset)
      ? Number(pending.rowViewportOffset)
      : null;
    if (targetIndex < 0) {
      if (pending.navigationTarget === true) return false;
      const resolved = resolveReadingBookmark(data.rows, current.bookmark);
      if (!resolved) return false;
      targetIndex = resolved.index;
      targetID = resolved.messageID;
      desiredOffset = resolved.rowViewportOffset;
    }
    const root = scrollerRef.current;
    const targetNode = presentationRowNode(root, targetID);
    const targetMaterialized = Boolean(
      targetNode
      && (committedList || (
        ack?.activationID === current.activationID
        && ack?.presentationRevision === Number(data.revision || 0)
      )),
    );
    const actualOffset = targetMaterialized
      ? Number(targetNode.getBoundingClientRect().top || 0)
        - Number(root?.getBoundingClientRect?.().top || 0)
      : null;
    if (pending.navigationTarget === true && pending.phase !== 'issued') {
      const formalState = formalRangeStatesRef.current.get(formalRangeOwner) || null;
      if (formalState?.phase !== 'ready' || root?.querySelector?.('[data-formal-preparing]')) return false;
      // A handoff target is allowed to write only after Virtuoso has replaced
      // its mount placeholder with real scroll geometry. Issuing while the
      // hidden scroller is still clientHeight-tall loses the command when the
      // measured range is installed, which can leave a near-tail key gesture
      // pending forever. An already aligned under-filled list needs no write.
      if (targetMaterialized
        && Number.isFinite(desiredOffset)
        && Number.isFinite(actualOffset)
        && Math.abs(actualOffset - desiredOffset) <= 2) {
        delayedRestoreRef.current = null;
        traceReadingAdapter('restore-complete', {
          activationID: current.activationID,
          inputEpoch: current.inputEpoch,
          snapshotRevision: Number(data.revision || 0),
          targetID: pending.targetID,
          actualOffset,
          desiredOffset,
          source,
        });
        scheduleRevealReceiptRef.current?.('restore-complete');
        return true;
      }
      if (!root || root.clientHeight <= 0 || root.scrollHeight <= root.clientHeight + 1) return false;
    }
    if (pending.phase === 'issued') {
      if (!targetMaterialized) return false;
      if (pending.navigationTarget === true
        && Number.isFinite(desiredOffset)
        && (!Number.isFinite(actualOffset) || Math.abs(actualOffset - desiredOffset) > 2)) {
        traceReadingAdapter('restore-wait', {
          activationID: current.activationID,
          inputEpoch: current.inputEpoch,
          targetID: pending.targetID,
          actualOffset,
          desiredOffset,
          reason: 'handoff-anchor-mismatch',
          source,
        });
        return false;
      }
      delayedRestoreRef.current = null;
      traceReadingAdapter('restore-complete', {
        activationID: current.activationID,
        inputEpoch: current.inputEpoch,
        snapshotRevision: Number(data.revision || 0),
        targetID: pending.targetID,
        actualOffset,
        desiredOffset,
        source,
      });
      if (pending.navigationTarget === true) scheduleRevealReceiptRef.current?.('restore-complete');
      return true;
    }
    const executed = executeReadingDOMCommand(Object.freeze({
      type: 'position-row',
      index: Number(data.firstItemIndex || 0) + targetIndex,
      viewportOffset: desiredOffset,
    }), { virtuoso: virtuosoRef.current, root });
    if (!executed) return false;
    delayedRestoreRef.current = {
      ...pending,
      targetID,
      rowViewportOffset: desiredOffset,
      phase: 'issued',
      issuedRevision: Number(data.revision || 0),
    };
    traceReadingAdapter('restore-position', {
      activationID: current.activationID,
      inputEpoch: current.inputEpoch,
      snapshotRevision: Number(data.revision || 0),
      targetID,
      index: Number(data.firstItemIndex || 0) + targetIndex,
      source,
    });
    return true;
  }, []);

  // Publish lifecycle ownership only after React commits this render. A
  // suspended or otherwise abandoned render must not replace the old
  // activation's rows before its layout-effect cleanup captures a bookmark.
  // On an activation transition React runs the old cleanup first, then this
  // setup replaces the binding with a new object for the committed owner.
  useLayoutEffect(() => {
    readingRef.current = reading;
    snapshotRef.current = snapshot;
    surfaceVisibleRef.current = surfaceVisible === true;
    const current = reading.getSession();
    if (activationOwnerRef.current?.activationID !== reading.activationID) {
      const bookmark = current.bookmark?.messageID ? current.bookmark : null;
      // Browsing restoration is issued only through the typed DOM command once
      // this exact row has materialized. Virtuoso mount estimates are not a
      // second positioning authority.
      delayedRestoreRef.current = bookmark
        ? {
          activationID: reading.activationID,
          inputEpoch: current.inputEpoch,
          targetID: bookmark.messageID,
          rowViewportOffset: Number.isFinite(Number(bookmark.rowViewportOffset))
            ? Number(bookmark.rowViewportOffset)
            : null,
          phase: 'pending',
          issuedRevision: 0,
        }
        : null;
      activationOwnerRef.current = {
        activationID: reading.activationID,
        reading,
        rows: snapshot.rows,
        surfaceVisible: surfaceVisible === true,
        snapshotRevision: Number(snapshot.revision || 0),
        inputEpoch: current.inputEpoch,
      };
      positionDelayedBookmark('activation-materialized');
    } else {
      // Same-activation data commits keep the object captured by the lifecycle
      // cleanup but advance it to that activation's latest committed owner/data.
      activationOwnerRef.current.reading = reading;
      activationOwnerRef.current.rows = snapshot.rows;
      activationOwnerRef.current.surfaceVisible = surfaceVisible === true;
      activationOwnerRef.current.snapshotRevision = Number(snapshot.revision || 0);
      activationOwnerRef.current.inputEpoch = current.inputEpoch;
      positionDelayedBookmark('target-materialized');
    }
    traceReadingAdapter('owner-commit', () => ({
      activationID: reading.activationID,
      inputEpoch: current.inputEpoch,
      snapshotRevision: Number(snapshot.revision || 0),
      rowCount: snapshot.rows.length,
      firstItemIndex: Number(snapshot.firstItemIndex || 0),
      firstRowID: snapshot.rows[0]?.id || '',
      lastRowID: snapshot.rows.at(-1)?.id || '',
      changeKind: snapshot.changes?.kind || '',
      insertedIDs: snapshot.changes?.inserted || [],
      updatedIDs: snapshot.changes?.updated || [],
      removedIDs: snapshot.changes?.removed || [],
      bottomIntentID: current.bottomIntent?.id || '',
      bottomIntentTargets: current.bottomIntent?.targetMessageIDs || [],
      config: READING_TRACE_CONFIG,
      scrollTop: Number(scrollerRef.current?.scrollTop || 0),
      scrollHeight: Number(scrollerRef.current?.scrollHeight || 0),
      clientHeight: Number(scrollerRef.current?.clientHeight || 0),
    }));
  }, [reading, reading.activationID, snapshot, snapshot.rows, surfaceVisible,
    positionDelayedBookmark]);

  useLayoutEffect(() => {
    handoffPendingRef.current = handoffPending === true;
    const current = readingRef.current.getSession();
    const validTarget = Boolean(
      handoffPending
      && navigationTarget?.bookmark?.messageID
      && navigationTarget.activationID === current.activationID
      && Number(navigationTarget.inputGeneration) === Number(current.inputEpoch)
      && navigationTarget.phase !== 'revoked',
    );
    if (!validTarget) {
      handoffTargetRef.current = null;
      deliveredReceiptKeyRef.current = '';
      for (const frame of revealFrameRef.current) {
        if (frame) globalThis.cancelAnimationFrame?.(frame);
      }
      revealFrameRef.current = [0, 0];
      if (delayedRestoreRef.current?.navigationTarget === true) delayedRestoreRef.current = null;
      return;
    }
    const replaced = !sameNavigationTarget(handoffTargetRef.current, navigationTarget);
    handoffTargetRef.current = navigationTarget;
    if (replaced) {
      deliveredReceiptKeyRef.current = '';
      for (const frame of revealFrameRef.current) {
        if (frame) globalThis.cancelAnimationFrame?.(frame);
      }
      revealFrameRef.current = [0, 0];
      delayedRestoreRef.current = {
        ownerToken: navigationTarget.ownerToken,
        activationID: navigationTarget.activationID,
        inputEpoch: navigationTarget.inputGeneration,
        inputGeneration: navigationTarget.inputGeneration,
        transactionID: navigationTarget.transactionID,
        hostToken: navigationTarget.hostToken,
        targetRevision: navigationTarget.targetRevision,
        presentationRevision: navigationTarget.presentationRevision,
        targetID: navigationTarget.bookmark.messageID,
        rowViewportOffset: Number.isFinite(Number(navigationTarget.bookmark.rowViewportOffset))
          ? Number(navigationTarget.bookmark.rowViewportOffset)
          : null,
        navigationTarget: true,
        phase: 'pending',
        issuedRevision: 0,
      };
      positionDelayedBookmark('navigation-target');
    } else if (navigationTarget.phase === 'settled') {
      positionDelayedBookmark('navigation-settled');
      scheduleRevealReceiptRef.current?.('navigation-settled');
    }
  }, [handoffPending, navigationTarget, positionDelayedBookmark]);

  useLayoutEffect(() => {
    if (surfaceVisible !== true) reading.onSurfaceVisibilityChange?.(false);
  }, [reading, reading.activationID, surfaceVisible]);

  const { navigationPolicy, reportDomEvidence } = readingController;

  const observe = useCallback((evidence, observedRoot = scrollerRef.current) => {
    const owner = readingRef.current;
    const session = owner.getSession();
    const bookmark = visibleBookmark(observedRoot, snapshotRef.current.rows, {
      // Causal authority and sampling phase are independent. A gesture can
      // keep its current `user` authority while scrollend asks for the one
      // detailed text-point sample for that gesture.
      detailed: evidence?.settled === true || evidence?.source === 'settled' || isReadingTraceEnabled(),
      previous: session.bookmark,
    });
    const installedHigh = installedHighSeq(observedRoot, snapshotRef.current.rows);
    const visibleRows = visibleRowEvidence(observedRoot, snapshotRef.current.rows);
    traceReadingAdapter('observation', () => ({
      activationID: evidence?.activationID || session.activationID,
      inputEpoch: evidence?.inputEpoch ?? session.inputEpoch,
      geometryRevision: evidence?.geometryRevision ?? geometryRevisionRef.current,
      source: evidence?.source || 'layout',
      settled: evidence?.settled === true,
      atTail: evidence?.atTail ?? isAtTail(observedRoot),
      installedHighSeq: installedHigh,
      visibleRowIDs: visibleRows.map((row) => row.messageID),
      anchorID: bookmark?.messageID || '',
      anchorViewportY: bookmark?.rowViewportOffset ?? null,
      scrollTop: Number(observedRoot?.scrollTop || 0),
      scrollHeight: Number(observedRoot?.scrollHeight || 0),
      clientHeight: Number(observedRoot?.clientHeight || 0),
    }));
    reportDomEvidence(Object.freeze({
      type: 'reading-observation',
      bookmark,
      atTail: evidence?.atTail ?? isAtTail(observedRoot),
      surfaceVisible: surfaceVisibleRef.current === true && isReadingSurfaceVisible(observedRoot),
      installedHighSeq: installedHigh,
      visibleRows,
      source: evidence?.source || 'layout',
      settled: evidence?.settled === true,
      inputEpoch: evidence?.inputEpoch ?? session.inputEpoch,
      geometryRevision: evidence?.geometryRevision ?? geometryRevisionRef.current,
      activationID: evidence?.activationID || session.activationID,
    }));
  }, [reportDomEvidence]);

  const scheduleObserve = useCallback((source = 'layout') => {
    const owner = readingRef.current;
    const session = owner.getSession();
    const input = navigationPolicy.currentInput();
    // Preserve the evidence at the event boundary. The latest event in a frame
    // wins, so a later layout invalidation cannot inherit an earlier scroll's
    // `user` source, and a real gesture after layout gets fresh evidence.
    const evidence = {
      source,
      settled: source === 'settled',
      atTail: isAtTail(scrollerRef.current),
      inputEpoch: input.active ? input.inputEpoch : session.inputEpoch,
      geometryRevision: geometryRevisionRef.current,
      activationID: session.activationID,
    };
    const pending = pendingObservationRef.current;
    // rangeChanged/atBottomStateChange can follow the real scroll callback in
    // the same frame without changing geometry. They must not erase captured
    // user evidence. A resize/measurement revision is different: its layout
    // evidence replaces the user sample and therefore cannot grant following.
    const sameUserGeometry = source === 'layout'
      && pending?.source === 'user'
      && pending.geometryRevision === evidence.geometryRevision
      && pending.activationID === evidence.activationID;
    if (!sameUserGeometry) pendingObservationRef.current = evidence;
    if (observationFrameRef.current) return;
    observationFrameRef.current = requestAnimationFrame(() => {
      observationFrameRef.current = 0;
      const evidence = pendingObservationRef.current;
      pendingObservationRef.current = null;
      observe(evidence);
    });
  }, [navigationPolicy, observe]);
  scheduleObserveRef.current = scheduleObserve;

  const scheduleCoverageCheck = useCallback(() => {
    if (coverageFrameRef.current) return;
    coverageFrameRef.current = requestAnimationFrame(() => {
      coverageFrameRef.current = 0;
      const root = scrollerRef.current;
      const rows = snapshotRef.current.rows;
      const owner = readingRef.current;
      const session = owner.getSession();
      if (!root || !rows.length || root.clientHeight <= 0) return;
      const materialized = [...root.querySelectorAll('[data-presentation-row-id]')];
      reportDomEvidence(Object.freeze({
        type: 'viewport-coverage',
        activationID: session.activationID,
        presentationRevision: Number(snapshotRef.current.revision || 0),
        hasBothBoundaries: materialized.some((node) => node.dataset.presentationRowId === rows[0].id)
          && materialized.some((node) => node.dataset.presentationRowId === rows.at(-1).id),
        underfilled: Number(root.scrollHeight || 0) <= Number(root.clientHeight || 0) + 1,
        clientHeight: Number(root.clientHeight || 0),
        scrollHeight: Number(root.scrollHeight || 0),
        demandUnits: completeViewportUnits(root),
        onWake: scheduleCoverageCheck,
      }));
    });
  }, [reportDomEvidence]);

  const finishNavigationObservation = useCallback((transaction) => {
    const root = scrollerRef.current;
    const owner = readingRef.current;
    if (!root || !owner) return;
    const current = owner.getSession();
    const input = navigationPolicy.currentInput();
    reportDomEvidence(Object.freeze({
      type: 'scroll-position',
      activationID: transaction.activationID,
      inputEpoch: transaction.inputGeneration,
      direction: input.direction === 'browse' ? 'older' : input.direction,
      atTop: Number(root.scrollTop || 0) <= 1,
      scrollTop: Number(root.scrollTop || 0),
      clientHeight: Number(root.clientHeight || 0),
      demandUnits: completeViewportUnits(root),
    }));
    const pending = pendingObservationRef.current;
    const settlesCurrentUser = Boolean(
      input.active
      && input.activationID === current.activationID
      && input.inputEpoch === current.inputEpoch
      && input.inputEpoch === transaction.inputGeneration
      && pending?.source === 'user'
      && pending.activationID === current.activationID
      && pending.inputEpoch === current.inputEpoch
      && pending.geometryRevision === geometryRevisionRef.current
    );
    const accepted = navigationPolicy.onNavigationEnd(transaction);
    if (settlesCurrentUser && accepted) {
      pendingObservationRef.current = { ...pending, atTail: isAtTail(root), settled: true };
    } else {
      if (pendingObservationRef.current?.source === 'user') pendingObservationRef.current = null;
      scheduleObserve('settled');
    }
  }, [navigationPolicy, reportDomEvidence, scheduleObserve]);

  const navigationHost = useMemo(() => ({
    readBookmark: () => visibleBookmark(scrollerRef.current, snapshotRef.current.rows),
    geometryRevision: () => geometryRevisionRef.current,
    atTail: () => isAtTail(scrollerRef.current),
    canFollowTail: true,
    canRequestHistory: true,
    onNavigationUpdate(transaction, reason) {
      if (reason === 'begin') delayedRestoreRef.current = null;
      navigationPolicy.onNavigationUpdate(transaction, reason);
      const root = scrollerRef.current;
      reportDomEvidence(Object.freeze({
        type: 'scroll-position',
        activationID: transaction.activationID,
        inputEpoch: transaction.inputGeneration,
        direction: transaction.direction,
        atTop: Number(root?.scrollTop || 0) <= 1,
        scrollTop: Number(root?.scrollTop || 0),
        clientHeight: Number(root?.clientHeight || 0),
        demandUnits: completeViewportUnits(root),
      }));
    },
    onNavigationEnd: finishNavigationObservation,
    onNavigationCancel() {
      navigationPolicy.onNavigationCancel();
      // A cancelled contact cannot lend its already-coalesced user sample to
      // a later rAF. Drop that evidence before publishing observation-only
      // layout state; ReadingSession cancellation clears matching tailEvidence.
      if (pendingObservationRef.current?.source === 'user') pendingObservationRef.current = null;
      scheduleObserve('layout');
    },
  }), [finishNavigationObservation, navigationPolicy, reportDomEvidence, scheduleObserve]);
  useReadingNavigationHost('browsing', navigationHost, scrollerNode);

  useLayoutEffect(() => {
    const root = scrollerRef.current;
    if (!root) return undefined;
    let previousTop = Number(root.scrollTop || 0);
    const onScroll = () => {
      const nextTop = Number(root.scrollTop || 0);
      const direction = nextTop > previousTop ? 'newer' : nextTop < previousTop ? 'older' : '';
      const priorTop = previousTop;
      previousTop = nextTop;
      const owner = readingRef.current;
      const input = navigationPolicy.currentInput();
      const current = owner.getSession();
      traceReadingAdapter('scroll-observed', () => ({
        activationID: current.activationID,
        inputEpoch: current.inputEpoch,
        mode: current.mode,
        inputActive: input.active,
        inputDirection: input.direction,
        previousScrollTop: priorTop,
        scrollTop: nextTop,
        scrollDelta: nextTop - priorTop,
        scrollHeight: Number(root.scrollHeight || 0),
        clientHeight: Number(root.clientHeight || 0),
      }));
      const userOwned = Boolean(direction && input.active
        && input.activationID === current.activationID
        && input.inputEpoch === current.inputEpoch
        && (input.direction === direction || input.direction === 'browse'));
      reportDomEvidence(Object.freeze({
        type: 'scroll-position',
        activationID: current.activationID,
        inputEpoch: current.inputEpoch,
        direction,
        atTop: nextTop <= 1,
        scrollTop: nextTop,
        clientHeight: Number(root.clientHeight || 0),
        demandUnits: completeViewportUnits(root),
      }));
      scheduleObserve(userOwned ? 'user' : 'layout');
    };
    const onGeometryScrollEnd = () => {
      if (!navigationPolicy.currentInput().active && pendingObservationRef.current?.source !== 'user') {
        scheduleObserve('settled');
      }
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('scrollend', onGeometryScrollEnd, { passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll);
      root.removeEventListener('scrollend', onGeometryScrollEnd);
    };
  }, [navigationPolicy, reportDomEvidence, scheduleObserve, scrollerNode]);

  useLayoutEffect(() => {
    if (!scrollerNode) return;
    geometryRevisionRef.current += 1;
    scheduleObserve('layout');
    scheduleCoverageCheck();
  }, [scheduleCoverageCheck, scheduleObserve, scrollerNode, snapshot.revision]);

  useLayoutEffect(() => {
    const root = scrollerRef.current;
    if (!root || typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(() => {
      traceReadingAdapter('scroller-resize', () => ({
        scrollTop: Number(root.scrollTop || 0),
        scrollHeight: Number(root.scrollHeight || 0),
        clientHeight: Number(root.clientHeight || 0),
      }));
      geometryRevisionRef.current += 1;
      scheduleObserve('layout');
      scheduleCoverageCheck();
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [scheduleCoverageCheck, scheduleObserve, scrollerNode]);

  useLayoutEffect(() => () => {
    if (observationFrameRef.current) cancelAnimationFrame(observationFrameRef.current);
    if (coverageFrameRef.current) cancelAnimationFrame(coverageFrameRef.current);
    listCommitMicrotaskRef.current += 1;
  }, []);

  useLayoutEffect(() => {
    const binding = activationOwnerRef.current;
    const node = scrollerNode;
    return () => {
    // React runs layout-effect teardown while the old host geometry is still
    // readable. Every activation exit (channel, route, scope/filter, access)
    // therefore has one lifecycle path; it records a semantic bookmark and
    // never writes scrollTop or schedules a later correction.
      // React may clear the callback ref or detach the host during the same
      // commit. The captured node still owns the old activation's readable
      // subtree/geometry, so connectivity is not an ownership predicate.
      if (!node || !binding) return;
      const owner = binding.reading;
      const session = owner.getSession();
      reportDomEvidence(Object.freeze({
        type: 'reading-observation',
        bookmark: visibleBookmark(node, binding.rows, {
          detailed: true,
          previous: session.bookmark,
        }),
        atTail: isAtTail(node),
        surfaceVisible: binding.surfaceVisible === true && isReadingSurfaceVisible(node),
        installedHighSeq: installedHighSeq(node, binding.rows),
        source: 'lifecycle',
        inputEpoch: session.inputEpoch,
        geometryRevision: session.geometryRevision,
        activationID: binding.activationID,
      }));
    };
  }, [reading.activationID, reportDomEvidence, scrollerNode]);

  const bindScroller = useCallback((node) => {
    const candidate = node?.getScrollableNode?.() || node;
    const next = candidate && candidate.nodeType === 1 ? candidate : null;
    scrollerRef.current = next;
    setScrollerNode((current) => current === next ? current : next);
    if (next && !next.hasAttribute('tabindex')) next.tabIndex = 0;
  }, []);

  useLayoutEffect(() => {
    const root = scrollerRef.current;
    if (!root || handoffPending || !focusOnMount || focusClaimedRef.current) return;
    focusClaimedRef.current = true;
    executeReadingDOMCommand(Object.freeze({ type: 'claim-focus' }), {
      virtuoso: virtuosoRef.current,
      root,
    });
  }, [focusOnMount, handoffPending]);

  const scheduleNavigationRevealReceipt = useCallback((source) => {
    if (!handoffPendingRef.current || revealFrameRef.current.some(Boolean)) return false;
    const buildReceipt = () => {
      const targetAuthority = handoffTargetRef.current;
      const reject = (reason, detail = {}) => {
        traceReadingAdapter('navigation-receipt-reject', {
          reason,
          targetID: targetAuthority?.bookmark?.messageID || '',
          targetRevision: targetAuthority?.targetRevision || 0,
          ...detail,
        });
        return null;
      };
      if (!targetAuthority || targetAuthority.phase !== 'settled') return reject('input-active');
      const owner = readingRef.current;
      const current = owner?.getSession();
      if (targetAuthority.activationID !== current?.activationID
        || Number(targetAuthority.inputGeneration) !== Number(current?.inputEpoch)) {
        return reject('owner-mismatch', { inputEpoch: current?.inputEpoch || 0 });
      }
      const data = snapshotRef.current;
      const ack = materializationAckRef.current;
      if (!ack
        || ack.activationID !== current.activationID
        || ack.presentationRevision !== Number(data.revision || 0)
        || Number(ack.presentationRevision) < Number(targetAuthority.presentationRevision)) {
        return reject('materialization-revision', {
          ackRevision: ack?.presentationRevision || 0,
          snapshotRevision: Number(data.revision || 0),
        });
      }
      const targetID = targetAuthority.bookmark?.messageID || '';
      const targetIndex = data.rows.findIndex((row) => row.id === targetID);
      const absoluteTargetIndex = Number(data.firstItemIndex || 0) + targetIndex;
      if (targetIndex < 0
        || absoluteTargetIndex < Number(ack.startIndex)
        || absoluteTargetIndex > Number(ack.endIndex)) {
        return reject('installed-range', {
          targetIndex: absoluteTargetIndex,
          startIndex: Number(ack.startIndex),
          endIndex: Number(ack.endIndex),
        });
      }
      const root = scrollerRef.current;
      const target = presentationRowNode(root, targetID);
      if (!root || !root.isConnected || root.clientHeight <= 0 || root.scrollHeight <= 0 || !target) {
        return reject('target-geometry', {
          connected: root?.isConnected === true,
          clientHeight: Number(root?.clientHeight || 0),
          scrollHeight: Number(root?.scrollHeight || 0),
          targetMaterialized: Boolean(target),
        });
      }
      const targetItem = target.closest?.('[data-known-size]');
      const formalState = formalRangeStatesRef.current.get(formalRangeOwner) || null;
      if (formalState?.phase !== 'ready'
        || Number(targetItem?.dataset?.knownSize || 0) <= 0
        || root.querySelector('[data-formal-preparing]')
        || delayedRestoreRef.current) {
        return reject('formal-or-restore', {
          formalPhase: formalState?.phase || '',
          knownSize: Number(targetItem?.dataset?.knownSize || 0),
          formalPreparing: Boolean(root.querySelector('[data-formal-preparing]')),
          restorePending: Boolean(delayedRestoreRef.current),
        });
      }
      const rootRect = root.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const actualOffset = targetRect.top - rootRect.top;
      const rawDesiredOffset = targetAuthority.bookmark?.rowViewportOffset;
      const desiredOffset = rawDesiredOffset == null ? null : Number(rawDesiredOffset);
      if (Number.isFinite(desiredOffset) && Math.abs(actualOffset - desiredOffset) > 2) {
        return reject('anchor-mismatch', { actualOffset, desiredOffset });
      }
      const block = firstVisible(target, '[data-reading-block-id]', rootRect.top);
      return {
        ownerToken: targetAuthority.ownerToken,
        activationID: targetAuthority.activationID,
        inputGeneration: targetAuthority.inputGeneration,
        transactionID: targetAuthority.transactionID,
        hostToken: targetAuthority.hostToken,
        targetRevision: targetAuthority.targetRevision,
        presentationRevision: targetAuthority.presentationRevision,
        materializedPresentationRevision: Number(data.revision || 0),
        targetID,
        targetBlockID: block?.dataset?.readingBlockId || '',
        targetViewportOffset: actualOffset,
        desiredViewportOffset: Number.isFinite(desiredOffset) ? desiredOffset : null,
        installedRange: Object.freeze({
          startIndex: Number(ack.startIndex),
          endIndex: Number(ack.endIndex),
        }),
        geometryRevision: geometryRevisionRef.current,
        formalGeneration: Number(formalState.generation || 0),
        materialized: true,
        source,
      };
    };
    const candidate = buildReceipt();
    if (!candidate) return false;
    const key = [candidate.activationID, candidate.inputGeneration, candidate.transactionID,
      candidate.targetRevision, candidate.materializedPresentationRevision,
      candidate.geometryRevision, candidate.targetViewportOffset].join(':');
    if (deliveredReceiptKeyRef.current === key) return true;
    revealFrameRef.current[0] = globalThis.requestAnimationFrame?.(() => {
      revealFrameRef.current[0] = 0;
      if (!buildReceipt()) return;
      revealFrameRef.current[1] = globalThis.requestAnimationFrame?.(() => {
        revealFrameRef.current[1] = 0;
        const receipt = buildReceipt();
        if (!receipt) return;
        const currentKey = [receipt.activationID, receipt.inputGeneration, receipt.transactionID,
          receipt.targetRevision, receipt.materializedPresentationRevision,
          receipt.geometryRevision, receipt.targetViewportOffset].join(':');
        if (currentKey !== key || deliveredReceiptKeyRef.current === currentKey) return;
        deliveredReceiptKeyRef.current = currentKey;
        onNavigationRevealReceipt?.(Object.freeze({
          ...receipt,
          paintRevision: ++paintRevisionRef.current,
        }));
      }) || 0;
    }) || 0;
    return true;
  }, [formalRangeOwner, onNavigationRevealReceipt]);
  useLayoutEffect(() => {
    scheduleRevealReceiptRef.current = scheduleNavigationRevealReceipt;
    return () => {
      if (scheduleRevealReceiptRef.current === scheduleNavigationRevealReceipt) {
        scheduleRevealReceiptRef.current = null;
      }
    };
  }, [scheduleNavigationRevealReceipt]);

  useLayoutEffect(() => () => {
    for (const frame of revealFrameRef.current) {
      if (frame) globalThis.cancelAnimationFrame?.(frame);
    }
    revealFrameRef.current = [0, 0];
  }, []);

  /*
   * A navigation receipt is intentionally separate from transaction settle:
   * settle ends input attribution; only the exact committed materialization,
   * formal geometry and a paint opportunity may admit the incoming layer.
   */
  useLayoutEffect(() => {
    positionDelayedBookmark('formal-range');
    scheduleNavigationRevealReceipt('formal-range');
  }, [formalRangeRevision, positionDelayedBookmark, scheduleNavigationRevealReceipt]);

  const firstItemIndex = Number(snapshot.firstItemIndex || 0);
  const frontierRowID = snapshot.rows[0]?.id || '';
  const roleActivationID = String(reading.activationID || '');
  const [historyBoundaryRole, setHistoryBoundaryRole] = useState(() => ({
    activationID: roleActivationID,
    ownerID: frontierRowID,
  }));
  const roleBelongsToActivation = historyBoundaryRole.activationID === roleActivationID;
  const retainedRoleOwnerID = roleBelongsToActivation ? historyBoundaryRole.ownerID : '';
  const retainedRoleOwnerOffset = retainedRoleOwnerID
    ? snapshot.rows.findIndex((row) => row.id === retainedRoleOwnerID)
    : -1;
  const retainedRoleOwnerPresent = retainedRoleOwnerOffset >= 0;
  // Structural transitions never let the reserved geometry follow a moving
  // open frontier. An empty list owns no slot. The first materialized row, an
  // activation replacement, or removal of the retained row derives exactly
  // one new owner for this commit; the layout effect below latches that owner
  // before paint. Ordinary prepends leave a present retained owner untouched.
  const needsStructuralRoleOwner = Boolean(
    frontierRowID
    && (!roleBelongsToActivation || !retainedRoleOwnerID || !retainedRoleOwnerPresent),
  );
  const effectiveRoleOwnerID = frontierRowID
    ? (needsStructuralRoleOwner ? frontierRowID : retainedRoleOwnerID)
    : '';
  const effectiveRoleOwnerOffset = effectiveRoleOwnerID
    ? snapshot.rows.findIndex((row) => row.id === effectiveRoleOwnerID)
    : -1;
  const effectiveRoleOwnerIndex = effectiveRoleOwnerOffset >= 0
    ? firstItemIndex + effectiveRoleOwnerOffset
    : -1;
  useLayoutEffect(() => {
    if (!needsStructuralRoleOwner) return;
    setHistoryBoundaryRole((current) => (
      current.activationID === roleActivationID && current.ownerID === frontierRowID
        ? current
        : { activationID: roleActivationID, ownerID: frontierRowID }
    ));
  }, [frontierRowID, needsStructuralRoleOwner, roleActivationID]);
  useEffect(() => {
    // Open-frontier prepends retain one measured 35px owner. Exhaustion is the
    // only transfer: the final prepend commits first, then this ordinary commit
    // moves equal geometry to the authoritative oldest row and reveals text.
    if (!frontierRowID || !historyStartBoundary) return;
    setHistoryBoundaryRole((current) => (
      current.activationID === roleActivationID && current.ownerID === frontierRowID
        ? current
        : { activationID: roleActivationID, ownerID: frontierRowID }
    ));
  }, [frontierRowID, historyStartBoundary, roleActivationID]);
  const itemMeasurementKey = useCallback((index, row) => {
    const revision = rowRevision?.(index, row) || String(row.contentRevision);
    return row.id === effectiveRoleOwnerID
      ? `${revision}:history-start-role:${roleActivationID}:${effectiveRoleOwnerID}`
      : revision;
  }, [effectiveRoleOwnerID, roleActivationID, rowRevision]);
  const itemContent = useCallback((index, row) => row ? (
    <>
      {Number(index) === effectiveRoleOwnerIndex && <HistoryStartBoundary
        boundary={historyStartBoundary && effectiveRoleOwnerID === frontierRowID
          ? historyStartBoundary
          : null}
      />}
      <MessageRow
        row={row}
        revision={itemMeasurementKey(index, row)}
        renderRow={renderRow}
        presentationState={rowPresentationState?.(row) || ''}
        preserveReplacementGeometry={reading.session.mode === READING_MODE.browsing}
      />
    </>
  ) : null, [
    effectiveRoleOwnerID,
    effectiveRoleOwnerIndex,
    frontierRowID,
    historyStartBoundary,
    itemMeasurementKey,
    reading.session.mode,
    renderRow,
    rowPresentationState,
  ]);
  const keyExtractor = useCallback((_index, row) => row.visualSlotID || row.id, []);
  const onFormalRangeStateChange = useCallback((state) => {
    const previous = formalRangeStatesRef.current.get(formalRangeOwner);
    if (previous?.generation === state.generation
      && previous.phase === state.phase
      && previous.reason === state.reason
      && previous.blocking === state.blocking) return;
    formalRangeStatesRef.current.set(formalRangeOwner, state);
    setFormalRangeRevision((revision) => revision + 1);
  }, [formalRangeOwner]);
  const acknowledgeCommittedRange = useCallback(() => {
    const root = scrollerRef.current;
    const owner = readingRef.current;
    const current = owner?.getSession();
    const data = snapshotRef.current;
    if (!root || !current || !data.rows.length) return null;
    const indexByID = new Map(data.rows.map((row, index) => [String(row.id), index]));
    const installed = [...root.querySelectorAll('[data-presentation-row-id]')]
      .map((node) => indexByID.get(String(node.dataset.presentationRowId || '')))
      .filter(Number.isInteger)
      .map((index) => Number(data.firstItemIndex || 0) + index);
    if (!installed.length) return null;
    const ack = {
      activationID: current.activationID,
      presentationRevision: Number(data.revision || 0),
      startIndex: Math.min(...installed),
      endIndex: Math.max(...installed),
      source: 'list-commit',
    };
    materializationAckRef.current = ack;
    return ack;
  }, []);
  const onListCommit = useCallback(() => {
    const token = ++listCommitMicrotaskRef.current;
    queueMicrotask(() => {
      if (listCommitMicrotaskRef.current !== token) return;
      // Formal preparation and promotion can replace inert measurement rows
      // without changing the public data revision or scroll geometry. The
      // committed List is the authority that a new paintable subtree exists;
      // sample it on the normal rAF path so a short, non-scrollable list still
      // publishes exact visible identities after promotion.
      acknowledgeCommittedRange();
      scheduleObserve('layout');
      positionDelayedBookmark('list-commit');
      scheduleNavigationRevealReceipt('list-commit');
    });
  }, [acknowledgeCommittedRange, positionDelayedBookmark,
    scheduleNavigationRevealReceipt, scheduleObserve]);
  const listContext = useMemo(() => ({
    onListCommit,
  }), [onListCommit]);
  if (reading.restorePending && !snapshot.rows.length) {
    return <div className="timeline-message-list timeline-reading-restore" role="status">正在恢复上次阅读位置…</div>;
  }
  if (!snapshot.rows.length) {
    return <div className="timeline-message-list" data-empty="true" role="region" aria-label="频道动态" />;
  }
  const formalRangeState = formalRangeStatesRef.current.get(formalRangeOwner) || null;
  const formalRangePending = surfaceVisible === true
    && formalRangeState?.phase === 'pending'
    && formalRangeState.blocking === true;
  const formalRangeFailed = surfaceVisible === true
    && formalRangeState?.phase === 'failed';

  return <>
    {formalRangePending && <div
      className="timeline-history-status"
      data-generation={formalRangeState.generation}
      data-reason={formalRangeState.reason || ''}
      role="status"
    >正在准备频道内容…</div>}
    {formalRangeFailed && <div
      className="timeline-history-error"
      data-generation={formalRangeState.generation}
      data-reason={formalRangeState.reason || ''}
      role="alert"
    >频道内容准备失败</div>}
    <Virtuoso
    ref={virtuosoRef}
    className="timeline-message-list"
    role="region"
    aria-label="频道动态"
    data={snapshot.rows}
    firstItemIndex={firstItemIndex}
    computeItemKey={keyExtractor}
    computeItemMeasurementKey={itemMeasurementKey}
    formalRangeStateChange={onFormalRangeStateChange}
    itemContent={itemContent}
    followOutput={false}
    defaultItemHeight={132}
    increaseViewportBy={900}
    overscan={900}
    scrollerRef={bindScroller}
    components={VIRTUOSO_COMPONENTS}
    context={listContext}
    rangeChanged={(info) => {
      materializationAckRef.current = {
        activationID: reading.activationID,
        presentationRevision: Number(snapshot.revision || 0),
        startIndex: Number(info?.startIndex ?? -1),
        endIndex: Number(info?.endIndex ?? -1),
      };
      traceReadingAdapter('range', () => ({
        startIndex: Number(info?.startIndex ?? -1),
        endIndex: Number(info?.endIndex ?? -1),
        scrollTop: Number(scrollerRef.current?.scrollTop || 0),
        scrollHeight: Number(scrollerRef.current?.scrollHeight || 0),
        clientHeight: Number(scrollerRef.current?.clientHeight || 0),
      }));
      scheduleObserve('layout');
      scheduleCoverageCheck();
      if (Number(info?.endIndex ?? -1) >= Number(info?.startIndex ?? 0)) {
        reportDomEvidence(Object.freeze({
          type: 'materialized-range',
          activationID: reading.activationID,
          presentationRevision: Number(snapshot.revision || 0),
          startIndex: Number(info.startIndex),
          endIndex: Number(info.endIndex),
        }));
        positionDelayedBookmark('range-materialized');
        scheduleNavigationRevealReceipt('range-materialized');
      }
    }}
    atBottomStateChange={(atBottom) => {
      traceReadingAdapter('at-bottom', () => ({
        atBottom: atBottom === true,
        scrollTop: Number(scrollerRef.current?.scrollTop || 0),
        scrollHeight: Number(scrollerRef.current?.scrollHeight || 0),
        clientHeight: Number(scrollerRef.current?.clientHeight || 0),
      }));
      scheduleObserve('layout');
    }}
    totalListHeightChanged={(height) => {
      const committedHeight = Number(height || 0);
      traceReadingAdapter('list-height', () => ({
        height: committedHeight,
        scrollTop: Number(scrollerRef.current?.scrollTop || 0),
        scrollHeight: Number(scrollerRef.current?.scrollHeight || 0),
        clientHeight: Number(scrollerRef.current?.clientHeight || 0),
      }));
      geometryRevisionRef.current += 1;
      scheduleObserve('layout');
      scheduleCoverageCheck();
    }}
    />
  </>;
}

function ControlledMessageList(props) {
  const readingController = useBrowsingReadingController({
    reading: props.reading,
    snapshot: props.snapshot,
    handoffPending: props.handoffPending,
  });
  return <MessageListBody {...props} readingController={readingController} />;
}

export function MessageList(props) {
  return <ControlledMessageList {...props} />;
}
