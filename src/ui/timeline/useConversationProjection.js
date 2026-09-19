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
import { createConversationPresentation } from '../../model/conversation-presentation.js';
import { diagnostic } from '../../model/diagnostics.js';
import { HISTORY_URGENCY } from '../../model/history-demand.js';
import {
  bindLatestIntentTargets,
  cancelReadingControl,
  consumeLatestIntent,
  createReadingSession,
  observeReading,
  persistentReadingSession,
  READING_MODE,
  requestLatest,
  takeReadingControl,
  updateReadingControl,
} from '../../model/reading-session.js';
import { projectTimeline } from '../../model/timeline-projection.js';
import { newId } from '../../util/id.js';
import { useColdEntryDiagnostics } from './useColdEntryDiagnostics.js';
import { currentEntryAuthority } from './dom-evidence-adapter.js';
import { HISTORY_CONSUMER } from './history-consumer-obligation.js';
import { useHistoryConsumer, useReadingInitialization } from './useHistoryConsumer.js';
import { usePresentationArrivalReceipt, useTimelineArrivalReceipt } from './useLiveArrivalReceipts.js';

const IDLE_HISTORY_DEMAND = Object.freeze({ revision: 0, phase: 'idle', error: '' });
const HISTORY_RUNWAY_REVEAL_RECORDS = 8;
const HISTORY_RUNWAY_REVEAL_BYTES = 256 * 1024;

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
}) {
  const historyStatus = history.status || history || {};
  const requestPort = typeof history.request === 'function'
    ? history.request
    : () => Promise.resolve({ kind: 'exhausted', localOnly: true });
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
  const observationRef = useRef({ atTail: false, surfaceVisible: false });
  const [observationRevision, setObservationRevision] = useState(0);
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
  useEffect(() => {
    if (session.mode !== READING_MODE.following || surfaceVisible !== true) return;
    arrivals?.acknowledge?.(Number(arrivals.revision || 0));
  }, [arrivals, session.mode, surfaceVisible]);

  const hasManagedHistoryLifecycle = Object.prototype.hasOwnProperty.call(historyStatus, 'attached')
    && Object.prototype.hasOwnProperty.call(historyStatus, 'messageCurrent')
    && Object.prototype.hasOwnProperty.call(historyStatus, 'headSeq');
  const syncStatus = historyStatus.sync || {};
  const syncObservationCurrent = !Object.prototype.hasOwnProperty.call(historyStatus, 'sync')
    || (Number(syncStatus.interestRevision || 0) > 0
      && Number(syncStatus.fulfilledRevision || 0) >= Number(syncStatus.interestRevision || 0));
  const knownHead = Math.max(Number(historyStatus.headSeq || 0), Number(syncStatus.targetHead || 0));
  const currentPresentationKnown = Number(historyStatus.presentationRevision || 0) <= 0
    || Number(snapshot.sourceRevision || 0) >= Number(historyStatus.presentationRevision || 0);
  const bottomReady = !hasManagedHistoryLifecycle || Boolean(
    historyStatus.attached === true
    && Number(historyStatus.generation || 0) > 0
    && historyStatus.messageCurrent === true
    && currentPresentationKnown,
  );
  const authoritativeEmpty = hasManagedHistoryLifecycle
    && historyStatus.attached === true
    && Number(historyStatus.generation || 0) > 0
    && historyStatus.messageCurrent === true
    && historyStatus.localReplicaReady !== false
    && knownHead === 0
    && syncObservationCurrent;
  const semanticRangeEstablished = !hasManagedHistoryLifecycle
    || historyStatus.loaded === true
    || Number(historyStatus.completedPages || 0) > 0;
  const semanticExhausted = hasManagedHistoryLifecycle
    && semanticRangeEstablished
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
    hasManagedHistoryLifecycle,
    authoritativeEmpty,
    semanticExhausted,
    channelID,
    viewKey,
  });
  const availabilityError = String(
    historyStatus.historyDemand?.error
    || syncStatus.error
    || historyStatus.localReplicaError
    || historyStatus.error
    || '',
  );
  const availability = snapshot.rows.length
    ? 'readable'
    : availabilityError
      ? 'error'
      : !hasManagedHistoryLifecycle || authoritativeEmpty || semanticExhausted
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
    hasManagedHistoryLifecycle,
    knownHead,
    history,
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
    const current = controller.getSnapshot().session;
    if (!controller.isStarted() || (expected && (
      expected.activationID !== current.activationID
      || Number(expected.inputEpoch) !== current.inputEpoch
      || Number(expected.intentRevision) !== current.intentRevision
      || expected.mode !== current.mode
    ))) return false;
    controller.update((active) => requestLatest(active, `${reason}:${newId()}`, target || undefined));
    return true;
  }, [controller]);
  const beginNavigation = useCallback((input = {}) => {
    const next = controller.update((current) => takeReadingControl(current, input));
    return Object.freeze({ inputGeneration: next.inputEpoch });
  }, [controller]);
  const updateNavigation = useCallback((input = {}) => {
    const before = controller.getSnapshot().session;
    const after = controller.update((current) => updateReadingControl(current, {
      inputEpoch: input.inputGeneration,
      direction: input.direction,
      gestureID: input.gestureID,
      geometryRevision: input.geometryRevision,
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
  const currentAdmissionAuthority = useCallback(() => {
    const owner = committedOwnerRef.current;
    return Object.freeze({
      activationID: owner.activationID,
      inputEpoch: owner.session.inputEpoch,
      viewID: owner.viewKey,
      epoch: `${owner.channelID}:${Number(owner.historyStatus.generation || 0)}`,
    });
  }, []);
  const tailCaughtUp = useMemo(() => Object.freeze({
    channelId: channelID,
    caughtUp: session.mode === READING_MODE.following
      && observationRef.current.atTail === true
      && observationRef.current.surfaceVisible === true,
    scope: historyViewSpec?.scope || '',
    actorFiltered: Number(historyViewSpec?.actorFilter?.size || 0) > 0,
  }), [channelID, historyViewSpec, observationRevision, session.mode]);

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
    cache: Object.freeze({ phase: historyStatus.localReplicaReady === false ? 'pending' : historyStatus.localReplicaError ? 'error' : 'current', error: String(historyStatus.localReplicaError || ''), code: String(historyStatus.localReplicaErrorCode || '') }),
    status: historyStatus,
    historyDemand: ['pending', 'error'].includes(historyStatus.historyDemand?.phase)
      ? historyStatus.historyDemand
      : IDLE_HISTORY_DEMAND,
    historyBoundary,
    historyReveal: historyStatus.historyReveal || null,
    currentAdmissionAuthority,
    acknowledgeHistoryReveal(commitID) { return historyStatus.presentationAdmission?.acknowledge?.(channelID, commitID) === true; },
    requestHistory,
    retryHistoryDemand: historyConsumer.retry,
    retryAvailability: historyConsumer.retryAvailability,
    onAtTop(detail = {}) { return requestHistory('top', HISTORY_URGENCY.interactive, detail); },
    onNearTop(detail = {}) { return requestHistory('runway', HISTORY_URGENCY.anticipatory, { ...detail, revealRows: HISTORY_RUNWAY_REVEAL_RECORDS, revealBytes: HISTORY_RUNWAY_REVEAL_BYTES }); },
    onUnderfill(detail = {}) { return requestHistory('underfill', HISTORY_URGENCY.anticipatory, { ...detail, consumer: HISTORY_CONSUMER.viewportUnderfill }); },
    beginNavigation,
    updateNavigation,
    finishNavigation(input = {}) { return Number(input.inputGeneration) === controller.getSnapshot().session.inputEpoch; },
    cancelNavigation,
    onReadingObservation(observation = {}) {
      if (observation.activationID && observation.activationID !== controller.activationID
        || observation.surfaceVisible !== true) return controller.getSnapshot().session;
      controller.update((current) => observeReading(current, { ...observation, activationID: controller.activationID }));
      const nextEvidence = { atTail: observation.atTail === true, surfaceVisible: true };
      if (nextEvidence.atTail !== observationRef.current.atTail
        || nextEvidence.surfaceVisible !== observationRef.current.surfaceVisible) {
        observationRef.current = nextEvidence;
        setObservationRevision((value) => value + 1);
      }
      return controller.getSnapshot().session;
    },
    onPresentationMaterialized(observation = {}) {
      return observation.activationID === controller.activationID
        && Number(observation.presentationRevision) === Number(snapshotRef.current.revision || 0);
    },
    onSurfaceVisibilityChange(visible) {
      if (visible) return;
      if (observationRef.current.atTail === false
        && observationRef.current.surfaceVisible === false) return;
      observationRef.current = { atTail: false, surfaceVisible: false };
      setObservationRevision((value) => value + 1);
    },
    consumeBottomIntent(intent) {
      const before = controller.getSnapshot().session;
      return controller.update((current) => consumeLatestIntent(current, { ...intent, activationID: controller.activationID })) !== before;
    },
    jumpToLatest() {
      requestBottom('latest');
      void Promise.resolve(history.refreshLatest?.()).catch((error) => diagnostic('warn', 'history.latest_refresh_failed', { channelId: channelID, error }));
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
    arrivals?.events?.length, authoritativeEmpty, availability, availabilityError, beginNavigation,
    bottomReady, cancelNavigation, captureBottomIntent, channelID, controller,
    currentAdmissionAuthority, history, historyBoundary, historyConsumer, historyStatus,
    presentationAuthority, presentationInitializing, requestBottom, requestHistory,
    restorePending, session, syncObservationCurrent, syncStatus.error, tailCaughtUp,
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
  });
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
    let presentationCommitted = true;
    if (projection.presentationCandidate) {
      presentationCommitted = presentationRef.current.commitCandidate(projection.presentationCandidate);
      if (!presentationCommitted && presentationRef.current.current() !== projection.presentation) {
        setCommitVersion((value) => value + 1);
      }
    }
    if (!presentationCommitted || !projection.admissionCandidate) return;
    if (presentationGrant) {
      if (admission.commitPresentationGrant?.(state.channelId, presentationGrant) !== true) {
        setCommitVersion((value) => value + 1);
        return;
      }
      diagnostic('debug', 'history.admission_commit', {
        channelId: state.channelId,
        operationID: presentationGrant.commitToken.operationID,
        activationID: presentationGrant.commitToken.activationID,
        inputEpoch: presentationGrant.commitToken.inputEpoch,
        presentationRevision: presentationGrant.presentationRevision,
        stagedIDs: presentationGrant.commitToken.stagedIDs || [],
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
  }, [
    history.status?.presentationAdmission,
    projection.admissionCandidate,
    projection.presentation,
    projection.presentationCandidate,
    state.channelId,
    viewport.activationID,
    viewport.currentAdmissionAuthority,
    viewport.session.inputEpoch,
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
    onTailCaughtUp(viewport.tailCaughtUp);
    return () => onTailCaughtUp({ ...viewport.tailCaughtUp, caughtUp: false });
  }, [onTailCaughtUp, viewport.tailCaughtUp]);
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
      bookmarkID: viewport.session.bookmark?.messageID || '',
    }));
  }, [
    projection.presentation,
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
