import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HISTORY_INTENT, HISTORY_URGENCY } from '../../model/history-demand.js';
import {
  READING_MODE,
  cancelHistoryStartIntent,
  consumeHistoryStartIntent,
  revokePositionRowLease,
} from '../../model/reading-session.js';
import { diagnostic, readingTrace } from '../../model/diagnostics.js';
import {
  blockingAdmission,
  HISTORY_CONSUMER,
  historyConsumerObligation,
  historyProgressKey,
  historyRevealIntent,
  ownsHistoryOperation,
  historySourceKey,
  historySupplyKey,
} from './history-consumer-obligation.js';

const HISTORY_START_TIMEOUT_MS = 30_000;

function sameHistoryStartIntent(left, right) {
  return Boolean(left && right)
    && left.type === 'history-start' && right.type === 'history-start'
    && String(left.id) === String(right.id)
    && String(left.activationID) === String(right.activationID)
    && String(left.channelID) === String(right.channelID)
    && String(left.viewKey) === String(right.viewKey)
    && Number(left.generation) === Number(right.generation)
    && String(left.sourceLease) === String(right.sourceLease)
    && Number(left.inputEpoch) === Number(right.inputEpoch)
    && Number(left.intentRevision) === Number(right.intentRevision)
    && left.direction === right.direction;
}

function clearHistoryStart(ref, reason = 'cancelled') {
  const pending = ref.current;
  if (!pending) return null;
  if (pending.timer) globalThis.clearTimeout?.(pending.timer);
  ref.current = null;
  return { ...pending, reason };
}

function clearTopContinuation(ref) {
  if (ref.current?.timer) globalThis.clearTimeout?.(ref.current.timer);
  ref.current = null;
}

function cancelPositionLeaseWait(ref, reason, revoke = false) {
  const waiter = ref.current;
  if (!waiter) return;
  if (waiter.timer) globalThis.clearTimeout?.(waiter.timer);
  ref.current = null;
  if (revoke && waiter.lease) {
    waiter.controller.update((active) => revokePositionRowLease(active, waiter.lease, {
      clearHistoryAnchor: true,
    }));
  }
  waiter.resolve?.({ kind: 'cancelled', reason });
}

// Admission publishes the prepended snapshot before Vendor can paint the
// accepted position-row lease. During that handoff the old historyAnchor is
// intentionally absent from the new first-row snapshot. The accepted lease
// is the stronger proof that continuation may wait for the paint fence.
function positionLeaseHandoffReady(session) {
  const lease = session?.positionRowLease;
  return Boolean(lease?.messageID
    && lease.activationID === session.activationID
    && Number(lease.inputEpoch) === Number(session.inputEpoch)
    && Number(lease.intentRevision) === Number(session.intentRevision)
    && Number.isFinite(Number(lease.viewportOffset)));
}

// A sparse filtered page is allowed to continue only while the exact
// Reading/physical boundary that issued it is still current.  These values
// are observations or lifecycle identities, never progress counters.  Keep
// the validation local to the existing history consumer; the values are
// supplied by the projection Reading owner and are not persisted.
function isValidContinuationLineage({ controller, activationID, channelID, viewKey,
  inputEpoch, intentRevision, gestureID, rootIdentity, visibilityEpoch } = {}) {
  return Boolean(controller
    && activationID
    && channelID
    && viewKey
    && Number.isSafeInteger(Number(inputEpoch))
    && Number.isSafeInteger(Number(intentRevision))
    && typeof gestureID === 'string'
    && gestureID
    && Number.isSafeInteger(Number(rootIdentity))
    && Number(rootIdentity) > 0
    && Number.isSafeInteger(Number(visibilityEpoch))
    && Number(visibilityEpoch) >= 0);
}

export function useReadingInitialization({
  controller,
  session,
  snapshot,
  historyStatus,
  hasManagedHistoryLifecycle,
  authoritativeEmpty,
  semanticExhausted,
  channelID,
  viewKey,
}) {
  const needed = Boolean(
    (session.mode === 'browsing' && session.bookmark
      && !snapshot.rows.some((row) => row.id === session.bookmark.messageID))
    || (session.mode === 'following' && hasManagedHistoryLifecycle),
  );
  const [state, setState] = useState(() => ({ controller, value: needed }));
  const initializing = state.controller === controller ? state.value : needed;
  useEffect(() => {
    if (!initializing) return undefined;
    const bookmark = controller.getSnapshot().session.bookmark;
    const following = controller.getSnapshot().session.mode === 'following';
    if ((following && (snapshot.rows.length > 0 || authoritativeEmpty || semanticExhausted))
      || (!following && (!bookmark
        || snapshot.rows.some((row) => row.id === bookmark.messageID)
        || semanticExhausted))) {
      diagnostic('debug', 'reading.initialization_ready', {
        channelId: channelID, viewKey, mode: following ? 'following' : 'browsing',
        sourceRevision: Number(snapshot.sourceRevision || 0),
        presentationRevision: Number(historyStatus.presentationRevision || 0),
        rowCount: snapshot.rows.length,
      });
      setState({ controller, value: false });
      return;
    }
    return undefined;
  }, [authoritativeEmpty, channelID, controller, historyStatus, initializing, semanticExhausted, snapshot, viewKey]);

  return Object.freeze({
    initializing,
    presentationInitializing: initializing && snapshot.rows.length === 0 && !authoritativeEmpty,
    restorePending: initializing && session.mode === 'browsing',
  });
}

