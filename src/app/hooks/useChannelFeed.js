import { useCallback, useEffect, useRef, useState } from 'react';
import { createCursors } from '../../model/cursors.js';
import { createFeedCache, resumeSnapshot } from '../../model/feed-cache.js';
import { apply, createChannelState, reconcileApprovals } from '../../model/fold.js';
import { invalidatesChannelDirectory } from '../../model/directory-invalidation.js';
import { createHistoryScheduler, HISTORY_RESERVOIR_SIZE } from '../../model/history-scheduler.js';
import { diagnostic } from '../../model/diagnostics.js';

export { HISTORY_RESERVOIR_SIZE };

export function useChannelFeed({ wireRef, rosterRef, accessRef, activeChannelRef, onRoster, onError, onChannelsDiscovered, onDirectoryInvalidated, onTimerFired, onSubmissionFeed, onAccessChanged }) {
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const cursorsRef = useRef(createCursors());
  const cacheRef = useRef(null);
  if (cacheRef.current === null) cacheRef.current = createFeedCache();
  const statesRef = useRef(new Map());
  const attachQueueRef = useRef(new Map());
  const applyRowsRef = useRef(null);
  const schedulerRef = useRef(null);

  const applyRows = useCallback((rows, { publish = true } = {}) => {
    if (!rows?.length) return 0;
    let rosterChanged = false;
    let changed = 0;
    const unseenChannels = new Set();
    const dirtyChannels = new Set();
    const landedMessageIds = new Set();
    const closedRequestIds = new Set();
    for (const row of rows) {
      const channelId = row.channel_id;
      const seq = Number(row.seq);
      if (!channelId || !Number.isSafeInteger(seq)) continue;
      let state = statesRef.current.get(channelId);
      if (!state) {
        state = createChannelState(channelId);
        statesRef.current.set(channelId, state);
      }
      if (state.rows.has(seq)) continue;
      const roster = rosterRef.current;
      const selfId = roster?.self(channelId) || '';
      apply(state, row, selfId);
      changed += 1;
      accessRef.current?.feed(channelId);
      dirtyChannels.add(channelId);
      cursorsRef.current.advance(channelId, seq);
      if (activeChannelRef.current === channelId) cursorsRef.current.markRead(channelId, seq);
      const learnedSelf = roster?.observeFeed(channelId, row.envelope);
      if (learnedSelf) {
        reconcileApprovals(state, learnedSelf);
        accessRef.current?.self(channelId, learnedSelf);
        rosterChanged = true;
      }
      roster?.handleEnvelope(channelId, row.envelope, (rosterRows, error) => {
        if (rosterRows) onRoster(channelId, rosterRows);
        if (error) onError(error);
      });
      if (invalidatesChannelDirectory(row.envelope)) onDirectoryInvalidated(row.envelope);
      unseenChannels.add(channelId);
      if (row.envelope?.id) {
        landedMessageIds.add(row.envelope.id);
        onTimerFired(row.envelope.id, row.envelope.ts || Date.now());
      }
      if (row.envelope?.kind === 'response' && ['completed', 'failed'].includes(row.envelope?.payload?.status) && row.envelope?.parent_id) {
        closedRequestIds.add(`${channelId}:${row.envelope.parent_id}:cancel`);
      }
    }
    if (!changed) return 0;
    onChannelsDiscovered(unseenChannels);
    onSubmissionFeed(landedMessageIds, closedRequestIds);
    onAccessChanged();
    for (const channelId of dirtyChannels) {
      cacheRef.current.save(statesRef.current.get(channelId)).catch((error) => {
        diagnostic('error', 'feed.cache_save_failed', { channelId, error });
        onError(error);
      });
    }
    if (publish) setVersion((value) => value + 1 + Number(rosterChanged));
    return changed;
  }, [accessRef, activeChannelRef, onAccessChanged, onChannelsDiscovered, onDirectoryInvalidated, onError, onRoster, onSubmissionFeed, onTimerFired, rosterRef]);
  applyRowsRef.current = applyRows;

  if (schedulerRef.current === null) {
    schedulerRef.current = createHistoryScheduler({
      requestPage: (channelId, beforeSeq, limit) => {
        const wire = wireRef.current;
        if (!wire) return Promise.reject(new Error('消息连接尚未就绪'));
        return wire.historyBefore(channelId, beforeSeq, limit);
      },
      hasVisibleRow: (channelId, seq) => statesRef.current.get(channelId)?.rows.has(seq) === true,
      revealRows: (channelId, entries) => applyRowsRef.current?.(entries.map(([seq, envelope]) => ({ channel_id: channelId, seq, envelope }))),
      onChange: () => setVersion((value) => value + 1),
      onError,
    });
  }

  const enqueue = useCallback((channelId, seq, envelope) => {
    const numericSeq = Number(seq);
    const kind = schedulerRef.current.classifyRow(channelId, numericSeq, envelope);
    if (kind === 'history') return;
    if (kind === 'attach') {
      attachQueueRef.current.set(`${channelId}:${numericSeq}`, { channel_id: channelId, seq: numericSeq, envelope });
      return;
    }
    applyRowsRef.current?.([{ channel_id: channelId, seq: numericSeq, envelope }]);
  }, []);

  const flush = useCallback((channelId = '') => {
    const rows = [];
    for (const [key, row] of attachQueueRef.current) {
      if (channelId && row.channel_id !== channelId) continue;
      rows.push(row);
      attachQueueRef.current.delete(key);
    }
    rows.sort((left, right) => left.channel_id.localeCompare(right.channel_id) || left.seq - right.seq);
    return applyRowsRef.current?.(rows) || 0;
  }, []);

  const setHistoryGrants = useCallback((grants = [], detail = {}) => {
    schedulerRef.current.attach(grants, {
      attachRef: detail.attach_ref || '',
      generation: detail.generation,
      focus: detail.focus || activeChannelRef.current || '',
    });
  }, [activeChannelRef]);

  const pageEnd = useCallback((payload) => {
    const accepted = schedulerRef.current.pageEnd(payload);
    if (accepted && payload?.source === 'attach') flush(payload.channel_id);
    if (!accepted) diagnostic('warn', 'feed.page_end_ignored', {
      channelId: payload?.channel_id, source: payload?.source, ref: payload?.ref, generation: payload?.generation,
    });
    return accepted;
  }, [flush]);

  const focusHistory = useCallback((channelId) => schedulerRef.current.focus(channelId), []);
  const disconnectHistory = useCallback((generation) => {
    diagnostic('info', 'feed.connection_reset', { generation, queuedAttachRows: attachQueueRef.current.size });
    attachQueueRef.current.clear();
    schedulerRef.current.disconnected(generation);
  }, []);
  const revealHistory = useCallback((channelId, count) => schedulerRef.current.take(channelId, count), []);
  const historyFor = useCallback((channelId) => schedulerRef.current.snapshot(channelId), []);
  const bump = useCallback(() => setVersion((value) => value + 1), []);
  const cancel = useCallback(() => {}, []);
  const clear = useCallback(() => {
    attachQueueRef.current.clear();
    schedulerRef.current.clear();
    statesRef.current = new Map();
    setVersion((value) => value + 1);
  }, []);

  const resetPersistent = useCallback(async () => {
    await cacheRef.current.clear();
    statesRef.current = new Map();
    cursorsRef.current.reconcile({});
    setVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    let alive = true;
    cacheRef.current.restore().then((restored) => {
      if (!alive) return;
      statesRef.current = restored;
      cursorsRef.current.reconcile(resumeSnapshot(restored));
      setReady(true);
      diagnostic('info', 'feed.ready', { channels: restored.size, cursors: Object.keys(resumeSnapshot(restored)).length });
      setVersion((value) => value + 1);
    }).catch((error) => {
      if (!alive) return;
      onError(error);
      diagnostic('error', 'feed.restore_failed', { error });
      setReady(true);
    });
    return () => {
      alive = false;
      schedulerRef.current.destroy();
    };
  }, []);
  return {
    statesRef, cursorsRef, version, ready, bump, enqueue, flush, cancel, clear, resetPersistent,
    setHistoryGrants, pageEnd, disconnectHistory, focusHistory, historyFor, revealHistory,
  };
}
