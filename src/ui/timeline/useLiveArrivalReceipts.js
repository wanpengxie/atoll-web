import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { readingTrace } from '../../model/diagnostics.js';
import {
  acknowledgeLivePresentationArrivals,
  acknowledgeLiveTimelineRow,
  acknowledgeLiveTimelineArrivals,
} from '../../model/live-arrivals.js';
import {
  acknowledgeActiveReadingUnseen,
  prepareActiveReadingUnseen,
  readActiveReadingUnseen,
  recordActiveReadingArrivals,
  acknowledgeActiveReadingUnseenRecords,
} from '../../model/view-session.js';

function sameObservationIdentity(left, right) {
  if (!left || !right) return false;
  return String(left.activationID || '') === String(right.activationID || '')
    && Number.isSafeInteger(Number(left.inputEpoch))
    && Number(left.inputEpoch) === Number(right.inputEpoch)
    && Number.isSafeInteger(Number(left.intentRevision))
    && Number(left.intentRevision) === Number(right.intentRevision)
    && Number.isSafeInteger(Number(left.presentationRevision))
    && Number(left.presentationRevision) === Number(right.presentationRevision)
    && Number.isSafeInteger(Number(left.generation))
    && Number(left.generation) === Number(right.generation)
    && Number.isSafeInteger(Number(left.authorityRevision))
    && Number(left.authorityRevision) === Number(right.authorityRevision)
    && typeof left.tailID === 'string'
    && left.tailID === right.tailID
    && Number.isSafeInteger(Number(left.rootIdentity))
    && Number(left.rootIdentity) === Number(right.rootIdentity);
}