export function useHistoryConsumer({
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
  getContinuationLineage,
  continuationLineage,
  localReplicaError,
  syncHistoryError,
  foregroundHistoryError,
  blockingHistoryError,
}) {
  const activeRef = useRef(null);
  const deferredAdmissionRef = useRef(null);
  const deferredRecheckRef = useRef(null);
  const failedAnticipatoryRef = useRef(null);
  const terminalRef = useRef(null);
  const topContinuationRef = useRef(null);
  const topBoundaryRef = useRef(null);
  const positionLeaseWaitRef = useRef(null);
  const grantTailRequestRef = useRef(null);
  const epochRef = useRef(0);
  const historyStartRef = useRef(null);
  const [historyStartFailure, setHistoryStartFailure] = useState(null);
  const [historyStartTick, setHistoryStartTick] = useState(0);
  const sourceKey = historySourceKey(historyStatus);
  const supplyKey = historySupplyKey(historyStatus);

  const currentContinuationLineage = (currentSession = controller.getSnapshot().session) => {
    const physical = getContinuationLineage?.() || {};
    return Object.freeze({
      controller,
      activationID: controller.activationID,
      channelID,
      viewKey,
      inputEpoch: Number(currentSession?.inputEpoch),
      intentRevision: Number(currentSession?.intentRevision),
      gestureID: String(currentSession?.historyAnchor?.gestureID || ''),
      rootIdentity: Number(physical.rootIdentity),
      visibilityEpoch: Number(physical.visibilityEpoch),
    });
  };

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal && (terminal.controller !== controller || terminal.sourceKey !== sourceKey)) terminalRef.current = null;
  }, [controller, sourceKey]);

  // Activation replacement is an ownership edge, not an eventual side
  // effect. Publish it before either reading container may establish a DOM
  // consumer debt in its layout effect. A passive reset here used to erase an
  // operation that the newly committed child had already started.
  useLayoutEffect(() => {
    activeRef.current?.abortController?.abort();
    activeRef.current = null;
    deferredAdmissionRef.current = null;
    deferredRecheckRef.current?.resolve?.({ kind: 'cancelled', reason: 'underfill-owner-replaced' });
    deferredRecheckRef.current = null;
    cancelPositionLeaseWait(positionLeaseWaitRef, 'position-lease-owner-replaced', true);
    clearTopContinuation(topContinuationRef);
    topBoundaryRef.current = null;
    grantTailRequestRef.current = null;
    clearHistoryStart(historyStartRef, 'history-start-owner-replaced');
    setHistoryStartFailure(null);
    failedAnticipatoryRef.current = null;
    terminalRef.current = null;
    return () => {
      if (activeRef.current?.controller === controller) {
        activeRef.current.abortController?.abort();
        activeRef.current = null;
      }
      if (deferredAdmissionRef.current?.controller === controller) deferredAdmissionRef.current = null;
      if (deferredRecheckRef.current?.controller === controller) {
        deferredRecheckRef.current.resolve({ kind: 'cancelled', reason: 'underfill-owner-unmounted' });
        deferredRecheckRef.current = null;
      }
      if (positionLeaseWaitRef.current?.controller === controller) {
        cancelPositionLeaseWait(positionLeaseWaitRef, 'position-lease-owner-unmounted', true);
      }
      if (topContinuationRef.current?.controller === controller) {
        clearTopContinuation(topContinuationRef);
      }
      if (topBoundaryRef.current?.controller === controller) topBoundaryRef.current = null;
      clearHistoryStart(historyStartRef, 'history-start-owner-unmounted');
      if (failedAnticipatoryRef.current?.controller === controller) failedAnticipatoryRef.current = null;
    };
  }, [controller]);

  // A Home intent is an ephemeral authority lease. Any channel generation or
  // source-lease replacement retires it before a late page/evidence callback
  // can continue the old walk against the new world.
  useLayoutEffect(() => {
    const pending = historyStartRef.current;
    const intent = session.historyStartIntent;
    if (!pending || !intent) return;
    const current = controller.getSnapshot().session;
    const authorityCurrent = intent.activationID === controller.activationID
      && intent.channelID === channelID
      && intent.viewKey === viewKey
      && Number(intent.generation) === Number(historyStatus.generation || 0)
      && String(intent.sourceLease || '') === String(historyStatus.sourceLease || '')
      && sameHistoryStartIntent(intent, current.historyStartIntent);
    if (authorityCurrent) return;
    pending.abortController?.abort('history-start-authority-replaced');
    clearHistoryStart(historyStartRef, 'history-start-authority-replaced');
    controller.update((active) => cancelHistoryStartIntent(active, active.historyStartIntent));
    setHistoryStartFailure(null);
  }, [channelID, controller, historyStatus.generation, historyStatus.sourceLease, session.historyStartIntent, viewKey]);

  // A continuation is leased to the exact semantic older intent that caused
  // the typed top request. Any newer input, latest intent, direction reversal,
  // or exit from browsing invalidates that lease at the commit boundary before
  // a stale timer can issue another request.
  useLayoutEffect(() => {
    const continuation = topContinuationRef.current;
    if (!continuation) return;
    const liveLineage = currentContinuationLineage();
    const validLiveLineage = isValidContinuationLineage(liveLineage);
    const validContinuation = isValidContinuationLineage(continuation);
    const sparseProof = continuation.stableTopContinuation === true
      && String(snapshotRef.current.rows?.[0]?.id || '')
        === String(continuation.continuationAnchorID || '')
      && Number(snapshotRef.current.rows?.[0]?.seqLow || 0)
        === Number(continuation.continuationAnchorSeq || 0)
      && Number(continuation.continuationFirstVisibleSeq || 0)
        === Number(continuation.continuationAnchorSeq || 0);
    const sameIntent = validLiveLineage
      && validContinuation
      && continuation.controller === controller
      && continuation.activationID === liveLineage.activationID
      && continuation.channelID === liveLineage.channelID
      && continuation.viewKey === liveLineage.viewKey
      && session.mode === READING_MODE.browsing
      && continuation.inputEpoch === liveLineage.inputEpoch
      && continuation.intentRevision === liveLineage.intentRevision
      && continuation.gestureID === liveLineage.gestureID
      && continuation.rootIdentity === liveLineage.rootIdentity
      && continuation.visibilityEpoch === liveLineage.visibilityEpoch
      && continuation.inputEpoch === Number(session.inputEpoch)
      && continuation.intentRevision === Number(session.intentRevision)
      && (continuation.stableTopContinuation !== true || sparseProof)
      && session.tailEvidence?.direction !== 'newer';
    if (!sameIntent) {
      if (positionLeaseWaitRef.current?.controller === controller) {
        cancelPositionLeaseWait(positionLeaseWaitRef, 'position-lease-intent-replaced', true);
      }
      if (topContinuationRef.current === continuation) clearTopContinuation(topContinuationRef);
      if (topBoundaryRef.current === continuation.topBoundary) topBoundaryRef.current = null;
    }
  }, [channelID, controller, currentContinuationLineage, getContinuationLineage,
    session.inputEpoch, session.intentRevision, session.mode, session.tailEvidence,
    continuationLineage?.gestureID, continuationLineage?.rootIdentity,
    continuationLineage?.visibilityEpoch, viewKey]);

  const request = useCallback((reason, urgency = HISTORY_URGENCY.interactive, options = {}) => {
    const {
      revealRows, revealBytes, demandUnits = 1,
      intent = HISTORY_INTENT.scrollHistory, targetSeq = 0,
      requiredVisibleCoverage = null, consumer = '', continuation = false,
      stableTopContinuation = false, continuationAnchorID = '', continuationAnchorSeq = 0,
      continuationFirstVisibleSeq = 0, continuationLease = null,
      historyStartIntent = null, beforeSeq = 0,
    } = options;
    const historyStart = historyStartIntent?.type === 'history-start';
    if (!continuation && committedOwnerRef.current !== commitOwnerCandidate) {
      return Promise.resolve({ kind: 'stale-owner', deduplicated: true });
    }
    const currentSession = controller.getSnapshot().session;
    const firstRowAtStart = snapshotRef.current.rows[0] || null;
    if (!currentSession.positionRowLease
      && positionLeaseWaitRef.current?.controller === controller) {
      cancelPositionLeaseWait(positionLeaseWaitRef, 'position-lease-cleared');
    }
    // A committed prepend owns the next physical boundary until the accepted
    // position-row lease reaches actual paint. Do not let a continuation or a
    // second top/runway request race that one-shot restore. This check must
    // precede continuation's snapshot-anchor fence: Admission publishes the
    // prepended rows before Vendor paints/consumes the exact lease, so the
    // old anchor is necessarily absent from the new snapshot for this brief
    // handoff window.
    if (!historyStart && currentSession.positionRowLease
      && (continuation || reason === 'top' || reason === 'runway')) {
      const existing = positionLeaseWaitRef.current;
      if (existing?.controller === controller) return existing.promise;
      const waiter = {
        controller,
        lease: currentSession.positionRowLease,
        activationID: controller.activationID,
        inputEpoch: Number(currentSession.inputEpoch || 0),
        intentRevision: Number(currentSession.intentRevision || 0),
        reason,
        urgency,
        options,
        continuation,
        attempts: 0,
        timer: null,
        resolve: null,
        promise: null,
      };
      waiter.promise = new Promise((resolve) => { waiter.resolve = resolve; });
      positionLeaseWaitRef.current = waiter;
      const check = () => {
        if (positionLeaseWaitRef.current !== waiter) return;
        waiter.timer = null;
        const live = controller.getSnapshot().session;
        const sameIntent = live.activationID === waiter.activationID
          && live.mode === READING_MODE.browsing
          && Number(live.inputEpoch) === waiter.inputEpoch
          && Number(live.intentRevision) === waiter.intentRevision
          && live.tailEvidence?.direction !== 'newer';
        if (!sameIntent) {
          cancelPositionLeaseWait(positionLeaseWaitRef, 'position-lease-intent-replaced', true);
          return;
        }
        if (!live.positionRowLease) {
          positionLeaseWaitRef.current = null;
          waiter.resolve?.(request(reason, urgency, { ...options, continuation }));
          return;
        }
        // A failed lease may be replaced by the same older intent. Wait on
        // that fresh exact lease rather than replaying a second operation.
        waiter.lease = live.positionRowLease;
        waiter.attempts += 1;
        if (waiter.attempts >= 120) {
          cancelPositionLeaseWait(positionLeaseWaitRef, 'position-lease-timeout', true);
          return;
        }
        waiter.timer = globalThis.setTimeout?.(check, 16) || 0;
        if (!waiter.timer) check();
      };
      waiter.timer = globalThis.setTimeout?.(check, 16) || 0;
      if (!waiter.timer) check();
      return waiter.promise;
    }
    if (continuation && !historyStart) {
      const continuationRecord = continuationLease || topContinuationRef.current;
      const liveLineage = currentContinuationLineage(currentSession);
      const firstID = snapshotRef.current.rows[0]?.id;
      const anchor = currentSession.historyAnchor;
      const stableTop = stableTopContinuation === true
        && String(firstID || '') === String(continuationAnchorID || '')
        && Number(snapshotRef.current.rows[0]?.seqLow || 0) === Number(continuationAnchorSeq || 0)
        && Number(continuationFirstVisibleSeq || 0) === Number(continuationAnchorSeq || 0);
      const validLiveLineage = isValidContinuationLineage(liveLineage);
      const validContinuation = isValidContinuationLineage(continuationRecord);
      const exactLineage = Boolean(continuationRecord)
        && validLiveLineage
        && validContinuation
        && continuationRecord.controller === liveLineage.controller
        && continuationRecord.activationID === liveLineage.activationID
        && continuationRecord.channelID === liveLineage.channelID
        && continuationRecord.viewKey === liveLineage.viewKey
        && continuationRecord.inputEpoch === liveLineage.inputEpoch
        && continuationRecord.intentRevision === liveLineage.intentRevision
        && continuationRecord.gestureID === liveLineage.gestureID
        && continuationRecord.rootIdentity === liveLineage.rootIdentity
        && continuationRecord.visibilityEpoch === liveLineage.visibilityEpoch;
      if (!exactLineage || ((!anchor || String(anchor.messageID) !== String(firstID || '')
        || !Number.isFinite(Number(anchor.viewportOffset))) && !stableTop)) {
        if (topContinuationRef.current === continuationRecord) clearTopContinuation(topContinuationRef);
        if (topBoundaryRef.current === continuationRecord?.topBoundary) topBoundaryRef.current = null;
        return Promise.resolve({ kind: 'position-anchor-missing', deduplicated: true });
      }
    }
    // A top request can arrive while an anticipatory runway request is still
    // acquiring a page.  Record the physical boundary before looking at the
    // active operation, so promotion below can hand the exact same older
    // intent to a successor request after the acquisition settles.
    if (reason === 'top' && !continuation) {
      const topLineage = currentContinuationLineage(currentSession);
      topBoundaryRef.current = Object.freeze({
        controller: topLineage.controller,
        activationID: topLineage.activationID,
        channelID: topLineage.channelID,
        viewKey: topLineage.viewKey,
        inputEpoch: Number(currentSession.inputEpoch || 0),
        intentRevision: Number(currentSession.intentRevision || 0),
        gestureID: topLineage.gestureID,
        rootIdentity: topLineage.rootIdentity,
        visibilityEpoch: topLineage.visibilityEpoch,
      });
    }
    const requestOwner = committedOwnerRef.current;
    const first = snapshotRef.current.rows[0];
    const obligation = historyConsumerObligation({
      intent, targetSeq, requiredVisibleCoverage, firstRow: first,
      status: historyStatusRef.current, historyStartIntent,
    });
    const terminal = terminalRef.current;
    if (terminal?.controller === controller && terminal.key === obligation.key
      && terminal.sourceKey === obligation.sourceKey && terminal.progressKey === obligation.supplyKey) {
      return Promise.resolve({ kind: 'exhausted', localOnly: terminal.localOnly === true, deduplicated: true });
    }
    const failed = failedAnticipatoryRef.current;
    if (urgency !== HISTORY_URGENCY.interactive && failed?.controller === controller
      && failed.activationID === controller.activationID && failed.channelID === channelID
      && failed.viewKey === viewKey && failed.key === obligation.key
      && failed.progressKey === historyProgressKey(historyStatusRef.current)) {
      return Promise.resolve({ kind: 'failed-pending-progress', deduplicated: true });
    }
    if (urgency === HISTORY_URGENCY.interactive) failedAnticipatoryRef.current = null;
    const active = activeRef.current;
    if (active) {
      const currentSupply = historySupplyKey(historyStatusRef.current);
      if (active.controller === controller
        && (active.sourceKey !== obligation.sourceKey || active.key !== obligation.key)) {
        const sourceChanged = active.sourceKey !== obligation.sourceKey;
        active.abortController?.abort(sourceChanged ? 'history-source-replaced' : 'history-obligation-replaced');
        diagnostic('info', 'history.intent_handoff', {
          channelId: channelID, viewKey, fromSourceLease: active.sourceKey,
          toSourceLease: obligation.sourceKey, sourceChanged,
        });
        // Acquisition owns only the physical request. A viewport-underfill
        // obligation belongs to the committed DOM consumer, so a replacement
        // presentation/source must be remeasured there before another request
        // may start. Other semantic obligations carry immutable targets and
        // can hand those targets directly to their successor.
        if (consumer === HISTORY_CONSUMER.viewportUnderfill) {
          return active.promise.then(() => ({
            kind: 'consumer-recheck', reason: 'obligation-replaced',
          }));
        }
        return active.promise.then(() => request(reason, urgency, options));
      }
      if (active.controller === controller && active.key === obligation.key
        && active.sourceKey === obligation.sourceKey && active.supplyProgressKey !== currentSupply) {
        if (reason === 'projection-underfill') {
          return active.promise.then(() => {
            const owner = committedOwnerRef.current;
            const current = owner.historyStatus || {};
            if (owner.controller !== controller || owner.channelID !== channelID
              || owner.viewKey !== viewKey || owner.snapshot?.rows?.length > 0
              || current.hasOlder !== true || current.historyDemand?.phase === 'error') {
              return { kind: 'cancelled', reason: 'projection-demand-retired' };
            }
            return request(reason, urgency, options);
          });
        }
        if (intent === HISTORY_INTENT.initialView) {
          return active.promise.then(() => {
            const owner = committedOwnerRef.current;
            const current = owner.historyStatus || {};
            const bookmark = owner.session?.bookmark;
            if (owner.controller !== controller || owner.channelID !== channelID
              || owner.viewKey !== viewKey || owner.session?.mode === 'following' || !bookmark
              || bookmark.messageID !== requiredVisibleCoverage?.messageID
              || owner.snapshot?.rows?.some((row) => row.id === bookmark.messageID)
              || current.hasOlder !== true || current.historyDemand?.phase === 'error') {
              return { kind: 'cancelled', reason: 'restore-demand-retired' };
            }
            return request(reason, urgency, options);
          });
        }
        if (consumer === HISTORY_CONSUMER.viewportUnderfill) {
          return active.promise.then(() => ({ kind: 'consumer-recheck', reason: 'supply-progressed' }));
        }
      }
      if (active.controller === controller && active.key === obligation.key
        && active.sourceKey === obligation.sourceKey && consumer === HISTORY_CONSUMER.viewportUnderfill) {
        return active.promise.then(() => ({ kind: 'consumer-recheck', reason: 'attempt-settled' }));
      }
      if (urgency === HISTORY_URGENCY.interactive && active.urgency !== HISTORY_URGENCY.interactive) {
        const promoted = active.operation?.promote?.({ intent, urgency: HISTORY_URGENCY.interactive }) === true;
        active.urgency = HISTORY_URGENCY.interactive;
        diagnostic('debug', 'history.intent_promoted', {
          channelId: channelID, epoch: active.epoch, viewKey, reason, promoted,
        });
        readingTrace('history.intent-promoted', {
          activationID: controller.activationID,
          inputEpoch: controller.getSnapshot().session.inputEpoch,
          presentationRevision: Number(snapshotRef.current.revision || 0),
          channelId: channelID, epoch: active.epoch, viewKey, reason, promoted,
        });
      }
      if (reason === 'top' && !continuation) {
        // Do not leave a promoted runway operation as the terminal event.  A
        // page may have advanced the raw feed without exposing any row in the
        // active filtered Presentation; the same top intent must issue the
        // next acquisition until Admission can stage a real prepend or EOF.
        if (!active.topContinuationPromise) {
          active.topContinuationPromise = active.promise.then((result) => {
            const owner = committedOwnerRef.current;
            if (owner?.controller !== controller
              || owner.activationID !== controller.activationID
              || owner.channelID !== channelID || owner.viewKey !== viewKey) {
              return { kind: 'stale-owner', deduplicated: true };
            }
            // The active request was born under an older committed-owner
            // candidate.  Its successor may be issued only when the same
            // Reading lineage is still current.  A newer wheel, root, or
            // visibility boundary must leave the result fail-closed for new
            // input to reissue.
            const currentSession = controller.getSnapshot().session;
            const liveLineage = currentContinuationLineage(currentSession);
            const boundary = topBoundaryRef.current;
            const first = snapshotRef.current.rows[0];
            const sparseProof = Boolean(firstRowAtStart?.id)
              && String(first?.id || '') === String(firstRowAtStart.id)
              && Number(first?.seqLow || 0) === Number(firstRowAtStart.seqLow || 0)
              && Number(result?.firstVisibleSeq || 0) === Number(firstRowAtStart.seqLow || 0);
            const exactLineage = Boolean(boundary)
              && isValidContinuationLineage(boundary)
              && isValidContinuationLineage(liveLineage)
              && boundary.controller === controller
              && boundary.activationID === liveLineage.activationID
              && boundary.channelID === liveLineage.channelID
              && boundary.viewKey === liveLineage.viewKey
              && boundary.inputEpoch === liveLineage.inputEpoch
              && boundary.intentRevision === liveLineage.intentRevision
              && boundary.gestureID === liveLineage.gestureID
              && boundary.rootIdentity === liveLineage.rootIdentity
              && boundary.visibilityEpoch === liveLineage.visibilityEpoch;
            if (!exactLineage) {
              if (topBoundaryRef.current === boundary) topBoundaryRef.current = null;
              return { kind: 'cancelled', reason: 'continuation-lineage-replaced' };
            }
            const stableTopContinuation = sparseProof;
            const continuationLease = {
              controller: boundary.controller,
              activationID: boundary.activationID,
              channelID: boundary.channelID,
              viewKey: boundary.viewKey,
              inputEpoch: boundary.inputEpoch,
              intentRevision: boundary.intentRevision,
              gestureID: boundary.gestureID,
              rootIdentity: boundary.rootIdentity,
              visibilityEpoch: boundary.visibilityEpoch,
              stableTopContinuation,
              continuationAnchorID: first?.id || '',
              continuationAnchorSeq: Number(first?.seqLow || 0),
              continuationFirstVisibleSeq: Number(result?.firstVisibleSeq || 0),
              topBoundary: boundary,
            };
            return request(reason, urgency, {
              ...options,
              continuation: true,
              stableTopContinuation,
              continuationAnchorID: first?.id || '',
              continuationAnchorSeq: Number(first?.seqLow || 0),
              continuationFirstVisibleSeq: Number(result?.firstVisibleSeq || 0),
              continuationLease,
            });
          });
        }
        return active.topContinuationPromise;
      }
      return active.promise;
    }
    const admission = blockingAdmission(historyStatusRef.current, {
      channelID, activationID: controller.activationID, viewKey,
    });
    if (admission) {
      if (consumer === HISTORY_CONSUMER.viewportUnderfill) {
        const pending = deferredRecheckRef.current;
        if (pending?.controller === controller && pending.activationID === controller.activationID
          && pending.channelID === channelID && pending.viewKey === viewKey) return pending.promise;
        pending?.resolve?.({ kind: 'cancelled', reason: 'underfill-owner-replaced' });
        let resolve;
        const promise = new Promise((settle) => { resolve = settle; });
        deferredRecheckRef.current = {
          controller, activationID: controller.activationID, channelID, viewKey,
          generation: Number(historyStatusRef.current.generation || 0), promise, resolve,
        };
        return promise;
      }
      if (urgency === HISTORY_URGENCY.interactive) {
        const previous = deferredAdmissionRef.current;
        deferredAdmissionRef.current = {
          controller, activationID: controller.activationID, channelID, viewKey,
          generation: Number(historyStatusRef.current.generation || 0), reason, urgency,
          revealRows: Math.max(Number(previous?.revealRows || 0), Number(revealRows || 0)),
          revealBytes: Math.max(Number(previous?.revealBytes || 0), Number(revealBytes || 0)),
          demandUnits: Math.max(Number(previous?.demandUnits || 1), Number(demandUnits || 1)),
          intent, targetSeq: Number(targetSeq || 0), requiredVisibleCoverage,
        };
      }
      return Promise.resolve({ kind: 'admission-pending', deduplicated: true });
    }
    const epoch = epochRef.current + 1;
    epochRef.current = epoch;
    diagnostic('debug', 'history.intent_started', {
      channelId: channelID, epoch, viewKey, reason, urgency,
      anchorSeq: Number(first?.seqLow || 0), installedVisibleRows: snapshotRef.current.rows.length,
      scope: historyViewSpec?.scope || '',
      actorFilterCount: Number(historyViewSpec?.actorFilter?.size || 0),
      intent, targetSeq: Number(targetSeq || 0), revealRows: Number(revealRows || 0),
      revealBytes: Number(revealBytes || 0), sourceLease: String(historyStatusRef.current.sourceLease || ''),
    });
    readingTrace('history.intent-started', {
      activationID: controller.activationID,
      inputEpoch: controller.getSnapshot().session.inputEpoch,
      presentationRevision: Number(snapshotRef.current.revision || 0),
      channelId: channelID, epoch, viewKey, reason, urgency,
      anchorID: first?.id || '', anchorSeq: Number(first?.seqLow || 0),
      revealRows: Number(revealRows || 0), revealBytes: Number(revealBytes || 0),
    });
    const abortController = new AbortController();
    let operation = null;
    const activeSession = controller.getSnapshot().session;
    const revealIntent = historyRevealIntent({
      intent, activationID: controller.activationID, inputEpoch: activeSession.inputEpoch,
      intentRevision: activeSession.intentRevision,
      epoch, viewKey, channelID, status: historyStatusRef.current,
      snapshot: snapshotRef.current, demandUnits,
      historyAnchor: activeSession.historyAnchor,
      historyStart,
    });
    const promise = Promise.resolve(requestPort({
      intent, urgency, signal: abortController.signal,
      anchorSeq: Number(first?.seqLow || 0), targetSeq: Number(targetSeq || 0),
      beforeSeq: Number(beforeSeq || 0) || undefined,
      requiredVisibleCoverage: requiredVisibleCoverage || undefined,
      revealRows, revealBytes, reason,
      explicitRetry: reason === 'retry' || reason === 'retry-restore',
      viewSpec: historyViewSpec, historyRevealIntent: revealIntent,
      onOperation(next) {
        operation = next;
        const running = activeRef.current;
        if (running?.controller === controller && running.epoch === epoch) running.operation = next;
      },
    })).then((result) => {
      const currentOwner = committedOwnerRef.current;
      const current = ownsHistoryOperation(
        currentOwner, requestOwner, controller, activeRef.current?.promise, promise,
      );
      const currentStatus = current ? currentOwner.historyStatus : requestOwner.historyStatus;
      if (current && result?.kind === 'exhausted'
        && (result?.localOnly === true || (currentStatus.attached === true
          && Number(currentStatus.generation || 0) > 0))
        && historySupplyKey(currentStatus) === obligation.supplyKey) {
        terminalRef.current = {
          controller, key: obligation.key, sourceKey: obligation.sourceKey,
          progressKey: obligation.supplyKey, localOnly: result?.localOnly === true,
        };
      }
      if (current && result?.kind === 'failed' && urgency !== HISTORY_URGENCY.interactive
        && historyProgressKey(currentStatus) === obligation.progressKey) {
        failedAnticipatoryRef.current = {
          controller, activationID: requestOwner.activationID, channelID, viewKey,
          key: obligation.key, progressKey: obligation.progressKey,
        };
      } else if (current && result?.kind !== 'failed') failedAnticipatoryRef.current = null;
      diagnostic(result?.kind === 'failed' ? 'warn' : 'debug', `history.intent_${result?.kind || 'failed'}`, {
        channelId: channelID, epoch, viewKey, reason, anchorSeq: Number(first?.seqLow || 0),
      });
      readingTrace('history.intent-settled', {
        activationID: requestOwner.activationID,
        inputEpoch: controller.getSnapshot().session.inputEpoch,
        presentationRevision: Number((current ? currentOwner.snapshot : requestOwner.snapshot)?.revision || 0),
        channelId: channelID, epoch, viewKey, reason,
        anchorSeq: Number(first?.seqLow || 0), result: result?.kind || 'failed',
      });
      // A top request is issued at the physical boundary, before the prepend
      // can move that boundary away from scrollTop=0. The old history
      // scheduler kept this one boundary obligation alive until the next
      // committed page had either reached EOF or exposed fresh typed boundary
      // evidence. The feed runtime now settles one page at a time, so retain
      // that obligation in this owner and schedule its successor after React
      // has published the new supply. A newer-direction intent cancels it.
      const settledSession = current ? currentOwner.controller.getSnapshot().session : null;
      const frontierSeq = Number(currentStatus.oldestSeq
        || currentOwner.snapshot?.rows?.[0]?.seqLow || 0);
      // A sparse filtered page can advance the physical frontier without
      // changing the semantic first row.  In that case there is no prepend
      // lease to carry.  The first-row/sequence proof below is still only a
      // physical-page observation; the exact Reading lineage remains the
      // authority that permits a successor request.
      const settledLineage = settledSession
        ? currentContinuationLineage(settledSession) : null;
      const boundary = topBoundaryRef.current;
      const sparseTopProof = Boolean(first?.id)
        && String(currentOwner.snapshot?.rows?.[0]?.id || '') === String(first.id)
        && Number(currentOwner.snapshot?.rows?.[0]?.seqLow || 0) === Number(first.seqLow || 0)
        && Number(result?.firstVisibleSeq || 0) === Number(first.seqLow || 0);
      const stableTopContinuation = sparseTopProof;
      const sameExactLineage = Boolean(boundary && settledSession && settledLineage)
        && isValidContinuationLineage(boundary)
        && isValidContinuationLineage(settledLineage)
        && boundary.controller === controller
        && boundary.activationID === settledLineage.activationID
        && boundary.channelID === settledLineage.channelID
        && boundary.viewKey === settledLineage.viewKey
        && boundary.inputEpoch === settledLineage.inputEpoch
        && boundary.intentRevision === settledLineage.intentRevision
        && boundary.gestureID === settledLineage.gestureID
        && boundary.rootIdentity === settledLineage.rootIdentity
        && boundary.visibilityEpoch === settledLineage.visibilityEpoch
        && boundary.inputEpoch === Number(settledSession.inputEpoch)
        && boundary.intentRevision === Number(settledSession.intentRevision)
        && settledSession.mode === READING_MODE.browsing
        && settledSession.tailEvidence?.direction !== 'newer';
      const continueTop = current && reason === 'top' && result?.kind === 'satisfied'
        && currentStatus.hasOlder === true && frontierSeq > 1
        && Number(settledSession?.inputEpoch || 0) > 0
        && sameExactLineage;
      const continuationAnchorReady = positionLeaseHandoffReady(settledSession)
          || (settledSession?.historyAnchor?.messageID
          && String(settledSession.historyAnchor.messageID)
            === String(currentOwner.snapshot?.rows?.[0]?.id || '')
            && Number.isFinite(Number(settledSession.historyAnchor.viewportOffset)))
          || stableTopContinuation;
      if (current && reason === 'top' && !sameExactLineage) {
        if (positionLeaseWaitRef.current?.controller === controller) {
          cancelPositionLeaseWait(positionLeaseWaitRef, 'position-lease-lineage-replaced', true);
        }
        if (topContinuationRef.current?.controller === controller) {
          clearTopContinuation(topContinuationRef);
        }
        if (topBoundaryRef.current === boundary) topBoundaryRef.current = null;
      }
      if (continueTop && continuationAnchorReady) {
        const continuation = {
          controller: boundary.controller,
          activationID: boundary.activationID,
          channelID: boundary.channelID,
          viewKey: boundary.viewKey,
          inputEpoch: boundary.inputEpoch,
          intentRevision: boundary.intentRevision,
          gestureID: boundary.gestureID,
          rootIdentity: boundary.rootIdentity,
          visibilityEpoch: boundary.visibilityEpoch,
          reason,
          urgency,
          options,
          stableTopContinuation,
          continuationAnchorID: first?.id || '',
          continuationAnchorSeq: Number(first?.seqLow || 0),
          continuationFirstVisibleSeq: Number(result?.firstVisibleSeq || 0),
          topBoundary: boundary,
          timer: null,
        };
        topContinuationRef.current?.timer
          && globalThis.clearTimeout?.(topContinuationRef.current.timer);
        topContinuationRef.current = continuation;
        continuation.timer = globalThis.setTimeout?.(() => {
          if (topContinuationRef.current !== continuation) return;
          topContinuationRef.current = null;
          const owner = committedOwnerRef.current;
          const ownerSession = owner?.controller?.getSnapshot?.().session;
          const ownerStatus = owner?.historyStatus || {};
          const ownerFrontier = Number(ownerStatus.oldestSeq || owner?.snapshot?.rows?.[0]?.seqLow || 0);
          const ownerDirection = ownerSession?.tailEvidence?.direction
            || (ownerSession?.mode === 'browsing' && Number(ownerSession?.inputEpoch || 0) > 0
              ? 'older' : '');
          const ownerInputEpoch = Number(ownerSession?.inputEpoch || 0);
          const ownerLineage = ownerSession
            ? currentContinuationLineage(ownerSession) : null;
          const sparseProof = continuation.stableTopContinuation === true
            && String(owner?.snapshot?.rows?.[0]?.id || '')
              === String(continuation.continuationAnchorID || '')
            && Number(owner?.snapshot?.rows?.[0]?.seqLow || 0)
              === Number(continuation.continuationAnchorSeq || 0)
            && Number(continuation.continuationFirstVisibleSeq || 0)
              === Number(continuation.continuationAnchorSeq || 0);
          const sameOlderIntent = ownerSession?.mode === READING_MODE.browsing
            && ownerDirection === 'older'
            && isValidContinuationLineage(continuation)
            && isValidContinuationLineage(ownerLineage)
            && continuation.controller === ownerLineage?.controller
            && continuation.activationID === ownerLineage?.activationID
            && continuation.channelID === ownerLineage?.channelID
            && continuation.viewKey === ownerLineage?.viewKey
            && continuation.inputEpoch === ownerLineage?.inputEpoch
            && continuation.intentRevision === ownerLineage?.intentRevision
            && continuation.gestureID === ownerLineage?.gestureID
            && continuation.rootIdentity === ownerLineage?.rootIdentity
            && continuation.visibilityEpoch === ownerLineage?.visibilityEpoch
            && continuation.inputEpoch === ownerInputEpoch
            && continuation.intentRevision === Number(ownerSession?.intentRevision || 0)
            && continuation.topBoundary?.controller === controller
            && continuation.topBoundary.activationID === continuation.activationID
            && continuation.topBoundary.channelID === continuation.channelID
            && continuation.topBoundary.viewKey === continuation.viewKey
            && continuation.topBoundary.inputEpoch === continuation.inputEpoch
            && continuation.topBoundary.intentRevision === continuation.intentRevision
            && continuation.topBoundary.gestureID === continuation.gestureID
            && continuation.topBoundary.rootIdentity === continuation.rootIdentity
            && continuation.topBoundary.visibilityEpoch === continuation.visibilityEpoch
            && (continuation.stableTopContinuation !== true || sparseProof);
          const ownerAnchorReady = positionLeaseHandoffReady(ownerSession)
            || (ownerSession?.historyAnchor?.messageID
            && String(ownerSession.historyAnchor.messageID)
            === String(owner?.snapshot?.rows?.[0]?.id || '')
            && Number.isFinite(Number(ownerSession.historyAnchor.viewportOffset)))
            || sparseProof;
          if (owner?.controller !== controller || owner.channelID !== channelID
            || owner.viewKey !== viewKey || !sameOlderIntent
            || !ownerAnchorReady
            || ownerStatus.hasOlder !== true || ownerFrontier <= 1) {
            if (topBoundaryRef.current === continuation.topBoundary) topBoundaryRef.current = null;
            return;
          }
          const admission = ownerStatus.presentationAdmission;
          const admissionState = admission?.snapshot?.(channelID);
          const admissionToken = admissionState?.token || admissionState?.committed;
          if (admissionToken && ownerInputEpoch > Number(admissionToken.inputEpoch || 0)) {
            admission?.advanceInputEpoch?.(channelID, {
              operationID: admissionToken.operationID,
              activationID: controller.activationID,
              direction: 'older',
              inputEpoch: ownerInputEpoch,
              currentInputEpoch: ownerInputEpoch,
              intentRevision: Number(ownerSession?.intentRevision || 0),
            });
          }
          void request(continuation.reason, continuation.urgency, {
            ...continuation.options,
            continuation: true,
            stableTopContinuation: continuation.stableTopContinuation,
            continuationAnchorID: continuation.continuationAnchorID,
            continuationAnchorSeq: continuation.continuationAnchorSeq,
            continuationFirstVisibleSeq: continuation.continuationFirstVisibleSeq,
            continuationLease: continuation,
          });
        }, 100);
      }
      return current && consumer === HISTORY_CONSUMER.viewportUnderfill && result?.kind === 'satisfied'
        ? { kind: 'consumer-recheck', reason: 'acquisition-satisfied' } : result;
    }, (error) => {
      const currentOwner = committedOwnerRef.current;
      const current = ownsHistoryOperation(
        currentOwner, requestOwner, controller, activeRef.current?.promise, promise,
      );
      if (current && urgency !== HISTORY_URGENCY.interactive
        && historyProgressKey(currentOwner.historyStatus) === obligation.progressKey) {
        failedAnticipatoryRef.current = {
          controller, activationID: requestOwner.activationID, channelID, viewKey,
          key: obligation.key, progressKey: obligation.progressKey,
        };
      }
      diagnostic('warn', 'history.intent_failed', { channelId: channelID, epoch, viewKey, reason, error });
      readingTrace('history.intent-failed', {
        activationID: controller.activationID,
        inputEpoch: controller.getSnapshot().session.inputEpoch,
        presentationRevision: Number(snapshotRef.current.revision || 0),
        channelId: channelID, epoch, viewKey, reason, errorName: error?.name || 'Error',
      });
      return { kind: 'failed', error };
    }).finally(() => {
      if (activeRef.current?.promise === promise) activeRef.current = null;
    });
    activeRef.current = {
      key: obligation.key, sourceKey: obligation.sourceKey,
      supplyProgressKey: obligation.supplyKey, promise, abortController,
      controller, epoch, urgency, operation,
      operationID: revealIntent?.operationID || '',
      historyStartIntent,
    };
    return promise;
  }, [channelID, commitOwnerCandidate, committedOwnerRef, controller, getContinuationLineage,
    historyStatusRef, historyViewSpec, requestPort, snapshotRef,
    continuationLineage?.gestureID, continuationLineage?.rootIdentity,
    continuationLineage?.visibilityEpoch, viewKey]);

  // A membership regrant may hydrate a stale durable window before the new
  // surface paint. That window is readable, but it is not the current tail;
  // issue one existing Reading history demand against the authoritative grant
  // head so the Feed owns the canonical physical fetch. This is keyed to the
  // grant authority, not to row visibility, and therefore cannot loop or turn
  // a cache row into a tail proof.
  useEffect(() => {
    const authorityRevision = Number(historyStatus.notificationAuthorityRevision || 0);
    const renderedTailSeq = Number(snapshotRef.current.rows?.at(-1)?.seqHigh || 0);
    const attached = historyStatus.attached === true
      && Number(historyStatus.generation || 0) > 0
      && historyStatus.messageCurrent === true;
    if (!attached || Number(historyStatus.generation || 0) <= 1
      || authorityRevision <= 0 || knownHead <= 0
      || snapshotRef.current.rows.length === 0 || renderedTailSeq >= knownHead) return;
    const key = `${controller.activationID}:${authorityRevision}`;
    if (grantTailRequestRef.current === key) return;
    grantTailRequestRef.current = key;
    void request('grant-current-tail', HISTORY_URGENCY.interactive, {
      intent: HISTORY_INTENT.scrollHistory,
      beforeSeq: knownHead + 1,
    });
  }, [controller.activationID, historyStatus.attached, historyStatus.generation,
    historyStatus.messageCurrent, historyStatus.notificationAuthorityRevision,
    knownHead, request, snapshot.rows.length, snapshot.rows.at(-1)?.seqHigh]);

  // Home is a semantic walk, not a physical scroll callback. Keep the one
  // current intent alive while History supplies older pages, then expose one
  // physical top command only after the feed has published authoritative EOF.
  useEffect(() => {
    const intent = session.historyStartIntent;
    const pending = historyStartRef.current;
    if (!intent) {
      if (pending) clearHistoryStart(historyStartRef, 'history-start-cleared');
      return;
    }
    const authorityCurrent = intent.activationID === controller.activationID
      && intent.channelID === channelID
      && intent.viewKey === viewKey
      && Number(intent.generation) === Number(historyStatus.generation || 0)
      && String(intent.sourceLease || '') === String(historyStatus.sourceLease || '');
    if (!authorityCurrent) {
      pending?.abortController?.abort('history-start-authority-replaced');
      clearHistoryStart(historyStartRef, 'history-start-authority-replaced');
      controller.update((active) => cancelHistoryStartIntent(active, active.historyStartIntent));
      return;
    }
    let state = pending;
    if (!state || !sameHistoryStartIntent(state.intent, intent)) {
      if (state) {
        state.abortController?.abort('history-start-replaced');
        clearHistoryStart(historyStartRef, 'history-start-replaced');
      }
      state = {
        controller,
        intent,
        phase: 'loading',
        requesting: false,
        timer: null,
        abortController: null,
      };
      state.timer = globalThis.setTimeout?.(() => {
        if (historyStartRef.current !== state) return;
        const live = controller.getSnapshot().session;
        if (!sameHistoryStartIntent(live.historyStartIntent, state.intent)) return;
        state.abortController?.abort('history-start-timeout');
        if (activeRef.current?.controller === controller
          && sameHistoryStartIntent(activeRef.current.historyStartIntent, state.intent)) {
          activeRef.current.abortController?.abort('history-start-timeout');
          activeRef.current = null;
        }
        state.phase = 'error';
        setHistoryStartFailure(Object.freeze({
          kind: 'history-start-timeout',
          activationID: state.intent.activationID,
          inputEpoch: state.intent.inputEpoch,
          intentRevision: state.intent.intentRevision,
        }));
      }, HISTORY_START_TIMEOUT_MS) || 0;
      historyStartRef.current = state;
      setHistoryStartFailure(null);
    }
    if (historyStatus.historyDemand?.phase === 'error' || historyStatus.error) {
      state.phase = 'error';
      const error = String(historyStatus.historyDemand?.error || historyStatus.error || '历史加载失败');
      setHistoryStartFailure((previous) => previous?.kind === 'history-start-error'
        && previous.error === error
        ? previous
        : Object.freeze({
          kind: 'history-start-error',
          error,
          activationID: intent.activationID,
          inputEpoch: intent.inputEpoch,
          intentRevision: intent.intentRevision,
        }));
      return;
    }
    const atAuthoritativeEOF = semanticExhausted === true;
    if (atAuthoritativeEOF) {
      state.phase = 'awaiting-physical';
      return;
    }
    if (historyStatus.hasOlder !== true || state.phase === 'error' || state.requesting) return;
    state.phase = 'loading';
    state.requesting = true;
    const requestPromise = request('history-start', HISTORY_URGENCY.interactive, {
      intent: HISTORY_INTENT.scrollHistory,
      demandUnits: 1,
      historyStartIntent: intent,
    });
    void Promise.resolve(requestPromise).then((result) => {
      if (historyStartRef.current !== state) return;
      state.requesting = false;
      if (result?.kind === 'failed') {
        state.phase = 'error';
        setHistoryStartFailure(Object.freeze({
          kind: 'history-start-error',
          error: String(result.error?.message || '历史加载失败'),
          activationID: intent.activationID,
          inputEpoch: intent.inputEpoch,
          intentRevision: intent.intentRevision,
        }));
      } else if (result?.kind === 'cancelled' && controller.getSnapshot().session.historyStartIntent) {
        state.phase = 'error';
        setHistoryStartFailure(Object.freeze({
          kind: 'history-start-cancelled',
          reason: String(result.reason || 'cancelled'),
          activationID: intent.activationID,
          inputEpoch: intent.inputEpoch,
          intentRevision: intent.intentRevision,
        }));
      }
      setHistoryStartTick((value) => value + 1);
    });
  }, [channelID, controller, historyStatus, historyStatus.completedPages, historyStatus.hasOlder,
    historyStatus.loading, request, semanticExhausted, session.historyStartIntent,
    snapshot.revision, snapshot.rows.length, supplyKey, viewKey, historyStartTick]);

  const historyStartReady = useCallback((intent) => {
    const pending = historyStartRef.current;
    return Boolean(pending && pending.controller === controller
      && pending.phase === 'awaiting-physical'
      && sameHistoryStartIntent(pending.intent, intent)
      && semanticExhausted === true);
  }, [controller, semanticExhausted]);

  const consumeHistoryStartEvidence = useCallback((intent) => {
    const pending = historyStartRef.current;
    const current = controller.getSnapshot().session;
    if (!pending || pending.controller !== controller || pending.phase !== 'awaiting-physical'
      || !sameHistoryStartIntent(pending.intent, intent)
      || !sameHistoryStartIntent(current.historyStartIntent, intent)
      || semanticExhausted !== true) return false;
    clearHistoryStart(historyStartRef, 'history-start-satisfied');
    setHistoryStartFailure(null);
    return true;
  }, [controller, semanticExhausted]);

  const failHistoryStart = useCallback((reason = 'history-start-physical-failed') => {
    const pending = historyStartRef.current;
    const current = controller.getSnapshot().session;
    if (!pending || !sameHistoryStartIntent(pending.intent, current.historyStartIntent)) return false;
    pending.abortController?.abort(reason);
    pending.phase = 'error';
    setHistoryStartFailure(Object.freeze({
      kind: String(reason),
      activationID: pending.intent.activationID,
      inputEpoch: pending.intent.inputEpoch,
      intentRevision: pending.intent.intentRevision,
    }));
    return true;
  }, [controller]);

  const retryHistoryStart = useCallback(() => {
    const current = controller.getSnapshot().session;
    const intent = current.historyStartIntent;
    const pending = historyStartRef.current;
    if (!intent || !pending || !sameHistoryStartIntent(pending.intent, intent)) return false;
    pending.phase = 'loading';
    pending.requesting = false;
    setHistoryStartFailure(null);
    setHistoryStartTick((value) => value + 1);
    return true;
  }, [controller]);

  useEffect(() => {
    const bookmark = session.bookmark;
    if (session.mode === 'following' || !bookmark
      || snapshot.rows.some((row) => row.id === bookmark.messageID)
      || authoritativeEmpty || semanticExhausted) return;
    void request('restore-reading', HISTORY_URGENCY.blocking, {
      intent: HISTORY_INTENT.initialView,
      targetSeq: Number(bookmark.seq || 0),
      requiredVisibleCoverage: { messageID: bookmark.messageID, seq: Number(bookmark.seq || 0) },
    });
  }, [authoritativeEmpty, request, semanticExhausted, session.bookmark, session.mode, snapshot.rows, sourceKey, supplyKey]);

  useEffect(() => {
    const underfill = deferredRecheckRef.current;
    if (underfill) {
      const generation = Number(historyStatus.generation || 0);
      const current = underfill.controller === controller
        && underfill.activationID === controller.activationID
        && underfill.channelID === channelID && underfill.viewKey === viewKey
        && underfill.generation === generation;
      if (!current) {
        deferredRecheckRef.current = null;
        underfill.resolve({ kind: 'cancelled', reason: 'underfill-owner-replaced' });
      } else if (!blockingAdmission(historyStatus, {
        channelID, activationID: controller.activationID, viewKey,
      })) {
        deferredRecheckRef.current = null;
        underfill.resolve({ kind: 'consumer-recheck', reason: 'admission-settled' });
      }
    }
    const deferred = deferredAdmissionRef.current;
    if (!deferred) return;
    const current = deferred.controller === controller
      && deferred.activationID === controller.activationID
      && deferred.channelID === channelID && deferred.viewKey === viewKey
      && deferred.generation === Number(historyStatus.generation || 0);
    if (!current) { deferredAdmissionRef.current = null; return; }
    if (blockingAdmission(historyStatus, {
      channelID, activationID: controller.activationID, viewKey,
    })) return;
    deferredAdmissionRef.current = null;
    void request(deferred.reason, deferred.urgency, deferred);
  }, [channelID, controller, historyStatus.generation, historyStatus.presentationAdmission, historyStatus.presentationAdmissionState?.phase, request, viewKey]);

  useEffect(() => {
    const attached = historyStatus.attached === true
      && Number(historyStatus.generation || 0) > 0 && historyStatus.messageCurrent === true;
    const local = historyStatus.localReplicaReady === true && Number(historyStatus.generation || 0) === 0;
    if (snapshot.rows.length > 0 || !hasManagedHistoryLifecycle || (!attached && !local)
      || historyStatus.localReplicaReady === false || historyStatus.hasOlder !== true
      || historyStatus.historyDemand?.phase === 'error' || knownHead <= 0) return;
    const bookmark = session.bookmark;
    if (session.mode !== 'following' && bookmark
      && !snapshot.rows.some((row) => row.id === bookmark.messageID)) return;
    // A zero-row semantic projection is a data-supply obligation, not proof
    // that the user is waiting at a physical boundary. Keep its one Scheduler
    // operation anticipatory: it scans until matching supply or authoritative
    // EOF, while the committed partial presentation stays usable and silent.
    void request('projection-underfill', HISTORY_URGENCY.anticipatory);
  }, [hasManagedHistoryLifecycle, historyStatus, historyViewSpec, knownHead, request, session.bookmark, session.mode, snapshot.rows, sourceKey, viewKey]);

  const retry = useCallback(() => {
    const current = controller.getSnapshot().session;
    const bookmark = current.bookmark;
    if (current.mode !== 'following' && bookmark
      && !snapshotRef.current.rows.some((row) => row.id === bookmark.messageID)) {
      return request('retry-restore', HISTORY_URGENCY.interactive, {
        intent: HISTORY_INTENT.initialView,
        targetSeq: Number(bookmark.seq || 0),
        requiredVisibleCoverage: { messageID: bookmark.messageID, seq: Number(bookmark.seq || 0) },
      });
    }
    return request('retry', HISTORY_URGENCY.interactive);
  }, [controller, request, snapshotRef]);

  const retryAvailability = useCallback(() => {
    const retries = [];
    if (localReplicaError && typeof history.retryLocalReplica === 'function') {
      retries.push(Promise.resolve(history.retryLocalReplica()));
    }
    if (syncHistoryError && typeof history.refreshLatest === 'function') {
      retries.push(Promise.resolve(history.refreshLatest()));
    }
    if (foregroundHistoryError || blockingHistoryError) retries.push(Promise.resolve(retry()));
    return retries.length > 1 ? Promise.all(retries) : retries[0] || Promise.resolve(false);
  }, [blockingHistoryError, foregroundHistoryError, history, localReplicaError, retry, syncHistoryError]);

  return Object.freeze({
    request,
    retry,
    retryAvailability,
    historyStartReady,
    consumeHistoryStartEvidence,
    failHistoryStart,
    retryHistoryStart,
    historyStartFailure,
    operationID: () => activeRef.current?.controller === controller
      ? String(activeRef.current.operationID || '') : '',
    cancel(reason) {
      activeRef.current?.abortController?.abort(reason);
      activeRef.current = null;
      clearTopContinuation(topContinuationRef);
      if (topBoundaryRef.current?.controller === controller) topBoundaryRef.current = null;
      clearHistoryStart(historyStartRef, reason || 'history-cancelled');
    },
  });
}
