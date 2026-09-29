import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  createConversationPresentation,
  presentationEntryId,
  projectTimeline,
} from '../../model/conversation-presentation.js';
import { READING_MODE, savedBrowsingRowID, useTimelineReading } from './useTimelineReading.js';

// A list opens on the newest stretch of what the page holds, not all of it.
// The vendored list measures every row it is given before it first positions
// (so nothing is ever shown at a guessed height), which made opening a channel
// cost as much as all the history loaded in it. The rows left out are handed
// over a page at a time as the reader scrolls up — the same measured-prepend
// path network history takes, so the reader never sees a jump.
const OPEN_WINDOW_ROWS = 60;
const REVEAL_PAGE_ROWS = 40;
// A view left browsing reopens at that row only while it is this close to the
// newest one. Further back, reopening would hand the list everything from
// there down and cost as much as the old full measurement; it opens at the
// newest row instead.
const RESTORE_WITHIN_ROWS = 200;

function useOpeningWindow(channelID, messageListKey) {
  const windowRef = useRef({ key: '', fromID: '', items: [] });
  const [revision, setRevision] = useState(0);
  const admission = useMemo(() => Object.freeze({
    admit: (_channelID, items) => {
      const current = windowRef.current;
      current.items = items;
      if (current.key !== messageListKey) {
        current.key = messageListKey;
        let start = Math.max(0, items.length - OPEN_WINDOW_ROWS);
        // A view left browsing near the newest rows reopens at that row, so
        // the row is included. One left further back opens at the newest.
        const browsing = savedBrowsingRowID(channelID, messageListKey);
        const at = browsing ? items.findIndex((item) => presentationEntryId(item) === browsing) : -1;
        if (at >= 0 && items.length - at <= RESTORE_WITHIN_ROWS) start = Math.min(start, Math.max(0, at - REVEAL_PAGE_ROWS));
        current.fromID = start > 0 ? presentationEntryId(items[start]) : '';
      }
      if (!current.fromID) return items;
      const at = items.findIndex((item) => presentationEntryId(item) === current.fromID);
      // The boundary row is gone (edited away): show everything rather than
      // guess a new boundary under the reader.
      if (at <= 0) {
        current.fromID = '';
        return items;
      }
      return items.slice(at);
    },
  // `revision` re-runs the projection after a reveal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [channelID, messageListKey, revision]);
  const revealOlder = useCallback(() => {
    const current = windowRef.current;
    if (!current.fromID) return false;
    const at = current.items.findIndex((item) => presentationEntryId(item) === current.fromID);
    const next = Math.max(0, at - REVEAL_PAGE_ROWS);
    current.fromID = at > 0 && next > 0 ? presentationEntryId(current.items[next]) : '';
    setRevision((value) => value + 1);
    return true;
  }, []);
  const hasHidden = useCallback(() => Boolean(windowRef.current.fromID), []);
  return { admission, revealOlder, hasHidden };
}

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
}) {
  const presentationRef = useRef(null);
  if (!presentationRef.current) presentationRef.current = createConversationPresentation();
  const [commitVersion, setCommitVersion] = useState(0);
  const projectionVersion = state._timelineProjectionVersion ?? state.lastSeq;
  const contentVersion = state._timelineRevision ?? state.lastSeq;
  const generation = history?.status?.generation || 0;
  const openingWindow = useOpeningWindow(state.channelId, messageListKey);
  const projection = useMemo(() => projectTimeline(state, {
    ...historyViewSpec,
    presentation: presentationRef.current,
    presentationKey: messageListKey,
    dataEpoch: `${state.channelId}:${generation}`,
    localEchoes: timelineLocalEchoes,
    presentationAdmission: openingWindow.admission,
  // commitVersion re-evaluates after a candidate lost to a newer commit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [state, projectionVersion, contentVersion, historyViewSpec, messageListKey, generation, commitVersion, timelineLocalEchoes, openingWindow.admission]);

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
    // Read after the projection above has admitted this render's rows.
    hiddenOlder: openingWindow.hasHidden(),
    revealOlder: openingWindow.revealOlder,
  });

  const candidate = projection.presentation.currentEntryCandidate;
  const latestRowID = candidate && candidate.local !== true ? String(candidate.id || '') : '';
  const browsingExpandedSlots = useBrowsingExpandedSlots(viewport.mode, projection.presentation.rows, latestRowID);

  return {
    projection,
    viewport,
    latestRowID,
    browsingExpandedSlots,
  };
}
