import { argsOf, FINAL } from '../../protocol/envelope.js';
import { MOBILE_WINDOW, trimChannelState } from '../../model/memory-window.js';
import { isMobileProfile } from '../../model/device-profile.js';
import { abbreviateToolRow } from '../../model/payload-abbreviate.js';
import { createFrameBatcher } from '../../model/frame-batcher.js';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createCursors, unreadCountDiagnostics, unreadCounts } from '../../model/cursors.js';
import { createFeedCache, resumeSnapshot } from '../../model/feed-cache.js';
import { createChannelState, reconcileApprovals, recordLiveTimelineArrival } from '../../model/fold.js';
import { invalidatesChannelDirectory } from '../../model/directory-invalidation.js';
import { createHistoryScheduler, HISTORY_RESERVOIR_SIZE } from '../../model/history-scheduler.js';
import {
  diagnostic,
  isReadingTraceEnabled,
  readingTrace,
  registerRailDiagnosticProvider,
} from '../../model/diagnostics.js';
import { projectTimeline } from '../../model/timeline-projection.js';
import { turnStartObservation } from '../../model/turn-process.js';
import { createChannelReplicaStore } from '../../model/channel-replica.js';
import { cacheWorldMismatch, createPersistenceEpochFence, createSyncObligationCoordinator } from '../../model/sync-session.js';
import { createHistoryPresentationAdmission } from '../../model/history-presentation-admission.js';

export { HISTORY_RESERVOIR_SIZE };

// Ephemeral provenance for an in-memory producer. Symbols are deliberately
// omitted by FeedCache serialization, so principal/session authority never
// becomes a durable property of an immutable ledger row.
const FEED_OWNER_TOKEN = Symbol('feed-owner-token');

// 内存窗口只在移动端收:PC 维持"全都留着"。收的时机是"这个频道此刻没人在看历史"
// ——后台频道随时可收;当前频道只在人贴着底部时收(markRead 恰好就是这个事实:
// 它只在页面可见且滚到底时才报)。人往上翻的时候恒不收,否则刚读回来的又被丢掉。
function trimIfMobile(state) {
  if (!state || !isMobileProfile()) return 0;
  return trimChannelState(state, MOBILE_WINDOW);
}

