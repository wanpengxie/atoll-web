import { createChannelReplicaCache, createChannelReplicaStore, replicaResumeSnapshot } from './channel-replica.js';
import { selectTimelineItems } from './conversation-presentation.js';
import { argsOf, FINAL } from '../protocol/envelope.js';
import { TYPES } from '../protocol/vocab.js';
import { createHistoryPresentationAdmission } from './history-presentation-admission.js';
import { createHistoryBoundedExecutor } from './history-bounded-executor.js';
import { createHistorySourceAdapters } from './history-source-adapters.js';
import { isRailNotifiableDisposition, notificationDisposition } from './notification-policy.js';

export const HISTORY_PAGE_SIZE = 128;
export const HISTORY_BATCH_BYTES = 1024 * 1024;
export const HISTORY_BATCH_TIMEOUT_MS = 30_000;
export const HISTORY_RESERVOIR_SIZE = 5_000;

const ACTIVITY_TYPES = new Set([
  TYPES.agentAsk, TYPES.agentQueue, TYPES.agentCompact,
  TYPES.agentNew, TYPES.agentReplace, TYPES.agentSteer,
]);
const AGENT_ACTIVITY_LIMIT = 512;
const TIMER_FIRING_LIMIT = 256;

function historyNumeric(value) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : 0;
}

function historySourceFor(localMeta, beforeSeq) {
  const frontier = historyNumeric(beforeSeq) - 1;
  return frontier > 0 && localMeta?.coverage?.some((range) => (
    historyNumeric(range?.lowSeq) <= frontier && historyNumeric(range?.highSeq) >= frontier
  )) ? 'indexeddb' : 'network';
}

function humanPrincipal(actorID) {
  const parts = String(actorID || '').split(String(actorID || '').includes('::') ? '::' : ':');
  return parts[0] === 'human' && parts.length >= 3 ? parts[1] : '';
}

function samePerson(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const principal = humanPrincipal(left);
  return Boolean(principal && principal === humanPrincipal(right));
}

function envelopeRelatesTo(envelope, selfID) {
  return samePerson(envelope?.sender?.id, selfID)
    || envelope?.audience?.some((audience) => samePerson(audience, selfID));
}

function notificationRelatesTo(state, envelope, selfID) {
  if (envelopeRelatesTo(envelope, selfID)) return true;
  for (const entry of state?.timeline || []) {
    if (entry?.kind !== 'turn') continue;
    const turns = [entry.turn, ...(entry.thread || []).map((item) => item.turn)].filter(Boolean);
    const contains = turns.some((turn) => turn.request?.id === envelope?.id
      || turn.terminal?.id === envelope?.id
      || turn.provisional?.some((item) => item.envelope?.id === envelope?.id));
    if (!contains) continue;
    return turns.some((turn) => [
      turn.request,
      turn.terminal,
      ...(turn.provisional || []).map((item) => item.envelope),
    ].some((candidate) => envelopeRelatesTo(candidate, selfID)));
  }
  return false;
}

function notificationRootID(state, envelope) {
  for (const entry of state?.timeline || []) {
    if (entry?.kind !== 'turn') {
      if (entry?.envelope?.id === envelope?.id) return envelope.id || '';
      continue;
    }
    const turns = [entry.turn, ...(entry.thread || []).map((item) => item.turn)].filter(Boolean);
    const contains = turns.some((turn) => turn.request?.id === envelope?.id
      || turn.terminal?.id === envelope?.id
      || turn.provisional?.some((item) => item.envelope?.id === envelope?.id));
    if (contains) return entry.turn?.requestId || envelope?.parent_id || envelope?.id || '';
  }
  return envelope?.parent_id || envelope?.id || '';
}

function eventTimestamp(envelope, fallback = Date.now()) {
  const value = new Date(envelope?.ts).getTime();
  return Number.isFinite(value) ? value : fallback;
}

