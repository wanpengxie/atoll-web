import PQueue from 'p-queue';
import { diagnostic } from './diagnostics.js';

export const HISTORY_PAGE_SIZE = 200;
export const HISTORY_BATCH_BYTES = 4 * 1024 * 1024;
export const HISTORY_RESERVOIR_SIZE = 5_000;
export const HISTORY_RESERVOIR_CHANNEL_BYTES = 16 * 1024 * 1024;
export const HISTORY_RESERVOIR_GLOBAL_BYTES = 64 * 1024 * 1024;
export const HISTORY_MAX_INFLIGHT = 4;
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

function createState(id, previous = {}) {
  return {
    id,
    headSeq: 0,
    networkBeforeSeq: 0,
    networkStarted: false,
    localBeforeSeq: 0,
    localMeta: null,
    localExhausted: false,
    hasRows: false,
    hasOlder: false,
    tailVisible: false,
    reservoir: new Map(),
    reservoirBytes: 0,
    revealVersion: 0,
    userDemand: 0,
    retryAt: 0,
    retryCount: 0,
    error: '',
    activity: 0,
    waitDispatches: 0,
    ...previous,
  };
}

function purposeFor(state, focus) {
  if (state.userDemand > 0) return 'user-demand';
  if (!state.tailVisible) return 'initial-tail';
  return 'hydrate';
}