export function useChannelFeed({ wireRef, rosterRef, accessRef, activeChannelRef, ownerToken = null, onRoster, onError, onChannelsDiscovered, onDirectoryInvalidated, onTimerFired, onSubmissionFeed, onAccessChanged, onAgentActivity }) {
  const [version, setVersion] = useState(0);
  const [indexVersion, setIndexVersion] = useState(0);
  const [localReplicaReady, setLocalReplicaReady] = useState(false);
  const committedOwnerTokenRef = useRef(null);
  useLayoutEffect(() => {
    const committed = ownerToken;
    committedOwnerTokenRef.current = committed;
    return () => {
      if (committedOwnerTokenRef.current === committed) committedOwnerTokenRef.current = null;
    };
  }, [ownerToken]);
  const cursorsRef = useRef(null);
  // Vite HMR preserves hook refs across module replacement. A page carrying a
  // pre-authority cursor object must cross the same validation boundary as a
  // cold start, not crash on the new method or silently trust legacy reads.
  if (!cursorsRef.current?.isReadAuthorityReady) {
    cursorsRef.current = createCursors(globalThis.localStorage, { requireReadAuthority: true });
  }
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
  const presentationAdmissionRef = useRef(null);
  if (presentationAdmissionRef.current === null) {
    presentationAdmissionRef.current = createHistoryPresentationAdmission({
      onChange: (channelId) => {
        if (channelId === activeChannelRef.current) setVersion((value) => value + 1);
      },
    });
  }
  const statesRef = useRef(replicaRef.current.states());
  const applyRowsRef = useRef(null);
  const schedulerRef = useRef(null);
  const lifecycleRef = useRef(0);
  const localReplicaSerialRef = useRef(0);
  const preparedPrincipalRef = useRef('');
  const liveBatchRef = useRef(null);
  const unreadCacheRef = useRef(new Map());
  const unreadDiagnosticSignatureRef = useRef(new Map());
  const notificationHydrationRef = useRef({ serial: 0, channels: new Map() });
  const syncCoordinatorRef = useRef(null);
  const attachedGenerationRef = useRef(0);

  const unreadFor = useCallback((channelId, selfId = '') => {
    if (!cursorsRef.current.isReadAuthorityReady()) return { related: 0, total: 0, pending: true };
    const state = replicaRef.current.state(channelId);
    const revision = replicaRef.current.revision(channelId);
    const notificationHighWater = cursorsRef.current.notificationHighWater(channelId);
    const legacyAcknowledged = cursorsRef.current.notificationLegacyAcknowledged(channelId);
    const notificationMigrationSignature = [...legacyAcknowledged]
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
      .map(([id, seq]) => `${id}:${seq}`)
      .join('|');
    const cached = unreadCacheRef.current.get(channelId);
    let counts = cached?.revision === revision
      && cached?.notificationHighWater === notificationHighWater
      && cached?.notificationMigrationSignature === notificationMigrationSignature
      && cached?.selfId === selfId
      ? cached.counts
      : null;
    if (!counts) {
      counts = unreadCounts(state, notificationHighWater, selfId, {
        incremental: true,
        acknowledged: legacyAcknowledged,
      });
      unreadCacheRef.current.set(channelId, {
        revision,
        notificationHighWater,
        notificationMigrationSignature,
        selfId,
        counts,
      });
    }
    if (isReadingTraceEnabled()) {
      const signature = `${revision}:${notificationHighWater}:${selfId}:${notificationMigrationSignature}`;
      if (unreadDiagnosticSignatureRef.current.get(channelId) !== signature) {
        unreadDiagnosticSignatureRef.current.set(channelId, signature);
        readingTrace('notification.rail-classification', () => ({
          channelId,
          notificationHighWater,
          ...unreadCountDiagnostics(state, notificationHighWater, selfId, {
            incremental: true,
            acknowledged: legacyAcknowledged,
          }),
        }));
      }
    }
    const hydration = notificationHydrationRef.current.serial === localReplicaSerialRef.current
      ? notificationHydrationRef.current.channels.get(channelId)
      : '';
    if (hydration === 'pending') return { ...counts, pending: true };
    if (hydration === 'unknown') return { ...counts, unknown: true };
    return counts;
  }, []);

  useEffect(() => registerRailDiagnosticProvider((requestedChannelId = '') => {
    const channels = [];
    for (const [channelId, state] of statesRef.current) {
      if (requestedChannelId && channelId !== requestedChannelId) continue;
      const readSeq = cursorsRef.current.read(channelId);
      const notificationHighWater = cursorsRef.current.notificationHighWater(channelId);
      const legacyAcknowledged = cursorsRef.current.notificationLegacyAcknowledged(channelId);
      channels.push(Object.freeze({
        channelId,
        authorityReady: cursorsRef.current.isReadAuthorityReady(),
        notificationHydration: notificationHydrationRef.current.serial === localReplicaSerialRef.current
          ? notificationHydrationRef.current.channels.get(channelId) || 'ready'
          : 'stale',
        readSeq,
        notificationHighWater,
        ...unreadCountDiagnostics(
          state,
          notificationHighWater,
          rosterRef.current?.self(channelId) || '',
          {
            incremental: true,
            acknowledged: legacyAcknowledged,
          },
        ),
      }));
    }
    return Object.freeze({ version: 1, channels: Object.freeze(channels) });
  }), [rosterRef]);

  const applyRows = useCallback((rows, {
    publish = true,
    persist = true,
    source = 'replay',
    acceptedRows = null,
    producerOwnerToken = committedOwnerTokenRef.current,
  } = {}) => {
    if (!rows?.length) return 0;
    let rosterChanged = false;
    let accessChanged = false;
    let changed = 0;
    const unseenChannels = new Set();
    const dirtyChannels = new Set();
    const submissionFactsByOwner = new Map();
    const submissionFacts = (token) => {
      if (!submissionFactsByOwner.has(token)) {
        submissionFactsByOwner.set(token, { landedMessageIds: new Set(), closedRequestIds: new Set() });
      }
      return submissionFactsByOwner.get(token);
    };
    for (const row of rows) {
      const channelId = row.channel_id;
      const seq = Number(row.seq);
      if (!channelId || !Number.isSafeInteger(seq)) continue;
      const rowOwnerToken = row[FEED_OWNER_TOKEN] ?? producerOwnerToken;
      // A live producer belongs to the principal/session that installed its
      // callback. Reject it before any replica, arrival, access, unread or
      // cache-visible fact can cross into a subsequently committed owner.
      if (source === 'live' && rowOwnerToken !== committedOwnerTokenRef.current) continue;
      const roster = rosterRef.current;
      const selfId = roster?.self(channelId) || '';
      // The first feed echo may arrive before roster.observeFeed learns this
      // device's channel-local actor id. Submission identity is already known
      // at that point: transmit records the immutable message id before the
      // wire call. Read that exact, channel-scoped ownership without consuming
      // it, classify the arrival, then let the existing observer learn self
      // exactly once below. Principal-wide filtering would incorrectly hide a
      // different device belonging to the same human.
      const ownedSubmission = source === 'live'
        && row.envelope?.kind === 'request'
        && roster?.ownsSubmission?.(channelId, row.envelope?.id) === true;
      // 工具输出在手机上只进头部(见 payload-abbreviate.js);落缓存的仍是原样,
      // 所以这里恒不是把内容丢了。
      const landed = replicaRef.current.commit(
        row,
        selfId,
        isMobileProfile() ? abbreviateToolRow : (value) => value,
      );
      if (!landed.accepted) continue;
      const state = landed.record.state;
      const rowSubmissionFacts = submissionFacts(rowOwnerToken);
      acceptedRows?.push(row);
      if (source === 'live') {
        const arrivalSelfId = ownedSubmission ? row.envelope?.sender?.id || selfId : selfId;
        recordLiveTimelineArrival(state, row.envelope, seq, arrivalSelfId);
      }
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
          if (rosterRows) onRoster(channelId, rosterRows, rowOwnerToken);
          if (error) onError(error);
        });
        if (invalidatesChannelDirectory(row.envelope)) onDirectoryInvalidated(row.envelope);
      }
      unseenChannels.add(channelId);
      if (row.envelope?.id) {
        rowSubmissionFacts.landedMessageIds.add(row.envelope.id);
        onTimerFired(row.envelope.id, row.envelope.ts || Date.now());
      }
      if (row.envelope?.kind === 'response' && FINAL.has(argsOf(row.envelope)?.status) && row.envelope?.parent_id) {
        // A terminal response is the ledger acknowledgement for the immutable
        // request id carried by parent_id. Provisional responses only prove
        // their own ids and must not retire a still-active local submission.
        rowSubmissionFacts.landedMessageIds.add(row.envelope.parent_id);
        rowSubmissionFacts.closedRequestIds.add(`${channelId}:${row.envelope.parent_id}:cancel`);
      }
    }
    if (!changed) return 0;
    onChannelsDiscovered(unseenChannels);
    for (const [token, facts] of submissionFactsByOwner) {
      onSubmissionFeed(facts.landedMessageIds, facts.closedRequestIds, token);
    }
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

  const beginNotificationHydration = useCallback((meta, serial, focus = '') => {
    if (serial !== localReplicaSerialRef.current) return;
    const channels = new Map();
    const queue = [];
    for (const [channelId, channelMeta] of meta) {
      const newest = Math.max(
        Number(channelMeta?.newestSeq || 0),
        ...(channelMeta?.coverage || []).map((range) => Number(range?.highSeq || 0)),
      );
      const notificationHighWater = cursorsRef.current.notificationHighWater(channelId);
      if (newest <= notificationHighWater || channelId === focus) continue;
      channels.set(channelId, 'pending');
      queue.push({ channelId, notificationHighWater });
    }
    notificationHydrationRef.current = { serial, channels };
    if (!queue.length) return;
    // Publish the unknown state once. Cache pages and fold commits below stay
    // off the React lane; a second publication exposes all completed badges.
    setIndexVersion((value) => value + 1);
    void (async () => {
      for (const { channelId, notificationHighWater } of queue) {
        if (serial !== localReplicaSerialRef.current) return;
        // Once a person opens the channel, its ordinary scheduler owns history
        // admission. Notification hydration must never become a second visible
        // history-advance path.
        if (activeChannelRef.current === channelId) {
          channels.delete(channelId);
          continue;
        }
        try {
          const result = typeof cacheRef.current.readNotificationContext === 'function'
            ? await cacheRef.current.readNotificationContext(channelId, notificationHighWater, {
              isCurrent: () => serial === localReplicaSerialRef.current
                && activeChannelRef.current !== channelId,
            })
            : { complete: false, cancelled: false, rows: [], missingParents: [] };
          if (serial !== localReplicaSerialRef.current || result.cancelled) return;
          if (activeChannelRef.current === channelId) {
            channels.delete(channelId);
            continue;
          }
          if (!result.complete) {
            channels.set(channelId, 'unknown');
            diagnostic('warn', 'feed.notification_cache_incomplete', {
              channelId,
              notificationHighWater,
              missingParents: result.missingParents || [],
            });
            continue;
          }
          applyRows(result.rows, { publish: false, persist: false, source: 'replay' });
          unreadCacheRef.current.delete(channelId);
          channels.delete(channelId);
        } catch (error) {
          if (serial !== localReplicaSerialRef.current) return;
          channels.set(channelId, 'unknown');
          diagnostic('warn', 'feed.notification_cache_failed', { channelId, notificationHighWater, error });
          onError(error);
        }
        // Keep multiple inactive channels from becoming one long main-thread
        // cache/fold task even when IndexedDB answers from memory.
        await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
      }
      if (serial !== localReplicaSerialRef.current) return;
      setIndexVersion((value) => value + 1);
    })();
  }, [activeChannelRef, applyRows, onError]);

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
	  hasPresentedRows: (channelId) => projectTimeline(
		replicaRef.current.state(channelId) || createChannelState(channelId),
	  ).items.length > 0,
	  visibleOldestSeq: (channelId) => replicaRef.current.visibleOldest(channelId),
	  visibleNewestSeq: (channelId) => replicaRef.current.visibleNewest(channelId),
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

  if (syncCoordinatorRef.current === null) {
    syncCoordinatorRef.current = createSyncObligationCoordinator({
      probe: async (channelId) => {
        const wire = wireRef.current;
        if (!wire?.channelMeta) throw new Error('消息连接尚未就绪');
        const meta = await wire.channelMeta(channelId);
        return { ...meta, local_head_seq: replicaRef.current.visibleNewest(channelId) };
      },
      catchup: async (channelId, entry, obligation) => {
        replicaRef.current.installMeta(channelId, { headSeq: entry.head_seq });
        const accepted = schedulerRef.current.refreshRemoteMeta(entry, { generation: entry.generation });
        if (!accepted) throw new Error('频道新鲜度响应不属于当前会话');
        await schedulerRef.current.waitForCurrent(channelId, obligation.targetHead, { signal: obligation.signal });
      },
      isDefinitiveError: (error) => error?.code === 'forbidden',
      onDefinitiveError: (channelId, error, authority) => {
        // Only the current attach generation may turn a foreground probe
        // denial into an access fact. The coordinator has already fenced the
        // attempt by connection + admission epoch and blocked further probes;
        // repeat the public generation check here before touching the access
        // and roster authorities owned by the hook.
        if (Number(authority?.admissionGeneration || 0) !== attachedGenerationRef.current) return;
        schedulerRef.current.revoke(channelId, {
          generation: authority.admissionGeneration,
          reason: error?.code || 'forbidden',
        });
        accessRef.current?.forbidden(channelId);
        rosterRef.current?.clearSelf?.(channelId);
        onAccessChanged();
      },
      onChange: () => setVersion((value) => value + 1),
    });
  }

  const landLiveEvents = useCallback((events) => {
    const committedOwnerToken = committedOwnerTokenRef.current;
    const ownedEvents = events.filter((event) => event?.ownerToken === committedOwnerToken);
    const rowEvents = ownedEvents.filter((event) => event?.kind === 'row');
    const payloads = rowEvents.map((event) => event.payload);
    const checkpoints = ownedEvents.flatMap((event) => event?.kind === 'checkpoint' ? [event.payload] : []);
    const rows = rowEvents.map((event) => {
      const payload = event.payload;
      const row = {
        channel_id: payload.channel_id,
        seq: Number(payload.seq),
        envelope: payload.envelope,
        // Keep transport provenance through the frame batch. The activity
        // tracker deliberately requires the exact attached generation before a
        // processing frame can establish liveness. FeedCache later normalizes
        // this back to ledger-only fields, so no session fact becomes durable.
        source: payload.source || 'live',
        generation: Number(payload.generation || 0),
      };
      Object.defineProperty(row, FEED_OWNER_TOKEN, { value: event.ownerToken });
      return row;
    });
    const acceptedRows = [];
    applyRowsRef.current?.(
      rows,
      { source: 'live', persist: false, acceptedRows },
    );
    for (const row of acceptedRows) {
      const state = statesRef.current.get(row.channel_id);
      const turn = state?.turns?.get(row.envelope?.parent_id);
      const startedAt = turnStartObservation(turn)?.envelope?.ts || turn?.request?.ts;
      onAgentActivity?.(row, { startedAt });
      const selfId = rosterRef.current?.self(row.channel_id) || '';
      const counts = unreadFor(row.channel_id, selfId);
      schedulerRef.current.observeLive(row.channel_id, row.envelope?.ts, {
        related: counts.related > 0,
        seq: row.seq,
        generation: row.generation,
      });
    }
    if (rows.length || checkpoints.length) {
      void cacheEpochFenceRef.current.run(() => {
        // FeedCache coalesces every call made in this turn into one ordered
        // journal entry: facts are committed first, then all checkpoint
        // intervals. A token-heavy live burst therefore performs one bounded
        // transaction batch instead of one IndexedDB transaction per frame.
        const writes = [cacheRef.current.saveRows(rows)];
        for (const payload of checkpoints) {
          writes.push(cacheRef.current.saveCoverage(
            payload.channel_id,
            Number(payload.scan_low_seq),
            Number(payload.scanned_seq),
          ));
        }
        return Promise.all(writes);
      }).then(() => {
        const nextMeta = cacheRef.current.metaSnapshot();
        cacheMetaRef.current = nextMeta;
        const touched = new Set([...payloads, ...checkpoints].map((payload) => payload.channel_id));
        for (const channelId of touched) {
          const channelMeta = nextMeta.get(channelId);
          const statusBefore = schedulerRef.current.snapshot(channelId);
          const channelEvents = [...payloads, ...checkpoints].filter((payload) => payload.channel_id === channelId);
          const currentGeneration = statusBefore.attached && statusBefore.generation > 0
            && channelEvents.every((payload) => Number(payload.generation || 0) === statusBefore.generation);
          if (!channelMeta || !currentGeneration) continue;
          schedulerRef.current.setLocalMeta(new Map([[channelId, channelMeta]]), { publishChange: false });
        }
      }).catch((error) => {
        diagnostic('error', 'feed.cache_save_failed', { channels: [...new Set(rows.map((row) => row.channel_id))], error });
        onError(error);
      });
    }
  }, [onAgentActivity, onError, rosterRef, unreadFor]);
  const landLiveEventsRef = useRef(landLiveEvents);
  landLiveEventsRef.current = landLiveEvents;
  if (!liveBatchRef.current) liveBatchRef.current = createFrameBatcher((batch) => landLiveEventsRef.current(batch));

  // 页面要走了就把缓冲落地。这不是上面那条不变量的替代(那条靠 checkpoint 前 flush
  // 保证),是缩小窗口:冻结的后台标签页连定时器都不会来,缓冲里的行会跟着页面一起消失。
  // 回到前台是一次明确的新鲜度需求：它只为当前频道生成一份可持续的
  // obligation，不轮询，也不把可见这件事冒充成“已读”证据。
  useEffect(() => {
    const flush = () => liveBatchRef.current.flushNow();
    let previousVisibility = document.visibilityState;
    const onVisibility = () => {
      const nextVisibility = document.visibilityState;
      const returnedToForeground = previousVisibility === 'hidden' && nextVisibility === 'visible';
      previousVisibility = nextVisibility;
      if (nextVisibility === 'hidden') {
        flush();
        return;
      }
      // Browsers and test/device adapters may emit duplicate visible events.
      // Freshness is owned by the actual hidden -> visible lifecycle edge, not
      // by the notification itself, otherwise our own rerenders can multiply
      // probes without a new user foreground transition.
      if (!returnedToForeground) return;
      const channelId = activeChannelRef.current;
      if (channelId) void syncCoordinatorRef.current.interest(channelId);
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [activeChannelRef]);

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
	liveBatchRef.current.push({ kind: 'row', payload, ownerToken });
	}, [onAgentActivity, ownerToken]);

  const setHistoryGrants = useCallback((grants = [], detail = {}) => {
    const serial = ++attachMetaSerialRef.current;
    const generation = Number(detail.generation || 0);
    const generationChanged = attachedGenerationRef.current !== generation;
    if (generationChanged) {
      attachedGenerationRef.current = generation;
    }
    const remoteBoot = String(detail.boot || '');
    remoteBootRef.current = remoteBoot;
    const readAuthority = cursorsRef.current.selectReadAuthority({
      principalId: preparedPrincipalRef.current,
      serverBoot: remoteBoot,
    });
    if (readAuthority.changed || !readAuthority.reused) unreadCacheRef.current.clear();
    const worldMismatch = cacheWorldMismatch(remoteBoot, cacheBootRef.current, cacheMetaRef.current);
    const replicaChanged = detail.forceReset === true || worldMismatch;

    // This is the only synchronous attach seam. Reset an obsolete in-memory
    // world before Wire can deliver the next frame, then install remote Meta
    // immediately. Disk selection continues below without holding transport.
    if (replicaChanged) {
      const replicaSerial = ++localReplicaSerialRef.current;
      notificationHydrationRef.current = { serial: replicaSerial, channels: new Map() };
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
    const grantedChannelIds = new Set();
    let notificationStatusChanged = false;
    for (const entry of grants) {
      if (!entry?.channel_id) continue;
      grantedChannelIds.add(entry.channel_id);
      cursorsRef.current.baselineRead(entry.channel_id, entry.head_seq);
      cursorsRef.current.baselineNotifications(entry.channel_id, entry.head_seq);
      replicaRef.current.installMeta(entry.channel_id, {
        headSeq: entry.head_seq,
        coverage: localMeta.get(entry.channel_id)?.coverage,
      });
      if (entry.channel_id !== (detail.focus || activeChannelRef.current || '')
        && Number(entry.head_seq || 0) > cursorsRef.current.notificationHighWater(entry.channel_id)
        && !localMeta.has(entry.channel_id)
        && notificationHydrationRef.current.serial === localReplicaSerialRef.current) {
        notificationHydrationRef.current.channels.set(entry.channel_id, 'unknown');
        notificationStatusChanged = true;
      }
    }
    if (notificationStatusChanged) setIndexVersion((value) => value + 1);
    schedulerRef.current.attach(grants, {
      generation,
      focus: detail.focus || activeChannelRef.current || '',
      localMeta,
    });
    // Remote attach is an authoritative, safe network seam even while the
    // optional IndexedDB owner/boot selection is still pending. Do not let a
    // non-settling cache operation keep HistoryScheduler's local-meta gate
    // closed forever: start from the already-selected in-memory Meta (possibly
    // empty), then merge the epoch-fenced disk result below if it arrives.
    schedulerRef.current.setLocalMeta(localMeta, { publishChange: false, localReady: true });
    setLocalReplicaReady(true);
    // Attach history_meta is the authoritative read-grant set for this Wire
    // generation. Fence pending freshness work before reconnect availability
    // is published: a selected-but-revoked channel must retain its obligation
    // without sending channel_meta, and a later grant resumes that same work.
    syncCoordinatorRef.current.admission(grantedChannelIds, { generation });
    const activeChannelId = activeChannelRef.current;
    const activeChannelGranted = grantedChannelIds.has(activeChannelId);
    const syncBeforeAttach = activeChannelId
      ? syncCoordinatorRef.current.snapshot(activeChannelId)
      : null;
    syncCoordinatorRef.current.connection(true);
    // A real attach generation is a new server observation boundary. Resume a
    // pending entry/focus obligation as-is; only a previously fulfilled state
    // needs one fresh revision. Initial entry is owned by App's explicit
    // refresh effect, so attach does not race it by inventing revision zero's
    // successor. Repeated Meta for the same generation cannot add probes.
    if (generationChanged
      && generation > 0
      && activeChannelId
      && activeChannelGranted
      && syncBeforeAttach.interestRevision > 0
      && syncBeforeAttach.fulfilledRevision >= syncBeforeAttach.interestRevision) {
      void syncCoordinatorRef.current.interest(activeChannelId);
    }

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
      schedulerRef.current.setLocalMeta(meta, { publishChange: false, localReady: true });
      setLocalReplicaReady(true);
      return { changed: replicaChanged || changed, meta };
    }).catch((error) => {
      if (serial === attachMetaSerialRef.current) {
        resumeReadyRef.current = false;
        schedulerRef.current.setLocalMeta(new Map(), { publishChange: false, localReady: true });
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
    // Checkpoints join the same frame journal as live facts. FeedCache writes
    // facts first and coverage second, so batching cannot create a false
    // resume claim while avoiding one IndexedDB transaction per token.
    const channelId = payload.channel_id;
    const lowSeq = Number(payload.scan_low_seq);
    const highSeq = Number(payload.scanned_seq);
    if (!channelId || !Number.isSafeInteger(lowSeq) || !Number.isSafeInteger(highSeq) || lowSeq <= 0 || highSeq < lowSeq) {
      diagnostic('warn', 'feed.live_checkpoint_invalid', payload);
      return false;
    }
    liveBatchRef.current.push({ kind: 'checkpoint', payload, ownerToken });
    diagnostic('debug', 'feed.live_checkpoint', { channelId, lowSeq, highSeq, generation: payload.generation });
    return true;
  }, [onError, ownerToken]);

  const focusHistory = useCallback((channelId) => schedulerRef.current.focus(channelId), []);
  const generationFor = useCallback((channelId) => (
    Number(schedulerRef.current?.snapshot(channelId)?.generation || 0)
  ), []);
  const refreshChannel = useCallback((channelId) => {
	if (!channelId) return Promise.resolve(false);
	return syncCoordinatorRef.current.interest(channelId);
  }, []);
  const disconnectHistory = useCallback((generation) => {
	liveBatchRef.current.flushNow();
	diagnostic('info', 'feed.connection_reset', { generation });
    attachedGenerationRef.current = 0;
    syncCoordinatorRef.current.connection(false);
    schedulerRef.current.disconnected(generation);
  }, []);
  const loadHistory = useCallback(async (channelId, {
    anchorSeq = 0,
    targetSeq = 0,
    requiredVisibleCoverage = {},
    revealRows,
    revealBytes,
    viewSpec = {},
    signal,
    operationId = '',
    topEpoch = 0,
    intent = 'scroll-history',
	urgency = 'interactive',
	onOperation,
    historyRevealIntent = null,
  } = {}) => {
	const admission = presentationAdmissionRef.current;
	const revealToken = intent === 'scroll-history' && historyRevealIntent
	  ? admission.begin(channelId, historyRevealIntent)
	  : null;
	if (revealToken) diagnostic('debug', 'history.admission_begin', {
	  channelId,
	  operationID: revealToken.operationID,
	  activationID: revealToken.activationID,
	  inputEpoch: revealToken.inputEpoch,
	  viewID: revealToken.viewID,
	  demandUnits: revealToken.demandUnits,
	  baselineCount: revealToken.uiBaselineIDs?.length || revealToken.baselineIDs?.length || 0,
	  durableBaselineCount: revealToken.durableBaselineIDs?.length || 0,
	});
	const settleAdmission = (outcome) => {
	  if (!revealToken) return null;
	  const result = outcome === 'cancelled'
	    ? admission.cancel(channelId, revealToken.operationID)
	    : admission.settle(channelId, outcome);
	  diagnostic('debug', `history.admission_${outcome === 'cancelled' ? 'cancel' : 'settle'}`, {
	    channelId,
	    operationID: revealToken.operationID,
	    activationID: revealToken.activationID,
	    inputEpoch: revealToken.inputEpoch,
	    outcome,
	    stagedIDs: result?.stagedIDs || admission.snapshot(channelId).stagedIDs,
	  });
	  return result;
	};
	const operation = schedulerRef.current.beginOperation(channelId, { signal, intent, urgency });
	try {
	  onOperation?.(operation);
	  for (;;) {
		if (signal?.aborted) {
		  settleAdmission('cancelled');
		  return { kind: 'cancelled' };
		}
		let step;
		try {
			  step = await operation.next({
				signal,
				count: Number.isSafeInteger(revealRows) && revealRows > 0 ? revealRows : undefined,
				byteLimit: Number.isSafeInteger(revealBytes) && revealBytes > 0 ? revealBytes : undefined,
			  });
		} catch (error) {
		  if (signal?.aborted || error?.name === 'AbortError') {
			settleAdmission('cancelled');
			return { kind: 'cancelled' };
		  }
		  settleAdmission('error');
		  return { kind: 'failed', error };
		}
		if (['failed', 'exhausted', 'cancelled'].includes(step?.kind)) {
		  settleAdmission(step.kind === 'failed' ? 'error' : step.kind);
		  return step;
		}
		const projection = projectTimeline(statesRef.current.get(channelId) || createChannelState(channelId), viewSpec);
		const admissionState = revealToken ? admission.observe(channelId, projection.items, {
		  operationID: revealToken.operationID,
		  viewID: revealToken.viewID,
		  epoch: revealToken.epoch,
		  sourceRevision: Number(statesRef.current.get(channelId)?._timelineRevision || 0),
		}) : null;
		if (admissionState) diagnostic('debug', 'history.admission_observe', {
		  channelId,
		  operationID: revealToken.operationID,
		  activationID: revealToken.activationID,
		  inputEpoch: revealToken.inputEpoch,
		  stagedIDs: admissionState.stagedIDs,
		  completeUnits: admissionState.completeUnits,
		  demandUnits: revealToken.demandUnits,
		  fulfilled: admissionState.fulfilled,
		  rebased: admissionState.rebased === true,
		  stale: admissionState.stale === true,
		});
		if (admissionState?.rebased || admissionState?.stale) {
		  settleAdmission('cancelled');
		  return { kind: 'cancelled', reason: 'presentation-rebased' };
		}
		const firstVisibleSeq = Number(projection?.firstVisibleSeq || 0);
		const requiredMessageID = String(requiredVisibleCoverage?.messageID || '');
		const targetMessagePresent = !requiredMessageID
		  || Boolean(statesRef.current.get(channelId)?._envelopesById?.has?.(requiredMessageID));
		diagnostic('debug', 'history.projection_checked', {
			  channelId, operationId, topEpoch, anchorSeq, firstVisibleSeq,
		  released: Number(step?.released || 0), kind: step?.kind || '',
		  revealRows: Number(revealRows || 0), revealBytes: Number(revealBytes || 0),
		});
			const reachedRestoreTarget = Number(targetSeq) > 0 && firstVisibleSeq > 0
			  && firstVisibleSeq <= Number(targetSeq) && targetMessagePresent;
			if (reachedRestoreTarget || (!revealToken && Number(targetSeq) <= 0 && firstVisibleSeq > 0 && (anchorSeq === 0 || firstVisibleSeq < anchorSeq))) {
			  return { kind: 'satisfied', firstVisibleSeq, projection, step };
			}
			if (revealToken && admissionState?.fulfilled) {
			  settleAdmission('fulfilled');
			  return { kind: 'satisfied', firstVisibleSeq, projection, step, stagedIDs: admissionState.stagedIDs };
			}
			// Raw ledger records do not map 1:1 to visible rows. If this bounded
			// release only advanced filtered/protocol facts, yield a browser task
			// before asking the existing Scheduler for the next segment. This keeps
			// scan liveness without draining the reservoir in one microtask chain;
			// it is not a second scheduler or a geometry-ready acknowledgement.
			await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
		  }
	} finally {
	  operation.release();
	}
  }, []);
  const historyFor = useCallback((channelId) => schedulerRef.current.snapshot(channelId), []);
  const bump = useCallback(() => {
    setVersion((value) => value + 1);
    setIndexVersion((value) => value + 1);
  }, []);
  const markRead = useCallback((channelId, acknowledgement = {}) => {
    if (!channelId) return 0;
    // ReadingSession retains the exact fenced receipt until every downstream
    // authority is current. Feed never keeps a second retry copy.
    if (!cursorsRef.current.isReadAuthorityReady()) return false;
    const state = statesRef.current.get(channelId);
    const before = cursorsRef.current.read(channelId);
    const beforeCounts = unreadCounts(
      state,
      before,
      rosterRef.current?.self(channelId) || '',
      {
        incremental: true,
        acknowledged: cursorsRef.current.acknowledgedReadIdentities(channelId),
      },
    );
    const exactChanged = cursorsRef.current.acknowledgeReadIdentities(
      channelId,
      acknowledgement.identities,
    );
    const seq = Number(acknowledgement.physicalSeq || 0);
    const notificationHydrationChanged = seq > 0
      && notificationHydrationRef.current.serial === localReplicaSerialRef.current
      && notificationHydrationRef.current.channels.delete(channelId);
    if (seq > 0 && trimIfMobile(state)) replicaRef.current.afterTrim(channelId);
    // Provisional stream frames advance the durable read cursor but never draw
    // a rail badge. Publishing a second React render for every such frame used
    // to nearly double the main-thread work while an agent was answering.
    // The rail renders unreadCounts, so clearing it must use that exact
    // semantic projection. unreadCount intentionally excludes weak/system
    // traffic and previously left those badges cached after the viewport had
    // reached the tail.
    const next = seq > 0 ? cursorsRef.current.markRead(channelId, seq) : before;
    if (seq > 0) schedulerRef.current.markRead(channelId);
    const afterCounts = unreadCounts(
      state,
      next,
      rosterRef.current?.self(channelId) || '',
      {
        incremental: true,
        acknowledged: cursorsRef.current.acknowledgedReadIdentities(channelId),
      },
    );
	if (notificationHydrationChanged || ((next !== before || exactChanged)
      && (afterCounts.related !== beforeCounts.related || afterCounts.total !== beforeCounts.total))) {
	  unreadCacheRef.current.delete(channelId);
	  setVersion((value) => value + 1);
	  setIndexVersion((value) => value + 1);
	}
    // The demand port needs acceptance, not mutation: an exact receipt that
    // was already persisted is idempotently accepted and must not be retried.
    return seq > 0 ? next : (exactChanged || (acknowledgement.identities?.length || 0) > 0);
  }, [rosterRef]);
  const acknowledgeNotifications = useCallback((channelId, seq) => {
    if (!channelId || !cursorsRef.current.isReadAuthorityReady()) return false;
    const boundary = Number(seq || 0);
    if (!Number.isSafeInteger(boundary) || boundary <= 0) return false;
    const before = cursorsRef.current.notificationHighWater(channelId);
    const next = cursorsRef.current.acknowledgeNotifications(channelId, boundary);
    if (next !== before) {
      unreadCacheRef.current.delete(channelId);
      setIndexVersion((value) => value + 1);
    }
    return next >= boundary;
  }, []);
  const cancel = useCallback(() => {
    liveBatchRef.current.flushNow();
    attachedGenerationRef.current = 0;
    syncCoordinatorRef.current.connection(false);
    schedulerRef.current.disconnected();
  }, []);
  const clear = useCallback(() => {
    // 缓冲里的行先落地再清:恒不留下一批"清完之后才醒过来"的行,把刚清空的表又
    // 填出半张。
    liveBatchRef.current.flushNow();
    const serial = ++localReplicaSerialRef.current;
    notificationHydrationRef.current = { serial, channels: new Map() };
    schedulerRef.current.clear();
	replicaRef.current.reset();
	statesRef.current = replicaRef.current.states();
	unreadCacheRef.current.clear();
    unreadDiagnosticSignatureRef.current.clear();
    setVersion((value) => value + 1);
    setIndexVersion((value) => value + 1);
  }, []);

  const resetPersistent = useCallback(async () => {
    liveBatchRef.current.flushNow();
    const serial = ++localReplicaSerialRef.current;
    notificationHydrationRef.current = { serial, channels: new Map() };
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
	const principalChanged = preparedPrincipalRef.current !== principalId;
	if (principalChanged) {
	  attachedGenerationRef.current = 0;
	}
	schedulerRef.current.setLocalMeta(new Map(), { publishChange: false, localReady: false });
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
      notificationHydrationRef.current = { serial, channels: new Map() };
      cursorsRef.current.clearReadAuthority();
	  schedulerRef.current.setLocalMeta(new Map(), { publishChange: false, localReady: true });
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
    if (principalChanged) cursorsRef.current.clearReadAuthority();
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
        // The synchronous attach already selected the remote read authority;
        // an older/empty cache completion must not revoke it and suppress live
        // rail publication in the meantime.
        cacheMetaRef.current = new Map();
        setLocalReplicaReady(true);
        return { resume: {} };
      }
      const readAuthority = cursorsRef.current.selectReadAuthority({
        principalId,
        // Attach can establish the current world while an empty IndexedDB
        // owner lookup is still resolving. Empty cache metadata is not a
        // competing world and must never revoke that newer remote authority.
        serverBoot: remoteBoot || cacheBootRef.current,
      });
      if (readAuthority.changed || !readAuthority.reused) unreadCacheRef.current.clear();
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
      beginNotificationHydration(meta, serial, focus);
      if (focus) schedulerRef.current.focus(focus);
      schedulerRef.current.setLocalMeta(meta, { publishChange: false, localReady: true });

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
	  schedulerRef.current.setLocalMeta(new Map(), { publishChange: false, localReady: true });
      setLocalReplicaReady(true);
      return { resume: {} };
    }
  }, [beginNotificationHydration, onError]);

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
			if (lifecycleRef.current === lifecycle) syncCoordinatorRef.current?.destroy();
      });
    };
  }, []);
  return {
    statesRef, cursorsRef, version, indexVersion, bump, enqueue, cancel, clear, resetPersistent,
	revisionFor: (channelId) => replicaRef.current.revision(channelId),
	unreadFor,
		prepareLocalReplica, resumeLocalReplica, localReplicaReady,
		setHistoryGrants, pageEnd, liveCheckpoint, disconnectHistory, focusHistory, generationFor, refreshChannel,
    historyFor: (channelId) => ({
      ...schedulerRef.current.snapshot(channelId),
      presentationAdmission: presentationAdmissionRef.current,
      presentationAdmissionState: presentationAdmissionRef.current.snapshot(channelId),
      // The remote head may end in protocol facts that intentionally have no
      // visible row. Reading readiness therefore joins against the semantic
      // revision consumed by Presentation, not a visible seq approximation.
      presentationRevision: Number(replicaRef.current.state(channelId)?._timelineRevision || 0),
      sync: syncCoordinatorRef.current.snapshot(channelId),
    }),
		loadHistory, markRead, acknowledgeNotifications,
  };
}
