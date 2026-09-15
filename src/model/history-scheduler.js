import PQueue from 'p-queue';
import { diagnostic } from './diagnostics.js';

export const HISTORY_PAGE_SIZE = 128;
export const HISTORY_BATCH_BYTES = 1 * 1024 * 1024;
export const HISTORY_RESERVOIR_SIZE = 5_000;
export const HISTORY_RESERVOIR_CHANNEL_BYTES = 16 * 1024 * 1024;
export const HISTORY_RESERVOIR_GLOBAL_BYTES = 64 * 1024 * 1024;
export const HISTORY_MAX_INFLIGHT = 4;
export const HISTORY_MAX_BACKGROUND_INFLIGHT = 3;
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
    cacheBypassBeforeSeq: 0,
    localMeta: null,
    hasRows: false,
    hasOlder: false,
    tailVisible: false,
    reservoir: new Map(),
    reservoirBytes: 0,
    revealVersion: 0,
    foregroundWaiters: [],
    foregroundOwners: new Set(),
	projectionPending: false,
	cancelPending: null,
    retryAt: 0,
    retryCount: 0,
    error: '',
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

export function createHistoryScheduler({
  requestPage,
  cancelPage = () => Promise.resolve(),
  readCache = async () => ({ rows: [], exhausted: true, nextBeforeSeq: 0, bytes: 0 }),
  revealRows,
  hasVisibleRow = () => false,
  visibleOldestSeq = () => 0,
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
  maxBackgroundInflight = HISTORY_MAX_BACKGROUND_INFLIGHT,
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

  function schedulerState(id, previous = {}) {
    const state = createState(id, previous);
    if (!state.lastFocusOrder) state.lastFocusOrder = numeric(restoredPriority.views[id]);
    return state;
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
	const remoteAttached = Boolean(generation && state?.attachedGeneration === generation);
	const localAttached = Boolean(!remoteAttached && state?.remoteEligible !== false && hasLocalKnowledge(state?.localMeta));
	if (!state || (!remoteAttached && !localAttached) || inflightByChannel.has(state.id) || state.retryAt > now()) return null;
	if (state.projectionPending) return null;
	if (state.tier >= 3) return null;
	const purpose = purposeFor(state, focus);
	const demand = purpose === 'user-demand' ? foregroundDemand(state) : null;
	// Buffered rows already satisfy the foreground operation. Do not open a
	// second network page before nextSegment has projected and consumed them.
	if (purpose === 'user-demand' && state.reservoir.size > 0) return null;
	const gapBeforeSeq = purpose === 'user-demand' ? visibleGapBefore(state) : 0;
	const rangeKind = gapBeforeSeq ? 'visible-gap' : 'backfill';
	const taskBeforeSeq = gapBeforeSeq || state.beforeSeq;
	const targetRows = state.tier === 0
	  ? HISTORY_P0_TARGET_ROWS
	  : state.tier === 1 ? HISTORY_P1_TARGET_ROWS : HISTORY_P2_TARGET_ROWS;
	const targetBytes = state.tier === 0
	  ? HISTORY_P0_TARGET_BYTES
	  : state.tier === 1 ? HISTORY_P1_TARGET_BYTES : HISTORY_P2_TARGET_BYTES;
	const scanBudget = state.tier === 0
	  ? HISTORY_P0_SCAN_BUDGET
	  : state.tier === 1 ? HISTORY_P1_SCAN_BUDGET : HISTORY_P2_SCAN_BUDGET;
	if (purpose !== 'user-demand'
	  && (state.tailVisible || state.id !== focus)
	  && (state.reservoir.size >= targetRows || state.reservoirBytes >= targetBytes || state.warmScanned >= scanBudget)) return null;
    if (state.reservoir.size >= HISTORY_RESERVOIR_SIZE || state.reservoirBytes >= HISTORY_RESERVOIR_CHANNEL_BYTES) return null;
    const priority = state.tier === 0 ? 'foreground' : 'background';
    const urgent = priority === 'foreground';
    const channelAvailable = Math.max(0, HISTORY_RESERVOIR_CHANNEL_BYTES - state.reservoirBytes);
    const globalAvailable = Math.max(0, HISTORY_RESERVOIR_GLOBAL_BYTES - globalReservoirBytes - reservedInflightBytes);
	const foregroundInflight = [...inflightByChannel.values()].some((batch) => batch.priority === 'foreground');
	// A visible user action may borrow one bounded batch beyond a full warm
	// reservoir, but a second foreground batch must wait. This keeps the global
	// overshoot bounded by exactly one batch instead of one per active channel.
	const globalAllowance = urgent && !foregroundInflight
	  ? Math.max(globalAvailable, batchBytes)
	  : globalAvailable;
    const targetByteDeficit = purpose === 'user-demand' || (!state.tailVisible && state.id === focus)
      ? batchBytes
      : Math.max(1, targetBytes - state.reservoirBytes);
    const byteLimit = Math.min(batchBytes, targetByteDeficit, channelAvailable, globalAllowance);
    if (byteLimit <= 0) return null;
    // Partial final batches are valid. Requiring a whole 1 MiB quantum here
    // left every P1/P2 reservoir permanently below its configured byte target.
    if (!state.hasRows && !state.hasOlder && !hasLocalKnowledge(state.localMeta) && !gapBeforeSeq) return null;
    if (!gapBeforeSeq && state.completedPages > 0 && !state.hasOlder) return null;
    let priorityClass = priority === 'foreground' ? 100 : 0;
    if (purpose === 'user-demand') priorityClass += 20;
    else if (purpose === 'initial-tail') priorityClass += 10;
    // Starvation promotion is deliberately confined to the same transport
    // class. Background hydration can become the next background batch, but
    // it can never jump ahead of a person's active top operation.
    priorityClass += Math.min(9, Math.floor(state.waitDispatches / FAIRNESS_DISPATCHES));
    priorityClass += demand?.score || 0;
    const source = sourceFor(state, taskBeforeSeq);
	const sourceStats = transportStats[source] || transportStats.network;
    const rowDeficit = purpose === 'user-demand' || !state.tailVisible
      ? sourceStats.rowLimit
      : Math.max(1, targetRows - state.reservoir.size);
    const limit = Math.max(1, Math.min(sourceStats.rowLimit, rowDeficit, HISTORY_RESERVOIR_SIZE - state.reservoir.size));
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
      waterDeficit: HISTORY_RESERVOIR_SIZE - state.reservoir.size,
      waitDispatches: state.waitDispatches,
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

  async function rememberRows(state, rows, { allowGlobalOverflow = false } = {}) {
    let accepted = 0;
    let measuredBytes = 0;
    for (let index = 0; index < rows.length; index += 1) {
      // Pull work is cooperative. A live frame received between chunks is
      // committed before the next chunk rather than waiting behind a whole
      // historical page on the browser's single main thread.
      if (index > 0 && index % 16 === 0) {
        await yieldTask();
        flushRealtime();
      }
      const row = rows[index];
      const seq = numeric(row.seq);
      if (!seq || hasVisibleRow(state.id, seq) || state.reservoir.has(seq)) continue;
      const bytes = rowBytes(row.envelope);
      measuredBytes += bytes;
      if (state.reservoir.size >= HISTORY_RESERVOIR_SIZE
        || state.reservoirBytes + bytes > HISTORY_RESERVOIR_CHANNEL_BYTES
        || (!allowGlobalOverflow && globalReservoirBytes + bytes > HISTORY_RESERVOIR_GLOBAL_BYTES)
        || (allowGlobalOverflow && globalReservoirBytes + bytes > HISTORY_RESERVOIR_GLOBAL_BYTES + HISTORY_BATCH_BYTES)) break;
      state.reservoir.set(seq, { envelope: row.envelope, bytes });
      state.reservoirBytes += bytes;
      globalReservoirBytes += bytes;
      accepted += 1;
    }
    return { accepted, measuredBytes };
  }

  function release(state, count, { initial = false, byteLimit = HISTORY_REVEAL_BYTES } = {}) {
    if (!state || count <= 0 || !state.reservoir.size) return 0;
    const selected = [];
    let selectedBytes = 0;
    for (const entry of [...state.reservoir.entries()].sort(([left], [right]) => right - left)) {
      if (selected.length >= count) break;
      if (selected.length && selectedBytes + entry[1].bytes > byteLimit) break;
      selected.push(entry);
      selectedBytes += entry[1].bytes;
    }
    for (const [seq, value] of selected) {
      state.reservoir.delete(seq);
      state.reservoirBytes -= value.bytes;
      globalReservoirBytes -= value.bytes;
    }
    selected.sort(([left], [right]) => left - right);
    revealRows?.(state.id, selected.map(([seq, value]) => [seq, value.envelope]), { initial });
    state.revealVersion += 1;
    // Releasing a warm segment consumes the prediction. The channel may refill
    // to its current tier target instead of being blocked by lifetime counters.
    state.warmScanned = 0;
    return selected.length;
  }

  function retry(state, error) {
    state.retryCount += 1;
    state.error = error?.message || String(error || '历史加载失败');
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(6, state.retryCount - 1));
    state.retryAt = now() + delay;
    diagnostic('warn', 'history.batch_retry', { channelId: state.id, generation, delay, detail: state.error });
    scheduleWake(state.retryAt);
    settleForeground(state, { kind: 'failed', error: error instanceof Error ? error : new Error(state.error) });
    onError(error instanceof Error ? error : new Error(state.error));
  }

  async function executeNetwork(batch) {
    const terminal = deferred();
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
    const receipt = await accepted;
    if (!receipt?.accepted || receipt.generation !== batch.generation || receipt.channel_id !== batch.channelId) {
      throw new Error('历史批次回执不匹配');
    }
    const page = await terminal.promise;
	return { ...page, declaredRows: page.rows, rows: batch.rows };
  }

  async function execute(batch) {
    if (batch.cancelled) throw new Error('history batch cancelled');
    if (batch.source === 'indexeddb') {
      return readCache(batch.channelId, batch.beforeSeq, batch.limit, batch.byteLimit);
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
    return batch.replicaEpoch === replicaEpoch
      && (batch.source !== 'network' || batch.generation === generation);
  }

  async function commit(batch, result) {
    if (!batchIsCurrent(batch)) return;
    const state = channels.get(batch.channelId);
    if (!state) return;
    const rows = (result.rows || []).sort((left, right) => left.seq - right.seq);
    if (batch.source === 'indexeddb') {
      // Metadata can become stale after FIFO/quota eviction. A miss does not
      // advance truth; it only bypasses this cache claim at the same frontier.
      if (result.cacheMiss) {
        state.cacheBypassBeforeSeq = batch.beforeSeq;
        if (!state.attachedGeneration && batch.rangeKind !== 'visible-gap') state.hasOlder = false;
        diagnostic('warn', 'history.cache_claim_missed', {
          channelId: state.id, beforeSeq: batch.beforeSeq, generation,
        });
        settleForeground(state, { kind: 'exhausted', localOnly: true });
        return;
      }
      validateCachePage(batch, result, rows);
      if (batch.rangeKind !== 'visible-gap') state.beforeSeq = Number(result.nextBeforeSeq);
      state.cacheBypassBeforeSeq = 0;
	  if (!state.attachedGeneration && result.exhausted && batch.rangeKind !== 'visible-gap') state.hasOlder = false;
    } else {
	  validateNetworkPage(batch, result, rows);
      state.headSeq = Math.max(state.headSeq, numeric(result.head_seq));
	  if (batch.rangeKind !== 'visible-gap') state.beforeSeq = Number(result.next_before_seq);
	  state.cacheBypassBeforeSeq = 0;
	  // Cursor zero is the ledger origin and therefore authoritative exhaustion,
	  // even if an older server/mocked projector conservatively reports
	  // has_older=true because only hidden housekeeping remains.
	  if (batch.rangeKind !== 'visible-gap') state.hasOlder = Boolean(result.has_older) && state.beforeSeq > 0;
      const lowSeq = numeric(result.scan_low_seq);
      const highSeq = numeric(result.scan_high_seq);
      const coverageByChannel = lowSeq && highSeq >= lowSeq
        ? new Map([[state.id, { lowSeq, highSeq }]])
        : new Map();
      void persistRows(rows, { coverageByChannel }).catch((error) => diagnostic('error', 'history.cache_persist_failed', { channelId: state.id, error }));
    }
    const remembered = await rememberRows(state, rows, { allowGlobalOverflow: batch.priority === 'foreground' });
    if (!batchIsCurrent(batch) || batch.cancelled) return;
    const timing = observeBatch(batch, result, rows, remembered.measuredBytes);
    const acceptedRows = remembered.accepted;
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
    if (!state.tailVisible && visibleIntent) {
      initialReleased = release(state, HISTORY_REVEAL_SIZE, { initial: true });
      state.tailVisible = true;
    }
    state.retryAt = 0;
    state.retryCount = 0;
    state.error = '';
    diagnostic('info', 'history.batch_complete', {
      channelId: state.id, source: batch.source, purpose: batch.purpose, priority: batch.priority, tier: batch.tier,
      generation, ref: batch.ref || '', rows: rows.length,
      acceptedRows, reservoir: state.reservoir.size, reservoirBytes: state.reservoirBytes,
      durationMs: timing.durationMs, estimatedMs: batch.estimatedMs, nextLimit: timing.nextLimit,
      hasOlder: state.hasOlder,
      beforeSeq: state.beforeSeq,
      rangeKind: batch.rangeKind,
      nextBeforeSeq: numeric(result.next_before_seq) || numeric(result.nextBeforeSeq),
      scanLowSeq: numeric(result.scan_low_seq), scanHighSeq: numeric(result.scan_high_seq),
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
    reservedInflightBytes += batch.reservedBytes;
    for (const state of channels.values()) {
      if (state.id === batch.channelId) state.waitDispatches = 0;
      else if (candidate(state)) state.waitDispatches += 1;
    }
	diagnostic('info', 'history.segment_requested', batch);
    let failed = false;
    executors.add(() => execute(batch), { id: batch.id, timeout: HISTORY_BATCH_TIMEOUT_MS }).then((result) => commit(batch, result)).catch((error) => {
      failed = true;
      const state = channels.get(batch.channelId);
	  if (!batch.cancelled && batch.source === 'network' && batch.ref) {
		batch.terminal?.reject(error);
		void cancelPage(batch.channelId, batch.ref, batch.generation).catch(() => {});
	  }
	  if (!batch.cancelled && batchIsCurrent(batch) && !destroyed && state) retry(state, error);
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

  function schedule() {
    if (destroyed) return;
    clearWake();
    reclassify();
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
      const state = schedulerState(id, previous);
	  const meta = localMeta.get?.(id) || localMeta[id] || null;
	  const cachedHead = localHead(meta);
	  const seamBatch = seamBatches.get(id);
	  const compatibleLocalBatch = Boolean(seamBatch?.source === 'indexeddb'
		&& cachedHead >= numeric(entry.head_seq)
		&& coverageContains(meta, numeric(entry.head_seq)));
	  const canKeepLocalFrontier = Boolean((previous?.tailVisible || previous?.completedPages > 0 || compatibleLocalBatch)
		&& cachedHead >= numeric(entry.head_seq)
		&& coverageContains(meta, numeric(entry.head_seq)));
	  if (compatibleLocalBatch) seamBatches.delete(id);
      state.attachedGeneration = generation;
	  state.remoteKnown = true;
	  state.remoteEligible = true;
      state.headSeq = numeric(entry.head_seq);
	  state.beforeSeq = canKeepLocalFrontier ? previous.beforeSeq : state.headSeq + 1;
      state.cacheBypassBeforeSeq = 0;
	  state.localMeta = meta;
      state.hasRows = Boolean(entry.has_rows);
	  state.hasOlder = state.hasRows && state.beforeSeq > 0;
      state.activity = Math.max(numeric(entry.last_activity), numeric(state.localMeta?.lastActivity));
	  state.tailVisible = Boolean(canKeepLocalFrontier && previous?.tailVisible);
	  if (!canKeepLocalFrontier) state.completedPages = 0;
	  if (!canKeepLocalFrontier && state.reservoir.size) {
		globalReservoirBytes = Math.max(0, globalReservoirBytes - state.reservoirBytes);
		state.reservoir = new Map();
		state.reservoirBytes = 0;
	  }
      state.error = entry.error_detail || '';
      channels.set(id, state);
    }
	const focused = channels.get(focus);
	if (focused && !focused.lastFocusOrder) {
	  focused.lastFocusOrder = ++focusSerial;
	  persistPriority();
	}
    for (const [id, state] of channels) {
      if (seen.has(id)) continue;
      state.attachedGeneration = 0;
	  state.remoteKnown = true;
	  state.remoteEligible = false;
      state.hasRows = false;
      state.hasOlder = false;
    }
	for (const [id, batch] of seamBatches) {
	  batch.cancelled = true;
	  batch.terminal?.reject(new Error('history source recalibrated by attach'));
	  if (batch.ref) {
		inflightByRef.delete(batch.ref);
		cancelledRefs.set(batch.ref, { channelId: batch.channelId, generation: batch.generation });
		if (batch.source === 'network') void cancelPage(batch.channelId, batch.ref, batch.generation).catch(() => {});
	  }
	  if (inflightByChannel.get(id) === batch) inflightByChannel.delete(id);
	}
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
    batch.rows.push({ channel_id: payload.channel_id, seq: numeric(payload.seq), envelope: payload.envelope });
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
    if (payload.error_code) batch.terminal.reject(new Error(payload.error_detail || payload.error_code));
    else batch.terminal.resolve(payload);
    return true;
  }

  async function nextSegment(channelId, { signal, count = HISTORY_REVEAL_SIZE, projectionBarrier = true } = {}) {
    if (signal?.aborted) return { kind: 'cancelled' };
    let state = channels.get(channelId);
    if (!state) {
      state = schedulerState(channelId);
      channels.set(channelId, state);
    }
	// The caller has completed projection of the previous segment and is asking
	// for a continuation. This acknowledgement, not a render timer, releases the
	// channel to schedule its next contiguous batch.
	state.projectionPending = false;
    if (state.reservoir.size > 0) {
      const released = release(state, Math.max(1, count));
	  state.projectionPending = projectionBarrier;
      publish();
      schedule();
      return { kind: 'segment', released };
    }
    if (authoritativeExhausted(state)) return { kind: 'exhausted' };
	const remoteAttached = Boolean(generation && state.attachedGeneration === generation);
	if (remoteUnavailable && !remoteAttached && sourceFor(state) !== 'indexeddb' && !inflightByChannel.has(channelId)) {
	  // The local replica has reached its proven frontier. More history may exist
	  // remotely, but an offline top-scroll must settle now rather than leave an
	  // unfulfillable waiter spinning until a future reconnect.
	  return { kind: 'exhausted', localOnly: true };
	}
    if (state.error && state.retryAt > now()) {
      return { kind: 'failed', error: new Error(state.error) };
    }
    return new Promise((resolve) => {
      const waiter = { resolve, cleanup: null, projectionBarrier };
      if (signal) {
        const abort = () => {
          const index = state.foregroundWaiters.indexOf(waiter);
          if (index >= 0) state.foregroundWaiters.splice(index, 1);
          resolve({ kind: 'cancelled' });
          cancelUnownedForeground(state);
          publish();
          schedule();
        };
        signal.addEventListener('abort', abort, { once: true });
        waiter.cleanup = () => signal.removeEventListener('abort', abort);
      }
      state.foregroundWaiters.push(waiter);
      state.retryAt = 0;
      publish();
      schedule();
    }).then((result) => {
      if (result?.kind !== 'available') return result;
      return nextSegment(channelId, { signal, count, projectionBarrier });
    });
  }

  function beginOperation(channelId, { signal, intent = 'scroll-history', urgency = 'interactive' } = {}) {
	let state = channels.get(channelId);
	if (!state) {
	  state = schedulerState(channelId);
	  channels.set(channelId, state);
	}
	const owner = {
	  intent: intent || 'scroll-history',
	  urgency: Object.hasOwn(DEMAND_URGENCY_SCORE, urgency) ? urgency : 'interactive',
	};
	let released = false;
	state.foregroundOwners.add(owner);
	promoteChannel(state, 'history channel promoted by user intent');
	const release = () => {
	  if (released) return;
	  released = true;
	  signal?.removeEventListener('abort', release);
	  state.foregroundOwners.delete(owner);
	  if (state.foregroundOwners.size === 0 && state.foregroundWaiters.length === 0) {
		state.projectionPending = false;
		cancelUnownedForeground(state);
	  }
	  publish();
	  schedule();
	};
	if (signal) signal.addEventListener('abort', release, { once: true });
	publish();
	schedule();
	return {
	  next: (options = {}) => nextSegment(channelId, { ...options, signal: options.signal || signal }),
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
      if (!state.tailVisible && state.headSeq > 0 && hasVisibleRow(state.id, state.headSeq)) {
        state.tailVisible = true;
      }
      if (!state.tailVisible && state.reservoir.size > 0) {
        const released = release(state, HISTORY_PAGE_SIZE, { initial: true });
        if (released > 0) state.tailVisible = true;
      }
      persistPriority();
    }
    if (state?.retryAt) state.retryAt = 0;
	promoteChannel(state, 'history channel promoted by focus');
    publish();
    schedule();
  }

  function setLocalMeta(nextMeta = new Map(), { publishChange = true } = {}) {
    for (const [id, value] of nextMeta) {
	  let state = channels.get(id);
	  if (!state) {
		state = schedulerState(id);
		channels.set(id, state);
	  }
      state.localMeta = value;
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
	  if (batch.ref) inflightByRef.delete(batch.ref);
	  if (inflightByChannel.get(channelId) === batch) inflightByChannel.delete(channelId);
    }
    for (const state of channels.values()) {
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

  function snapshot(channelId) {
    const state = channels.get(channelId);
    if (!state) return { headSeq: 0, oldestSeq: 0, hasOlder: false, loaded: false, loading: false, buffered: 0, bufferedNewest: 0, revealVersion: 0, attached: false, tier: 3, completedPages: 0, generation, error: '' };
    return {
      headSeq: state.headSeq,
      oldestSeq: state.beforeSeq,
      hasOlder: state.hasOlder,
      loaded: state.tailVisible,
      loading: inflightByChannel.has(channelId),
      buffered: state.reservoir.size,
      bufferedNewest: Math.max(0, ...state.reservoir.keys()),
      revealVersion: state.revealVersion,
      attached: generation > 0 && state.attachedGeneration === generation,
      tier: state.tier,
      completedPages: state.completedPages,
      generation,
      error: state.error,
    };
  }

  function observeLive(channelId, timestamp = 0, { related = false, seq = 0 } = {}) {
    if (!channelId) return;
    let state = channels.get(channelId);
    if (!state) {
      state = schedulerState(channelId);
      channels.set(channelId, state);
    }
    state.headSeq = Math.max(state.headSeq, numeric(seq));
    if (numeric(seq) > 0) state.hasRows = true;
    state.activity = Math.max(state.activity, numeric(timestamp));
    state.liveOrder = ++liveSerial;
    if (related) state.relatedUnreadOrder = state.liveOrder;
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
	for (const state of channels.values()) settleForeground(state, { kind: 'cancelled' });
	replicaEpoch += 1;
	for (const batch of inflightByChannel.values()) {
	  batch.cancelled = true;
	  batch.terminal?.reject(new Error('local replica reset'));
	}
	executors.clear();
	inflightByChannel.clear();
	inflightByRef.clear();
	cancelledRefs.clear();
	channels.clear();
	reservedInflightBytes = 0;
	globalReservoirBytes = 0;
	generation = 0;
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

  return { attach, setLocalMeta, setPriorityScope, historyRow, pageEnd, nextSegment, beginOperation, focus: setFocus, observeLive, markRead, disconnected, clear, resetReplica, destroy, isDestroyed: () => destroyed, snapshot, tick: schedule };
}
