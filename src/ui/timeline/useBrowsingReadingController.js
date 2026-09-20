import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { diagnostic } from '../../model/diagnostics.js';

const RUNWAY_MINIMUM_PX = 800;

const sameInput = (input, owner) => Boolean(input.active
  && input.activationID === owner.activationID && input.inputEpoch === owner.inputEpoch);

const idleInput = (reading) => ({
  activationID: reading.activationID,
  inputEpoch: reading.session.inputEpoch,
  direction: '',
  canRequestHistory: false,
  active: false,
});

function consumeHistoryConsumerResult(pending, recheck) {
  return Promise.resolve(pending).then((result) => {
    if (result?.kind !== 'consumer-recheck') return result;
    return recheck(result);
  });
}

// Owns input attribution, history dedupe, and semantic publication above DOM.
export function useBrowsingReadingController({
  reading,
  snapshot,
  rootNode = null,
  rootIdentity = 0,
  rootMountedRef = null,
  handoffPending = false,
}) {
  const readingRef = useRef(reading);
  const snapshotRef = useRef(snapshot);
  const handoffPendingRef = useRef(handoffPending === true);
  const inputRef = useRef(idleInput(reading));
  const frontierDemandKeyRef = useRef('');
  const coverageDemandKeyRef = useRef('');

  useLayoutEffect(() => {
    readingRef.current = reading;
    snapshotRef.current = snapshot;
    handoffPendingRef.current = handoffPending === true;
    if (inputRef.current.activationID !== reading.activationID) {
      inputRef.current = idleInput(reading);
      frontierDemandKeyRef.current = '';
      coverageDemandKeyRef.current = '';
    }
  }, [handoffPending, reading, reading.activationID, reading.session.inputEpoch, rootIdentity, rootMountedRef, rootNode, snapshot]);

  const requestHistory = useCallback((evidence, reason) => {
    const owner = readingRef.current;
    const current = owner.getSession();
    if (handoffPendingRef.current || evidence.activationID !== current.activationID) return;
    // Runway is an anticipatory obligation; once the same physical wheel
    // burst reaches scrollTop=0 it must be promoted to the interactive top
    // obligation even though the coordinator intentionally keeps one input
    // epoch across Chromium's per-tick `scrollend` events. Keep each reason
    // independently deduped, but do not include the visible frontier: a
    // prepend can change the first row while the same native gesture is still
    // live, and that must not reopen the bounded demand.
    const key = `${current.activationID}:${current.inputEpoch}:${reason}`;
    if (frontierDemandKeyRef.current === key) return;
    frontierDemandKeyRef.current = key;
    const detail = { demandUnits: evidence.demandUnits };
    if (reason === 'runway') owner.onNearTop(detail);
    else owner.onAtTop(detail);
  }, []);

  const reportDomEvidence = useCallback((evidence) => {
    const owner = readingRef.current;
    const data = snapshotRef.current;
    const current = owner.getSession();
    if (!evidence || evidence.activationID !== current.activationID) return;

    if (evidence.type === 'reading-authority') {
      const status = owner.status || {};
      const presentationRevision = Number(evidence.presentationRevision);
      const domPresentationRevision = Number(evidence.domPresentationRevision);
      const currentPresentationRevision = Number(data.revision || 0);
      const visibleRowIDs = [...new Set((evidence.visibleRowIDs || [])
        .map((id) => String(id || ''))
        .filter(Boolean))];
      const currentRowIDs = new Set((data.rows || []).map((row) => String(row?.id || '')));
      const hitTestRows = new Set((evidence.visibleRows || [])
        .map((row) => String(row?.messageID || row?.id || ''))
        .filter(Boolean));
      const identity = evidence.observationIdentity || {};
      const inputEpoch = Number(evidence.inputEpoch);
      const currentTailID = String(data.rows?.at(-1)?.id || '');
      const identityComplete = identity
        && typeof identity.activationID === 'string'
        && Number.isSafeInteger(Number(identity.inputEpoch))
        && Number.isSafeInteger(Number(identity.intentRevision))
        && Number.isSafeInteger(Number(identity.presentationRevision))
        && Number.isSafeInteger(Number(identity.generation))
        && Number.isSafeInteger(Number(identity.authorityRevision))
        && typeof identity.tailID === 'string'
        && Number.isSafeInteger(Number(identity.rootIdentity));
      const identityCurrent = identityComplete
        && String(identity.activationID || '') === String(current.activationID || '')
        && Number(identity.inputEpoch) === Number(current.inputEpoch)
        && Number(identity.intentRevision) === Number(current.intentRevision)
        && Number(identity.presentationRevision) === currentPresentationRevision
        && Number(identity.generation) === Number(status.generation || 0)
        && Number(identity.authorityRevision) === Number(status.notificationAuthorityRevision || 0)
        && String(identity.tailID || '') === currentTailID
        && Number(identity.rootIdentity) === Number(rootIdentity)
        && Number(rootIdentity) > 0
        && rootMountedRef?.current !== false
        && Number(evidence.rootIdentity) === Number(identity.rootIdentity)
        && String(evidence.tailID || '') === currentTailID
        && evidence.rootNode === rootNode;
      const evidenceComplete = typeof evidence.surfaceVisible === 'boolean'
        && typeof evidence.atTail === 'boolean'
        && evidence.settled === true
        && typeof evidence.tailID === 'string'
        && Number.isSafeInteger(Number(evidence.rootIdentity))
        && Number.isSafeInteger(Number(evidence.installedHighSeq))
        && visibleRowIDs.length > 0
        && evidence.visibleRows?.length > 0;
      const evidenceCurrent = evidenceComplete
        && Number.isSafeInteger(inputEpoch)
        && inputEpoch === Number(current.inputEpoch)
        && Number.isFinite(presentationRevision)
        && presentationRevision === currentPresentationRevision
        && Number.isFinite(domPresentationRevision)
        && domPresentationRevision === currentPresentationRevision
        && identityCurrent;
      const hitTestCurrent = visibleRowIDs.length > 0
        && visibleRowIDs.every((id) => currentRowIDs.has(id) && hitTestRows.has(id));
      const tailFence = !evidence.atTail || visibleRowIDs.includes(currentTailID);
      const highSeq = Number(evidence.installedHighSeq);
      const highSeqCurrent = !evidence.atTail
        || (Number.isSafeInteger(highSeq) && highSeq > 0
          && (Number(status.headSeq || 0) <= 0 || highSeq <= Number(status.headSeq || 0)));
      const settled = evidence.settled === true
        && evidence.surfaceVisible === true
        && evidenceCurrent
        && hitTestCurrent
        && tailFence
        && highSeqCurrent;
      // A stale callback is not a downgraded layout sample. It is rejected
      // before Reading sees it, so an old settled callback can never reinstall
      // positive evidence after a visibility/root/activation boundary.
      if (!evidenceCurrent || (evidence.settled === true && !settled)) return false;
      const accepted = owner.onReadingObservation?.({
        type: 'reading-authority',
        bookmark: evidence.bookmark,
        atTail: evidence.atTail,
        surfaceVisible: evidence.surfaceVisible,
        installedHighSeq: evidence.installedHighSeq,
        visibleRows: evidence.visibleRows,
        visibleRowIDs,
        source: evidence.source,
        settled,
        inputEpoch,
        presentationRevision,
        domPresentationRevision,
        observationIdentity: evidence.observationIdentity,
        rootIdentity: evidence.rootIdentity,
        rootNode: evidence.rootNode,
        tailID: evidence.tailID,
        geometryRevision: evidence.geometryRevision,
        activationID: evidence.activationID,
      });
      // Reading is the semantic owner of the observation lease. A controller
      // rejection (including a same-stack epoch/root replacement) must be
      // visible to the Vendor so its pending paint request is retried or
      // retired; it must never be treated as an accepted DOM receipt.
      return accepted !== false;
    }

    if (evidence.type === 'reading-sample') {
      const status = owner.status || {};
      const presentationRevision = Number(evidence.presentationRevision);
      const domPresentationRevision = Number(evidence.domPresentationRevision);
      const currentPresentationRevision = Number(data.revision || 0);
      const inputEpoch = Number(evidence.inputEpoch);
      const visibleRowIDs = [...new Set((Array.isArray(evidence.visibleRowIDs)
        ? evidence.visibleRowIDs
        : [])
        .map((id) => String(id || ''))
        .filter(Boolean))];
      const currentRowIDs = new Set((data.rows || []).map((row) => String(row?.id || '')));
      const hitTestRows = new Set((Array.isArray(evidence.visibleRows)
        ? evidence.visibleRows
        : [])
        .map((row) => String(row?.messageID || row?.id || ''))
        .filter(Boolean));
      const identity = evidence.observationIdentity;
      const identityComplete = Boolean(identity)
        && typeof identity.activationID === 'string'
        && Number.isSafeInteger(Number(identity.inputEpoch))
        && Number.isSafeInteger(Number(identity.intentRevision))
        && Number.isSafeInteger(Number(identity.presentationRevision))
        && Number.isSafeInteger(Number(identity.generation))
        && Number.isSafeInteger(Number(identity.authorityRevision))
        && typeof identity.tailID === 'string'
        && Number.isSafeInteger(Number(identity.rootIdentity));
      const currentTailID = String(data.rows?.at(-1)?.id || '');
      const identityCurrent = identityComplete
        && String(identity.activationID) === String(current.activationID)
        && Number(identity.inputEpoch) === Number(current.inputEpoch)
        && Number(identity.intentRevision) === Number(current.intentRevision)
        && Number(identity.presentationRevision) === currentPresentationRevision
        && Number(identity.generation) === Number(status.generation || 0)
        && Number(identity.authorityRevision) === Number(status.notificationAuthorityRevision || 0)
        && String(identity.tailID) === currentTailID
        && Number(identity.rootIdentity) === Number(rootIdentity)
        && Number(rootIdentity) > 0
        && rootMountedRef?.current !== false
        && Number(evidence.rootIdentity) === Number(identity.rootIdentity)
        && String(evidence.tailID) === currentTailID
        && evidence.rootNode === rootNode;
      const sampleCurrent = typeof evidence.activationID === 'string'
        && evidence.activationID === current.activationID
        && evidence.settled === false
        && typeof evidence.surfaceVisible === 'boolean'
        && typeof evidence.atTail === 'boolean'
        && typeof evidence.tailID === 'string'
        && evidence.rootNode != null
        && Number.isSafeInteger(inputEpoch)
        && inputEpoch === Number(current.inputEpoch)
        && Number.isSafeInteger(Number(evidence.rootIdentity))
        && Number.isSafeInteger(Number(evidence.installedHighSeq))
        && Number.isFinite(presentationRevision)
        && presentationRevision === currentPresentationRevision
        && Number.isFinite(domPresentationRevision)
        && domPresentationRevision === currentPresentationRevision
        && Array.isArray(evidence.visibleRows)
        && evidence.visibleRows.length > 0
        && visibleRowIDs.length > 0
        && visibleRowIDs.every((id) => currentRowIDs.has(id) && hitTestRows.has(id))
        && identityCurrent;
      if (!sampleCurrent) return false;
      const accepted = owner.onReadingSample?.({
        type: 'reading-sample',
        bookmark: evidence.bookmark,
        atTail: evidence.atTail,
        surfaceVisible: evidence.surfaceVisible,
        installedHighSeq: evidence.installedHighSeq,
        visibleRows: evidence.visibleRows,
        visibleRowIDs,
        source: evidence.source,
        settled: false,
        inputEpoch,
        presentationRevision,
        domPresentationRevision,
        observationIdentity: identity,
        rootIdentity: evidence.rootIdentity,
        rootNode: evidence.rootNode,
        tailID: evidence.tailID,
        geometryRevision: evidence.geometryRevision,
        activationID: evidence.activationID,
      });
      return accepted !== false;
    }

    if (evidence.type === 'materialized-range') {
      owner.onPresentationMaterialized?.({
        activationID: evidence.activationID,
        presentationRevision: evidence.presentationRevision,
        startIndex: evidence.startIndex,
        endIndex: evidence.endIndex,
      });
      return;
    }

    if (evidence.type === 'scroll-position') {
      const input = inputRef.current;
      if (!sameInput(input, current) || evidence.inputEpoch !== current.inputEpoch) return;
      const direction = input.direction === 'browse' ? evidence.direction : input.direction;
      if (evidence.direction && direction === evidence.direction
        && input.canRequestHistory && direction === 'older') {
        if (evidence.atTop) requestHistory(evidence, 'top');
        else if (evidence.scrollTop <= Math.max(RUNWAY_MINIMUM_PX, evidence.clientHeight)) {
          requestHistory(evidence, 'runway');
        }
      }
      return;
    }

    if (evidence.type !== 'viewport-coverage') return;
    const status = owner.status || {};
    if (handoffPendingRef.current || !data.rows.length || !evidence.hasBothBoundaries || !evidence.underfilled
      || status.attached !== true || status.messageCurrent !== true || status.hasOlder !== true
      || (Number(status.headSeq || 0) > 0 && owner.bottomReady !== true)) {
      coverageDemandKeyRef.current = '';
      return false;
    }
    const key = [current.activationID, evidence.presentationRevision, evidence.clientHeight,
      evidence.scrollHeight, status.generation, status.completedPages, status.revealVersion].join(':');
    if (coverageDemandKeyRef.current === key) return false;
    coverageDemandKeyRef.current = key;
    diagnostic('debug', 'history.viewport_underfilled', {
      channelId: status.channelId || '',
      clientHeight: evidence.clientHeight,
      scrollHeight: evidence.scrollHeight,
      rowCount: data.rows.length,
      attached: true,
      messageCurrent: true,
      bottomReady: owner.bottomReady === true,
      hasOlder: true,
    });
    const pending = owner.onUnderfill({ demandUnits: evidence.demandUnits });
    void consumeHistoryConsumerResult(pending, () => {
      if (coverageDemandKeyRef.current === key) coverageDemandKeyRef.current = '';
      evidence.onWake?.();
    });
    return true;
  }, [requestHistory, rootIdentity, rootMountedRef, rootNode]);

  const navigationPolicy = useMemo(() => Object.freeze({
    onNavigationUpdate(transaction) {
      inputRef.current = {
        activationID: transaction.activationID,
        inputEpoch: transaction.inputGeneration,
        direction: transaction.direction,
        canRequestHistory: transaction.canRequestHistory === true,
        active: true,
      };
    },
    onNavigationEnd(transaction) {
      const input = inputRef.current;
      inputRef.current = { ...input, active: false };
      return sameInput(input, {
        activationID: transaction.activationID,
        inputEpoch: transaction.inputGeneration,
      });
    },
    onNavigationCancel() {
      inputRef.current = { ...inputRef.current, active: false };
    },
    currentInput() {
      return inputRef.current;
    },
  }), []);

  return useMemo(() => Object.freeze({ navigationPolicy, reportDomEvidence }), [navigationPolicy, reportDomEvidence]);
}
