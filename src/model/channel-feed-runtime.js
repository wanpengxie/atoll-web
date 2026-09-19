import { createChannelReplicaCache, createChannelReplicaStore, replicaResumeSnapshot } from './channel-replica.js';
import { selectTimelineItems } from './conversation-presentation.js';
import { argsOf, FINAL } from '../protocol/envelope.js';
import { createHistoryPresentationAdmission } from './history-presentation-admission.js';
import { createHistoryBoundedExecutor } from './history-bounded-executor.js';
import { historyNumeric, historySourceFor } from './history-candidate-reducer.js';
import { createHistorySourceAdapters } from './history-source-adapters.js';

export const HISTORY_PAGE_SIZE = 128;
export const HISTORY_BATCH_BYTES = 1024 * 1024;
export const HISTORY_BATCH_TIMEOUT_MS = 30_000;
export const HISTORY_RESERVOIR_SIZE = 5_000;

function createCursorOwner(storage = globalThis.localStorage) {
  const reads = new Map();
  const notifications = new Map();
  let authority = '';
  const persist = () => {
    if (!authority || !storage) return;
    try {
      storage.setItem(`atoll.feed-cursors.v1.${authority}`, JSON.stringify({
        reads: Object.fromEntries(reads), notifications: Object.fromEntries(notifications),
      }));
    } catch { /* cursor durability is best effort */ }
  };
  const load = () => {
    reads.clear(); notifications.clear();
    if (!authority || !storage) return;
    try {
      const value = JSON.parse(storage.getItem(`atoll.feed-cursors.v1.${authority}`) || '{}');
      for (const [id, seq] of Object.entries(value.reads || {})) reads.set(id, historyNumeric(seq));
      for (const [id, seq] of Object.entries(value.notifications || {})) notifications.set(id, historyNumeric(seq));
    } catch { /* reject an invalid cursor snapshot */ }
  };
  return Object.freeze({
    selectReadAuthority({ principalId = '', serverBoot = '' } = {}) {
      const next = principalId && serverBoot ? `${principalId}\u0000${serverBoot}` : '';
      const changed = next !== authority;
      if (changed) { authority = next; load(); }
      return { changed, reused: !changed && Boolean(authority) };
    },
    clearReadAuthority() { authority = ''; reads.clear(); notifications.clear(); },
    isReadAuthorityReady: () => Boolean(authority),
    reconcile(snapshot = {}) {
      for (const [channelId, seq] of Object.entries(snapshot)) {
        const value = historyNumeric(seq);
        reads.set(channelId, Math.max(reads.get(channelId) || 0, value));
        notifications.set(channelId, Math.max(notifications.get(channelId) || 0, value));
      }
      persist();
    },
    resetReads() { reads.clear(); notifications.clear(); persist(); },
    read: (channelId) => reads.get(channelId) || 0,
    markRead(channelId, seq) { const next = Math.max(reads.get(channelId) || 0, historyNumeric(seq)); reads.set(channelId, next); persist(); return next; },
    baselineRead(channelId, seq) { if (!reads.has(channelId)) reads.set(channelId, historyNumeric(seq)); persist(); },
    notificationHighWater: (channelId) => notifications.get(channelId) || 0,
    acknowledgeNotifications(channelId, seq) {
      const next = Math.max(notifications.get(channelId) || 0, historyNumeric(seq));
      notifications.set(channelId, next); persist(); return next;
    },
    baselineNotifications(channelId, seq) { if (!notifications.has(channelId)) notifications.set(channelId, historyNumeric(seq)); persist(); },
    destroy() { authority = ''; reads.clear(); notifications.clear(); },
  });
}

function historyInitial(channelId) {
  return {
    channelId, generation: 0, attached: false, headSeq: 0, beforeSeq: 0,
    hasOlder: false, loading: false, foregroundLoading: false, backgroundLoading: false,
    error: '', errorCode: '', completedPages: 0, coverage: [], lastSource: '',
    historyDemand: Object.freeze({ revision: 0, phase: 'idle', error: '' }),
  };
}

