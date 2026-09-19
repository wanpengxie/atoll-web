import { diagnostic, readingTrace } from './diagnostics.js';
import { createHistoryBoundedExecutor } from './history-bounded-executor.js';
import {
  HISTORY_DEMAND_URGENCY_SCORE as DEMAND_URGENCY_SCORE,
  hasHistoryLocalKnowledge as hasLocalKnowledge,
  historyBlockedSourceMatches,
  historyCoverageContains as coverageContains,
  historyLocalHead as localHead,
  historyRangesContain as rangesContain,
  historyRangesCover as rangesCover,
  historySourceBlockIdentity,
  historySourceFor as sourceFor,
  historyTailWindowCovered,
  mergeHistoryCoverage as mergedCoverage,
  reduceHistoryCandidates,
} from './history-candidate-reducer.js';
import { createHistorySourceAdapters } from './history-source-adapters.js';

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

function numeric(value) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : 0;
}

function rowBytes(envelope) {
  try { return new TextEncoder().encode(JSON.stringify(envelope)).byteLength; }
  catch { return 0; }
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

function visibleForegroundOwners(state) {
  return [...(state?.foregroundOwners || [])].filter((owner) => owner?.presentation === true);
}

export function createHistoryScheduler({
  requestPage,
  cancelPage,
  readCache,
  revealRows,
  hasVisibleRow,
  hasMaterializedRows,
  visibleOldestSeq,
  visibleNewestSeq,
  persistRows,
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
  const requiredPorts = {
    requestPage,
    cancelPage,
    readCache,
    revealRows,
    hasVisibleRow,
    hasMaterializedRows,
    visibleOldestSeq,
    visibleNewestSeq,
    persistRows,
  };
  for (const [name, port] of Object.entries(requiredPorts)) {
    if (typeof port !== 'function') throw new TypeError(`history scheduler requires ${name}`);
  }
  const executor = createHistoryBoundedExecutor({
    concurrency: HISTORY_MAX_INFLIGHT,
    timeoutMs: batchTimeoutMs,
  });
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
  let localMetaReady = false;
  const transportStats = {
    indexeddb: { durationMs: 80, rowsPerMs: 1.6, bytesPerMs: 16 * 1024, averageRowBytes: 2 * 1024, rowLimit: HISTORY_PAGE_SIZE },
    network: { durationMs: 400, rowsPerMs: 0.32, bytesPerMs: 4 * 1024, averageRowBytes: 2 * 1024, rowLimit: HISTORY_PAGE_SIZE },
  };
  const sources = createHistorySourceAdapters({
    requestPage,
    cancelPage,
    readCache,
    registerNetwork: (batch) => inflightByRef.set(batch.ref, batch),
  });

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

  function tailWindowCovered(meta, head) {
    return historyTailWindowCovered(meta, head, HISTORY_REVEAL_SIZE);
  }

  function candidateInput() {
    return {
      states: [...channels.values()], focus, generation, replicaEpoch, localMetaEpoch,
      localMetaReady, inflightByChannel,
      now: now(),
      globalReservoirBytes, reservedInflightBytes, dispatchSerial, dispatchWheelIndex,
      maxBackgroundInflight, transportStats,
      visibleOldestByChannel: new Map(
        [...channels.keys()].map((channelId) => [channelId, numeric(visibleOldestSeq(channelId))]),
      ),
      visibleNewestByChannel: new Map(
        [...channels.keys()].map((channelId) => [channelId, numeric(visibleNewestSeq(channelId))]),
      ),
      config: {
        maxInflight: HISTORY_MAX_INFLIGHT, p1Channels: HISTORY_P1_CHANNELS,
        p2Channels: HISTORY_P2_CHANNELS, reservoirSize, reservoirChannelBytes,
        reservoirGlobalBytes, batchBytes,
        fairnessDispatches: FAIRNESS_DISPATCHES,
        targets: {
          0: { rows: HISTORY_P0_TARGET_ROWS, bytes: HISTORY_P0_TARGET_BYTES, scanBudget: HISTORY_P0_SCAN_BUDGET },
          1: { rows: HISTORY_P1_TARGET_ROWS, bytes: HISTORY_P1_TARGET_BYTES, scanBudget: HISTORY_P1_SCAN_BUDGET },
          2: { rows: HISTORY_P2_TARGET_ROWS, bytes: HISTORY_P2_TARGET_BYTES, scanBudget: HISTORY_P2_SCAN_BUDGET },
        },
      },
    };
  }

  function reduceCandidates({ commitTiers = true } = {}) {
    const decision = reduceHistoryCandidates(candidateInput());
    if (commitTiers) {
      for (const state of channels.values()) state.tier = decision.tiers.get(state.id) ?? 3;
    }
    return decision;
  }

  function sourceBlockIdentity(state) {
    return historySourceBlockIdentity(state, {
      focus,
      generation,
      replicaEpoch,
      localMetaEpoch,
      visibleOldestSeq: numeric(visibleOldestSeq(state?.id)),
    });
  }

  function blockedSourceMatches(state, identity = sourceBlockIdentity(state)) {
    return historyBlockedSourceMatches(state, identity);
  }

  function beginVisibleDemand(state, { explicitRetry = false } = {}) {
	state.foregroundDemandRevision += 1;
	state.retryAt = 0;
	const blockedCurrent = blockedSourceMatches(state);
	if (blockedCurrent && !explicitRetry) {
	  state.foregroundError = state.error;
	  return;
	}
	state.blockedSource = null;
	state.error = '';
	state.errorCode = '';
	state.foregroundError = '';
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
    revealRows(state.id, selected.map(([seq, value]) => [seq, value.envelope]), {
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
      // A complete cache snapshot is a source contract. Missing claimed data
      // invalidates that contract; only a later authoritative snapshot may
      // select a different source for this frontier.
      if (result.cacheMiss) {
        const error = Object.assign(new Error('本地缓存覆盖声明与内容不一致'), {
          code: 'history_cache_contract_mismatch',
        });
        diagnostic('error', 'history.cache_claim_missed', {
          channelId: state.id, beforeSeq: batch.beforeSeq, generation,
        });
        throw error;
      }
      sources.validate(batch, result, rows);
    } else {
      sources.validate(batch, result, rows);
    }
    // Cooperative decoding owns only local staging. No cursor, coverage,
    // currentness or reservoir fact is published until the complete page has
    // crossed the same state/generation/batch lease below.
    const stagedPage = await stageRows(state, rows, {
      allowGlobalOverflow: batch.priority === 'foreground',
      sourceCancellation: sources.cancellation(batch),
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
		  if (!state.attachedGeneration && result.exhausted && batch.rangeKind === 'backfill') state.hasOlder = false;
    } else {
      state.headSeq = Math.max(state.headSeq, numeric(result.head_seq));
	  if (batch.rangeKind === 'backfill') state.beforeSeq = Number(result.next_before_seq);
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
		  state.tailVisible = hasMaterializedRows(state.id);
    } else if (!state.tailVisible && visibleIntent) {
      initialReleased = release(state, HISTORY_REVEAL_SIZE, { initial: true, byteLimit: batch.byteLimit });
      state.tailVisible = hasMaterializedRows(state.id);
      if (!state.tailVisible && state.reservoir.size > 0) {
        initialReleased += release(state, state.reservoir.size, { initial: true, byteLimit: batch.byteLimit });
        state.tailVisible = hasMaterializedRows(state.id);
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
    sources.prepare(batch);
    reservedInflightBytes += batch.reservedBytes;
    const waitingCandidates = reduceCandidates().candidates;
    for (const state of channels.values()) {
      if (state.id === batch.channelId) state.waitDispatches = 0;
      else if (waitingCandidates.has(state.id)) state.waitDispatches += 1;
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
    executor.run(async () => {
      await commit(batch, await sources.execute(batch));
      sources.complete(batch);
    }, {
      id: batch.id,
    }).catch((error) => {
      failed = true;
      sources.fail(batch);
      const state = channels.get(batch.channelId);
	  const timedOut = error?.name === 'TimeoutError'
	    || error?.code === 'timeout'
	    || error?.code === 'history_timeout';
	  if (!batch.cancelled && batchIsCurrent(batch) && !destroyed && state) {
		const sourceError = timedOut ? new Error(batch.source === 'indexeddb'
		  ? '本地缓存读取超时，请重试'
		    : sources.phase(batch) === 'network-page'
		    ? '历史数据响应超时，请重试'
		    : '历史请求回执超时，请重试') : error;
		if (timedOut) sourceError.code = batch.source === 'indexeddb'
		  ? 'history_cache_timeout'
		    : sources.phase(batch) === 'network-page'
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
			cancelBatch(batch, sourceError?.message || 'history source failed');
			// A selected source failure is terminal for this exact authority/frontier.
			// It never rewrites source authority or silently retries through another
			// provider. Only an explicit owner replacement may select a new source.
			retry(state, sourceError, { automatic: false });
		return;
	  }
    }).finally(() => {
      reservedInflightBytes = Math.max(0, reservedInflightBytes - batch.reservedBytes);
      if (batch.ref) inflightByRef.delete(batch.ref);
      if (inflightByChannel.get(batch.channelId) === batch) inflightByChannel.delete(batch.channelId);
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
    if (batch.source === 'network' && batch.ref) {
	  const state = channels.get(batch.channelId);
	  const pending = sources.cancel(batch, reason);
	  if (state) state.cancelPending = pending;
      void pending.catch((error) => {
        diagnostic('warn', 'history.cancel_failed', { channelId: batch.channelId, ref: batch.ref, error });
	  }).finally(() => {
		if (state?.cancelPending === pending) state.cancelPending = null;
		publish();
		schedule();
      });
    } else void sources.cancel(batch, reason);
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

  function preemptForFocusedCandidate(decision) {
    const active = [...inflightByChannel.values()].filter((batch) => !batch.cancelled);
    if (active.length < HISTORY_MAX_INFLIGHT || active.length !== inflightByChannel.size) return false;
    const focusedCandidate = decision.candidates.get(focus);
    if (!focusedCandidate || focusedCandidate.channelId !== focus || focusedCandidate.priority !== 'foreground') {
      return false;
    }
    const victim = active
      .filter((batch) => {
        const state = channels.get(batch.channelId);
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
    let decision = reduceCandidates();
    preemptForFocusedCandidate(decision);
    while (inflightByChannel.size < HISTORY_MAX_INFLIGHT) {
      decision = reduceCandidates();
      const batch = decision.selected;
      if (!batch) break;
      dispatchWheelIndex = decision.nextWheelIndex;
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
	  void sources.cancel(batch, 'history source recalibrated by attach').catch(() => {});
	  if (batch.ref) {
		inflightByRef.delete(batch.ref);
		cancelledRefs.set(batch.ref, { channelId: batch.channelId, generation: batch.generation });
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
    sources.appendRow(batch, { channel_id: payload.channel_id, seq, envelope: payload.envelope });
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
      rows: sources.rowCount(batch),
      firstSeq: batch.readingTraceArrival?.firstSeq || 0,
      lastSeq: batch.readingTraceArrival?.lastSeq || 0,
      minSeq: batch.readingTraceArrival?.minSeq || 0,
      maxSeq: batch.readingTraceArrival?.maxSeq || 0,
      arrivalCount: batch.readingTraceArrival?.count || 0,
      arrivalDurationMs: batch.readingTraceArrival
        ? Math.max(0, batch.readingTraceArrival.lastAt - batch.readingTraceArrival.firstAt)
        : 0,
    });
    sources.finish(batch, payload);
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
        && hasMaterializedRows(state.id)) {
        state.tailVisible = true;
      }
      if (!state.tailVisible && state.reservoir.size > 0) {
        const released = release(state, HISTORY_PAGE_SIZE, { initial: true, byteLimit: HISTORY_REVEAL_BYTES });
        if (released > 0 && hasMaterializedRows(state.id)) state.tailVisible = true;
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
  } = {}) {
    const activatingLocalMeta = localReady === true && !localMetaReady;
    if (typeof localReady === 'boolean') localMetaReady = localReady;
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
		    && !hasMaterializedRows(id)
	    && cachedHead >= state.headSeq
	    && tailWindowCovered(value, state.headSeq));
		  if (coldLocalTail) {
		    // Complete cache selection establishes the cold-start frontier before
		    // scheduling begins. No provisional remote source is opened meanwhile.
	    state.beforeSeq = cachedHead + 1;
	    state.hasRows = cachedHead > 0 || state.hasRows;
	    state.hasOlder = state.hasRows;
	    state.tailRefreshBeforeSeq = 0;
	    state.tailRefreshFloorSeq = 0;
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
	  void sources.cancel(batch, 'connection closed', { notifyRemote: false });
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
    if (destroyed) executor.clear();
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
      // Remote EOF does not exhaust rows already installed but not presented.
      // Keep the visual supply gate open until its reservoir is drained.
      hasOlder: state.hasOlder || state.reservoir.size > 0,
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
      waitingStage: batch ? sources.phase(batch) : '',
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

  function debugSnapshot(channelId = '') {
    const state = channels.get(channelId);
    const batch = state ? inflightByChannel.get(channelId) : null;
    const decision = reduceCandidates({ commitTiers: false });
    const pendingCandidate = state ? decision.candidates.get(state.id) : null;
    const summarizeBatch = (entry) => ({
      channelId: entry.channelId,
      source: entry.source,
      purpose: entry.purpose,
      rangeKind: entry.rangeKind,
      phase: sources.phase(entry),
      priority: entry.priority,
      generation: numeric(entry.generation),
      beforeSeq: numeric(entry.beforeSeq),
      limit: numeric(entry.limit),
      queuedMs: Math.max(0, now() - numeric(entry.createdAt)),
      cancelled: entry.cancelled === true,
    });
    const summarizeChannel = (entry) => ({
      channelId: entry.id,
      tier: decision.tiers.get(entry.id) ?? 3,
      attached: generation > 0 && entry.attachedGeneration === generation,
      headSeq: numeric(entry.headSeq),
      frontierSeq: numeric(entry.beforeSeq),
      tailRefreshBeforeSeq: numeric(entry.tailRefreshBeforeSeq),
      hasOlder: entry.hasOlder === true,
      tailVisible: entry.tailVisible === true,
      controlCurrent: entry.controlCurrent === true,
      projectionPending: entry.projectionPending === true,
      buffered: entry.reservoir.size,
      bufferedBytes: numeric(entry.reservoirBytes),
      foregroundOwners: entry.foregroundOwners.size,
      foregroundWaiters: entry.foregroundWaiters.length,
      currentWaiters: entry.currentWaiters.size,
      completedPages: numeric(entry.completedPages),
      retryInMs: Math.max(0, numeric(entry.retryAt) - now()),
      errorCode: entry.error ? String(entry.errorCode || 'history_failed') : '',
      blockedBy: decision.blockReasons.get(entry.id) || 'not-selected',
    });
    return Object.freeze({
      version: 1,
      channel: state ? summarizeChannel(state) : {
        channelId: String(channelId || ''),
        blockedBy: channelId ? 'channel-unknown' : 'no-channel',
      },
      candidate: pendingCandidate ? {
        source: pendingCandidate.source,
        purpose: pendingCandidate.purpose,
        rangeKind: pendingCandidate.rangeKind,
        priority: pendingCandidate.priority,
        beforeSeq: pendingCandidate.beforeSeq,
        limit: pendingCandidate.limit,
        byteLimit: pendingCandidate.byteLimit,
      } : null,
      inflight: batch ? summarizeBatch(batch) : null,
      global: {
        focus,
        generation,
        localMetaReady,
        inflightCount: inflightByChannel.size,
        executorRunning: numeric(executor.snapshot().running),
        executorQueued: numeric(executor.snapshot().queued),
        reservedBytes: reservedInflightBytes,
        reservoirBytes: globalReservoirBytes,
        reservoirLimitBytes: reservoirGlobalBytes,
        wakeInMs: Math.max(0, wakeAt - now()),
        occupants: [...inflightByChannel.values()].slice(0, HISTORY_MAX_INFLIGHT)
          .map(summarizeBatch),
        otherChannels: [...channels.values()]
          .filter((entry) => entry.id !== channelId
            && (inflightByChannel.has(entry.id)
              || entry.foregroundOwners.size > 0
              || entry.foregroundWaiters.length > 0))
          .slice(0, 8)
          .map(summarizeChannel),
      },
    });
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
	  void sources.cancel(batch, 'local replica reset', { notifyRemote: false });
	}
	executor.clear();
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

  return { attach, revoke, refreshRemoteMeta, waitForCurrent, setLocalMeta, setPriorityScope, historyRow, pageEnd, nextSegment, beginOperation, focus: setFocus, observeLive, markRead, disconnected, clear, resetReplica, destroy, isDestroyed: () => destroyed, snapshot, debugSnapshot, tick: schedule };
}
