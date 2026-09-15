import { argsOf } from '../../protocol/envelope.js';
import { MOBILE_WINDOW, trimChannelState } from '../../model/memory-window.js';
import { isMobileProfile } from '../../model/device-profile.js';
import { abbreviateToolRow } from '../../model/payload-abbreviate.js';
import { createFrameBatcher } from '../../model/frame-batcher.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createCursors, unreadCount, unreadCounts } from '../../model/cursors.js';
import { createFeedCache, resumeSnapshot } from '../../model/feed-cache.js';
import { createChannelState, reconcileApprovals } from '../../model/fold.js';
import { invalidatesChannelDirectory } from '../../model/directory-invalidation.js';
import { createHistoryScheduler, HISTORY_RESERVOIR_SIZE } from '../../model/history-scheduler.js';
import { diagnostic } from '../../model/diagnostics.js';
import { loadUntilVisible } from '../../model/history-interaction.js';
import { projectTimeline } from '../../model/timeline-projection.js';
import { turnStartObservation } from '../../model/turn-process.js';
import { createChannelReplicaStore } from '../../model/channel-replica.js';
import { cacheWorldMismatch, createPersistenceEpochFence } from '../../model/sync-session.js';

export { HISTORY_RESERVOIR_SIZE };

// 内存窗口只在移动端收:PC 维持"全都留着"。收的时机是"这个频道此刻没人在看历史"
// ——后台频道随时可收;当前频道只在人贴着底部时收(markRead 恰好就是这个事实:
// 它只在页面可见且滚到底时才报)。人往上翻的时候恒不收,否则刚读回来的又被丢掉。
function trimIfMobile(state) {
  if (!state || !isMobileProfile()) return 0;
  return trimChannelState(state, MOBILE_WINDOW);
}

