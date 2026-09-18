export const HISTORY_INTENT = Object.freeze({
  initialView: 'initial-view',
  scrollHistory: 'scroll-history',
  searchContext: 'search-context',
});

export const HISTORY_URGENCY = Object.freeze({
  blocking: 'blocking',
  interactive: 'interactive',
  anticipatory: 'anticipatory',
});

function safePositive(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

// A semantic view can acknowledge exact visible identities without claiming
// that the channel's complete physical prefix was read. Only an unfiltered
// `all` view may produce a physical cursor, and only from rows carried by the
// same current view/activation/generation receipt. This deliberately derives
// the high-water from identity-bearing DOM evidence instead of trusting a
// caller-supplied numeric head.
function currentReadReceipt({ channelId = '', status = {}, authority = {}, receipt = {} } = {}) {
  if (!channelId || receipt.channelId !== channelId) return false;
  if (!authority.viewKey || !authority.activationID
    || receipt.viewKey !== authority.viewKey
    || receipt.activationID !== authority.activationID) return false;
  const generation = safePositive(status.generation);
  if (!generation
    || status.attached !== true
    || status.messageCurrent !== true
    || safePositive(receipt.generation) !== generation) return false;
  if (receipt.surfaceVisible !== true) return false;
  if (Number(receipt.sourceRevision || 0) !== Number(status.presentationRevision || 0)) return false;
  return true;
}

export function exactReadIdentities({ channelId = '', status = {}, authority = {}, receipt = {} } = {}) {
  if (!currentReadReceipt({ channelId, status, authority, receipt })) return [];
  const installedHigh = safePositive(receipt.installedHighSeq);
  if (!installedHigh) return [];
  const identities = new Map();
  for (const row of receipt.visibleRows || []) {
    const messageID = String(row?.messageID || '');
    const seqHigh = safePositive(row?.seqHigh);
    if (!messageID || !seqHigh || seqHigh > installedHigh) continue;
    identities.set(messageID, Math.max(identities.get(messageID) || 0, seqHigh));
  }
  return [...identities].map(([messageID, seqHigh]) => Object.freeze({ messageID, seqHigh }));
}

export function physicalReadSeq({ channelId = '', status = {}, authority = {}, receipt = {} } = {}) {
  if (!currentReadReceipt({ channelId, status, authority, receipt })) return 0;
  if (receipt.scope !== 'all'
    || !Number.isSafeInteger(receipt.actorFilterCount)
    || receipt.actorFilterCount !== 0) return 0;
  if (receipt.atTail !== true || receipt.following !== true) return 0;
  const visibleHigh = (receipt.visibleRows || []).reduce(
    (high, row) => Math.max(high, safePositive(row?.seqHigh)),
    0,
  );
  if (!visibleHigh || visibleHigh !== safePositive(receipt.installedHighSeq)) return 0;
  return visibleHigh;
}

const EMPTY_STATUS = Object.freeze({
  headSeq: 0,
  oldestSeq: 0,
  hasOlder: false,
  loaded: false,
  loading: false,
  backgroundLoading: false,
  foregroundLoading: false,
  historyDemand: Object.freeze({ revision: 0, phase: 'idle', error: '' }),
  buffered: 0,
  bufferedNewest: 0,
  revealVersion: 0,
  attached: false,
  messageCurrent: false,
  controlCurrent: false,
  tier: 3,
  completedPages: 0,
  generation: 0,
  presentationRevision: 0,
  error: '',
  localReplicaReady: true,
});

// This is the complete Visual -> Scheduler boundary for one channel. The
// visual side describes why a range matters; the scheduler still owns source,
// page size, concurrency, P0/P1/P2 and cancellation of physical batches.
export function createHistoryDemandPort({ channelId, status = EMPTY_STATUS, open, refreshLatest, markRead } = {}) {
  const request = (demand = {}) => open?.({
    intent: demand.intent || HISTORY_INTENT.scrollHistory,
    urgency: demand.urgency || HISTORY_URGENCY.interactive,
    ...demand,
  });
  const currentStatus = Object.freeze({ ...EMPTY_STATUS, ...status });
  return Object.freeze({
    channelId: channelId || '',
    status: currentStatus,
    request,
    open: request,
    refreshLatest: () => refreshLatest?.(),
    markRead: (receipt, authority) => {
      const physicalSeq = physicalReadSeq({ channelId, status: currentStatus, authority, receipt });
      const identities = exactReadIdentities({ channelId, status: currentStatus, authority, receipt });
      if (physicalSeq <= 0 && identities.length === 0) return false;
      if (typeof markRead !== 'function') return false;
      const accepted = markRead(Object.freeze({ physicalSeq, identities, receipt }));
      // Void observer/test ports accepted delivery. Production rejection is
      // explicit false; keeping that distinction lets ReadingSession retain
      // exactly one retry obligation without duplicating successful calls.
      return accepted === undefined ? true : accepted;
    },
  });
}
