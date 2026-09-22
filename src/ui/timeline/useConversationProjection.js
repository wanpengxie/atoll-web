import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  createConversationPresentation,
  projectTimeline,
} from '../../model/conversation-presentation.js';
import { usePresentationArrivalReceipt } from './useLiveArrivalReceipts.js';
import { READING_MODE, useTimelineReading } from './useTimelineReading.js';

// Rows reach the list as the replica holds them. Older history needs no
// staging here: the vendored list measures a prepended prefix before it joins
// the geometry, so admission is the identity.
const PASS_THROUGH_ADMISSION = Object.freeze({
  admit: (_channelID, items) => items,
});

// The row that was newest when the reader started browsing keeps its
// automatic expansion while they browse; a later newest row must not fold the
// text they are reading.
function useBrowsingExpandedSlots(mode, rows, latestRowID) {
  const slotRef = useRef('');
  return useMemo(() => {
    if (mode !== READING_MODE.browsing) {
      slotRef.current = '';
      return new Set();
    }
    if (!slotRef.current) {
      const latest = rows.find((row) => String(row?.id || '') === latestRowID);
      slotRef.current = String(latest?.visualSlotID || latest?.id || '');
    }
    const slot = slotRef.current;
    return slot && rows.some((row) => String(row?.visualSlotID || row?.id || '') === slot)
      ? new Set([slot])
      : new Set();
  }, [latestRowID, mode, rows]);
}

export function useConversationProjection({
  state,
  history,
  historyViewSpec,
  messageListKey,
  timelineLocalEchoes,
  surfaceVisible,
  onTailCaughtUp,
}) {
  const presentationRef = useRef(null);
  if (!presentationRef.current) presentationRef.current = createConversationPresentation();
  const [commitVersion, setCommitVersion] = useState(0);
  const projectionVersion = state._timelineProjectionVersion ?? state.lastSeq;
  const contentVersion = state._timelineRevision ?? state.lastSeq;
  const generation = history?.status?.generation || 0;
  const projection = useMemo(() => projectTimeline(state, {
    ...historyViewSpec,
    presentation: presentationRef.current,
    presentationKey: messageListKey,
    dataEpoch: `${state.channelId}:${generation}`,
    localEchoes: timelineLocalEchoes,
    presentationAdmission: PASS_THROUGH_ADMISSION,
  // commitVersion re-evaluates after a candidate lost to a newer commit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [state, projectionVersion, contentVersion, historyViewSpec, messageListKey, generation, commitVersion, timelineLocalEchoes]);

  useLayoutEffect(() => {
    const candidate = projection.presentationCandidate;
    if (!candidate) return;
    const committed = presentationRef.current.commitCandidate(candidate);
    if (!committed && presentationRef.current.current() !== projection.presentation) {
      setCommitVersion((value) => value + 1);
    }
  }, [projection]);

  const viewport = useTimelineReading({
    channelID: state.channelId,
    viewKey: messageListKey,
    snapshot: projection.presentation,
    historyStatus: history?.status || {},
    history,
    historyViewSpec,
    surfaceVisible,
    onTailCaughtUp,
  });

  const livePresentationArrivals = usePresentationArrivalReceipt({
    state,
    viewKey: messageListKey,
    surfaceVisible,
    sourceRevision: projection.presentation?.sourceRevision,
    presentation: projection.presentation,
    presentationOwner: presentationRef.current,
  });

  const candidate = projection.presentation.currentEntryCandidate;
  const latestRowID = candidate && candidate.local !== true ? String(candidate.id || '') : '';
  const browsingExpandedSlots = useBrowsingExpandedSlots(viewport.mode, projection.presentation.rows, latestRowID);

  return {
    projection,
    viewport,
    latestRowID,
    browsingExpandedSlots,
    livePresentationArrivals,
  };
}
