import { argsOf, FINAL } from '../protocol/envelope.js';
import { MOBILE_WINDOW, trimChannelState } from './memory-window.js';
import { isMobileProfile } from './device-profile.js';
import { abbreviateToolRow } from './payload-abbreviate.js';
import { createFrameBatcher } from './frame-batcher.js';
import { createCursors, unreadCountDiagnostics, unreadCounts } from './cursors.js';
import { createFeedCache, resumeSnapshot } from './feed-cache.js';
import {
  createChannelState,
  reconcileApprovals,
} from './fold.js';
import { recordLivePresentationArrival, recordLiveTimelineArrival } from './live-arrivals.js';
import { invalidatesChannelDirectory } from './directory-invalidation.js';
import {
  createHistoryScheduler,
  HISTORY_BATCH_TIMEOUT_MS,
  HISTORY_RESERVOIR_SIZE,
} from './history-scheduler.js';
import {
  diagnostic,
  isReadingTraceEnabled,
  readingTrace,
  registerRailDiagnosticProvider,
} from './diagnostics.js';
import { selectTimelineItems } from './timeline-projection.js';
import { turnStartObservation } from './turn-process.js';
import { createChannelReplicaStore } from './channel-replica.js';
import { cacheWorldMismatch, createPersistenceEpochFence, createSyncObligationCoordinator } from './sync-session.js';
import { createHistoryPresentationAdmission } from './history-presentation-admission.js';

export { HISTORY_RESERVOIR_SIZE };

const FEED_OWNER_TOKEN = Symbol('feed-owner-token');

function trimIfMobile(state) {
  if (!state || !isMobileProfile()) return 0;
  return trimChannelState(state, MOBILE_WINDOW);
}

