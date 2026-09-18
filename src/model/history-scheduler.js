import PQueue from 'p-queue';
import { diagnostic, readingTrace } from './diagnostics.js';

export const HISTORY_PAGE_SIZE = 128;
export const HISTORY_BATCH_BYTES = 1 * 1024 * 1024;
export const HISTORY_RESERVOIR_SIZE = 5_000;
export const HISTORY_RESERVOIR_CHANNEL_BYTES = 16 * 1024 * 1024;
export const HISTORY_RESERVOIR_GLOBAL_BYTES = 64 * 1024 * 1024;
export const HISTORY_MAX_INFLIGHT = 2;
export const HISTORY_MAX_BACKGROUND_INFLIGHT = 1;
export const HISTORY_REVEAL_SIZE = 32;
export const HISTORY_REVEAL_BYTES = 1 * 1024 * 1024;
export const HISTORY_BATCH_TIMEOUT_MS = 30_000;
export const HISTORY_P1_CHANNELS = 3;
export const HISTORY_P2_CHANNELS = 6;
// A page is an execution quantum, never a readiness target: adaptive pages can
// contain 32..200 rows. Working-set targets are expressed in resident rows and
// bytes so demotion, consumption and promotion naturally refill the channel.
export const HISTORY_P0_TARGET_ROWS = 256;
export const HISTORY_P1_TARGET_ROWS = 256;
export const HISTORY_P2_TARGET_ROWS = 128;
export const HISTORY_P0_TARGET_BYTES = 8 * 1024 * 1024;
export const HISTORY_P1_TARGET_BYTES = 4 * 1024 * 1024;
export const HISTORY_P2_TARGET_BYTES = 1 * 1024 * 1024;
export const HISTORY_P0_SCAN_BUDGET = 384;
export const HISTORY_P1_SCAN_BUDGET = 256;
export const HISTORY_P2_SCAN_BUDGET = 128;

const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 30_000;
const FAIRNESS_DISPATCHES = 8;
const HISTORY_PRIORITY_KEY = 'atoll.history.priority.v1';
const DEMAND_URGENCY_SCORE = Object.freeze({
  anticipatory: 0,
  interactive: 4,
  blocking: 8,
});
// Weighted round-robin is the cadence, not a permanent score. After every
// dispatched small page the next token is reconsidered against the latest
// focus/LRU/live facts. Missing tiers are skipped immediately.
const DISPATCH_WHEEL = [0, 0, 0, 1, 1, 2];

function numeric(value) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : 0;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function rowBytes(envelope) {
  try { return new TextEncoder().encode(JSON.stringify(envelope)).byteLength; }
  catch { return 0; }
}

function coverageContains(meta, seq) {
  return Array.isArray(meta?.coverage) && meta.coverage.some((entry) => (
    numeric(entry?.lowSeq) <= seq && numeric(entry?.highSeq) >= seq
  ));
}

function rangesContain(ranges, seq) {
  const target = numeric(seq);
  return target > 0 && Array.isArray(ranges) && ranges.some((entry) => (
    numeric(entry?.lowSeq) <= target && numeric(entry?.highSeq) >= target
  ));
}

function rangesCover(ranges, lowSeq, highSeq) {
  const low = numeric(lowSeq);
  const high = numeric(highSeq);
  return low > 0 && high >= low && Array.isArray(ranges) && ranges.some((entry) => (
    numeric(entry?.lowSeq) <= low && numeric(entry?.highSeq) >= high
  ));
}

function tailWindowCovered(meta, head) {
  const target = numeric(head);
  if (!target) return true;
  const interval = Array.isArray(meta?.coverage) && meta.coverage.find((entry) => (
    numeric(entry?.lowSeq) <= target && numeric(entry?.highSeq) >= target
  ));
  if (!interval) return false;
  const low = numeric(interval.lowSeq);
  return low === 1 || target - low + 1 >= HISTORY_REVEAL_SIZE;
}

function mergedCoverage(ranges = [], addition = null) {
  const ordered = [...ranges, ...(addition ? [addition] : [])]
    .map((range) => ({ lowSeq: numeric(range?.lowSeq), highSeq: numeric(range?.highSeq) }))
    .filter((range) => range.lowSeq > 0 && range.highSeq >= range.lowSeq)
    .sort((left, right) => left.lowSeq - right.lowSeq || left.highSeq - right.highSeq);
  const merged = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (!previous || range.lowSeq > previous.highSeq + 1) merged.push({ ...range });
    else previous.highSeq = Math.max(previous.highSeq, range.highSeq);
  }
  return merged;
}

function hasLocalKnowledge(meta) {
  return Boolean(meta && (numeric(meta.rowCount) > 0 || (Array.isArray(meta.coverage) && meta.coverage.length > 0)));
}

function localHead(meta) {
  const coverageHigh = Array.isArray(meta?.coverage)
    ? meta.coverage.reduce((high, entry) => Math.max(high, numeric(entry?.highSeq)), 0)
    : 0;
  return Math.max(numeric(meta?.newestSeq), coverageHigh);
}

function createState(id, previous = {}) {
  return {
    id,
    attachedGeneration: 0,
	remoteKnown: false,
	remoteEligible: true,
    headSeq: 0,
    // Deep contiguous backfill frontier. A visible-gap task owns its own
    // immutable beforeSeq and never mutates this value; IndexedDB/network are
    // interchangeable providers for either range kind.
    beforeSeq: 0,
    // A foreground freshness check owns a separate backwards cursor. It fills
    // the gap from the newly observed remote head down to the materialized tail
    // without corrupting the deep-history frontier above.
    tailRefreshBeforeSeq: 0,
    tailRefreshFloorSeq: 0,
    cacheBypassBeforeSeq: 0,
    localMeta: null,
    // In-memory scan evidence is independent from rendered rows. Visible seq
    // gaps are legal after visibility filtering; only these validated ranges
    // can prove that a cached queued response has no later terminal through H.
    localCoverage: [],
    verifiedCoverage: [],
    hasRows: false,
    hasOlder: false,
    tailVisible: false,
    // Historical rows may paint from cache immediately. Derived operational
    // controls may not: an absent terminal beyond the cached frontier would
    // otherwise resurrect an already-finished queued request.
    controlCurrent: false,
    reservoir: new Map(),
    reservoirBytes: 0,
    revealVersion: 0,
    foregroundWaiters: [],
    foregroundOwners: new Set(),
	// Presentation status belongs to a semantic, user-visible edge demand, not
	// to physical cache/network batches.  Background hydration and initial-tail
	// work may be in flight without mounting a foreground loading affordance.
	foregroundDemandRevision: 0,
	foregroundError: '',
	currentWaiters: new Set(),
	projectionPending: false,
	cancelPending: null,
    retryAt: 0,
    retryCount: 0,
    error: '',
    blockedSource: null,
    activity: 0,
    lastFocusOrder: 0,
    relatedUnreadOrder: 0,
    liveOrder: 0,
    completedPages: 0,
    warmScanned: 0,
    tier: 3,
    waitDispatches: 0,
    ...previous,
  };
}

function purposeFor(state, focus) {
  if (state.foregroundOwners.size > 0 || state.foregroundWaiters.length > 0) return 'user-demand';
  if (!state.tailVisible) return 'initial-tail';
  return 'hydrate';
}

function foregroundDemand(state) {
  let selected = null;
  for (const owner of state?.foregroundOwners || []) {
    const urgency = Object.hasOwn(DEMAND_URGENCY_SCORE, owner?.urgency)
      ? owner.urgency
      : 'interactive';
    const candidate = {
      intent: owner?.intent || 'scroll-history',
      urgency,
      score: DEMAND_URGENCY_SCORE[urgency],
    };
    if (!selected || candidate.score > selected.score) selected = candidate;
  }
  return selected;
}

function visibleForegroundOwners(state) {
  return [...(state?.foregroundOwners || [])].filter((owner) => owner?.presentation === true);
}

