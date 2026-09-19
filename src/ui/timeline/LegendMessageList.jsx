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
import { READING_MODE } from '../../model/reading-session.js';
import { HistoryStartBoundary } from './HistoryStartBoundary.jsx';
import { MessageLayoutScope } from './MessageLayoutState.jsx';
import {
  ReadingNavigationOwner,
  useReadingNavigationHost,
  useReadingNavigationOwner,
} from './ReadingNavigationOwner.jsx';
import { useBrowsingReadingController } from './useBrowsingReadingController.js';
import { executeReadingDOMCommand } from './reading-dom-command-executor.js';
import {
  commitFollowingPresentation,
  decideFollowingScroll,
  invalidateFollowingSend,
  resetFollowingScroll,
} from './following-scroll-controller.js';

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

function initialLocation(rows, session) {
  if (session.mode === 'following' || !session.bookmark) return { atEnd: true };
  const bookmark = session.bookmark;
  let index = rows.findIndex((row) => row.id === bookmark.messageID);
  const exactTargetSurvives = index >= 0;
  if (index < 0 && bookmark.successorID) index = rows.findIndex((row) => row.id === bookmark.successorID);
  if (index < 0 && bookmark.predecessorID) index = rows.findIndex((row) => row.id === bookmark.predecessorID);
  if (index < 0 && bookmark.seq) {
    let distance = Number.POSITIVE_INFINITY;
    rows.forEach((row, candidate) => {
      const nextDistance = Math.abs(Number(row.seqLow || 0) - bookmark.seq);
      if (nextDistance < distance) {
        distance = nextDistance;
        index = candidate;
      }
    });
  }
  if (index < 0) index = 0;
  const rowOffset = Number(bookmark.rowViewportOffset);
  return {
    index,
    viewPosition: 0,
    // A row-local offset only describes the row it was measured from. If that
    // row was deleted, reusing (for example) a long-message -600px offset on
    // its successor can skip the fallback entirely. Deleted anchors therefore
    // resume at the explicit visible start of the selected semantic neighbour.
    // Virtuoso's offset is added to the scroll target. A row whose top was
    // 24px above the viewport therefore restores with +24, not -24.
    ...(exactTargetSurvives && Number.isFinite(rowOffset) ? { viewOffset: -rowOffset } : {}),
  };
}

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
  bottomIntentPresentation = null,
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
  const bottomIntentPresentationRef = useRef(bottomIntentPresentation);
  const surfaceVisibleRef = useRef(surfaceVisible === true);
  const activationOwnerRef = useRef(null);
  const initialLocationRef = useRef({ activationID: '', value: null });
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
  const followAuthorizationRef = useRef({
    activationID: reading.activationID,
    authorized: reading.session.mode === READING_MODE.following
      && reading.initializing !== true
      && reading.bottomReady !== false,
  });
  const followRevisionAuthorizationRef = useRef(null);
  const viewportAuthorizationRef = useRef(null);
  const layoutHeightAuthorizationRef = useRef(null);
  const roleAuthorizationRef = useRef(null);
  const lastListHeightRef = useRef(0);
  const viewportSizeRef = useRef(null);
  const intentGeometryRef = useRef(null);
  const sendScrollTransactionRef = useRef(null);
  const sendOwnedRevisionRef = useRef(null);
  const itemLayoutAckRef = useRef(null);
  const scheduleObserveRef = useRef(null);
  const listCommitMicrotaskRef = useRef(0);
  const itemLayoutIssueMicrotaskRef = useRef(0);
  const followingControl = useMemo(() => Object.freeze({
    followAuthorization: followAuthorizationRef,
    followRevision: followRevisionAuthorizationRef,
    viewport: viewportAuthorizationRef,
    layoutHeight: layoutHeightAuthorizationRef,
    role: roleAuthorizationRef,
    lastListHeight: lastListHeightRef,
    viewportSize: viewportSizeRef,
    intentGeometry: intentGeometryRef,
    sendTransaction: sendScrollTransactionRef,
    sendOwnedRevision: sendOwnedRevisionRef,
    itemLayout: itemLayoutAckRef,
  }), []);

  const positionDelayedBookmark = useCallback((source) => {
    const pending = delayedRestoreRef.current;
    if (!pending) return false;
    const owner = readingRef.current;
    const current = owner.getSession?.() || owner.session;
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
    const targetIndex = data.rows.findIndex((row) => row.id === pending.targetID);
    if (targetIndex < 0) return false;
    const root = scrollerRef.current;
    const targetNode = presentationRowNode(root, pending.targetID);
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
    const desiredOffset = Number.isFinite(pending.rowViewportOffset)
      ? Number(pending.rowViewportOffset)
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
      index: targetIndex,
      viewportOffset: desiredOffset,
    }), { virtuoso: virtuosoRef.current, root });
    if (!executed) return false;
    delayedRestoreRef.current = {
      ...pending,
      phase: 'issued',
      issuedRevision: Number(data.revision || 0),
    };
    traceReadingAdapter('restore-position', {
      activationID: current.activationID,
      inputEpoch: current.inputEpoch,
      snapshotRevision: Number(data.revision || 0),
      targetID: pending.targetID,
      index: targetIndex,
      source,
    });
    return true;
  }, []);

  const issueBottomIfCurrent = useCallback((source = 'layout') => {
    const root = scrollerRef.current;
    const geometry = Object.freeze({
      canScroll: typeof root?.scrollTo === 'function',
      scrollTop: Number(root?.scrollTop || 0),
      scrollHeight: Number(root?.scrollHeight || 0),
      clientHeight: Number(root?.clientHeight || 0),
      offsetHeight: Number(root?.offsetHeight || 0),
    });
    const decision = decideFollowingScroll({
      source,
      binding: activationOwnerRef.current,
      presentation: bottomIntentPresentationRef.current,
      geometry,
      control: followingControl,
      trace: (stage, detail) => traceReadingAdapter(stage, detail),
    });
    if (!decision) return false;
    if (decision.command) {
      executeReadingDOMCommand(decision.command, { virtuoso: virtuosoRef.current, root });
    }
    if (decision.observe) scheduleObserveRef.current?.('layout');
    return true;
  }, [followingControl]);

  // Publish lifecycle ownership only after React commits this render. A
  // suspended or otherwise abandoned render must not replace the old
  // activation's rows before its layout-effect cleanup captures a bookmark.
  // On an activation transition React runs the old cleanup first, then this
  // setup replaces the binding with a new object for the committed owner.
  useLayoutEffect(() => {
    readingRef.current = reading;
    snapshotRef.current = snapshot;
    bottomIntentPresentationRef.current = bottomIntentPresentation;
    surfaceVisibleRef.current = surfaceVisible === true;
    const current = reading.getSession?.() || reading.session;
    if (activationOwnerRef.current?.activationID !== reading.activationID) {
      const bookmark = current.bookmark?.messageID ? current.bookmark : null;
      // A mode handoff mounts a fresh Virtuoso under the same semantic
      // activation. It needs the committed bookmark restore protocol too;
      // initialTopMostItemIndex is only an estimate until the row materializes.
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
      resetFollowingScroll(followingControl, reading, current);
      activationOwnerRef.current = {
        activationID: reading.activationID,
        reading,
        rows: snapshot.rows,
        surfaceVisible: surfaceVisible === true,
        snapshotRevision: Number(snapshot.revision || 0),
        roleRevision: Number(snapshot.roleRevision || 0),
        inputEpoch: current.inputEpoch,
      };
      positionDelayedBookmark('activation-materialized');
    } else {
      const issueRole = commitFollowingPresentation({
        control: followingControl,
        current,
        previous: activationOwnerRef.current,
        snapshot,
      });
      // Same-activation data commits keep the object captured by the lifecycle
      // cleanup but advance it to that activation's latest committed owner/data.
      activationOwnerRef.current.reading = reading;
      activationOwnerRef.current.rows = snapshot.rows;
      activationOwnerRef.current.surfaceVisible = surfaceVisible === true;
      activationOwnerRef.current.snapshotRevision = Number(snapshot.revision || 0);
      activationOwnerRef.current.roleRevision = Number(snapshot.roleRevision || 0);
      activationOwnerRef.current.inputEpoch = current.inputEpoch;
      positionDelayedBookmark('target-materialized');
      if (issueRole) issueBottomIfCurrent('role-commit');
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
      sendOwnedRevision: sendOwnedRevisionRef.current
        ? {
          intentID: sendOwnedRevisionRef.current.intentID,
          snapshotRevision: sendOwnedRevisionRef.current.snapshotRevision,
          roleRevision: sendOwnedRevisionRef.current.roleRevision,
          baselineObserved: sendOwnedRevisionRef.current.baselineObserved === true,
          independentOrdinary: sendOwnedRevisionRef.current.independentOrdinary === true,
        }
        : null,
      config: READING_TRACE_CONFIG,
      scrollTop: Number(scrollerRef.current?.scrollTop || 0),
      scrollHeight: Number(scrollerRef.current?.scrollHeight || 0),
      clientHeight: Number(scrollerRef.current?.clientHeight || 0),
    }));
  }, [bottomIntentPresentation, followingControl, issueBottomIfCurrent, reading,
    reading.activationID, snapshot, snapshot.rows, surfaceVisible]);

  useLayoutEffect(() => {
    handoffPendingRef.current = handoffPending === true;
    const current = readingRef.current.getSession?.() || readingRef.current.session;
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
    const session = owner.getSession?.() || owner.session;
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
    const session = owner.getSession?.() || owner.session;
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
      const session = owner.getSession?.() || owner.session;
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
    const current = owner.getSession?.() || owner.session;
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
      const owner = readingRef.current;
      const current = owner.getSession?.() || owner.session;
      if (reason === 'begin') {
        invalidateFollowingSend(sendScrollTransactionRef, current);
        sendOwnedRevisionRef.current = null;
        roleAuthorizationRef.current = null;
        delayedRestoreRef.current = null;
      }
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
      const current = owner.getSession?.() || owner.session;
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
    issueBottomIfCurrent('snapshot-commit');
  }, [issueBottomIfCurrent, scheduleCoverageCheck, scheduleObserve, scrollerNode, snapshot.revision]);

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
      const nextSize = `${Number(root.clientWidth || 0)}:${Number(root.clientHeight || 0)}`;
      const previousSize = viewportSizeRef.current;
      viewportSizeRef.current = nextSize;
      const owner = readingRef.current;
      const current = owner.getSession?.() || owner.session;
      if (previousSize && previousSize !== nextSize
        && current.mode === READING_MODE.following) {
        viewportAuthorizationRef.current = {
          activationID: current.activationID,
          inputEpoch: current.inputEpoch,
          geometryRevision: geometryRevisionRef.current,
        };
      }
      scheduleObserve('layout');
      scheduleCoverageCheck();
      issueBottomIfCurrent('viewport-layout');
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [issueBottomIfCurrent, scheduleCoverageCheck, scheduleObserve, scrollerNode]);

  useLayoutEffect(() => {
    const intent = reading.session.bottomIntent;
    const explicitLatest = String(intent?.id || '').startsWith('latest:');
    if ((!intent.id && !sendOwnedRevisionRef.current)
      || !snapshot.rows.length || (reading.bottomReady === false && !explicitLatest)) return;
    issueBottomIfCurrent('explicit-bottom');
  }, [bottomIntentPresentation, issueBottomIfCurrent, reading.bottomReady, reading.session.bottomIntent, snapshot.revision, snapshot.rows.length]);

  useLayoutEffect(() => () => {
    if (observationFrameRef.current) cancelAnimationFrame(observationFrameRef.current);
    if (coverageFrameRef.current) cancelAnimationFrame(coverageFrameRef.current);
    listCommitMicrotaskRef.current += 1;
    itemLayoutIssueMicrotaskRef.current += 1;
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
      const session = owner.getSession?.() || owner.session;
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
      const current = owner?.getSession?.() || owner?.session;
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
    const current = owner?.getSession?.() || owner?.session;
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
      issueBottomIfCurrent('list-commit');
    });
  }, [acknowledgeCommittedRange, issueBottomIfCurrent, positionDelayedBookmark,
    scheduleNavigationRevealReceipt, scheduleObserve]);
  const listContext = useMemo(() => ({
    onListCommit,
  }), [onListCommit]);
  const followAuthorized = reading.session.mode === READING_MODE.following
    && reading.initializing !== true
    && reading.bottomReady !== false;
  useLayoutEffect(() => {
    const previous = followAuthorizationRef.current;
    if (previous?.activationID !== reading.activationID) {
      followAuthorizationRef.current = {
        activationID: reading.activationID,
        authorized: followAuthorized,
      };
      return;
    }
    if (previous.authorized === followAuthorized) return;
    followAuthorizationRef.current = {
      activationID: reading.activationID,
      authorized: followAuthorized,
    };
    traceReadingAdapter('follow-authorization', {
      activationID: reading.activationID,
      inputEpoch: reading.session.inputEpoch,
      authorized: followAuthorized,
      bottomIntentID: reading.session.bottomIntent?.id || '',
    });
    if (!followAuthorized) return;
    const root = scrollerRef.current;
    const current = reading.getSession?.() || reading.session;
    if (!root || current.activationID !== reading.activationID
      || current.mode !== READING_MODE.following) return;
    const existing = layoutHeightAuthorizationRef.current;
    const exactExisting = existing
      && existing.activationID === current.activationID
      && existing.inputEpoch === current.inputEpoch
      && existing.snapshotRevision === Number(snapshot.revision || 0)
      && existing.roleRevision === Number(snapshot.roleRevision || 0);
    const pendingSend = current.bottomIntent?.inputEpoch === current.inputEpoch
      && String(current.bottomIntent?.id || '').startsWith('composer:send-start:');
    // Tail readiness is a committed presentation boundary. It may arrive
    // after explicit latest has already reached the then-current DOM tail and
    // after an earlier height token was rejected as not ready. Publish one
    // ordinary obligation for the current physical extent; a stronger exact
    // token remains intact. Browsing never enters this branch.
    // Send-start itself changes browsing to following before its durable
    // targets exist. That mode transition is not new geometry evidence.
    // Keep real height/viewport obligations intact and let the issuer join
    // the send's committed destination independently.
    if (!pendingSend
      && (!exactExisting || Number(existing.height || 0) <= Number(root.scrollHeight || 0))) {
      layoutHeightAuthorizationRef.current = {
        activationID: current.activationID,
        inputEpoch: current.inputEpoch,
        snapshotRevision: Number(snapshot.revision || 0),
        roleRevision: Number(snapshot.roleRevision || 0),
        height: Number(root.scrollHeight || 0),
        tokenID: `height:follow-ready:${current.activationID}:${current.inputEpoch}:${snapshot.revision}:${snapshot.roleRevision || 0}`,
      };
    }
    issueBottomIfCurrent('follow-ready');
  }, [followAuthorized, issueBottomIfCurrent, reading, reading.activationID, reading.session.bottomIntent?.id,
    reading.session.inputEpoch, snapshot.revision, snapshot.roleRevision]);
  const committedInitialLocation = initialLocationRef.current;
  const initial = committedInitialLocation.activationID === reading.activationID
    && committedInitialLocation.value
    ? committedInitialLocation.value
    : initialLocation(snapshot.rows, reading.session);
  useLayoutEffect(() => {
    if (!snapshot.rows.length
      || initialLocationRef.current.activationID === reading.activationID) return;
    // `initialTopMostItemIndex` is a one-shot mount input, but its value must
    // belong to the render React actually committed. Mutating this ref during
    // render lets a suspended/abandoned activation lend its bookmark to a
    // later render with the same activation id. Freeze the rendered candidate
    // only at the layout-commit boundary; until then every candidate derives
    // its own value from its own rows/session.
    initialLocationRef.current = {
      activationID: reading.activationID,
      value: initial,
    };
  }, [initial, reading.activationID, snapshot.rows.length]);
  if (reading.restorePending && !snapshot.rows.length) {
    return <div className="timeline-message-list timeline-reading-restore" role="status">正在恢复上次阅读位置…</div>;
  }
  if (!snapshot.rows.length) {
    return <div className="timeline-message-list" data-empty="true" role="region" aria-label="频道动态" />;
  }
  const initialTopMostItemIndex = initial.atEnd === true
    ? { index: 'LAST', align: 'end' }
    : {
      // initialTopMostItemIndex is data-relative even when firstItemIndex uses
      // Virtuoso's separate absolute coordinate for prepend continuity.
      index: Number(initial.index || 0),
      align: 'start',
      ...(Number.isFinite(initial.viewOffset) ? { offset: initial.viewOffset } : {}),
    };

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
    initialTopMostItemIndex={handoffPending && navigationTarget ? undefined : initialTopMostItemIndex}
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
      const previousHeight = lastListHeightRef.current;
      const ackTuple = {
        activationID: reading.activationID,
        inputEpoch: reading.session.inputEpoch,
        snapshotRevision: Number(snapshot.revision || 0),
        roleRevision: Number(snapshot.roleRevision || 0),
      };
      const previousAck = itemLayoutAckRef.current;
      const sameAckTuple = previousAck
        && previousAck.activationID === ackTuple.activationID
        && previousAck.inputEpoch === ackTuple.inputEpoch
        && previousAck.snapshotRevision === ackTuple.snapshotRevision
        && previousAck.roleRevision === ackTuple.roleRevision;
      itemLayoutAckRef.current = {
        ...ackTuple,
        firstHeight: sameAckTuple
          ? Number(previousAck.firstHeight ?? previousAck.height ?? committedHeight)
          : committedHeight,
        height: committedHeight,
        ackSeq: sameAckTuple ? Number(previousAck.ackSeq || 1) + 1 : 1,
        rowIDs: Object.freeze(snapshot.rows.map((row) => row.id)),
      };
      traceReadingAdapter('list-height', () => ({
        height: committedHeight,
        scrollTop: Number(scrollerRef.current?.scrollTop || 0),
        scrollHeight: Number(scrollerRef.current?.scrollHeight || 0),
        clientHeight: Number(scrollerRef.current?.clientHeight || 0),
      }));
      const current = reading.getSession?.() || reading.session;
      const roleAuthorization = roleAuthorizationRef.current;
      const ownsRoleCommit = Boolean(
        roleAuthorization
        && roleAuthorization.activationID === current.activationID
        && roleAuthorization.inputEpoch === current.inputEpoch
        && roleAuthorization.snapshotRevision === Number(snapshot.revision || 0)
        && roleAuthorization.roleRevision === Number(snapshot.roleRevision || 0)
      );
      const firstRoleAck = ownsRoleCommit
        && roleAuthorization.ready !== true;
      const currentIntent = current.bottomIntent?.id
        && current.bottomIntent.inputEpoch === current.inputEpoch
        ? current.bottomIntent
        : null;
      if (firstRoleAck) {
        // `blocked` records that an intent existed when the role commit was
        // published; it is not a permanent veto. Explicit latest can consume
        // that intent before the public height acknowledgement arrives. In
        // that ordering the still-following reader owns the committed role
        // height normally. A currently-live send/latest intent remains the
        // sole authority and the role token stays suppressed.
        roleAuthorizationRef.current = currentIntent
          ? null
          : {
            ...roleAuthorization,
            ready: true,
            blocked: false,
            height: committedHeight,
          };
      }
      const owned = sendOwnedRevisionRef.current;
      const ownsThisCommit = Boolean(
        owned
        && owned.activationID === current.activationID
        && owned.inputEpoch === current.inputEpoch
        && owned.snapshotRevision === Number(snapshot.revision || 0)
        && owned.roleRevision === Number(snapshot.roleRevision || 0)
        && current.bottomIntent?.id === owned.intentID,
      );
      const firstOwnedBaseline = ownsThisCommit
        && owned.baselineObserved !== true;
      if (firstOwnedBaseline) {
        // Observation identity is independent of the numeric height. The
        // target commit may legitimately report the same extent as the prior
        // commit (for example timeline -> Waiting replacement).
        sendOwnedRevisionRef.current = {
          ...owned,
          baselineObserved: true,
          baselineHeight: committedHeight,
        };
      }
      if (committedHeight !== previousHeight) {
        lastListHeightRef.current = committedHeight;
        if (firstRoleAck || (firstOwnedBaseline && owned.independentOrdinary !== true)) {
          // The exact target delta's first public height completes only the
          // send join. A later different height in the same revision is a new
          // committed layout obligation and is allowed to follow normally.
          layoutHeightAuthorizationRef.current = null;
        } else {
          // A changed public list extent is an ordinary physical-tail
          // obligation while this activation is following. The Waiting
          // reserve itself is fixed from initial mount and therefore never
          // enters this path as a presentation state change.
          layoutHeightAuthorizationRef.current = current.mode === READING_MODE.following
            ? {
              activationID: current.activationID,
              inputEpoch: current.inputEpoch,
              snapshotRevision: Number(snapshot.revision || 0),
              roleRevision: Number(snapshot.roleRevision || 0),
              height: committedHeight,
              tokenID: `height:${current.activationID}:${current.inputEpoch}:${snapshot.revision}:${committedHeight}`,
            }
            : null;
        }
      }
      geometryRevisionRef.current += 1;
      scheduleObserve('layout');
      scheduleCoverageCheck();
      issueBottomIfCurrent('item-layout');
      // Virtuoso publishes the committed list height from its layout callback
      // before the browser necessarily exposes that same Footer/list extent
      // through root.scrollHeight. Keep the exact existing authorization and
      // retry it once at the microtask commit boundary; the issuer re-reads
      // activation/input/mode and remains the sole geometry writer. A newer
      // height callback or unmount invalidates this attempt, and there is no
      // timer/rAF correction loop.
      const issueGeneration = ++itemLayoutIssueMicrotaskRef.current;
      queueMicrotask(() => {
        if (itemLayoutIssueMicrotaskRef.current !== issueGeneration) return;
        issueBottomIfCurrent('item-layout-commit');
      });
    }}
    />
  </>;
}

function StandaloneMessageList(props) {
  const stackRef = useRef(null);
  return <ReadingNavigationOwner
    activationID={props.reading.activationID}
    reading={props.reading}
    stackRef={stackRef}
    visibleRole="browsing"
  ><div ref={stackRef}><ControlledMessageList {...props} /></div></ReadingNavigationOwner>;
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
  const navigationOwner = useReadingNavigationOwner();
  return navigationOwner ? <ControlledMessageList {...props} /> : <StandaloneMessageList {...props} />;
}
