import React, {
  Component,
  cloneElement,
  forwardRef,
  isValidElement,
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { Virtuoso } from 'react-virtuoso';
import { diagnostic, isReadingTraceEnabled, readingTrace } from '../../model/diagnostics.js';
import { READING_MODE } from '../../model/reading-session.js';
import {
  advanceSendScrollTransaction,
  createSendScrollTransaction,
  sendScrollTransactionCanWrite,
} from '../../model/send-scroll-transaction.js';
import { MessageLayoutScope } from './MessageLayoutState.jsx';

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
  historyRunwayMinimumPx: 800,
});

const CommitAwareList = forwardRef(function CommitAwareList({ children, context, ...props }, ref) {
  useLayoutEffect(() => {
    context?.onListCommit?.();
  });
  const className = [props.className, 'timeline-input-resize-content'].filter(Boolean).join(' ');
  return <div {...props} className={className} ref={ref}>{children}</div>;
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

function nestedScrollOwner(target, root, delta) {
  for (let node = target; node && node !== root; node = node.parentElement) {
    const style = globalThis.getComputedStyle?.(node);
    const scrollable = /auto|scroll/.test(style?.overflowY || '') && node.scrollHeight > node.clientHeight + 1;
    if (!scrollable) continue;
    if (delta < 0 && node.scrollTop > 0) return node;
    if (delta > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1) return node;
  }
  return null;
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

const MessageRow = memo(function MessageRow({ row, revision, renderRow, presentationState }) {
  useLayoutEffect(() => {
    traceReadingAdapter('row-commit', { rowID: row.id, revision });
  }, [revision, row.id]);
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

export function MessageList({
  snapshot,
  reading,
  rowRevision,
  rowPresentationState,
  renderRow,
  surfaceVisible = false,
  bottomIntentPresentation = null,
  handoffPending = false,
  focusOnMount = false,
  onHandoffReady,
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
  const handoffReadyRef = useRef(false);
  const focusClaimedRef = useRef(false);
  const materializationAckRef = useRef(null);
  const observationFrameRef = useRef(0);
  const coverageFrameRef = useRef(0);
  const coverageDemandKeyRef = useRef('');
  const topDemandKeyRef = useRef('');
  const pendingObservationRef = useRef(null);
  const atBottomRef = useRef(false);
  const atTopRef = useRef(false);
  const geometryRevisionRef = useRef(0);
  const inputRef = useRef({
    activationID: reading.activationID,
    epoch: reading.session.inputEpoch,
    direction: '',
    gestureID: '',
    geometryRevision: 0,
    kind: '',
    canFollowTail: true,
    canRequestHistory: true,
    active: false,
  });
  const scrollTopRef = useRef(0);
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
  const coverageStatusKey = JSON.stringify([
    reading.status?.attached === true,
    Number(reading.status?.generation || 0),
    reading.status?.hasOlder === true,
    reading.status?.loading === true,
    String(reading.status?.error || ''),
    Number(reading.status?.completedPages || 0),
    Number(reading.status?.revealVersion || 0),
  ]);

  const positionDelayedBookmark = useCallback((source) => {
    const pending = delayedRestoreRef.current;
    if (!pending) return false;
    const owner = readingRef.current;
    const current = owner.getSession?.() || owner.session;
    const data = snapshotRef.current;
    const ack = materializationAckRef.current;
    if (pending.activationID !== current.activationID
      || pending.inputEpoch !== current.inputEpoch) {
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
    if (targetIndex < 0 || typeof virtuosoRef.current?.scrollToIndex !== 'function') return false;
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
    if (pending.phase === 'issued') {
      if (!targetMaterialized) return false;
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
      return true;
    }
    virtuosoRef.current.scrollToIndex({
      index: targetIndex,
      align: 'start',
      ...(Number.isFinite(desiredOffset)
        ? { offset: -desiredOffset }
        : {}),
    });
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
    const binding = activationOwnerRef.current;
    const root = scrollerRef.current;
    const geometry = () => ({
      scrollTop: Number(root?.scrollTop || 0),
      scrollHeight: Number(root?.scrollHeight || 0),
      clientHeight: Number(root?.clientHeight || 0),
    });
    const reject = (reason, detail = {}) => {
      traceReadingAdapter('issuer-reject', () => ({ source, reason, ...geometry(), ...detail }));
      return false;
    };
    traceReadingAdapter('issuer-enter', () => ({
      source,
      ...geometry(),
    }));
    if (!binding) return reject('no-binding');
    if (!root) return reject('no-scroller');
    if (typeof root.scrollTo !== 'function') return reject('no-scroll-method');
    const owner = binding.reading;
    const current = owner.getSession?.() || owner.session;
    const intent = current.bottomIntent?.id ? current.bottomIntent : null;
    if (binding.activationID !== current.activationID) return reject('owner-activation');
    const validIntent = Boolean(intent?.id && intent.inputEpoch === current.inputEpoch);
    const latestIntent = validIntent && String(intent.id).startsWith('latest:');
    if (validIntent && intentGeometryRef.current?.id !== intent.id) {
      intentGeometryRef.current = { id: intent.id, scrollHeight: Number(root.scrollHeight || 0) };
    }
    const afterPresentationRevision = Math.max(0, Number(intent?.afterPresentationRevision) || 0);
    const sendTargets = String(intent?.id || '').startsWith('composer:send-start:')
      ? (intent?.targetMessageIDs || [])
      : [];
    if (validIntent && sendTargets.length
      && sendScrollTransactionRef.current?.intentID !== intent.id) {
      sendScrollTransactionRef.current = createSendScrollTransaction(intent, current.activationID);
    }
    const itemLayoutAck = itemLayoutAckRef.current;
    const validItemLayoutAck = Boolean(
      itemLayoutAck
      && itemLayoutAck.activationID === current.activationID
      && itemLayoutAck.inputEpoch === current.inputEpoch
      && itemLayoutAck.snapshotRevision === binding.snapshotRevision
      && itemLayoutAck.roleRevision === Number(binding.roleRevision || 0),
    );
    let sendTransaction = sendScrollTransactionRef.current;
    const presentation = bottomIntentPresentationRef.current;
    if (sendTransaction && presentation?.ready === true
      && presentation.intentID === intent?.id
      && presentation.activationID === current.activationID
      && presentation.inputEpoch === current.inputEpoch) {
      sendTransaction = advanceSendScrollTransaction(sendTransaction, {
        type: 'ready',
        activationID: current.activationID,
        inputEpoch: current.inputEpoch,
        intentID: intent.id,
        targetIDs: sendTargets,
        revision: Number(presentation.presentationRevision || binding.snapshotRevision || 0),
        destinations: presentation.destinations,
      });
      // A waiting destination is outside the list's flow. Its committed
      // presentation acknowledgement therefore also measures that the list
      // geometry for the same revision is final; no Virtuoso height callback
      // is expected when the list data did not change.
      if (sendTransaction?.destination === 'waiting'
        && sendTransaction.readyRevision === Number(presentation.presentationRevision || binding.snapshotRevision || 0)) {
        sendTransaction = advanceSendScrollTransaction(sendTransaction, {
          type: 'measured',
          activationID: current.activationID,
          inputEpoch: current.inputEpoch,
          revision: sendTransaction.readyRevision,
        });
      }
    }
    if (sendTransaction && validItemLayoutAck) {
      sendTransaction = advanceSendScrollTransaction(sendTransaction, {
        type: 'measured',
        activationID: current.activationID,
        inputEpoch: current.inputEpoch,
        revision: itemLayoutAck.snapshotRevision,
        height: itemLayoutAck.height,
        targetIDs: sendTargets.filter((messageID) => (
          itemLayoutAck.rowIDs.includes(messageID)
        )),
      });
    }
    sendScrollTransactionRef.current = sendTransaction;
    const sendTransactionReady = sendScrollTransactionCanWrite(sendTransaction);
    const intentTargetCommitted = validIntent && (sendTargets.length
      ? sendTransactionReady
      : latestIntent || Number(binding.snapshotRevision || 0) > afterPresentationRevision);
    const revisionAuthorization = followRevisionAuthorizationRef.current;
    const validRevisionAuthorization = Boolean(
      revisionAuthorization
      && revisionAuthorization.activationID === current.activationID
      && revisionAuthorization.inputEpoch === current.inputEpoch
      && revisionAuthorization.snapshotRevision === binding.snapshotRevision
      && revisionAuthorization.roleRevision === Number(binding.roleRevision || 0)
      && current.mode === READING_MODE.following,
    );
    const viewportAuthorization = viewportAuthorizationRef.current;
    const validViewportAuthorization = Boolean(
      viewportAuthorization
      && viewportAuthorization.activationID === current.activationID
      && viewportAuthorization.inputEpoch === current.inputEpoch
      && current.mode === READING_MODE.following,
    );
    const roleAuthorization = roleAuthorizationRef.current;
    const validRoleAuthorization = Boolean(
      !validIntent
      && roleAuthorization
      && roleAuthorization.ready === true
      && roleAuthorization.activationID === current.activationID
      && roleAuthorization.inputEpoch === current.inputEpoch
      && roleAuthorization.snapshotRevision === Number(binding.snapshotRevision || 0)
      && roleAuthorization.roleRevision === Number(binding.roleRevision || 0)
      && current.mode === READING_MODE.following,
    );
    let sendOwnedRevision = sendOwnedRevisionRef.current;
    const currentOwnsRevision = Boolean(
      validIntent
      && sendOwnedRevision
      && sendOwnedRevision.intentID === intent.id
      && sendOwnedRevision.activationID === current.activationID
      && sendOwnedRevision.inputEpoch === current.inputEpoch
    );
    // Revocation/replacement releases the exact baseline measurement. While
    // following it becomes an ordinary committed-height obligation; after
    // takeover it is discarded without geometry work.
    if (sendOwnedRevision && !currentOwnsRevision) {
      if (sendOwnedRevision.activationID === current.activationID
        && sendOwnedRevision.inputEpoch === current.inputEpoch
        && sendOwnedRevision.snapshotRevision === Number(binding.snapshotRevision || 0)
        && current.mode === READING_MODE.following
        && sendOwnedRevision.baselineObserved === true) {
        const existingHeight = layoutHeightAuthorizationRef.current;
        const existingDominatesBaseline = existingHeight
          && existingHeight.activationID === current.activationID
          && existingHeight.inputEpoch === current.inputEpoch
          && existingHeight.snapshotRevision === Number(binding.snapshotRevision || 0)
          && existingHeight.roleRevision === Number(binding.roleRevision || 0);
        if (!existingDominatesBaseline) {
          layoutHeightAuthorizationRef.current = {
            activationID: current.activationID,
            inputEpoch: current.inputEpoch,
            snapshotRevision: Number(binding.snapshotRevision || 0),
            roleRevision: Number(binding.roleRevision || 0),
            height: Number(sendOwnedRevision.baselineHeight),
            tokenID: `height:released-send:${sendOwnedRevision.intentID}:${binding.snapshotRevision}`,
          };
        }
      }
      sendOwnedRevisionRef.current = null;
      sendOwnedRevision = null;
    }
    const layoutHeightAuthorization = layoutHeightAuthorizationRef.current;
    const validLayoutHeightAuthorization = Boolean(
      layoutHeightAuthorization
      && layoutHeightAuthorization.activationID === current.activationID
      && layoutHeightAuthorization.inputEpoch === current.inputEpoch
      && layoutHeightAuthorization.snapshotRevision === binding.snapshotRevision
      && layoutHeightAuthorization.roleRevision === Number(binding.roleRevision || 0)
      && current.mode === READING_MODE.following,
    );
    const intentOwnsRevision = Boolean(
      currentOwnsRevision
      && sendOwnedRevision?.snapshotRevision === binding.snapshotRevision,
    );
    const ordinaryRevisionAuthorized = validRevisionAuthorization
      && (!intentOwnsRevision || revisionAuthorization.independent === true);
    // A viewport resize is an independent committed geometry obligation. A
    // pending send owns only its presentation/list-height join and must not
    // suppress a real client-size change or consume that send intent.
    const ordinaryViewportAuthorized = validViewportAuthorization;
    // The owned baseline never becomes a height token. Any valid token here
    // is either a tail-relevant non-target delta or a later, distinct public
    // height and therefore represents an independent layout obligation.
    const ordinaryHeightAuthorized = validLayoutHeightAuthorization;
    const authorization = intentTargetCommitted
      ? {
        kind: 'send-ready',
        tokenID: `intent:${intent.id}`,
        label: 'intent',
      }
      : ordinaryRevisionAuthorized
        ? {
          kind: 'presentation',
          tokenID: revisionAuthorization.tokenID
            || `presentation:${current.activationID}:${current.inputEpoch}:${binding.snapshotRevision}`,
          label: 'presentation-revision',
        }
        : validRoleAuthorization
          ? {
            kind: 'role',
            tokenID: roleAuthorization.tokenID,
            label: 'presentation-role',
          }
        : ordinaryViewportAuthorized
          ? {
            kind: 'viewport',
            tokenID: viewportAuthorization.tokenID
              || `viewport:${current.activationID}:${current.inputEpoch}:${viewportAuthorization.geometryRevision}`,
            label: 'viewport-revision',
          }
          : ordinaryHeightAuthorized
            ? {
              kind: 'height',
              tokenID: layoutHeightAuthorization.tokenID
                || `height:${current.activationID}:${current.inputEpoch}:${binding.snapshotRevision}:${layoutHeightAuthorization.height}`,
              label: 'presentation-height',
            }
            : null;
    if (!authorization && validIntent) {
      return reject('intent-target-pending', {
        intentID: intent.id,
        snapshotRevision: Number(binding.snapshotRevision || 0),
        afterPresentationRevision,
        targetMessageIDs: sendTargets,
        sendTransaction: sendTransaction ? {
          readyRevision: sendTransaction.readyRevision,
          measuredRevision: sendTransaction.measuredRevision,
        } : null,
      });
    }
    if (!authorization) {
      return reject('not-authorized', {
        snapshotRevision: Number(binding.snapshotRevision || 0),
        intentID: intent?.id || '',
      });
    }
    if (owner.initializing && !latestIntent) return reject('initializing');
    if (owner.bottomReady === false && !latestIntent) return reject('bottom-not-ready');
    if (!binding.rows.length) return reject('no-rows');
    const offsetHeight = Number(root.offsetHeight || 0);
    const clientHeight = Number(root.clientHeight || 0);
    const scrollHeight = Number(root.scrollHeight || 0);
    if (offsetHeight <= 0 || clientHeight <= 0 || scrollHeight <= 0) return reject('zero-geometry');

    const intentBaselineHeight = intentGeometryRef.current
      && intentGeometryRef.current.id === intent?.id
      ? Number(intentGeometryRef.current.scrollHeight || 0)
      : 0;
    if (authorization.kind === 'presentation' && !validItemLayoutAck) {
      return reject('presentation-layout-pending', {
        snapshotRevision: Number(binding.snapshotRevision || 0),
      });
    }
    if (authorization.kind === 'presentation'
      && validItemLayoutAck
      && Number(itemLayoutAck.height || 0) > Number(root.scrollHeight || 0)) {
      return reject('presentation-layout-pending', {
        snapshotRevision: Number(binding.snapshotRevision || 0),
        measuredHeight: Number(itemLayoutAck.height || 0),
      });
    }
    if (authorization.kind === 'height'
      && Number(layoutHeightAuthorization.height || 0) > Number(root.scrollHeight || 0)) {
      return reject('presentation-layout-pending', {
        snapshotRevision: Number(binding.snapshotRevision || 0),
        measuredHeight: Number(layoutHeightAuthorization.height || 0),
      });
    }
    if (authorization.kind === 'role'
      && Number(roleAuthorization.height || 0) > Number(root.scrollHeight || 0)) {
      return reject('presentation-layout-pending', {
        roleRevision: Number(binding.roleRevision || 0),
        measuredHeight: Number(roleAuthorization.height || 0),
      });
    }
    if (intentTargetCommitted
      && !sendTargets.length
      && !latestIntent
      && Number(root.scrollHeight || 0) <= intentBaselineHeight
      && !validItemLayoutAck) {
      return reject('intent-layout-pending', {
        intentID: intent.id,
        intentBaselineHeight,
        snapshotRevision: Number(binding.snapshotRevision || 0),
      });
    }
    if (intentTargetCommitted
      && sendTargets.length
      && sendTransaction?.destination !== 'waiting'
      && sendTransaction?.measuredHeight > Number(root.scrollHeight || 0)) {
      return reject('intent-layout-pending', {
        intentID: intent.id,
        measuredHeight: sendTransaction.measuredHeight,
        snapshotRevision: Number(binding.snapshotRevision || 0),
      });
    }
    const consumeAuthorization = () => {
      if (authorization.kind === 'send-ready') {
        if (sendTargets.length) {
          sendScrollTransactionRef.current = null;
          if (sendOwnedRevisionRef.current?.intentID === intent.id) sendOwnedRevisionRef.current = null;
        }
        owner.consumeBottomIntent(intent);
        intentGeometryRef.current = null;
      } else if (authorization.kind === 'presentation') {
        if (followRevisionAuthorizationRef.current === revisionAuthorization) {
          followRevisionAuthorizationRef.current = null;
        }
        if (validItemLayoutAck) itemLayoutAckRef.current = null;
      } else if (authorization.kind === 'viewport') {
        if (viewportAuthorizationRef.current === viewportAuthorization) viewportAuthorizationRef.current = null;
      } else if (authorization.kind === 'role') {
        if (roleAuthorizationRef.current === roleAuthorization) roleAuthorizationRef.current = null;
      } else if (authorization.kind === 'height') {
        if (layoutHeightAuthorizationRef.current === layoutHeightAuthorization) {
          layoutHeightAuthorizationRef.current = null;
        }
      }
    };
    if (isAtTail(root)) {
      consumeAuthorization();
      traceReadingAdapter('issuer-satisfy', () => ({
        source,
        activationID: binding.activationID,
        inputEpoch: current.inputEpoch,
        snapshotRevision: binding.snapshotRevision,
        intentID: intent?.id || '',
        authorization: authorization.label,
        authorityLabel: authorization.label,
        authorizationToken: authorization.tokenID,
        sendDestination: sendTransaction?.destination || '',
        sendReadyRevision: Number(sendTransaction?.readyRevision || 0),
        sendTargetIDs: sendTargets,
        afterPresentationRevision,
        reason: 'already-at-tail',
        ...geometry(),
      }));
      scheduleObserveRef.current?.('layout');
      return true;
    }

    traceReadingAdapter('issuer-write', () => ({
      source,
      activationID: binding.activationID,
      inputEpoch: current.inputEpoch,
      snapshotRevision: binding.snapshotRevision,
      intentID: intent?.id || '',
      authorization: authorization.label,
      authorityLabel: authorization.label,
      authorizationToken: authorization.tokenID,
      sendDestination: sendTransaction?.destination || '',
      sendReadyRevision: Number(sendTransaction?.readyRevision || 0),
      sendTargetIDs: sendTargets,
      afterPresentationRevision,
      ...geometry(),
    }));
    // This is the only continuous geometry write in the adapter. It runs
    // synchronously from a committed public list/layout acknowledgement and
    // leaves no queued library request that can outlive a later user input.
    root.dispatchEvent(new CustomEvent('atoll:timeline-bottom-write', { bubbles: true }));
    root.scrollTo({ top: root.scrollHeight, behavior: 'auto' });
    // A bottom write is not itself read evidence. Schedule the normal public
    // viewport observation so unseen is acknowledged only after the installed
    // visible tail is observed, including an already-at-tail no-op write.
    scheduleObserveRef.current?.('layout');
    consumeAuthorization();
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
      inputRef.current = { ...inputRef.current, activationID: reading.activationID, active: false };
      topDemandKeyRef.current = '';
      coverageDemandKeyRef.current = '';
      followAuthorizationRef.current = {
        activationID: reading.activationID,
        authorized: current.mode === READING_MODE.following
          && reading.initializing !== true
          && reading.bottomReady !== false,
      };
      followRevisionAuthorizationRef.current = null;
      viewportAuthorizationRef.current = null;
      layoutHeightAuthorizationRef.current = null;
      roleAuthorizationRef.current = null;
      lastListHeightRef.current = 0;
      viewportSizeRef.current = null;
      intentGeometryRef.current = null;
      sendScrollTransactionRef.current = null;
      sendOwnedRevisionRef.current = null;
      itemLayoutAckRef.current = null;
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
      const previousRows = activationOwnerRef.current.rows;
      const previousRevision = Number(activationOwnerRef.current.snapshotRevision || 0);
      const nextRevision = Number(snapshot.revision || 0);
      const previousRoleRevision = Number(activationOwnerRef.current.roleRevision || 0);
      const nextRoleRevision = Number(snapshot.roleRevision || 0);
      const previousTail = previousRows.at(-1);
      const nextTail = snapshot.rows.at(-1);
      const intent = current.bottomIntent?.id
        && current.bottomIntent.inputEpoch === current.inputEpoch
        ? current.bottomIntent
        : null;
      const transactionTargets = intent?.targetMessageIDs || [];
      const transactionOwnsRevision = Boolean(
        intent
        && nextRevision > Math.max(0, Number(intent.afterPresentationRevision) || 0),
      );
      const tailChanged = previousTail?.id !== nextTail?.id
        || previousTail?.contentRevision !== nextTail?.contentRevision
        || previousTail !== nextTail;
      const changeKind = snapshot.changes?.kind || '';
      const insertedIDs = snapshot.changes?.inserted || [];
      const updatedIDs = snapshot.changes?.updated || [];
      const removedIDs = snapshot.changes?.removed || [];
      const deltaIDs = [...insertedIDs, ...updatedIDs, ...removedIDs];
      const transactionOwnsDelta = transactionOwnsRevision
        && deltaIDs.some((id) => transactionTargets.includes(id));
      // A revision which also changes any non-target row carries an ordinary
      // presentation obligation of its own. This includes an insertion just
      // before a target which remains the exact tail; looking only at the
      // previous/next tail identity would incorrectly let the send join own
      // the whole revision.
      const nonTargetTailDelta = transactionOwnsDelta
        && (
          insertedIDs.some((id) => (
            !transactionTargets.includes(id)
            && !previousRows.some((row) => row.id === id)
          ))
          || updatedIDs.some((id) => !transactionTargets.includes(id))
          || removedIDs.some((id) => (
            !transactionTargets.includes(id)
            && !snapshot.rows.some((row) => row.id === id)
          ))
        );
      if (transactionOwnsDelta) {
        const childFirstAck = itemLayoutAckRef.current;
        const baselineObserved = Boolean(
          childFirstAck
          && childFirstAck.activationID === current.activationID
          && childFirstAck.inputEpoch === current.inputEpoch
          && childFirstAck.snapshotRevision === nextRevision
          && childFirstAck.roleRevision === nextRoleRevision,
        );
        const baselineHeight = baselineObserved
          ? Number(childFirstAck.firstHeight ?? childFirstAck.height ?? 0)
          : 0;
        const laterHeight = baselineObserved
          ? Number(childFirstAck.height ?? baselineHeight)
          : 0;
        sendOwnedRevisionRef.current = {
          intentID: intent.id,
          activationID: current.activationID,
          inputEpoch: current.inputEpoch,
          snapshotRevision: nextRevision,
          roleRevision: nextRoleRevision,
          baselineObserved,
          baselineHeight,
          independentOrdinary: nonTargetTailDelta,
        };
        // A child public-height effect for this render may run before the
        // parent establishes exact send ownership. It cannot authorize a
        // generic follow write for the send target's own revision.
        if (baselineObserved) {
          if (nonTargetTailDelta || laterHeight !== baselineHeight) {
            layoutHeightAuthorizationRef.current = current.mode === READING_MODE.following
              ? {
                activationID: current.activationID,
                inputEpoch: current.inputEpoch,
                snapshotRevision: nextRevision,
                roleRevision: nextRoleRevision,
                height: laterHeight,
                tokenID: `height:child-first:${current.activationID}:${current.inputEpoch}:${nextRevision}:${childFirstAck.ackSeq || 1}`,
              }
              : null;
          } else {
            layoutHeightAuthorizationRef.current = null;
          }
        }
      }
      let sendTransaction = sendScrollTransactionRef.current;
      if (sendTransaction
        && (sendTransaction.activationID !== current.activationID
          || sendTransaction.inputEpoch !== current.inputEpoch)) {
        sendTransaction = null;
        sendScrollTransactionRef.current = null;
      }
      const previousTailIndexInNext = previousTail?.id
        ? snapshot.rows.findIndex((candidate) => candidate.id === previousTail.id)
        : -1;
      const forwardTailExtension = previousTailIndexInNext >= 0
        && previousTailIndexInNext < snapshot.rows.length - 1
        && snapshot.rows.slice(previousTailIndexInNext + 1)
          .some((candidate) => insertedIDs.includes(candidate.id));
      const tailRevision = nextRevision > previousRevision
        && tailChanged
        && (changeKind === 'append'
          || forwardTailExtension
          || (changeKind === 'revise'
            && (snapshot.changes?.updated || []).includes(nextTail?.id)));
      if (tailRevision && current.mode === READING_MODE.following
        && (!transactionOwnsDelta || nonTargetTailDelta)) {
        followRevisionAuthorizationRef.current = {
          activationID: current.activationID,
          inputEpoch: current.inputEpoch,
          snapshotRevision: nextRevision,
          roleRevision: nextRoleRevision,
          tokenID: `presentation:${current.activationID}:${current.inputEpoch}:${nextRevision}`,
          independent: nonTargetTailDelta,
        };
      } else if (nextRevision > previousRevision) {
        followRevisionAuthorizationRef.current = null;
      }
      const roleUpdatedIDs = snapshot.roleChanges?.updated || [];
      if (nextRoleRevision > previousRoleRevision) {
        const currentIntent = current.bottomIntent?.id
          && current.bottomIntent.inputEpoch === current.inputEpoch
          ? current.bottomIntent
          : null;
        const childFirstRoleAck = itemLayoutAckRef.current;
        const roleAckReady = Boolean(
          childFirstRoleAck
          && childFirstRoleAck.activationID === current.activationID
          && childFirstRoleAck.inputEpoch === current.inputEpoch
          && childFirstRoleAck.snapshotRevision === nextRevision
          && childFirstRoleAck.roleRevision === nextRoleRevision,
        );
        roleAuthorizationRef.current = current.mode === READING_MODE.following
          && roleUpdatedIDs.length
          ? {
            activationID: current.activationID,
            inputEpoch: current.inputEpoch,
            snapshotRevision: nextRevision,
            roleRevision: nextRoleRevision,
            updatedIDs: Object.freeze([...roleUpdatedIDs]),
            ready: roleAckReady && !currentIntent,
            blocked: Boolean(currentIntent),
            height: roleAckReady ? Number(childFirstRoleAck.height || 0) : 0,
            tokenID: `role:${current.activationID}:${current.inputEpoch}:${nextRoleRevision}`,
          }
          : null;
        if (roleAckReady) {
          const pendingHeight = layoutHeightAuthorizationRef.current;
          if (pendingHeight
            && pendingHeight.activationID === current.activationID
            && pendingHeight.inputEpoch === current.inputEpoch
            && pendingHeight.snapshotRevision === nextRevision
            && pendingHeight.roleRevision === nextRoleRevision) {
            layoutHeightAuthorizationRef.current = null;
          }
          if (currentIntent) roleAuthorizationRef.current = null;
        }
      }
      // Same-activation data commits keep the object captured by the lifecycle
      // cleanup but advance it to that activation's latest committed owner/data.
      activationOwnerRef.current.reading = reading;
      activationOwnerRef.current.rows = snapshot.rows;
      activationOwnerRef.current.surfaceVisible = surfaceVisible === true;
      activationOwnerRef.current.snapshotRevision = Number(snapshot.revision || 0);
      activationOwnerRef.current.roleRevision = Number(snapshot.roleRevision || 0);
      activationOwnerRef.current.inputEpoch = current.inputEpoch;
      positionDelayedBookmark('target-materialized');
      if (roleAuthorizationRef.current?.ready === true) {
        issueBottomIfCurrent('role-commit');
      }
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
  }, [bottomIntentPresentation, issueBottomIfCurrent, reading, reading.activationID, snapshot, snapshot.rows, surfaceVisible]);

  useLayoutEffect(() => {
    handoffPendingRef.current = handoffPending === true;
    if (!handoffPending) handoffReadyRef.current = false;
  }, [handoffPending]);

  useLayoutEffect(() => {
    if (surfaceVisible !== true) reading.onSurfaceVisibilityChange?.(false);
  }, [reading, reading.activationID, surfaceVisible]);

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
      inputEpoch: evidence?.inputEpoch ?? inputRef.current.epoch,
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
    owner.onReadingObservation({
      bookmark,
      atTail: evidence?.atTail ?? isAtTail(observedRoot),
      surfaceVisible: surfaceVisibleRef.current === true && isReadingSurfaceVisible(observedRoot),
      installedHighSeq: installedHigh,
      visibleRows,
      source: evidence?.source || 'layout',
      settled: evidence?.settled === true,
      inputEpoch: evidence?.inputEpoch ?? inputRef.current.epoch,
      geometryRevision: evidence?.geometryRevision ?? geometryRevisionRef.current,
      activationID: evidence?.activationID || session.activationID,
    });
  }, []);

  const scheduleObserve = useCallback((source = 'layout') => {
    const owner = readingRef.current;
    const session = owner.getSession?.() || owner.session;
    // Preserve the evidence at the event boundary. The latest event in a frame
    // wins, so a later layout invalidation cannot inherit an earlier scroll's
    // `user` source, and a real gesture after layout gets fresh evidence.
    const evidence = {
      source,
      settled: source === 'settled',
      atTail: isAtTail(scrollerRef.current),
      inputEpoch: inputRef.current.epoch,
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
  }, [observe]);
  scheduleObserveRef.current = scheduleObserve;

  const scheduleCoverageCheck = useCallback(() => {
    if (handoffPendingRef.current) return;
    if (coverageFrameRef.current) return;
    coverageFrameRef.current = requestAnimationFrame(() => {
      coverageFrameRef.current = 0;
      const root = scrollerRef.current;
      const owner = readingRef.current;
      const rows = snapshotRef.current.rows;
      const status = owner.status || {};
      if (!root || !rows.length || root.clientHeight <= 0) return;
      // Under-fill is a persistent history obligation only after the scheduler
      // has installed positive evidence that older data exists. A pre-attach
      // `hasOlder:false` is unknown, not permission to synthesize a request;
      // the published status transition re-runs this check after attach.
      if (status.attached !== true || status.messageCurrent !== true || status.hasOlder !== true) return;
      // `messageCurrent` describes the Replica. Presentation can still be one
      // commit behind it. A real remote head must also be installed in this
      // view before short partial content can prove an under-fill obligation.
      // Tests without a remote-head contract keep using the explicit
      // attached/hasOlder evidence above.
      if (Number(status.headSeq || 0) > 0 && owner.bottomReady !== true) return;
      // A virtualizer's initial zero window and a partially materialized long
      // list are not evidence that history is under-supplied. Only a committed
      // window containing both data boundaries can prove that the available
      // content physically fails to fill a real viewport.
      const materialized = [...root.querySelectorAll('[data-presentation-row-id]')];
      const first = materialized.find((node) => node.dataset.presentationRowId === rows[0].id);
      const last = materialized.find((node) => node.dataset.presentationRowId === rows.at(-1).id);
      if (!first || !last || root.scrollHeight > root.clientHeight + 1) return;
      const key = `${owner.activationID}:${snapshotRef.current.revision}:${root.clientHeight}:${root.scrollHeight}:${coverageStatusKey}`;
      if (coverageDemandKeyRef.current === key) return;
      coverageDemandKeyRef.current = key;
      diagnostic('debug', 'history.viewport_underfilled', {
        channelId: status.channelId || '',
        clientHeight: root.clientHeight,
        scrollHeight: root.scrollHeight,
        rowCount: rows.length,
        attached: status.attached === true,
        messageCurrent: status.messageCurrent === true,
        bottomReady: owner.bottomReady === true,
        hasOlder: status.hasOlder === true,
      });
      (owner.onUnderfill || owner.onAtTop)({ demandUnits: completeViewportUnits(root) });
    });
  }, [coverageStatusKey]);

  const requestTopDemand = useCallback((reason = 'top') => {
    const owner = readingRef.current;
    const current = owner.getSession?.() || owner.session;
    const first = snapshotRef.current.rows[0];
    const key = `${current.activationID}:${current.inputEpoch}:${first?.id || ''}:${first?.seqLow || 0}`;
    // `scroll` and `scrollend` may both expose the same physical edge. A fast
    // cache can satisfy between them, so in-flight request dedupe alone is not
    // enough. The visible frontier participates so continuous native momentum
    // can request the next bounded segment after a real prepend, while layout
    // callbacks for the same frontier cannot drain the reservoir.
    if (topDemandKeyRef.current === key) return;
    topDemandKeyRef.current = key;
    const detail = { demandUnits: completeViewportUnits(scrollerRef.current) };
    if (reason === 'runway') (owner.onNearTop || owner.onAtTop)(detail);
    else owner.onAtTop(detail);
  }, []);

  const takeControl = useCallback((direction, nativeEvent, {
    kind = 'navigation',
    canFollowTail = true,
    canRequestHistory = true,
  } = {}) => {
    const owner = readingRef.current;
    const root = scrollerRef.current;
    const delta = nativeEvent?.deltaY || (direction === 'older' ? -1 : direction === 'newer' ? 1 : 0);
    if (root && nativeEvent?.target && nestedScrollOwner(nativeEvent.target, root, delta)) {
      traceReadingAdapter('input-nested', {
        activationID: owner.activationID,
        type: nativeEvent?.type || '',
        direction,
        delta,
      });
      return;
    }
    const gestureID = `${nativeEvent?.type || 'input'}:${nativeEvent?.timeStamp || performance.now()}`;
    const control = { direction, gestureID, geometryRevision: geometryRevisionRef.current };
    const before = owner.getSession?.() || owner.session;
    // A downward wheel/key/touch gesture which cannot move an already
    // following tail is not a request to start browsing. In particular it
    // must not make the next append look like an abandoned reading position.
    // A content selection gesture is different: it may autoscroll, so it
    // takes browsing ownership but is never allowed to grant tail-following.
    if (direction === 'newer' && before.mode === READING_MODE.following && isAtTail(root)) {
      inputRef.current = { ...inputRef.current, active: false };
      traceReadingAdapter('input-noop-tail', () => ({
        activationID: before.activationID,
        inputEpoch: before.inputEpoch,
        type: nativeEvent?.type || '',
        direction,
        delta,
      }));
      return;
    }
    // ReadingSession changes in the same native input turn. Every later data,
    // height, or viewport signal re-reads this owner. This commit also drives
    // Legend's declarative maintainScrollAtEnd authorization to false.
    if (before.mode === READING_MODE.following) {
      flushSync(() => owner.onUserControl(control));
    } else {
      owner.onUserControl(control);
    }
    const current = owner.getSession?.() || owner.session;
    sendScrollTransactionRef.current = advanceSendScrollTransaction(
      sendScrollTransactionRef.current,
      { type: 'invalidate', activationID: before.activationID, inputEpoch: before.inputEpoch },
    );
    sendOwnedRevisionRef.current = null;
    roleAuthorizationRef.current = null;
    delayedRestoreRef.current = null;
    inputRef.current = {
      activationID: current.activationID,
      epoch: current.inputEpoch,
      direction,
      gestureID,
      geometryRevision: geometryRevisionRef.current,
      kind,
      canFollowTail,
      canRequestHistory,
      active: true,
    };
    traceReadingAdapter('input-owner', () => ({
      activationID: current.activationID,
      inputEpoch: current.inputEpoch,
      previousInputEpoch: before.inputEpoch,
      type: nativeEvent?.type || '',
      direction,
      delta,
      gestureID,
      scrollTop: Number(root?.scrollTop || 0),
      scrollHeight: Number(root?.scrollHeight || 0),
      clientHeight: Number(root?.clientHeight || 0),
    }));
    if (direction === 'older' && root && canRequestHistory) {
      const atPhysicalTop = atTopRef.current || Number(root.scrollTop || 0) <= 1;
      // This is distance to the physical start of the currently revealed
      // dataset, not rangeChanged.startIndex (which includes pre-rendered
      // items and changes when overscan changes). Only this native input turn
      // can ask for a runway release; range/layout callbacks never can.
      const runwayPx = Math.max(
        READING_TRACE_CONFIG.historyRunwayMinimumPx,
        Number(root.clientHeight || 0),
      );
      if (atPhysicalTop) requestTopDemand('top');
      else if (Number(root.scrollTop || 0) <= runwayPx) requestTopDemand('runway');
    }
  }, [requestTopDemand]);

  useLayoutEffect(() => {
    const root = scrollerRef.current;
    if (!root) return undefined;
    const onWheel = (event) => {
      if (event.deltaY) takeControl(event.deltaY < 0 ? 'older' : 'newer', event);
    };
    scrollTopRef.current = Number(root.scrollTop || 0);
    const onScroll = () => {
      const previousTop = scrollTopRef.current;
      const nextTop = Number(root.scrollTop || 0);
      scrollTopRef.current = nextTop;
      atBottomRef.current = Number(root.scrollHeight || 0) - Number(root.clientHeight || 0) - nextTop <= 24;
      atTopRef.current = nextTop <= 1;
      const direction = nextTop > previousTop ? 'newer' : nextTop < previousTop ? 'older' : '';
      const owner = readingRef.current;
      let input = inputRef.current;
      const current = owner.getSession?.() || owner.session;
      traceReadingAdapter('scroll-observed', () => ({
        activationID: current.activationID,
        inputEpoch: current.inputEpoch,
        mode: current.mode,
        inputActive: inputRef.current.active,
        inputDirection: inputRef.current.direction,
        previousScrollTop: previousTop,
        scrollTop: nextTop,
        scrollDelta: nextTop - previousTop,
        scrollHeight: Number(root.scrollHeight || 0),
        clientHeight: Number(root.clientHeight || 0),
      }));
      if (direction && input.active && input.activationID === current.activationID
        && input.epoch === current.inputEpoch
        && (input.direction === direction || input.direction === 'browse')) {
        if (input.direction === 'browse') {
          // A real scrollbar drag starts directionless and may legitimately
          // restore following when it reaches the tail. Selection autoscroll
          // also starts directionless, but must stay browsing: translating its
          // downward movement into a newer intent would let append steal the
          // user's selected text.
          if (input.canFollowTail) {
            owner.onUserControl({ direction, gestureID: input.gestureID, geometryRevision: geometryRevisionRef.current });
          }
          const moved = owner.getSession?.() || owner.session;
          input = {
            ...input,
            epoch: moved.inputEpoch,
            direction,
            geometryRevision: geometryRevisionRef.current,
          };
          inputRef.current = input;
        }
        scheduleObserve('user');
        if (direction === 'older' && input.canRequestHistory) {
          const runwayPx = Math.max(
            READING_TRACE_CONFIG.historyRunwayMinimumPx,
            Number(root.clientHeight || 0),
          );
          // Wheel/touch/key events can start above the runway and native
          // momentum may cross it without another input callback. The actual
          // upward scroll event may therefore ask for the next frontier while
          // its current activation/input evidence remains live. Layout/range
          // callbacks cannot enter this path, and scrollend/reversal clears or
          // replaces the evidence.
          if (nextTop <= 1) requestTopDemand('top');
          else if (nextTop <= runwayPx) requestTopDemand('runway');
        }
      } else {
        scheduleObserve('layout');
      }
    };
    const onScrollEnd = () => {
      const owner = readingRef.current;
      const current = owner.getSession?.() || owner.session;
      const input = inputRef.current;
      // Keyboard Home and browser momentum may report their final zero offset
      // in `scrollend` immediately before the last `scroll` event. Consume
      // that real geometry while its originating input evidence is still
      // current; this does not infer demand from Virtuoso's initial edge.
      if (root.scrollTop <= 1 && input.active
        && input.activationID === current.activationID
        && input.epoch === current.inputEpoch
        && input.canRequestHistory
        && (input.direction === 'older' || input.direction === 'browse')) {
        requestTopDemand('top');
      }
      const pending = pendingObservationRef.current;
      // `settled` describes when the sample is taken; it is not a new source
      // of authority. Preserve a current user sample instead of replacing it
      // before its already-scheduled rAF can reach the reading reducer. Every
      // ownership coordinate must still match, so a layout revision, input
      // epoch, activation replacement, or completed gesture fails closed.
      const settlesCurrentUser = Boolean(
        input.active
        && input.activationID === current.activationID
        && input.epoch === current.inputEpoch
        && pending?.source === 'user'
        && pending.activationID === current.activationID
        && pending.inputEpoch === current.inputEpoch
        && pending.geometryRevision === geometryRevisionRef.current
      );
      if (settlesCurrentUser) {
        pendingObservationRef.current = {
          ...pending,
          atTail: isAtTail(root),
          settled: true,
        };
      }
      inputRef.current = { ...inputRef.current, active: false };
      // Capture an exact text point once per completed gesture, not on every
      // scroll/range/layout observation. A current user sample retains its
      // existing authority; otherwise settlement remains observation-only and
      // cannot authorize following or write geometry.
      if (!settlesCurrentUser) scheduleObserve('settled');
    };
    let touchY = null;
    const onTouchStart = (event) => { touchY = event.touches[0]?.clientY ?? null; };
    const onTouchMove = (event) => {
      const y = event.touches[0]?.clientY;
      if (y != null && touchY != null && Math.abs(y - touchY) > 2) {
        takeControl(y > touchY ? 'older' : 'newer', event);
      }
      touchY = y ?? null;
    };
    const onKey = (event) => {
      if (event.target.closest?.('input, textarea, select, button, a, [contenteditable="true"]')) return;
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) {
        takeControl('older', event);
      } else if (['ArrowDown', 'PageDown', 'End'].includes(event.key) || event.key === ' ') {
        takeControl('newer', event);
      }
    };
    let pointerStart = null;
    const onPointerDown = (event) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      const scrollbar = event.target === root;
      pointerStart = { x: event.clientX, y: event.clientY, scrollbar };
      if (scrollbar) takeControl('browse', event, { kind: 'scrollbar' });
    };
    const onPointerMove = (event) => {
      if (!pointerStart || event.pointerType !== 'mouse') return;
      if (Math.abs(event.clientX - pointerStart.x) < 3 && Math.abs(event.clientY - pointerStart.y) < 3) return;
      const direction = event.clientY > pointerStart.y ? 'newer' : 'older';
      const scrollbar = pointerStart.scrollbar;
      pointerStart = null;
      if (scrollbar) return;
      takeControl('browse', event, {
        kind: 'selection',
        canFollowTail: false,
        canRequestHistory: false,
      });
    };
    const onPointerEnd = () => { pointerStart = null; };
    // Capture ownership before React handlers, list callbacks, or a same-turn
    // data/size commit can observe the old following session.
    root.addEventListener('wheel', onWheel, { capture: true, passive: true });
    root.addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('scrollend', onScrollEnd, { passive: true });
    root.addEventListener('touchstart', onTouchStart, { passive: true });
    root.addEventListener('touchmove', onTouchMove, { capture: true, passive: true });
    root.addEventListener('keydown', onKey, { capture: true });
    root.addEventListener('pointerdown', onPointerDown, { passive: true });
    root.addEventListener('pointermove', onPointerMove, { passive: true });
    root.addEventListener('pointerup', onPointerEnd, { passive: true });
    root.addEventListener('pointercancel', onPointerEnd, { passive: true });
    return () => {
      root.removeEventListener('wheel', onWheel, { capture: true });
      root.removeEventListener('scroll', onScroll);
      root.removeEventListener('scrollend', onScrollEnd);
      root.removeEventListener('touchstart', onTouchStart);
      root.removeEventListener('touchmove', onTouchMove, { capture: true });
      root.removeEventListener('keydown', onKey, { capture: true });
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerup', onPointerEnd);
      root.removeEventListener('pointercancel', onPointerEnd);
    };
  }, [observe, requestTopDemand, scheduleObserve, scrollerNode, takeControl]);

  useLayoutEffect(() => {
    if (!scrollerNode) return;
    geometryRevisionRef.current += 1;
    scheduleObserve('layout');
    scheduleCoverageCheck();
    issueBottomIfCurrent('snapshot-commit');
  }, [issueBottomIfCurrent, scheduleCoverageCheck, scheduleObserve, scrollerNode, snapshot.revision]);

  useLayoutEffect(() => {
    const root = scrollerRef.current;
    if (!root || root !== scrollerNode) return undefined;
    const onInputResizePrepared = () => {
      const owner = readingRef.current;
      const current = owner.getSession?.() || owner.session;
      if (current.mode !== READING_MODE.following) return;
      geometryRevisionRef.current += 1;
      viewportAuthorizationRef.current = {
        activationID: current.activationID,
        inputEpoch: current.inputEpoch,
        geometryRevision: geometryRevisionRef.current,
        tokenID: `input-resize:${current.activationID}:${current.inputEpoch}:${geometryRevisionRef.current}`,
      };
      scheduleObserve('layout');
      issueBottomIfCurrent('viewport-layout');
    };
    root.addEventListener('atoll:input-resize-prepared', onInputResizePrepared);
    return () => root.removeEventListener('atoll:input-resize-prepared', onInputResizePrepared);
  }, [issueBottomIfCurrent, scheduleObserve, scrollerNode]);

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
      const inputResizeOwned = root.closest('.conversation-surface')
        ?.hasAttribute('data-input-resize-transition') === true;
      if (previousSize && previousSize !== nextSize
        && current.mode === READING_MODE.following
        && !inputResizeOwned) {
        viewportAuthorizationRef.current = {
          activationID: current.activationID,
          inputEpoch: current.inputEpoch,
          geometryRevision: geometryRevisionRef.current,
        };
      }
      scheduleObserve('layout');
      scheduleCoverageCheck();
      if (!inputResizeOwned) issueBottomIfCurrent('viewport-layout');
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
      owner.onReadingObservation({
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
      });
    };
  }, [reading.activationID, scrollerNode]);

  const bindScroller = useCallback((node) => {
    const candidate = node?.getScrollableNode?.() || node;
    const next = candidate && candidate.nodeType === 1 ? candidate : null;
    scrollerRef.current = next;
    setScrollerNode((current) => current === next ? current : next);
    if (next && !next.hasAttribute('tabindex')) next.tabIndex = 0;
    if (next && focusOnMount && !focusClaimedRef.current) {
      focusClaimedRef.current = true;
      next.focus?.({ preventScroll: true });
    }
  }, [focusOnMount]);

  const publishHandoffReady = useCallback((source) => {
    if (!handoffPendingRef.current || handoffReadyRef.current) return false;
    const root = scrollerRef.current;
    const owner = readingRef.current;
    const current = owner?.getSession?.() || owner?.session;
    const targetID = current?.bookmark?.messageID || '';
    const target = targetID ? presentationRowNode(root, targetID) : null;
    if (!root || root.clientHeight <= 0 || root.scrollHeight <= 0 || !target) return false;
    const targetItem = target.closest?.('[data-known-size]');
    const formalState = formalRangeStatesRef.current.get(formalRangeOwner) || null;
    if (formalState?.phase !== 'ready'
      || Number(targetItem?.dataset?.knownSize || 0) <= 0
      || root.querySelector('[data-formal-preparing]')) return false;
    // Existing browsing restore owns geometry. Readiness is only a committed
    // identity/materialization edge and never writes scroll position.
    if (delayedRestoreRef.current) return false;
    handoffReadyRef.current = true;
    const rootRect = root.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    onHandoffReady?.({
      activationID: current.activationID,
      inputEpoch: current.inputEpoch,
      targetID,
      source,
      targetViewportOffset: targetRect.top - rootRect.top,
    });
    return true;
  }, [formalRangeOwner, onHandoffReady]);

  useLayoutEffect(() => {
    publishHandoffReady('formal-range');
  }, [formalRangeRevision, publishHandoffReady]);

  const itemMeasurementKey = useCallback((index, row) => (
    rowRevision?.(index, row) || String(row.contentRevision)
  ), [rowRevision]);
  const itemContent = useCallback((index, row) => row ? (
    <MessageRow
      row={row}
      revision={itemMeasurementKey(index, row)}
      renderRow={renderRow}
      presentationState={rowPresentationState?.(row) || ''}
    />
  ) : null, [itemMeasurementKey, renderRow, rowPresentationState]);
  const keyExtractor = useCallback((_index, row) => row.id, []);
  const onFormalRangeStateChange = useCallback((state) => {
    const previous = formalRangeStatesRef.current.get(formalRangeOwner);
    if (previous?.generation === state.generation
      && previous.phase === state.phase
      && previous.reason === state.reason
      && previous.blocking === state.blocking) return;
    formalRangeStatesRef.current.set(formalRangeOwner, state);
    setFormalRangeRevision((revision) => revision + 1);
  }, [formalRangeOwner]);
  const onListCommit = useCallback(() => {
    const token = ++listCommitMicrotaskRef.current;
    queueMicrotask(() => {
      if (listCommitMicrotaskRef.current !== token) return;
      // Formal preparation and promotion can replace inert measurement rows
      // without changing the public data revision or scroll geometry. The
      // committed List is the authority that a new paintable subtree exists;
      // sample it on the normal rAF path so a short, non-scrollable list still
      // publishes exact visible identities after promotion.
      scheduleObserve('layout');
      positionDelayedBookmark('list-commit');
      publishHandoffReady('list-commit');
      issueBottomIfCurrent('list-commit');
    });
  }, [issueBottomIfCurrent, positionDelayedBookmark, publishHandoffReady, scheduleObserve]);
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
    firstItemIndex={Number(snapshot.firstItemIndex || 0)}
    computeItemKey={keyExtractor}
    computeItemMeasurementKey={itemMeasurementKey}
    formalRangeStateChange={onFormalRangeStateChange}
    itemContent={itemContent}
    initialTopMostItemIndex={initialTopMostItemIndex}
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
        reading.onPresentationMaterialized?.({
          activationID: reading.activationID,
          presentationRevision: Number(snapshot.revision || 0),
          startIndex: Number(info.startIndex),
          endIndex: Number(info.endIndex),
        });
        positionDelayedBookmark('range-materialized');
        publishHandoffReady('range-materialized');
      }
    }}
    atBottomStateChange={(atBottom) => {
      atBottomRef.current = atBottom === true;
      traceReadingAdapter('at-bottom', () => ({
        atBottom: atBottom === true,
        scrollTop: Number(scrollerRef.current?.scrollTop || 0),
        scrollHeight: Number(scrollerRef.current?.scrollHeight || 0),
        clientHeight: Number(scrollerRef.current?.clientHeight || 0),
      }));
      scheduleObserve('layout');
    }}
    atTopStateChange={(atTop) => {
      atTopRef.current = atTop === true;
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