export function createHistoryScheduler({
  requestPage,
  cancelPage = () => Promise.resolve(),
  readCache = async () => ({ rows: [], exhausted: true, nextBeforeSeq: 0, bytes: 0 }),
  revealRows,
  hasVisibleRow = () => false,
  hasPresentedRows = () => true,
  visibleOldestSeq = () => 0,
  visibleNewestSeq = () => 0,
  persistRows = () => Promise.resolve(),
  onChange = () => {},
  onError = () => {},
  flushRealtime = () => {},
  yieldTask = () => new Promise((resolve) => globalThis.setTimeout(resolve, 0)),
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
  now = () => Date.now(),
  priorityStorage = globalThis.localStorage,
  batchBytes = HISTORY_BATCH_BYTES,
  reservoirSize = HISTORY_RESERVOIR_SIZE,
  reservoirChannelBytes = HISTORY_RESERVOIR_CHANNEL_BYTES,
  reservoirGlobalBytes = HISTORY_RESERVOIR_GLOBAL_BYTES,
  maxBackgroundInflight = HISTORY_MAX_BACKGROUND_INFLIGHT,
  batchTimeoutMs = HISTORY_BATCH_TIMEOUT_MS,
} = {}) {
  // PQueue is deliberately only the bounded executor. Candidate ownership and
  // priority stay in this coordinator, which re-scores after every batch.
  const executors = new PQueue({ concurrency: HISTORY_MAX_INFLIGHT, autoStart: true });
  const channels = new Map();
  const inflightByChannel = new Map();
  const inflightByRef = new Map();
  const cancelledRefs = new Map();
  let focus = '';
  let generation = 0;
  let remoteUnavailable = false;
  let replicaEpoch = 1;
  let stateLeaseSerial = 0;
  let globalReservoirBytes = 0;
  let reservedInflightBytes = 0;
  let dispatchSerial = 0;
  let focusSerial = 0;
  let liveSerial = 0;
  let dispatchWheelIndex = 0;
  let wakeTimer = null;
  let wakeAt = 0;
  let destroyed = false;
  let priorityScope = 'anonymous';
  // Complete cache snapshots define a source lease. Replacing one invalidates
  // every IndexedDB frontier selected from its predecessor, even when the same
  // channel id remains present with narrower coverage.
  let localMetaEpoch = 0;
  let remoteAdmissionEstablished = false;
  let admittedChannelIds = new Set();
  // Only the pull lane waits for local metadata selection. Transport attach
  // and live delivery remain independent, but history must not choose the
  // network merely because IndexedDB has not answered yet.
  let localMetaReady = true;
  // Transport attach must never wait for IndexedDB, so the focused channel
  // can use the network immediately. While a complete cache selection is
  // still pending, however, speculative work for channels off screen would
  // occupy the same per-channel lane and prevent a later local-first focus.
  let localSelectionPending = false;
  const transportStats = {
    indexeddb: { durationMs: 80, rowsPerMs: 1.6, bytesPerMs: 16 * 1024, averageRowBytes: 2 * 1024, rowLimit: HISTORY_PAGE_SIZE },
    network: { durationMs: 400, rowsPerMs: 0.32, bytesPerMs: 4 * 1024, averageRowBytes: 2 * 1024, rowLimit: HISTORY_PAGE_SIZE },
  };

  function estimateBatch(source, limit, byteLimit) {
    const stats = transportStats[source] || transportStats.network;
    const expectedBytes = Math.min(byteLimit, limit * stats.averageRowBytes);
    return Math.ceil(Math.max(
      stats.durationMs * 0.25,
      limit / Math.max(0.001, stats.rowsPerMs),
      expectedBytes / Math.max(1, stats.bytesPerMs),
    ));
  }

  function observeBatch(batch, result, rows, measuredBytes = 0) {
    const stats = transportStats[batch.source] || transportStats.network;
    const durationMs = Math.max(1, now() - batch.createdAt);
    const bytes = Math.max(0, numeric(result?.bytes), measuredBytes);
    const alpha = 0.2;
    stats.durationMs = stats.durationMs * (1 - alpha) + durationMs * alpha;
    if (rows.length > 0) {
      stats.rowsPerMs = stats.rowsPerMs * (1 - alpha) + (rows.length / durationMs) * alpha;
      stats.averageRowBytes = stats.averageRowBytes * (1 - alpha) + (bytes / rows.length) * alpha;
    }
    if (bytes > 0) stats.bytesPerMs = stats.bytesPerMs * (1 - alpha) + (bytes / durationMs) * alpha;
    const targetMs = batch.source === 'indexeddb' ? 100 : 400;
    const filled = rows.length >= Math.max(1, Math.floor(batch.limit * 0.8));
    if (durationMs > targetMs * 1.5) stats.rowLimit = Math.max(32, Math.floor(stats.rowLimit / 2));
    else if (durationMs < targetMs * 0.5 && filled && bytes < batch.byteLimit * 0.8) {
      stats.rowLimit = Math.min(200, Math.ceil(stats.rowLimit * 1.5));
    }
    return { durationMs, bytes, nextLimit: stats.rowLimit };
  }

  function restorePriority() {
    try {
      const parsed = JSON.parse(priorityStorage?.getItem?.(`${HISTORY_PRIORITY_KEY}.${priorityScope}`) || '{}');
      const views = parsed?.views && typeof parsed.views === 'object' ? parsed.views : {};
      focusSerial = numeric(parsed?.focusSerial);
      liveSerial = numeric(parsed?.liveSerial);
      return { views };
    } catch {
      return { views: {} };
    }
  }

  let restoredPriority = restorePriority();

  function schedulerState(id, previous = {}, { generationReplacement = false } = {}) {
    const state = createState(id, previous);
    state.stateLease = ++stateLeaseSerial;
    // Replacement states may inherit already-committed immutable entries, but
    // never the mutable containers still held by an asynchronous producer.
    state.reservoir = new Map(previous?.reservoir || []);
    state.reservoirBytes = [...state.reservoir.values()]
      .reduce((total, entry) => total + numeric(entry?.bytes), 0);
    state.localCoverage = mergedCoverage(previous?.localCoverage || []);
    state.verifiedCoverage = mergedCoverage(previous?.verifiedCoverage || []);
    state.foregroundWaiters = [...(previous?.foregroundWaiters || [])];
    state.foregroundOwners = new Set(previous?.foregroundOwners || []);
    state.currentWaiters = generationReplacement
      ? new Set()
      : new Set(previous?.currentWaiters || []);
    if (!state.lastFocusOrder) state.lastFocusOrder = numeric(restoredPriority.views[id]);
    return state;
  }

  function recomputeReservoirBytes() {
    globalReservoirBytes = 0;
    for (const state of channels.values()) {
      state.reservoirBytes = [...state.reservoir.values()]
        .reduce((total, entry) => total + numeric(entry?.bytes), 0);
      globalReservoirBytes += state.reservoirBytes;
    }
  }

  function dropReservoir(state) {
    if (!state) return;
    state.reservoir = new Map();
    state.reservoirBytes = 0;
    recomputeReservoirBytes();
  }

  function persistPriority() {
    try {
      const views = {};
      for (const state of [...channels.values()]
        .filter((entry) => entry.lastFocusOrder > 0)
        .sort((left, right) => right.lastFocusOrder - left.lastFocusOrder)
        .slice(0, 64)) views[state.id] = state.lastFocusOrder;
      priorityStorage?.setItem?.(`${HISTORY_PRIORITY_KEY}.${priorityScope}`, JSON.stringify({
        focusSerial, liveSerial, views,
      }));
    } catch {
      // Scheduling hints are expendable. IndexedDB remains the content cache.
    }
  }

  function setPriorityScope(scope) {
    const next = String(scope || 'anonymous');
    if (next === priorityScope) return;
    priorityScope = next;
    restoredPriority = restorePriority();
    for (const state of channels.values()) {
      state.lastFocusOrder = numeric(restoredPriority.views[state.id]);
      state.liveOrder = 0;
      state.relatedUnreadOrder = 0;
    }
  }

  function publish() { onChange(); }

  function settleForeground(state, result) {
    const waiters = state?.foregroundWaiters?.splice?.(0) || [];
	if (waiters.some((waiter) => waiter.projectionBarrier !== false)) state.projectionPending = true;
    for (const waiter of waiters) {
      waiter.cleanup?.();
      waiter.resolve(result);
    }
  }

  function visibleGapBefore(state) {
    const visibleOldest = numeric(visibleOldestSeq(state?.id));
    return visibleOldest > numeric(state?.beforeSeq) ? visibleOldest : 0;
  }

  function authoritativeExhausted(state) {
    const remoteAttached = Boolean(generation && state?.attachedGeneration === generation);
    const localAttached = Boolean(!remoteAttached && state?.remoteEligible !== false && hasLocalKnowledge(state?.localMeta));
    return Boolean(state
      && (remoteAttached || localAttached)
      && !visibleGapBefore(state)
      && !state.hasOlder
      && !state.reservoir.size
      && !inflightByChannel.has(state.id));
  }

  function clearWake() {
    if (wakeTimer != null) clearTimeoutImpl(wakeTimer);
    wakeTimer = null;
    wakeAt = 0;
  }

  function scheduleWake(at) {
    if (!(at > now())) return;
    if (wakeTimer != null && wakeAt <= at) return;
    clearWake();
    wakeAt = at;
    wakeTimer = setTimeoutImpl(() => {
      wakeTimer = null;
      wakeAt = 0;
      schedule();
    }, Math.max(1, at - now()));
  }

  function sourceFor(state, beforeSeq = state.beforeSeq) {
    const local = state.localMeta;
    if (!local || state.cacheBypassBeforeSeq === beforeSeq) return 'network';
    const frontier = beforeSeq - 1;
    return frontier > 0 && coverageContains(local, frontier) ? 'indexeddb' : 'network';
  }

  function sourceBlockIdentity(state) {
	const tailRefresh = numeric(state?.tailRefreshBeforeSeq) > 0;
	const purpose = tailRefresh ? 'initial-tail' : purposeFor(state, focus);
	const gapBeforeSeq = purpose === 'user-demand' ? visibleGapBefore(state) : 0;
	const beforeSeq = tailRefresh ? state.tailRefreshBeforeSeq : gapBeforeSeq || state.beforeSeq;
	const source = tailRefresh ? 'network' : sourceFor(state, beforeSeq);
	return {
	  source,
	  beforeSeq,
	  replicaEpoch,
	  localMetaEpoch,
	  stateLease: state.stateLease,
	  generation: source === 'network' ? generation : 0,
	};
  }

  function blockedSourceMatches(state, identity = sourceBlockIdentity(state)) {
	const blocked = state?.blockedSource;
	return Boolean(blocked
	  && blocked.source === identity.source
	  && blocked.beforeSeq === identity.beforeSeq
	  && blocked.replicaEpoch === identity.replicaEpoch
	  && blocked.localMetaEpoch === identity.localMetaEpoch
	  && blocked.stateLease === identity.stateLease
	  && blocked.generation === identity.generation);
  }

  function beginVisibleDemand(state, { explicitRetry = false } = {}) {
	state.foregroundDemandRevision += 1;
	state.retryAt = 0;
	const blockedCurrent = blockedSourceMatches(state);
	if (blockedCurrent && !explicitRetry) {
	  // The background lane already produced the terminal failure for this
	  // exact source/frontier. Promoting it to a visible obligation transfers
	  // that same failure into the sole foreground error authority; it must not
	  // erase the error while leaving candidate() blocked forever.
	  state.foregroundError = state.error;
	  return;
	}
	// Explicit Retry opens this exact source once. A source/frontier lease that
	// no longer matches also makes the old block inapplicable without a click.
	state.blockedSource = null;
	state.error = '';
	state.errorCode = '';
	state.foregroundError = '';
  }

  function reclassify() {
    for (const state of channels.values()) state.tier = 3;
    const focused = channels.get(focus);
    if (focused) focused.tier = 0;
    for (const state of channels.values()) {
      if (state.foregroundWaiters.length > 0 || state.foregroundOwners.size > 0) state.tier = 0;
    }

    const eligible = [...channels.values()].filter((state) => {
      if (state.tier === 0 || state.remoteEligible === false) return false;
      const remoteAttached = Boolean(generation && state.attachedGeneration === generation);
      const localAttached = Boolean(!remoteAttached && hasLocalKnowledge(state.localMeta));
      return (remoteAttached || localAttached)
        && (state.hasRows || state.hasOlder || hasLocalKnowledge(state.localMeta));
    });
    const ordered = [];
    const seen = new Set();
    const append = (rows) => {
      for (const state of rows) {
        if (seen.has(state.id)) continue;
        seen.add(state.id);
        ordered.push(state);
      }
    };
    const descending = (field) => eligible
      .filter((state) => state[field] > 0)
      .sort((left, right) => right[field] - left[field] || left.id.localeCompare(right.id));

    // Deterministic merge, not an opaque score: the room just left gets the
    // first next-hop slot; related unread and fresh live rooms follow; the
    // remainder is filled by actual view-MRU and finally observed activity.
    const viewed = descending('lastFocusOrder');
    append(viewed.slice(0, 1));
    append(descending('relatedUnreadOrder'));
    append(descending('liveOrder'));
    append(viewed);
    append(eligible.slice().sort((left, right) => right.activity - left.activity || left.id.localeCompare(right.id)));

    ordered.slice(0, HISTORY_P1_CHANNELS).forEach((state) => { state.tier = 1; });
    ordered.slice(HISTORY_P1_CHANNELS, HISTORY_P1_CHANNELS + HISTORY_P2_CHANNELS)
      .forEach((state) => { state.tier = 2; });
  }

  function candidate(state) {
	if (!localMetaReady) return null;
	if (localSelectionPending && state?.id !== focus
	  && state?.foregroundOwners.size === 0
	  && state?.foregroundWaiters.length === 0
	  && state?.currentWaiters.size === 0) return null;
	const remoteAttached = Boolean(generation && state?.attachedGeneration === generation);
	const localAttached = Boolean(!remoteAttached && state?.remoteEligible !== false && hasLocalKnowledge(state?.localMeta));
	if (!state || (!remoteAttached && !localAttached) || inflightByChannel.has(state.id) || state.retryAt > now()) return null;
	if (state.projectionPending) return null;
	if (state.tier >= 3) return null;
	const tailRefresh = numeric(state.tailRefreshBeforeSeq) > 0;
	const purpose = tailRefresh ? 'initial-tail' : purposeFor(state, focus);
	const demand = purpose === 'user-demand' ? foregroundDemand(state) : null;
	// Buffered rows already satisfy the foreground operation. Do not open a
	// second network page before nextSegment has projected and consumed them.
	if (purpose === 'user-demand' && state.reservoir.size > 0) return null;
	const gapBeforeSeq = purpose === 'user-demand' ? visibleGapBefore(state) : 0;
	const rangeKind = tailRefresh ? 'tail-refresh' : gapBeforeSeq ? 'visible-gap' : 'backfill';
	const taskBeforeSeq = tailRefresh ? state.tailRefreshBeforeSeq : gapBeforeSeq || state.beforeSeq;
	const targetRows = state.tier === 0
	  ? HISTORY_P0_TARGET_ROWS
	  : state.tier === 1 ? HISTORY_P1_TARGET_ROWS : HISTORY_P2_TARGET_ROWS;
	const targetBytes = state.tier === 0
	  ? HISTORY_P0_TARGET_BYTES
	  : state.tier === 1 ? HISTORY_P1_TARGET_BYTES : HISTORY_P2_TARGET_BYTES;
	const scanBudget = state.tier === 0
	  ? HISTORY_P0_SCAN_BUDGET
	  : state.tier === 1 ? HISTORY_P1_SCAN_BUDGET : HISTORY_P2_SCAN_BUDGET;
	if (!tailRefresh && purpose !== 'user-demand'
	  && (state.tailVisible || state.id !== focus)
	  && (state.reservoir.size >= targetRows || state.reservoirBytes >= targetBytes || state.warmScanned >= scanBudget)) return null;
    if (state.reservoir.size >= reservoirSize || state.reservoirBytes >= reservoirChannelBytes) return null;
	const priority = tailRefresh || state.tier === 0 ? 'foreground' : 'background';
    const urgent = priority === 'foreground';
    const channelAvailable = Math.max(0, reservoirChannelBytes - state.reservoirBytes);
    const globalAvailable = Math.max(0, reservoirGlobalBytes - globalReservoirBytes - reservedInflightBytes);
	const foregroundInflight = [...inflightByChannel.values()].some((batch) => batch.priority === 'foreground');
	// A visible user action may borrow one bounded batch beyond a full warm
	// reservoir, but a second foreground batch must wait. This keeps the global
	// overshoot bounded by exactly one batch instead of one per active channel.
	const globalAllowance = urgent && !foregroundInflight
	  ? Math.max(globalAvailable, batchBytes)
	  : globalAvailable;
	const targetByteDeficit = tailRefresh || purpose === 'user-demand' || (!state.tailVisible && state.id === focus)
      ? batchBytes
      : Math.max(1, targetBytes - state.reservoirBytes);
    const byteLimit = Math.min(batchBytes, targetByteDeficit, channelAvailable, globalAllowance);
    if (byteLimit <= 0) return null;
    // Partial final batches are valid. Requiring a whole 1 MiB quantum here
    // left every P1/P2 reservoir permanently below its configured byte target.
	if (!tailRefresh && !state.hasRows && !state.hasOlder && !hasLocalKnowledge(state.localMeta) && !gapBeforeSeq) return null;
	if (!tailRefresh && !gapBeforeSeq && state.completedPages > 0 && !state.hasOlder) return null;
    let priorityClass = priority === 'foreground' ? 100 : 0;
    if (purpose === 'user-demand') priorityClass += 20;
    else if (purpose === 'initial-tail') priorityClass += 10;
	if (tailRefresh) priorityClass += 40;
    // Starvation promotion is deliberately confined to the same transport
    // class. Background hydration can become the next background batch, but
    // it can never jump ahead of a person's active top operation.
    priorityClass += Math.min(9, Math.floor(state.waitDispatches / FAIRNESS_DISPATCHES));
    priorityClass += demand?.score || 0;
	const source = tailRefresh ? 'network' : sourceFor(state, taskBeforeSeq);
	if (blockedSourceMatches(state, {
	  source,
	  beforeSeq: taskBeforeSeq,
	  replicaEpoch,
	  localMetaEpoch,
	  stateLease: state.stateLease,
	  generation: source === 'network' ? generation : 0,
	})) return null;
	const sourceStats = transportStats[source] || transportStats.network;
	const rowDeficit = tailRefresh || purpose === 'user-demand' || !state.tailVisible
      ? sourceStats.rowLimit
      : Math.max(1, targetRows - state.reservoir.size);
    const limit = Math.max(1, Math.min(sourceStats.rowLimit, rowDeficit, reservoirSize - state.reservoir.size));
	// A local replica can stop at a coverage hole without pretending the
	// history is globally exhausted. Once attach supplies a remote source the
	// same frontier becomes schedulable again.
	if (!remoteAttached && source !== 'indexeddb') return null;
    return {
      id: `${replicaEpoch}:${source === 'network' ? generation : 'cache'}:${state.id}:${dispatchSerial + 1}`,
      // Wire generation belongs only to remote requests. IndexedDB work is
      // guarded by the local replica epoch and remains valid across reconnects.
      generation: source === 'network' ? generation : 0,
      replicaEpoch,
      localMetaEpoch,
      stateLease: state.stateLease,
      channelId: state.id,
      source,
      purpose,
      intent: demand?.intent || '',
      urgency: demand?.urgency || '',
      rangeKind,
      priority,
      beforeSeq: taskBeforeSeq,
      limit,
      byteLimit,
      estimatedMs: estimateBatch(source, limit, byteLimit),
      reservedBytes: byteLimit,
      priorityClass,
      tier: state.tier,
      lastFocusOrder: state.lastFocusOrder,
      activity: state.activity,
      waterDeficit: reservoirSize - state.reservoir.size,
      waitDispatches: state.waitDispatches,
	  visibleNewestAtDispatch: numeric(visibleNewestSeq(state.id)),
    };
  }

  function compare(left, right) {
    return right.priorityClass - left.priorityClass
      || left.tier - right.tier
      || right.lastFocusOrder - left.lastFocusOrder
      || right.activity - left.activity
      || right.waterDeficit - left.waterDeficit
      || right.waitDispatches - left.waitDispatches
      || left.channelId.localeCompare(right.channelId);
  }

  function choose() {
    const backgroundInflight = [...inflightByChannel.values()].filter((batch) => batch.priority === 'background').length;
    const candidates = [...channels.values()].map(candidate).filter((batch) => (
      batch && (batch.priority === 'foreground' || backgroundInflight < maxBackgroundInflight)
    ));
    if (!candidates.length) return null;
    // A focused head check has proved that the current screen is stale. This
    // is the highest-priority data demand: it wins before ordinary top-scroll
    // and before the hydration wheel.
    const freshness = candidates.filter((batch) => batch.rangeKind === 'tail-refresh').sort(compare)[0];
    if (freshness) return freshness;
    // A person explicitly paging always wins the next free executor regardless
    // of the wheel. Ordinary hydration then follows 3:2:1 weighted RR.
    const demanded = candidates.filter((batch) => batch.purpose === 'user-demand').sort(compare)[0];
    if (demanded) return demanded;
    const focused = channels.get(focus);
    if (focused && !focused.tailVisible) {
      const selected = candidates.filter((batch) => batch.channelId === focus).sort(compare)[0];
      if (selected) return selected;
      if (inflightByChannel.has(focus)) return null;
    }
    for (let offset = 0; offset < DISPATCH_WHEEL.length; offset += 1) {
      const index = (dispatchWheelIndex + offset) % DISPATCH_WHEEL.length;
      const tier = DISPATCH_WHEEL[index];
      const selected = candidates.filter((batch) => batch.tier === tier).sort(compare)[0];
      if (!selected) continue;
      dispatchWheelIndex = (index + 1) % DISPATCH_WHEEL.length;
      return selected;
    }
    return candidates.sort(compare)[0] || null;
  }

  async function stageRows(state, rows, {
    allowGlobalOverflow = false,
    sourceCancellation = null,
  } = {}) {
    const staged = [];
    const stagedSeqs = new Set();
    let stagedBytes = 0;
    let measuredBytes = 0;
    let complete = true;
    for (let index = 0; index < rows.length; index += 1) {
      // Pull work is cooperative. A live frame received between chunks is
      // committed before the next chunk rather than waiting behind a whole
      // historical page on the browser's single main thread.
      if (index > 0 && index % 16 === 0) {
        await Promise.race([
          yieldTask(),
          sourceCancellation || new Promise(() => {}),
        ]);
        flushRealtime();
      }
      const row = rows[index];
      const seq = numeric(row.seq);
      if (!seq || hasVisibleRow(state.id, seq) || state.reservoir.has(seq) || stagedSeqs.has(seq)) continue;
      const bytes = rowBytes(row.envelope);
      measuredBytes += bytes;
      if (state.reservoir.size + staged.length >= reservoirSize
        || state.reservoirBytes + stagedBytes + bytes > reservoirChannelBytes
        || (!allowGlobalOverflow && globalReservoirBytes + stagedBytes + bytes > reservoirGlobalBytes)
        || (allowGlobalOverflow && globalReservoirBytes + stagedBytes + bytes > reservoirGlobalBytes + batchBytes)) {
        complete = false;
        break;
      }
      staged.push({ seq, envelope: row.envelope, bytes });
      stagedSeqs.add(seq);
      stagedBytes += bytes;
    }
    return { staged, measuredBytes, complete, allowGlobalOverflow };
  }

  function installStagedRows(state, stagedPage) {
    const additions = stagedPage.staged.filter(({ seq }) => (
      !hasVisibleRow(state.id, seq) && !state.reservoir.has(seq)
    ));
    const additionBytes = additions.reduce((total, entry) => total + entry.bytes, 0);
    const globalLimit = reservoirGlobalBytes
      + (stagedPage.allowGlobalOverflow ? batchBytes : 0);
    if (!stagedPage.complete
      || state.reservoir.size + additions.length > reservoirSize
      || state.reservoirBytes + additionBytes > reservoirChannelBytes
      || globalReservoirBytes + additionBytes > globalLimit) {
      // A page terminal advances across every scanned sequence. Publishing a
      // partial displayable subset would strand the omitted suffix behind the
      // new cursor, so fail the whole reducer without changing any state.
      throw new Error('历史批次超过当前原子安装预算');
    }
    for (const { seq, envelope, bytes } of additions) {
      state.reservoir.set(seq, { envelope, bytes });
      state.reservoirBytes += bytes;
      globalReservoirBytes += bytes;
    }
    return additions.length;
  }

  function release(state, count, {
    initial = false,
    materializesCurrentTail = initial,
    byteLimit = HISTORY_REVEAL_BYTES,
  } = {}) {
    if (!state || count <= 0 || !state.reservoir.size) return 0;
    const selected = [];
    let selectedBytes = 0;
    for (const entry of [...state.reservoir.entries()].sort(([left], [right]) => right - left)) {
      if (selected.length >= count) break;
      if (selected.length && selectedBytes + entry[1].bytes > byteLimit) break;
      selected.push(entry);
      selectedBytes += entry[1].bytes;
    }
    selected.sort(([left], [right]) => left - right);
    // Mutation happens only after the synchronous Replica handoff. If the
    // handoff throws, the reservoir remains the unique recoverable supply even
    // though the page cursor itself has already committed.
    revealRows?.(state.id, selected.map(([seq, value]) => [seq, value.envelope]), {
      initial,
      materializesCurrentTail,
    });
    for (const [seq, value] of selected) {
      state.reservoir.delete(seq);
      state.reservoirBytes -= value.bytes;
      globalReservoirBytes -= value.bytes;
    }
    state.revealVersion += 1;
    // Releasing a warm segment consumes the prediction. The channel may refill
    // to its current tier target instead of being blocked by lifetime counters.
    state.warmScanned = 0;
    return selected.length;
  }

  function retry(state, error, { automatic = false } = {}) {
    state.retryCount += 1;
    state.error = error?.message || String(error || '历史加载失败');
    state.errorCode = String(error?.code || 'history_failed');
	if (visibleForegroundOwners(state).length > 0) state.foregroundError = state.error;
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(6, state.retryCount - 1));
    state.retryAt = automatic ? now() + delay : 0;
    diagnostic('warn', automatic ? 'history.batch_retry' : 'history.batch_blocked', {
      channelId: state.id,
      generation,
      delay: automatic ? delay : 0,
      detail: state.error,
      code: error?.code || '',
    });
    if (automatic) scheduleWake(state.retryAt);
    settleForeground(state, { kind: 'failed', error: error instanceof Error ? error : new Error(state.error) });
    onError(error instanceof Error ? error : new Error(state.error));
	for (const waiter of [...state.currentWaiters]) {
	  waiter.cleanup?.();
	  state.currentWaiters.delete(waiter);
	  waiter.reject(error instanceof Error ? error : new Error(state.error));
	}
  }

  function installedCoverage(state) {
    return mergedCoverage([
      ...(state?.localCoverage || []),
      ...(state?.verifiedCoverage || []),
    ]);
  }

  function currentTargetInstalled(state, targetHead) {
    const target = numeric(targetHead);
    // An authoritative empty head has no positive sequence to put in a
    // coverage interval. Requiring rangesContain(..., 0) leaves the focused
    // freshness obligation pending until timeout even though Meta has proved
    // there is nothing to fetch.
    if (target === 0) return state?.remoteKnown === true && numeric(state.headSeq) === 0;
    return rangesContain(installedCoverage(state), target);
  }

  function requireRemoteTail(state, floorSeq = visibleNewestSeq(state?.id)) {
	const target = numeric(state?.headSeq);
	const floor = numeric(floorSeq);
	if (!state?.attachedGeneration || !target || target <= floor || currentTargetInstalled(state, target)) return false;
	const alreadyPending = numeric(state.tailRefreshBeforeSeq) > 0;
	state.tailRefreshBeforeSeq = Math.max(numeric(state.tailRefreshBeforeSeq), target + 1);
	state.tailRefreshFloorSeq = alreadyPending
	  ? Math.min(numeric(state.tailRefreshFloorSeq), floor)
	  : floor;
	state.controlCurrent = false;
	return true;
  }

  function settleCurrentWaiters(state) {
	if (!state?.currentWaiters?.size) return;
	const newest = numeric(visibleNewestSeq(state.id));
	for (const waiter of [...state.currentWaiters]) {
	  if (!currentTargetInstalled(state, waiter.targetHead)
	    || state.tailRefreshBeforeSeq || !state.controlCurrent) continue;
	  waiter.cleanup?.();
	  state.currentWaiters.delete(waiter);
	  waiter.resolve({ channelId: state.id, headSeq: waiter.targetHead, newestSeq: newest });
	}
  }

  async function executeNetwork(batch) {
    const terminal = deferred();
    batch.phase = 'network-receipt';
    let accepted;
    try {
      accepted = requestPage(batch.channelId, batch.beforeSeq, batch.limit, {
        purpose: batch.purpose, priority: batch.priority,
        intent: batch.intent, urgency: batch.urgency,
        generation: batch.generation, byteLimit: batch.byteLimit,
        rangeKind: batch.rangeKind,
      });
    } catch (error) {
      throw error;
    }
    batch.ref = accepted?.ref || '';
    batch.rows = [];
    batch.terminal = terminal;
    // A cancellation may arrive immediately after dispatch, before the receipt
    // promise has yielded. Mark this promise handled now; awaiting it below
    // still observes the same rejection.
    void terminal.promise.catch(() => {});
    inflightByRef.set(batch.ref, batch);
    const receipt = await Promise.race([
      accepted,
      batch.sourceCancellation.promise,
    ]);
    if (!receipt?.accepted || receipt.generation !== batch.generation || receipt.channel_id !== batch.channelId) {
      throw new Error('历史批次回执不匹配');
    }
    batch.phase = 'network-page';
    const page = await Promise.race([
      terminal.promise,
      batch.sourceCancellation.promise,
    ]);
	return { ...page, declaredRows: page.rows, rows: batch.rows };
  }

  async function execute(batch) {
    if (batch.cancelled) throw new Error('history batch cancelled');
    if (batch.source === 'indexeddb') {
      batch.phase = 'cache-read';
      return Promise.race([
        readCache(batch.channelId, batch.beforeSeq, batch.limit, batch.byteLimit),
        batch.sourceCancellation.promise,
      ]);
    }
    return executeNetwork(batch);
  }

  function validateNetworkPage(batch, result, rows) {
	if (numeric(result.generation) !== batch.generation) throw new Error('历史批次 generation 不匹配');
	if (result.channel_id !== batch.channelId) throw new Error('历史批次 channel 不匹配');
	const declaredRows = Number(result.declaredRows);
	if (!Number.isSafeInteger(declaredRows) || declaredRows !== rows.length) throw new Error('历史批次 rows 计数不匹配');
	const scanHigh = Number(result.scan_high_seq);
	const nextBefore = Number(result.next_before_seq);
	if (!Number.isSafeInteger(scanHigh) || scanHigh !== batch.beforeSeq - 1) {
	  throw new Error(`历史批次 scan_high 不连续: got=${scanHigh} want=${batch.beforeSeq - 1}`);
	}
	if (!Number.isSafeInteger(nextBefore) || nextBefore < 0 || nextBefore > scanHigh) throw new Error('历史批次 next_before 非法');
	const scanLow = Number(result.scan_low_seq);
	if (!Number.isSafeInteger(scanLow) || scanLow !== nextBefore) throw new Error('历史批次 scan_low 与 cursor 不一致');
	if (result.has_older && nextBefore >= batch.beforeSeq) throw new Error('历史批次 cursor 未前进');
	for (const row of rows) {
	  const seq = Number(row.seq);
	  if (!Number.isSafeInteger(seq) || seq < scanLow || seq > scanHigh) throw new Error('历史事实落在扫描区间外');
	}
  }

  function validateCachePage(batch, result, rows) {
    const nextBefore = Number(result.nextBeforeSeq);
    if (!Number.isSafeInteger(nextBefore) || nextBefore <= 0 || nextBefore >= batch.beforeSeq) {
      throw new Error('缓存历史批次 cursor 未前进');
    }
    for (const row of rows) {
      const seq = Number(row.seq);
      if (!Number.isSafeInteger(seq) || seq < nextBefore || seq >= batch.beforeSeq) {
        throw new Error('缓存历史事实落在扫描区间外');
      }
    }
  }

  function batchIsCurrent(batch) {
    const state = channels.get(batch.channelId);
    return batch.cancelled !== true
      && batch.replicaEpoch === replicaEpoch
      && (batch.source !== 'network' || batch.generation === generation)
      && (batch.source !== 'indexeddb' || batch.localMetaEpoch === localMetaEpoch)
      && state?.stateLease === batch.stateLease
      && inflightByChannel.get(batch.channelId) === batch;
  }

  async function commit(batch, result) {
    if (!batchIsCurrent(batch)) return;
    batch.committing = true;
    let state = channels.get(batch.channelId);
    if (!state) return;
    const rows = (result.rows || []).sort((left, right) => left.seq - right.seq);
    if (batch.source === 'indexeddb') {
      // Metadata can become stale after FIFO/quota eviction. A miss does not
      // advance truth; it only bypasses this cache claim at the same frontier.
      if (result.cacheMiss) {
        state.cacheBypassBeforeSeq = batch.beforeSeq;
		// A stale IndexedDB frontier may sit below the authoritative remote
		// head. Falling through to network at that same deep cursor would skip
		// the remote-only tail forever; reuse the existing freshness lane first.
		if (batch.purpose === 'initial-tail') requireRemoteTail(state);
        if (!state.attachedGeneration && batch.rangeKind === 'backfill') state.hasOlder = false;
        diagnostic('warn', 'history.cache_claim_missed', {
          channelId: state.id, beforeSeq: batch.beforeSeq, generation,
        });
        settleForeground(state, { kind: 'exhausted', localOnly: true });
        return;
      }
      validateCachePage(batch, result, rows);
    } else {
      validateNetworkPage(batch, result, rows);
    }
    // Cooperative decoding owns only local staging. No cursor, coverage,
    // currentness or reservoir fact is published until the complete page has
    // crossed the same state/generation/batch lease below.
    const stagedPage = await stageRows(state, rows, {
      allowGlobalOverflow: batch.priority === 'foreground',
      sourceCancellation: batch.sourceCancellation?.promise,
    });
    if (!batchIsCurrent(batch) || batch.cancelled) return;
    state = channels.get(batch.channelId);
    if (!state) return;

    // From here through row installation, cursor/coverage/currentness and byte
    // accounting are one synchronous reducer. installStagedRows validates that
    // every still-displayable row fits before the first mutation occurs.
    const acceptedRows = installStagedRows(state, stagedPage);
    if (batch.source === 'indexeddb') {
      if (batch.rangeKind === 'backfill') state.beforeSeq = Number(result.nextBeforeSeq);
      state.cacheBypassBeforeSeq = 0;
	  if (!state.attachedGeneration && result.exhausted && batch.rangeKind === 'backfill') state.hasOlder = false;
    } else {
      state.headSeq = Math.max(state.headSeq, numeric(result.head_seq));
	  if (batch.rangeKind === 'backfill') state.beforeSeq = Number(result.next_before_seq);
	  state.cacheBypassBeforeSeq = 0;
	  // Cursor zero is the ledger origin and therefore authoritative exhaustion,
	  // even if an older server/mocked projector conservatively reports
	  // has_older=true because only hidden housekeeping remains.
	  if (batch.rangeKind === 'backfill') state.hasOlder = Boolean(result.has_older) && state.beforeSeq > 0;
	  if (batch.rangeKind === 'tail-refresh') {
		const nextBefore = numeric(result.next_before_seq);
		const floor = numeric(state.tailRefreshFloorSeq);
		// With no materialized local tail there is no seam to bridge: one
		// validated page establishes the bounded current-tail working set. A
		// non-zero floor means cache/live content already exists, so continue
		// exactly until that seam is covered.
		state.tailRefreshBeforeSeq = floor > 0 && Boolean(result.has_older) && nextBefore > floor + 1
		  ? nextBefore
		  : 0;
		if (!state.tailRefreshBeforeSeq) {
		  // A stale-tail attach initially points the deep cursor at head + 1.
		  // Once the gap is bridged, continue below the former local tail rather
		  // than requesting the just-verified range a second time.
		  if (floor > 0 && state.beforeSeq === state.headSeq + 1) state.beforeSeq = floor + 1;
		  state.tailRefreshFloorSeq = 0;
		  state.controlCurrent = true;
		}
	  }
      const lowSeq = numeric(result.scan_low_seq);
      const highSeq = numeric(result.scan_high_seq);
      state.verifiedCoverage = mergedCoverage(state.verifiedCoverage, { lowSeq, highSeq });
	  // A complete local-Meta snapshot can finish while this page is yielding
	  // and open the freshness lane for the exact same remote frontier. The
	  // validated page already owns that scan. Retire only that identical
	  // request (and only once it reaches the pre-existing visible seam), so a
	  // genuinely newer head still keeps its separate tail refresh.
	  if (state.tailRefreshBeforeSeq === batch.beforeSeq
	    && currentTargetInstalled(state, state.headSeq)) {
		const refreshFloor = numeric(state.tailRefreshFloorSeq);
		const nextBefore = numeric(result.next_before_seq);
		if (!refreshFloor || !result.has_older || nextBefore <= refreshFloor + 1) {
		  state.tailRefreshBeforeSeq = 0;
		  state.tailRefreshFloorSeq = 0;
		} else state.tailRefreshBeforeSeq = nextBefore;
	  }
	  // The page terminal carries a fresh authoritative head. It may advance
	  // after the request's exclusive beforeSeq was chosen (for example while
	  // attach/OBS facts are being committed). Never continue older hydration
	  // while that newly discovered suffix remains outside this page's scan.
	  if (state.headSeq > highSeq && !currentTargetInstalled(state, state.headSeq)) {
		requireRemoteTail(state, highSeq);
	  }
      const coverageByChannel = lowSeq && highSeq >= lowSeq
        ? new Map([[state.id, { lowSeq, highSeq }]])
        : new Map();
      void persistRows(rows, { coverageByChannel }).catch((error) => diagnostic('error', 'history.cache_persist_failed', { channelId: state.id, error }));
    }
    const timing = observeBatch(batch, result, rows, stagedPage.measuredBytes);
    state.completedPages += 1;
    if (batch.purpose !== 'user-demand' && batch.rangeKind === 'backfill') {
      const scanLow = numeric(result.scan_low_seq) || numeric(result.scanLowSeq);
      const scanHigh = numeric(result.scan_high_seq) || numeric(result.scanHighSeq);
      state.warmScanned += scanHigh >= scanLow && scanLow > 0 ? scanHigh - scanLow + 1 : batch.limit;
    }
    let initialReleased = 0;
    const visibleIntent = state.id === focus
      || state.foregroundWaiters.length > 0
      || state.foregroundOwners.size > 0;
    if (batch.rangeKind === 'tail-refresh' && visibleIntent && acceptedRows > 0) {
      initialReleased = release(state, acceptedRows, {
        initial: false,
        materializesCurrentTail: true,
        byteLimit: batch.byteLimit,
      });
	  state.tailVisible = hasPresentedRows(state.id);
    } else if (!state.tailVisible && visibleIntent) {
      initialReleased = release(state, HISTORY_REVEAL_SIZE, { initial: true, byteLimit: batch.byteLimit });
      state.tailVisible = hasPresentedRows(state.id);
      if (!state.tailVisible && state.reservoir.size > 0) {
        initialReleased += release(state, state.reservoir.size, { initial: true, byteLimit: batch.byteLimit });
        state.tailVisible = hasPresentedRows(state.id);
      }
    }
	if (batch.source === 'network' && batch.rangeKind === 'backfill' && batch.purpose === 'initial-tail') {
	  state.controlCurrent = !state.tailRefreshBeforeSeq && currentTargetInstalled(state, state.headSeq);
	}
	if (batch.source === 'indexeddb' && batch.purpose === 'initial-tail' && state.attachedGeneration) {
	  const localNewest = numeric(visibleNewestSeq(state.id));
	  if (state.headSeq > localNewest && !rangesContain(installedCoverage(state), state.headSeq)) {
		state.tailRefreshBeforeSeq = state.headSeq + 1;
		state.tailRefreshFloorSeq = localNewest;
	  }
	}
	if (state.attachedGeneration && state.tailVisible && tailWindowCovered(state.localMeta, state.headSeq)) {
	  state.controlCurrent = true;
	}
	settleCurrentWaiters(state);
    state.retryAt = 0;
    state.retryCount = 0;
    state.error = '';
	if (batch.purpose === 'user-demand' && visibleForegroundOwners(state).length > 0) {
	  state.foregroundError = '';
	}
    diagnostic('info', 'history.batch_complete', {
      channelId: state.id, focus, visibleIntent, initialReleased, tailVisible: state.tailVisible,
      source: batch.source, purpose: batch.purpose, priority: batch.priority, tier: batch.tier,
      generation, ref: batch.ref || '', rows: rows.length,
      acceptedRows, reservoir: state.reservoir.size, reservoirBytes: state.reservoirBytes,
      durationMs: timing.durationMs, estimatedMs: batch.estimatedMs, nextLimit: timing.nextLimit,
      hasOlder: state.hasOlder,
      beforeSeq: state.beforeSeq,
      rangeKind: batch.rangeKind,
      nextBeforeSeq: numeric(result.next_before_seq) || numeric(result.nextBeforeSeq),
      scanLowSeq: numeric(result.scan_low_seq), scanHighSeq: numeric(result.scan_high_seq),
    });
    readingTrace('history.batch-complete', {
      channelId: state.id,
      generation,
      ref: batch.ref || '',
      source: batch.source,
      purpose: batch.purpose,
      rangeKind: batch.rangeKind,
      rows: rows.length,
      acceptedRows,
      beforeSeq: state.beforeSeq,
      nextBeforeSeq: numeric(result.next_before_seq) || numeric(result.nextBeforeSeq),
    });
    if (initialReleased > 0) settleForeground(state, { kind: 'segment', released: initialReleased, initial: true });
    else if (state.reservoir.size > 0) settleForeground(state, { kind: 'available' });
    else if (!state.hasOlder) settleForeground(state, { kind: 'exhausted' });
    else settleForeground(state, { kind: 'segment', released: 0, scanAdvanced: true });
  }

  function dispatch(batch) {
    dispatchSerial += 1;
    batch.createdAt = now();
    batch.createdDispatch = dispatchSerial;
    inflightByChannel.set(batch.channelId, batch);
    batch.sourceCancellation = deferred();
    // Physical IndexedDB reads and a network request's receipt/page phases can
    // both settle after ownership moved. Race the shared cancellation signal
    // so neither source keeps the executor/channel lane occupied; late results
    // remain unable to commit through batchIsCurrent/cancelledRefs.
    void batch.sourceCancellation.promise.catch(() => {});
    reservedInflightBytes += batch.reservedBytes;
    for (const state of channels.values()) {
      if (state.id === batch.channelId) state.waitDispatches = 0;
      else if (candidate(state)) state.waitDispatches += 1;
    }
	diagnostic('info', 'history.segment_requested', batch);
    readingTrace('history.segment-requested', {
      channelId: batch.channelId,
      generation: batch.generation,
      ref: batch.ref || '',
      source: batch.source,
      purpose: batch.purpose,
      rangeKind: batch.rangeKind,
      beforeSeq: batch.beforeSeq,
      limit: batch.limit,
    });
    let failed = false;
    // One executor deadline owns receipt/cache read, cooperative staging, and
    // the atomic commit. A decode yield that never resumes must not retain the
    // channel lane or reserved bytes outside the timeout domain.
    executors.add(async () => commit(batch, await execute(batch)), {
      id: batch.id,
      timeout: batchTimeoutMs,
    }).catch((error) => {
      failed = true;
      const state = channels.get(batch.channelId);
	  const timedOut = error?.name === 'TimeoutError'
	    || error?.code === 'timeout'
	    || error?.code === 'history_timeout';
	  if (!batch.cancelled && batchIsCurrent(batch) && !destroyed && state) {
		const sourceError = timedOut ? new Error(batch.source === 'indexeddb'
		  ? '本地缓存读取超时，请重试'
		  : batch.phase === 'network-page'
		    ? '历史数据响应超时，请重试'
		    : '历史请求回执超时，请重试') : error;
		if (timedOut) sourceError.code = batch.source === 'indexeddb'
		  ? 'history_cache_timeout'
		  : batch.phase === 'network-page'
		    ? 'history_page_timeout'
		    : 'history_receipt_timeout';
		state.blockedSource = {
		  source: batch.source,
		  beforeSeq: batch.beforeSeq,
		  replicaEpoch: batch.replicaEpoch,
		  localMetaEpoch: batch.localMetaEpoch,
		  stateLease: batch.stateLease,
		  generation: batch.generation,
		};
		const canFallbackToNetwork = batch.source === 'indexeddb'
		  && generation > 0
		  && state.attachedGeneration === generation;
		if (canFallbackToNetwork) {
		  state.cacheBypassBeforeSeq = batch.beforeSeq;
		}
		cancelBatch(batch, sourceError?.message || 'history source failed');
		if (canFallbackToNetwork) {
		  diagnostic('warn', 'history.source_fallback', {
		    channelId: batch.channelId,
		    from: 'indexeddb',
		    to: 'network',
		    beforeSeq: batch.beforeSeq,
		    detail: sourceError?.message || '',
		  });
		} else {
		  // A source failure is a typed terminal for this exact authority/frontier,
		  // not EOF and not an automatic retry loop. Explicit Retry clears the
		  // block once; source-authority replacement makes the fence inapplicable.
		  retry(state, sourceError, { automatic: false });
		}
		return;
	  }
    }).finally(() => {
      reservedInflightBytes = Math.max(0, reservedInflightBytes - batch.reservedBytes);
      if (batch.ref) inflightByRef.delete(batch.ref);
      if (inflightByChannel.get(batch.channelId) === batch) inflightByChannel.delete(batch.channelId);
      // Silent hydration changes only the off-DOM reservoir. Publishing every
      // batch would make the full app reconcile continuously while idle. Initial
      // paint, sticky user demand, and errors remain observable immediately.
      if (batch.tier === 0 || failed) publish();
      schedule();
    });
  }

  function cancelBatch(batch, reason = 'history operation cancelled') {
    if (!batch || batch.cancelled) return;
    batch.cancelled = true;
	if (batch.ref) {
	  cancelledRefs.set(batch.ref, { channelId: batch.channelId, generation: batch.generation });
	  while (cancelledRefs.size > 128) cancelledRefs.delete(cancelledRefs.keys().next().value);
    }
    batch.terminal?.reject(new Error(reason));
    batch.sourceCancellation?.reject(new Error(reason));
    if (batch.source === 'network' && batch.ref) {
	  const state = channels.get(batch.channelId);
	  const pending = Promise.resolve().then(() => cancelPage(batch.channelId, batch.ref, batch.generation));
	  if (state) state.cancelPending = pending;
      void pending.catch((error) => {
        diagnostic('warn', 'history.cancel_failed', { channelId: batch.channelId, ref: batch.ref, error });
	  }).finally(() => {
		if (state?.cancelPending === pending) state.cancelPending = null;
		publish();
		schedule();
      });
    }
    diagnostic('debug', 'history.batch_cancelled', {
      channelId: batch.channelId, ref: batch.ref || '', generation: batch.generation, reason,
    });
  }

  function cancelUnownedForeground(state) {
    if (!state || state.foregroundWaiters.length > 0) return;
    const batch = inflightByChannel.get(state.id);
    if (batch?.priority === 'foreground' && batch.purpose === 'user-demand') cancelBatch(batch);
  }

  function promoteChannel(state, reason) {
    const batch = state ? inflightByChannel.get(state.id) : null;
    if (batch?.priority !== 'background') return;
	// The bytes already in flight are precisely the bytes the newly focused
	// channel needs. Adopt the batch instead of cancelling it and waiting for a
	// remote cancellation receipt before issuing the same range again.
	batch.priority = 'foreground';
	batch.tier = 0;
	diagnostic('debug', 'history.batch_promoted', {
	  channelId: batch.channelId, ref: batch.ref || '', generation: batch.generation, reason,
	});
  }

  function preemptForFocusedCandidate() {
    // cancelBatch releases its logical source immediately, but the executor is
    // removed from inflightByChannel by dispatch.finally. Do not retire a
    // second page while that first cancellation is already making capacity.
    const active = [...inflightByChannel.values()].filter((batch) => !batch.cancelled);
    if (active.length < HISTORY_MAX_INFLIGHT || active.length !== inflightByChannel.size) return false;
    const focused = channels.get(focus);
    const focusedCandidate = candidate(focused);
    if (!focusedCandidate || focusedCandidate.channelId !== focus || focusedCandidate.priority !== 'foreground') {
      return false;
    }
    const victim = active
      .filter((batch) => {
        const state = channels.get(batch.channelId);
        // Keep the dispatch/transport priority (apart from the existing
        // explicit in-place focus promotion) separate from this current-owner
        // decision. An explicit demand or current-tail refresh remains
        // foreground after focus moves; ownerless physical backfill may yield.
        return batch.channelId !== focus
          && state?.tier !== 0
          && batch.purpose !== 'user-demand'
          && batch.rangeKind !== 'tail-refresh';
      })
      .sort((left, right) => left.priorityClass - right.priorityClass
        || right.createdDispatch - left.createdDispatch)[0];
    if (!victim) return false;
    cancelBatch(victim, 'focused channel preempted off-screen physical hydration');
    diagnostic('info', 'history.focus_preempted_hydration', {
      channelId: focus,
      victimChannelId: victim.channelId,
      victimRef: victim.ref || '',
      generation,
    });
    return true;
  }

  function schedule() {
    if (destroyed) return;
    clearWake();
    reclassify();
    preemptForFocusedCandidate();
    while (inflightByChannel.size < HISTORY_MAX_INFLIGHT) {
      const batch = choose();
      if (!batch) break;
      dispatch(batch);
    }
    const retryAt = Math.min(...[...channels.values()].map((state) => state.retryAt).filter((value) => value > now()));
    if (Number.isFinite(retryAt)) scheduleWake(retryAt);
  }

  function attach(entries = [], detail = {}) {
    const nextGeneration = numeric(detail.generation);
    if (!nextGeneration || nextGeneration < generation) return false;
    // Attach calibrates the remote frontier; it is not a reset boundary. A
    // compatible IndexedDB decode already in flight remains valid and joins
    // this generation. Only incompatible/old-network pulls are discarded.
    const seamBatches = new Map(inflightByChannel);
    const previousGeneration = generation;
    const generationReplaced = previousGeneration !== nextGeneration;
    generation = nextGeneration;
    remoteUnavailable = false;
    focus = detail.focus || focus;
    const localMeta = detail.localMeta || new Map();
    const seen = new Set();
    for (const entry of entries) {
      const id = entry?.channel_id;
      if (!id) continue;
      seen.add(id);
      const previous = channels.get(id);
      if (generationReplaced) for (const waiter of [...(previous?.currentWaiters || [])]) {
		waiter.cleanup?.();
		waiter.reject(new Error('频道同步 generation 已替换'));
	  }
      const state = schedulerState(id, previous, { generationReplacement: generationReplaced });
	  const meta = localMeta.get?.(id) || localMeta[id] || null;
	  const cachedHead = localHead(meta);
	  const visibleHead = numeric(visibleNewestSeq(id));
	  const seamBatch = seamBatches.get(id);
	  const compatibleLocalBatch = Boolean(seamBatch?.source === 'indexeddb'
		&& seamBatch.committing !== true
		&& cachedHead >= numeric(entry.head_seq)
		&& tailWindowCovered(meta, numeric(entry.head_seq))
		&& coverageContains(meta, numeric(seamBatch.beforeSeq) - 1));
	  const canKeepLocalFrontier = Boolean((previous?.tailVisible || previous?.completedPages > 0 || compatibleLocalBatch)
		&& cachedHead >= numeric(entry.head_seq)
		&& tailWindowCovered(meta, numeric(entry.head_seq)));
	  if (compatibleLocalBatch) {
		seamBatches.delete(id);
		seamBatch.stateLease = state.stateLease;
	  }
      state.attachedGeneration = generation;
	  state.remoteKnown = true;
	  state.remoteEligible = true;
      state.headSeq = numeric(entry.head_seq);
	  state.beforeSeq = canKeepLocalFrontier ? previous.beforeSeq : state.headSeq + 1;
      state.cacheBypassBeforeSeq = 0;
	  state.localMeta = meta;
	  state.localCoverage = mergedCoverage(meta?.coverage || []);
	  state.verifiedCoverage = previousGeneration === nextGeneration
		&& previous?.attachedGeneration === nextGeneration
		? mergedCoverage(previous.verifiedCoverage || [])
		: [];
      state.hasRows = Boolean(entry.has_rows);
	  state.hasOlder = state.hasRows && state.beforeSeq > 0;
      state.activity = Math.max(numeric(entry.last_activity), numeric(state.localMeta?.lastActivity));
	  state.tailVisible = Boolean(canKeepLocalFrontier && previous?.tailVisible);
	  state.controlCurrent = Boolean(!state.hasRows || (canKeepLocalFrontier && state.tailVisible));
	  // Attach Meta already gives the authoritative remote head. When an older
	  // local tail is on screen, bridge that gap now; do not wait for a second
	  // focus probe while stale controls are visible.
	  state.tailRefreshBeforeSeq = !canKeepLocalFrontier && visibleHead > 0 && state.headSeq > visibleHead
	    ? state.headSeq + 1
	    : 0;
	  state.tailRefreshFloorSeq = state.tailRefreshBeforeSeq ? visibleHead : 0;
	  if (!canKeepLocalFrontier) state.completedPages = 0;
	  if (!canKeepLocalFrontier && state.reservoir.size) {
		state.reservoir = new Map();
		state.reservoirBytes = 0;
	  }
      state.retryAt = 0;
      state.retryCount = 0;
      state.cancelPending = null;
      state.foregroundError = '';
      state.error = entry.error_detail || '';
      channels.set(id, state);
      settleCurrentWaiters(state);
    }
	const focused = channels.get(focus);
	if (focused && !focused.lastFocusOrder) {
	  focused.lastFocusOrder = ++focusSerial;
	  persistPriority();
	}
    for (const [id, previous] of [...channels]) {
      if (seen.has(id)) continue;
      for (const waiter of [...previous.currentWaiters]) {
		waiter.cleanup?.();
		waiter.reject(new Error('频道同步 generation 已替换'));
	  }
	  settleForeground(previous, { kind: 'cancelled' });
	  previous.foregroundOwners.clear();
	  previous.projectionPending = false;
	  const state = schedulerState(id, previous, { generationReplacement: true });
      state.attachedGeneration = 0;
	  state.remoteKnown = true;
	  state.remoteEligible = false;
      state.hasRows = false;
      state.hasOlder = false;
      state.controlCurrent = false;
      state.headSeq = 0;
      state.beforeSeq = 0;
      state.tailRefreshBeforeSeq = 0;
      state.tailRefreshFloorSeq = 0;
      state.localMeta = null;
      state.localCoverage = [];
      state.verifiedCoverage = [];
      state.reservoir = new Map();
      state.reservoirBytes = 0;
      state.retryAt = 0;
      state.retryCount = 0;
      state.cancelPending = null;
      state.foregroundError = '';
      channels.set(id, state);
    }
	for (const [id, batch] of seamBatches) {
	  batch.cancelled = true;
	  batch.terminal?.reject(new Error('history source recalibrated by attach'));
	  batch.sourceCancellation?.reject(new Error('history source recalibrated by attach'));
	  if (batch.ref) {
		inflightByRef.delete(batch.ref);
		cancelledRefs.set(batch.ref, { channelId: batch.channelId, generation: batch.generation });
		if (batch.source === 'network') void cancelPage(batch.channelId, batch.ref, batch.generation).catch(() => {});
	  }
	  if (inflightByChannel.get(id) === batch) inflightByChannel.delete(id);
    }
	remoteAdmissionEstablished = true;
	admittedChannelIds = new Set(seen);
    recomputeReservoirBytes();
    diagnostic('info', 'history.attach_meta', { generation, focus, channels: seen.size });
    publish();
    schedule();
    return true;
  }

  function historyRow(payload = {}) {
    if (payload.source !== 'history') return false;
    const batch = inflightByRef.get(payload.ref || '');
    if (!batch || numeric(payload.generation) !== batch.generation || payload.channel_id !== batch.channelId) {
	  const cancelled = cancelledRefs.get(payload.ref || '');
	  if (cancelled?.generation === numeric(payload.generation) && cancelled.channelId === payload.channel_id) {
		diagnostic('debug', 'history.cancelled_row_ignored', { ref: payload.ref, channelId: payload.channel_id, generation: payload.generation });
		return true;
	  }
      diagnostic('warn', 'history.unmatched_row', { ref: payload.ref, channelId: payload.channel_id, generation: payload.generation });
      return true;
    }
    const seq = numeric(payload.seq);
    batch.rows.push({ channel_id: payload.channel_id, seq, envelope: payload.envelope });
    // Row envelopes can be large and a normal page can contain hundreds of
    // frames. Aggregate arrival metadata on the batch so one page cannot evict
    // the input/request origin from the bounded reading trace.
    const arrival = batch.readingTraceArrival || {
      count: 0,
      firstSeq: seq,
      lastSeq: seq,
      minSeq: seq,
      maxSeq: seq,
      firstAt: now(),
      lastAt: now(),
    };
    arrival.count += 1;
    arrival.lastSeq = seq;
    arrival.minSeq = Math.min(arrival.minSeq, seq);
    arrival.maxSeq = Math.max(arrival.maxSeq, seq);
    arrival.lastAt = now();
    batch.readingTraceArrival = arrival;
    return true;
  }

  function pageEnd(payload = {}) {
    const batch = inflightByRef.get(payload.ref || '');
    if (!batch || numeric(payload.generation) !== batch.generation || payload.channel_id !== batch.channelId) {
	  const cancelled = cancelledRefs.get(payload.ref || '');
	  if (cancelled?.generation === numeric(payload.generation) && cancelled.channelId === payload.channel_id) {
		cancelledRefs.delete(payload.ref || '');
		diagnostic('debug', 'history.cancelled_page_end_ignored', { ref: payload.ref, channelId: payload.channel_id, generation: payload.generation });
		return true;
	  }
      diagnostic('warn', 'history.unmatched_page_end', { ref: payload.ref, channelId: payload.channel_id, generation: payload.generation });
      return false;
    }
    readingTrace('history.page-ended', {
      channelId: payload.channel_id,
      generation: numeric(payload.generation),
      ref: payload.ref || '',
      errorCode: payload.error_code || '',
      rows: batch.rows.length,
      firstSeq: batch.readingTraceArrival?.firstSeq || 0,
      lastSeq: batch.readingTraceArrival?.lastSeq || 0,
      minSeq: batch.readingTraceArrival?.minSeq || 0,
      maxSeq: batch.readingTraceArrival?.maxSeq || 0,
      arrivalCount: batch.readingTraceArrival?.count || 0,
      arrivalDurationMs: batch.readingTraceArrival
        ? Math.max(0, batch.readingTraceArrival.lastAt - batch.readingTraceArrival.firstAt)
        : 0,
    });
    if (payload.error_code) batch.terminal.reject(new Error(payload.error_detail || payload.error_code));
    else batch.terminal.resolve(payload);
    return true;
  }

  async function nextSegment(channelId, {
    signal,
    count = HISTORY_REVEAL_SIZE,
    byteLimit = HISTORY_REVEAL_BYTES,
    projectionBarrier = true,
  } = {}) {
    if (signal?.aborted) return { kind: 'cancelled' };
    if (remoteAdmissionEstablished && !admittedChannelIds.has(channelId)) {
      return { kind: 'cancelled' };
    }
    let state = channels.get(channelId);
    if (!state) {
      state = schedulerState(channelId);
      channels.set(channelId, state);
    }
	// The caller has completed projection of the previous segment and is asking
	// for a continuation. This acknowledgement, not a render timer, releases the
	// channel to schedule its next contiguous batch.
	state.projectionPending = false;
    if (state.remoteKnown && state.remoteEligible === false) return { kind: 'cancelled' };
    if (state.reservoir.size > 0) {
      const boundedByteLimit = Number.isFinite(Number(byteLimit))
        ? Math.max(1, Math.min(HISTORY_REVEAL_BYTES, Number(byteLimit)))
        : HISTORY_REVEAL_BYTES;
      const released = release(state, Math.max(1, count), { byteLimit: boundedByteLimit });
	  state.projectionPending = projectionBarrier;
      publish();
      schedule();
      return { kind: 'segment', released };
    }
    if (authoritativeExhausted(state)) return { kind: 'exhausted' };
	if (state.error && (state.retryAt > now() || blockedSourceMatches(state))) {
	  return { kind: 'failed', error: new Error(state.error) };
	}
	const remoteAttached = Boolean(generation && state.attachedGeneration === generation);
	if (remoteUnavailable && !remoteAttached && sourceFor(state) !== 'indexeddb' && !inflightByChannel.has(channelId)) {
	  // The local replica has reached its proven frontier. More history may exist
	  // remotely, but an offline top-scroll must settle now rather than leave an
	  // unfulfillable waiter spinning until a future reconnect.
	  return { kind: 'exhausted', localOnly: true };
	}
    return new Promise((resolve) => {
      let timer = null;
      const waiter = { resolve, cleanup: null, projectionBarrier };
      const removeWaiter = () => {
        const installed = channels.get(channelId) || state;
        const index = installed.foregroundWaiters.indexOf(waiter);
        if (index >= 0) installed.foregroundWaiters.splice(index, 1);
        return installed;
      };
      if (signal) {
        const abort = () => {
          const installed = removeWaiter();
          waiter.cleanup?.();
          resolve({ kind: 'cancelled' });
          cancelUnownedForeground(installed);
          publish();
          schedule();
        };
        signal.addEventListener('abort', abort, { once: true });
        waiter.cleanup = () => {
          if (timer != null) clearTimeoutImpl(timer);
          signal.removeEventListener('abort', abort);
        };
      } else {
        waiter.cleanup = () => {
          if (timer != null) clearTimeoutImpl(timer);
        };
      }
      timer = setTimeoutImpl(() => {
        // Once a physical batch owns the channel, its phase-aware deadline is
        // the sole timeout authority. This timer covers only the pre-dispatch
        // wait for any usable source/candidate.
        if (inflightByChannel.has(channelId)) {
          timer = null;
          return;
        }
        const installed = removeWaiter();
        waiter.cleanup?.();
        const error = new Error('等待可用历史数据源超时，请重试');
        error.code = 'history_source_unavailable';
        installed.error = error.message;
        installed.errorCode = error.code;
        if (visibleForegroundOwners(installed).length > 0) installed.foregroundError = error.message;
        resolve({ kind: 'failed', error });
        publish();
        schedule();
      }, batchTimeoutMs);
      state.foregroundWaiters.push(waiter);
      state.retryAt = 0;
      publish();
      schedule();
    }).then((result) => {
      if (result?.kind !== 'available') return result;
      return nextSegment(channelId, {
        signal, count, byteLimit, projectionBarrier,
      });
    });
  }

  function beginOperation(channelId, {
    signal,
    intent = 'scroll-history',
    urgency = 'interactive',
    explicitRetry = false,
  } = {}) {
	let state = channels.get(channelId);
	if (!state) {
	  state = schedulerState(channelId);
	  channels.set(channelId, state);
	}
	const owner = {
	  intent: intent || 'scroll-history',
	  urgency: Object.hasOwn(DEMAND_URGENCY_SCORE, urgency) ? urgency : 'interactive',
	  // Runway/under-fill work is anticipatory hydration. It may promote the
	  // existing scheduler lane for latency, but it is not a user-visible wait.
	  // A saved-position restore is also a visible activation obligation: after
	  // the bounded initialization shell degrades, its pending/error state must
	  // remain attributable instead of becoming an idle partial projection.
	  presentation: ((intent || 'scroll-history') === 'scroll-history'
	    && urgency === 'interactive')
	    || (intent || '') === 'initial-view',
	};
	const hadVisibleDemand = visibleForegroundOwners(state).length > 0;
	let released = false;
	state.foregroundOwners.add(owner);
	if (owner.presentation && !hadVisibleDemand) {
	  beginVisibleDemand(state, { explicitRetry });
	}
	promoteChannel(state, 'history channel promoted by user intent');
	const release = () => {
	  if (released) return;
	  released = true;
	  signal?.removeEventListener('abort', release);
	  state = channels.get(channelId) || state;
	  state.foregroundOwners.delete(owner);
	  if (state.foregroundOwners.size === 0 && state.foregroundWaiters.length === 0) {
		state.projectionPending = false;
		cancelUnownedForeground(state);
	  }
	  publish();
	  schedule();
	};
	if (signal) signal.addEventListener('abort', release, { once: true });
	const promote = ({ intent: nextIntent = owner.intent, urgency: nextUrgency = owner.urgency } = {}) => {
	  if (released) return false;
	  // Attach may replace the state record while preserving the owner Set.
	  // Publish presentation facts on the installed record, not the pre-attach
	  // object captured when this operation began.
	  state = channels.get(channelId) || state;
	  const normalizedUrgency = Object.hasOwn(DEMAND_URGENCY_SCORE, nextUrgency)
	    ? nextUrgency
	    : owner.urgency;
	  const hadVisibleDemand = visibleForegroundOwners(state).length > 0;
	  let changed = false;
	  if (DEMAND_URGENCY_SCORE[normalizedUrgency] > DEMAND_URGENCY_SCORE[owner.urgency]) {
		owner.urgency = normalizedUrgency;
		changed = true;
	  }
	  if (nextIntent && nextIntent !== owner.intent) {
		owner.intent = nextIntent;
		changed = true;
	  }
	  const shouldPresent = owner.intent === 'scroll-history'
	    && DEMAND_URGENCY_SCORE[owner.urgency] >= DEMAND_URGENCY_SCORE.interactive;
	  if (shouldPresent && !owner.presentation) {
		owner.presentation = true;
		changed = true;
	  }
	  if (!changed) return false;
	  if (owner.presentation && !hadVisibleDemand) {
		beginVisibleDemand(state);
	  }
	  promoteChannel(state, 'history operation promoted by interactive demand');
	  diagnostic('debug', 'history.operation_promoted', {
		channelId,
		intent: owner.intent,
		urgency: owner.urgency,
		presentation: owner.presentation,
		demandRevision: state.foregroundDemandRevision,
	  });
	  publish();
	  schedule();
	  return true;
	};
	publish();
	schedule();
	return {
	  next: (options = {}) => nextSegment(channelId, { ...options, signal: options.signal || signal }),
	  promote,
	  release,
	};
  }

  function setFocus(channelId) {
	const nextFocus = channelId || '';
	if (focus && focus !== nextFocus) {
	  const previous = channels.get(focus);
	  const batch = inflightByChannel.get(focus);
	  if (batch?.purpose === 'initial-tail' && previous?.foregroundWaiters.length === 0 && previous?.foregroundOwners.size === 0) {
		cancelBatch(batch, 'history focus changed');
	  }
	}
    focus = nextFocus;
    let state = channels.get(focus);
    if (focus && !state) {
      state = schedulerState(focus);
      channels.set(focus, state);
    }
    if (state) {
      state.lastFocusOrder = ++focusSerial;
      // A live terminal/progress frame may arrive before the request that owns
      // it. Having the raw head row in the replica does not mean the current
      // projection can render a tail. Treating that orphan as a visible tail
      // suppresses the initial history page forever and opens an empty channel.
      if (!state.tailVisible && state.headSeq > 0
        && hasVisibleRow(state.id, state.headSeq)
        && hasPresentedRows(state.id)) {
        state.tailVisible = true;
      }
      if (!state.tailVisible && state.reservoir.size > 0) {
        const released = release(state, HISTORY_PAGE_SIZE, { initial: true, byteLimit: HISTORY_REVEAL_BYTES });
        if (released > 0 && hasPresentedRows(state.id)) state.tailVisible = true;
      }
      persistPriority();
    }
    if (state?.retryAt) state.retryAt = 0;
	promoteChannel(state, 'history channel promoted by focus');
    publish();
    schedule();
  }

  function refreshRemoteMeta(entry = {}, detail = {}) {
	const id = entry.channel_id;
	const responseGeneration = numeric(detail.generation ?? entry.generation);
	if (!id || !generation || responseGeneration !== generation) return false;
	const state = channels.get(id);
	if (!state || state.attachedGeneration !== generation || entry.error_code) return false;
	const headSeq = numeric(entry.head_seq);
	state.remoteKnown = true;
	state.remoteEligible = true;
	state.headSeq = Math.max(state.headSeq, headSeq);
	state.hasRows = Boolean(entry.has_rows) || state.hasRows || headSeq > 0;
	state.activity = Math.max(state.activity, numeric(entry.last_activity));
	const localNewest = numeric(visibleNewestSeq(id));
	const headCovered = rangesContain(installedCoverage(state), headSeq);
	const localTailPending = !localMetaReady || (hasLocalKnowledge(state.localMeta) && !state.tailVisible);
	if (headSeq > localNewest && !headCovered && id === focus && !localTailPending) {
	  state.controlCurrent = false;
	  if (!state.tailRefreshBeforeSeq) state.tailRefreshFloorSeq = localNewest;
	  else state.tailRefreshFloorSeq = Math.min(state.tailRefreshFloorSeq, localNewest);
	  state.tailRefreshBeforeSeq = Math.max(state.tailRefreshBeforeSeq, headSeq + 1);
	  state.retryAt = 0;
	  state.error = '';
	  const batch = inflightByChannel.get(id);
	  if (batch?.priority === 'background') cancelBatch(batch, 'foreground freshness check superseded background history');
	  for (const other of inflightByChannel.values()) {
		if (other.channelId !== id && other.priority === 'background') {
		  cancelBatch(other, 'foreground freshness check preempted background hydration');
		}
	  }
	}
	diagnostic('debug', 'history.channel_meta', {
	  channelId: id,
	  generation,
	  headSeq,
	  localNewest,
	  catchup: headSeq > localNewest && !headCovered && id === focus && !localTailPending,
	});
	publish();
	schedule();
	settleCurrentWaiters(state);
	return true;
  }

  function waitForCurrent(channelId, targetHead, { signal, timeoutMs = HISTORY_BATCH_TIMEOUT_MS } = {}) {
	const state = channels.get(channelId);
	if (!state || state.attachedGeneration !== generation) return Promise.reject(new Error('频道同步会话尚未建立'));
	const target = numeric(targetHead);
	if (currentTargetInstalled(state, target) && !state.tailRefreshBeforeSeq && state.controlCurrent) {
	  return Promise.resolve({ channelId, headSeq: target, newestSeq: numeric(visibleNewestSeq(channelId)) });
	}
	return new Promise((resolve, reject) => {
	  let timer = null;
	  const waiter = { targetHead: target, resolve, reject, cleanup: null };
	  const abort = () => {
		(channels.get(channelId) || state).currentWaiters.delete(waiter);
		waiter.cleanup?.();
		reject(new Error('频道同步已取消'));
	  };
	  waiter.cleanup = () => {
		if (timer != null) clearTimeoutImpl(timer);
		signal?.removeEventListener('abort', abort);
	  };
	  if (signal) signal.addEventListener('abort', abort, { once: true });
	  timer = setTimeoutImpl(() => {
		(channels.get(channelId) || state).currentWaiters.delete(waiter);
		waiter.cleanup?.();
		reject(new Error('频道同步超时'));
	  }, timeoutMs);
	  state.currentWaiters.add(waiter);
	  schedule();
	});
  }

  function setLocalMeta(nextMeta = new Map(), {
    publishChange = true,
    localReady,
    replace = false,
    selectionPending,
  } = {}) {
    const activatingLocalMeta = localReady === true && !localMetaReady;
    if (typeof localReady === 'boolean') localMetaReady = localReady;
    if (typeof selectionPending === 'boolean') localSelectionPending = selectionPending;
    if (replace) {
      localMetaEpoch += 1;
      for (const batch of inflightByChannel.values()) {
        if (batch.source === 'indexeddb') {
          cancelBatch(batch, 'complete local Meta snapshot replaced cache source');
        }
      }
      for (const [id, state] of channels) {
        if (nextMeta.has(id)
          && (!remoteAdmissionEstablished || admittedChannelIds.has(id))) continue;
        state.localMeta = null;
        state.localCoverage = [];
        state.cacheBypassBeforeSeq = 0;
        const remoteAttached = Boolean(generation && state.attachedGeneration === generation);
        if (!remoteAttached) {
          state.headSeq = 0;
          state.beforeSeq = 0;
          state.hasRows = false;
          state.hasOlder = false;
          state.controlCurrent = false;
          dropReservoir(state);
        } else if (!currentTargetInstalled(state, state.headSeq)) {
          state.controlCurrent = false;
          requireRemoteTail(state);
        }
      }
    }
    for (const [id, value] of nextMeta) {
	  if (remoteAdmissionEstablished && !admittedChannelIds.has(id)) continue;
	  let state = channels.get(id);
	  if (!state) {
		state = schedulerState(id);
		channels.set(id, state);
	  }
      state.localMeta = value;
	  state.localCoverage = mergedCoverage(value?.coverage || []);
	  const cachedHead = localHead(value);
	  const coldLocalTail = Boolean(replace
	    && state.attachedGeneration
	    && state.headSeq > 0
	    && state.completedPages === 0
	    && !state.tailVisible
	    && !hasPresentedRows(id)
	    && cachedHead >= state.headSeq
	    && tailWindowCovered(value, state.headSeq));
	  if (coldLocalTail) {
	    // Attach may have opened the remote fallback while the complete cache
	    // snapshot was still selecting. Once the exact authoritative tail is
	    // proven durable, make that local frontier the cold-start source and
	    // retire only the redundant, not-yet-presented initial-tail request.
	    state.beforeSeq = cachedHead + 1;
	    state.hasRows = cachedHead > 0 || state.hasRows;
	    state.hasOlder = state.hasRows;
	    state.tailRefreshBeforeSeq = 0;
	    state.tailRefreshFloorSeq = 0;
	    const batch = inflightByChannel.get(id);
	    if (batch?.source === 'network'
	      && batch.purpose === 'initial-tail'
	      && batch.beforeSeq === state.headSeq + 1) {
	      cancelBatch(batch, 'durable local tail replaced cold remote fallback');
	    }
	  }
	  if (activatingLocalMeta && state.attachedGeneration && !state.tailVisible && state.completedPages === 0 && cachedHead > 0) {
		// Local-first startup begins at the newest durable local interval. Once
		// that segment paints, commit() bridges any remote-only tail above it.
		state.beforeSeq = cachedHead + 1;
		state.hasRows = true;
		state.hasOlder = true;
	  }
	  // Prefer the durable local page when it really covers this frontier. If
	  // metadata only names a newest sequence but cannot serve it, current-tail
	  // freshness must remain anchored at the authoritative remote head.
	  if (activatingLocalMeta && state.attachedGeneration && sourceFor(state) === 'network') {
		requireRemoteTail(state);
	  }
	  if (state.attachedGeneration && state.tailVisible && tailWindowCovered(value, state.headSeq)) {
		state.controlCurrent = true;
	  }
      state.cacheBypassBeforeSeq = 0;
      state.activity = Math.max(state.activity, numeric(value?.lastActivity));
	  if (!state.attachedGeneration && !state.tailVisible && hasLocalKnowledge(value)) {
		state.headSeq = localHead(value);
		state.beforeSeq = state.headSeq + 1;
		state.hasRows = state.headSeq > 0;
		state.hasOlder = state.hasRows;
	  }
    }
    if (publishChange) publish();
    schedule();
  }

  function disconnected(_nextGeneration = 0) {
	// Zero is the local-replica epoch. Wire generations only describe remote
	// frames and must not prevent IndexedDB from continuing while disconnected.
    generation = 0;
    remoteUnavailable = true;
    for (const [channelId, batch] of [...inflightByChannel]) {
	  if (!destroyed && batch.source === 'indexeddb') {
		continue;
	  }
	  batch.cancelled = true;
	  batch.terminal?.reject(new Error('connection closed'));
	  batch.sourceCancellation?.reject(new Error('connection closed'));
	  if (batch.ref) inflightByRef.delete(batch.ref);
	  if (inflightByChannel.get(channelId) === batch) inflightByChannel.delete(channelId);
    }
    for (const state of channels.values()) {
	  state.controlCurrent = false;
	  for (const waiter of [...state.currentWaiters]) {
		waiter.cleanup?.();
		state.currentWaiters.delete(waiter);
		waiter.reject(new Error('连接已断开'));
	  }
      const localCanContinue = !destroyed && (state.reservoir.size > 0 || sourceFor(state) === 'indexeddb');
	  if (!localCanContinue) {
		settleForeground(state, { kind: 'cancelled' });
		state.foregroundOwners.clear();
		state.projectionPending = false;
	  }
	  state.cancelPending = null;
	}
    cancelledRefs.clear();
    if (destroyed) executors.clear();
    clearWake();
    diagnostic('info', 'history.disconnected', { generation: 0 });
    schedule();
  }

  function revoke(channelId, { generation: deniedGeneration = 0, reason = 'forbidden' } = {}) {
    const responseGeneration = numeric(deniedGeneration);
    const state = channels.get(channelId);
    if (!channelId || !responseGeneration || responseGeneration !== generation
      || !state || state.attachedGeneration !== responseGeneration) return false;

    const batch = inflightByChannel.get(channelId);
    if (batch) cancelBatch(batch, 'channel access revoked');
    admittedChannelIds.delete(channelId);
    state.attachedGeneration = 0;
    state.remoteKnown = true;
    state.remoteEligible = false;
    state.controlCurrent = false;
    state.tailRefreshBeforeSeq = 0;
    state.tailRefreshFloorSeq = 0;
    state.retryAt = 0;
    state.error = reason;
    state.headSeq = 0;
    state.beforeSeq = 0;
    state.hasRows = false;
    state.hasOlder = false;
    state.localMeta = null;
    state.localCoverage = [];
    state.verifiedCoverage = [];
    dropReservoir(state);
    for (const waiter of [...state.currentWaiters]) {
      waiter.cleanup?.();
      state.currentWaiters.delete(waiter);
      waiter.reject(Object.assign(new Error('频道访问已撤销'), { code: reason }));
    }
    settleForeground(state, { kind: 'cancelled' });
    state.foregroundOwners.clear();
    state.projectionPending = false;
    diagnostic('warn', 'history.access_revoked', { channelId, generation, reason });
    publish();
    schedule();
    return true;
  }

  function snapshot(channelId) {
    const state = channels.get(channelId);
    if (!state) return { headSeq: 0, oldestSeq: 0, hasOlder: false, loaded: false, loading: false, backgroundLoading: false, foregroundLoading: false, historyDemand: { revision: 0, phase: 'idle', error: '' }, waitingStage: '', waitingSince: 0, buffered: 0, bufferedNewest: 0, revealVersion: 0, attached: false, messageCurrent: false, controlCurrent: false, tier: 3, completedPages: 0, generation, error: '', errorCode: '', coverage: [] };
    const batch = inflightByChannel.get(channelId);
    const visibleDemand = visibleForegroundOwners(state).length > 0;
    const historyDemandPhase = state.foregroundError
      ? 'error'
      : visibleDemand
        ? 'pending'
        : 'idle';
    return {
      headSeq: state.headSeq,
      oldestSeq: state.beforeSeq,
      hasOlder: state.hasOlder,
      loaded: state.tailVisible,
      // `loading` remains the physical scheduler fact for initialization and
	  // diagnostics. UI with already-readable content must use historyDemand:
	  // background warming must not look like a foreground edge stall.
      loading: Boolean(batch),
	  backgroundLoading: Boolean(batch) && batch.purpose !== 'user-demand',
	  foregroundLoading: historyDemandPhase === 'pending',
	  historyDemand: Object.freeze({
		revision: state.foregroundDemandRevision,
		phase: historyDemandPhase,
		error: state.foregroundError,
	  }),
      waitingStage: String(batch?.phase || ''),
      waitingSince: numeric(batch?.createdAt),
      buffered: state.reservoir.size,
      bufferedNewest: Math.max(0, ...state.reservoir.keys()),
      revealVersion: state.revealVersion,
      attached: generation > 0 && state.attachedGeneration === generation,
      messageCurrent: generation > 0 && state.attachedGeneration === generation && state.controlCurrent,
      controlCurrent: generation > 0 && state.attachedGeneration === generation && state.controlCurrent,
      tier: state.tier,
      completedPages: state.completedPages,
      generation,
	  // Privacy-free ownership fence for Reading's activation obligation. It is
	  // intentionally not a content/projection revision: it changes only when
	  // Replica, complete local-Meta, or per-channel state ownership changes.
	  sourceLease: `${replicaEpoch}:${localMetaEpoch}:${state.stateLease}`,
      error: state.error,
      errorCode: state.error ? String(state.errorCode || 'history_failed') : '',
      coverage: installedCoverage(state).map((range) => ({ ...range })),
    };
  }

  function observeLive(channelId, timestamp = 0, { related = false, seq = 0, generation: rowGeneration = 0 } = {}) {
    if (!channelId) return;
    let state = channels.get(channelId);
    if (!state) {
      state = schedulerState(channelId);
      channels.set(channelId, state);
    }
    const declaredGeneration = numeric(rowGeneration);
    if (declaredGeneration > 0
      && (declaredGeneration !== generation || state.attachedGeneration !== generation)) return;
    const liveIsCurrent = declaredGeneration > 0;
    state.headSeq = Math.max(state.headSeq, numeric(seq));
    if (numeric(seq) > 0) state.verifiedCoverage = mergedCoverage(state.verifiedCoverage, { lowSeq: numeric(seq), highSeq: numeric(seq) });
    if (numeric(seq) > 0) state.hasRows = true;
    const filledRefreshGap = liveIsCurrent
      && state.tailRefreshBeforeSeq > 0
      && rangesCover(
        installedCoverage(state),
        numeric(state.tailRefreshFloorSeq) + 1,
        state.headSeq,
      );
    const wasCurrent = state.controlCurrent;
    if (filledRefreshGap) {
      // Remote Meta and realtime rows share one ordered wire, but the feed
      // deliberately frame-batches rows. Meta can therefore open a tail gap
      // just before that same wire's already-received rows enter Replica. Once
      // the current generation's accepted rows cover the whole gap, they are
      // the freshness proof; do not leave messageCurrent waiting on a redundant
      // history page.
      state.tailRefreshBeforeSeq = 0;
      state.tailRefreshFloorSeq = 0;
      state.controlCurrent = true;
      settleCurrentWaiters(state);
    } else if (liveIsCurrent && !state.tailRefreshBeforeSeq
      && currentTargetInstalled(state, state.headSeq)) {
      state.controlCurrent = true;
      settleCurrentWaiters(state);
    }
    state.activity = Math.max(state.activity, numeric(timestamp));
    state.liveOrder = ++liveSerial;
    if (related) state.relatedUnreadOrder = state.liveOrder;
    if (state.controlCurrent !== wasCurrent) publish();
    schedule();
  }

  function markRead(channelId) {
    const state = channels.get(channelId);
    if (!state) return;
    state.relatedUnreadOrder = 0;
    schedule();
  }

  function clear() {
    for (const state of channels.values()) settleForeground(state, { kind: 'cancelled' });
    resetReplica();
  }

  function resetReplica() {
	for (const state of channels.values()) {
	  settleForeground(state, { kind: 'cancelled' });
	  for (const waiter of [...state.currentWaiters]) {
		waiter.cleanup?.();
		waiter.reject(new Error('本地副本已重置'));
	  }
	  state.currentWaiters.clear();
	}
	replicaEpoch += 1;
	for (const batch of inflightByChannel.values()) {
	  batch.cancelled = true;
	  batch.terminal?.reject(new Error('local replica reset'));
	  batch.sourceCancellation?.reject(new Error('local replica reset'));
	}
	executors.clear();
	inflightByChannel.clear();
	inflightByRef.clear();
	cancelledRefs.clear();
	channels.clear();
	reservedInflightBytes = 0;
	globalReservoirBytes = 0;
	generation = 0;
	localMetaEpoch += 1;
	remoteAdmissionEstablished = false;
	admittedChannelIds = new Set();
	remoteUnavailable = false;
	dispatchWheelIndex = 0;
	// A server/owner epoch reset may have cleared the persisted view/live MRU.
	// Reload it instead of carrying scheduling hints from the old world in RAM.
	restoredPriority = restorePriority();
	clearWake();
	publish();
  }

  function destroy() {
    destroyed = true;
    disconnected(generation + 1);
  }

  return { attach, revoke, refreshRemoteMeta, waitForCurrent, setLocalMeta, setPriorityScope, historyRow, pageEnd, nextSegment, beginOperation, focus: setFocus, observeLive, markRead, disconnected, clear, resetReplica, destroy, isDestroyed: () => destroyed, snapshot, tick: schedule };
}
