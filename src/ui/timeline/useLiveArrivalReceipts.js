import { useLayoutEffect, useMemo, useRef } from 'react';
import { readingTrace } from '../../model/diagnostics.js';
import {
  acknowledgeLivePresentationArrivals,
  acknowledgeLiveTimelineArrivals,
} from '../../model/live-arrivals.js';
import {
  acknowledgeActiveReadingUnseen,
  prepareActiveReadingUnseen,
  readActiveReadingUnseen,
  recordActiveReadingArrivals,
} from '../../model/view-session.js';

export function useTimelineArrivalReceipt(state) {
  const tokenRef = useRef(null);
  if (!tokenRef.current) tokenRef.current = Symbol('timeline-live-arrival-consumer');

  useLayoutEffect(
    () => state.arrivalReceipts.attachTimelineConsumer(tokenRef.current),
    [state.arrivalReceipts],
  );

  const snapshot = state.arrivalReceipts.timeline();
  const durableRecords = readActiveReadingUnseen(state.channelId);
  const durableFingerprint = durableRecords.map(([key, seq]) => `${key}\u0000${seq}`).join('\u0001');
  useLayoutEffect(() => {
    recordActiveReadingArrivals(state.channelId, snapshot.events);
    if (durableRecords.length) prepareActiveReadingUnseen(state.channelId);
  }, [durableFingerprint, snapshot.events.length, snapshot.revision, state.channelId]);

  const events = useMemo(() => {
    const live = snapshot.events || [];
    const liveRecords = new Set(live.map((event) => `${event.key}\u0000${event.seq}`));
    const restored = durableRecords
      .filter(([key, seq]) => !liveRecords.has(`${key}\u0000${seq}`))
      .map(([key, seq], index) => Object.freeze({
        revision: 0,
        key,
        rowID: key,
        seq,
        durable: true,
        durableIndex: index,
      }));
    return Object.freeze([...live, ...restored]);
  }, [durableFingerprint, snapshot.events, durableRecords]);

  return {
    ...snapshot,
    events,
    acknowledge(revision) {
      const acknowledged = state.arrivalReceipts.dispatch(acknowledgeLiveTimelineArrivals(revision));
      const cleared = acknowledgeActiveReadingUnseen(state.channelId);
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