function sameIDs(left = [], right = []) {
  const a = [...new Set(left.map(String).filter(Boolean))].sort();
  const b = [...new Set(right.map(String).filter(Boolean))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function rejectedReceipt() {
  return Object.freeze({
    records: Object.freeze([]),
    remaining: 0,
  });
}

export function useTimelineArrivalReceipt(state, activationID, currentAuthorityRef = null) {
  const tokenRef = useRef(null);
  const activationBaselineRef = useRef(null);
  if (!tokenRef.current) tokenRef.current = Symbol('timeline-live-arrival-consumer');

  useLayoutEffect(
    () => state.arrivalReceipts.attachTimelineConsumer(tokenRef.current),
    [state.arrivalReceipts],
  );

  const snapshot = state.arrivalReceipts.timeline();
  const durableRecords = readActiveReadingUnseen(state.channelId);
  const baseline = activationBaselineRef.current;
  if (!baseline
    || baseline.activationID !== activationID
    || baseline.channelID !== state.channelId
    || baseline.arrivalReceipts !== state.arrivalReceipts) {
    activationBaselineRef.current = Object.freeze({
      activationID,
      channelID: state.channelId,
      arrivalReceipts: state.arrivalReceipts,
      revision: Number(snapshot.revision || 0),
      durableRecords: new Map(durableRecords.map(([key, seq]) => [String(key), Number(seq || 0)])),
    });
  }
  const activationBaseline = activationBaselineRef.current;
  const activeLiveEvents = (snapshot.events || []).filter((event) => (
    Number(event?.revision || 0) > Number(activationBaseline.revision || 0)
  ));
  const activeDurableRecords = durableRecords.filter(([key, seq]) => {
    const baselineSeq = activationBaseline.durableRecords.get(String(key));
    return baselineSeq == null || Number(seq || 0) > baselineSeq;
  });
  const durableFingerprint = activeDurableRecords
    .map(([key, seq]) => `${key}\u0000${seq}`).join('\u0001');
  useLayoutEffect(() => {
    recordActiveReadingArrivals(state.channelId, activeLiveEvents);
    if (activeDurableRecords.length) prepareActiveReadingUnseen(state.channelId);
  }, [activeDurableRecords.length, activeLiveEvents, durableFingerprint, state.channelId]);

  const events = useMemo(() => {
    const live = activeLiveEvents;
    // The Replica journal records every protocol transition, while Reading
    // exposes one notice per stable conversation identity. A terminal/update
    // for an already pending root must advance that root's high-water rather
    // than create a second badge. Keep the newest finite sequence for each key;
    // the raw journal revision remains owned by `snapshot` for acknowledgement.
    const byKey = new Map();
    const retain = (event) => {
      const key = String(event?.key || event?.rowID || '');
      if (!key) return;
      const seq = Number(event?.seq || 0);
      const previous = byKey.get(key);
      if (!previous
        || seq > Number(previous.seq || 0)
        || (seq === Number(previous.seq || 0)
          && Number(event?.revision || 0) > Number(previous.revision || 0))) {
        byKey.set(key, event);
      }
    };
    for (const event of live) retain(event);
    activeDurableRecords.forEach(([key, seq], index) => retain(Object.freeze({
      revision: 0,
      key,
      rowID: key,
      seq,
      durable: true,
      durableIndex: index,
    })));
    return Object.freeze([...byKey.values()].sort((left, right) => (
      Number(left.revision || 0) - Number(right.revision || 0)
    )));
  }, [activeLiveEvents, durableFingerprint, activeDurableRecords]);

  const acknowledgeVisibleRows = useCallback((receipt = {}) => {
    const currentAuthority = currentAuthorityRef?.current;
    if (receipt?.kind !== 'reading-visible-row-receipt'
      || receipt?.activationID !== activationID
      || receipt?.settled !== true
      || receipt?.atTail === true
      || !currentAuthority
      || currentAuthority.activationID !== activationID
      || currentAuthority.mode !== 'browsing'
      || currentAuthority.settled !== true
      || currentAuthority.surfaceVisible !== true
      || currentAuthority.rootIdentity <= 0
      || !Number.isSafeInteger(currentAuthority.inputEpoch)
      || !Number.isSafeInteger(currentAuthority.intentRevision)
      || !Number.isSafeInteger(currentAuthority.rootIdentity)
      || !Number.isSafeInteger(currentAuthority.presentationRevision)
      || !Number.isSafeInteger(currentAuthority.domPresentationRevision)
      || receipt.inputEpoch !== currentAuthority.inputEpoch
      || receipt.intentRevision !== currentAuthority.intentRevision
      || receipt.rootIdentity !== currentAuthority.rootIdentity
      || receipt.presentationRevision !== currentAuthority.presentationRevision
      || receipt.domPresentationRevision !== currentAuthority.domPresentationRevision
      || receipt.rootNode !== currentAuthority.rootNode
      || receipt.surfaceVisible !== true
      || !sameObservationIdentity(receipt.observationIdentity, currentAuthority.observationIdentity)) {
      return rejectedReceipt();
    }
    const visibleRowIDs = [...new Set((receipt.visibleRowIDs || [])
      .map((id) => String(id || ''))
      .filter(Boolean))];
    if (!visibleRowIDs.length || !sameIDs(visibleRowIDs, currentAuthority.visibleRowIDs)) {
      return rejectedReceipt();
    }
    const visible = new Set(visibleRowIDs);
    const viewSessionKeys = new Set();
    for (const event of activeLiveEvents) {
      const matchingRowID = [event?.rowID, ...(event?.rowIDs || [])]
        .map((id) => String(id || ''))
        .find((id) => visible.has(id));
      if (!matchingRowID) continue;
      const result = state.arrivalReceipts.dispatch(acknowledgeLiveTimelineRow({
        key: event.key,
        rowID: matchingRowID,
        seq: event.seq,
        revision: event.revision,
      }));
      if (result?.acknowledged === true) viewSessionKeys.add(String(event.key || matchingRowID));
    }
    // A DOM row without an exact current Replica event is not an arrival
    // receipt. It may be an old durable obligation or ordinary history, and
    // rowID alone is not authority to clear that ViewSession record.
    if (!viewSessionKeys.size) return Object.freeze({ records: Object.freeze([]), remaining: events.length });
    const cleared = acknowledgeActiveReadingUnseenRecords(
      state.channelId,
      [...viewSessionKeys],
      activationID,
    );
    if (cleared.records.length) {
      readingTrace('reading.visible-rows-ack', {
        channelId: state.channelId,
        kind: receipt.kind,
        mode: 'browsing',
        before: {
          count: cleared.records.length,
          records: cleared.records.map(([key, seq]) => ({ key, seq })),
        },
        remaining: cleared.remaining,
      });
    }
    return cleared;
  }, [activationID, activeLiveEvents, currentAuthorityRef, events.length, state.arrivalReceipts, state.channelId]);

  return {
    ...snapshot,
    events,
    acknowledge(revision, throughSeq) {
      const acknowledged = state.arrivalReceipts.dispatch(
        acknowledgeLiveTimelineArrivals(revision, throughSeq),
      );
      const cleared = acknowledgeActiveReadingUnseen(state.channelId, throughSeq);
      if (cleared.records.length) {
        readingTrace('reading.visible-rows-ack', {
          channelId: state.channelId,
          before: {
            count: cleared.records.length,
            records: cleared.records.map(([key, seq]) => ({ key, seq })),
          },
          remaining: cleared.remaining,
        });
      }
      return acknowledged;
    },
    acknowledgeVisibleRows,
  };
}

export function usePresentationArrivalReceipt({
  state,
  viewKey,
  surfaceVisible,
  sourceRevision,
  presentation,
  presentationOwner,
}) {
  const tokenRef = useRef(null);
  if (!tokenRef.current) tokenRef.current = Symbol('timeline-live-presentation-consumer');

  useLayoutEffect(() => {
    let release = null;
    const reconcile = () => {
      const eligible = surfaceVisible === true
        && globalThis.document?.visibilityState !== 'hidden';
      if (eligible && !release) {
        release = state.arrivalReceipts.attachPresentationConsumer(tokenRef.current);
      } else if (!eligible && release) {
        release();
        release = null;
      } else if (!eligible) {
        const headRevision = state.arrivalReceipts.presentation().headRevision;
        state.arrivalReceipts.dispatch(acknowledgeLivePresentationArrivals(headRevision));
      }
    };
    reconcile();
    globalThis.document?.addEventListener?.('visibilitychange', reconcile);
    return () => {
      globalThis.document?.removeEventListener?.('visibilitychange', reconcile);
      release?.();
    };
  }, [state.arrivalReceipts, surfaceVisible, viewKey]);

  const snapshot = state.arrivalReceipts.presentation(Number(sourceRevision || 0));
  useLayoutEffect(() => {
    if (presentationOwner.current() !== presentation) return;
    state.arrivalReceipts.dispatch(acknowledgeLivePresentationArrivals(snapshot.revision));
  }, [presentation, presentationOwner, snapshot.revision, state.arrivalReceipts]);

  return snapshot;
}
