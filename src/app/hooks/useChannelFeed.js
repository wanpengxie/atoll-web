import { useCallback, useEffect, useRef, useState } from 'react';
import { createCursors } from '../../model/cursors.js';
import { createFeedCache, resumeSnapshot } from '../../model/feed-cache.js';
import { apply, createChannelState, reconcileApprovals } from '../../model/fold.js';
import { invalidatesChannelDirectory } from '../../model/directory-invalidation.js';
import { createHistoryScheduler, HISTORY_RESERVOIR_SIZE } from '../../model/history-scheduler.js';
import { diagnostic } from '../../model/diagnostics.js';
import { loadUntilVisible } from '../../model/history-interaction.js';
import { projectTimeline } from '../../model/timeline-projection.js';
import { turnStartObservation } from '../../model/turn-process.js';

export { HISTORY_RESERVOIR_SIZE };

export function useChannelFeed({ wireRef, rosterRef, accessRef, activeChannelRef, onRoster, onError, onChannelsDiscovered, onDirectoryInvalidated, onTimerFired, onSubmissionFeed, onAccessChanged, onAgentActivity }) {
  const [version, setVersion] = useState(0);
  const [ready, setReady] = useState(false);
  const cursorsRef = useRef(createCursors());
  const cacheRef = useRef(null);
  if (cacheRef.current === null) cacheRef.current = createFeedCache();
  const cacheMetaRef = useRef(new Map());
  const statesRef = useRef(new Map());
  const applyRowsRef = useRef(null);
  const schedulerRef = useRef(null);
  const lifecycleRef = useRef(0);

  const applyRows = useCallback((rows, { publish = true, persist = true } = {}) => {
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
    if (persist) cacheRef.current.saveRows(rows).catch((error) => {
      diagnostic('error', 'feed.cache_save_failed', { channels: [...dirtyChannels], error });
      onError(error);
    });
    if (publish) setVersion((value) => value + 1 + Number(rosterChanged));
    return changed;
  }, [accessRef, activeChannelRef, onAccessChanged, onChannelsDiscovered, onDirectoryInvalidated, onError, onRoster, onSubmissionFeed, onTimerFired, rosterRef]);
  applyRowsRef.current = applyRows;

  if (schedulerRef.current === null) {
    schedulerRef.current = createHistoryScheduler({
      requestPage: (channelId, beforeSeq, limit, options) => {
        const wire = wireRef.current;
        if (!wire) return Promise.reject(new Error('消息连接尚未就绪'));
		return wire.historyBefore(channelId, beforeSeq, limit, options);
      },
	  cancelPage: (channelId, ref, generation) => {
		const wire = wireRef.current;
		if (!wire) return Promise.resolve();
		return wire.cancelHistory(channelId, ref, generation);
	  },
	  readCache: (channelId, beforeSeq, limit, byteLimit) => cacheRef.current.readBefore(channelId, beforeSeq, limit, byteLimit),
	  persistRows: (rows, options) => cacheRef.current.saveRows(rows, options),
      hasVisibleRow: (channelId, seq) => statesRef.current.get(channelId)?.rows.has(seq) === true,
	  revealRows: (channelId, entries) => applyRowsRef.current?.(
		entries.map(([seq, envelope]) => ({ channel_id: channelId, seq, envelope })),
		{ persist: false },
	  ),
      onChange: () => setVersion((value) => value + 1),
      onError,
    });
  }

  const enqueue = useCallback((payloadOrChannel, seq, envelope, detail) => {
	const payload = typeof payloadOrChannel === 'object'
	  ? payloadOrChannel
	  : detail || { channel_id: payloadOrChannel, seq, envelope, source: 'live' };
	const historical = schedulerRef.current.historyRow(payload);
	if (historical) {
	  onAgentActivity?.(payload);
	  return;
	}
	// Live rows never enter the historical executor or reservoir.
	applyRowsRef.current?.([{ channel_id: payload.channel_id, seq: Number(payload.seq), envelope: payload.envelope }]);
	const turn = statesRef.current.get(payload.channel_id)?.turns?.get(payload.envelope?.parent_id);
	const startedAt = turnStartObservation(turn)?.envelope?.ts || turn?.request?.ts;
	onAgentActivity?.(payload, { startedAt });
	schedulerRef.current.observeLive(payload.channel_id, payload.envelope?.ts);
	}, [onAgentActivity]);

  const setHistoryGrants = useCallback((grants = [], detail = {}) => {
    const generation = detail.generation;
    // Live WS delivery is already active. Only historical scheduling waits for
    // this metadata-only IndexedDB generation check, never message bodies.
    void cacheRef.current.ensureBoot(detail.boot).then(({ changed, meta }) => {
      cacheMetaRef.current = meta;
      if (changed) {
        cursorsRef.current.reconcile({});
        cursorsRef.current.resetReads();
      }
      // The attach head is the exact historical/live seam. A browser without
      // a read fact starts observing after that snapshot; body hydration at or
      // below the head can never manufacture unread notifications.
      for (const entry of grants) {
        if (entry?.channel_id) cursorsRef.current.baselineRead(entry.channel_id, entry.head_seq);
      }
      schedulerRef.current.attach(grants, {
        generation,
        focus: detail.focus || activeChannelRef.current || '',
		localMeta: meta,
      });
    }).catch((error) => {
      diagnostic('error', 'feed.cache_boot_check_failed', { generation, error });
      onError(error);
      schedulerRef.current.attach(grants, {
        generation,
        focus: detail.focus || activeChannelRef.current || '',
		localMeta: new Map(),
      });
    });
  }, [activeChannelRef]);

  const pageEnd = useCallback((payload) => {
    const accepted = schedulerRef.current.pageEnd(payload);
    if (!accepted) diagnostic('warn', 'feed.page_end_ignored', {
      channelId: payload?.channel_id, source: payload?.source, ref: payload?.ref, generation: payload?.generation,
    });
    return accepted;
  }, []);

  const liveCheckpoint = useCallback((payload = {}) => {
    const channelId = payload.channel_id;
    const lowSeq = Number(payload.scan_low_seq);
    const highSeq = Number(payload.scanned_seq);
    if (!channelId || !Number.isSafeInteger(lowSeq) || !Number.isSafeInteger(highSeq) || lowSeq <= 0 || highSeq < lowSeq) {
      diagnostic('warn', 'feed.live_checkpoint_invalid', payload);
      return false;
    }
	void cacheRef.current.saveCoverage(channelId, lowSeq, highSeq).then(() => {
	  const nextMeta = cacheRef.current.metaSnapshot();
	  cacheMetaRef.current = nextMeta;
	  const channelMeta = nextMeta.get(channelId);
	  if (channelMeta) schedulerRef.current.setLocalMeta(new Map([[channelId, channelMeta]]));
	}).catch((error) => {
      diagnostic('error', 'feed.live_checkpoint_failed', { channelId, lowSeq, highSeq, error });
      onError(error);
    });
    diagnostic('debug', 'feed.live_checkpoint', { channelId, lowSeq, highSeq, generation: payload.generation });
    return true;
  }, [onError]);

  const focusHistory = useCallback((channelId) => schedulerRef.current.focus(channelId), []);
  const disconnectHistory = useCallback((generation) => {
	diagnostic('info', 'feed.connection_reset', { generation });
    schedulerRef.current.disconnected(generation);
  }, []);
  const loadHistory = useCallback(async (channelId, { anchorSeq = 0, viewSpec = {}, signal, operationId = '', topEpoch = 0 } = {}) => {
	const operation = schedulerRef.current.beginOperation(channelId, { signal });
	try {
	  return await loadUntilVisible({
      anchorSeq,
      signal,
	  next: ({ signal: nextSignal }) => operation.next({ signal: nextSignal }),
      project: () => projectTimeline(statesRef.current.get(channelId) || createChannelState(channelId), viewSpec),
      onCheck: ({ firstVisibleSeq, step }) => diagnostic('debug', 'history.projection_checked', {
        channelId, operationId, topEpoch, anchorSeq, firstVisibleSeq,
        released: Number(step?.released || 0), kind: step?.kind || '',
      }),
	  });
	} finally {
	  operation.release();
	}
  }, []);
  const historyFor = useCallback((channelId) => schedulerRef.current.snapshot(channelId), []);
  const bump = useCallback(() => setVersion((value) => value + 1), []);
  const markRead = useCallback((channelId, seq) => {
    if (!channelId) return 0;
    const before = cursorsRef.current.read(channelId);
    const next = cursorsRef.current.markRead(channelId, seq);
    if (next !== before) setVersion((value) => value + 1);
    return next;
  }, []);
  const cancel = useCallback(() => schedulerRef.current.disconnected(), []);
  const clear = useCallback(() => {
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
    const lifecycle = ++lifecycleRef.current;
    let alive = true;
    cacheRef.current.openMeta().then((meta) => {
      if (!alive) return;
	  cacheMetaRef.current = meta;
	  cursorsRef.current.reconcile(resumeSnapshot(meta));
	  schedulerRef.current.setLocalMeta(meta);
      setReady(true);
	  diagnostic('info', 'feed.meta_ready', { channels: meta.size, cursors: Object.keys(resumeSnapshot(meta)).length });
      setVersion((value) => value + 1);
    }).catch((error) => {
      if (!alive) return;
      onError(error);
      diagnostic('error', 'feed.restore_failed', { error });
      setReady(true);
    });
    return () => {
      alive = false;
      // React StrictMode immediately mounts the same hook again after its
      // development cleanup probe. Defer irreversible destruction for one
      // microtask and cancel it implicitly when a new lifecycle has begun.
      queueMicrotask(() => {
        if (lifecycleRef.current === lifecycle) schedulerRef.current.destroy();
      });
    };
  }, []);
  return {
    statesRef, cursorsRef, version, ready, bump, enqueue, cancel, clear, resetPersistent,
    setHistoryGrants, pageEnd, liveCheckpoint, disconnectHistory, focusHistory, historyFor, loadHistory, markRead,
  };
}
