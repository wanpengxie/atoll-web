import { useCallback, useEffect, useInsertionEffect, useRef, useState } from 'react';
import { HISTORY_INTENT, HISTORY_URGENCY } from '../../model/history-demand.js';
import { READING_MODE } from '../../model/reading-session.js';
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

function clearTopContinuation(ref) {
  if (ref.current?.timer) globalThis.clearTimeout?.(ref.current.timer);
  ref.current = null;
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
  const epochRef = useRef(0);
  const sourceKey = historySourceKey(historyStatus);
  const supplyKey = historySupplyKey(historyStatus);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal && (terminal.controller !== controller || terminal.sourceKey !== sourceKey)) terminalRef.current = null;
  }, [controller, sourceKey]);

  // Activation replacement is an ownership edge, not an eventual side
  // effect. Publish it before either reading container may establish a DOM
  // consumer debt in its layout effect. A passive reset here used to erase an
  // operation that the newly committed child had already started.
  useInsertionEffect(() => {
    activeRef.current?.abortController?.abort();
    activeRef.current = null;
    deferredAdmissionRef.current = null;
    deferredRecheckRef.current?.resolve?.({ kind: 'cancelled', reason: 'underfill-owner-replaced' });
    deferredRecheckRef.current = null;
    clearTopContinuation(topContinuationRef);
    topBoundaryRef.current = null;
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
      if (topContinuationRef.current?.controller === controller) {
        clearTopContinuation(topContinuationRef);
      }
      if (topBoundaryRef.current?.controller === controller) topBoundaryRef.current = null;
      if (failedAnticipatoryRef.current?.controller === controller) failedAnticipatoryRef.current = null;
    };
  }, [controller]);

  // A continuation is leased to the exact semantic older intent that caused
  // the typed top request. Any newer input, latest intent, direction reversal,
  // or exit from browsing invalidates that lease at the commit boundary before
  // a stale timer can issue another request.
  useInsertionEffect(() => {
    const continuation = topContinuationRef.current;
    if (!continuation) return;
    const sameIntent = continuation.controller === controller
      && continuation.activationID === controller.activationID
      && continuation.channelID === channelID
      && continuation.viewKey === viewKey
      && session.mode === READING_MODE.browsing
      && Number(session.inputEpoch) === Number(continuation.inputEpoch)
      && Number(session.intentRevision) === Number(continuation.intentRevision)
      && session.tailEvidence?.direction !== 'newer';
    if (!sameIntent) {
      clearTopContinuation(topContinuationRef);
      if (topBoundaryRef.current?.controller === controller) topBoundaryRef.current = null;
    }
  }, [channelID, controller, session.inputEpoch, session.intentRevision, session.mode, session.tailEvidence, viewKey]);

  const request = useCallback((reason, urgency = HISTORY_URGENCY.interactive, options = {}) => {
    const {
      revealRows, revealBytes, demandUnits = 1,
      intent = HISTORY_INTENT.scrollHistory, targetSeq = 0,
      requiredVisibleCoverage = null, consumer = '', continuation = false,
    } = options;
    if (!continuation && committedOwnerRef.current !== commitOwnerCandidate) {
      return Promise.resolve({ kind: 'stale-owner', deduplicated: true });
    }
    const currentSession = controller.getSnapshot().session;
    // A committed prepend owns the next physical boundary until the accepted
    // position-row lease reaches actual paint. Do not let a continuation or a
    // second top/runway request race that one-shot restore.
    if (currentSession.positionRowLease
      && (continuation || reason === 'top' || reason === 'runway')) {
      return Promise.resolve({ kind: 'position-lease-pending', deduplicated: true });
    }
    if (reason === 'top' && !continuation) {
      // `top` is only emitted by useBrowsingReadingController after the
      // typed Vendor scroll-position evidence reported the physical boundary.
      // Keep that evidence as an identity lease; do not re-query global DOM
      // from this scheduler after prepend/remount changes the native offset.
      topBoundaryRef.current = Object.freeze({
        controller, activationID: controller.activationID, channelID, viewKey,
        inputEpoch: Number(currentSession.inputEpoch || 0),
        intentRevision: Number(currentSession.intentRevision || 0),
      });
    }
    const requestOwner = committedOwnerRef.current;
    const first = snapshotRef.current.rows[0];
    const obligation = historyConsumerObligation({
      intent, targetSeq, requiredVisibleCoverage, firstRow: first, status: historyStatusRef.current,
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
    });
    const promise = Promise.resolve(requestPort({
      intent, urgency, signal: abortController.signal,
      anchorSeq: Number(first?.seqLow || 0), targetSeq: Number(targetSeq || 0),
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
      const continueTop = current && reason === 'top' && result?.kind === 'satisfied'
        && currentStatus.hasOlder === true && frontierSeq > 1
        && settledSession?.mode === READING_MODE.browsing
        && Number(settledSession?.inputEpoch || activeSession.inputEpoch) > 0
        && settledSession?.tailEvidence?.direction !== 'newer'
        && Number(settledSession?.intentRevision || activeSession.intentRevision)
          === Number(activeSession.intentRevision || 0)
        && topBoundaryRef.current?.controller === controller
        && topBoundaryRef.current.activationID === controller.activationID
        && topBoundaryRef.current.channelID === channelID
        && topBoundaryRef.current.viewKey === viewKey
        && Number(topBoundaryRef.current.inputEpoch || 0)
          === Number(settledSession?.inputEpoch || activeSession.inputEpoch)
        && Number(topBoundaryRef.current.intentRevision || 0)
          === Number(settledSession?.intentRevision || activeSession.intentRevision);
      if (continueTop) {
        const continuation = {
          controller, activationID: controller.activationID, channelID, viewKey,
          inputEpoch: Number(settledSession?.inputEpoch || activeSession.inputEpoch),
          intentRevision: Number(settledSession?.intentRevision || activeSession.intentRevision),
          reason, urgency, options,
          topBoundary: topBoundaryRef.current,
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
          const sameOlderIntent = ownerSession?.mode === READING_MODE.browsing
            && ownerDirection === 'older'
            && ownerInputEpoch === Number(continuation.inputEpoch || 0)
            && Number(ownerSession?.intentRevision || 0) === Number(continuation.intentRevision || 0)
            && continuation.topBoundary?.controller === controller
            && continuation.topBoundary.activationID === controller.activationID
            && continuation.topBoundary.channelID === channelID
            && continuation.topBoundary.viewKey === viewKey
            && ownerInputEpoch === Number(continuation.topBoundary.inputEpoch || 0)
            && Number(ownerSession?.intentRevision || 0)
              === Number(continuation.topBoundary.intentRevision || 0);
          if (owner?.controller !== controller || owner.channelID !== channelID
            || owner.viewKey !== viewKey || !sameOlderIntent
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
            });
          }
          void request(continuation.reason, continuation.urgency, {
            ...continuation.options,
            continuation: true,
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
    };
    return promise;
  }, [channelID, commitOwnerCandidate, committedOwnerRef, controller, historyStatusRef, historyViewSpec, requestPort, snapshotRef, viewKey]);

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
    operationID: () => activeRef.current?.controller === controller
      ? String(activeRef.current.operationID || '') : '',
    cancel(reason) {
      activeRef.current?.abortController?.abort(reason);
      activeRef.current = null;
      clearTopContinuation(topContinuationRef);
      if (topBoundaryRef.current?.controller === controller) topBoundaryRef.current = null;
    },
  });
}