export function createChannelFeedRuntime(options) {
  const { wireRef, rosterRef, accessRef, activeChannelRef } = options;
  let bindings = options;
  const port = (name) => (...args) => bindings[name]?.(...args);
  const [onRoster, onError, onChannelsDiscovered, onDirectoryInvalidated,
    onTimerFired, onSubmissionFeed, onAccessChanged, onAgentActivity] = [
    'onRoster', 'onError', 'onChannelsDiscovered', 'onDirectoryInvalidated',
    'onTimerFired', 'onSubmissionFeed', 'onAccessChanged', 'onAgentActivity',
  ].map(port);
  const subscribers = new Set();
  const ownerCommandCache = new Map();
  const effects = [];
  const cell = (current) => ({ current });
  const registerEffect = (setup) => effects.push(setup);
  let version = 0;
  let indexVersion = 0;
  let localReplicaReady = false;
  let localReplicaError = '';
  let localReplicaErrorCode = '';
  let publicSnapshot = null;
  let buildPublicSnapshot = null;
  const notify = () => {
    if (buildPublicSnapshot) publicSnapshot = buildPublicSnapshot();
    for (const subscriber of subscribers) subscriber();
  };
  const stateSetter = (read, write) => (next) => {
    const previous = read();
    const value = typeof next === 'function' ? next(previous) : next;
    if (Object.is(previous, value)) return;
    write(value);
    notify();
  };
  const setVersion = stateSetter(() => version, (value) => { version = value; });
  const setIndexVersion = stateSetter(() => indexVersion, (value) => { indexVersion = value; });
  const setLocalReplicaReady = stateSetter(() => localReplicaReady, (value) => { localReplicaReady = value; });
  const setLocalReplicaError = stateSetter(() => localReplicaError, (value) => { localReplicaError = value; });
  const setLocalReplicaErrorCode = stateSetter(() => localReplicaErrorCode, (value) => { localReplicaErrorCode = value; });
  const committedOwnerTokenRef = cell(null);
  const cursorsRef = cell(null);
  if (cursorsRef.current === null) cursorsRef.current = createCursors(globalThis.localStorage, { requireReadAuthority: true });
  const cacheRef = cell(null);
  if (cacheRef.current === null) cacheRef.current = createFeedCache();
  const cacheMetaRef = cell(new Map());
  const cacheBootRef = cell('');
  const remoteBootRef = cell('');
  const resumeReadyRef = cell(false);
  const cacheOwnerReadyRef = cell(Promise.resolve());
  const cacheEpochFenceRef = cell(null);
  if (cacheEpochFenceRef.current === null) cacheEpochFenceRef.current = createPersistenceEpochFence();
  const attachMetaSerialRef = cell(0);
  const dataAdmissionEpochRef = cell(0);
  const dataGrantedChannelIdsRef = cell(new Set());
  const dataGrantedChannelHeadsRef = cell(new Map());
  const dataGrantSetEstablishedRef = cell(false);
  const replicaRef = cell(null);
  if (replicaRef.current === null) replicaRef.current = createChannelReplicaStore();
  const presentationAdmissionRef = cell(null);
  if (presentationAdmissionRef.current === null) {
    presentationAdmissionRef.current = createHistoryPresentationAdmission({
      onChange: (channelId) => {
        if (channelId === activeChannelRef.current) setVersion((value) => value + 1);
      },
    });
  }
  const statesRef = cell(replicaRef.current.states());
  const applyRowsRef = cell(null);
  const schedulerRef = cell(null);
  const incompatibleRef = cell(false);
  const localReplicaSerialRef = cell(0);
  const preparedPrincipalRef = cell('');
  const liveBatchRef = cell(null);
  const unreadCacheRef = cell(new Map());
  const unreadDiagnosticSignatureRef = cell(new Map());
  const notificationHydrationRef = cell({ serial: 0, channels: new Map() });
  const syncCoordinatorRef = cell(null);
  const attachedGenerationRef = cell(0);
  const notificationAuthorityRevisionRef = cell(0);

  const unreadFor = ((channelId, selfId = '') => {
    if (!cursorsRef.current.isReadAuthorityReady()) return { related: 0, total: 0, pending: true };
    const state = replicaRef.current.state(channelId);
    const revision = replicaRef.current.revision(channelId);
    const notificationHighWater = cursorsRef.current.notificationHighWater(channelId);
    const cached = unreadCacheRef.current.get(channelId);
    let counts = cached?.revision === revision
      && cached?.notificationHighWater === notificationHighWater
      && cached?.selfId === selfId
      ? cached.counts
      : null;
    if (!counts) {
      counts = unreadCounts(state, notificationHighWater, selfId, { incremental: true });
      unreadCacheRef.current.set(channelId, {
        revision,
        notificationHighWater,
        selfId,
        counts,
      });
    }
    if (isReadingTraceEnabled()) {
      const signature = `${revision}:${notificationHighWater}:${selfId}`;
      if (unreadDiagnosticSignatureRef.current.get(channelId) !== signature) {
        unreadDiagnosticSignatureRef.current.set(channelId, signature);
        readingTrace('notification.rail-classification', () => ({
          channelId,
          notificationHighWater,
          ...unreadCountDiagnostics(state, notificationHighWater, selfId, { incremental: true }),
        }));
      }
    }
    const hydration = notificationHydrationRef.current.serial === localReplicaSerialRef.current
      ? notificationHydrationRef.current.channels.get(channelId)
      : '';
    const hydrationPhase = typeof hydration === 'string' ? hydration : hydration?.phase;
    if (hydrationPhase === 'pending') return { ...counts, pending: true };
    if (hydrationPhase === 'unknown') return { ...counts, unknown: true };
    return counts;
  });

  registerEffect(() => registerRailDiagnosticProvider((requestedChannelId = '') => {
    const channels = [];
    for (const [channelId, state] of statesRef.current) {
      if (requestedChannelId && channelId !== requestedChannelId) continue;
      const readSeq = cursorsRef.current.read(channelId);
      const notificationHighWater = cursorsRef.current.notificationHighWater(channelId);
      channels.push(Object.freeze({
        channelId,
        authorityReady: cursorsRef.current.isReadAuthorityReady(),
        notificationHydration: notificationHydrationRef.current.serial === localReplicaSerialRef.current
          ? notificationHydrationRef.current.channels.get(channelId)?.phase
            || notificationHydrationRef.current.channels.get(channelId)
            || 'ready'
          : 'stale',
        readSeq,
        notificationHighWater,
        ...unreadCountDiagnostics(
          state,
          notificationHighWater,
          rosterRef.current?.self(channelId) || '',
          { incremental: true },
        ),
      }));
    }
    return Object.freeze({ version: 1, channels: Object.freeze(channels) });
  }));

  const applyRows = ((rows, {
    publish = true,
    source = 'replay',
    materializesCurrentTail = source === 'live',
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
      if (source === 'live' && rowOwnerToken !== committedOwnerTokenRef.current) continue;
      const roster = rosterRef.current;
      const selfId = roster?.self(channelId) || '';
      const ownedSubmission = source === 'live'
        && row.envelope?.kind === 'request'
        && roster?.ownsSubmission?.(channelId, row.envelope?.id) === true;
      const landed = replicaRef.current.commit(
        row,
        selfId,
        isMobileProfile() ? abbreviateToolRow : (value) => value,
      );
      if (!landed.accepted) continue;
      const state = landed.record.state;
      const rowSubmissionFacts = submissionFacts(rowOwnerToken);
      acceptedRows?.push(row);
      if (materializesCurrentTail
        && cursorsRef.current.isReadAuthorityReady()
        && seq > cursorsRef.current.notificationHighWater(channelId)) {
        const arrivalSelfId = ownedSubmission ? row.envelope?.sender?.id || selfId : selfId;
        recordLiveTimelineArrival(state, row.envelope, seq, arrivalSelfId);
      }
      if (source === 'live' && materializesCurrentTail) {
        recordLivePresentationArrival(state, row.envelope, seq);
      }
      changed += 1;
      if (source === 'live') accessChanged = Boolean(accessRef.current?.live(channelId)) || accessChanged;
      dirtyChannels.add(channelId);
      if (channelId !== activeChannelRef.current && trimIfMobile(state)) replicaRef.current.afterTrim(channelId);
      const learnedSelf = roster?.observeFeed(channelId, row.envelope);
      if (learnedSelf) {
        reconcileApprovals(state, learnedSelf);
        rosterChanged = true;
      }
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
    if (publish) {
      setIndexVersion((value) => value + 1 + Number(rosterChanged));
      if (dirtyChannels.has(activeChannelRef.current)) setVersion((value) => value + 1 + Number(rosterChanged));
    }
    return changed;
  });
  applyRowsRef.current = applyRows;

  const beginNotificationHydration = ((meta, serial, focus = '') => {
    if (incompatibleRef.current || serial !== localReplicaSerialRef.current) return;
    const admissionEpoch = dataAdmissionEpochRef.current;
    const grantEstablished = dataGrantSetEstablishedRef.current;
    const grantedHeads = new Map(dataGrantedChannelHeadsRef.current);
    const channels = grantEstablished
      && notificationHydrationRef.current.serial === serial
      ? new Map(notificationHydrationRef.current.channels)
      : new Map();
    const queue = [];
    if (grantEstablished) {
      for (const channelId of channels.keys()) {
        if (!grantedHeads.has(channelId)) channels.delete(channelId);
      }
      for (const [channelId, target] of grantedHeads) {
        const notificationHighWater = cursorsRef.current.notificationHighWater(channelId);
        if (target <= notificationHighWater) channels.delete(channelId);
        else if (!channels.has(channelId)) channels.set(channelId, { phase: 'unknown', target });
      }
    } else {
      for (const [channelId, channelMeta] of meta) {
        const target = Math.max(
          Number(channelMeta?.newestSeq || 0),
          ...(channelMeta?.coverage || []).map((range) => Number(range?.highSeq || 0)),
        );
        if (target > cursorsRef.current.notificationHighWater(channelId)) {
          channels.set(channelId, { phase: 'unknown', target });
        }
      }
    }
    for (const [channelId, obligation] of channels) {
      if (grantEstablished && !grantedHeads.has(channelId)) continue;
      const channelMeta = meta.get(channelId);
      const newest = Math.max(
        Number(channelMeta?.newestSeq || 0),
        ...(channelMeta?.coverage || []).map((range) => Number(range?.highSeq || 0)),
      );
      const notificationHighWater = cursorsRef.current.notificationHighWater(channelId);
      if (Number(obligation.target || 0) <= notificationHighWater) {
        channels.delete(channelId);
        continue;
      }
      if (!channelMeta || newest <= notificationHighWater || channelId === focus) {
        channels.set(channelId, { ...obligation, phase: 'unknown' });
        continue;
      }
      channels.set(channelId, {
        ...obligation,
        phase: newest >= Number(obligation.target || 0) ? 'pending' : 'unknown',
      });
      queue.push({
        channelId,
        notificationHighWater,
        cachedNewest: newest,
        target: Number(obligation.target || 0),
      });
    }
    const hydration = { serial, channels };
    notificationHydrationRef.current = hydration;
    setIndexVersion((value) => value + 1);
    if (!queue.length) return;
    void (async () => {
      for (const { channelId, notificationHighWater, cachedNewest, target } of queue) {
        if (serial !== localReplicaSerialRef.current
          || admissionEpoch !== dataAdmissionEpochRef.current
          || notificationHydrationRef.current !== hydration) return;
        if (dataGrantSetEstablishedRef.current
          && !dataGrantedChannelIdsRef.current.has(channelId)) {
          channels.delete(channelId);
          continue;
        }
        if (activeChannelRef.current === channelId) {
          channels.set(channelId, { phase: 'unknown', target });
          continue;
        }
        try {
          const result = typeof cacheRef.current.readNotificationContext === 'function'
            ? await cacheRef.current.readNotificationContext(channelId, notificationHighWater, {
              isCurrent: () => serial === localReplicaSerialRef.current
                && admissionEpoch === dataAdmissionEpochRef.current
                && notificationHydrationRef.current === hydration
                && (!dataGrantSetEstablishedRef.current
                  || dataGrantedChannelIdsRef.current.has(channelId))
                && activeChannelRef.current !== channelId,
            })
            : { complete: false, cancelled: false, rows: [], missingParents: [] };
          if (serial !== localReplicaSerialRef.current
            || admissionEpoch !== dataAdmissionEpochRef.current
            || notificationHydrationRef.current !== hydration
            || result.cancelled) return;
          if (dataGrantSetEstablishedRef.current
            && !dataGrantedChannelIdsRef.current.has(channelId)) {
            channels.delete(channelId);
            continue;
          }
          if (activeChannelRef.current === channelId) {
            channels.set(channelId, { phase: 'unknown', target });
            continue;
          }
          if (!result.complete) {
            channels.set(channelId, { phase: 'unknown', target });
            diagnostic('warn', 'feed.notification_cache_incomplete', {
              channelId,
              notificationHighWater,
              missingParents: result.missingParents || [],
            });
            continue;
          }
          applyRows(result.rows, { publish: false, source: 'replay' });
          unreadCacheRef.current.delete(channelId);
          if (cachedNewest >= target) channels.delete(channelId);
          else channels.set(channelId, { phase: 'unknown', target });
        } catch (error) {
          if (serial !== localReplicaSerialRef.current
            || admissionEpoch !== dataAdmissionEpochRef.current) return;
          channels.set(channelId, { phase: 'unknown', target });
          diagnostic('warn', 'feed.notification_cache_failed', { channelId, notificationHighWater, error });
          onError(error);
        }
        await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
      }
      if (serial !== localReplicaSerialRef.current
        || admissionEpoch !== dataAdmissionEpochRef.current
        || notificationHydrationRef.current !== hydration) return;
      setIndexVersion((value) => value + 1);
    })();
  });

  if (schedulerRef.current === null || (!incompatibleRef.current && schedulerRef.current.isDestroyed?.())) {
    const mobile = isMobileProfile();
    schedulerRef.current = createHistoryScheduler({
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
	  hasMaterializedRows: (channelId) => replicaRef.current.visibleNewest(channelId) > 0,
	  visibleOldestSeq: (channelId) => replicaRef.current.visibleOldest(channelId),
	  visibleNewestSeq: (channelId) => replicaRef.current.visibleNewest(channelId),
	  revealRows: (channelId, entries, { materializesCurrentTail = false } = {}) => {
		liveBatchRef.current?.flushNow();
		return applyRowsRef.current?.(
		  entries.map(([seq, envelope]) => ({ channel_id: channelId, seq, envelope })),
			  { source: 'replay', materializesCurrentTail },
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

  const landLiveEvents = ((events) => {
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
        source: payload.source || 'live',
        generation: Number(payload.generation || 0),
      };
      Object.defineProperty(row, FEED_OWNER_TOKEN, { value: event.ownerToken });
      return row;
    });
    const acceptedRows = [];
    applyRowsRef.current?.(
      rows,
      { source: 'live', acceptedRows },
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
  });
  const landLiveEventsRef = cell(landLiveEvents);
  landLiveEventsRef.current = landLiveEvents;
  if (!liveBatchRef.current) liveBatchRef.current = createFrameBatcher((batch) => landLiveEventsRef.current(batch));

  registerEffect(() => {
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
  });

  const enqueue = ((payloadOrChannel, seq, envelope, detail, producerOwnerToken = committedOwnerTokenRef.current) => {
	if (incompatibleRef.current) return false;
	const payload = typeof payloadOrChannel === 'object'
	  ? payloadOrChannel
	  : detail || { channel_id: payloadOrChannel, seq, envelope, source: 'live' };
	const historical = schedulerRef.current.historyRow(payload);
	if (historical) {
	  onAgentActivity?.(payload);
	  return true;
	}
    liveBatchRef.current.push({ kind: 'row', payload, ownerToken: producerOwnerToken });
	return true;
	});

  const setHistoryGrants = ((grants = [], detail = {}) => {
    if (incompatibleRef.current) {
      return Promise.resolve({ stale: true, incompatible: true, meta: new Map() });
    }
    const generation = Number(detail.generation || 0);
    if (!Number.isSafeInteger(generation) || generation <= 0
      || generation < attachedGenerationRef.current) {
      return Promise.resolve({ stale: true, meta: cacheMetaRef.current });
    }
    const serial = ++attachMetaSerialRef.current;
    dataAdmissionEpochRef.current += 1;
    const admissionEpoch = dataAdmissionEpochRef.current;
    const grantedChannelHeads = new Map(grants.flatMap((entry) => {
      const channelId = String(entry?.channel_id || '');
      return channelId ? [[channelId, Math.max(0, Number(entry?.head_seq || 0))]] : [];
    }));
    dataGrantedChannelIdsRef.current = new Set(grantedChannelHeads.keys());
    dataGrantedChannelHeadsRef.current = grantedChannelHeads;
    dataGrantSetEstablishedRef.current = true;
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
    if (readAuthority.changed) notificationAuthorityRevisionRef.current += 1;
    if (readAuthority.changed || !readAuthority.reused) unreadCacheRef.current.clear();
    const worldMismatch = cacheWorldMismatch(remoteBoot, cacheBootRef.current, cacheMetaRef.current);
    const replicaChanged = detail.forceReset === true || worldMismatch;

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
      setLocalReplicaReady(false);
    }
    const localMeta = replicaChanged ? new Map() : cacheMetaRef.current;
    const grantedChannelIds = new Set();
    const notificationChannels = new Map();
    for (const entry of grants) {
      if (!entry?.channel_id) continue;
      grantedChannelIds.add(entry.channel_id);
      cursorsRef.current.baselineRead(entry.channel_id, entry.head_seq);
      cursorsRef.current.baselineNotifications(entry.channel_id, entry.head_seq);
      replicaRef.current.installMeta(entry.channel_id, {
        headSeq: entry.head_seq,
        coverage: localMeta.get(entry.channel_id)?.coverage,
      });
      const target = Math.max(0, Number(entry.head_seq || 0));
      if (target > cursorsRef.current.notificationHighWater(entry.channel_id)) {
        notificationChannels.set(entry.channel_id, { phase: 'unknown', target });
      }
    }
    notificationHydrationRef.current = {
      serial: localReplicaSerialRef.current,
      channels: notificationChannels,
    };
    schedulerRef.current.attach(grants, {
      generation,
      focus: detail.focus || activeChannelRef.current || '',
      localMeta,
    });
    schedulerRef.current.setLocalMeta(localMeta, {
      publishChange: false,
      localReady: localReplicaReady,
      replace: true,
    });
    beginNotificationHydration(
      localMeta,
      localReplicaSerialRef.current,
      detail.focus || activeChannelRef.current || '',
    );
    syncCoordinatorRef.current.admission(grantedChannelIds, { generation });
    const activeChannelId = activeChannelRef.current;
    const activeChannelGranted = grantedChannelIds.has(activeChannelId);
    const syncBeforeAttach = activeChannelId
      ? syncCoordinatorRef.current.snapshot(activeChannelId)
      : null;
    syncCoordinatorRef.current.connection(true);
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
      if (incompatibleRef.current
        || serial !== attachMetaSerialRef.current
        || admissionEpoch !== dataAdmissionEpochRef.current) return { changed, meta, stale: true };
      cacheBootRef.current = String(boot || remoteBoot);
      cacheMetaRef.current = meta;
      resumeReadyRef.current = true;
      for (const [channelId, value] of meta) {
        if (grantedChannelIds.has(channelId)) replicaRef.current.installMeta(channelId, value);
      }
      schedulerRef.current.setLocalMeta(meta, {
        publishChange: false,
        localReady: true,
        replace: true,
      });
      beginNotificationHydration(
        meta,
        localReplicaSerialRef.current,
        detail.focus || activeChannelRef.current || '',
      );
      setLocalReplicaReady(true);
      setLocalReplicaError('');
      setLocalReplicaErrorCode('');
      return { changed: replicaChanged || changed, meta };
    }).catch((error) => {
      if (!incompatibleRef.current
        && serial === attachMetaSerialRef.current
        && admissionEpoch === dataAdmissionEpochRef.current) {
        resumeReadyRef.current = false;
        schedulerRef.current.setLocalMeta(new Map(), {
          publishChange: false,
          localReady: false,
          replace: true,
        });
        diagnostic('error', 'feed.cache_boot_check_failed', { generation, error });
        onError(error);
        setLocalReplicaReady(false);
        setLocalReplicaError(error?.message || '本地缓存初始化失败');
        setLocalReplicaErrorCode(String(error?.code || 'cache_boot_failed'));
      }
      return { changed: replicaChanged, meta: new Map(), error };
    });
  });

  const pageEnd = ((payload) => {
    if (incompatibleRef.current) return false;
    const accepted = schedulerRef.current.pageEnd(payload);
    if (!accepted) diagnostic('warn', 'feed.page_end_ignored', {
      channelId: payload?.channel_id, source: payload?.source, ref: payload?.ref, generation: payload?.generation,
    });
    return accepted;
  });

  const liveCheckpoint = ((payload = {}, producerOwnerToken = committedOwnerTokenRef.current) => {
    if (incompatibleRef.current) return false;
    const channelId = payload.channel_id;
    const lowSeq = Number(payload.scan_low_seq);
    const highSeq = Number(payload.scanned_seq);
    if (!channelId || !Number.isSafeInteger(lowSeq) || !Number.isSafeInteger(highSeq) || lowSeq <= 0 || highSeq < lowSeq) {
      diagnostic('warn', 'feed.live_checkpoint_invalid', payload);
      return false;
    }
    liveBatchRef.current.push({ kind: 'checkpoint', payload, ownerToken: producerOwnerToken });
    diagnostic('debug', 'feed.live_checkpoint', { channelId, lowSeq, highSeq, generation: payload.generation });
    return true;
  });

  const focusHistory = ((channelId) => {
    if (!incompatibleRef.current) schedulerRef.current.focus(channelId);
  });
  const generationFor = ((channelId) => (
    Number(schedulerRef.current?.snapshot(channelId)?.generation || 0)
  ));
  const refreshChannel = ((channelId) => {
	if (!channelId || incompatibleRef.current) return Promise.resolve(false);
	return syncCoordinatorRef.current.interest(channelId);
  });
  const disconnectHistory = ((generation) => {
    liveBatchRef.current.flushNow();
	diagnostic('info', 'feed.connection_reset', { generation });
    attachedGenerationRef.current = 0;
    syncCoordinatorRef.current.connection(false);
    schedulerRef.current.disconnected(generation);
  });
  const stopIncompatible = ((generation) => {
    incompatibleRef.current = true;
    localReplicaSerialRef.current += 1;
    attachMetaSerialRef.current += 1;
    dataAdmissionEpochRef.current += 1;
    notificationHydrationRef.current = {
      serial: localReplicaSerialRef.current,
      channels: new Map(),
    };
    resumeReadyRef.current = false;
    liveBatchRef.current.discard();
    attachedGenerationRef.current = 0;
    syncCoordinatorRef.current.destroy();
    schedulerRef.current.destroy();
    diagnostic('warn', 'feed.version_incompatible', { generation });
  });
  const loadHistory = (async (channelId, {
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
	explicitRetry = false,
	onOperation,
    historyRevealIntent = null,
  } = {}) => {
	if (incompatibleRef.current) return { kind: 'cancelled', reason: 'version-incompatible' };
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
	const operation = schedulerRef.current.beginOperation(channelId, {
	  signal, intent, urgency, explicitRetry,
	});
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
		const projection = selectTimelineItems(statesRef.current.get(channelId) || createChannelState(channelId), viewSpec);
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
			await new Promise((resolve) => {
			  let settled = false;
			  const finish = () => {
				if (settled) return;
				settled = true;
				globalThis.clearTimeout(timer);
				signal?.removeEventListener('abort', finish);
				resolve();
			  };
			  const timer = globalThis.setTimeout(finish, 0);
			  signal?.addEventListener('abort', finish, { once: true });
			  if (signal?.aborted) finish();
			});
		  }
	} finally {
	  operation.release();
	}
  });
  const historyFor = ((channelId) => schedulerRef.current.snapshot(channelId));
  const coldEntryDiagnosticsFor = ((channelId) => {
    const state = replicaRef.current.state(channelId);
    return Object.freeze({
      feed: Object.freeze({
        localReplicaReady,
        localReplicaErrorCode: String(localReplicaErrorCode || ''),
        admissionEpoch: dataAdmissionEpochRef.current,
        grantEstablished: dataGrantSetEstablishedRef.current,
        granted: dataGrantedChannelIdsRef.current.has(channelId),
      }),
      replica: Object.freeze({
        revision: replicaRef.current.revision(channelId),
        rows: Number(state?.rows?.size || 0),
        lastSeq: Number(state?.lastSeq || 0),
        projectionRevision: Number(state?._timelineProjectionVersion || 0),
        semanticRevision: Number(state?._timelineRevision || 0),
      }),
      scheduler: schedulerRef.current.debugSnapshot(channelId),
    });
  });
  const bump = (() => {
    setVersion((value) => value + 1);
    setIndexVersion((value) => value + 1);
  });
  const stateFor = (channelId) => replicaRef.current.state(channelId);
  const stateEntries = () => Object.freeze([...replicaRef.current.states().entries()]);
  const reconcileIdentity = (channelId, selfId) => {
    if (!channelId || !selfId) return false;
    const state = replicaRef.current.state(channelId);
    if (!state) return false;
    reconcileApprovals(state, selfId);
    bump();
    return true;
  };
  const markRead = ((channelId, acknowledgement = {}) => {
    if (!channelId) return 0;
    if (!cursorsRef.current.isReadAuthorityReady()) return false;
    const state = statesRef.current.get(channelId);
    const seq = Number(acknowledgement.physicalSeq || 0);
    if (seq > 0 && trimIfMobile(state)) replicaRef.current.afterTrim(channelId);
    const next = seq > 0 ? cursorsRef.current.markRead(channelId, seq) : 0;
    if (seq > 0) schedulerRef.current.markRead(channelId);
    return seq > 0 ? next : false;
  });
  const acknowledgeNotifications = ((channelId, confirmation = {}) => {
    if (!channelId || !cursorsRef.current.isReadAuthorityReady()) return false;
    if (confirmation.channelId !== channelId) return false;
    if (Number(confirmation.generation || 0) !== attachedGenerationRef.current
      || !dataGrantSetEstablishedRef.current
      || !dataGrantedChannelIdsRef.current.has(channelId)) return false;
    if (Number(confirmation.authorityRevision || 0)
      !== notificationAuthorityRevisionRef.current) return false;
    const boundary = Number(confirmation.boundary || 0);
    if (!Number.isSafeInteger(boundary) || boundary <= 0) return false;
    const before = cursorsRef.current.notificationHighWater(channelId);
    const next = cursorsRef.current.acknowledgeNotifications(channelId, boundary);
    const hydration = notificationHydrationRef.current;
    const obligation = hydration.serial === localReplicaSerialRef.current
      ? hydration.channels.get(channelId)
      : null;
    const hydrationChanged = Number(obligation?.target || 0) > 0
      && boundary >= Number(obligation.target || 0)
      && hydration.channels.delete(channelId);
    if (next !== before || hydrationChanged) {
      unreadCacheRef.current.delete(channelId);
      setIndexVersion((value) => value + 1);
    }
    return next >= boundary;
  });
  const cancel = (() => {
    liveBatchRef.current.flushNow();
    attachedGenerationRef.current = 0;
    syncCoordinatorRef.current.connection(false);
    schedulerRef.current.disconnected();
  });
  const clear = (() => {
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
  });

  const resetPersistent = (async () => {
    liveBatchRef.current.flushNow();
    const serial = ++localReplicaSerialRef.current;
    const admissionEpoch = dataAdmissionEpochRef.current;
    notificationHydrationRef.current = { serial, channels: new Map() };
    await cacheEpochFenceRef.current.run(() => cacheRef.current.clear());
	if (serial !== localReplicaSerialRef.current || admissionEpoch !== dataAdmissionEpochRef.current) return false;
	replicaRef.current.reset();
	statesRef.current = replicaRef.current.states();
	unreadCacheRef.current.clear();
    cursorsRef.current.reconcile({});
    setVersion((value) => value + 1);
    setIndexVersion((value) => value + 1);
    return true;
  });

  const prepareLocalReplica = (async (principalId, { focus = '' } = {}) => {
    if (incompatibleRef.current) return { resume: {} };
    const serial = ++localReplicaSerialRef.current;
	dataGrantedChannelIdsRef.current = new Set();
	dataGrantedChannelHeadsRef.current = new Map();
	dataGrantSetEstablishedRef.current = false;
	const principalChanged = preparedPrincipalRef.current !== principalId;
	if (principalChanged) {
	  attachedGenerationRef.current = 0;
	}
	schedulerRef.current.setLocalMeta(new Map(), {
	  publishChange: false,
	  localReady: false,
	});
    attachMetaSerialRef.current += 1;
    resumeReadyRef.current = false;
    cacheMetaRef.current = new Map();
    cacheBootRef.current = '';
    remoteBootRef.current = '';
    if (!principalId) {
      preparedPrincipalRef.current = '';
      notificationHydrationRef.current = { serial, channels: new Map() };
      cursorsRef.current.clearReadAuthority();
	  schedulerRef.current.setLocalMeta(new Map(), {
	    publishChange: false,
	    localReady: true,
	    replace: true,
	  });
      setLocalReplicaReady(true);
      return { resume: {} };
    }
    if (preparedPrincipalRef.current && preparedPrincipalRef.current !== principalId) {
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
    setLocalReplicaError('');
    setLocalReplicaErrorCode('');
    schedulerRef.current.setPriorityScope(principalId);
    const admissionEpochAtSelection = dataAdmissionEpochRef.current;
    const ownerReady = cacheEpochFenceRef.current.select(() => cacheRef.current.ensureOwner(principalId));
    cacheOwnerReadyRef.current = ownerReady;
    let selectionTimer = null;
    try {
      const { changed, boot, meta } = await Promise.race([
        ownerReady,
        new Promise((_, reject) => {
          selectionTimer = globalThis.setTimeout(() => {
            const error = new Error('本地缓存初始化超时，请重试');
            error.code = 'cache_selection_timeout';
            void Promise.resolve(cacheRef.current.cancelOwnerSelection?.()).catch((cancelError) => {
              diagnostic('error', 'feed.cache_selection_cancel_failed', { error: cancelError });
            });
            reject(error);
          }, HISTORY_BATCH_TIMEOUT_MS);
        }),
      ]);
      if (selectionTimer != null) globalThis.clearTimeout(selectionTimer);
      if (serial !== localReplicaSerialRef.current) return { resume: {} };
      if (admissionEpochAtSelection !== dataAdmissionEpochRef.current) {
        return { resume: {} };
      }
      cacheBootRef.current = String(boot || '');
      const remoteBoot = remoteBootRef.current;
      if (cacheWorldMismatch(remoteBoot, cacheBootRef.current, meta)) {
        cacheMetaRef.current = new Map();
        setLocalReplicaReady(false);
        return { resume: {} };
      }
      const readAuthority = cursorsRef.current.selectReadAuthority({
        principalId,
        serverBoot: remoteBoot || cacheBootRef.current,
      });
      if (readAuthority.changed) notificationAuthorityRevisionRef.current += 1;
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
      for (const channelId of meta.keys()) {
		replicaRef.current.installMeta(channelId, meta.get(channelId));
      }
      beginNotificationHydration(meta, serial, focus);
      if (focus) schedulerRef.current.focus(focus);
      schedulerRef.current.setLocalMeta(meta, {
        publishChange: false,
        localReady: true,
        replace: true,
      });

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
      setLocalReplicaError('');
      setLocalReplicaErrorCode('');
      return { resume: resumeSnapshot(meta) };
    } catch (error) {
      if (selectionTimer != null) globalThis.clearTimeout(selectionTimer);
      if (serial !== localReplicaSerialRef.current) return { resume: {} };
      onError(error);
      diagnostic('error', 'feed.restore_failed', { error });
	  schedulerRef.current.setLocalMeta(new Map(), {
	    publishChange: false,
	    localReady: false,
	    replace: true,
	  });
	  setLocalReplicaReady(false);
      setLocalReplicaError(error?.message || '本地缓存初始化失败');
      setLocalReplicaErrorCode(String(error?.code || 'cache_selection_failed'));
      return { resume: {} };
    }
  });

  const resumeLocalReplica = (() => (
    !incompatibleRef.current && resumeReadyRef.current
      ? resumeSnapshot(cacheRef.current.metaSnapshot())
      : {}
  ));

  const commands = Object.freeze({
    cursorsRef, version, indexVersion, bump, enqueue, cancel, clear, resetPersistent,
	revisionFor: (channelId) => replicaRef.current.revision(channelId),
	stateFor, stateEntries, reconcileIdentity,
	unreadFor,
		prepareLocalReplica, resumeLocalReplica, localReplicaReady, localReplicaError, localReplicaErrorCode,
		setHistoryGrants, pageEnd, liveCheckpoint, disconnectHistory, stopIncompatible, focusHistory, generationFor, refreshChannel,
    coldEntryDiagnosticsFor,
    historyFor: (channelId) => ({
      ...schedulerRef.current.snapshot(channelId),
      notificationAuthorityRevision: notificationAuthorityRevisionRef.current,
      presentationAdmission: presentationAdmissionRef.current,
      presentationAdmissionState: presentationAdmissionRef.current.snapshot(channelId),
      presentationRevision: Number(replicaRef.current.state(channelId)?._timelineRevision || 0),
      sync: syncCoordinatorRef.current.snapshot(channelId),
    }),
		loadHistory, markRead, acknowledgeNotifications,
  });
  buildPublicSnapshot = () => Object.freeze({
    ...commands,
    version,
    indexVersion,
    localReplicaReady,
    localReplicaError,
    localReplicaErrorCode,
  });
  publicSnapshot = buildPublicSnapshot();

  let mountGeneration = 0;
  let mounted = false;
  let destroyed = false;
  let cleanups = [];

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    localReplicaSerialRef.current += 1;
    attachMetaSerialRef.current += 1;
    dataAdmissionEpochRef.current += 1;
    notificationHydrationRef.current = {
      serial: localReplicaSerialRef.current,
      channels: new Map(),
    };
    committedOwnerTokenRef.current = null;
    liveBatchRef.current?.discard();
    syncCoordinatorRef.current?.destroy();
    schedulerRef.current?.destroy();
    cacheRef.current?.destroy?.();
    cursorsRef.current?.destroy?.();
    replicaRef.current?.destroy?.();
    statesRef.current = replicaRef.current.states();
    unreadCacheRef.current.clear();
    unreadDiagnosticSignatureRef.current.clear();
    subscribers.clear();
    ownerCommandCache.clear();
  }

  return Object.freeze({
    subscribe(subscriber) {
      if (destroyed) return () => {};
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    getSnapshot() {
      return publicSnapshot;
    },
    getOwnerSnapshot(producerOwnerToken, snapshot = publicSnapshot) {
      let ownerCommands = ownerCommandCache.get(producerOwnerToken);
      if (!ownerCommands) {
        ownerCommands = Object.freeze({
          enqueue: (payloadOrChannel, seq, envelope, detail) => (
            enqueue(payloadOrChannel, seq, envelope, detail, producerOwnerToken)
          ),
          liveCheckpoint: (payload) => liveCheckpoint(payload, producerOwnerToken),
        });
        ownerCommandCache.set(producerOwnerToken, ownerCommands);
      }
      return Object.freeze({
        ...snapshot,
        ...ownerCommands,
      });
    },
    bind(nextBindings) {
      bindings = nextBindings;
      const nextOwnerToken = nextBindings.ownerToken ?? null;
      committedOwnerTokenRef.current = nextOwnerToken;
      return () => {
        if (committedOwnerTokenRef.current === nextOwnerToken) committedOwnerTokenRef.current = null;
      };
    },
    mount() {
      if (destroyed) throw new Error('ChannelFeedRuntime has been destroyed');
      if (mounted) return () => {};
      mounted = true;
      const generation = ++mountGeneration;
      cleanups = effects.map((setup) => setup()).filter((cleanup) => typeof cleanup === 'function');
      return () => {
        if (!mounted || generation !== mountGeneration) return;
        mounted = false;
        const currentCleanups = cleanups;
        cleanups = [];
        for (const cleanup of currentCleanups.reverse()) cleanup();
        queueMicrotask(() => {
          if (!mounted && generation === mountGeneration) destroy();
        });
      };
    },
    destroy,
  });
}