function isRunningActivity(envelope) {
  const body = argsOf(envelope);
  return envelope?.kind === 'response'
    && ACTIVITY_TYPES.has(envelope.type)
    && (body.status === 'processing' || Boolean(body.process));
}

function isTerminalActivity(envelope) {
  return envelope?.kind === 'response'
    && ACTIVITY_TYPES.has(envelope.type)
    && FINAL.has(argsOf(envelope)?.status);
}

function isCanonicalTimerFiring(envelope) {
  const senderID = String(envelope?.sender?.id || '');
  return envelope?.kind === 'event'
    && String(envelope?.id || '').startsWith('timer:')
    && !envelope.parent_id
    && envelope.correlation_id === envelope.id
    && envelope.sender?.kind === 'agent'
    && Boolean(senderID)
    && envelope.audience?.length === 1
    && envelope.audience[0] === senderID;
}

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
    if (!authority || !storage) return false;
    try {
      const raw = storage.getItem(`atoll.feed-cursors.v1.${authority}`);
      if (!raw) return false;
      const value = JSON.parse(raw);
      for (const [id, seq] of Object.entries(value.reads || {})) reads.set(id, historyNumeric(seq));
      for (const [id, seq] of Object.entries(value.notifications || {})) notifications.set(id, historyNumeric(seq));
      return true;
    } catch { return false; }
  };
  return Object.freeze({
    selectReadAuthority({ principalId = '', serverBoot = '' } = {}) {
      const next = principalId && serverBoot ? `${principalId}\u0000${serverBoot}` : '';
      const changed = next !== authority;
      if (!changed) return { changed: false, reused: Boolean(authority), fresh: false };
      authority = next;
      const restored = load();
      return { changed: true, reused: Boolean(authority) && restored, fresh: Boolean(authority) && !restored };
    },
    clearReadAuthority() { authority = ''; reads.clear(); notifications.clear(); },
    isReadAuthorityReady: () => Boolean(authority),
    reconcileReads(snapshot = {}) {
      for (const [channelId, seq] of Object.entries(snapshot)) {
        const value = historyNumeric(seq);
        reads.set(channelId, Math.max(reads.get(channelId) || 0, value));
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
    messageCurrent: false, notificationAuthorityRevision: 0,
    hasOlder: false, loading: false, foregroundLoading: false, backgroundLoading: false,
    error: '', errorCode: '', completedPages: 0, coverage: [], lastSource: '', buffered: 0,
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
  const admission = createHistoryPresentationAdmission({ onChange: publish });
  const histories = new Map();
  const grants = new Map();
  const subscribers = new Set();
  const ownerCommands = new Map();
  const executor = createHistoryBoundedExecutor({ concurrency: 2, timeoutMs: HISTORY_BATCH_TIMEOUT_MS });
  const networkBatches = new Map();
  const activityEntries = new Map();
  const timerEvents = [];
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
  let activityConnected = false;
  let activityRevision = 0;
  let timerRevision = 0;
  let timerAcknowledgedRevision = 0;
  let timerOverflow = null;
  let notificationAuthorityRevision = 0;

  const cacheError = (error) => {
    if (error?.code !== 'cache_owner_changed') callback('onError', error);
  };

  function observeAgentActivity(row, source) {
    const envelope = row?.envelope;
    const channelId = String(row?.channel_id || envelope?.channel_id || '');
    const requestId = String(envelope?.parent_id || '');
    if (!channelId || !requestId) return false;
    const key = `${channelId}\u0000${requestId}`;
    const current = activityEntries.get(key);
    if (isTerminalActivity(envelope)) {
      if (!current || current.state === 'settled') return false;
      const settledAt = eventTimestamp(envelope);
      activityEntries.set(key, Object.freeze({
        ...current, state: 'settled', updatedAt: settledAt, settledAt,
        outcome: String(argsOf(envelope)?.status || ''),
      }));
      activityRevision += 1;
      return true;
    }
    if (source !== 'live' || !activityConnected
      || historyNumeric(row.generation) !== generation
      || !isRunningActivity(envelope)
      || current?.state === 'settled') return false;
    const agentId = String(envelope.sender?.id || '');
    if (!agentId) return false;
    const updatedAt = eventTimestamp(envelope);
    const request = replica.state(channelId)?._envelopesById?.get(requestId);
    const requestStartedAt = eventTimestamp(request, updatedAt);
    activityEntries.set(key, Object.freeze({
      state: 'active', channelId, requestId, agentId, type: envelope.type, generation,
      startedAt: current?.startedAt || requestStartedAt,
      updatedAt, settledAt: 0, outcome: '',
    }));
    if (!current || current.agentId !== agentId || current.generation !== generation) activityRevision += 1;
    while (activityEntries.size > AGENT_ACTIVITY_LIMIT) {
      const removable = [...activityEntries].find(([, entry]) => entry.state === 'settled') || activityEntries.entries().next().value;
      if (!removable) break;
      activityEntries.delete(removable[0]);
    }
    return true;
  }

  function observeTimerFiring(row, source) {
    if (source !== 'live' || historyNumeric(row?.generation) !== generation
      || !isCanonicalTimerFiring(row?.envelope)) return false;
    timerRevision += 1;
    timerEvents.push(Object.freeze({
      revision: timerRevision,
      timerId: row.envelope.id,
      channelId: row.channel_id,
      seq: historyNumeric(row.seq),
      firedAt: eventTimestamp(row.envelope),
    }));
    if (timerEvents.length > TIMER_FIRING_LIMIT) {
      const removed = timerEvents.splice(0, timerEvents.length - TIMER_FIRING_LIMIT);
      const unacknowledged = removed.filter((event) => event.revision > timerAcknowledgedRevision);
      if (unacknowledged.length) {
        timerOverflow = Object.freeze({
          count: Number(timerOverflow?.count || 0) + unacknowledged.length,
          throughRevision: unacknowledged.at(-1).revision,
        });
      }
    }
    return true;
  }

  function agentActivitySnapshot(channelId = '') {
    const byChannel = {};
    for (const entry of activityEntries.values()) {
      const visibleActive = entry.state === 'active' && activityConnected && entry.generation === generation;
      if ((!visibleActive && entry.state !== 'settled') || (channelId && entry.channelId !== channelId)) continue;
      const channel = byChannel[entry.channelId] || { active: [], agents: {} };
      byChannel[entry.channelId] = channel;
      const agent = channel.agents[entry.agentId] || { active: 0, settled: 0, state: '' };
      channel.agents[entry.agentId] = agent;
      if (visibleActive) { channel.active.push(entry); agent.active += 1; }
      else agent.settled += 1;
    }
    for (const channel of Object.values(byChannel)) {
      channel.active.sort((left, right) => right.updatedAt - left.updatedAt);
      for (const agent of Object.values(channel.agents)) {
        agent.state = agent.active ? 'active' : 'settled';
        Object.freeze(agent);
      }
      Object.freeze(channel.active); Object.freeze(channel.agents); Object.freeze(channel);
    }
    return Object.freeze({
      revision: activityRevision, boot: world, generation, connected: activityConnected,
      byChannel: Object.freeze(byChannel),
    });
  }

  function timerFiringSnapshot() {
    return Object.freeze({
      revision: timerRevision,
      acknowledgedRevision: timerAcknowledgedRevision,
      overflow: timerOverflow,
      events: Object.freeze(timerEvents.filter((event) => event.revision > timerAcknowledgedRevision)),
    });
  }

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
      const result = replica.commit(row, selfID, (value) => value, { source });
      if (!result.accepted) continue;
      accepted.push(result.row);
      discoveredChannels.add(row.channel_id);
      const status = histories.get(row.channel_id);
      if (source === 'live' && status?.attached && status.generation === generation) {
        const nextHead = Math.max(status.headSeq, historyNumeric(row.seq));
        if (nextHead !== status.headSeq || status.messageCurrent !== true) {
          status.headSeq = nextHead;
          status.messageCurrent = true;
          status.notificationAuthorityRevision = ++notificationAuthorityRevision;
        }
      }
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
      observeAgentActivity(result.row, source);
      observeTimerFiring(result.row, source);
    }
    if (accepted.length) {
      callback('onChannelsDiscovered', discoveredChannels);
      if (producerToken === ownerToken) {
        callback('onSubmissionFeed', landedMessageIDs, closedRequestIDs, producerToken);
      }
      if (accessChanged) callback('onAccessChanged');
      if (publishChange) publish({ index: true });
      if (persist) void cache.saveRows(accepted).catch(cacheError);
    }
    return accepted;
  }

  function unreadFor(channelId, selfID = '') {
    if (!cursors.isReadAuthorityReady() || !selfID) {
      return Object.freeze({ related: 0, total: 0, pending: true });
    }
    const boundary = cursors.notificationHighWater(channelId);
    const state = replica.state(channelId);
    const unreadRoots = new Set();
    for (const [seq, envelope] of state?.rows || []) {
      if (seq <= boundary || samePerson(envelope?.sender?.id, selfID)
        || !notificationRelatesTo(state, envelope, selfID)) continue;
      const disposition = notificationDisposition(state, envelope, selfID);
      if (!isRailNotifiableDisposition(disposition)) continue;
      const rootID = notificationRootID(state, envelope);
      if (rootID) unreadRoots.add(rootID);
    }
    const unread = unreadRoots.size;
    return Object.freeze({ related: unread, total: unread });
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
      source: historySourceFor(localMeta, beforeSeq),
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
      if (batch.source === 'network') void cache.saveRows(outcome.rows).catch(cacheError);
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
      histories.clear(); grants.clear(); replica.reset(); cursors.clearReadAuthority();
      activityEntries.clear(); timerEvents.splice(0); timerOverflow = null;
      timerAcknowledgedRevision = timerRevision; activityConnected = false; activityRevision += 1;
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
      if (world) cursors.selectReadAuthority({ principalId: principal, serverBoot: world });
      cursors.reconcileReads(replicaResumeSnapshot(selected.meta));
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
      if (epoch !== principalEpoch || error?.code === 'cache_owner_changed') return { resume: {} };
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
    if (worldChanged) {
      for (const channelId of histories.keys()) admission.reset(channelId);
      histories.clear(); grants.clear(); replica.reset(); cursors.clearReadAuthority();
      activityEntries.clear();
      timerEvents.splice(0);
      timerAcknowledgedRevision = timerRevision;
      timerOverflow = null;
      activityRevision += 1;
    }
    let selectedMeta = cache.metaSnapshot();
    if (principal && world) {
      let selected;
      try {
        selected = await cache.ensureOwner(principal, { world });
      } catch (error) {
        if (epoch !== attachEpoch || error?.code === 'cache_owner_changed') return { stale: true, meta: new Map() };
        throw error;
      }
      if (epoch !== attachEpoch || generation !== nextGeneration) return { stale: true, meta: new Map() };
      selectedMeta = selected.meta;
    }
    if (principal && world) cursors.selectReadAuthority({ principalId: principal, serverBoot: world });
    const nextChannelIDs = new Set(entries.map((entry) => String(entry?.channel_id || '')).filter(Boolean));
    for (const [channelId, status] of histories) {
      if (nextChannelIDs.has(channelId) || (!status.attached && !status.messageCurrent)) continue;
      status.attached = false;
      status.messageCurrent = false;
      status.notificationAuthorityRevision = ++notificationAuthorityRevision;
    }
    grants.clear();
    for (const entry of entries) {
      const channelId = String(entry?.channel_id || '');
      if (!channelId) continue;
      grants.set(channelId, entry);
      const status = historyState(channelId);
      const grantedHeadSeq = historyNumeric(entry.head_seq);
      const headSeq = Math.max(status.headSeq, grantedHeadSeq, replica.visibleNewest(channelId));
      const authorityChanged = status.generation !== generation
        || status.attached !== true
        || status.messageCurrent !== true
        || status.headSeq !== headSeq;
      Object.assign(status, {
        generation, attached: true, messageCurrent: true, headSeq,
        beforeSeq: replica.visibleOldest(channelId) || headSeq + 1,
        hasOlder: headSeq > 0,
        notificationAuthorityRevision: authorityChanged
          ? ++notificationAuthorityRevision
          : status.notificationAuthorityRevision,
      });
      replica.installMeta(channelId, { headSeq: entry.head_seq, coverage: selectedMeta.get(channelId)?.coverage });
      if (cursors.isReadAuthorityReady()) {
        cursors.baselineRead(channelId, grantedHeadSeq);
        cursors.baselineNotifications(channelId, grantedHeadSeq);
      }
    }
    const focus = String(detail.focus || activeChannelRef.current || '');
    if (focus && selectedMeta.has(focus) && replica.visibleNewest(focus) === 0) {
      const head = historyNumeric(selectedMeta.get(focus)?.headSeq || selectedMeta.get(focus)?.newestSeq);
      const cached = await cache.readBefore(focus, head + 1, HISTORY_PAGE_SIZE, HISTORY_BATCH_BYTES);
      if (epoch !== attachEpoch || generation !== nextGeneration) return { stale: true, meta: selectedMeta };
      applyRows(cached.rows, { source: 'cache', persist: false, publishChange: false });
    }
    let retiredActivity = false;
    for (const [key, entry] of activityEntries) {
      if (entry.state !== 'active' || entry.generation === generation) continue;
      activityEntries.delete(key);
      retiredActivity = true;
    }
    const connectionChanged = !activityConnected || retiredActivity;
    activityConnected = true;
    if (connectionChanged) activityRevision += 1;
    localReplicaReady = true;
    publish({ index: true });
    return { changed: true, meta: selectedMeta };
  }

  function liveCheckpoint(payload = {}, producerToken = ownerToken) {
    if (producerToken !== ownerToken || historyNumeric(payload.generation) !== generation) return false;
    const low = historyNumeric(payload.scan_low_seq);
    const high = historyNumeric(payload.scanned_seq);
    if (!payload.channel_id || !low || high < low) return false;
    void cache.saveCoverage(payload.channel_id, low, high).catch(cacheError);
    return true;
  }

  function historyFor(channelId) {
    const status = historyState(channelId);
    const presentationRevision = replica.state(channelId)?._timelineRevision || 0;
    const syncRevision = status.notificationAuthorityRevision;
    return Object.freeze({
      ...status,
      oldestSeq: replica.visibleOldest(channelId),
      loaded: replica.visibleNewest(channelId) > 0,
      localReplicaReady,
      localReplicaError,
      localReplicaErrorCode,
      presentationAdmission: admission,
      presentationAdmissionState: admission.snapshot(channelId),
      presentationRevision,
      sync: Object.freeze({
        generation: status.generation,
        attached: status.attached,
        interestRevision: syncRevision,
        fulfilledRevision: status.messageCurrent ? syncRevision : 0,
        targetHead: status.headSeq,
        error: status.error,
      }),
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
    activityEntries.clear();
    timerEvents.splice(0);
    timerAcknowledgedRevision = timerRevision;
    timerOverflow = null;
    activityConnected = false;
    activityRevision += 1;
    replica.reset(); publish({ index: true });
  }

  async function resetPersistent() { await cache.clear(); clear(); cursors.resetReads(); return true; }
  function disconnectHistory(requestGeneration = generation) {
    if (requestGeneration && requestGeneration !== generation) return false;
    for (const status of histories.values()) {
      if (status.attached || status.messageCurrent) {
        status.attached = false;
        status.messageCurrent = false;
        status.notificationAuthorityRevision = ++notificationAuthorityRevision;
      }
    }
    attachEpoch += 1;
    if (activityConnected) { activityConnected = false; activityRevision += 1; }
    generation = 0;
    for (const batch of networkBatches.values()) void adapters.cancel(batch, 'history disconnected');
    networkBatches.clear(); publish(); return true;
  }
  function stopIncompatible(requestGeneration = generation) {
    if (requestGeneration && generation && requestGeneration !== generation) return false;
    incompatible = true; disconnectHistory(generation); return true;
  }
  function markRead(channelId, acknowledgement = {}) {
    const status = histories.get(channelId);
    const physicalSeq = historyNumeric(acknowledgement.physicalSeq);
    if (!cursors.isReadAuthorityReady() || !status?.attached || !status.messageCurrent
      || acknowledgement.generation !== status.generation
      || acknowledgement.authorityRevision !== status.notificationAuthorityRevision
      || physicalSeq <= 0 || physicalSeq > status.headSeq) return false;
    return cursors.markRead(channelId, physicalSeq);
  }
  function acknowledgeNotifications(channelId, confirmation = {}) {
    const status = histories.get(channelId);
    const boundary = historyNumeric(confirmation.boundary);
    if (!cursors.isReadAuthorityReady() || !status?.attached || !status.messageCurrent
      || confirmation.generation !== status.generation
      || confirmation.authorityRevision !== status.notificationAuthorityRevision
      || confirmation.cause !== 'presented-follow'
      || boundary !== status.headSeq) return false;
    return cursors.acknowledgeNotifications(channelId, boundary);
  }
  function acknowledgeAgentActivity(channelId, agentId) {
    let changed = false;
    for (const [key, entry] of activityEntries) {
      if (entry.state !== 'settled' || entry.channelId !== channelId || entry.agentId !== agentId) continue;
      activityEntries.delete(key);
      changed = true;
    }
    if (changed) { activityRevision += 1; publish(); }
    return changed;
  }
  function acknowledgeTimerFirings(throughRevision = timerRevision) {
    const next = Math.min(timerRevision, Math.max(timerAcknowledgedRevision, historyNumeric(throughRevision)));
    if (next === timerAcknowledgedRevision) return false;
    timerAcknowledgedRevision = next;
    while (timerEvents[0]?.revision <= next) timerEvents.shift();
    if (timerOverflow && timerOverflow.throughRevision <= next) timerOverflow = null;
    publish();
    return true;
  }
  function attachAgentActivity(detail = {}) {
    const nextGeneration = historyNumeric(detail.generation);
    if (!nextGeneration || nextGeneration !== generation || incompatible) return false;
    if (activityConnected) return true;
    activityConnected = true;
    activityRevision += 1;
    publish();
    return true;
  }
  function disconnectAgentActivity() {
    if (!activityConnected) return false;
    activityConnected = false;
    activityRevision += 1;
    publish();
    return true;
  }
  const agentActivityPort = Object.freeze({
    attach: attachAgentActivity,
    disconnect: disconnectAgentActivity,
  });
  const resumeLocalReplica = () => localReplicaReady ? replicaResumeSnapshot(cache.metaSnapshot()) : {};

  function buildSnapshot() {
    const agentActivity = agentActivitySnapshot();
    const timerFirings = timerFiringSnapshot();
    return Object.freeze({
      version, indexVersion, localReplicaReady, localReplicaError, localReplicaErrorCode,
      agentActivity, timerFirings, agentActivityPort,
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
      agentActivityFor: (channelId) => agentActivity.byChannel[channelId]
        || Object.freeze({ active: Object.freeze([]), agents: Object.freeze({}) }),
      acknowledgeAgentActivity,
      acknowledgeTimerFirings,
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
    activityEntries.clear(); timerEvents.splice(0);
    replica.destroy(); cursors.destroy(); void cache.destroy();
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
