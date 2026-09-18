import { useLayoutEffect, useRef } from 'react';
import {
  acknowledgeLivePresentationArrivals,
  acknowledgeLiveTimelineArrivals,
  livePresentationArrivals,
  liveTimelineArrivals,
  registerLivePresentationArrivalConsumer,
  registerLiveTimelineArrivalConsumer,
} from '../../model/live-arrivals.js';

export function useTimelineArrivalReceipt(state) {
  const tokenRef = useRef(null);
  if (!tokenRef.current) tokenRef.current = Symbol('timeline-live-arrival-consumer');

  useLayoutEffect(
    () => registerLiveTimelineArrivalConsumer(state, tokenRef.current),
    [state],
  );

  return {
    ...liveTimelineArrivals(state),
    acknowledge(revision) {
      acknowledgeLiveTimelineArrivals(state, revision);
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
        release = registerLivePresentationArrivalConsumer(state, tokenRef.current);
      } else if (!eligible && release) {
        release();
        release = null;
      } else if (!eligible) {
        acknowledgeLivePresentationArrivals(state, state._livePresentationArrivalRevision);
      }
    };
    reconcile();
    globalThis.document?.addEventListener?.('visibilitychange', reconcile);
    return () => {
      globalThis.document?.removeEventListener?.('visibilitychange', reconcile);
      release?.();
    };
  }, [state, surfaceVisible, viewKey]);

  const snapshot = livePresentationArrivals(state, Number(sourceRevision || 0));
  useLayoutEffect(() => {
    if (presentationOwner.current() !== presentation) return;
    acknowledgeLivePresentationArrivals(state, snapshot.revision);
  }, [presentation, presentationOwner, snapshot.revision, state]);

  return snapshot;
}