// One lifetime owner for source admission, canonical commit, cache and
// publication. Cache/history/live are ingress provenance, never stores that a
// consumer can observe independently of Replica.commit.
export function createChannelFeedRuntime(options = {}) {
  const {
    wireRef = { current: null }, rosterRef = { current: null }, accessRef = { current: null },
    activeChannelRef = { current: '' },
  } = options;
  let bindings = options;
  const callback = (name, ...args) => bindings[name]?.(...args);
  const replica = createChannelReplicaStore();
  const cache = createChannelReplicaCache();
  const cursors = createCursorOwner();
  const cursorsRef = { current: cursors };
  const statesRef = { current: replica.states() };
  const admission = createHistoryPresentationAdmission({ onChange: publish });
  const histories = new Map();
  const grants = new Map();
  const subscribers = new Set();
  const ownerCommands = new Map();
  const executor = createHistoryBoundedExecutor({ concurrency: 2, timeoutMs: HISTORY_BATCH_TIMEOUT_MS });
  const networkBatches = new Map();
  let generation = 0;
  let principalEpoch = 0;
  let attachEpoch = 0;
  let ownerToken = null;
  let principal = '';
  let world = '';
  let version = 0;
  let indexVersion = 0;
  let localReplicaReady = false;
  let localReplicaError = '';
  let localReplicaErrorCode = '';
  let incompatible = false;
  let mounted = false;
  let mountGeneration = 0;
  let destroyed = false;
  let snapshot;

  const adapters = createHistorySourceAdapters({
    requestPage(channelId, beforeSeq, limit, requestOptions) {
      const wire = wireRef.current;
      if (!wire?.historyBefore) return Promise.reject(new Error('消息连接尚未就绪'));
      return wire.historyBefore(channelId, beforeSeq, limit, requestOptions);
    },
    cancelPage(channelId, ref, requestGeneration) {
      return wireRef.current?.cancelHistory?.(channelId, ref, requestGeneration) || Promise.resolve();
    },
    readCache: (channelId, beforeSeq, limit, byteLimit) => cache.readBefore(channelId, beforeSeq, limit, byteLimit),
    registerNetwork(batch) { if (batch.ref) networkBatches.set(batch.ref, batch); },
  });

  function historyState(channelId) {
    if (!histories.has(channelId)) histories.set(channelId, historyInitial(channelId));
    return histories.get(channelId);
  }

  function publish({ index = false } = {}) {
    if (destroyed) return;
    version += 1;
    if (index) indexVersion += 1;
    snapshot = buildSnapshot();
    for (const subscriber of subscribers) subscriber();
  }

  function applyRows(rows, {
    source = 'live', persist = true, publishChange = true, producerToken = ownerToken,
  } = {}) {
    if (incompatible || (source === 'live' && producerToken !== ownerToken)) return [];
    const accepted = [];
    const landedMessageIDs = new Set();
    const closedRequestIDs = new Set();
    const discoveredChannels = new Set();
    let accessChanged = false;
    for (const row of rows || []) {
      const selfID = rosterRef.current?.self?.(row?.channel_id) || '';
      const result = replica.commit(row, selfID);
      if (!result.accepted) continue;
      accepted.push(result.row);
      discoveredChannels.add(row.channel_id);
      rosterRef.current?.observeFeed?.(row.channel_id, row.envelope);
      if (source === 'live') {
        accessChanged = Boolean(accessRef.current?.live?.(row.channel_id)) || accessChanged;
        rosterRef.current?.handleEnvelope?.(row.channel_id, row.envelope, (rosterRows, error) => {
          if (rosterRows) callback('onRoster', row.channel_id, rosterRows, producerToken);
          if (error) callback('onError', error);
        });
      }
      if (row.envelope?.id) {
        landedMessageIDs.add(row.envelope.id);
        callback('onTimerFired', row.envelope.id, row.envelope.ts || Date.now());
      }
      if (row.envelope?.kind === 'response'
        && FINAL.has(argsOf(row.envelope)?.status)
        && row.envelope?.parent_id) {
        landedMessageIDs.add(row.envelope.parent_id);
        closedRequestIDs.add(row.envelope.parent_id);
        const request = result.record.state._envelopesById.get(row.envelope.parent_id);
        const closedTarget = String(argsOf(request)?.target || argsOf(row.envelope)?.target || '');
        if (closedTarget) closedRequestIDs.add(closedTarget);
      }
      callback('onAgentActivity', row);
    }
    if (accepted.length) {
      callback('onChannelsDiscovered', discoveredChannels);
      if (producerToken === ownerToken) {
        callback('onSubmissionFeed', landedMessageIDs, closedRequestIDs, producerToken);
      }
      if (accessChanged) callback('onAccessChanged');
      statesRef.current = replica.states();
      if (publishChange) publish({ index: true });
      if (persist) void cache.saveRows(accepted).catch((error) => callback('onError', error));
    }
    return accepted;
  }

  function unreadFor(channelId, selfID = '') {
    if (!cursors.isReadAuthorityReady()) return Object.freeze({ related: 0, total: 0, pending: true });
    const boundary = cursors.notificationHighWater(channelId);
    let total = 0;
    let related = 0;
    for (const [seq, envelope] of replica.state(channelId)?.rows || []) {
      if (seq <= boundary || envelope?.visibility === 'system') continue;
      total += 1;
      if (envelope?.sender?.id === selfID || envelope?.audience?.includes?.(selfID)) related += 1;
    }
    return Object.freeze({ related, total });
  }

  function batchFor(channelId, request = {}) {
    const status = historyState(channelId);
    const beforeSeq = historyNumeric(request.beforeSeq)
      || replica.visibleOldest(channelId)
      || status.beforeSeq
      || status.headSeq + 1;
    const localMeta = cache.metaSnapshot().get(channelId);
    return {
      id: `${generation}:${channelId}:${status.completedPages + 1}`,
      source: historySourceFor({ localMeta, beforeSeq }, beforeSeq),
      channelId,
      beforeSeq,
      limit: Math.max(1, historyNumeric(request.limit || request.revealRows) || HISTORY_PAGE_SIZE),
      byteLimit: Math.max(1, historyNumeric(request.byteLimit || request.revealBytes) || HISTORY_BATCH_BYTES),
      generation,
      purpose: request.intent === 'scroll-history' ? 'user-demand' : 'initial-tail',
      priority: request.urgency === 'anticipatory' ? 'background' : 'foreground',
      intent: request.intent || 'scroll-history',
      urgency: request.urgency || 'interactive',
      rangeKind: 'backfill',
    };
  }

  async function executeBatch(batch, signal) {
    if (signal?.aborted) return { kind: 'cancelled' };
    adapters.prepare(batch);
    const abort = () => { void adapters.cancel(batch, 'history operation aborted'); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const result = await executor.run(() => adapters.execute(batch), { id: batch.id });
      const rows = result?.rows || [];
      // An empty/missing cache range falls through to the network under the
      // same operation instead of manufacturing cache EOF.
      if (batch.source === 'indexeddb' && (!rows.length || result.cacheMiss)) {
        adapters.complete(batch);
        return { kind: 'cache-miss' };
      }
      adapters.validate(batch, result, rows);
      adapters.complete(batch);
      return { kind: 'page', result, rows };
    } catch (error) {
      if (signal?.aborted || error?.code === 'history_cancelled') return { kind: 'cancelled' };
      adapters.fail(batch);
      return { kind: 'failed', error };
    } finally {
      signal?.removeEventListener('abort', abort);
      if (batch.ref) networkBatches.delete(batch.ref);
    }
  }

  async function loadHistory(channelId, request = {}) {
    if (incompatible) return { kind: 'cancelled', reason: 'version-incompatible' };
    const status = historyState(channelId);
    const demandRevision = status.historyDemand.revision + 1;
    Object.assign(status, {
      loading: true,
      foregroundLoading: request.urgency !== 'anticipatory',
      backgroundLoading: request.urgency === 'anticipatory',
      error: '', errorCode: '',
      historyDemand: Object.freeze({ revision: demandRevision, phase: 'pending', error: '' }),
    });
    const revealToken = request.intent === 'scroll-history' && request.historyRevealIntent
      ? admission.begin(channelId, request.historyRevealIntent)
      : null;
    publish();
    request.onOperation?.(Object.freeze({ release() {} }));
    let batch = batchFor(channelId, request);
    let outcome = await executeBatch(batch, request.signal);
    if (outcome.kind === 'cache-miss') {
      batch = { ...batch, id: `${batch.id}:network`, source: 'network' };
      outcome = await executeBatch(batch, request.signal);
    }
    if (outcome.kind === 'page') {
      if (batch.generation !== generation || !status.attached) return { kind: 'cancelled', reason: 'stale-generation' };
      const accepted = applyRows(outcome.rows, {
        source: batch.source === 'network' ? 'history' : 'cache', persist: false, publishChange: false,
      });
      if (batch.source === 'network') void cache.saveRows(outcome.rows).catch((error) => callback('onError', error));
      const result = outcome.result;
      status.completedPages += 1;
      status.lastSource = batch.source;
      status.beforeSeq = historyNumeric(result.next_before_seq ?? result.nextBeforeSeq ?? batch.beforeSeq);
      status.hasOlder = result.has_older ?? !result.exhausted ?? false;
      status.coverage = replica.record(channelId)?.materializedCoverage || [];
      const projection = selectTimelineItems(replica.state(channelId), request.viewSpec || {});
      const observed = revealToken ? admission.observe(channelId, projection.items, {
        operationID: revealToken.operationID,
        viewID: revealToken.viewID,
        epoch: revealToken.epoch,
        sourceRevision: replica.state(channelId)?._timelineRevision || 0,
      }) : null;
      if (revealToken) admission.settle(channelId, observed?.fulfilled ? 'fulfilled' : 'exhausted');
      status.historyDemand = Object.freeze({ revision: demandRevision, phase: 'idle', error: '' });
      Object.assign(status, { loading: false, foregroundLoading: false, backgroundLoading: false });
      publish({ index: accepted.length > 0 });
      return { kind: accepted.length || observed?.fulfilled ? 'satisfied' : status.hasOlder ? 'segment' : 'exhausted',
        released: accepted.length, firstVisibleSeq: projection.firstVisibleSeq, projection };
    }
    if (revealToken) admission.cancel(channelId, revealToken.operationID);
    Object.assign(status, { loading: false, foregroundLoading: false, backgroundLoading: false });
    if (outcome.kind === 'failed') {
      status.error = outcome.error?.message || '历史加载失败';
      status.errorCode = String(outcome.error?.code || 'history_failed');
      status.historyDemand = Object.freeze({ revision: demandRevision, phase: 'error', error: status.error });
      callback('onError', outcome.error);
    } else status.historyDemand = Object.freeze({ revision: demandRevision, phase: 'idle', error: '' });
    publish();
    return outcome;
  }

  function enqueue(payloadOrChannel, seq, envelope, detail, producerToken = ownerToken) {
    if (incompatible) return false;
    const payload = typeof payloadOrChannel === 'object'
      ? payloadOrChannel
      : detail || { channel_id: payloadOrChannel, seq, envelope, source: 'live' };
    const batch = payload?.ref ? networkBatches.get(payload.ref) : null;
    if (batch) return adapters.appendRow(batch, payload);
    if (payload.generation && historyNumeric(payload.generation) !== generation) return false;
    applyRows([payload], { source: payload.source || 'live', producerToken });
    return true;
  }

  function pageEnd(payload = {}) {
    const batch = networkBatches.get(payload.ref);
    return batch ? adapters.finish(batch, payload) : false;
  }

  async function prepareLocalReplica(nextPrincipal, { focus = activeChannelRef.current || '' } = {}) {
    const epoch = ++principalEpoch;
    const selectedPrincipal = String(nextPrincipal || '');
    if (principal && principal !== selectedPrincipal) {
      for (const channelId of histories.keys()) admission.reset(channelId);
      histories.clear(); grants.clear(); replica.reset(); statesRef.current = replica.states(); cursors.resetReads();
    }
    principal = selectedPrincipal;
    localReplicaReady = false; localReplicaError = ''; localReplicaErrorCode = '';
    publish();
    if (!principal) {
      cursors.clearReadAuthority();
      localReplicaReady = true;
      publish();
      return { resume: {} };
    }
    try {
      const selected = await cache.ensureOwner(principal, { world });
      if (epoch !== principalEpoch) return { resume: {} };
      for (const [channelId, value] of selected.meta) replica.installMeta(channelId, value);
      cursors.selectReadAuthority({ principalId: principal, serverBoot: world || selected.boot || 'local' });
      cursors.reconcile(replicaResumeSnapshot(selected.meta));
      if (focus && selected.meta.has(focus)) {
        const before = historyNumeric(selected.meta.get(focus)?.headSeq || selected.meta.get(focus)?.newestSeq) + 1;
        const cached = await cache.readBefore(focus, before, HISTORY_PAGE_SIZE, HISTORY_BATCH_BYTES);
        if (epoch !== principalEpoch) return { resume: {} };
        applyRows(cached.rows, { source: 'cache', persist: false, publishChange: false });
      }
      localReplicaReady = true;
      publish({ index: true });
      return { resume: replicaResumeSnapshot(selected.meta) };
    } catch (error) {
      localReplicaError = error?.message || '本地缓存初始化失败';
      localReplicaErrorCode = String(error?.code || 'cache_selection_failed');
      callback('onError', error);
      publish();
      return { resume: {} };
    }
  }

  async function setHistoryGrants(entries = [], detail = {}) {
    const nextGeneration = historyNumeric(detail.generation);
    if (!nextGeneration || nextGeneration < generation || incompatible) return { stale: true, meta: cache.metaSnapshot() };
    generation = nextGeneration;
    const epoch = ++attachEpoch;
    const nextWorld = String(detail.boot || world);
    const worldChanged = nextWorld !== world;
    world = nextWorld;
    let selectedMeta = cache.metaSnapshot();
    if (principal && world) {
      const selected = await cache.ensureOwner(principal, { world });
      if (epoch !== attachEpoch || generation !== nextGeneration) return { stale: true, meta: new Map() };
      selectedMeta = selected.meta;
      if (worldChanged) {
        for (const channelId of histories.keys()) admission.reset(channelId);
        histories.clear(); grants.clear(); replica.reset(); statesRef.current = replica.states(); cursors.resetReads();
      }
    }
    grants.clear();
    for (const entry of entries) {
      const channelId = String(entry?.channel_id || '');
      if (!channelId) continue;
      grants.set(channelId, entry);
      const status = historyState(channelId);
      Object.assign(status, {
        generation, attached: true, headSeq: historyNumeric(entry.head_seq),
        beforeSeq: replica.visibleOldest(channelId) || historyNumeric(entry.head_seq) + 1,
        hasOlder: historyNumeric(entry.head_seq) > 0,
      });
      replica.installMeta(channelId, { headSeq: entry.head_seq, coverage: selectedMeta.get(channelId)?.coverage });
      cursors.baselineRead(channelId, entry.head_seq);
      cursors.baselineNotifications(channelId, entry.head_seq);
    }
    const focus = String(detail.focus || activeChannelRef.current || '');
    if (focus && selectedMeta.has(focus) && replica.visibleNewest(focus) === 0) {
      const head = historyNumeric(selectedMeta.get(focus)?.headSeq || selectedMeta.get(focus)?.newestSeq);
      const cached = await cache.readBefore(focus, head + 1, HISTORY_PAGE_SIZE, HISTORY_BATCH_BYTES);
      if (epoch !== attachEpoch || generation !== nextGeneration) return { stale: true, meta: selectedMeta };
      applyRows(cached.rows, { source: 'cache', persist: false, publishChange: false });
    }
    if (principal && world) cursors.selectReadAuthority({ principalId: principal, serverBoot: world });
    localReplicaReady = true;
    publish({ index: true });
    return { changed: true, meta: selectedMeta };
  }

  function liveCheckpoint(payload = {}, producerToken = ownerToken) {
    if (producerToken !== ownerToken || historyNumeric(payload.generation) !== generation) return false;
    const low = historyNumeric(payload.scan_low_seq);
    const high = historyNumeric(payload.scanned_seq);
    if (!payload.channel_id || !low || high < low) return false;
    void cache.saveCoverage(payload.channel_id, low, high).catch((error) => callback('onError', error));
    return true;
  }

  function historyFor(channelId) {
    const status = historyState(channelId);
    return Object.freeze({
      ...status,
      oldestSeq: replica.visibleOldest(channelId),
      loaded: replica.visibleNewest(channelId) > 0,
      presentationAdmission: admission,
      presentationAdmissionState: admission.snapshot(channelId),
      presentationRevision: replica.state(channelId)?._timelineRevision || 0,
      sync: Object.freeze({ generation, attached: status.attached }),
    });
  }

  function clear() {
    principalEpoch += 1;
    attachEpoch += 1;
    executor.clear('replica cleared');
    for (const batch of networkBatches.values()) void adapters.cancel(batch, 'replica cleared');
    networkBatches.clear();
    for (const channelId of histories.keys()) admission.reset(channelId);
    histories.clear(); grants.clear();
    replica.reset(); statesRef.current = replica.states(); publish({ index: true });
  }

  async function resetPersistent() { await cache.clear(); clear(); cursors.resetReads(); return true; }
  function disconnectHistory(requestGeneration = generation) {
    if (requestGeneration && requestGeneration !== generation) return false;
    for (const status of histories.values()) status.attached = false;
    attachEpoch += 1;
    generation = 0;
    for (const batch of networkBatches.values()) void adapters.cancel(batch, 'history disconnected');
    networkBatches.clear(); publish(); return true;
  }
  function stopIncompatible(requestGeneration = generation) {
    if (requestGeneration && generation && requestGeneration !== generation) return false;
    incompatible = true; disconnectHistory(generation); return true;
  }
  function markRead(channelId, acknowledgement = {}) {
    if (!cursors.isReadAuthorityReady()) return false;
    return cursors.markRead(channelId, historyNumeric(acknowledgement.physicalSeq));
  }
  function acknowledgeNotifications(channelId, confirmation = {}) {
    if (!cursors.isReadAuthorityReady() || (confirmation.generation && confirmation.generation !== generation)) return false;
    return cursors.acknowledgeNotifications(channelId, historyNumeric(confirmation.boundary));
  }
  const resumeLocalReplica = () => localReplicaReady ? replicaResumeSnapshot(cache.metaSnapshot()) : {};

  function buildSnapshot() {
    return Object.freeze({
      cursorsRef, statesRef, version, indexVersion, localReplicaReady, localReplicaError, localReplicaErrorCode,
      bump: () => publish({ index: true }),
      enqueue, pageEnd, liveCheckpoint, setHistoryGrants, prepareLocalReplica, resumeLocalReplica,
      disconnectHistory, stopIncompatible, cancel: disconnectHistory, clear, resetPersistent,
      stateFor: (channelId) => replica.state(channelId),
      stateEntries: () => Object.freeze([...replica.states().entries()]),
      revisionFor: (channelId) => replica.revision(channelId),
      historyFor, unreadFor, generationFor: () => generation,
      focusHistory: (channelId) => { activeChannelRef.current = channelId; publish(); },
      refreshChannel: async (channelId) => Boolean(await wireRef.current?.channelMeta?.(channelId)),
      reconcileIdentity: (channelId) => { if (!replica.state(channelId)) return false; publish(); return true; },
      loadHistory, markRead, acknowledgeNotifications,
      coldEntryDiagnosticsFor: (channelId) => Object.freeze({
        feed: { localReplicaReady, localReplicaErrorCode },
        replica: { revision: replica.revision(channelId), rows: replica.state(channelId)?.rows.size || 0 },
        scheduler: historyFor(channelId),
      }),
    });
  }

  snapshot = buildSnapshot();

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (const batch of networkBatches.values()) void adapters.cancel(batch, 'feed runtime destroyed');
    networkBatches.clear(); executor.clear('feed runtime destroyed');
    replica.destroy(); statesRef.current = replica.states(); cursors.destroy(); void cache.destroy();
    subscribers.clear(); ownerCommands.clear();
  }

  return Object.freeze({
    subscribe(subscriber) { if (destroyed) return () => {}; subscribers.add(subscriber); return () => subscribers.delete(subscriber); },
    getSnapshot: () => snapshot,
    getOwnerSnapshot(producerToken, base = snapshot) {
      let commands = ownerCommands.get(producerToken);
      if (!commands) {
        commands = Object.freeze({
          enqueue: (payloadOrChannel, seq, envelope, detail) => enqueue(payloadOrChannel, seq, envelope, detail, producerToken),
          liveCheckpoint: (payload) => liveCheckpoint(payload, producerToken),
        });
        ownerCommands.set(producerToken, commands);
      }
      return Object.freeze({ ...base, ...commands });
    },
    bind(nextBindings) {
      bindings = nextBindings;
      const nextOwner = nextBindings.ownerToken ?? null;
      ownerToken = nextOwner;
      return () => { if (ownerToken === nextOwner) ownerToken = null; };
    },
    mount() {
      if (destroyed) throw new Error('ChannelFeedRuntime has been destroyed');
      if (mounted) return () => {};
      mounted = true;
      const current = ++mountGeneration;
      return () => {
        if (!mounted || current !== mountGeneration) return;
        mounted = false;
        queueMicrotask(() => { if (!mounted && current === mountGeneration) destroy(); });
      };
    },
    destroy,
  });
}
