import PQueue from 'p-queue';
import { diagnostic } from './diagnostics.js';

export const HISTORY_PAGE_SIZE = 200;
export const HISTORY_BATCH_BYTES = 4 * 1024 * 1024;
export const HISTORY_RESERVOIR_SIZE = 5_000;
export const HISTORY_RESERVOIR_CHANNEL_BYTES = 16 * 1024 * 1024;
export const HISTORY_RESERVOIR_GLOBAL_BYTES = 64 * 1024 * 1024;
export const HISTORY_MAX_INFLIGHT = 4;
export const HISTORY_MAX_BACKGROUND_INFLIGHT = 3;
export const HISTORY_REVEAL_SIZE = 32;
export const HISTORY_REVEAL_BYTES = 1 * 1024 * 1024;
export const HISTORY_BATCH_TIMEOUT_MS = 30_000;

const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 30_000;
const FAIRNESS_DISPATCHES = 8;

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

function createState(id, previous = {}) {
  return {
    id,
    attachedGeneration: 0,
    headSeq: 0,
    // One exclusive scan frontier is shared by IndexedDB and the network.
    // Sources may serve this cursor; they never own or translate it.
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
    waitDispatches: 0,
    ...previous,
  };
}

function purposeFor(state, focus) {
  if (state.foregroundOwners.size > 0 || state.foregroundWaiters.length > 0) return 'user-demand';
  if (!state.tailVisible) return 'initial-tail';
  return 'hydrate';
}

function priorityFor(state, purpose, focus) {
  return purpose === 'user-demand' || (purpose === 'initial-tail' && state.id === focus)
    ? 'foreground'
    : 'background';
}

