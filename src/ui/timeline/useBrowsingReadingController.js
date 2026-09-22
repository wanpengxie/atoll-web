import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { diagnostic } from '../../model/diagnostics.js';
import { READING_MODE } from '../../model/reading-session.js';
import { historySupplyKey } from './history-consumer-obligation.js';

const RUNWAY_MINIMUM_PX = 800;
// A top demand that settled without a terminal (admission pending, owner
// replaced, deduplicated) is re-issued by the next level evaluation, never
// tighter than this.  Terminal results re-arm through the supply key instead.
const TOP_RETRY_MIN_MS = 120;
const TOP_RETRY_MAX_MS = 2000;
const TOP_TERMINAL_KINDS = new Set(['satisfied', 'exhausted', 'failed', 'segment']);

const sameInput = (input, owner) => Boolean(input.active
  && input.activationID === owner.activationID && input.inputEpoch === owner.inputEpoch);

const idleInput = (reading) => ({
  activationID: reading.activationID,
  inputEpoch: reading.session.inputEpoch,
  direction: '',
  canRequestHistory: false,
  active: false,
});

// "The reader is at the oldest loaded row and wants older history" is a
// level, not an event.  It is held here, outside any effect cleanup, for one
// activation; it is set by every physical top signal (native scroll, a wheel
// at the clamped top, the list's own startReached / atTopStateChange) and
// cleared only when the reader physically leaves the top.  While the level is
// up and supply can still grow, exactly one top operation is outstanding at a
// time; a settled operation is consumed for the supply it was issued against
// and re-arms as soon as the supply changes or the reader leaves and returns.
const idleTopLevel = (activationID = '') => ({
  activationID,
  atTop: false,
  demandUnits: 1,
  active: null,
  consumedSupplyKey: '',
  retryAt: 0,
  retries: 0,
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
  onTopDemandSettled = null,
}) {
  const readingRef = useRef(reading);
  const snapshotRef = useRef(snapshot);
  const handoffPendingRef = useRef(handoffPending === true);
  const rootNodeRef = useRef(rootNode);
  const inputRef = useRef(idleInput(reading));
  const runwayDemandKeyRef = useRef('');
  const coverageDemandKeyRef = useRef('');
  const topLevelRef = useRef(idleTopLevel(reading.activationID));
  // Readiness for top demands is the list's own settled paint receipt: the
  // browsing list mounts at the scroll origin and only later paints the saved
  // reading position, so its at-top signal before that receipt is not the
  // reader waiting at the oldest row.  One accepted settled observation per
  // activation is the fence; every later top signal in that activation counts.
  const settledOnceRef = useRef({ activationID: '', ready: false });
  const onTopDemandSettledRef = useRef(onTopDemandSettled);
  onTopDemandSettledRef.current = onTopDemandSettled;

  const leaveTop = useCallback((source = 'scroll') => {
    const level = topLevelRef.current;
    if (!level.atTop) return;
    level.atTop = false;
    level.consumedSupplyKey = '';
    level.retryAt = 0;
    level.retries = 0;
    const status = readingRef.current.status || {};
    diagnostic('debug', 'history.top_left', { channelId: status.channelId || '', source });
  }, []);

  // Evaluate the level against the current owner facts.  Readiness is a gate
  // on *whether* to ask; the feed operation decides *how much* to fetch.
  const pumpTop = useCallback((source = 'publish') => {
    const level = topLevelRef.current;
    const owner = readingRef.current;
    const data = snapshotRef.current;
    const current = owner.getSession();
    const status = owner.status || {};
    if (!level.atTop || level.active || handoffPendingRef.current) return false;
    if (level.activationID !== current.activationID) return false;
    if (current.mode !== READING_MODE.browsing) return false;
    const ready = settledOnceRef.current;
    if (ready.activationID !== current.activationID || ready.ready !== true) return false;
    if (owner.initializing === true || owner.restorePending === true) return false;
    const root = rootNodeRef.current;
    if (root && Number(root.scrollTop || 0) > 1) {
      leaveTop('physical');
      return false;
    }
    if (!data.rows.length || status.attached !== true || status.messageCurrent !== true) return false;
    if (status.hasOlder !== true && Number(status.buffered || 0) <= 0) return false;
    if (status.historyDemand?.phase === 'error') return false;
    const supplyKey = historySupplyKey(status);
    if (level.consumedSupplyKey === supplyKey) return false;
    const now = Date.now();
    if (now < level.retryAt) return false;
    const input = inputRef.current;
    const detail = Object.freeze({
      demandUnits: Math.max(1, Number(level.demandUnits) || 1),
      activationID: current.activationID,
      inputEpoch: Number(current.inputEpoch),
      gestureID: input.active ? String(input.gestureID || '') : '',
      hostRole: input.hostRole,
      hostToken: input.hostToken,
      source,
    });
    diagnostic('debug', 'history.top_level_demand', {
      channelId: status.channelId || '', source, inputEpoch: detail.inputEpoch,
      demandUnits: detail.demandUnits, oldestSeq: Number(status.oldestSeq || 0),
      rowCount: data.rows.length,
    });
    const pending = owner.onAtTop(detail);
    level.active = { pending, supplyKey };
    void Promise.resolve(pending).then((result) => {
      const live = topLevelRef.current;
      if (live.active?.pending !== pending) return;
      live.active = null;
      const kind = result?.kind || 'failed';
      if (TOP_TERMINAL_KINDS.has(kind)) {
        live.consumedSupplyKey = supplyKey;
        live.retries = 0;
        // A segment advanced the raw frontier without exposing rows for this
        // view; the level stays up and the changed supply re-arms it, paced
        // so a long hidden stretch is scanned in visible steps.
        live.retryAt = kind === 'segment' ? Date.now() + TOP_RETRY_MIN_MS : 0;
        onTopDemandSettledRef.current?.(Object.freeze({ ...detail, result: kind }));
      } else {
        live.retries += 1;
        live.retryAt = Date.now() + Math.min(TOP_RETRY_MAX_MS, TOP_RETRY_MIN_MS * (2 ** (live.retries - 1)));
      }
      diagnostic('debug', 'history.top_level_settled', {
        channelId: status.channelId || '', source, result: kind,
        terminal: TOP_TERMINAL_KINDS.has(kind), retries: live.retries,
      });
      // The reader may still be at the top (short list, hidden stretch, or a
      // prepend that kept scrollTop at 0).  Re-evaluate once the owner has
      // published the settled supply; a consumed supply key makes this inert.
      globalThis.setTimeout?.(() => { pumpTop('settled'); }, live.retryAt ? Math.max(0, live.retryAt - Date.now()) : 0);
    });
    return true;
  }, [leaveTop]);

  const enterTop = useCallback((evidence, source = 'evidence') => {
    const level = topLevelRef.current;
    const current = readingRef.current.getSession();
    if (evidence.activationID !== current.activationID) return false;
    level.activationID = current.activationID;
    level.demandUnits = Math.max(1, Number(evidence.demandUnits) || 1);
    if (!level.atTop) {
      level.atTop = true;
      level.consumedSupplyKey = '';
      level.retryAt = 0;
      level.retries = 0;
      const status = readingRef.current.status || {};
      diagnostic('debug', 'history.top_entered', {
        channelId: status.channelId || '', source, inputEpoch: Number(current.inputEpoch),
      });
    }
    return pumpTop(source);
  }, [pumpTop]);

  useLayoutEffect(() => {
    readingRef.current = reading;
    snapshotRef.current = snapshot;
    rootNodeRef.current = rootNode;
    handoffPendingRef.current = handoffPending === true;
    if (inputRef.current.activationID !== reading.activationID) {
      inputRef.current = idleInput(reading);
      runwayDemandKeyRef.current = '';
      coverageDemandKeyRef.current = '';
    }
    if (topLevelRef.current.activationID !== reading.activationID) {
      topLevelRef.current = idleTopLevel(reading.activationID);
    }
    if (settledOnceRef.current.activationID !== reading.activationID) {
      settledOnceRef.current = { activationID: reading.activationID, ready: false };
    }
    // Every owner publication re-evaluates the level: attach, supply growth,
    // admission settle, and mode changes all arrive here without any DOM edge.
    pumpTop('publish');
  }, [handoffPending, pumpTop, reading, reading.activationID, reading.session.inputEpoch, rootIdentity, rootMountedRef, rootNode, snapshot]);

  const requestRunway = useCallback((evidence) => {
    const owner = readingRef.current;
    const current = owner.getSession();
    if (handoffPendingRef.current || evidence.activationID !== current.activationID) return;
    // Runway is an anticipatory obligation scoped to one physical gesture.
    // Keep it deduped per input epoch; do not include the visible frontier: a
    // prepend can change the first row while the same native gesture is still
    // live, and that must not reopen the bounded demand.
    const key = `${current.activationID}:${current.inputEpoch}:runway`;
    if (runwayDemandKeyRef.current === key) return;
    runwayDemandKeyRef.current = key;
    const input = inputRef.current;
    return owner.onNearTop(Object.freeze({
      demandUnits: evidence.demandUnits,
      activationID: current.activationID,
      inputEpoch: Number(current.inputEpoch),
      gestureID: String(input.gestureID || ''),
      hostRole: input.hostRole,
      hostToken: input.hostToken,
    }));
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
      if (accepted !== false && settled) {
        const ready = settledOnceRef.current;
        if (ready.activationID !== current.activationID || !ready.ready) {
          settledOnceRef.current = { activationID: current.activationID, ready: true };
          pumpTop('settled-observation');
        }
      }
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
      // The physical top is a level owned above input attribution: any way of
      // arriving there (native scroll, a wheel at the clamp, the list's own
      // start/at-top signals, a restored position, a layout that keeps the
      // reader at 0) raises it, and only physically leaving lowers it.
      if (evidence.atTop === true) enterTop(evidence, evidence.direction ? 'input' : 'list');
      else if (Number(evidence.scrollTop) > 1) leaveTop('scroll');
      // Runway stays an anticipatory, gesture-scoped obligation.
      const input = inputRef.current;
      if (!sameInput(input, current) || evidence.inputEpoch !== current.inputEpoch) return;
      const direction = input.direction === 'browse' ? evidence.direction : input.direction;
      if (evidence.direction && direction === evidence.direction
        && input.canRequestHistory && direction === 'older' && evidence.atTop !== true
        && evidence.scrollTop <= Math.max(RUNWAY_MINIMUM_PX, evidence.clientHeight)) {
        requestRunway(evidence);
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
  }, [enterTop, leaveTop, pumpTop, requestRunway, rootIdentity, rootMountedRef, rootNode]);

  const navigationPolicy = useMemo(() => Object.freeze({
    onNavigationUpdate(transaction) {
      inputRef.current = {
        activationID: transaction.activationID,
        inputEpoch: transaction.inputGeneration,
        gestureID: transaction.id,
        hostRole: transaction.hostRole,
        hostToken: transaction.hostToken,
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