export function createHistoryScheduler({
  requestPage,
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
  let focus = '';
  let generation = 0;
  let globalReservoirBytes = 0;
  let reservedInflightBytes = 0;
  let dispatchSerial = 0;
  let wakeTimer = null;
  let wakeAt = 0;
  let destroyed = false;

  function publish() { onChange(); }

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
    if (!local || state.localExhausted || !local.rowCount) return 'network';
    if (state.localBeforeSeq && !state.localExhausted) return 'indexeddb';
    const frontier = state.networkStarted ? state.networkBeforeSeq - 1 : state.headSeq;
    if (Array.isArray(local.coverage) && local.coverage.length) {
      return frontier > 0 && coverageContains(local, frontier) ? 'indexeddb' : 'network';
    }
    const before = state.localBeforeSeq || state.networkBeforeSeq || state.headSeq;
    // A stale disk tail must never win first paint over the server's newest
    // tail. Network closes the gap first; IDB takes over once cursors overlap.
    if (!state.tailVisible && local.newestSeq < state.headSeq) return 'network';
    if (before > local.newestSeq + 1) return 'network';
    return 'indexeddb';
  }

  function candidate(state) {
    if (!state || inflightByChannel.has(state.id) || state.retryAt > now()) return null;
    if (state.reservoir.size >= HISTORY_RESERVOIR_SIZE || state.reservoirBytes >= HISTORY_RESERVOIR_CHANNEL_BYTES) return null;
    const purpose = purposeFor(state, focus);
    const urgent = purpose === 'user-demand' || purpose === 'initial-tail';
    const channelAvailable = Math.max(0, HISTORY_RESERVOIR_CHANNEL_BYTES - state.reservoirBytes);
    const globalAvailable = Math.max(0, HISTORY_RESERVOIR_GLOBAL_BYTES - globalReservoirBytes - reservedInflightBytes);
    const byteLimit = Math.min(HISTORY_BATCH_BYTES, channelAvailable, urgent ? HISTORY_BATCH_BYTES : globalAvailable);
    if (byteLimit <= 0) return null;
    // Ordinary hydration reserves its worst-case completion before I/O starts.
    // Initial/user-demand pages are released immediately and may borrow exactly
    // one batch beyond the resident global budget, but never beyond the channel cap.
    if (!urgent && byteLimit < Math.min(HISTORY_BATCH_BYTES, channelAvailable)) return null;
    if (!state.hasRows && !state.hasOlder && !state.localMeta?.rowCount) return null;
    if (state.tailVisible && !state.hasOlder && state.localExhausted) return null;
    let priorityClass = state.id === focus ? 20 : 10;
    if (purpose === 'user-demand') priorityClass = 50;
    else if (!state.tailVisible) priorityClass = state.id === focus ? 40 : 30;
    if (state.waitDispatches >= FAIRNESS_DISPATCHES && priorityClass < 49) priorityClass = 49;
    const limit = Math.max(1, Math.min(HISTORY_PAGE_SIZE, HISTORY_RESERVOIR_SIZE - state.reservoir.size));
    return {
      id: `${generation}:${state.id}:${dispatchSerial + 1}`,
      generation,
      channelId: state.id,
      source: sourceFor(state),
      purpose,
      beforeSeq: sourceFor(state) === 'indexeddb'
        ? (state.localBeforeSeq || (state.tailVisible ? (state.networkBeforeSeq || state.headSeq) : 0))
        : (state.networkStarted ? state.networkBeforeSeq : 0),
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
    const candidates = [...channels.values()].map(candidate).filter(Boolean).sort(compare);
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
    onError(error instanceof Error ? error : new Error(state.error));
  }

  async function executeNetwork(batch) {
    const terminal = deferred();
    let accepted;
    try {
      accepted = requestPage(batch.channelId, batch.beforeSeq, batch.limit, {
        purpose: batch.purpose, generation: batch.generation, byteLimit: batch.byteLimit,
      });
    } catch (error) {
      throw error;
    }
    batch.ref = accepted?.ref || '';
    batch.rows = [];
    batch.terminal = terminal;
    inflightByRef.set(batch.ref, batch);
    const receipt = await accepted;
    if (!receipt?.accepted || receipt.generation !== batch.generation || receipt.channel_id !== batch.channelId) {
      throw new Error('历史批次回执不匹配');
    }
    const page = await terminal.promise;
    return { ...page, rows: batch.rows };
  }

  async function execute(batch) {
    if (batch.source === 'indexeddb') {
      return readCache(batch.channelId, batch.beforeSeq, batch.limit, batch.byteLimit);
    }
    return executeNetwork(batch);
  }

  function commit(batch, result) {
    if (batch.generation !== generation) return;
    const state = channels.get(batch.channelId);
    if (!state) return;
    const rows = (result.rows || []).sort((left, right) => left.seq - right.seq);
    if (batch.source === 'indexeddb') {
      state.localBeforeSeq = numeric(result.nextBeforeSeq) || batch.beforeSeq;
      state.localExhausted = Boolean(result.exhausted);
      if (state.localExhausted && state.localMeta?.oldestSeq) {
        state.networkBeforeSeq = Math.min(state.networkBeforeSeq || state.headSeq, state.localMeta.oldestSeq);
        state.networkStarted = true;
      }
    } else {
      state.headSeq = Math.max(state.headSeq, numeric(result.head_seq));
      state.networkBeforeSeq = numeric(result.next_before_seq) || numeric(result.oldest_seq) || batch.beforeSeq;
      state.networkStarted = true;
      state.hasOlder = Boolean(result.has_older);
      const lowSeq = numeric(result.scan_low_seq);
      const highSeq = numeric(result.scan_high_seq);
      const coverageByChannel = lowSeq && highSeq >= lowSeq
        ? new Map([[state.id, { lowSeq, highSeq }]])
        : new Map();
      void persistRows(rows, { coverageByChannel }).catch((error) => diagnostic('error', 'history.cache_persist_failed', { channelId: state.id, error }));
    }
    rememberRows(state, rows, { allowGlobalOverflow: batch.purpose === 'initial-tail' || batch.purpose === 'user-demand' });
    if (!state.tailVisible) {
      release(state, state.reservoir.size, { initial: true });
      state.tailVisible = true;
    }
    let demandReleased = 0;
    if (state.userDemand > 0 && state.reservoir.size) {
      demandReleased = release(state, Math.min(state.userDemand, HISTORY_REVEAL_SIZE));
      state.userDemand = Math.max(0, state.userDemand - demandReleased);
    }
    state.retryAt = 0;
    state.retryCount = 0;
    state.error = '';
    diagnostic('info', 'history.batch_complete', {
      channelId: state.id, source: batch.source, purpose: batch.purpose,
      generation, ref: batch.ref || '', rows: rows.length,
      reservoir: state.reservoir.size, demandReleased, hasOlder: state.hasOlder,
    });
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
    diagnostic('debug', 'history.batch_dispatched', batch);
    let failed = false;
    executors.add(() => execute(batch), { id: batch.id, timeout: HISTORY_BATCH_TIMEOUT_MS }).then((result) => commit(batch, result)).catch((error) => {
      failed = true;
      const state = channels.get(batch.channelId);
      if (batch.generation === generation && !destroyed && state) retry(state, error);
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
      state.headSeq = numeric(entry.head_seq);
      state.networkBeforeSeq = state.headSeq;
      state.networkStarted = false;
      state.localMeta = localMeta.get?.(id) || localMeta[id] || null;
      state.localBeforeSeq = 0;
      state.localExhausted = !state.localMeta?.rowCount;
      state.hasRows = Boolean(entry.has_rows);
      state.hasOlder = state.hasRows;
      state.activity = Math.max(numeric(entry.last_activity), numeric(state.localMeta?.lastActivity));
      state.tailVisible = false;
      state.userDemand = 0;
      state.error = entry.error_detail || '';
      channels.set(id, state);
    }
    for (const [id, state] of channels) {
      if (seen.has(id)) continue;
      state.hasRows = false;
      state.hasOlder = false;
      state.localExhausted = true;
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
      diagnostic('warn', 'history.unmatched_row', { ref: payload.ref, channelId: payload.channel_id, generation: payload.generation });
      return true;
    }
    batch.rows.push({ channel_id: payload.channel_id, seq: numeric(payload.seq), envelope: payload.envelope });
    return true;
  }

  function pageEnd(payload = {}) {
    const batch = inflightByRef.get(payload.ref || '');
    if (!batch || numeric(payload.generation) !== batch.generation || payload.channel_id !== batch.channelId) {
      diagnostic('warn', 'history.unmatched_page_end', { ref: payload.ref, channelId: payload.channel_id, generation: payload.generation });
      return false;
    }
    if (payload.error_code) batch.terminal.reject(new Error(payload.error_detail || payload.error_code));
    else batch.terminal.resolve(payload);
    return true;
  }

  function take(channelId, count = HISTORY_REVEAL_SIZE) {
    const state = channels.get(channelId);
    if (!state) return 0;
    const released = release(state, count);
    if (released < count && (state.hasOlder || !state.localExhausted)) {
      state.userDemand = Math.max(state.userDemand, count - released);
    }
    publish();
    schedule();
    return released;
  }

  function setFocus(channelId) {
    focus = channelId || '';
    const state = channels.get(focus);
    if (state?.retryAt) state.retryAt = 0;
    publish();
    schedule();
  }

  function setLocalMeta(nextMeta = new Map()) {
    for (const [id, value] of nextMeta) {
      const state = channels.get(id);
      if (!state) continue;
      state.localMeta = value;
      state.localExhausted = !value?.rowCount;
      state.activity = Math.max(state.activity, numeric(value?.lastActivity));
    }
    publish();
    schedule();
  }

  function disconnected(nextGeneration = generation + 1) {
    generation = Math.max(generation + 1, numeric(nextGeneration));
    for (const batch of inflightByRef.values()) batch.terminal?.reject(new Error('connection closed'));
    inflightByRef.clear();
    inflightByChannel.clear();
    executors.clear();
    reservedInflightBytes = 0;
    clearWake();
    diagnostic('info', 'history.disconnected', { generation });
  }

  function snapshot(channelId) {
    const state = channels.get(channelId);
    if (!state) return { headSeq: 0, oldestSeq: 0, hasOlder: false, loaded: false, loading: false, buffered: 0, bufferedNewest: 0, revealVersion: 0, error: '' };
    return {
      headSeq: state.headSeq,
      oldestSeq: state.networkBeforeSeq,
      hasOlder: state.hasOlder || !state.localExhausted,
      loaded: state.tailVisible,
      loading: inflightByChannel.has(channelId),
      buffered: state.reservoir.size,
      bufferedNewest: Math.max(0, ...state.reservoir.keys()),
      revealVersion: state.revealVersion,
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

  return { attach, setLocalMeta, historyRow, pageEnd, take, focus: setFocus, observeLive, disconnected, clear, destroy, snapshot, tick: schedule };
}
