import { useCallback, useEffect, useRef, useState } from 'react';
import { createCursors } from '../../model/cursors.js';
import { createFeedCache, resumeSnapshot } from '../../model/feed-cache.js';
import { apply, createChannelState, reconcileApprovals } from '../../model/fold.js';
import { invalidatesChannelDirectory } from '../../model/directory-invalidation.js';

const BATCH_SIZE = 250;
const HISTORY_PAGE_SIZE = 200;
export const HISTORY_RESERVOIR_SIZE = 5_000;

export function useChannelFeed({ wireRef, rosterRef, accessRef, activeChannelRef, onRoster, onError, onChannelsDiscovered, onDirectoryInvalidated, onTimerFired, onSubmissionFeed, onAccessChanged }) {
  const [version, setVersion] = useState(0);
  const cursorsRef = useRef(createCursors());
  const cacheRef = useRef(null);
  if (cacheRef.current === null) cacheRef.current = createFeedCache();
  const statesRef = useRef(null);
  if (statesRef.current === null) {
    statesRef.current = cacheRef.current.restore();
    cursorsRef.current.reconcile(resumeSnapshot(statesRef.current));
  }
  const queueRef = useRef([]);
  const queuedRowsRef = useRef(new Set());
  const dirtyRef = useRef(new Set());
  const taskRef = useRef(null);
  const historyRef = useRef(new Map());
  const historyInFlightRef = useRef(new Map());
  // History transport and visible timeline state are deliberately separate.
  // A background page is captured here first; it cannot affect layout until
  // Timeline explicitly releases rows from the reservoir.
  const historyCaptureRef = useRef(new Map());
  const historyReservoirRef = useRef(new Map());
  const historySchedulersRef = useRef(new Map());
  const historyRunnerRef = useRef(null);

  const cancel = useCallback(() => {
    if (taskRef.current == null) return;
    if ('cancelIdleCallback' in window) window.cancelIdleCallback(taskRef.current);
    else clearTimeout(taskRef.current);
    taskRef.current = null;
  }, []);

  const process = useCallback(() => {
    taskRef.current = null;
    const batch = queueRef.current.splice(0, BATCH_SIZE);
    if (!batch.length) return;
    let rosterChanged = false;
    const unseenChannels = new Set();
    const landedMessageIds = new Set();
    const closedRequestIds = new Set();
    for (const row of batch) {
      queuedRowsRef.current.delete(`${row.channel_id}:${row.seq}`);
      let state = statesRef.current.get(row.channel_id);
      if (!state) {
        state = createChannelState(row.channel_id);
        statesRef.current.set(row.channel_id, state);
      }
      const roster = rosterRef.current;
      const selfId = roster?.self(row.channel_id) || '';
      if (!state.rows.has(row.seq)) apply(state, row, selfId);
      accessRef.current?.feed(row.channel_id);
      dirtyRef.current.add(row.channel_id);
      cursorsRef.current.advance(row.channel_id, row.seq);
      if (activeChannelRef.current === row.channel_id) cursorsRef.current.markRead(row.channel_id, row.seq);
      const learnedSelf = roster?.observeFeed(row.channel_id, row.envelope);
      if (learnedSelf) {
        reconcileApprovals(state, learnedSelf);
        accessRef.current?.self(row.channel_id, learnedSelf);
        rosterChanged = true;
      }
      roster?.handleEnvelope(row.channel_id, row.envelope, (rows, error) => {
        if (rows) onRoster(row.channel_id, rows);
        if (error) onError(error);
      });
      if (invalidatesChannelDirectory(row.envelope)) onDirectoryInvalidated(row.envelope);
      unseenChannels.add(row.channel_id);
      if (row.envelope?.id) {
        landedMessageIds.add(row.envelope.id);
        onTimerFired(row.envelope.id, row.envelope.ts || Date.now());
      }
      if (row.envelope?.kind === 'response' && ['completed', 'failed'].includes(row.envelope?.payload?.status) && row.envelope?.parent_id) closedRequestIds.add(`${row.channel_id}:${row.envelope.parent_id}:cancel`);
    }
    onChannelsDiscovered(unseenChannels);
    onSubmissionFeed(landedMessageIds, closedRequestIds);
    onAccessChanged();
    setVersion((value) => value + 1 + Number(rosterChanged));
    if (queueRef.current.length) {
      const run = () => process();
      taskRef.current = 'requestIdleCallback' in window ? window.requestIdleCallback(run, { timeout: 100 }) : setTimeout(run, 0);
    } else {
      for (const channelId of dirtyRef.current) cacheRef.current.save(statesRef.current.get(channelId));
      dirtyRef.current.clear();
    }
  }, [accessRef, activeChannelRef, onAccessChanged, onChannelsDiscovered, onDirectoryInvalidated, onError, onRoster, onSubmissionFeed, onTimerFired, rosterRef]);

  const enqueueVisible = useCallback((channelId, seq, envelope) => {
    const key = `${channelId}:${seq}`;
    if (statesRef.current.get(channelId)?.rows?.has(seq) || queuedRowsRef.current.has(key)) return;
    queuedRowsRef.current.add(key);
    queueRef.current.push({ channel_id: channelId, seq, envelope });
    if (taskRef.current != null) return;
    const run = () => process();
    taskRef.current = 'requestIdleCallback' in window ? window.requestIdleCallback(run, { timeout: 100 }) : setTimeout(run, 0);
  }, [process]);
  const enqueue = useCallback((channelId, seq, envelope) => {
    const numericSeq = Number(seq);
    const capture = historyCaptureRef.current.get(channelId);
    // history_before is exclusive. Live rows remain >= beforeSeq and therefore
    // bypass capture even when they interleave with a history response.
    if (capture && numericSeq < capture.beforeSeq) {
      if (!statesRef.current.get(channelId)?.rows?.has(numericSeq)) capture.rows.set(numericSeq, envelope);
      return;
    }
    enqueueVisible(channelId, numericSeq, envelope);
  }, [enqueueVisible]);

  const flush = useCallback(() => {
    while (queueRef.current.length) {
      cancel();
      process();
    }
    cancel();
  }, [cancel, process]);
  const setHistoryGrants = useCallback((grants = []) => {
    let changed = false;
    for (const grant of grants || []) {
      const channelId = grant?.channel_id;
      if (!channelId) continue;
      const existing = historyRef.current.get(channelId) || {};
      let channelState = statesRef.current.get(channelId);
      const truncated = Boolean(grant.truncated);
      const tailFloor = Number(grant.oldest_seq) || 0;
      if (truncated && channelState) {
        // Do not present two disconnected islands as one continuous timeline.
        // The old prefix remains recoverable from the server; rebuild the
        // in-memory/cache state from any rows that already belong to the tail.
        const rebuilt = createChannelState(channelId);
        const selfId = rosterRef.current?.self(channelId) || '';
        for (const [seq, envelope] of [...channelState.rows].sort(([left], [right]) => left - right)) {
          if (seq >= tailFloor) apply(rebuilt, { channel_id: channelId, seq, envelope }, selfId);
        }
        statesRef.current.set(channelId, rebuilt);
        cacheRef.current.save(rebuilt);
        channelState = rebuilt;
      }
      const cachedSeqs = [...(channelState?.rows?.keys?.() || [])];
      const cachedOldest = cachedSeqs.length ? Math.min(...cachedSeqs) : 0;
      historyRef.current.set(channelId, {
        ...existing,
        headSeq: Number(grant.head_seq) || existing.headSeq || 0,
        // A truncated attach creates a real gap between an old local prefix and
        // the bounded live tail. Pagination must continue from the tail floor,
        // not from the minimum cached seq on the far side of that gap.
        oldestSeq: truncated ? Number(grant.oldest_seq) || 0 : cachedOldest || Number(grant.oldest_seq) || existing.oldestSeq || 0,
        hasOlder: Boolean(grant.has_older),
        truncated,
        loaded: true,
      });
      changed = true;
    }
    if (changed) setVersion((value) => value + 1);
  }, [rosterRef]);
  const loadHistory = useCallback((channelId, { beforeSeq = 0, limit = HISTORY_PAGE_SIZE, silent = false } = {}) => {
    if (!channelId) return Promise.resolve(null);
    const key = `${channelId}:${beforeSeq || 'tail'}`;
    if (historyInFlightRef.current.has(key)) return historyInFlightRef.current.get(key);
    const existing = historyRef.current.get(channelId) || {};
    if (!silent) {
      historyRef.current.set(channelId, { ...existing, loading: true, error: '' });
      setVersion((value) => value + 1);
    }
    const capture = { beforeSeq: Number(beforeSeq) || Number.MAX_SAFE_INTEGER, rows: new Map() };
    historyCaptureRef.current.set(channelId, capture);
    const request = wireRef.current?.historyBefore(channelId, beforeSeq, limit)
      ?? Promise.reject(new Error('消息连接尚未就绪'));
    const settled = request
      .then((page) => {
        const current = historyRef.current.get(channelId) || {};
        const pageOldest = Number(page.oldest_seq) || 0;
        const knownOldest = Number(current.oldestSeq) || 0;
        historyRef.current.set(channelId, {
          ...current,
          headSeq: Math.max(Number(current.headSeq) || 0, Number(page.head_seq) || 0),
          oldestSeq: pageOldest && knownOldest ? Math.min(pageOldest, knownOldest) : pageOldest || knownOldest,
          hasOlder: Boolean(page.has_older),
          truncated: false,
          loading: silent ? Boolean(current.loading) : false,
          loaded: true,
          error: '',
        });
        const reservoir = historyReservoirRef.current.get(channelId) || new Map();
        for (const [seq, envelope] of capture.rows) {
          if (!statesRef.current.get(channelId)?.rows?.has(seq)) reservoir.set(seq, envelope);
        }
        // Kept for adapters/tests that return rows in the receipt instead of
        // streaming feed frames before it.
        for (const row of page.rows || []) {
          const seq = Number(row.seq);
          if (!statesRef.current.get(channelId)?.rows?.has(seq)) reservoir.set(seq, row.envelope);
        }
        historyReservoirRef.current.set(channelId, reservoir);
        if (!silent) setVersion((value) => value + 1);
        return page;
      })
      .catch((error) => {
        if (!silent) {
          const current = historyRef.current.get(channelId) || {};
          historyRef.current.set(channelId, { ...current, loading: false, error: error.message || '历史加载失败' });
          setVersion((value) => value + 1);
          onError(error);
        }
        throw error;
      })
      .finally(() => {
        if (historyCaptureRef.current.get(channelId) === capture) historyCaptureRef.current.delete(channelId);
        historyInFlightRef.current.delete(key);
      });
    historyInFlightRef.current.set(key, settled);
    return settled;
  }, [onError, wireRef]);

  const scheduleHistory = useCallback((channelId, delay = 0) => {
    const job = historySchedulersRef.current.get(channelId);
    if (!job?.active || job.running || job.timer != null) return;
    job.timer = window.setTimeout(() => {
      job.timer = null;
      historyRunnerRef.current?.(channelId);
    }, delay);
  }, []);

  const runHistoryScheduler = useCallback(async (channelId) => {
    const job = historySchedulersRef.current.get(channelId);
    const buffered = historyReservoirRef.current.get(channelId)?.size || 0;
    if (!job?.active || job.running || buffered >= job.target) return;
    const history = historyRef.current.get(channelId) || {};
    const beforeSeq = Number(history.oldestSeq) || 0;
    if (!history.loaded || !history.hasOlder || beforeSeq <= 0) return;
    const generation = job.generation;
    job.running = true;
    let retryDelay = -1;
    try {
      const page = await loadHistory(channelId, { beforeSeq, limit: HISTORY_PAGE_SIZE, silent: true });
      const current = historySchedulersRef.current.get(channelId);
      if (!current?.active || current.generation !== generation) return;
      const nextOldest = Number(page?.oldest_seq) || 0;
      if (!(nextOldest > 0 && nextOldest < beforeSeq)) current.active = false; // A non-advancing cursor must never spin.
    } catch {
      retryDelay = 2_000;
    } finally {
      const current = historySchedulersRef.current.get(channelId);
      if (current) {
        current.running = false;
        if (current.active && current.generation !== generation) scheduleHistory(channelId);
      }
    }
    const current = historySchedulersRef.current.get(channelId);
    if (!current?.active || current.generation !== generation) return;
    if (retryDelay >= 0) scheduleHistory(channelId, retryDelay);
    else if ((historyReservoirRef.current.get(channelId)?.size || 0) < current.target && historyRef.current.get(channelId)?.hasOlder) scheduleHistory(channelId);
  }, [loadHistory, scheduleHistory]);
  historyRunnerRef.current = runHistoryScheduler;

  const maintainHistory = useCallback((channelId, target = HISTORY_RESERVOIR_SIZE) => {
    if (!channelId) return;
    let job = historySchedulersRef.current.get(channelId);
    if (!job) {
      job = { active: true, generation: 0, target, running: false, timer: null };
      historySchedulersRef.current.set(channelId, job);
    } else {
      job.active = true;
      job.target = Math.max(job.target, target);
    }
    scheduleHistory(channelId);
  }, [scheduleHistory]);

  const revealHistory = useCallback((channelId, count) => {
    if (!Number.isFinite(count) || count <= 0) return 0;
    const reservoir = historyReservoirRef.current.get(channelId);
    if (!reservoir?.size) return 0;
    const selected = [...reservoir.entries()].sort(([a], [b]) => b - a).slice(0, count);
    for (const [seq] of selected) reservoir.delete(seq);
    selected.sort(([a], [b]) => a - b).forEach(([seq, envelope]) => enqueueVisible(channelId, seq, envelope));
    scheduleHistory(channelId);
    return selected.length;
  }, [enqueueVisible, scheduleHistory]);

  const pauseHistory = useCallback((channelId) => {
    const job = historySchedulersRef.current.get(channelId);
    if (!job) return;
    job.active = false;
    job.generation += 1;
    if (job.timer != null) window.clearTimeout(job.timer);
    job.timer = null;
  }, []);

  const clearHistorySchedulers = useCallback(() => {
    for (const job of historySchedulersRef.current.values()) {
      job.active = false;
      job.generation += 1;
      if (job.timer != null) window.clearTimeout(job.timer);
    }
    historySchedulersRef.current.clear();
  }, []);
  const historyFor = useCallback((channelId) => ({
    ...(historyRef.current.get(channelId) || { headSeq: 0, oldestSeq: 0, hasOlder: false, loading: false, loaded: false, error: '' }),
    buffered: historyReservoirRef.current.get(channelId)?.size || 0,
  }), []);
  const bump = useCallback(() => setVersion((value) => value + 1), []);
  const clear = useCallback(() => {
    cancel();
    clearHistorySchedulers();
    statesRef.current = new Map();
    queueRef.current = [];
    queuedRowsRef.current.clear();
    dirtyRef.current.clear();
    historyRef.current.clear();
    historyCaptureRef.current.clear();
    historyReservoirRef.current.clear();
    setVersion((value) => value + 1);
  }, [cancel, clearHistorySchedulers]);
  useEffect(() => () => {
    cancel();
    clearHistorySchedulers();
  }, [cancel, clearHistorySchedulers]);
  return { statesRef, cursorsRef, version, bump, enqueue, flush, cancel, clear, setHistoryGrants, loadHistory, historyFor, maintainHistory, revealHistory, pauseHistory };
}