export function createHistoryScheduler({
  requestPage,
  cancelPage = () => Promise.resolve(),
  readCache = async () => ({ rows: [], exhausted: true, nextBeforeSeq: 0, bytes: 0 }),
  revealRows,
  hasVisibleRow = () => false,
  persistRows = () => Promise.resolve(),
  onChange = () => {},
  onError = () => {},
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
  now = () => Date.now(),
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
  let globalReservoirBytes = 0;
  let reservedInflightBytes = 0;
  let dispatchSerial = 0;
  let wakeTimer = null;
  let wakeAt = 0;
  let destroyed = false;

  function publish() { onChange(); }

  function settleForeground(state, result) {
    const waiters = state?.foregroundWaiters?.splice?.(0) || [];
	if (waiters.length > 0) state.projectionPending = true;
    for (const waiter of waiters) {
      waiter.cleanup?.();
      waiter.resolve(result);
    }
  }

  function authoritativeExhausted(state) {
    return Boolean(state
      && generation
      && state.attachedGeneration === generation
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

  function sourceFor(state) {
    const local = state.localMeta;
    if (!local || state.cacheBypassBeforeSeq === state.beforeSeq) return 'network';
    const frontier = state.beforeSeq - 1;
    return frontier > 0 && coverageContains(local, frontier) ? 'indexeddb' : 'network';
  }

  function candidate(state) {
    if (!state || !generation || state.attachedGeneration !== generation || inflightByChannel.has(state.id) || state.cancelPending || state.retryAt > now()) return null;
	if (state.projectionPending) return null;
    if (state.reservoir.size >= HISTORY_RESERVOIR_SIZE || state.reservoirBytes >= HISTORY_RESERVOIR_CHANNEL_BYTES) return null;
    const purpose = purposeFor(state, focus);
    const priority = priorityFor(state, purpose, focus);
    const urgent = priority === 'foreground';
    const channelAvailable = Math.max(0, HISTORY_RESERVOIR_CHANNEL_BYTES - state.reservoirBytes);
    const globalAvailable = Math.max(0, HISTORY_RESERVOIR_GLOBAL_BYTES - globalReservoirBytes - reservedInflightBytes);
    const byteLimit = Math.min(HISTORY_BATCH_BYTES, channelAvailable, urgent ? HISTORY_BATCH_BYTES : globalAvailable);
    if (byteLimit <= 0) return null;
    // Ordinary hydration reserves its worst-case completion before I/O starts.
    // Initial/user-demand pages are released immediately and may borrow exactly
    // one batch beyond the resident global budget, but never beyond the channel cap.
    if (!urgent && byteLimit < Math.min(HISTORY_BATCH_BYTES, channelAvailable)) return null;
    if (!state.hasRows && !state.hasOlder && !hasLocalKnowledge(state.localMeta)) return null;
    if (state.tailVisible && !state.hasOlder) return null;
    let priorityClass = priority === 'foreground' ? 100 : 0;
    if (purpose === 'user-demand') priorityClass += 20;
    else if (purpose === 'initial-tail') priorityClass += 10;
    // Starvation promotion is deliberately confined to the same transport
    // class. Background hydration can become the next background batch, but
    // it can never jump ahead of a person's active top operation.
    priorityClass += Math.min(9, Math.floor(state.waitDispatches / FAIRNESS_DISPATCHES));
    const limit = Math.max(1, Math.min(HISTORY_PAGE_SIZE, HISTORY_RESERVOIR_SIZE - state.reservoir.size));
    return {
      id: `${generation}:${state.id}:${dispatchSerial + 1}`,
      generation,
      channelId: state.id,
      source: sourceFor(state),
      purpose,
      priority,
      beforeSeq: state.beforeSeq,
      limit,
      byteLimit,
      reservedBytes: byteLimit,
      priorityClass,
      activity: state.activity,
      waterDeficit: HISTORY_RESERVOIR_SIZE - state.reservoir.size,
      waitDispatches: state.waitDispatches,
    };
  }

  function compare(left, right) {
    return right.priorityClass - left.priorityClass
      || right.activity - left.activity
      || right.waterDeficit - left.waterDeficit
      || right.waitDispatches - left.waitDispatches
      || left.channelId.localeCompare(right.channelId);
  }

  function choose() {
    const backgroundInflight = [...inflightByChannel.values()].filter((batch) => batch.priority === 'background').length;
    const candidates = [...channels.values()].map(candidate).filter((batch) => (
      batch && (batch.priority === 'foreground' || backgroundInflight < HISTORY_MAX_BACKGROUND_INFLIGHT)
    )).sort(compare);
    return candidates[0] || null;
  }

  function rememberRows(state, rows, { allowGlobalOverflow = false } = {}) {
    let accepted = 0;
    for (const row of rows) {
      const seq = numeric(row.seq);
      if (!seq || hasVisibleRow(state.id, seq) || state.reservoir.has(seq)) continue;
      const bytes = rowBytes(row.envelope);
      if (state.reservoir.size >= HISTORY_RESERVOIR_SIZE
        || state.reservoirBytes + bytes > HISTORY_RESERVOIR_CHANNEL_BYTES
        || (!allowGlobalOverflow && globalReservoirBytes + bytes > HISTORY_RESERVOIR_GLOBAL_BYTES)
        || (allowGlobalOverflow && globalReservoirBytes + bytes > HISTORY_RESERVOIR_GLOBAL_BYTES + HISTORY_BATCH_BYTES)) break;
      state.reservoir.set(seq, { envelope: row.envelope, bytes });
      state.reservoirBytes += bytes;
      globalReservoirBytes += bytes;
      accepted += 1;
    }
    return accepted;
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
        generation: batch.generation, byteLimit: batch.byteLimit,
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

  function commit(batch, result) {
    if (batch.generation !== generation) return;
    const state = channels.get(batch.channelId);
    if (!state) return;
    const rows = (result.rows || []).sort((left, right) => left.seq - right.seq);
    if (batch.source === 'indexeddb') {
      // Metadata can become stale after FIFO/quota eviction. A miss does not
      // advance truth; it only bypasses this cache claim at the same frontier.
      if (result.cacheMiss) {
        state.cacheBypassBeforeSeq = batch.beforeSeq;
        diagnostic('warn', 'history.cache_claim_missed', {
          channelId: state.id, beforeSeq: batch.beforeSeq, generation,
        });
        return;
      }
      validateCachePage(batch, result, rows);
      state.beforeSeq = Number(result.nextBeforeSeq);
      state.cacheBypassBeforeSeq = 0;
    } else {
	  validateNetworkPage(batch, result, rows);
      state.headSeq = Math.max(state.headSeq, numeric(result.head_seq));
	  state.beforeSeq = Number(result.next_before_seq);
	  state.cacheBypassBeforeSeq = 0;
	  // Cursor zero is the ledger origin and therefore authoritative exhaustion,
	  // even if an older server/mocked projector conservatively reports
	  // has_older=true because only hidden housekeeping remains.
	  state.hasOlder = Boolean(result.has_older) && state.beforeSeq > 0;
      const lowSeq = numeric(result.scan_low_seq);
      const highSeq = numeric(result.scan_high_seq);
      const coverageByChannel = lowSeq && highSeq >= lowSeq
        ? new Map([[state.id, { lowSeq, highSeq }]])
        : new Map();
      void persistRows(rows, { coverageByChannel }).catch((error) => diagnostic('error', 'history.cache_persist_failed', { channelId: state.id, error }));
    }
    const acceptedRows = rememberRows(state, rows, { allowGlobalOverflow: batch.priority === 'foreground' });
    let initialReleased = 0;
    if (!state.tailVisible) {
      initialReleased = release(state, state.reservoir.size, { initial: true });
      state.tailVisible = true;
    }
    state.retryAt = 0;
    state.retryCount = 0;
    state.error = '';
    diagnostic('info', 'history.batch_complete', {
      channelId: state.id, source: batch.source, purpose: batch.purpose, priority: batch.priority,
      generation, ref: batch.ref || '', rows: rows.length,
      acceptedRows, reservoir: state.reservoir.size, reservoirBytes: state.reservoirBytes,
      hasOlder: state.hasOlder,
      beforeSeq: state.beforeSeq,
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
	  if (!batch.cancelled && batch.generation === generation && !destroyed && state) retry(state, error);
    }).finally(() => {
      reservedInflightBytes = Math.max(0, reservedInflightBytes - batch.reservedBytes);
      if (batch.ref) inflightByRef.delete(batch.ref);
      if (inflightByChannel.get(batch.channelId) === batch) inflightByChannel.delete(batch.channelId);
      // Silent hydration changes only the off-DOM reservoir. Publishing every
      // batch would make the full app reconcile continuously while idle. Initial
      // paint, sticky user demand, and errors remain observable immediately.
      if (batch.purpose !== 'hydrate' || failed) publish();
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
    if (batch?.priority === 'background') cancelBatch(batch, reason);
  }

  function schedule() {
    if (destroyed) return;
    clearWake();
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
    if (generation && nextGeneration > generation) disconnected(nextGeneration);
    generation = nextGeneration;
    focus = detail.focus || focus;
    const localMeta = detail.localMeta || new Map();
    const seen = new Set();
    for (const entry of entries) {
      const id = entry?.channel_id;
      if (!id) continue;
      seen.add(id);
      const previous = channels.get(id);
      const state = createState(id, previous);
      state.attachedGeneration = generation;
      state.headSeq = numeric(entry.head_seq);
      state.beforeSeq = state.headSeq + 1;
      state.cacheBypassBeforeSeq = 0;
      state.localMeta = localMeta.get?.(id) || localMeta[id] || null;
      state.hasRows = Boolean(entry.has_rows);
      state.hasOlder = state.hasRows;
      state.activity = Math.max(numeric(entry.last_activity), numeric(state.localMeta?.lastActivity));
      state.tailVisible = false;
      state.error = entry.error_detail || '';
      channels.set(id, state);
    }
    for (const [id, state] of channels) {
      if (seen.has(id)) continue;
      state.attachedGeneration = 0;
      state.hasRows = false;
      state.hasOlder = false;
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

  async function nextSegment(channelId, { signal, count = HISTORY_REVEAL_SIZE } = {}) {
    if (signal?.aborted) return { kind: 'cancelled' };
    let state = channels.get(channelId);
    if (!state) {
      state = createState(channelId);
      channels.set(channelId, state);
    }
	// The caller has completed projection of the previous segment and is asking
	// for a continuation. This acknowledgement, not a render timer, releases the
	// channel to schedule its next contiguous batch.
	state.projectionPending = false;
    if (state.reservoir.size > 0) {
      const released = release(state, Math.max(1, count));
      publish();
      schedule();
      return { kind: 'segment', released };
    }
    if (authoritativeExhausted(state)) return { kind: 'exhausted' };
    if (state.error && state.retryAt > now()) {
      return { kind: 'failed', error: new Error(state.error) };
    }
    return new Promise((resolve) => {
      const waiter = { resolve, cleanup: null };
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
      return nextSegment(channelId, { signal, count });
    });
  }

  function beginOperation(channelId, { signal } = {}) {
	let state = channels.get(channelId);
	if (!state) {
	  state = createState(channelId);
	  channels.set(channelId, state);
	}
	const owner = {};
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
    focus = channelId || '';
    const state = channels.get(focus);
    if (state?.retryAt) state.retryAt = 0;
	promoteChannel(state, 'history channel promoted by focus');
    publish();
    schedule();
  }

  function setLocalMeta(nextMeta = new Map()) {
    for (const [id, value] of nextMeta) {
      const state = channels.get(id);
      if (!state) continue;
      state.localMeta = value;
      state.cacheBypassBeforeSeq = 0;
      state.activity = Math.max(state.activity, numeric(value?.lastActivity));
    }
    publish();
    schedule();
  }

  function disconnected(nextGeneration = generation + 1) {
    generation = Math.max(generation + 1, numeric(nextGeneration));
    for (const batch of inflightByChannel.values()) {
      batch.cancelled = true;
      batch.terminal?.reject(new Error('connection closed'));
    }
    for (const state of channels.values()) settleForeground(state, { kind: 'cancelled' });
	for (const state of channels.values()) {
	  state.foregroundOwners.clear();
	  state.projectionPending = false;
	  state.cancelPending = null;
	}
    inflightByRef.clear();
    cancelledRefs.clear();
    inflightByChannel.clear();
    executors.clear();
    reservedInflightBytes = 0;
    clearWake();
    diagnostic('info', 'history.disconnected', { generation });
  }

  function snapshot(channelId) {
    const state = channels.get(channelId);
    if (!state) return { headSeq: 0, oldestSeq: 0, hasOlder: false, loaded: false, loading: false, buffered: 0, bufferedNewest: 0, revealVersion: 0, attached: false, generation, error: '' };
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
      generation,
      error: state.error,
    };
  }

  function observeLive(channelId, timestamp = 0) {
    const state = channels.get(channelId);
    if (!state) return;
    state.activity = Math.max(state.activity, numeric(timestamp));
    schedule();
  }

  function clear() {
    disconnected(generation + 1);
    channels.clear();
    globalReservoirBytes = 0;
    publish();
  }

  function destroy() {
    destroyed = true;
    disconnected(generation + 1);
  }

  return { attach, setLocalMeta, historyRow, pageEnd, nextSegment, beginOperation, focus: setFocus, observeLive, disconnected, clear, destroy, snapshot, tick: schedule };
}
