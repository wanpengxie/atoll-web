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

const List = React.forwardRef(function List({ children, context, ...props }, ref) {
  const revision = Number(context?.presentationRevision);
  return <div
    {...props}
    {...(Number.isFinite(revision)
      ? { 'data-reading-presentation-revision': revision }
      : {})}
    ref={ref}
  >{children}</div>;
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

const CONTENT_ANCHOR_MAX_ATTEMPTS = 4;
const FOLLOWING_TAIL_GAP_TOLERANCE_PX = 1;
const POSITION_RESTORE_MAX_ATTEMPTS = 8;
const POSITION_RESTORE_MAX_MOUNT_ATTEMPTS = 120;
const POSITION_RESTORE_STABLE_FRAMES = 6;
const POSITION_RESTORE_TOLERANCE_PX = 2;

function currentBottomIntent(session) {
  const intent = session?.bottomIntent;
  return intent?.id && Number(intent.inputEpoch) === Number(session?.inputEpoch)
    ? intent
    : null;
}

function isComposerSendIntent(intent) {
  return String(intent?.id || '').startsWith('composer:send-start:');
}

// A send-start intent is a join between the explicit user action and the
// committed destination rows. A role-only height callback must not stand in
// for that join, and an unaccepted intent (with no durable target IDs yet)
// must not consume itself against the old tail.
function composerSendTargetsCommitted(intent, rows = []) {
  if (!isComposerSendIntent(intent)) return true;
  const targets = Array.isArray(intent.targetMessageIDs)
    ? intent.targetMessageIDs.map(String).filter(Boolean)
    : [];
  return targets.length > 0
    && targets.every((targetID) => rows.some((row) => String(row?.id || '') === targetID));
}

function observationIdentity(owner, data, rootIdentity = 0) {
  const session = owner?.getSession?.() || {};
  const status = owner?.status || {};
  return Object.freeze({
    activationID: String(owner?.activationID || session.activationID || ''),
    inputEpoch: Number(session.inputEpoch || 0),
    intentRevision: Number(session.intentRevision || 0),
    presentationRevision: Number(data?.revision || 0),
    tailID: String(data?.rows?.at(-1)?.id || ''),
    generation: Number(status.generation || 0),
    authorityRevision: Number(status.notificationAuthorityRevision || 0),
    rootIdentity: Number(rootIdentity || 0),
  });
}

function sameObservationIdentity(left, right) {
  return Boolean(left && right)
    && String(left.activationID) === String(right.activationID)
    && Number(left.inputEpoch) === Number(right.inputEpoch)
    && Number(left.intentRevision) === Number(right.intentRevision)
    && Number(left.presentationRevision) === Number(right.presentationRevision)
    && String(left.tailID) === String(right.tailID)
    && Number(left.generation) === Number(right.generation)
    && Number(left.authorityRevision) === Number(right.authorityRevision)
    && Number(left.rootIdentity) === Number(right.rootIdentity);
}

function contentAnchorIdentity(command) {
  if (!command) return '';
  return [
    command.type,
    command.activationID,
    Number(command.inputEpoch),
    command.anchorID,
    Number(command.viewportOffset),
    Number(command.beforeScrollHeight),
    command.expectedExpanded == null ? 'null' : Boolean(command.expectedExpanded) ? 'expanded' : 'collapsed',
  ].join('\u001f');
}

function positionRowIdentity(command) {
  if (!command) return '';
  return [
    command.type,
    command.activationID,
    Number(command.inputEpoch),
    Number(command.intentRevision),
    command.operationID,
    command.viewID,
    command.epoch,
    Number(command.presentationRevision),
    command.messageID,
    Number(command.viewportOffset),
  ].join('\u001f');
}

function samePositionRowCommand(left, right) {
  return Boolean(left && right)
    && positionRowIdentity(left) === positionRowIdentity(right);
}

// Capture the baseline row geometry before native input moves the scroller.
// This is read-only evidence; the typed DOM executor remains the only writer.
function firstRowViewportAnchor(root, rows = []) {
  const first = rows[0];
  if (!root || !first?.id) return null;
  const rootRect = root.getBoundingClientRect?.();
  const row = [...(root.querySelectorAll?.('[data-presentation-row-id]') || [])]
    .find((node) => node.dataset?.presentationRowId === String(first.id));
  const rowRect = row?.getBoundingClientRect?.();
  const viewportOffset = rootRect && rowRect ? Number(rowRect.top) - Number(rootRect.top) : Number.NaN;
  if (!Number.isFinite(viewportOffset)) return null;
  return Object.freeze({ messageID: String(first.id), viewportOffset });
}

// Chromium delivers a passive wheel callback after the native scroll offset
// has already moved.  Reconstruct the row offset at the start of that input
// from the adapter's last painted scroll position; this keeps the semantic
// lease tied to the same physical frame that the user actually left.
function firstRowViewportAnchorBeforeWheel(root, rows = [], previousScrollTop) {
  const anchor = firstRowViewportAnchor(root, rows);
  const fallback = anchor || topVisibleBookmark(root, rows);
  const currentScrollTop = Number(root?.scrollTop);
  const previous = Number(previousScrollTop);
  if (!fallback || !Number.isFinite(currentScrollTop) || !Number.isFinite(previous)) return fallback;
  return Object.freeze({
    ...fallback,
    viewportOffset: Number(fallback.viewportOffset) + (currentScrollTop - previous),
  });
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
  const rootIdentityRef = useRef({ node: null, generation: 0 });
  const [rootNode, setRootNode] = useState(null);
  const [rootIdentity, setRootIdentity] = useState(0);
  const [anchorRetentionExtent, setAnchorRetentionExtent] = useState(0);
  const geometryRevisionRef = useRef(0);
  const observationFrameRef = useRef(0);
  const observationRequestRef = useRef(null);
  // A delayed content-anchor restore is a typed command transaction, not a
  // bare timer. Keep its identity and frame token together so a stale RAF can
  // never consume or execute a later fold command from the same activation.
  const contentAnchorFrameRef = useRef(null);
  const contentAnchorRetryRef = useRef(null);
  // A Virtuoso height callback can precede the root's published geometry by
  // one microtask. Keep only the latest bounded recheck; the root/session
  // identity fence prevents a late callback from writing after takeover or
  // remount.
  const followingHeightRetryRef = useRef(null);
  // Virtuoso may publish its first measured extent after the initial
  // position-row command. Keep that one typed command alive until the actual
  // painted row reaches its semantic offset; otherwise the first layout
  // observation can mistake the preceding one-pixel sliver for the anchor.
  const positionRestoreRef = useRef(null);
  const lastScrollTopRef = useRef(0);
  const consumedCommandRef = useRef('');
  // A history lease is terminal after its actual-paint fence succeeds or
  // fails. Keep that outcome for the current input epoch so the ordinary
  // bookmark path cannot replay a second position-row command in the same
  // transaction.
  const settledPositionLeaseRef = useRef(null);
  const touchRef = useRef(null);
  // Virtuoso can publish a committed range before Reading has attached the
  // current history admission or bottom proof. Keep that physical coverage
  // fact in the sole adapter and replay it once when the owner becomes ready;
  // dropping it here would strand an under-filled viewport with no new range
  // callback to wake the history consumer.
  const coverageEvidenceRef = useRef(null);
  const coverageSourceKeyRef = useRef('');
  const coveragePublishedKeyRef = useRef('');
  const readingController = useBrowsingReadingController({ reading, snapshot, rootNode, rootIdentity });
  const { navigationPolicy, reportDomEvidence } = readingController;
  const readingRef = useRef(reading);
  const snapshotRef = useRef(snapshot);
  // Virtuoso retains the callback from the render that installed it. A late
  // height notification must not resolve through readingRef into a successor
  // activation or history generation; that would let an old owner write a
  // new viewport. The callback fence below captures this owner tuple and the
  // physical root that was mounted for that render. A same-activation
  // remount must not let the old callback resolve through rootRef.current into
  // its successor root.
  const callbackActivationID = String(reading.activationID || reading.session?.activationID || '');
  const callbackGeneration = Number(reading.status?.generation || 0);
  const callbackRoot = rootNode;
  const bindScroller = useCallback((node) => {
    // Virtuoso invokes scrollerRef(null) during its internal effect churn as
    // well as on a real unmount. Do not turn that transient callback into a
    // state toggle: the next concrete root callback is the replacement fence,
    // while the existing RAF/event cleanup already retires the old root.
    if (!node) {
      rootRef.current = null;
      return;
    }
    if (rootIdentityRef.current.node !== node) {
      const generation = rootIdentityRef.current.generation + 1;
      rootIdentityRef.current = {
        node,
        generation,
      };
      setRootIdentity(node ? generation : 0);
    }
    rootRef.current = node;
    setRootNode((current) => current === node ? current : node);
  }, []);
  const currentRootIdentity = useCallback((node) => (
    rootIdentityRef.current.node === node ? rootIdentityRef.current.generation : 0
  ), []);
  const listContext = useMemo(() => ({
    historyStartBoundary,
    presentationRevision: Number(snapshot.revision || 0),
  }), [historyStartBoundary, snapshot.revision]);

  useLayoutEffect(() => {
    readingRef.current = reading;
    snapshotRef.current = snapshot;
  }, [reading, snapshot]);

  const publishCoverageEvidence = useCallback((evidence) => {
    const owner = readingRef.current;
    const data = snapshotRef.current;
    if (!evidence || !owner || !data
      || evidence.root !== rootRef.current
      || evidence.activationID !== owner.activationID
      || Number(evidence.presentationRevision) !== Number(data.revision || 0)) return false;
    // Range callbacks can oscillate while Virtuoso measures the same
    // presentation (for example full-range -> visible-window -> full-range).
    // The physical admission is one per mounted root/presentation/viewport;
    // using the transient range or scrollHeight here would re-demand the same
    // under-filled viewport after a history completion.
    const sourceKey = [
      evidence.activationID,
      evidence.presentationRevision,
      evidence.clientHeight,
    ].join(':');
    if (coveragePublishedKeyRef.current === sourceKey) return false;
    const accepted = reportDomEvidence(evidence) === true;
    if (accepted) coveragePublishedKeyRef.current = sourceKey;
    return accepted;
  }, [reportDomEvidence]);

  useLayoutEffect(() => {
    // Re-run the latest typed range only after the physical root and Reading
    // readiness facts have committed. publishCoverageEvidence has its own
    // source/identity fence and therefore cannot replay a retired root.
    publishCoverageEvidence(coverageEvidenceRef.current);
  }, [
    publishCoverageEvidence,
    reading.activationID,
    reading.bottomReady,
    reading.status?.attached,
    reading.status?.completedPages,
    reading.status?.generation,
    reading.status?.hasOlder,
    reading.status?.messageCurrent,
    reading.status?.revealVersion,
    rootNode,
    snapshot.revision,
    snapshot.rows.length,
  ]);

  const observe = useCallback((source = 'layout', request = null) => {
    const root = rootRef.current;
    const owner = readingRef.current;
    const data = snapshotRef.current;
    if (!root || !surfaceVisible) return false;
    const currentSession = owner.getSession();
    const currentIdentity = observationIdentity(owner, data, currentRootIdentity(root));
    const fence = request?.fence || null;
    const fenceCurrent = !fence || sameObservationIdentity(fence, currentIdentity);
    const requiresTail = request?.requiresTail === true;
    const pendingPosition = positionRestoreRef.current;
    const suppressBookmark = source === 'layout'
      && pendingPosition?.activationID === owner.activationID
      && Number(pendingPosition.inputEpoch) === Number(currentSession.inputEpoch)
      && pendingPosition.settled !== true;
    const visibleRows = visibleRowEvidence(root, data.rows);
    const visibleRowIDs = Object.freeze(visibleRows.map((row) => row.messageID));
    const atTail = root.scrollHeight - root.clientHeight - root.scrollTop <= 24;
    const currentRowIDs = new Set(data.rows.map((row) => String(row.id)));
    const currentVisibleRowIDs = visibleRowIDs.filter((id) => currentRowIDs.has(String(id)));
    const domRevisionNode = root.matches?.('[data-reading-presentation-revision]')
      ? root
      : root.querySelector?.('[data-reading-presentation-revision]');
    const domPresentationRevision = Number(
      domRevisionNode?.getAttribute?.('data-reading-presentation-revision'),
    );
    const presentationAligned = Number.isFinite(domPresentationRevision)
      && domPresentationRevision === currentIdentity.presentationRevision;
    // A settled receipt is an actual-paint fence, not a boolean carried over
    // from an earlier RAF. It is consumable only when the request identity is
    // still current, the DOM advertises the same Presentation revision, and
    // at least one current row was hit-tested in the viewport. Following/cold
    // receipts additionally require the current tail to be present at the
    // physical tail; stale rows from the previous snapshot never qualify.
    const tailVisible = !requiresTail
      || (currentIdentity.tailID && currentVisibleRowIDs.includes(currentIdentity.tailID));
    const settledReceipt = Boolean(
      fence
      && fenceCurrent
      && presentationAligned
      && currentVisibleRowIDs.length > 0
      && (!requiresTail || (atTail && tailVisible)),
    );
    const accepted = reportDomEvidence(Object.freeze({
      type: 'reading-observation',
      activationID: owner.activationID,
      bookmark: suppressBookmark ? null : topVisibleBookmark(root, data.rows),
      atTail,
      surfaceVisible: isReadingSurfaceVisible(root),
      installedHighSeq: installedHighSeq(root, data.rows),
      visibleRows,
      visibleRowIDs,
      source,
      settled: settledReceipt,
      inputEpoch: currentSession.inputEpoch,
      presentationRevision: currentIdentity.presentationRevision,
      domPresentationRevision,
      observationIdentity: currentIdentity,
      rootIdentity: currentIdentity.rootIdentity,
      rootNode: root,
      tailID: currentIdentity.tailID,
      geometryRevision: geometryRevisionRef.current,
    })) === true;
    return accepted && (!fence || settledReceipt);
  }, [currentRootIdentity, reportDomEvidence, surfaceVisible]);

  const scheduleObserve = useCallback((source = 'layout', settled = false) => {
    const owner = readingRef.current;
    const data = snapshotRef.current;
    const currentIdentity = observationIdentity(owner, data, currentRootIdentity(rootRef.current));
    const currentSession = owner?.getSession?.() || {};
    const pending = observationRequestRef.current;
    const pendingFence = pending?.fence || null;
    const requested = settled === true;
    const requestSource = requested && source === 'layout' ? 'settled' : source;
    let nextRequest;
    if (requested) {
      nextRequest = {
        source: requestSource,
        fence: currentIdentity,
        requiresTail: currentSession.mode === READING_MODE.following,
      };
    } else if (pendingFence) {
      // Ordinary range/mutation samples may coalesce this RAF, but they may
      // neither consume nor downgrade a pending settled fence. If the owner
      // advanced, rebind the fence to the current identity before sampling;
      // the old activation/input/revision can never settle.
      nextRequest = {
        source: pending.source,
        fence: sameObservationIdentity(pendingFence, currentIdentity)
          ? pendingFence
          : currentIdentity,
        requiresTail: currentSession.mode === READING_MODE.following,
      };
    } else {
      nextRequest = { source, fence: null, requiresTail: false };
    }
    observationRequestRef.current = nextRequest;
    if (observationFrameRef.current) globalThis.cancelAnimationFrame?.(observationFrameRef.current);
    observationFrameRef.current = globalThis.requestAnimationFrame?.(() => {
      observationFrameRef.current = 0;
      const request = observationRequestRef.current;
      observationRequestRef.current = null;
      const accepted = observe(request?.source || source, request);
      if (request?.fence && accepted === false) {
        // Retry with a fresh identity. This is a transient paint miss, not a
        // license to publish the stale request as settled.
        scheduleObserve(request.source, true);
      }
    }) || 0;
  }, [currentRootIdentity, observe]);

  const coordinator = useMemo(() => createReadingNavigationCoordinator({
    activationID: reading.activationID,
    // Chromium emits one native scrollend per discrete wheel tick, while a
    // real wheel burst can take a couple of frames to deliver its next tick
    // through React/Virtuoso. Keep the semantic transaction alive across
    // that delivery gap; a longer genuinely quiet interval still ends it
    // through the coordinator's bounded deadline.
    quietMs: { wheel: 300 },
    onBegin(transaction) {
      const result = readingRef.current.beginNavigation({
        direction: transaction.direction,
        gestureID: transaction.id,
        geometryRevision: geometryRevisionRef.current,
        historyAnchor: transaction.direction === 'older' ? transaction.startedBookmark : null,
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
    const intent = currentBottomIntent(current);
    const input = navigationPolicy.currentInput();
    if (!root
      || current.mode !== READING_MODE.following
      // A composer send owns the first committed destination join. Until its
      // typed intent is consumed, a role-only/list-height callback is not an
      // independent tail authorization.
      || (intent && isComposerSendIntent(intent))
      // A newer-direction native gesture that has already reached the physical
      // tail is the same reading intent as following. Keep that intent alive if
      // an append lands before the coordinator's quiet deadline; older input
      // still revokes the writer immediately.
      || (input.active && input.direction !== 'newer')
      // The 24px gesture threshold is only semantic at-tail evidence.  A
      // committed size change can leave a following list 22px short while no
      // native input is active; treating that as settled strands the list
      // until a later append and moves visible rows down.  The writer owns
      // only the residual post-layout gap, so leave sub-pixel rounding alone
      // but close every real extent delta here.
      || root.scrollHeight - root.clientHeight - root.scrollTop <= FOLLOWING_TAIL_GAP_TOLERANCE_PX) return false;
    const executed = executeReadingDOMCommand(
      Object.freeze({ type: 'scroll-tail' }),
      { virtuoso: virtuosoRef.current, root },
    );
    if (executed) scheduleObserve(source, true);
    return executed;
  }, [navigationPolicy, scheduleObserve]);

  const issueBottomIntent = useCallback(() => {
    const root = rootRef.current;
    const owner = readingRef.current;
    const data = snapshotRef.current;
    const current = owner?.getSession?.();
    const intent = currentBottomIntent(current);
    if (!root || !current || current.mode !== READING_MODE.following || !data?.rows?.length || !intent
      || (isComposerSendIntent(intent) && !composerSendTargetsCommitted(intent, data.rows))
      || Number(root.clientHeight) <= 0 || Number(root.scrollHeight) <= 0) return false;
    const key = `tail:${current.activationID}:${intent.id}`;
    if (consumedCommandRef.current === key) return false;
    const atTail = Number(root.scrollHeight) - Number(root.clientHeight) - Number(root.scrollTop) <= FOLLOWING_TAIL_GAP_TOLERANCE_PX;
    // A send-start join still needs its committed target-height fence even if
    // the old root happens to be at the physical tail. Explicit latest has no
    // destination join and can be consumed as a no-op here.
    if (atTail && !isComposerSendIntent(intent)) {
      consumedCommandRef.current = key;
      owner.consumeBottomIntent(intent);
      scheduleObserve('layout', true);
      return true;
    }
    const executed = executeReadingDOMCommand(
      Object.freeze({ type: 'scroll-tail' }),
      { virtuoso: virtuosoRef.current, root },
    );
    if (!executed) return false;
    consumedCommandRef.current = key;
    owner.consumeBottomIntent(intent);
    scheduleObserve('layout', true);
    return true;
  }, [scheduleObserve]);

  const scheduleFollowingHeightRetry = useCallback(() => {
    const owner = readingRef.current;
    const current = owner?.getSession?.();
    const root = rootRef.current;
    if (!current || !root || typeof globalThis.queueMicrotask !== 'function') return;
    const token = Object.freeze({
      activationID: String(current.activationID || owner.activationID || ''),
      inputEpoch: Number(current.inputEpoch || 0),
      intentRevision: Number(current.intentRevision || 0),
      root,
    });
    followingHeightRetryRef.current = token;
    globalThis.queueMicrotask(() => {
      if (followingHeightRetryRef.current !== token) return;
      followingHeightRetryRef.current = null;
      const liveOwner = readingRef.current;
      const live = liveOwner?.getSession?.();
      if (!live || rootRef.current !== token.root
        || String(live.activationID || liveOwner.activationID || '') !== token.activationID
        || Number(live.inputEpoch || 0) !== token.inputEpoch
        || Number(live.intentRevision || 0) !== token.intentRevision) return;
      if (issueBottomIntent()) return;
      enforceFollowingTail('layout-commit');
    });
  }, [enforceFollowingTail, issueBottomIntent]);

  const restoreContentAnchor = useCallback((source = 'layout') => {
    const root = rootRef.current;
    const owner = readingRef.current;
    const command = owner.contentAnchorCommand?.();
    if (!root || !command) {
      if (command) owner.consumeContentAnchor?.(command);
      return false;
    }
    const key = contentAnchorIdentity(command);
    const token = Object.freeze({
      key,
      activationID: String(command.activationID || ''),
      inputEpoch: Number(command.inputEpoch),
    });
    const pending = contentAnchorFrameRef.current;
    if (pending && pending.key !== token.key) {
      globalThis.cancelAnimationFrame?.(pending.frameID);
      contentAnchorFrameRef.current = null;
    }
    if (contentAnchorRetryRef.current?.key !== token.key) {
      contentAnchorRetryRef.current = { key: token.key, attempts: 0 };
    }
    if (command.expectedExpanded != null) {
      const extentDelta = Math.abs(Number(root.scrollHeight) - Number(command.beforeScrollHeight));
      setAnchorRetentionExtent((current) => Math.max(current, 2200, extentDelta + 1200));
    }
    const currentForToken = () => {
      const currentRoot = rootRef.current;
      const currentOwner = readingRef.current;
      const currentCommand = currentOwner.contentAnchorCommand?.();
      const currentSession = currentOwner.getSession?.();
      const currentKey = contentAnchorIdentity(currentCommand);
      const current = currentCommand
        && currentKey === token.key
        && String(currentSession?.activationID || currentOwner.activationID || '') === token.activationID
        && Number(currentSession?.inputEpoch) === token.inputEpoch
        ? { root: currentRoot, owner: currentOwner, command: currentCommand }
        : null;
      return current;
    };

    const clearForToken = () => {
      if (contentAnchorRetryRef.current?.key === token.key) contentAnchorRetryRef.current = null;
      if (contentAnchorFrameRef.current?.key === token.key) contentAnchorFrameRef.current = null;
      setAnchorRetentionExtent(0);
    };

    const terminal = (current) => {
      // Consume only the command captured by this token. If input or another
      // fold replaced it, the identity check above prevents a stale callback
      // from consuming the replacement command.
      if (current) current.owner.consumeContentAnchor?.(current.command);
      clearForToken();
      return false;
    };

    let attempt;

    const queue = (frames = 1) => {
      if (contentAnchorFrameRef.current?.key === token.key) return false;
      const frame = { key: token.key, frameID: 0, remaining: Math.max(1, frames) };
      const run = () => {
        if (contentAnchorFrameRef.current !== frame) return;
        const current = currentForToken();
        if (!current) {
          // The command was revoked/replaced by a newer input or semantic
          // choice. Do not touch the newer command or its retention window.
          contentAnchorFrameRef.current = null;
          return;
        }
        if (frame.remaining > 1) {
          frame.remaining -= 1;
          frame.frameID = globalThis.requestAnimationFrame?.(run) || 0;
          if (!frame.frameID) {
            contentAnchorFrameRef.current = null;
            attempt(current);
          }
          return;
        }
        contentAnchorFrameRef.current = null;
        attempt(current);
      };
      contentAnchorFrameRef.current = frame;
      frame.frameID = globalThis.requestAnimationFrame?.(run) || 0;
      if (!frame.frameID) {
        contentAnchorFrameRef.current = null;
        const current = currentForToken();
        if (current) attempt(current);
      }
      return true;
    };

    const retryOrTerminate = (current) => {
      const retry = contentAnchorRetryRef.current?.key === token.key
        ? contentAnchorRetryRef.current
        : { key: token.key, attempts: 0 };
      retry.attempts += 1;
      contentAnchorRetryRef.current = retry;
      if (retry.attempts >= CONTENT_ANCHOR_MAX_ATTEMPTS) return terminal(current);
      queue(1);
      return false;
    };

    attempt = (current) => {
      const live = currentForToken();
      if (!live) return false;
      const currentRoot = live.root;
      if (!currentRoot) return terminal(live);
      const currentHeight = Number(currentRoot.scrollHeight);
      // These are transient pre-paint states: React/Virtuoso has not committed
      // the new extent or the row is not yet mounted. Keep the exact command
      // pending behind a bounded retry fence.
      if (!Number.isFinite(currentHeight)
        || Math.abs(currentHeight - Number(live.command.beforeScrollHeight)) <= 0.5) {
        return retryOrTerminate(live);
      }
      const anchor = [...currentRoot.querySelectorAll('[data-fold-id]')]
        .find((node) => node.getAttribute('data-fold-id') === String(live.command.anchorID));
      if (!anchor || (live.command.expectedExpanded != null
        && anchor.getAttribute('aria-expanded') !== String(Boolean(live.command.expectedExpanded)))) {
        return retryOrTerminate(live);
      }
      const executed = executeReadingDOMCommand(live.command, {
        virtuoso: virtuosoRef.current, root: currentRoot,
      });
      if (!executed) return retryOrTerminate(live);
      live.owner.consumeContentAnchor?.(live.command);
      if (contentAnchorRetryRef.current?.key === token.key) contentAnchorRetryRef.current = null;
      if (live.command.expectedExpanded !== true) setAnchorRetentionExtent(0);
      if (contentAnchorFrameRef.current?.key === token.key) contentAnchorFrameRef.current = null;
      scheduleObserve(source, true);
      return true;
    };

    // Collapse is attempted immediately so a same-transaction measurement can
    // be corrected before paint. Expansion gets two frames for the vendor's
    // measured extent; both paths use the same identity fence and retry logic.
    if (command.expectedExpanded === false) {
      const executed = attempt({ root, owner, command });
      if (!executed && currentForToken()) queue(1);
      return executed;
    }

    if (contentAnchorFrameRef.current?.key === token.key) return false;
    queue(2);
    return false;
  }, [scheduleObserve]);

  const restoreReadingPosition = useCallback((command, key) => {
    const previous = positionRestoreRef.current;
    if (previous?.key === key) return false;
    if (previous?.frameID) globalThis.cancelAnimationFrame?.(previous.frameID);
    positionRestoreRef.current = null;
    const token = {
      key,
      activationID: String(command.activationID || ''),
      inputEpoch: Number(command.inputEpoch),
      intentRevision: Number(command.intentRevision),
      operationID: String(command.operationID || ''),
      viewID: String(command.viewID || ''),
      epoch: String(command.epoch || ''),
      presentationRevision: Number(command.presentationRevision || 0),
      messageID: String(command.messageID || ''),
      viewportOffset: Number.isFinite(Number(command.viewportOffset))
        ? Number(command.viewportOffset)
        : Number.NaN,
      attempts: 0,
      mountAttempts: 0,
      stableFrames: 0,
      frameID: 0,
      settled: false,
    };
    positionRestoreRef.current = token;

    const clear = () => {
      if (token.frameID) globalThis.cancelAnimationFrame?.(token.frameID);
      if (positionRestoreRef.current === token) positionRestoreRef.current = null;
    };
    const markTerminal = (owner, session) => {
      if (!token.operationID) return;
      settledPositionLeaseRef.current = {
        activationID: token.activationID,
        inputEpoch: token.inputEpoch,
        operationID: token.operationID,
        succeeded: false,
      };
      // The command may have lost its owner between frames. The model-side
      // identity fence makes this a no-op for a newer lease, while ensuring a
      // stale accepted lease can never leave the scheduler waiting forever.
      owner?.revokeHistoryPositionLease?.(command, { clearHistoryAnchor: true });
    };
    const transient = Object.freeze({ pending: true });
    const live = () => {
      const owner = readingRef.current;
      const session = owner.getSession?.();
      const currentSnapshot = snapshotRef.current;
      const currentInput = navigationPolicy.currentInput?.();
      if (!session) return null;
      if (token.operationID && !samePositionRowCommand(session.positionRowLease, command)) {
        markTerminal(owner, session);
        return null;
      }
      if (owner.activationID !== token.activationID
        || session.activationID !== token.activationID
        || Number(session.inputEpoch) !== token.inputEpoch
        || session.mode !== READING_MODE.browsing
        || Number(currentSnapshot.revision || 0) !== token.presentationRevision) {
        markTerminal(owner, session);
        return null;
      }
      if (token.operationID) {
        const currentLease = owner.historyPositionLeaseCommand?.();
        if (!samePositionRowCommand(currentLease, command)) {
          markTerminal(owner, session);
          return null;
        }
      }
      // Native input owns the viewport while the exact lease remains valid.
      // Keep the lease pending for a later frame; a new input normally clears
      // it synchronously through ReadingSession and is handled above.
      if (currentInput?.active) return transient;
      const root = rootRef.current;
      if (!root) {
        markTerminal(owner, session);
        return null;
      }
      return { owner, session, root, snapshot: currentSnapshot };
    };
    const finish = (current, succeeded) => {
      const owner = current?.owner || readingRef.current;
      let actualSuccess = succeeded;
      // A successful target restore must also hand the newly painted first row
      // back to Reading. Without this evidence a continuation would carry the
      // pre-prepend anchor and could issue an unbound top request.
      const nextAnchor = actualSuccess && current && command.operationID
        ? firstRowViewportAnchor(current.root, current.snapshot.rows)
        : null;
      if (actualSuccess && command.operationID && !nextAnchor) actualSuccess = false;
      token.settled = actualSuccess;
      clear();
      // A bounded retry fence is terminal even when the target never reaches
      // its captured offset. Do not publish a `settled` observation for a
      // failed restore; the next activation/presentation revision may issue a
      // fresh typed command instead.
      if (command.operationID) {
        settledPositionLeaseRef.current = {
          activationID: token.activationID,
          inputEpoch: token.inputEpoch,
          operationID: command.operationID,
          succeeded: actualSuccess,
        };
        if (actualSuccess) {
          const consumed = owner?.consumeHistoryPositionLease?.(command, nextAnchor);
          if (consumed !== true) {
            owner?.revokeHistoryPositionLease?.(command, { clearHistoryAnchor: true });
          }
        } else owner?.revokeHistoryPositionLease?.(command, { clearHistoryAnchor: true });
      }
      if (actualSuccess && current) scheduleObserve('layout', true);
    };
    const queue = () => {
      if (positionRestoreRef.current !== token || token.frameID) return;
      const run = () => {
        token.frameID = 0;
        if (positionRestoreRef.current !== token) return;
        const current = live();
        if (current === transient) {
          queue();
          return;
        }
        if (!current) {
          markTerminal(readingRef.current, readingRef.current.getSession?.());
          clear();
          return;
        }
        const target = [...current.root.querySelectorAll('[data-presentation-row-id]')]
          .find((node) => node.dataset.presentationRowId === token.messageID);
        const targetInSnapshot = current.snapshot.rows.some((row) => row.id === token.messageID);
        if (!targetInSnapshot) {
          // The semantic anchor is permanently absent from this committed
          // presentation. Do not let an old restore survive a source change.
          finish(current, false);
          return;
        }
        if (!target) {
          // Virtuoso can take several paints to materialize the requested
          // range. This is transient while the target still exists in the
          // committed rows, so retain the identity fence and keep waiting.
          token.mountAttempts += 1;
          if (token.mountAttempts >= POSITION_RESTORE_MAX_MOUNT_ATTEMPTS) {
            finish(current, false);
            return;
          }
          queue();
          return;
        }
        const rootRect = current.root.getBoundingClientRect?.();
        const targetRect = target?.getBoundingClientRect?.();
        const targetOffset = rootRect && targetRect
          ? targetRect.top - rootRect.top
          : Number.NaN;
        const settled = !Number.isFinite(token.viewportOffset)
          || (Number.isFinite(targetOffset)
            && Math.abs(targetOffset - token.viewportOffset) <= POSITION_RESTORE_TOLERANCE_PX);
        if (settled) {
          token.stableFrames += 1;
          if (token.stableFrames >= POSITION_RESTORE_STABLE_FRAMES) {
            finish(current, true);
            return;
          }
          queue();
          return;
        }
        token.stableFrames = 0;
        if (token.attempts >= POSITION_RESTORE_MAX_ATTEMPTS) {
          finish(current, false);
          return;
        }
        token.attempts += 1;
        const executed = executeReadingDOMCommand(command, {
          virtuoso: virtuosoRef.current, root: current.root,
        });
        if (!executed && token.attempts >= POSITION_RESTORE_MAX_ATTEMPTS) {
          finish(current, false);
          return;
        }
        queue();
      };
      token.frameID = globalThis.requestAnimationFrame?.(run) || 0;
      if (!token.frameID) run();
    };

    const current = live();
    if (current === transient) {
      queue();
      return true;
    }
    if (!current) {
      markTerminal(readingRef.current, readingRef.current.getSession?.());
      clear();
      return false;
    }
    if (!executeReadingDOMCommand(command, {
      virtuoso: virtuosoRef.current, root: current.root,
    })) {
      finish(current, false);
      return false;
    }
    queue();
    return true;
  }, [navigationPolicy, scheduleObserve]);

  // Native input is the synchronous takeover boundary.  Clearing the model
  // lease in `takeReadingControl` is necessary but not sufficient: an exact
  // position command may already have a RAF queued in this adapter.  Revoke
  // that queued work before the coordinator mints the new input epoch, so a
  // wheel/key/touch event cannot be followed by the old typed writer.
  const cancelPendingPositionRestore = useCallback(() => {
    const pending = positionRestoreRef.current;
    if (pending?.frameID) globalThis.cancelAnimationFrame?.(pending.frameID);
    positionRestoreRef.current = null;
    const owner = readingRef.current;
    const lease = owner?.getSession?.().positionRowLease;
    if (lease) owner.revokeHistoryPositionLease?.(lease);
  }, []);

  useLayoutEffect(() => {
    if (!rootNode || typeof globalThis.MutationObserver !== 'function') return undefined;
    // Virtuoso commits its measured spacer in a DOM mutation before paint.
    // Consume the already-owned following intent at that boundary, rather
    // than waiting for the vendor's next-frame followOutput callback.
    const observer = new globalThis.MutationObserver(() => {
      restoreContentAnchor('layout');
      enforceFollowingTail('layout');
      // A row can be committed by Virtuoso after its range/height callback;
      // sample the actual painted DOM on the next frame so Reading receives
      // the exact visible-row IDs, including a live row newer than the
      // snapshot ref captured by the callback.
      scheduleObserve('layout');
    });
    observer.observe(rootNode, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'aria-expanded'],
    });
    return () => observer.disconnect();
  }, [enforceFollowingTail, restoreContentAnchor, rootNode, scheduleObserve]);

  // Cold hydration has no imperative scroll command to acknowledge. Once the
  // first following presentation is actually mounted, publish one settled
  // paint fence so downstream readers can distinguish readable DOM from the
  // pre-hydration empty surface. A pending exact history lease remains owned
  // by its position-row fence and is deliberately excluded here.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const current = reading.getSession();
    if (!root || !snapshot.rows.length || current.mode !== READING_MODE.following
      || current.positionRowLease || positionRestoreRef.current) return;
    scheduleObserve('layout', true);
  }, [reading, rootNode, scheduleObserve, snapshot.revision, snapshot.rows.length]);

  useEffect(() => {
    const root = rootNode;
    if (!root) return undefined;
    // The first wheel callback may follow the initial browser scroll event;
    // seed the reconstruction baseline before registering user input.
    lastScrollTopRef.current = Number(root.scrollTop || 0);
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
      cancelPendingPositionRestore();
      coordinator.recordInput({
        ...host,
        source: 'wheel',
        direction,
        bookmark: direction === 'older'
          ? firstRowViewportAnchorBeforeWheel(root, snapshotRef.current.rows, lastScrollTopRef.current)
          : null,
      });
      const input = navigationPolicy.currentInput();
      // A wheel at an already-clamped tail emits no scroll event. Publish the
      // same physical-tail evidence here so the input cannot transiently demote
      // an otherwise-following session to browsing before a live append lands.
      if (input.active && input.direction === 'newer' && atTail) {
        observe('user', {
          fence: observationIdentity(readingRef.current, snapshotRef.current, currentRootIdentity(root)),
          requiresTail: true,
        });
      }
    };
    const keydown = (event) => {
      const direction = directionFromKey(event.key);
      if (!direction) return;
      cancelPendingPositionRestore();
      coordinator.recordInput({
        ...host,
        source: 'key',
        sourceID: event.key,
        direction,
        bookmark: direction === 'older' ? firstRowViewportAnchor(root, snapshotRef.current.rows) : null,
      });
      coordinator.endContact({ ...host, source: 'key', sourceID: event.key });
    };
    const touchstart = (event) => {
      const touch = event.touches?.[0];
      if (!touch) return;
      cancelPendingPositionRestore();
      touchRef.current = { id: touch.identifier, y: touch.clientY };
      coordinator.beginPotential({
        ...host,
        source: 'touch',
        sourceID: touch.identifier,
        direction: 'browse',
        bookmark: firstRowViewportAnchor(root, snapshotRef.current.rows),
      });
    };
    const touchmove = (event) => {
      const current = touchRef.current;
      const touch = [...(event.touches || [])].find((item) => item.identifier === current?.id);
      if (!current || !touch || Math.abs(touch.clientY - current.y) < 2) return;
      const direction = touch.clientY > current.y ? 'older' : 'newer';
      current.y = touch.clientY;
      cancelPendingPositionRestore();
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
    const scrollend = () => {
      const transaction = coordinator.getSnapshot().transaction;
      // Chromium emits `scrollend` after each discrete wheel tick, even while
      // the user is still producing one physical wheel burst. Ending the
      // coordinator here would mint a new gesture on the next tick and make
      // the accepted history lease recapture the already-clamped +35px row
      // instead of the -394px anchor the burst started from. Wheel input is
      // already bounded by the coordinator's quiet deadline; native scrollend
      // remains an early completion signal for touch/other contacts only.
      if (transaction?.source === 'wheel') {
        // Keep the actual-paint receipt even though this native event is not
        // allowed to terminate the physical wheel transaction.
        const current = readingRef.current.getSession?.();
        const source = Number(transaction.inputGeneration) === Number(current?.inputEpoch)
          ? 'user' : 'settled';
        scheduleObserve(source, true);
        return;
      }
      if (!transaction) {
        // A layout-driven scroll can still emit a native scrollend after the
        // coordinator has no user transaction. Publish only its paint fence;
        // it must not manufacture user authority.
        scheduleObserve('settled', true);
        return;
      }
      coordinator.recordScrollEnd(host);
    };
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
  }, [cancelPendingPositionRestore, coordinator, currentRootIdentity, navigationPolicy, observe, reading.activationID, reportDomEvidence, rootNode, scheduleObserve]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const current = reading.getSession();
    if (!root || !snapshot.rows.length) return;
    restoreContentAnchor('layout');
    const intent = current.bottomIntent;
    if (intent.id && intent.inputEpoch === current.inputEpoch) {
      issueBottomIntent();
      return;
    }
    if (current.mode === READING_MODE.following) {
      enforceFollowingTail('layout');
      return;
    }
    if (current.mode !== READING_MODE.browsing) return;
    // An accepted history prepend carries one exact row-local geometry lease.
    // It has priority over the ordinary semantic bookmark and is consumed
    // only by the actual painted offset fence in restoreReadingPosition.
    const pendingPositionLease = current.positionRowLease;
    const positionLease = reading.historyPositionLeaseCommand?.();
    if (!positionLease && pendingPositionLease) {
      settledPositionLeaseRef.current = {
        activationID: current.activationID,
        inputEpoch: current.inputEpoch,
        operationID: pendingPositionLease.operationID,
        succeeded: false,
      };
      return;
    }
    if (positionLease) {
      if (navigationPolicy.currentInput().active) return;
      const resolvedLease = snapshot.rows.findIndex((row) => row.id === positionLease.messageID);
      if (resolvedLease < 0) {
        settledPositionLeaseRef.current = {
          activationID: current.activationID,
          inputEpoch: current.inputEpoch,
          operationID: positionLease.operationID,
          succeeded: false,
        };
        reading.revokeHistoryPositionLease?.(positionLease, { clearHistoryAnchor: true });
        return;
      }
      const key = `lease:${positionRowIdentity(positionLease)}`;
      if (consumedCommandRef.current === key) return;
      const command = Object.freeze({ ...positionLease, index: resolvedLease });
      if (restoreReadingPosition(command, key)) {
        consumedCommandRef.current = key;
        scheduleObserve('layout');
      }
      return;
    }
    const settledPosition = settledPositionLeaseRef.current;
    if (settledPosition
      && settledPosition.activationID === current.activationID
      && Number(settledPosition.inputEpoch) === Number(current.inputEpoch)) return;
    if (settledPosition) settledPositionLeaseRef.current = null;
    // The current input epoch already owns the native viewport.  Its
    // historyAnchor/tailEvidence are the semantic handoff for that motion,
    // not invitations to replay the ordinary bookmark command after the
    // coordinator's quiet deadline. Replaying here is the late `scrollTo`
    // that can pull a wheel takeover back to its pre-input offset; only an
    // accepted position-row lease may write during this transaction.
    if (current.historyAnchor
      || current.tailEvidence?.inputEpoch === current.inputEpoch) return;
    if (!current.bookmark) return;
    // Native navigation owns the viewport for the lifetime of its input
    // transaction. The bookmark recorded from that same motion is evidence,
    // not a request to replay a position command back into the list.
    if (navigationPolicy.currentInput().active) return;
    const resolved = resolveReadingBookmark(snapshot.rows, current.bookmark);
    if (!resolved) return;
    const key = `row:${current.activationID}:${current.inputEpoch}:${snapshot.revision}:${resolved.messageID}`;
    if (consumedCommandRef.current === key) return;
    const command = Object.freeze({
      type: 'position-row',
      activationID: current.activationID,
      inputEpoch: current.inputEpoch,
      presentationRevision: snapshot.revision,
      messageID: resolved.messageID,
      // Virtuoso's imperative location is data-local even when firstItemIndex
      // gives rendered rows a large logical origin for prepend stability.
      index: resolved.index,
      viewportOffset: resolved.rowViewportOffset,
    });
    if (restoreReadingPosition(command, key)) {
      consumedCommandRef.current = key;
      scheduleObserve('layout');
    }
  }, [enforceFollowingTail, issueBottomIntent, navigationPolicy, reading, restoreContentAnchor, restoreReadingPosition, scheduleObserve, snapshot]);

  useLayoutEffect(() => {
    if (focusOnMount && rootNode) executeReadingDOMCommand({ type: 'claim-focus' }, { root: rootNode });
  }, [focusOnMount, rootNode]);

  useEffect(() => () => {
    if (observationFrameRef.current) globalThis.cancelAnimationFrame?.(observationFrameRef.current);
    observationRequestRef.current = null;
    if (contentAnchorFrameRef.current?.frameID) {
      globalThis.cancelAnimationFrame?.(contentAnchorFrameRef.current.frameID);
    }
    contentAnchorFrameRef.current = null;
    contentAnchorRetryRef.current = null;
    if (positionRestoreRef.current?.frameID) {
      globalThis.cancelAnimationFrame?.(positionRestoreRef.current.frameID);
    }
    followingHeightRetryRef.current = null;
    const owner = readingRef.current;
    const lease = owner?.getSession?.().positionRowLease;
    if (lease) owner.revokeHistoryPositionLease?.(lease, { clearHistoryAnchor: true });
    positionRestoreRef.current = null;
  }, []);

  // Following has no usable viewport until its first semantic presentation
  // arrives. Do not publish an empty list as the active handoff: callers can
  // otherwise observe and interact with a real scroll root before the delayed
  // history supply has produced any readable rows. Browsing keeps its restore
  // status, and authoritative empty channels still use the explicit empty
  // region below once initialization has settled.
  if (reading.initializing && reading.session.mode === READING_MODE.following && !snapshot.rows.length) {
    return null;
  }

  if (reading.restorePending && !snapshot.rows.length) {
    return <div className="timeline-message-list timeline-reading-restore" role="status">正在恢复上次阅读位置…</div>;
  }
  if (!snapshot.rows.length) {
    // Delayed following may expose this already-existing empty region before
    // its first semantic rows arrive. Let the same coordinator receive a
    // trusted native gesture here; it demotes following synchronously and
    // therefore prevents the first data paint from issuing a tail write after
    // the user has taken control. No geometry writer is added.
    return <div
      ref={reading.session.mode === READING_MODE.following ? bindScroller : undefined}
      className="timeline-message-list"
      data-empty="true"
      role="region"
      aria-label="频道动态"
    />;
  }

  return <Virtuoso
    ref={virtuosoRef}
    className="timeline-message-list"
    role="region"
    aria-label="频道动态"
    data-reading-container="conversation-list"
    data-reading-mode={reading.session.mode}
    data-reading-presentation-revision={Number(snapshot.revision || 0)}
    data-reading-root-identity={rootIdentity}
    tabIndex={0}
    data={snapshot.rows}
    firstItemIndex={Number(snapshot.firstItemIndex || 1)}
    // Browsing restoration is an explicit typed position-row command below.
    // Passing the bookmark index here also arms Virtuoso's delayed initial
    // location writer; it can run after the painted command and move the same
    // anchor by one measured row. Start browsing mounts at the neutral origin
    // and let the Reading executor own the exact row/offset handoff.
    initialTopMostItemIndex={reading.session.mode === READING_MODE.following
      ? Math.max(0, snapshot.rows.length - 1)
      : 0}
    computeItemKey={(_index, row) => row.id}
    itemContent={(index, row) => <MessageRow
      row={row}
      revision={rowRevision?.(index, row) || String(row.contentRevision)}
      renderRow={renderRow}
      presentationState={rowPresentationState?.(row) || ''}
    />}
    followOutput={false}
    defaultItemHeight={132}
    increaseViewportBy={anchorRetentionExtent || 900}
    overscan={900}
    scrollerRef={bindScroller}
    components={VIRTUOSO_COMPONENTS}
    context={listContext}
    rangeChanged={(range) => {
      restoreContentAnchor('layout');
      reportDomEvidence(Object.freeze({
        type: 'materialized-range',
        activationID: reading.activationID,
        presentationRevision: Number(snapshot.revision || 0),
        startIndex: Number(range.startIndex),
        endIndex: Number(range.endIndex),
      }));
      const root = rootRef.current;
      if (root) {
        const firstItemIndex = Number(snapshot.firstItemIndex || 1);
        const lastItemIndex = firstItemIndex + snapshot.rows.length - 1;
        const coverage = Object.freeze({
          type: 'viewport-coverage',
          activationID: reading.activationID,
          presentationRevision: Number(snapshot.revision || 0),
          hasBothBoundaries: range.startIndex <= firstItemIndex && range.endIndex >= lastItemIndex,
          underfilled: root.scrollHeight <= root.clientHeight + 1,
          scrollHeight: Number(root.scrollHeight || 0),
          clientHeight: Number(root.clientHeight || 0),
          demandUnits: completeViewportUnits(root),
          startIndex: Number(range.startIndex),
          endIndex: Number(range.endIndex),
          root,
          onWake: () => scheduleObserve('layout'),
        });
        const admissionKey = [coverage.activationID, coverage.presentationRevision,
          coverage.clientHeight].join(':');
        if (coverageEvidenceRef.current?.root !== root
          || coverageSourceKeyRef.current !== admissionKey) {
          coverageSourceKeyRef.current = admissionKey;
          coveragePublishedKeyRef.current = '';
        }
        coverageEvidenceRef.current = coverage;
        publishCoverageEvidence(coverage);
      }
      scheduleObserve('layout');
    }}
    totalListHeightChanged={() => {
      const liveOwner = readingRef.current;
      const liveSession = liveOwner?.getSession?.();
      if (!callbackRoot || rootRef.current !== callbackRoot
        || String(liveOwner?.activationID || liveSession?.activationID || '') !== callbackActivationID
        || Number(liveOwner?.status?.generation || 0) !== callbackGeneration) return;
      geometryRevisionRef.current += 1;
      restoreContentAnchor('layout');
      issueBottomIntent();
      enforceFollowingTail('layout');
      scheduleFollowingHeightRetry();
      scheduleObserve('layout');
    }}
    atBottomStateChange={() => {
      restoreContentAnchor('layout');
      scheduleObserve('layout');
    }}
  />;
}
