export const HISTORY_INTENT = Object.freeze({
  initialView: 'initial-view',
  scrollHistory: 'scroll-history',
  restorePosition: 'restore-position',
  jumpToSource: 'jump-to-source',
  searchContext: 'search-context',
});

export const HISTORY_URGENCY = Object.freeze({
  blocking: 'blocking',
  interactive: 'interactive',
  anticipatory: 'anticipatory',
});

const EMPTY_STATUS = Object.freeze({
  headSeq: 0,
  oldestSeq: 0,
  hasOlder: false,
  loaded: false,
  loading: false,
  buffered: 0,
  bufferedNewest: 0,
  revealVersion: 0,
  attached: false,
  controlCurrent: false,
  tier: 3,
  completedPages: 0,
  generation: 0,
  error: '',
  localReplicaReady: true,
});

// This is the complete Visual -> Scheduler boundary for one channel. The
// visual side describes why a range matters; the scheduler still owns source,
// page size, concurrency, P0/P1/P2 and cancellation of physical batches.
export function createHistoryDemandPort({ channelId, status = EMPTY_STATUS, open, markRead } = {}) {
  return Object.freeze({
    channelId: channelId || '',
    status: Object.freeze({ ...EMPTY_STATUS, ...status }),
    open: (demand = {}) => open?.({
      intent: demand.intent || HISTORY_INTENT.scrollHistory,
      urgency: demand.urgency || HISTORY_URGENCY.interactive,
      ...demand,
    }),
    markRead: (seq) => markRead?.(seq),
  });
}

// Tests and rolling HMR sessions can still hand Timeline the former flat
// history object. Normalize it at the adapter edge; product components only
// consume the finite port above.
export function normalizeHistoryDemandPort(value = {}) {
  if (value?.status && typeof value?.open === 'function') return value;
  const { loadOlder, onReadLatest, ...status } = value || {};
  return createHistoryDemandPort({
    channelId: value?.channelId || '',
    status,
    open: loadOlder,
    markRead: onReadLatest,
  });
}
