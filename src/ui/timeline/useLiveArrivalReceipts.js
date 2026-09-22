import { useLayoutEffect, useRef } from 'react';
import { acknowledgeLivePresentationArrivals } from '../../model/live-arrivals.js';

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