export function useChannelFeed({ wireRef, rosterRef, accessRef, activeChannelRef, onRoster, onError, onChannelsDiscovered, onDirectoryInvalidated, onTimerFired, onSubmissionFeed, onAccessChanged, onAgentActivity }) {
  const [version, setVersion] = useState(0);
  const [indexVersion, setIndexVersion] = useState(0);
  const [localReplicaReady, setLocalReplicaReady] = useState(false);
  const cursorsRef = useRef(createCursors());
  const cacheRef = useRef(null);
  if (cacheRef.current === null) cacheRef.current = createFeedCache();
  const cacheMetaRef = useRef(new Map());
  const cacheBootRef = useRef('');
  const remoteBootRef = useRef('');
  const resumeReadyRef = useRef(false);
  const cacheOwnerReadyRef = useRef(Promise.resolve());
  // Persistence follows the selected (principal, server boot) epoch, but live
  // delivery never does. Every row/checkpoint captures this fence and writes
  // only after old-world cleanup has completed.
  const cacheEpochFenceRef = useRef(null);
  if (cacheEpochFenceRef.current === null) cacheEpochFenceRef.current = createPersistenceEpochFence();
  const attachMetaSerialRef = useRef(0);
  const replicaRef = useRef(null);
  if (replicaRef.current === null) replicaRef.current = createChannelReplicaStore();
  const statesRef = useRef(replicaRef.current.states());
  const applyRowsRef = useRef(null);
  const schedulerRef = useRef(null);
  const lifecycleRef = useRef(0);
  const localReplicaSerialRef = useRef(0);
  const preparedPrincipalRef = useRef('');
  const liveBatchRef = useRef(null);
  const unreadCacheRef = useRef(new Map());

  const unreadFor = useCallback((channelId, selfId = '') => {
    const state = replicaRef.current.state(channelId);
    const revision = replicaRef.current.revision(channelId);
    const readSeq = cursorsRef.current.read(channelId);
    const cached = unreadCacheRef.current.get(channelId);
    if (cached && cached.revision === revision && cached.readSeq === readSeq && cached.selfId === selfId) return cached.counts;
    const counts = unreadCounts(state, readSeq, selfId, { incremental: true });
    unreadCacheRef.current.set(channelId, { revision, readSeq, selfId, counts });
    return counts;
  }, []);

  const applyRows = useCallback((rows, { publish = true, persist = true, source = 'replay' } = {}) => {
    if (!rows?.length) return 0;
    let rosterChanged = false;
    let accessChanged = false;
    let changed = 0;
    const unseenChannels = new Set();
    const dirtyChannels = new Set();
    const landedMessageIds = new Set();
    const closedRequestIds = new Set();
    for (const row of rows) {
      const channelId = row.channel_id;
      const seq = Number(row.seq);
      if (!channelId || !Number.isSafeInteger(seq)) continue;
      const roster = rosterRef.current;
      const selfId = roster?.self(channelId) || '';
      // 工具输出在手机上只进头部(见 payload-abbreviate.js);落缓存的仍是原样,
      // 所以这里恒不是把内容丢了。
      const landed = replicaRef.current.commit(
        row,
        selfId,
        isMobileProfile() ? abbreviateToolRow : (value) => value,
      );
      if (!landed.accepted) continue;
      const state = landed.record.state;
      changed += 1;
      // Cache/history rows are immutable ledger facts, not current control-plane
      // evidence. Only a frame delivered live by this attached generation proves
      // current read eligibility, and even that is not membership.
      if (source === 'live') accessChanged = Boolean(accessRef.current?.live(channelId)) || accessChanged;
      dirtyChannels.add(channelId);
      // Durable resume is derived from IndexedDB coverage, not a per-row
      // localStorage cursor. Writing localStorage here made every live token and
      // every historical row perform synchronous storage I/O on the main thread.
      if (channelId !== activeChannelRef.current && trimIfMobile(state)) replicaRef.current.afterTrim(channelId);
      const learnedSelf = roster?.observeFeed(channelId, row.envelope);
      if (learnedSelf) {
        reconcileApprovals(state, learnedSelf);
        rosterChanged = true;
      }
      // Replaying an old governance row must not fire a new network refresh.
      // Startup already fetches the current OBS snapshot; only a new live row
      // invalidates that snapshot.
      if (source === 'live') {
        roster?.handleEnvelope(channelId, row.envelope, (rosterRows, error) => {
          if (rosterRows) onRoster(channelId, rosterRows);
          if (error) onError(error);
        });
        if (invalidatesChannelDirectory(row.envelope)) onDirectoryInvalidated(row.envelope);
      }
      unseenChannels.add(channelId);
      if (row.envelope?.id) {
        landedMessageIds.add(row.envelope.id);
        onTimerFired(row.envelope.id, row.envelope.ts || Date.now());
      }
      if (row.envelope?.kind === 'response' && ['completed', 'failed'].includes(argsOf(row.envelope)?.status) && row.envelope?.parent_id) {
        closedRequestIds.add(`${channelId}:${row.envelope.parent_id}:cancel`);
      }
    }
    if (!changed) return 0;
    onChannelsDiscovered(unseenChannels);
    onSubmissionFeed(landedMessageIds, closedRequestIds);
    if (accessChanged) onAccessChanged();
    if (persist) cacheEpochFenceRef.current.run(() => cacheRef.current.saveRows(rows)).catch((error) => {
      diagnostic('error', 'feed.cache_save_failed', { channels: [...dirtyChannels], error });
      onError(error);
    });
    if (publish) {
      // Rail/global indexes observe every channel. The expensive active
      // workspace only advances when its own replica changed.
      setIndexVersion((value) => value + 1 + Number(rosterChanged));
      if (dirtyChannels.has(activeChannelRef.current)) setVersion((value) => value + 1 + Number(rosterChanged));
    }
    return changed;
  }, [accessRef, activeChannelRef, onAccessChanged, onChannelsDiscovered, onDirectoryInvalidated, onError, onRoster, onSubmissionFeed, onTimerFired, rosterRef]);
  applyRowsRef.current = applyRows;

  if (schedulerRef.current === null || schedulerRef.current.isDestroyed?.()) {
    const mobile = isMobileProfile();
    schedulerRef.current = createHistoryScheduler({
      // Live feed and history share one ordered WebSocket. Several MiB of
      // speculative history already written to a slow mobile connection cannot
      // be overtaken by a later live frame, regardless of server-side lane
      // priority. Keep the active channel warm in small quanta and leave other
      // channels to IndexedDB until the person focuses them.
      batchBytes: mobile ? 128 * 1024 : undefined,
      maxBackgroundInflight: mobile ? 0 : undefined,
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
	  persistRows: (rows, options) => cacheEpochFenceRef.current.run(() => cacheRef.current.saveRows(rows, options)),
      hasVisibleRow: (channelId, seq) => replicaRef.current.hasRow(channelId, seq),
	  visibleOldestSeq: (channelId) => replicaRef.current.visibleOldest(channelId),
	  revealRows: (channelId, entries) => {
		// A push frame that arrived first must merge first even if a pull page
		// completes in the same browser frame.
		liveBatchRef.current?.flushNow();
		return applyRowsRef.current?.(
		  entries.map(([seq, envelope]) => ({ channel_id: channelId, seq, envelope })),
		  { persist: false, source: 'replay' },
		);
	  },
      onChange: () => setVersion((value) => value + 1),
      onError,
	  flushRealtime: () => liveBatchRef.current?.flushNow(),
    });
  }

  const landLiveRows = useCallback((payloads) => {
    applyRowsRef.current?.(
      payloads.map((payload) => ({ channel_id: payload.channel_id, seq: Number(payload.seq), envelope: payload.envelope })),
      { source: 'live' },
    );
    for (const payload of payloads) {
      const state = statesRef.current.get(payload.channel_id);
      const turn = state?.turns?.get(payload.envelope?.parent_id);
      const startedAt = turnStartObservation(turn)?.envelope?.ts || turn?.request?.ts;
      onAgentActivity?.(payload, { startedAt });
      const selfId = rosterRef.current?.self(payload.channel_id) || '';
      const counts = unreadFor(payload.channel_id, selfId);
      schedulerRef.current.observeLive(payload.channel_id, payload.envelope?.ts, {
        related: counts.related > 0,
        seq: payload.seq,
      });
    }
  }, [onAgentActivity, rosterRef, unreadFor]);
  const landLiveRowsRef = useRef(landLiveRows);
  landLiveRowsRef.current = landLiveRows;
  if (!liveBatchRef.current) liveBatchRef.current = createFrameBatcher((batch) => landLiveRowsRef.current(batch));

  // 页面要走了就把缓冲落地。这不是上面那条不变量的替代(那条靠 checkpoint 前 flush
  // 保证),是缩小窗口:冻结的后台标签页连定时器都不会来,缓冲里的行会跟着页面一起消失。
  useEffect(() => {
    const flush = () => liveBatchRef.current.flushNow();
    const onHidden = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, []);

  const enqueue = useCallback((payloadOrChannel, seq, envelope, detail) => {
	const payload = typeof payloadOrChannel === 'object'
	  ? payloadOrChannel
	  : detail || { channel_id: payloadOrChannel, seq, envelope, source: 'live' };
	const historical = schedulerRef.current.historyRow(payload);
	if (historical) {
	  onAgentActivity?.(payload);
	  return;
	}
	// Live rows never enter the historical executor or reservoir. 所有屏幕都按浏览器
	// 帧合批：桌面端也和编辑器共用一条主线程，逐行 publish 会让键盘/输入法
	// 事件排在时间线重绘后面。合批只延后到下一帧，不改顺序和内容；checkpoint
	// 和断线等依赖“行已落地”的边界会在下面强制 flush。
	liveBatchRef.current.push(payload);
	}, [onAgentActivity]);

  const setHistoryGrants = useCallback((grants = [], detail = {}) => {
    const serial = ++attachMetaSerialRef.current;
    const generation = detail.generation;
    const remoteBoot = String(detail.boot || '');
    remoteBootRef.current = remoteBoot;
    const worldMismatch = cacheWorldMismatch(remoteBoot, cacheBootRef.current, cacheMetaRef.current);
    const replicaChanged = detail.forceReset === true || worldMismatch;

    // This is the only synchronous attach seam. Reset an obsolete in-memory
    // world before Wire can deliver the next frame, then install remote Meta
    // immediately. Disk selection continues below without holding transport.
    if (replicaChanged) {
      localReplicaSerialRef.current += 1;
      cacheMetaRef.current = new Map();
      cacheBootRef.current = remoteBoot;
      resumeReadyRef.current = false;
      replicaRef.current.reset();
      statesRef.current = replicaRef.current.states();
      unreadCacheRef.current.clear();
      schedulerRef.current.resetReplica();
      cursorsRef.current.reconcile({});
      cursorsRef.current.resetReads();
      setLocalReplicaReady(true);
    }
    const localMeta = replicaChanged ? new Map() : cacheMetaRef.current;
    for (const entry of grants) {
      if (!entry?.channel_id) continue;
      cursorsRef.current.baselineRead(entry.channel_id, entry.head_seq);
      replicaRef.current.installMeta(entry.channel_id, {
        headSeq: entry.head_seq,
        coverage: localMeta.get(entry.channel_id)?.coverage,
      });
    }
    schedulerRef.current.attach(grants, {
      generation,
      focus: detail.focus || activeChannelRef.current || '',
      localMeta,
    });

    const selectedEpoch = cacheEpochFenceRef.current.select(() => (
      cacheOwnerReadyRef.current.then(() => cacheRef.current.ensureBoot(remoteBoot))
    ));
    return selectedEpoch.then(({ changed, boot, meta }) => {
      if (serial !== attachMetaSerialRef.current) return { changed, meta, stale: true };
      cacheBootRef.current = String(boot || remoteBoot);
      cacheMetaRef.current = meta;
      resumeReadyRef.current = true;
      // A disk-only mismatch discovered after attach cannot invalidate live
      // rows already committed in memory. ensureBoot has cleared that obsolete
      // disk world; publish only its now-safe (normally empty) metadata.
      for (const [channelId, value] of meta) replicaRef.current.installMeta(channelId, value);
      schedulerRef.current.setLocalMeta(meta, { publishChange: false });
      setLocalReplicaReady(true);
      return { changed: replicaChanged || changed, meta };
    }).catch((error) => {
      if (serial === attachMetaSerialRef.current) {
        resumeReadyRef.current = false;
        diagnostic('error', 'feed.cache_boot_check_failed', { generation, error });
        onError(error);
        setLocalReplicaReady(true);
      }
      return { changed: replicaChanged, meta: new Map(), error };
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
    // checkpoint 说的是"这段 seq 我扫过了",它一落盘,重连时这段就不会再补。所以
    // 它恒不能跑在还没落地的行前面——合批缓冲里那些行正属于它声称覆盖的范围,
    // 缓冲一旦随页面关闭消失,那几行就再也没有人去取了(账上有、这台设备永远看不到)。
    liveBatchRef.current.flushNow();
    const channelId = payload.channel_id;
    const lowSeq = Number(payload.scan_low_seq);
    const highSeq = Number(payload.scanned_seq);
    if (!channelId || !Number.isSafeInteger(lowSeq) || !Number.isSafeInteger(highSeq) || lowSeq <= 0 || highSeq < lowSeq) {
      diagnostic('warn', 'feed.live_checkpoint_invalid', payload);
      return false;
    }
	void cacheEpochFenceRef.current.run(() => cacheRef.current.saveCoverage(channelId, lowSeq, highSeq)).then(() => {
	  const nextMeta = cacheRef.current.metaSnapshot();
	  cacheMetaRef.current = nextMeta;
	  const channelMeta = nextMeta.get(channelId);
	  if (channelMeta) schedulerRef.current.setLocalMeta(new Map([[channelId, channelMeta]]), { publishChange: false });
	}).catch((error) => {
      diagnostic('error', 'feed.live_checkpoint_failed', { channelId, lowSeq, highSeq, error });
      onError(error);
    });
    diagnostic('debug', 'feed.live_checkpoint', { channelId, lowSeq, highSeq, generation: payload.generation });
    return true;
  }, [onError]);

  const focusHistory = useCallback((channelId) => schedulerRef.current.focus(channelId), []);
  const disconnectHistory = useCallback((generation) => {
	liveBatchRef.current.flushNow();
	diagnostic('info', 'feed.connection_reset', { generation });
    schedulerRef.current.disconnected(generation);
  }, []);
  const loadHistory = useCallback(async (channelId, {
    anchorSeq = 0,
    revealRows,
    viewSpec = {},
    signal,
    operationId = '',
    topEpoch = 0,
    intent = 'scroll-history',
    urgency = 'interactive',
  } = {}) => {
	const operation = schedulerRef.current.beginOperation(channelId, { signal, intent, urgency });
	try {
	  return await loadUntilVisible({
      anchorSeq,
      signal,
	  next: ({ signal: nextSignal }) => operation.next({
        signal: nextSignal,
        count: Number.isSafeInteger(revealRows) && revealRows > 0 ? revealRows : undefined,
      }),
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
  const bump = useCallback(() => {
    setVersion((value) => value + 1);
    setIndexVersion((value) => value + 1);
  }, []);
  const markRead = useCallback((channelId, seq) => {
    if (!channelId) return 0;
    const state = statesRef.current.get(channelId);
    if (trimIfMobile(state)) replicaRef.current.afterTrim(channelId);
    const before = cursorsRef.current.read(channelId);
    // Provisional stream frames advance the durable read cursor but never draw
    // a rail badge. Publishing a second React render for every such frame used
    // to nearly double the main-thread work while an agent was answering.
    const changesVisibleUnread = unreadCount(state, before, rosterRef.current?.self(channelId) || '') > 0;
    const next = cursorsRef.current.markRead(channelId, seq);
    schedulerRef.current.markRead(channelId);
	if (next !== before && changesVisibleUnread) {
	  unreadCacheRef.current.delete(channelId);
	  setVersion((value) => value + 1);
	  setIndexVersion((value) => value + 1);
	}
    return next;
  }, [rosterRef]);
  const cancel = useCallback(() => {
    liveBatchRef.current.flushNow();
    schedulerRef.current.disconnected();
  }, []);
  const clear = useCallback(() => {
    // 缓冲里的行先落地再清:恒不留下一批"清完之后才醒过来"的行,把刚清空的表又
    // 填出半张。
    liveBatchRef.current.flushNow();
    schedulerRef.current.clear();
	replicaRef.current.reset();
	statesRef.current = replicaRef.current.states();
	unreadCacheRef.current.clear();
    setVersion((value) => value + 1);
    setIndexVersion((value) => value + 1);
  }, []);

  const resetPersistent = useCallback(async () => {
    liveBatchRef.current.flushNow();
    await cacheEpochFenceRef.current.run(() => cacheRef.current.clear());
	replicaRef.current.reset();
	statesRef.current = replicaRef.current.states();
	unreadCacheRef.current.clear();
    cursorsRef.current.reconcile({});
    setVersion((value) => value + 1);
    setIndexVersion((value) => value + 1);
  }, []);

  const prepareLocalReplica = useCallback(async (principalId, { focus = '' } = {}) => {
    const serial = ++localReplicaSerialRef.current;
    // A principal change invalidates both any detached attach completion and
    // every resume claim from the preceding owner before a new socket can ask
    // for it. The cache may still be physically open; it is not trusted until
    // owner and remote boot have both crossed the epoch fence.
    attachMetaSerialRef.current += 1;
    resumeReadyRef.current = false;
    cacheMetaRef.current = new Map();
    cacheBootRef.current = '';
    remoteBootRef.current = '';
    if (!principalId) {
      preparedPrincipalRef.current = '';
      setLocalReplicaReady(true);
      return { resume: {} };
    }
    if (preparedPrincipalRef.current && preparedPrincipalRef.current !== principalId) {
      // Actor ids and unread cursors are channel-local facts of one principal.
      // Never render the preceding principal's in-memory world while the new
      // owner check is still waiting on IndexedDB.
      liveBatchRef.current?.flushNow();
      replicaRef.current.reset();
      statesRef.current = replicaRef.current.states();
      unreadCacheRef.current.clear();
      schedulerRef.current.resetReplica();
      cursorsRef.current.reconcile({});
      cursorsRef.current.resetReads();
      setVersion((value) => value + 1);
      setIndexVersion((value) => value + 1);
    }
    preparedPrincipalRef.current = principalId;
    setLocalReplicaReady(false);
    schedulerRef.current.setPriorityScope(principalId);
    const ownerReady = cacheEpochFenceRef.current.select(() => cacheRef.current.ensureOwner(principalId));
    cacheOwnerReadyRef.current = ownerReady.then(() => undefined);
    try {
      const { changed, boot, meta } = await ownerReady;
      if (serial !== localReplicaSerialRef.current) return { resume: {} };
      cacheBootRef.current = String(boot || '');
      const remoteBoot = remoteBootRef.current;
      if (cacheWorldMismatch(remoteBoot, cacheBootRef.current, meta)) {
        // Attach won the race. Old-world Meta must not enter the active
        // scheduler while ensureBoot clears it behind the persistence fence.
        cacheMetaRef.current = new Map();
        setLocalReplicaReady(true);
        return { resume: {} };
      }
      if (changed) {
		replicaRef.current.reset();
		statesRef.current = replicaRef.current.states();
		unreadCacheRef.current.clear();
		schedulerRef.current.resetReplica();
        cursorsRef.current.reconcile({});
      }
      cacheMetaRef.current = meta;
      cursorsRef.current.reconcile(resumeSnapshot(meta));
      // Meta defines the in-memory channel queues. Message bodies are decoded
      // by the pull scheduler afterwards; opening the push lane never waits for
      // a body page to finish.
      for (const channelId of meta.keys()) {
		replicaRef.current.installMeta(channelId, meta.get(channelId));
      }
      if (focus) schedulerRef.current.focus(focus);
      schedulerRef.current.setLocalMeta(meta, { publishChange: false });

      // Start the selected local decode immediately, but do not await it. Push
      // is the realtime lane; cache decode and remote history are both pull.
      const focusedMeta = meta.get(focus);
      if (focus && focusedMeta && (Number(focusedMeta.rowCount) > 0 || focusedMeta.coverage?.length > 0)) {
        void schedulerRef.current.nextSegment(focus, { projectionBarrier: false });
      }
      if (serial !== localReplicaSerialRef.current) return { resume: {} };
      diagnostic('info', 'feed.local_replica_ready', {
        channels: meta.size,
        focus,
        cursors: Object.keys(resumeSnapshot(meta)).length,
      });
      setVersion((value) => value + 1);
      setIndexVersion((value) => value + 1);
      setLocalReplicaReady(true);
      return { resume: resumeSnapshot(meta) };
    } catch (error) {
      if (serial !== localReplicaSerialRef.current) return { resume: {} };
      onError(error);
      diagnostic('error', 'feed.restore_failed', { error });
      setLocalReplicaReady(true);
      return { resume: {} };
    }
  }, [onError]);

  // Attach/reconnect cursors must describe durable local coverage. The folded
  // React model can be ahead of disk by one animation frame and is therefore
  // not a safe resume claim.
  const resumeLocalReplica = useCallback(() => (
    resumeReadyRef.current ? resumeSnapshot(cacheRef.current.metaSnapshot()) : {}
  ), []);

  useEffect(() => {
    const lifecycle = ++lifecycleRef.current;
	const ownedScheduler = schedulerRef.current;
    return () => {
      localReplicaSerialRef.current += 1;
      // React StrictMode immediately mounts the same hook again after its
      // development cleanup probe. Defer irreversible destruction for one
      // microtask and cancel it implicitly when a new lifecycle has begun.
      queueMicrotask(() => {
		if (lifecycleRef.current === lifecycle) ownedScheduler.destroy();
      });
    };
  }, []);
  return {
    statesRef, cursorsRef, version, indexVersion, bump, enqueue, cancel, clear, resetPersistent,
	revisionFor: (channelId) => replicaRef.current.revision(channelId),
	unreadFor,
	prepareLocalReplica, resumeLocalReplica, localReplicaReady,
    setHistoryGrants, pageEnd, liveCheckpoint, disconnectHistory, focusHistory, historyFor, loadHistory, markRead,
  };
}
