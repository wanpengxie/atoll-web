import {
  useCallback,
  useEffect,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { emptyBrowsingFoldLease, reconcileBrowsingFoldLease } from '../../model/browsing-fold-lease.js';
import {
  createConversationPresentation,
  projectTimeline,
} from '../../model/conversation-presentation.js';
import { diagnostic, readingTrace } from '../../model/diagnostics.js';
import { HISTORY_URGENCY } from '../../model/history-demand.js';
import {
  bindLatestIntentTargets,
  captureContentAnchor,
  cancelReadingControl,
  cancelHistoryStartIntent,
  consumeContentAnchor,
  consumeHistoryStartIntent,
  consumeLatestIntent,
  contentAnchorCommand,
  createReadingSession,
  observeReading,
  acceptPositionRowLease,
  advanceReadingInputEpoch,
  consumePositionRowLease,
  persistentReadingSession,
  positionRowLeaseCommand,
  revokePositionRowLease,
  READING_MODE,
  requestLatest,
  historyStartIntentCommand,
  takeReadingControl,
  updateHistoryAnchor,
  updateReadingControl,
} from '../../model/reading-session.js';
import { newId } from '../../util/id.js';
import { useColdEntryDiagnostics } from './useColdEntryDiagnostics.js';
import { HISTORY_CONSUMER } from './history-consumer-obligation.js';
import { useHistoryConsumer, useReadingInitialization } from './useHistoryConsumer.js';
import { usePresentationArrivalReceipt, useTimelineArrivalReceipt } from './useLiveArrivalReceipts.js';

const IDLE_HISTORY_DEMAND = Object.freeze({ revision: 0, phase: 'idle', error: '' });
const HISTORY_RUNWAY_REVEAL_RECORDS = 8;
const HISTORY_RUNWAY_REVEAL_BYTES = 256 * 1024;
const pageIsVisible = () => globalThis.document?.visibilityState !== 'hidden';

function scopeHandoffOperationID(handoff) {
  return `scope-handoff:${handoff.channel}:${handoff.sourceActivationID}:${handoff.sourceInputEpoch}:${handoff.sourceRevision}:${handoff.generation}:${handoff.rowID}`;
}

function typedTailLeaseRevoke(
  receipt,
  reason,
  inputEpoch = receipt?.inputEpoch,
  { advanceEpoch = false } = {},
) {
  const receiptEpoch = Number(receipt?.inputEpoch);
  const requestedEpoch = Number(inputEpoch);
  const baseEpoch = Number.isSafeInteger(requestedEpoch) && requestedEpoch >= 0
    ? requestedEpoch
    : (Number.isSafeInteger(receiptEpoch) && receiptEpoch >= 0 ? receiptEpoch : 0);
  const revokeEpoch = advanceEpoch
    ? Math.max(baseEpoch, Number.isSafeInteger(receiptEpoch) ? receiptEpoch + 1 : 0)
    : baseEpoch;
  return Object.freeze({
    ...receipt,
    caughtUp: false,
    atTail: false,
    following: false,
    surfaceVisible: false,
    physicalSeq: 0,
    boundary: 0,
    kind: 'notification-lease-revoke',
    reason,
    inputEpoch: revokeEpoch,
    cause: '',
  });
}

function rangeCovers(ranges = [], low, high) {
  const start = Number(low || 0);
  const end = Number(high || 0);
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start > 0 && end >= start
    && ranges.some((range) => Number(range?.lowSeq || 0) <= start && Number(range?.highSeq || 0) >= end);
}

function currentEntryAuthority({ snapshot, historyStatus, bottomReady, availability, authoritativeEmpty }) {
  const candidate = snapshot?.currentEntryCandidate;
  // A live row is already materialized in the same current presentation that
  // published the authoritative head. The replica coverage array is updated
  // by the history-page path and may lag that live commit by one publication;
  // requiring it here would hide the actual current entry until another page
  // happens to refresh coverage.
  const candidateAtCurrentHead = candidate && candidate.local !== true
    && Number(candidate.seqHigh || 0) > 0
    && Number(candidate.seqHigh || 0) === Number(historyStatus?.headSeq || 0)
    && historyStatus?.messageCurrent === true;
  const durableCovered = candidate && candidate.local !== true
    && (candidateAtCurrentHead
      || rangeCovers(historyStatus?.coverage, candidate.seqHigh, historyStatus?.headSeq));
  const localCovered = candidate?.local === true && (authoritativeEmpty
    || (bottomReady && rangeCovers(historyStatus?.coverage, historyStatus?.headSeq, historyStatus?.headSeq)));
  if (availability !== 'readable' || !candidate || !((bottomReady && durableCovered) || localCovered)) return null;
  return Object.freeze({
    epoch: snapshot.epoch,
    viewID: snapshot.viewID,
    sourceRevision: Number(snapshot.sourceRevision || 0),
    candidateID: candidate.id,
  });
}

function sameTailEvidence(left, right) {
  const leftVisibleRowIDs = left.visibleRowIDs || [];
  const rightVisibleRowIDs = right.visibleRowIDs || [];
  const leftIdentity = left.observationIdentity || {};
  const rightIdentity = right.observationIdentity || {};
  return left.activationID === right.activationID
    && left.inputEpoch === right.inputEpoch
    && left.rootIdentity === right.rootIdentity
    && left.atTail === right.atTail
    && left.settled === right.settled
    && left.surfaceVisible === right.surfaceVisible
    && left.installedHighSeq === right.installedHighSeq
    && left.generation === right.generation
    && left.headSeq === right.headSeq
    && left.presentationRevision === right.presentationRevision
    && left.domPresentationRevision === right.domPresentationRevision
    && left.observationPresentationRevision === right.observationPresentationRevision
    && left.authorityVerified === right.authorityVerified
    && left.sourceRevision === right.sourceRevision
    && left.authorityRevision === right.authorityRevision
    && left.tailID === right.tailID
    && left.rootNode === right.rootNode
    && left.geometryRevision === right.geometryRevision
    && leftIdentity.activationID === rightIdentity.activationID
    && leftIdentity.inputEpoch === rightIdentity.inputEpoch
    && leftIdentity.intentRevision === rightIdentity.intentRevision
    && leftIdentity.presentationRevision === rightIdentity.presentationRevision
    && leftIdentity.tailID === rightIdentity.tailID
    && leftIdentity.generation === rightIdentity.generation
    && leftIdentity.authorityRevision === rightIdentity.authorityRevision
    && leftIdentity.rootIdentity === rightIdentity.rootIdentity
    && leftVisibleRowIDs.length === rightVisibleRowIDs.length
    && leftVisibleRowIDs.every((id, index) => id === rightVisibleRowIDs[index]);
}

function traceReadingOwnerCommit({ channelID, viewKey, viewport, snapshot }) {
  const changes = snapshot?.changes || {};
  const ids = (value) => [...new Set((Array.isArray(value) ? value : [])
    .map((id) => String(id || ''))
    .filter(Boolean))];
  const insertedIDs = ids(changes.inserted);
  // readingTrace applies a bounded diagnostic value policy. Preserve the
  // newest committed delta when a rebase contains more IDs than that bound;
  // the current tail must remain observable without changing the Presentation
  // owner commit or manufacturing a second event.
  const tracedInsertedIDs = insertedIDs.length > 50 ? insertedIDs.slice(-50) : insertedIDs;
  const updatedIDs = ids(changes.updated);
  const removedIDs = ids(changes.removed);
  if (!insertedIDs.length && !updatedIDs.length && !removedIDs.length) return;
  readingTrace('reading.owner-commit', {
    channelId: String(channelID || ''),
    viewKey: String(viewKey || ''),
    activationID: String(viewport?.activationID || ''),
    inputEpoch: Number(viewport?.session?.inputEpoch || 0),
    presentationRevision: Number(snapshot?.revision || 0),
    sourceRevision: Number(snapshot?.sourceRevision || 0),
    kind: String(changes.kind || ''),
    insertedIDs: tracedInsertedIDs,
    frontInsertedIDs: ids(changes.frontInsertedIDs),
    backInsertedIDs: ids(changes.backInsertedIDs),
    updatedIDs,
    removedIDs,
  });
}

function createSessionController({ channelID, viewKey, viewSessions }) {
  const activationID = newId();
  const saved = viewSessions?.readView?.(channelID, viewKey) || {};
  let session = createReadingSession({ key: `${channelID}:${viewKey}`, activationID, saved });
  let published = Object.freeze({ session });
  let active = false;
  const listeners = new Set();
  const publish = () => { for (const listener of listeners) listener(); };
  const persist = (previousRevision) => viewSessions?.save?.(
    channelID,
    viewKey,
    activationID,
    previousRevision,
    persistentReadingSession(session),
  );
  return Object.freeze({
    activationID,
    getSnapshot: () => published,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    start() {
      if (active) return;
      active = true;
      viewSessions?.activate?.(channelID, viewKey, activationID);
    },
    suspend() {
      if (!active) return;
      viewSessions?.deactivate?.(channelID, viewKey, activationID);
      active = false;
    },
    isStarted: () => active,
    update(reduce) {
      if (!active) return session;
      const previous = session;
      const candidate = reduce(previous);
      if (!candidate || candidate === previous) return session;
      session = candidate;
      published = Object.freeze({ session });
      persist(previous.revision);
      publish();
      return session;
    },
  });
}

function useProjectionReadingOwner({
  channelID,
  viewKey,
  snapshot,
  history,
  viewSessions,
  historyViewSpec,
  surfaceVisible,
  arrivals,
  onTailLeaseRevoke,
  onScopeHandoffCancel,
}) {
  const historyStatus = history.status;
  const requestPort = history.request;
  const controller = useMemo(
    () => createSessionController({ channelID, viewKey, viewSessions }),
    [channelID, viewKey, viewSessions],
  );
  const published = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const { session } = published;
  const snapshotRef = useRef(snapshot);
  const historyStatusRef = useRef(historyStatus);
  const observationRef = useRef(Object.freeze({
    activationID: controller.activationID,
    inputEpoch: 0,
    rootIdentity: 0,
    rootNode: null,
    atTail: false,
    settled: false,
    surfaceVisible: false,
    installedHighSeq: 0,
    generation: 0,
    headSeq: 0,
    presentationRevision: 0,
    domPresentationRevision: 0,
    observationPresentationRevision: 0,
    observationIdentity: null,
    visibleRowIDs: Object.freeze([]),
    tailID: '',
    authorityVerified: false,
    sourceRevision: 0,
    authorityRevision: 0,
    geometryRevision: 0,
  }));
  const [observationRevision, setObservationRevision] = useState(0);
  const [documentVisible, setDocumentVisible] = useState(pageIsVisible);
  // Document and surface visibility are two observations of one effective
  // Reading boundary. Keep that boundary in the session owner so a browser
  // visibility edge and the matching surface cleanup cannot mint two epochs
  // for the same leave/re-entry transaction.
  const visibilityBoundaryRef = useRef({
    documentVisible: pageIsVisible(),
    surfaceVisible: surfaceVisible === true,
    visibilityEpoch: 0,
  });
  // A physical list root is part of Reading authority. The first root merely
  // establishes the mounted identity; a replacement root is a successor
  // transaction, so no receipt from the old root can authorize the new one.
  const rootActivationRef = useRef({ node: null, identity: 0, activationID: '' });
  // Keep the last positive tail receipt available to the synchronous native
  // takeover path. A later layout/settled sample may already have replaced the
  // public observation with a transient `following: false` frame while the
  // Feed still owns the old notification lease.
  const tailLeaseRef = useRef(null);
  const commitOwnerCandidate = useMemo(() => Object.freeze({
    controller,
    activationID: controller.activationID,
    channelID,
    viewKey,
    session,
    snapshot,
    historyStatus,
  }), [channelID, controller, historyStatus, session, snapshot, viewKey]);
  const committedOwnerRef = useRef(commitOwnerCandidate);

  useInsertionEffect(() => {
    committedOwnerRef.current = commitOwnerCandidate;
    snapshotRef.current = snapshot;
    historyStatusRef.current = historyStatus;
  }, [commitOwnerCandidate, historyStatus, session, snapshot]);
  useLayoutEffect(() => {
    controller.start();
    return () => controller.suspend();
  }, [controller]);
  const advanceVisibilityEpoch = useCallback(({ documentVisible: nextDocumentVisible, surfaceVisible: nextSurfaceVisible }) => {
    const boundary = visibilityBoundaryRef.current;
    const previousEffective = boundary.documentVisible && boundary.surfaceVisible;
    if (typeof nextDocumentVisible === 'boolean') boundary.documentVisible = nextDocumentVisible;
    if (typeof nextSurfaceVisible === 'boolean') boundary.surfaceVisible = nextSurfaceVisible;
    const nextEffective = boundary.documentVisible && boundary.surfaceVisible;
    if (previousEffective === nextEffective) return false;
    boundary.visibilityEpoch += 1;
    // A hidden boundary invalidates the current positive receipt; a visible
    // boundary must mint a successor only after a real prior input epoch.
    if (!nextEffective) {
      const current = controller.getSnapshot().session;
      const nextSession = current.mode === READING_MODE.following || current.historyStartIntent
        ? controller.update((active) => advanceReadingInputEpoch(active))
        : current;
      const cleared = Object.freeze({
        activationID: controller.activationID,
        inputEpoch: Number(nextSession.inputEpoch || 0),
        rootIdentity: 0,
        rootNode: null,
        atTail: false,
        settled: false,
        surfaceVisible: false,
        installedHighSeq: 0,
        generation: 0,
        headSeq: 0,
        presentationRevision: 0,
        domPresentationRevision: 0,
        observationPresentationRevision: 0,
        observationIdentity: null,
        visibleRowIDs: Object.freeze([]),
        tailID: '',
        authorityVerified: false,
        sourceRevision: 0,
        authorityRevision: 0,
        geometryRevision: 0,
      });
      if (!sameTailEvidence(cleared, observationRef.current)) {
        observationRef.current = cleared;
        setObservationRevision((value) => value + 1);
      }
      return true;
    }
    const current = controller.getSnapshot().session;
    if (current.mode !== READING_MODE.following) return false;
    if (nextEffective && Number(current.inputEpoch || 0) > 0) {
      controller.update((active) => advanceReadingInputEpoch(active));
      return true;
    }
    return false;
  }, [controller]);
  useEffect(() => {
    const publish = () => {
      const visible = pageIsVisible();
      advanceVisibilityEpoch({ documentVisible: visible });
      setDocumentVisible((current) => current === visible ? current : visible);
    };
    globalThis.document?.addEventListener?.('visibilitychange', publish);
    return () => globalThis.document?.removeEventListener?.('visibilitychange', publish);
  }, [advanceVisibilityEpoch]);
  const syncStatus = historyStatus.sync;
  const syncObservationCurrent = Number(syncStatus.interestRevision || 0) > 0
    && Number(syncStatus.fulfilledRevision || 0) >= Number(syncStatus.interestRevision || 0);
  const knownHead = Math.max(Number(historyStatus.headSeq || 0), Number(syncStatus.targetHead || 0));
  const currentPresentationKnown = Number(historyStatus.presentationRevision || 0) <= 0
    || Number(snapshot.sourceRevision || 0) >= Number(historyStatus.presentationRevision || 0);
  const bottomReady = Boolean(
    historyStatus.attached === true
    && Number(historyStatus.generation || 0) > 0
    && historyStatus.messageCurrent === true
    && currentPresentationKnown,
  );
  const authoritativeEmpty = historyStatus.attached === true
    && Number(historyStatus.generation || 0) > 0
    && historyStatus.messageCurrent === true
    && historyStatus.localReplicaReady !== false
    && knownHead === 0
    && syncObservationCurrent;
  const semanticRangeEstablished = historyStatus.loaded === true
    || Number(historyStatus.completedPages || 0) > 0;
  const semanticExhausted = semanticRangeEstablished
    && historyStatus.attached === true
    && historyStatus.messageCurrent === true
    && historyStatus.hasOlder === false
    && Number(historyStatus.buffered || 0) === 0
    && historyStatus.loading !== true
    && syncObservationCurrent;
  const { presentationInitializing, restorePending } = useReadingInitialization({
    controller,
    session,
    snapshot,
    historyStatus,
    hasManagedHistoryLifecycle: true,
    authoritativeEmpty,
    semanticExhausted,
    channelID,
    viewKey,
  });
  const availabilityError = String(
    historyStatus.historyDemand?.error
    || syncStatus.error
    || historyStatus.error
    || '',
  );
  const availability = snapshot.rows.length
    ? 'readable'
    : availabilityError
      ? 'error'
      : authoritativeEmpty || semanticExhausted
        ? 'empty-known'
        : semanticRangeEstablished && historyStatus.hasOlder === true
          ? 'partial'
          : 'syncing';
  const presentationAuthority = currentEntryAuthority({
    snapshot,
    historyStatus,
    bottomReady,
    availability,
    authoritativeEmpty,
  });
  const historyBoundary = semanticExhausted ? Object.freeze({
    kind: 'exhausted',
    generation: Number(historyStatus.generation || 0),
    filtered: historyViewSpec?.scope === 'mine' || Number(historyViewSpec?.actorFilter?.size || 0) > 0,
    actorFiltered: Number(historyViewSpec?.actorFilter?.size || 0) > 0,
  }) : null;

  // The projection Reading owner already owns both the physical root handoff
  // and the effective document/surface visibility boundary.  Feed the
  // history consumer a live read-only port to those observations; no second
  // store or persisted session field is introduced.
  const getContinuationLineage = useCallback(() => {
    const root = rootActivationRef.current;
    const rootIdentity = root.activationID === controller.activationID
      ? Number(root.identity) : 0;
    const visibilityEpoch = Number(visibilityBoundaryRef.current.visibilityEpoch);
    return Object.freeze({ rootIdentity, visibilityEpoch });
  }, [controller]);
  const continuationLineage = getContinuationLineage();

  const historyConsumer = useHistoryConsumer({
    channelID,
    viewKey,
    controller,
    committedOwnerRef,
    commitOwnerCandidate,
    snapshotRef,
    historyStatusRef,
    historyStatus,
    snapshot,
    session,
    historyViewSpec,
    requestPort,
    authoritativeEmpty,
    semanticExhausted,
    hasManagedHistoryLifecycle: true,
    knownHead,
    history,
    getContinuationLineage,
    continuationLineage,
    localReplicaError: String(historyStatus.localReplicaError || ''),
    syncHistoryError: String(syncStatus.error || ''),
    foregroundHistoryError: historyStatus.historyDemand?.phase === 'error',
    blockingHistoryError: String(historyStatus.error || ''),
  });
  const requestHistory = historyConsumer.request;
  const captureBottomIntent = useCallback(() => {
    if (!controller.isStarted()) return null;
    const current = controller.getSnapshot().session;
    return Object.freeze({
      activationID: current.activationID,
      inputEpoch: current.inputEpoch,
      intentRevision: current.intentRevision,
      mode: current.mode,
      bottomIntentID: current.bottomIntent.id,
      presentationRevision: Number(snapshotRef.current.revision || 0),
      baselineTailID: String(snapshotRef.current.rows.at(-1)?.id || ''),
    });
  }, [controller]);
  const requestBottom = useCallback((reason = 'explicit', expected = null, target = null) => {
    // Explicit latest intent supersedes a pending scope/filter successor in
    // the same event stack. The handoff is ephemeral and must not revive an
    // old browsing row after a user has chosen the tail.
    onScopeHandoffCancel?.(reason === 'scope-handoff-cancelled' ? 'consume-latest-handoff' : 'latest-intent');
    const current = controller.getSnapshot().session;
    if (!controller.isStarted() || (expected && (
      expected.activationID !== current.activationID
      || Number(expected.inputEpoch) !== current.inputEpoch
      || Number(expected.intentRevision) !== current.intentRevision
      || expected.mode !== current.mode
    ))) return false;
    controller.update((active) => requestLatest(active, `${reason}:${newId()}`, {
      ...(target || {}),
      mintSuccessorEpoch: active.mode === READING_MODE.browsing,
    }));
    return true;
  }, [controller, onScopeHandoffCancel]);
  const beginNavigation = useCallback((input = {}) => {
    // A real native takeover supersedes a pending scope/filter successor. The
    // handoff is intentionally ephemeral; it must never survive a new user
    // browsing gesture and cannot become a durable bookmark.
    onScopeHandoffCancel?.('native-input');
    const previous = controller.getSnapshot().session;
    const leasedTail = tailLeaseRef.current;
    const currentGeneration = Number(historyStatusRef.current.generation || historyStatus.generation || 0);
    const control = Object.freeze({
      ...input,
      historyStart: input.historyStart === true && input.direction === 'older',
      channelID,
      viewKey,
      generation: currentGeneration,
      sourceLease: String(historyStatusRef.current.sourceLease || historyStatus.sourceLease || ''),
    });
    const next = controller.update((current) => takeReadingControl(current, control));
    // An upward native takeover is the physical leave boundary. Revoke the
    // exact frozen notification lease in this same event stack, carrying the
    // newly minted inputEpoch. Do not wait for a RAF or a settled observation:
    // the following owner must not acknowledge a live arrival after the user
    // has already taken the viewport.
    if (input.direction === 'older'
      && Number(next.inputEpoch) > Number(previous.inputEpoch)
      && leasedTail?.caughtUp === true
      && leasedTail.activationID === controller.activationID
      && Number(leasedTail.generation) === currentGeneration
      && Number(leasedTail.boundary) > 0
      && Number(leasedTail.inputEpoch) === Number(previous.inputEpoch)) {
      const revoke = Object.freeze({
        ...typedTailLeaseRevoke(leasedTail, 'physical-leave', next.inputEpoch),
        cause: 'native-input',
        previousInputEpoch: Number(previous.inputEpoch),
      });
      tailLeaseRef.current = null;
      onTailLeaseRevoke?.(revoke);
    }
    // A delayed older page may already have staged an Admission token when a
    // subsequent wheel callback crosses the coordinator quiet deadline.  The
    // new older epoch is the same semantic intent, so hand that exact token
    // forward before the next layout validates its viewport owner. Otherwise
    // Presentation rejects the real prepend as stale before Vendor can paint
    // and consume its position-row lease.
    if (input.direction === 'older') {
      const admission = historyStatus.presentationAdmission;
      const state = admission?.snapshot?.(channelID);
      const token = state?.committed || state?.token;
      if (token && Number(next.inputEpoch) > Number(token.inputEpoch || 0)) {
        admission.advanceInputEpoch?.(channelID, {
          operationID: token.operationID,
          activationID: controller.activationID,
          direction: 'older',
          inputEpoch: Number(next.inputEpoch),
          currentInputEpoch: Number(next.inputEpoch),
          intentRevision: Number(next.intentRevision),
        });
      }
    }
    return Object.freeze({ inputGeneration: next.inputEpoch });
  }, [channelID, controller, historyConsumer, historyStatus.generation, historyStatus.presentationAdmission, onScopeHandoffCancel, onTailLeaseRevoke]);
  const captureContentAnchorForReading = useCallback((detail = {}) => {
    const before = controller.getSnapshot().session;
    const after = controller.update((current) => captureContentAnchor(current, detail));
    return after !== before;
  }, [controller]);
  const getContentAnchorCommand = useCallback(
    () => contentAnchorCommand(controller.getSnapshot().session),
    [controller],
  );
  const consumeContentAnchorCommand = useCallback((command = {}) => {
    const before = controller.getSnapshot().session;
    const after = controller.update((current) => consumeContentAnchor(current, command));
    return after !== before;
  }, [controller]);
  const updateNavigation = useCallback((input = {}) => {
    const before = controller.getSnapshot().session;
    const after = controller.update((current) => updateReadingControl(current, {
      inputEpoch: input.inputGeneration,
      direction: input.direction,
      gestureID: input.gestureID,
      geometryRevision: input.geometryRevision,
      source: input.source,
      sourceID: input.sourceID,
    }));
    return after !== before;
  }, [controller]);
  const cancelNavigation = useCallback((input = {}) => {
    const before = controller.getSnapshot().session;
    historyConsumer.cancel(`navigation:${input.reason || 'cancelled'}`);
    const after = controller.update((current) => cancelReadingControl(current, {
      inputEpoch: input.inputGeneration,
      gestureID: input.gestureID,
    }));
    return after !== before;
  }, [controller, historyConsumer]);
  const cancelHistoryStart = useCallback((reason = 'native-input') => {
    const before = controller.getSnapshot().session;
    historyConsumer.cancel(`history-start:${reason}`);
    const after = controller.update((current) => cancelHistoryStartIntent(
      current, current.historyStartIntent,
    ));
    return after !== before;
  }, [controller, historyConsumer]);
  const historyStartCommand = useCallback(() => {
    const current = controller.getSnapshot().session;
    const status = historyStatusRef.current;
    const intent = historyStartIntentCommand(current, {
      channelID,
      viewKey,
      generation: Number(status.generation || 0),
      sourceLease: String(status.sourceLease || ''),
      inputEpoch: Number(current.inputEpoch || 0),
      intentRevision: Number(current.intentRevision || 0),
    });
    if (!intent || !historyConsumer.historyStartReady?.(intent)) return null;
    return Object.freeze({
      ...intent,
      type: 'scroll-tail',
      reverse: true,
      historyStart: true,
    });
  }, [channelID, controller, historyConsumer, viewKey]);
  const onHistoryStartEvidence = useCallback((evidence = {}) => {
    if (evidence.type !== 'history-start-evidence' || evidence.settled !== true) return false;
    const current = controller.getSnapshot().session;
    const status = historyStatusRef.current;
    const snapshotNow = snapshotRef.current;
    const intent = historyStartIntentCommand(current, {
      channelID,
      viewKey,
      generation: Number(status.generation || 0),
      sourceLease: String(status.sourceLease || ''),
      inputEpoch: Number(current.inputEpoch || 0),
      intentRevision: Number(current.intentRevision || 0),
    });
    const mounted = rootActivationRef.current;
    const visibleRowIDs = [...new Set((evidence.visibleRowIDs || []).map(String).filter(Boolean))];
    const visibleRows = new Set((evidence.visibleRows || [])
      .map((row) => String(row?.messageID || row?.id || row || '')).filter(Boolean));
    const firstID = String(snapshotNow.rows?.[0]?.id || '');
    const presentationRevision = Number(snapshotNow.revision || 0);
    const valid = Boolean(intent)
      && historyConsumer.historyStartReady?.(intent) === true
      && status.hasOlder === false
      && mounted.node === evidence.rootNode
      && Number(mounted.identity) === Number(evidence.rootIdentity)
      && Number(evidence.inputEpoch) === Number(intent.inputEpoch)
      && Number(evidence.intentRevision) === Number(intent.intentRevision)
      && Number(evidence.generation) === Number(intent.generation)
      && String(evidence.sourceLease || '') === String(intent.sourceLease || '')
      && Number(evidence.presentationRevision) === presentationRevision
      && Number(evidence.domPresentationRevision) === presentationRevision
      && Number(evidence.scrollTop) <= 1
      && visibleRowIDs.length > 0
      && visibleRowIDs.every((id) => visibleRows.has(id))
      && (!firstID || visibleRowIDs.includes(firstID));
    if (!valid) return false;
    if (historyConsumer.consumeHistoryStartEvidence?.(intent) !== true) return false;
    controller.update((active) => consumeHistoryStartIntent(active, intent));
    return true;
  }, [channelID, controller, historyConsumer, viewKey]);
  const failHistoryStart = useCallback((reason) => historyConsumer.failHistoryStart?.(reason) === true, [historyConsumer]);
  const currentAdmissionAuthority = useCallback(() => {
    const owner = committedOwnerRef.current;
    return Object.freeze({
      activationID: owner.activationID,
      inputEpoch: owner.session.inputEpoch,
      intentRevision: owner.session.intentRevision,
      viewID: owner.viewKey,
      epoch: `${owner.channelID}:${Number(owner.historyStatus.generation || 0)}`,
    });
  }, []);
  const historyPositionLeaseCommand = useCallback(() => {
    const current = controller.getSnapshot().session;
    const command = positionRowLeaseCommand(current);
    if (!command) return null;
    const currentEpoch = `${channelID}:${Number(historyStatusRef.current.generation || 0)}`;
    // A lease is valid only for the exact committed Presentation that granted
    // it. A source/view/generation/revision replacement is a terminal fence,
    // not a reason to replay the old row command against the new list.
    if (command.viewID !== viewKey
      || command.epoch !== currentEpoch
      || Number(command.presentationRevision) !== Number(snapshotRef.current.revision || 0)) {
      controller.update((active) => revokePositionRowLease(active, command, {
        clearHistoryAnchor: true,
      }));
      return null;
    }
    return command;
  }, [channelID, controller, viewKey]);
  const acceptHistoryPositionLease = useCallback((lease) => {
    const current = controller.getSnapshot().session;
    const currentEpoch = `${channelID}:${Number(historyStatusRef.current.generation || 0)}`;
    if (!lease || lease.viewID !== viewKey || lease.epoch !== currentEpoch) {
      onScopeHandoffCancel?.('position-lease-rejected');
      return false;
    }
    const after = controller.update((active) => acceptPositionRowLease(active, lease));
    if (after !== current) return true;
    const existing = positionRowLeaseCommand(after);
    const accepted = Boolean(existing
      && existing.operationID === lease.operationID
      && Number(existing.presentationRevision) === Number(lease.presentationRevision)
      && existing.messageID === lease.messageID);
    if (!accepted) onScopeHandoffCancel?.('position-lease-rejected');
    return accepted;
  }, [channelID, controller, onScopeHandoffCancel, viewKey]);
  const acceptScopeHandoff = useCallback((handoff = null) => {
    if (!handoff
      || String(handoff.channel || '') !== String(channelID)
      || String(handoff.returnView || '') !== String(viewKey)
      || !handoff.fromView
      || !handoff.throughView
      || !handoff.sourceActivationID
      || !Number.isFinite(Number(handoff.sourceRevision))
      || !Number.isSafeInteger(Number(handoff.sourceInputEpoch))
      || !handoff.rowID
      || !Number.isFinite(Number(handoff.viewportOffset))) return false;
    const status = historyStatusRef.current;
    const generation = Number(status.generation || 0);
    if (!Number.isSafeInteger(generation) || generation !== Number(handoff.generation)) return false;
    const committedSnapshot = snapshotRef.current;
    const rowID = String(handoff.rowID);
    // A filtered presentation that does not contain the source identity has
    // no legal target. Do not manufacture a row or a bookmark for that view;
    // the lease is issued only after returning to the source presentation and
    // seeing that same row in the committed projection.
    if (!committedSnapshot.rows?.some((row) => String(row?.id || '') === rowID)) return false;
    // Layout-effect ordering can expose the successor viewport to the parent
    // handoff effect before this controller's own start effect runs. Start the
    // same owner idempotently here; no second store or writer is introduced.
    if (!controller.isStarted()) controller.start();
    if (!controller.isStarted()) return false;
    const operationID = scopeHandoffOperationID(handoff);
    let current = controller.getSnapshot().session;
    if (current.mode !== READING_MODE.browsing) {
      current = controller.update((active) => takeReadingControl(active, {
        direction: 'browse',
        gestureID: operationID,
        channelID,
        viewKey,
        generation,
      }));
    }
    current = controller.getSnapshot().session;
    const lease = Object.freeze({
      type: 'position-row',
      activationID: current.activationID,
      inputEpoch: current.inputEpoch,
      intentRevision: current.intentRevision,
      operationID,
      viewID: String(viewKey),
      epoch: `${channelID}:${generation}`,
      presentationRevision: Number(committedSnapshot.revision || 0),
      messageID: rowID,
      viewportOffset: Number(handoff.viewportOffset),
    });
    // Reuse the existing Reading lease and the sole Vendor writer. This call
    // is semantic only; it never performs a DOM scroll itself.
    return acceptHistoryPositionLease(lease);
  }, [acceptHistoryPositionLease, channelID, controller, viewKey]);
  const consumeHistoryPositionLease = useCallback((command, nextAnchor = null) => {
    const before = controller.getSnapshot().session;
    const after = controller.update((active) => {
      const consumed = consumePositionRowLease(active, command);
      return consumed === active ? consumed : updateHistoryAnchor(consumed, nextAnchor);
    });
    return after !== before;
  }, [controller]);
  const revokeHistoryPositionLease = useCallback((command = null, options = {}) => {
    const before = controller.getSnapshot().session;
    const after = controller.update((active) => revokePositionRowLease(active, command, options));
    return after !== before;
  }, [controller]);
  const tailCaughtUp = useMemo(() => {
    const evidence = observationRef.current;
    const scope = historyViewSpec?.scope || '';
    const actorFilterCount = Number(historyViewSpec?.actorFilter?.size || 0);
    const generation = Number(historyStatus.generation || 0);
    const headSeq = Number(historyStatus.headSeq || 0);
    const presentationRevision = Number(historyStatus.presentationRevision || 0);
    const authorityRevision = Number(historyStatus.notificationAuthorityRevision || 0);
    const sourceRevision = Number(snapshot.sourceRevision || 0);
    const following = session.mode === READING_MODE.following;
    const currentInputEpoch = Number(session.inputEpoch || 0);
    const currentTailID = String(snapshot.rows?.at(-1)?.id || '');
    const identity = evidence.observationIdentity || {};
    // Vendor's settled receipt is an authority-bearing DOM observation. Keep
    // every identity component in the consumer fence as well as in the
    // producer: a late callback must not turn a retired root into following
    // authority merely because the old rows still happen to be visible.
    const authorityCurrent = evidence.authorityVerified === true
      && Number(evidence.inputEpoch) === currentInputEpoch
      && Number(evidence.rootIdentity) > 0
      && Number(evidence.domPresentationRevision) === Number(snapshot.revision || 0)
      && Number(evidence.observationPresentationRevision) === Number(snapshot.revision || 0)
      && Array.isArray(evidence.visibleRowIDs)
      && evidence.visibleRowIDs.length > 0
      && (!evidence.atTail || evidence.visibleRowIDs.includes(currentTailID))
      && String(evidence.tailID || '') === currentTailID
      && String(identity.activationID || '') === String(controller.activationID)
      && Number(identity.inputEpoch) === currentInputEpoch
      && Number(identity.intentRevision) === Number(session.intentRevision || 0)
      && Number(identity.presentationRevision) === Number(snapshot.revision || 0)
      && Number(identity.generation) === generation
      && Number(identity.authorityRevision) === authorityRevision
      && String(identity.tailID || '') === currentTailID
      && Number(identity.rootIdentity) === Number(evidence.rootIdentity);
    const atTail = evidence.atTail === true;
    const surfaceReady = surfaceVisible === true
      && evidence.surfaceVisible === true
      && documentVisible === true;
    const caughtUp = following
      && evidence.activationID === controller.activationID
      && atTail
      && evidence.settled === true
      && surfaceReady
      && authorityCurrent;
    const current = caughtUp
      && historyStatus.attached === true
      && historyStatus.messageCurrent === true
      && generation > 0
      && evidence.generation === generation
      && evidence.headSeq === headSeq
      && evidence.presentationRevision === presentationRevision
      && evidence.sourceRevision === sourceRevision
      && evidence.authorityRevision === authorityRevision
      && sourceRevision >= presentationRevision
      && evidence.installedHighSeq > 0
      && evidence.installedHighSeq <= headSeq
      && authorityCurrent;
    return Object.freeze({
      channelId: channelID,
      viewKey,
      activationID: controller.activationID,
      authority: historyStatus.authority,
      owner: Object.freeze({
        channelId: channelID,
        viewKey,
        activationID: controller.activationID,
        generation,
      }),
      inputEpoch: Number(session.inputEpoch || 0),
      captured: Object.freeze({
        presentationRevision: Number(evidence.presentationRevision || 0),
        sourceRevision: Number(evidence.sourceRevision || 0),
        installedHighSeq: Number(evidence.installedHighSeq || 0),
        visibleRowIDs: Object.freeze([...(evidence.visibleRowIDs || [])]),
      }),
      caughtUp,
      scope,
      actorFiltered: actorFilterCount > 0,
      actorFilterCount,
      generation,
      authorityRevision,
      cause: current ? 'presented-follow' : '',
      sourceRevision: Number(evidence.sourceRevision || 0),
      presentationRevision: Number(evidence.presentationRevision || 0),
      installedHighSeq: Number(evidence.installedHighSeq || 0),
      visibleRowIDs: Object.freeze([...(evidence.visibleRowIDs || [])]),
      // Tail entry is a frozen backlog observation. The value is captured
      // beside the evidence/head equality above; the callback must not
      // re-read a later mutable head. Continuous arrivals use the DOM
      // installedHighSeq below and never this entry boundary.
      entryBoundary: current ? headSeq : 0,
      atTail,
      following,
      surfaceVisible: surfaceReady,
      physicalSeq: current && scope === 'all' && actorFilterCount === 0
        ? evidence.installedHighSeq
        : 0,
      // Notification acknowledgement is a channel attention boundary, not a
      // claim that filtered-out bodies were physically read. A current
      // semantic tail may therefore confirm the frozen channel head while its
      // physical cursor remains zero.
      boundary: current ? evidence.installedHighSeq : 0,
    });
  }, [
    channelID, controller, documentVisible, historyStatus.attached, historyStatus.generation,
    historyStatus.headSeq, historyStatus.messageCurrent, historyStatus.presentationRevision,
    historyStatus.notificationAuthorityRevision, historyViewSpec, observationRevision,
    session.inputEpoch, session.intentRevision, session.mode, snapshot.revision,
    snapshot.sourceRevision, viewKey,
  ]);

  // A following intent is not evidence that the user saw the arrival.  The
  // physical root must publish its current settled tail receipt first; a
  // wheel can take control while the command is still held before paint.
  // Acknowledging on the semantic mode transition would drop that arrival
  // and make the next badge under-count (1 instead of 2).
  useEffect(() => {
    if (tailCaughtUp.caughtUp !== true || Number(tailCaughtUp.boundary) <= 0) return;
    arrivals?.acknowledge?.(Number(arrivals.revision || 0));
  }, [arrivals, tailCaughtUp.boundary, tailCaughtUp.caughtUp]);

  useLayoutEffect(() => {
    if (tailCaughtUp.caughtUp === true && Number(tailCaughtUp.boundary) > 0) {
      tailLeaseRef.current = tailCaughtUp;
    } else if (tailCaughtUp.activationID !== controller.activationID
      || tailCaughtUp.atTail !== true
      || tailCaughtUp.surfaceVisible !== true) {
      tailLeaseRef.current = null;
    }
  }, [controller.activationID, tailCaughtUp]);

  const onReadingRootActivation = useCallback((root = {}) => {
    const rootNode = root.rootNode;
    const rootIdentity = Number(root.rootIdentity);
    if (!rootNode || !Number.isSafeInteger(rootIdentity) || rootIdentity <= 0) return false;
    const previous = rootActivationRef.current;
    if (previous.activationID !== controller.activationID) {
      rootActivationRef.current = { node: rootNode, identity: rootIdentity, activationID: controller.activationID };
      return false;
    }
    if (previous.node === rootNode && Number(previous.identity) === rootIdentity) return false;
    rootActivationRef.current = { node: rootNode, identity: rootIdentity, activationID: controller.activationID };
    // Ref callbacks can run before the session's layout effect starts the
    // controller on the first mount. Recording the root above is enough;
    // there is no predecessor authority to revoke in that case.
    if (!previous.node || !controller.isStarted()) return false;
    onScopeHandoffCancel?.('root-replacement');
    const before = controller.getSnapshot().session;
    const leasedTail = tailLeaseRef.current;
    const nextSession = controller.update((active) => advanceReadingInputEpoch(active));
    const nextEpoch = Number(nextSession.inputEpoch);
    if (leasedTail?.caughtUp === true
      && leasedTail.activationID === controller.activationID
      && Number(leasedTail.inputEpoch) === Number(before.inputEpoch)) {
      tailLeaseRef.current = null;
      onTailLeaseRevoke?.(Object.freeze({
        ...typedTailLeaseRevoke(leasedTail, 'root-replacement', nextEpoch),
        cause: 'physical-root-replacement',
        previousInputEpoch: Number(before.inputEpoch),
      }));
    }
    // Do not let the old settled observation survive the physical root
    // replacement. The next root must publish a fresh hit-tested paint.
    observationRef.current = Object.freeze({
      activationID: controller.activationID,
      inputEpoch: nextEpoch,
      rootIdentity: 0,
      rootNode: null,
      atTail: false,
      settled: false,
      surfaceVisible: visibilityBoundaryRef.current.surfaceVisible === true,
      installedHighSeq: 0,
      generation: 0,
      headSeq: 0,
      presentationRevision: 0,
      domPresentationRevision: 0,
      observationPresentationRevision: 0,
      observationIdentity: null,
      visibleRowIDs: Object.freeze([]),
      tailID: '',
      authorityVerified: false,
      sourceRevision: 0,
      authorityRevision: 0,
      geometryRevision: 0,
    });
    setObservationRevision((value) => value + 1);
    return nextEpoch > Number(before.inputEpoch);
  }, [controller, onScopeHandoffCancel, onTailLeaseRevoke]);

  return useMemo(() => Object.freeze({
    activationID: controller.activationID,
    session,
    unseen: session.mode === READING_MODE.browsing ? Number(arrivals?.events?.length || 0) : 0,
    unseenNotice: session.mode === READING_MODE.browsing ? Number(arrivals?.events?.length || 0) : 0,
    tailCaughtUp,
    initializing: presentationInitializing,
    restorePending,
    bottomReady,
    presentationAuthority,
    availability,
    emptyReason: authoritativeEmpty ? 'channel' : 'filtered',
    presentationPending: false,
    availabilityError,
    freshness: Object.freeze({ phase: syncObservationCurrent ? 'current' : availabilityError ? 'error' : 'pending', error: String(syncStatus.error || '') }),
    cache: Object.freeze({
      phase: historyStatus.localReplicaError
        ? 'error'
        : historyStatus.localReplicaReady === false ? 'pending' : 'current',
      error: String(historyStatus.localReplicaError || ''),
      code: String(historyStatus.localReplicaErrorCode || ''),
    }),
    status: historyStatus,
    historyDemand: ['pending', 'error'].includes(historyStatus.historyDemand?.phase)
      ? historyStatus.historyDemand
      : IDLE_HISTORY_DEMAND,
    historyStartFailure: historyConsumer.historyStartFailure || null,
    historyBoundary,
    historyReveal: historyStatus.historyReveal || null,
    currentAdmissionAuthority,
    historyPositionLeaseCommand,
    acceptHistoryPositionLease,
    acceptScopeHandoff,
    consumeHistoryPositionLease,
    revokeHistoryPositionLease,
    acknowledgeHistoryReveal(commitID) { return historyStatus.presentationAdmission?.acknowledge?.(channelID, commitID) === true; },
    requestHistory,
    retryHistoryDemand: historyConsumer.retry,
    retryHistoryStart: historyConsumer.retryHistoryStart,
    retryAvailability: historyConsumer.retryAvailability,
    onAtTop(detail = {}) { return requestHistory('top', HISTORY_URGENCY.interactive, detail); },
    onNearTop(detail = {}) { return requestHistory('runway', HISTORY_URGENCY.anticipatory, { ...detail, revealRows: HISTORY_RUNWAY_REVEAL_RECORDS, revealBytes: HISTORY_RUNWAY_REVEAL_BYTES }); },
    onUnderfill(detail = {}) { return requestHistory('underfill', HISTORY_URGENCY.anticipatory, { ...detail, consumer: HISTORY_CONSUMER.viewportUnderfill }); },
    beginNavigation,
    captureContentAnchor: captureContentAnchorForReading,
    contentAnchorCommand: getContentAnchorCommand,
    consumeContentAnchor: consumeContentAnchorCommand,
    updateNavigation,
    finishNavigation(input = {}) { return Number(input.inputGeneration) === controller.getSnapshot().session.inputEpoch; },
    cancelNavigation,
    cancelHistoryStart,
    historyStartCommand,
    onHistoryStartEvidence,
    failHistoryStart,
    onReadingObservation(observation = {}) {
      if (observation.type !== 'reading-authority' || observation.settled !== true) return false;
      const current = controller.getSnapshot().session;
      const committedSnapshot = snapshotRef.current;
      const committedHistory = historyStatusRef.current;
      const inputEpoch = Number(observation.inputEpoch);
      const hasInputEpoch = Number.isSafeInteger(inputEpoch);
      const currentPresentationRevision = Number(committedSnapshot.revision || 0);
      const observedPresentationRevision = Number(observation.presentationRevision);
      const observedDomPresentationRevision = Number(observation.domPresentationRevision);
      const visibleRowIDs = Object.freeze([...new Set((Array.isArray(observation.visibleRowIDs)
        ? observation.visibleRowIDs
        : [])
        .map((id) => String(id || ''))
        .filter(Boolean))]);
      const identity = observation.observationIdentity || null;
      const identityComplete = Boolean(identity)
        && typeof identity.activationID === 'string'
        && Number.isSafeInteger(Number(identity.inputEpoch))
        && Number.isSafeInteger(Number(identity.intentRevision))
        && Number.isSafeInteger(Number(identity.presentationRevision))
        && Number.isSafeInteger(Number(identity.generation))
        && Number.isSafeInteger(Number(identity.authorityRevision))
        && typeof identity.tailID === 'string'
        && Number.isSafeInteger(Number(identity.rootIdentity));
      const identityCurrent = identityComplete
        && String(identity.activationID || '') === String(controller.activationID)
        && Number(identity.inputEpoch) === Number(current.inputEpoch)
        && Number(identity.intentRevision) === Number(current.intentRevision)
        && Number(identity.presentationRevision) === currentPresentationRevision
        && Number(identity.generation) === Number(committedHistory.generation || 0)
        && Number(identity.authorityRevision) === Number(committedHistory.notificationAuthorityRevision || 0)
        && String(identity.tailID || '') === String(committedSnapshot.rows?.at(-1)?.id || '')
        && Number(identity.rootIdentity) > 0
        && Number(observation.rootIdentity) === Number(identity.rootIdentity);
      const observationRevisionCurrent = Number.isFinite(observedPresentationRevision)
        && observedPresentationRevision === currentPresentationRevision
        && Number.isFinite(observedDomPresentationRevision)
        && observedDomPresentationRevision === currentPresentationRevision;
      const currentTailID = String(committedSnapshot.rows?.at(-1)?.id || '');
      const tailFence = !observation.atTail || visibleRowIDs.includes(currentTailID);
      const highSeq = Number(observation.installedHighSeq);
      const highSeqFence = !observation.atTail
        || (Number.isSafeInteger(highSeq) && highSeq > 0
          && (Number(committedHistory.headSeq || 0) <= 0
            || highSeq <= Number(committedHistory.headSeq || 0)));
      const hitTestRows = new Set((Array.isArray(observation.visibleRows)
        ? observation.visibleRows
        : [])
        .map((row) => typeof row === 'string' ? row : row?.messageID || row?.id)
        .map((id) => String(id || ''))
        .filter(Boolean));
      const evidenceComplete = typeof observation.surfaceVisible === 'boolean'
        && typeof observation.atTail === 'boolean'
        && typeof observation.settled === 'boolean'
        && typeof observation.tailID === 'string'
        && observation.rootNode != null
        && Number.isSafeInteger(Number(observation.installedHighSeq))
        && Number.isSafeInteger(Number(observation.rootIdentity))
        && Array.isArray(observation.visibleRows)
        && observation.visibleRows.length > 0
        && visibleRowIDs.length > 0
        && visibleRowIDs.every((id) => hitTestRows.has(id))
        && String(observation.tailID) === currentTailID;
      const evidenceCurrent = evidenceComplete
        && hasInputEpoch
        && inputEpoch === Number(current.inputEpoch)
        && identityCurrent
        && observationRevisionCurrent;
      const settledCurrent = observation.settled !== true
        || (evidenceCurrent
          && observation.surfaceVisible === true
          && tailFence
          && highSeqFence);
      if (typeof observation.activationID !== 'string'
        || observation.activationID !== controller.activationID
        || !evidenceCurrent
        || !settledCurrent) return false;
      // Preserve the exact DOM hit-test handoff for the opt-in Reading trace.
      // The session remains the semantic owner; this is evidence only, so a
      // visible row cannot by itself mint following authority or a scroll.
      readingTrace('reading.observation', {
        activationID: controller.activationID,
        inputEpoch,
        source: String(observation.source || ''),
        settled: observation.settled === true,
        atTail: observation.atTail === true,
        surfaceVisible: observation.surfaceVisible === true,
        presentationRevision: observedPresentationRevision,
        domPresentationRevision: observedDomPresentationRevision,
        rootIdentity: Number(observation.rootIdentity),
        tailID: String(observation.tailID),
        installedHighSeq: Number(observation.installedHighSeq),
        authorityVerified: true,
        observationIdentity: observation.observationIdentity,
        visibleRowIDs,
      });
      if (observation.surfaceVisible !== true
        || visibilityBoundaryRef.current.documentVisible !== true
        || visibilityBoundaryRef.current.surfaceVisible !== true) {
        const cleared = Object.freeze({
          activationID: controller.activationID,
          inputEpoch: Number(current.inputEpoch),
          rootIdentity: 0,
          rootNode: null,
          atTail: false,
          settled: false,
          surfaceVisible: false,
          installedHighSeq: 0,
          generation: 0,
          headSeq: 0,
          presentationRevision: 0,
          domPresentationRevision: 0,
          observationPresentationRevision: 0,
          observationIdentity: null,
          visibleRowIDs: Object.freeze([]),
          tailID: '',
          authorityVerified: false,
          sourceRevision: 0,
          authorityRevision: 0,
          geometryRevision: 0,
        });
        if (!sameTailEvidence(cleared, observationRef.current)) {
          observationRef.current = cleared;
          setObservationRevision((value) => value + 1);
        }
        return true;
      }
      // The DOM callback may race unmount/suspension in the same task. Do not
      // install evidence when the session controller no longer accepts the
      // semantic update; the next mounted paint must establish a new receipt.
      if (!controller.isStarted()) return false;
      const committed = controller.update((active) => observeReading(active, {
        ...observation,
        activationID: observation.activationID,
        inputEpoch,
      }));
      const committedSession = controller.getSnapshot().session;
      if (!committed
        || committedSession.activationID !== controller.activationID
        || Number(committedSession.inputEpoch) !== inputEpoch) return false;
      const nextEvidence = Object.freeze({
        activationID: controller.activationID,
        inputEpoch,
        rootIdentity: Number(observation.rootIdentity),
        rootNode: observation.rootNode,
        atTail: observation.atTail === true,
        settled: observation.settled === true,
        surfaceVisible: true,
        installedHighSeq: Number(observation.installedHighSeq),
        generation: Number(committedHistory.generation || 0),
        headSeq: Number(committedHistory.headSeq || 0),
        presentationRevision: Number(committedHistory.presentationRevision || 0),
        domPresentationRevision: observedDomPresentationRevision,
        observationPresentationRevision: observedPresentationRevision,
        observationIdentity: identity,
        visibleRowIDs,
        tailID: String(observation.tailID),
        authorityVerified: true,
        sourceRevision: Number(committedSnapshot.sourceRevision || 0),
        authorityRevision: Number(committedHistory.notificationAuthorityRevision || 0),
        geometryRevision: Number(observation.geometryRevision),
      });
      if (!sameTailEvidence(nextEvidence, observationRef.current)) {
        observationRef.current = nextEvidence;
        setObservationRevision((value) => value + 1);
      }
      return true;
    },
    onReadingSample(observation = {}) {
      if (observation.type !== 'reading-sample'
        || typeof observation.activationID !== 'string'
        || observation.activationID !== controller.activationID) return false;
      const inputEpoch = Number(observation.inputEpoch);
      if (!Number.isSafeInteger(inputEpoch)
        || inputEpoch !== Number(controller.getSnapshot().session.inputEpoch)
        || !controller.isStarted()) return false;
      const committed = controller.update((active) => observeReading(active, {
        ...observation,
        activationID: observation.activationID,
        inputEpoch,
      }));
      const committedSession = controller.getSnapshot().session;
      return Boolean(committed)
        && committedSession.activationID === controller.activationID
        && Number(committedSession.inputEpoch) === inputEpoch;
    },
    onReadingRootActivation,
    onPresentationMaterialized(observation = {}) {
      return observation.activationID === controller.activationID
        && Number(observation.presentationRevision) === Number(snapshotRef.current.revision || 0);
    },
    onSurfaceVisibilityChange(visible) {
      const nextVisible = visible === true;
      advanceVisibilityEpoch({ surfaceVisible: nextVisible });
      const currentEpoch = Number(controller.getSnapshot().session.inputEpoch || 0);
      if (visible) {
        const reentering = observationRef.current.surfaceVisible !== true;
        // ReadingContainerHandoff observes the whole reading object. Mark the
        // transition before updating the session so the new object cannot
        // replay this same re-entry boundary on its next effect pass.
        if (reentering) {
          observationRef.current = Object.freeze({
            activationID: controller.activationID,
            inputEpoch: currentEpoch,
            rootIdentity: 0,
            rootNode: null,
            atTail: false,
            settled: false,
            surfaceVisible: true,
            installedHighSeq: 0,
            generation: 0,
            headSeq: 0,
            presentationRevision: 0,
            domPresentationRevision: 0,
            observationPresentationRevision: 0,
            observationIdentity: null,
            visibleRowIDs: Object.freeze([]),
            tailID: '',
            authorityVerified: false,
            sourceRevision: 0,
            authorityRevision: 0,
            geometryRevision: 0,
          });
          setObservationRevision((value) => value + 1);
        }
        // The shared effective-visibility fence above mints this re-entry
        // once. A document edge and this surface edge therefore cannot each
        // advance the same session boundary.
        return;
      }
      if (observationRef.current.atTail === false
        && observationRef.current.surfaceVisible === false) return;
      // Hidden is a lease boundary even without native input. The shared
      // effective-visibility fence minted the epoch synchronously above.
      observationRef.current = Object.freeze({
        activationID: controller.activationID,
        inputEpoch: currentEpoch,
        rootIdentity: 0,
        rootNode: null,
        atTail: false,
        settled: false,
        surfaceVisible: false,
        installedHighSeq: 0,
        generation: 0,
        headSeq: 0,
        presentationRevision: 0,
        domPresentationRevision: 0,
        observationPresentationRevision: 0,
        observationIdentity: null,
        visibleRowIDs: Object.freeze([]),
        tailID: '',
        authorityVerified: false,
        sourceRevision: 0,
        authorityRevision: 0,
        geometryRevision: 0,
      });
      setObservationRevision((value) => value + 1);
    },
    consumeBottomIntent(intent) {
      const before = controller.getSnapshot().session;
      return controller.update((current) => consumeLatestIntent(current, { ...intent, activationID: controller.activationID })) !== before;
    },
    jumpToLatest() {
      onScopeHandoffCancel?.('latest-button');
      requestBottom('latest');
      void Promise.resolve(history.refreshLatest?.()).catch((error) => diagnostic('warn', 'history.latest_refresh_failed', { channelId: channelID, error }));
    },
    cancelScopeHandoff(reason = 'explicit-latest') {
      onScopeHandoffCancel?.(reason);
      return true;
    },
    requestBottom,
    captureBottomIntent,
    bindBottomIntentTargets(expected, messageIDs) {
      const before = controller.getSnapshot().session;
      return controller.update((current) => bindLatestIntentTargets(current, expected, messageIDs)) !== before;
    },
    revokeBottomIntent(expected) {
      const current = controller.getSnapshot().session;
      if (!expected || expected.activationID !== current.activationID || Number(expected.inputEpoch) !== current.inputEpoch) return false;
      return controller.update((active) => consumeLatestIntent(active, { id: active.bottomIntent.id, inputEpoch: active.inputEpoch, activationID: active.activationID })) !== current;
    },
    isFollowing: () => controller.getSnapshot().session.mode === READING_MODE.following,
    getSession: () => controller.getSnapshot().session,
  }), [
    advanceVisibilityEpoch, arrivals?.events?.length, authoritativeEmpty, availability, availabilityError, beginNavigation,
    bottomReady, cancelHistoryStart, cancelNavigation, captureBottomIntent, captureContentAnchorForReading, channelID, controller,
    acceptHistoryPositionLease, consumeContentAnchorCommand, consumeHistoryPositionLease,
    acceptScopeHandoff,
    currentAdmissionAuthority, getContentAnchorCommand, historyPositionLeaseCommand,
    revokeHistoryPositionLease,
    history, historyBoundary, historyConsumer, historyStatus,
    failHistoryStart, historyStartCommand, onHistoryStartEvidence, presentationAuthority, presentationInitializing, requestBottom, requestHistory,
    restorePending, session, syncObservationCurrent, syncStatus.error, tailCaughtUp,
    onReadingRootActivation, onScopeHandoffCancel,
  ]);
}
export function useConversationProjection({
  state,
  history,
  viewSessions,
  historyViewSpec,
  messageListKey,
  timelineLocalEchoes,
  identityPending,
  surfaceVisible,
  onTailCaughtUp,
}) {
  const presentationRef = useRef(null);
  const tailReceiptRef = useRef(null);
  // Cross-messageListKey reading continuity is a one-document successor
  // handoff. It is deliberately not stored in viewSessions and is never
  // represented as a durable bookmark.
  const scopeHandoffRef = useRef(null);
  const previousScopeRef = useRef(null);
  const cancelScopeHandoff = useCallback((reason = 'cancelled') => {
    const handoff = scopeHandoffRef.current;
    const latestTakeover = ['latest-intent', 'latest-button', 'composer-send-start'].includes(reason);
    if (latestTakeover && handoff?.returnView) {
      // Keep only an ephemeral terminal marker until the source view is back.
      // The source owner then consumes the existing bottom command, so a
      // reused physical root cannot leave the old browsing row visible.
      scopeHandoffRef.current = Object.freeze({
        ...handoff,
        cancelledLatest: true,
        cancelReason: String(reason),
      });
      return;
    }
    scopeHandoffRef.current = null;
  }, []);
  const tailCallbackRef = useRef(onTailCaughtUp);
  useLayoutEffect(() => {
    tailCallbackRef.current = onTailCaughtUp;
  }, [onTailCaughtUp]);
  const revokeTailLease = useCallback((receipt) => {
    tailReceiptRef.current = receipt;
    tailCallbackRef.current?.(receipt);
  }, []);
  if (!presentationRef.current) presentationRef.current = createConversationPresentation();
  const [commitVersion, setCommitVersion] = useState(0);
  const projectionVersion = state._timelineProjectionVersion ?? state.lastSeq;
  const contentVersion = state._timelineRevision ?? state.lastSeq;
  const projection = useMemo(() => {
    const admission = history.status?.presentationAdmission;
    let admissionCandidate = null;
    let presentationCandidate = null;
    const presentation = presentationRef.current;
    const renderAdmission = admission?.evaluate ? {
      admit(channelID, items, meta) {
        admissionCandidate = admission.evaluate(channelID, items, meta);
        return admissionCandidate.items;
      },
      sourceFence(channelID) {
        return admission.sourceFence?.(channelID);
      },
    } : admission;
    const renderPresentation = presentation.evaluate ? {
      project(items, meta) {
        presentationCandidate = presentation.evaluate(items, meta);
        return presentationCandidate.snapshot;
      },
    } : presentation;
    return {
      ...projectTimeline(state, {
        ...historyViewSpec,
        presentation: renderPresentation,
        presentationKey: messageListKey,
        dataEpoch: `${state.channelId}:${history.status?.generation || 0}`,
        localEchoes: timelineLocalEchoes,
        presentationAdmission: renderAdmission,
      }),
      admissionCandidate,
      presentationCandidate,
    };
  }, [
    state, projectionVersion, contentVersion, historyViewSpec, messageListKey,
    history.status?.generation, history.status?.presentationAdmission,
    history.status?.presentationAdmissionState?.phase,
    commitVersion, timelineLocalEchoes,
  ]);
  const historyReveal = history.status?.presentationAdmissionState?.phase === 'committed-awaiting-layout'
    ? history.status.presentationAdmissionState.committed
    : null;
  const arrivals = useTimelineArrivalReceipt(state);
  const viewport = useProjectionReadingOwner({
    channelID: state.channelId,
    viewKey: messageListKey,
    snapshot: projection.presentation,
    history: { ...history, status: { ...history.status, historyReveal } },
    viewSessions,
    historyViewSpec,
    surfaceVisible,
    arrivals,
    onTailLeaseRevoke: revokeTailLease,
    onScopeHandoffCancel: cancelScopeHandoff,
  });
  useLayoutEffect(() => {
    const previous = previousScopeRef.current;
    if (previous?.channelID !== state.channelId) {
      scopeHandoffRef.current = null;
    } else if (previous && previous.viewKey !== messageListKey) {
      const existing = scopeHandoffRef.current;
      if (existing) {
        // Keep the original source/return identity. `throughView` records the
        // latest intermediate presentation but never grants it a lease.
        if (messageListKey !== existing.returnView) {
          scopeHandoffRef.current = Object.freeze({
            ...existing,
            throughView: String(messageListKey),
          });
        }
      } else {
        const sourceSession = previous.viewport?.getSession?.() || previous.viewport?.session;
        const bookmark = sourceSession?.bookmark;
        const sourceRowID = String(bookmark?.messageID || '');
        const viewportOffset = Number(bookmark?.rowViewportOffset ?? bookmark?.viewportOffset);
        const sourceRows = previous.snapshot?.rows || [];
        const sourceRowExists = sourceRows.some((row) => String(row?.id || '') === sourceRowID);
        const sourceGeneration = Number(previous.generation || 0);
        const sourceRevision = Number(previous.snapshot?.sourceRevision || 0);
        const sourceActivationID = String(previous.viewport?.activationID || sourceSession?.activationID || '');
        const sourceInputEpoch = Number(sourceSession?.inputEpoch);
        if (sourceSession?.mode === READING_MODE.browsing
          && sourceRowID
          && sourceRowExists
          && Number.isFinite(viewportOffset)
          && sourceActivationID
          && Number.isSafeInteger(sourceInputEpoch)
          && Number.isSafeInteger(sourceGeneration)) {
          scopeHandoffRef.current = Object.freeze({
            channel: String(state.channelId),
            fromView: String(previous.viewKey),
            throughView: String(messageListKey),
            returnView: String(previous.viewKey),
            rowID: sourceRowID,
            viewportOffset,
            sourceRevision,
            sourceActivationID,
            sourceInputEpoch,
            generation: sourceGeneration,
          });
        }
      }
    }
    previousScopeRef.current = Object.freeze({
      channelID: String(state.channelId),
      viewKey: String(messageListKey),
      viewport,
      snapshot: projection.presentation,
      generation: Number(history.status?.generation || 0),
    });
  }, [history.status?.generation, messageListKey, projection.presentation, state.channelId, viewport]);
  useLayoutEffect(() => {
    const handoff = scopeHandoffRef.current;
    if (!handoff) return;
    const generation = Number(history.status?.generation || 0);
    if (String(handoff.channel || '') !== String(state.channelId)
      || Number(handoff.generation) !== generation) {
      scopeHandoffRef.current = null;
      return;
    }
    if (String(handoff.returnView || '') !== String(messageListKey)) return;
    if (handoff.cancelledLatest === true) {
      // The explicit latest/send takeover happened in the intermediate view.
      // Reuse the current owner and its sole Vendor writer to settle the
      // source view at the tail; do not replay the old position lease.
      viewport.requestBottom?.('scope-handoff-cancelled');
      return;
    }
    const accepted = viewport.acceptScopeHandoff?.(handoff) === true;
    if (accepted) scopeHandoffRef.current = null;
  }, [history.status?.generation, messageListKey, projection.presentation, state.channelId, viewport.acceptScopeHandoff, viewport.activationID, viewport.requestBottom, viewport.session.inputEpoch]);
  useLayoutEffect(() => {
    const admission = history.status?.presentationAdmission;
    const admissionState = admission?.snapshot?.(state.channelId);
    let presentationGrant = null;
    if (admissionState?.phase === 'committed-awaiting-layout') {
      const validation = admission.validatePresentation?.(
        state.channelId,
        projection.admissionCandidate,
        projection.presentationCandidate?.snapshot,
        viewport.currentAdmissionAuthority?.(),
      );
      diagnostic('debug', 'history.admission_commit_check', {
        channelId: state.channelId,
        operationID: admissionState.committed?.operationID || '',
        accepted: validation?.accepted === true,
        reason: validation?.reason || '',
        presentationRevision: projection.presentationCandidate?.snapshot?.revision || 0,
        inserted: projection.presentationCandidate?.snapshot?.changes?.frontInsertedIDs || [],
        staged: admissionState.committed?.stagedIDs || [],
        backInsertedIDs: projection.presentationCandidate?.snapshot?.changes?.backInsertedIDs || [],
        updated: projection.presentationCandidate?.snapshot?.changes?.updated || [],
        removed: projection.presentationCandidate?.snapshot?.changes?.removed || [],
        tokenInputEpoch: admissionState.committed?.inputEpoch,
      });
      if (validation?.accepted !== true) {
        if (validation?.reason !== 'stale-transaction') {
          admission.rejectPresentation?.(state.channelId, admissionState.committed);
        }
        setCommitVersion((value) => value + 1);
        return;
      }
      presentationGrant = validation.grant;
    }
    const commitToken = presentationGrant?.commitToken;
    const viewportOffset = Number(commitToken?.viewportOffset);
    const positionLease = presentationGrant && Number.isFinite(viewportOffset) && commitToken?.messageID
      ? Object.freeze({
        type: 'position-row',
        activationID: commitToken.activationID,
        inputEpoch: commitToken.inputEpoch,
        intentRevision: commitToken.intentRevision,
        operationID: commitToken.operationID,
        viewID: commitToken.viewID,
        epoch: commitToken.epoch,
        presentationRevision: presentationGrant.presentationRevision,
        messageID: commitToken.messageID,
        viewportOffset,
      }) : null;
    if (positionLease && viewport.acceptHistoryPositionLease?.(positionLease) !== true) {
      admission.rejectPresentation?.(state.channelId, commitToken);
      setCommitVersion((value) => value + 1);
      return;
    }
    let presentationCommitted = true;
    if (projection.presentationCandidate) {
      presentationCommitted = presentationRef.current.commitCandidate(projection.presentationCandidate);
      if (!presentationCommitted && presentationRef.current.current() !== projection.presentation) {
        setCommitVersion((value) => value + 1);
      }
    }
    if (!presentationCommitted || !projection.admissionCandidate) {
      if (positionLease) viewport.revokeHistoryPositionLease?.(positionLease, { clearHistoryAnchor: true });
      return;
    }
    if (presentationGrant) {
      if (admission.commitPresentationGrant?.(state.channelId, presentationGrant) !== true) {
        if (positionLease) viewport.revokeHistoryPositionLease?.(positionLease, { clearHistoryAnchor: true });
        setCommitVersion((value) => value + 1);
        return;
      }
      diagnostic('debug', 'history.admission_commit', {
        channelId: state.channelId,
        operationID: presentationGrant.commitToken.operationID,
        activationID: presentationGrant.commitToken.activationID,
        inputEpoch: presentationGrant.commitToken.inputEpoch,
        intentRevision: presentationGrant.commitToken.intentRevision,
        presentationRevision: presentationGrant.presentationRevision,
        stagedIDs: presentationGrant.commitToken.stagedIDs || [],
        positionLease: positionLease ? {
          messageID: positionLease.messageID,
          viewportOffset: positionLease.viewportOffset,
        } : null,
      });
      traceReadingOwnerCommit({
        channelID: state.channelId,
        viewKey: messageListKey,
        viewport,
        snapshot: presentationRef.current.current(),
      });
      return;
    }
    const admissionCommitted = admission?.commitCandidate?.(state.channelId, projection.admissionCandidate);
    if (admissionCommitted !== true && projection.admissionCandidate?.receipt) {
      setCommitVersion((value) => value + 1);
      return;
    }
    if (admissionCommitted === true
      && admission.snapshot?.(state.channelId)?.phase === 'pending-baseline-commit') {
      admission.prepareCommit?.(state.channelId, presentationRef.current.current());
    }
    traceReadingOwnerCommit({
      channelID: state.channelId,
      viewKey: messageListKey,
      viewport,
      snapshot: presentationRef.current.current(),
    });
  }, [
    history.status?.presentationAdmission,
    projection.admissionCandidate,
    projection.presentation,
    projection.presentationCandidate,
    state.channelId,
    viewport.acceptHistoryPositionLease,
    viewport.activationID,
    viewport.currentAdmissionAuthority,
    viewport.revokeHistoryPositionLease,
    viewport.session.inputEpoch,
    viewport.session.intentRevision,
  ]);
  useLayoutEffect(() => {
    history.status?.presentationAdmission?.reconcileCurrent?.(state.channelId, {
      viewID: messageListKey,
      epoch: `${state.channelId}:${history.status?.generation || 0}`,
    });
  }, [history.status?.generation, history.status?.presentationAdmission, messageListKey, state.channelId]);
  useEffect(() => () => {
    history.status?.presentationAdmission?.reset?.(state.channelId);
  }, [history.status?.presentationAdmission, state.channelId]);
  useLayoutEffect(() => {
    if (history.status?.presentationAdmissionState?.phase !== 'pending-baseline-commit') return;
    history.status?.presentationAdmission?.prepareCommit?.(
      state.channelId,
      presentationRef.current.current(),
    );
  }, [
    history.status?.presentationAdmission,
    history.status?.presentationAdmissionState?.phase,
    projection.presentation,
    state.channelId,
  ]);
  const livePresentationArrivals = usePresentationArrivalReceipt({
    state,
    viewKey: messageListKey,
    surfaceVisible,
    sourceRevision: projection.presentation?.sourceRevision,
    presentation: projection.presentation,
    presentationOwner: presentationRef.current,
  });
  useLayoutEffect(() => {
    if (typeof onTailCaughtUp !== 'function') return undefined;
    const previous = tailReceiptRef.current;
    const next = viewport.tailCaughtUp;
    tailReceiptRef.current = next;
    if (next.caughtUp === true) {
      const enteringTail = previous?.caughtUp !== true;
      if (enteringTail && Number(next.entryBoundary || 0) > 0) {
        const boundary = Number(next.entryBoundary);
        onTailCaughtUp(Object.freeze({
          ...next,
          cause: 'tail-backlog',
          captured: Object.freeze({ ...next.captured, installedHighSeq: boundary }),
          installedHighSeq: boundary,
          boundary,
        }));
      } else {
        onTailCaughtUp(next);
      }
    } else if (previous?.caughtUp === true
      && (next.following !== true || next.atTail !== true || next.surfaceVisible !== true)) {
      // A stale status/head render while following keeps the observation
      // lease alive until the next DOM sample. Retract only after the
      // committed reader leaves its physical visible tail.
      onTailCaughtUp(typedTailLeaseRevoke(
        previous,
        next.surfaceVisible === true ? 'physical-leave' : 'surface-hidden',
        next.inputEpoch,
        { advanceEpoch: next.surfaceVisible !== true },
      ));
    }
    return undefined;
  }, [onTailCaughtUp, viewport.tailCaughtUp]);
  useLayoutEffect(() => () => {
    const receipt = tailReceiptRef.current;
    if (receipt?.caughtUp !== true || typeof tailCallbackRef.current !== 'function') return;
    tailCallbackRef.current(typedTailLeaseRevoke(
      receipt,
      'activation-cleanup',
      undefined,
      { advanceEpoch: true },
    ));
  }, [state.channelId, viewport.activationID, messageListKey]);
  const latestRowID = viewport.presentationAuthority?.candidateID || '';
  useColdEntryDiagnostics({
    channelId: state.channelId,
    viewKey: messageListKey,
    selfReady: !identityPending,
    surfaceVisible,
    presentation: projection.presentation,
    reading: viewport,
    history,
  });
  const [browsingFoldLease, setBrowsingFoldLease] = useState(emptyBrowsingFoldLease);
  useLayoutEffect(() => {
    setBrowsingFoldLease((current) => reconcileBrowsingFoldLease(current, {
      activationID: viewport.activationID,
      mode: viewport.session.mode,
      rows: projection.presentation.rows,
      latestRowID,
      bookmarkID: viewport.session.bookmark?.messageID || '',
    }));
  }, [
    projection.presentation,
    latestRowID,
    viewport.activationID,
    viewport.session.bookmark?.messageID,
    viewport.session.mode,
  ]);
  const browsingExpandedSlots = useMemo(() => (
    viewport.session.mode === READING_MODE.browsing
      && browsingFoldLease.activationID === viewport.activationID
      ? new Set(browsingFoldLease.visualSlotIDs)
      : new Set()
  ), [browsingFoldLease, viewport.activationID, viewport.session.mode]);
  return {
    projection,
    viewport,
    latestRowID,
    browsingExpandedSlots,
    livePresentationArrivals,
  };
}
