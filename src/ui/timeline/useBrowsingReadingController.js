import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { diagnostic } from '../../model/diagnostics.js';
import { consumeHistoryConsumerResult } from './history-consumer-demand.js';

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

// Owns input attribution, history dedupe, and semantic publication above DOM.
export function useBrowsingReadingController({ reading, snapshot, handoffPending = false }) {
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
  }, [handoffPending, reading, reading.activationID, reading.session.inputEpoch, snapshot]);

  const requestHistory = useCallback((evidence, reason) => {
    const owner = readingRef.current;
    const current = owner.getSession?.() || owner.session;
    if (handoffPendingRef.current || evidence.activationID !== current.activationID) return;
    const first = snapshotRef.current.rows[0];
    const key = `${current.activationID}:${current.inputEpoch}:${first?.id || ''}:${first?.seqLow || 0}`;
    if (frontierDemandKeyRef.current === key) return;
    frontierDemandKeyRef.current = key;
    const detail = { demandUnits: evidence.demandUnits };
    if (reason === 'runway') (owner.onNearTop || owner.onAtTop)?.(detail);
    else owner.onAtTop?.(detail);
  }, []);

  const reportDomEvidence = useCallback((evidence) => {
    const owner = readingRef.current;
    const data = snapshotRef.current;
    const current = owner.getSession?.() || owner.session;
    if (!evidence || evidence.activationID !== current.activationID) return;

    if (evidence.type === 'reading-observation') {
      owner.onReadingObservation?.({
        bookmark: evidence.bookmark,
        atTail: evidence.atTail,
        surfaceVisible: evidence.surfaceVisible,
        installedHighSeq: evidence.installedHighSeq,
        visibleRows: evidence.visibleRows,
        source: evidence.source,
        settled: evidence.settled === true,
        inputEpoch: evidence.inputEpoch,
        geometryRevision: evidence.geometryRevision,
        activationID: evidence.activationID,
      });
      return;
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
      return;
    }
    const key = [current.activationID, evidence.presentationRevision, evidence.clientHeight,
      evidence.scrollHeight, status.generation, status.completedPages, status.revealVersion].join(':');
    if (coverageDemandKeyRef.current === key) return;
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
    const pending = (owner.onUnderfill || owner.onAtTop)?.({ demandUnits: evidence.demandUnits });
    void consumeHistoryConsumerResult(pending, () => {
      if (coverageDemandKeyRef.current === key) coverageDemandKeyRef.current = '';
      evidence.onWake?.();
    });
  }, [requestHistory]);

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
