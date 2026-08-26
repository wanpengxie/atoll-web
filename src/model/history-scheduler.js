import { diagnostic } from './diagnostics.js';

export const HISTORY_PAGE_SIZE = 200;
export const HISTORY_RESERVOIR_SIZE = 5_000;

const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 30_000;

function numeric(value) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : 0;
}

function channelState(id, previous = {}) {
  return {
    id,
    headSeq: 0,
    oldestSeq: 0,
    hasOlder: false,
    attaching: false,
    attachRef: '',
    error: '',
    retryAt: 0,
    retryCount: 0,
    needsTail: false,
    reservoir: new Map(),
    order: 0,
    ...previous,
  };
}

export function createHistoryScheduler({
  requestPage,
  revealRows,
  hasVisibleRow = () => false,
  onChange = () => {},
  onError = () => {},
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
  now = () => Date.now(),
} = {}) {
  const channels = new Map();
  let focus = '';
  let generation = 0;
  let inflight = null;
  let wakeTimer = null;
  let wakeAt = 0;
  let order = 0;

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
      tick();
    }, Math.max(1, at - now()));
  }

  function retry(state, detail) {
    state.error = detail || '历史加载失败';
    state.retryCount += 1;
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(state.retryCount - 1, 6));
    state.retryAt = now() + delay;
    diagnostic('warn', 'history.retry_scheduled', {
      channelId: state.id,
      generation,
      retryCount: state.retryCount,
      delay,
      detail: state.error,
    });
    scheduleWake(state.retryAt);
    publish();
  }

  function eligible(state, at) {
    if (!state || state.attaching || state.reservoir.size >= HISTORY_RESERVOIR_SIZE) return false;
    if (state.retryAt > at) return false;
    return state.needsTail || (state.hasOlder && state.oldestSeq > 0);
  }

  function choose() {
    const at = now();
    const focused = channels.get(focus);
    if (eligible(focused, at)) return focused;
    const candidates = [...channels.values()].filter((state) => eligible(state, at));
    candidates.sort((left, right) => left.order - right.order);
    return candidates[0] || null;
  }

  function tick() {
    if (inflight) return;
    const state = choose();
    if (!state) {
      const nextRetry = Math.min(...[...channels.values()].map((item) => item.retryAt).filter((value) => value > now()));
      if (Number.isFinite(nextRetry)) scheduleWake(nextRetry);
      return;
    }
    const beforeSeq = state.needsTail ? 0 : state.oldestSeq;
    const limit = state.needsTail
      ? HISTORY_PAGE_SIZE
      : Math.min(HISTORY_PAGE_SIZE, HISTORY_RESERVOIR_SIZE - state.reservoir.size);
    let request;
    try {
      request = requestPage?.(state.id, beforeSeq, limit);
    } catch (error) {
      retry(state, error?.message);
      return;
    }
    const ref = request?.ref || '';
    inflight = { generation, ref, channelId: state.id, beforeSeq, limit, tail: state.needsTail };
    diagnostic('info', 'history.page_requested', {
      channelId: state.id, generation, ref, beforeSeq, limit,
      reservoir: state.reservoir.size, tail: state.needsTail,
    });
    Promise.resolve(request).then((receipt) => {
      if (!receipt?.accepted) throw new Error('历史请求未被接受');
      diagnostic('debug', 'history.page_accepted', { channelId: state.id, generation, ref });
    }).catch((error) => {
      if (!inflight || inflight.generation !== generation || inflight.ref !== ref) return;
      inflight = null;
      retry(state, error?.message);
      tick();
    });
  }

  function attach(grants = [], detail = {}) {
    const nextGeneration = numeric(detail.generation);
    if (nextGeneration && nextGeneration < generation) {
      diagnostic('warn', 'history.stale_attach_ignored', { currentGeneration: generation, receivedGeneration: nextGeneration });
      return false;
    }
    generation = nextGeneration || generation;
    focus = detail.focus || focus;
    inflight = null;
    clearWake();
    const seen = new Set();
    for (const grant of grants || []) {
      const id = grant?.channel_id;
      if (!id) continue;
      seen.add(id);
      const previous = channels.get(id);
      const state = channelState(id, previous);
      state.headSeq = numeric(grant.head_seq) || state.headSeq;
      state.oldestSeq = numeric(grant.oldest_seq);
      state.hasOlder = Boolean(grant.has_older);
      state.attachRef = detail.attachRef || '';
      state.order = order += 1;
      state.error = grant.error_detail || '';
      state.needsTail = Boolean(grant.error_code);
      state.attaching = !grant.error_code;
      state.retryAt = grant.error_code ? now() + RETRY_BASE_MS : 0;
      state.retryCount = grant.error_code ? 1 : 0;
      channels.set(id, state);
      if (state.retryAt) scheduleWake(state.retryAt);
    }
    // A v3 attach enumerates every currently eligible member channel. Keep any
    // already fetched rows for UI continuity, but retired channels must never
    // remain eligible for background reads merely because an older connection
    // knew about them.
    for (const [id, state] of channels) {
      if (seen.has(id)) continue;
      state.attaching = false;
      state.needsTail = false;
      state.hasOlder = false;
      state.retryAt = 0;
    }
    diagnostic('info', 'history.attach_grants', {
      generation, focus, channels: seen.size,
      failedChannels: [...channels.values()].filter((state) => state.needsTail).map((state) => state.id),
    });
    publish();
    tick();
    return true;
  }

  function classifyRow(channelId, seq, envelope) {
    const state = channels.get(channelId);
    const value = numeric(seq);
    if (inflight && inflight.generation === generation && inflight.channelId === channelId
      && (inflight.beforeSeq === 0 || value < inflight.beforeSeq)) {
      if (value > 0 && !hasVisibleRow(channelId, value)) state?.reservoir.set(value, envelope);
      return 'history';
    }
    if (state?.attaching && value <= state.headSeq) return 'attach';
    return 'live';
  }

  function pageEnd(payload = {}) {
    const state = channels.get(payload.channel_id);
    if (!state) return false;
    if (payload.source === 'attach') {
      if (payload.ref !== state.attachRef || numeric(payload.generation) !== generation) {
        diagnostic('warn', 'history.stale_attach_page_end', {
          channelId: payload.channel_id, ref: payload.ref, expectedRef: state.attachRef,
          receivedGeneration: payload.generation, generation,
        });
        return false;
      }
      state.attaching = false;
      state.headSeq = numeric(payload.head_seq) || state.headSeq;
      state.oldestSeq = numeric(payload.oldest_seq) || state.oldestSeq;
      state.hasOlder = Boolean(payload.has_older);
      state.error = '';
      state.needsTail = false;
      state.order = order += 1;
      diagnostic('info', 'history.attach_complete', {
        channelId: state.id, generation, oldestSeq: state.oldestSeq,
        headSeq: state.headSeq, hasOlder: state.hasOlder,
      });
      publish();
      tick();
      return true;
    }
    if (!inflight || payload.ref !== inflight.ref || numeric(payload.generation) !== inflight.generation || payload.channel_id !== inflight.channelId) {
      diagnostic('warn', 'history.unmatched_page_end', {
        channelId: payload.channel_id, ref: payload.ref, receivedGeneration: payload.generation,
        inflight: inflight ? { channelId: inflight.channelId, ref: inflight.ref, generation: inflight.generation } : null,
      });
      return false;
    }
    const completed = inflight;
    inflight = null;
    if (payload.error_code) {
      retry(state, payload.error_detail || payload.error_code);
      onError(new Error(payload.error_detail || payload.error_code));
      tick();
      return true;
    }
    const previous = state.oldestSeq;
    const next = numeric(payload.oldest_seq);
    state.headSeq = Math.max(state.headSeq, numeric(payload.head_seq));
    state.oldestSeq = next || previous;
    state.hasOlder = Boolean(payload.has_older);
    state.needsTail = false;
    state.error = '';
    state.retryAt = 0;
    state.retryCount = 0;
    state.order = order += 1;
    if (completed.beforeSeq > 0 && !(next > 0 && next < previous)) state.hasOlder = false;
    if (completed.tail) {
      const newest = numeric(payload.newest_seq);
      const selected = [...state.reservoir.entries()]
        .filter(([seq]) => (!next || seq >= next) && (!newest || seq <= newest))
        .sort(([left], [right]) => left - right);
      for (const [seq] of selected) state.reservoir.delete(seq);
      if (selected.length) revealRows(state.id, selected);
    }
    diagnostic('info', 'history.page_complete', {
      channelId: state.id, generation, ref: completed.ref,
      beforeSeq: completed.beforeSeq, oldestSeq: state.oldestSeq,
      hasOlder: state.hasOlder, reservoir: state.reservoir.size,
    });
    publish();
    tick();
    return true;
  }

  function take(channelId, count) {
    const state = channels.get(channelId);
    if (!state || !Number.isFinite(count) || count <= 0 || !state.reservoir.size) return 0;
    const selected = [...state.reservoir.entries()].sort(([left], [right]) => right - left).slice(0, count);
    for (const [seq] of selected) state.reservoir.delete(seq);
    selected.sort(([left], [right]) => left - right);
    revealRows(channelId, selected);
    state.order = order += 1;
    publish();
    diagnostic('debug', 'history.rows_revealed', { channelId, count: selected.length, reservoir: state.reservoir.size });
    tick();
    return selected.length;
  }

  function setFocus(channelId) {
    focus = channelId || '';
    const state = channels.get(focus);
    if (state) {
      state.order = 0;
      if (state.error && state.retryAt > now()) {
        state.retryAt = now();
      }
    }
    publish();
    tick();
  }

  function disconnected(nextGeneration = generation + 1) {
    generation = Math.max(generation + 1, numeric(nextGeneration));
    inflight = null;
    clearWake();
    for (const state of channels.values()) state.attaching = false;
    diagnostic('info', 'history.disconnected', { generation, channels: channels.size });
    publish();
  }

  function clear() {
    destroy();
    clearWake();
    channels.clear();
    inflight = null;
    focus = '';
    publish();
  }

  function destroy() {
    clearWake();
    inflight = null;
  }

  function snapshot(channelId) {
    const state = channels.get(channelId);
    if (!state) return { headSeq: 0, oldestSeq: 0, hasOlder: false, attaching: false, loaded: false, loading: false, buffered: 0, bufferedNewest: 0, error: '' };
    return {
      headSeq: state.headSeq,
      oldestSeq: state.oldestSeq,
      hasOlder: state.hasOlder,
      attaching: state.attaching,
      loaded: !state.attaching && !state.needsTail,
      loading: inflight?.channelId === channelId,
      buffered: state.reservoir.size,
      bufferedNewest: Math.max(0, ...state.reservoir.keys()),
      error: state.error,
    };
  }

  return { attach, classifyRow, pageEnd, take, focus: setFocus, disconnected, clear, destroy, snapshot, tick };
}
