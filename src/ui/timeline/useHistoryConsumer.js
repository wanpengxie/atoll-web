import { useCallback, useEffect, useInsertionEffect, useRef, useState } from 'react';
import { HISTORY_INTENT, HISTORY_URGENCY } from '../../model/history-demand.js';
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

const RESTORE_INITIALIZATION_BUDGET_MS = 500;

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
  const deadlineRef = useRef({ controller: null, deadline: 0 });

  useEffect(() => {
    if (!initializing) return undefined;
    const bookmark = controller.getSnapshot().session.bookmark;
    const following = controller.getSnapshot().session.mode === 'following';
    if ((following && (snapshot.rows.length > 0 || authoritativeEmpty || semanticExhausted))
      || (!following && (!bookmark || snapshot.rows.some((row) => row.id === bookmark.messageID)))) {
      diagnostic('debug', 'reading.initialization_ready', {
        channelId: channelID, viewKey, mode: following ? 'following' : 'browsing',
        sourceRevision: Number(snapshot.sourceRevision || 0),
        presentationRevision: Number(historyStatus.presentationRevision || 0),
        rowCount: snapshot.rows.length,
      });
      setState({ controller, value: false });
      return undefined;
    }
    let active = true;
    if (deadlineRef.current.controller !== controller) {
      deadlineRef.current = { controller, deadline: Date.now() + RESTORE_INITIALIZATION_BUDGET_MS };
    }
    const timer = setTimeout(() => {
      if (!active) return;
      diagnostic('warn', 'reading.initialization_degraded', {
        channelId: channelID, viewKey, mode: following ? 'following' : 'browsing',
        headSeq: Number(historyStatus.headSeq || 0),
        sourceRevision: Number(snapshot.sourceRevision || 0),
        presentationRevision: Number(historyStatus.presentationRevision || 0),
        visibleHighSeq: snapshot.rows.reduce((high, row) => Math.max(high, Number(row.seqHigh || 0)), 0),
      });
      setState({ controller, value: false });
    }, Math.max(0, deadlineRef.current.deadline - Date.now()));
    return () => { active = false; clearTimeout(timer); };
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
      if (failedAnticipatoryRef.current?.controller === controller) failedAnticipatoryRef.current = null;
    };
  }, [controller]);

  const request = useCallback((reason, urgency = HISTORY_URGENCY.interactive, options = {}) => {
    const {
      revealRows, revealBytes, demandUnits = 1,
      intent = HISTORY_INTENT.scrollHistory, targetSeq = 0,
      requiredVisibleCoverage = null, consumer = '',
    } = options;
    if (committedOwnerRef.current !== commitOwnerCandidate) {
      return Promise.resolve({ kind: 'stale-owner', deduplicated: true });
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
      epoch, viewKey, channelID, status: historyStatusRef.current,
      snapshot: snapshotRef.current, demandUnits,
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
    const foreground = Number(historyViewSpec?.actorFilter?.size || 0) > 0
      || historyViewSpec?.scope === 'mine';
    void request('projection-underfill', foreground
      ? HISTORY_URGENCY.interactive : HISTORY_URGENCY.anticipatory);
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
    },
  });
}
