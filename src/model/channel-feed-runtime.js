import {
  createChannelReplicaCache,
  createChannelReplicaStore,
  mergeReplicaCoverage,
  replicaResumeSnapshot,
} from './channel-replica.js';
import { selectTimelineItems } from './conversation-presentation.js';
import { argsOf, FINAL } from '../protocol/envelope.js';
import { TYPES } from '../protocol/vocab.js';
import { createHistoryPresentationAdmission } from './history-presentation-admission.js';
import { createHistoryBoundedExecutor } from './history-bounded-executor.js';
import { createHistorySourceAdapters } from './history-source-adapters.js';
import { HISTORY_INTENT, HISTORY_URGENCY } from './history-demand.js';
import {
  isCanonicalAgentTimerFire,
  isRailNotifiableDisposition,
  notificationDisposition,
} from './notification-policy.js';
import { diagnostic, registerRailDiagnosticProvider } from './diagnostics.js';
import { isMobileProfile } from './device-profile.js';

export const HISTORY_PAGE_SIZE = 128;
export const HISTORY_BATCH_BYTES = 1024 * 1024;
export const HISTORY_BATCH_TIMEOUT_MS = 30_000;
export const HISTORY_RESERVOIR_SIZE = 5_000;

// Mobile keeps a bounded Replica suffix.  Trim only after crossing the high
// water mark, then leave hysteresis so a live row does not trigger a delete on
// every frame.  The Replica remains the sole owner of closure retention and
// history re-admission; this is only Feed's admission threshold.
const MOBILE_REPLICA_MAX_ROWS = 500;
const MOBILE_REPLICA_TARGET_ROWS = 400;

// Channel entry warms one useful physical page target, not the whole ledger.
// Four pages is deliberately finite: the mock's root-safe pages are smaller
// than HISTORY_PAGE_SIZE, while the bound keeps a pathological source below
// the browser contract's 1,000-row ceiling.
const WARM_CACHE_TARGET_ROWS = HISTORY_PAGE_SIZE;
const WARM_CACHE_MAX_PAGES = 4;
// One semantic reveal request (a reader waiting at the physical top) owns as
// many physical pages as it takes to expose visible rows for its view. Pages
// that only advance the raw frontier are not a settlement; they continue the
// same operation. The bound keeps one operation from scanning an entire
// filtered channel while the reader has already moved on.
export const HISTORY_REVEAL_MAX_PAGES = 32;

const BACKGROUND_INTEREST_TYPES = new Set([
  HISTORY_INTENT.searchContext,
  HISTORY_INTENT.channelEntry,
  HISTORY_INTENT.reconnect,
  HISTORY_INTENT.foregroundReturn,
]);

const ACTIVITY_TYPES = new Set([
  TYPES.agentAsk, TYPES.agentQueue, TYPES.agentCompact,
  TYPES.agentNew, TYPES.agentReplace, TYPES.agentSteer,
]);
// OBS is the current directory projection. A live ledger fact in one of these
// topology families invalidates that projection; replay and read-only words do
// not. Keep this predicate at the feed ingress so a batch can coalesce its
// refresh signal without creating another directory owner.
const DIRECTORY_INVALIDATION_TYPES = new Set([
  TYPES.channel.create,
  TYPES.channel.set,
  TYPES.channel.remove,
  TYPES.member.create,
  TYPES.member.admit,
  TYPES.member.remove,
  TYPES.device.attach,
  TYPES.device.detach,
  TYPES.device.remove,
  TYPES.narration.memberCreated,
  TYPES.narration.memberDeleted,
  TYPES.narration.channelInbound,
]);
const AGENT_ACTIVITY_LIMIT = 512;
const TIMER_FIRING_LIMIT = 256;
const ACCESS_UNAVAILABLE_CODES = new Set(['unavailable', 'channel_unavailable']);
const READ_POSITION_STORAGE_PREFIX = 'atoll.read-position.v1.';
const RETIRED_CURSOR_STORAGE_PREFIX = 'atoll.feed-cursors.v1.';

function invalidatesChannelDirectory(envelope) {
  return DIRECTORY_INVALIDATION_TYPES.has(envelope?.type || '');
}

function historyNumeric(value) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : 0;
}

function historyRangeNumber(value, fallback = 0) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : fallback;
}

function historyBatchCompletionDetail(batch, result, rows, status, acceptedRows, operation) {
  const requestedBeforeSeq = historyRangeNumber(batch?.beforeSeq);
  const nextBeforeSeq = historyRangeNumber(
    result?.next_before_seq ?? result?.nextBeforeSeq,
    requestedBeforeSeq,
  );
  const scanHighSeq = historyRangeNumber(
    result?.scan_high_seq ?? result?.scanHighSeq,
    Math.max(0, requestedBeforeSeq - 1),
  );
  const scanLowSeq = historyRangeNumber(
    result?.scan_low_seq ?? result?.scanLowSeq,
    rows?.length
      ? Math.min(...rows.map((row) => historyRangeNumber(row?.seq, nextBeforeSeq)))
      : nextBeforeSeq,
  );
  return {
    authority: batch?.authority || null,
    channelId: batch?.channelId || '',
    source: batch?.source || '',
    priority: operation?.physicalPriority || '',
    generation: historyNumeric(batch?.authority?.generation),
    attachEpoch: historyNumeric(batch?.authority?.attachEpoch),
    ref: String(batch?.ref || ''),
    rows: Array.isArray(rows) ? rows.length : 0,
    acceptedRows: historyNumeric(acceptedRows),
    hasOlder: Boolean(result?.has_older ?? result?.hasOlder ?? !result?.exhausted),
    beforeSeq: historyNumeric(status?.beforeSeq),
    requestedBeforeSeq,
    limit: historyNumeric(batch?.limit),
    byteLimit: historyNumeric(batch?.byteLimit),
    nextBeforeSeq,
    scanLowSeq,
    scanHighSeq,
  };
}

function historySchedulerPriority(urgency) {
  if (urgency === HISTORY_URGENCY.blocking) return 3;
  if (urgency === HISTORY_URGENCY.interactive) return 2;
  return 0;
}

function historyViewSpecSnapshot(viewSpec = {}) {
  const snapshot = { ...viewSpec };
  if (viewSpec.actorFilter instanceof Set) snapshot.actorFilter = new Set(viewSpec.actorFilter);
  if (Array.isArray(viewSpec.localEchoes)) snapshot.localEchoes = [...viewSpec.localEchoes];
  return Object.freeze(snapshot);
}

// The rail has one canonical root ledger.  Keep the two person-visible
// projections explicit so a filtered/partial observation cannot silently turn
// `other` into a total or clear a root it never presented.
const EMPTY_UNREAD_ROOTS = Object.freeze({ related: new Set(), other: new Set() });

function notificationProjection({ related = 0, other = 0, pending = false, unknown = false } = {}) {
  return Object.freeze({
    related: historyNumeric(related),
    other: historyNumeric(other),
    pending: pending === true,
    unknown: unknown === true,
  });
}

function historySourceFor(localMeta, beforeSeq) {
  const frontier = historyNumeric(beforeSeq) - 1;
  return frontier > 0 && localMeta?.coverage?.some((range) => (
    historyNumeric(range?.lowSeq) <= frontier && historyNumeric(range?.highSeq) >= frontier
  )) ? 'indexeddb' : 'network';
}

function trimMobileReplica(replica, channelId) {
  if (!isMobileProfile()) return 0;
  const state = replica.state(channelId);
  if (!state || state.rows.size <= MOBILE_REPLICA_MAX_ROWS) return 0;
  return replica.trim(channelId, MOBILE_REPLICA_TARGET_ROWS);
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

// Feed consumes the Composer-owned correlation port as a narrow, typed seam:
// it may ask whether an exact channel/message identity is owned, then mark
// that same identity landed after Replica accepts the canonical feed fact.
// Feed never records or forgets identities on its own and never recreates the
// retired Roster submission map.
function markOwnedSubmissionLanded(port, channelId, messageId) {
  if (!port || typeof port.owns !== 'function' || typeof port.markLanded !== 'function'
    || typeof channelId !== 'string' || !channelId
    || typeof messageId !== 'string' || !messageId) return false;
  const identity = { channelId, messageId };
  if (!port.owns(identity)) return false;
  return port.markLanded(identity) === true;
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

// Where the reader has read to, per channel: the one notification state.
//
//   mine  — highest ledger seq seen in any view; unread rows related to the
//           reader (sender or audience) are those above it
//   all   — highest ledger seq seen in the unfiltered "all" view; unread rows
//           not related to the reader are those above it
//
// A channel first seen on this device starts at its head: history is never
// new. Both positions only move forward, so a late or repeated report is a
// no-op, never a corruption. Stored per principal and ledger world.
function createReadPositions(storage = globalThis.localStorage) {
  const positions = new Map();
  let authority = '';
  const keyFor = (value) => `${READ_POSITION_STORAGE_PREFIX}${value}`;
  const retireOldCursors = () => {
    if (!storage || typeof storage.key !== 'function') return;
    const retired = [];
    for (let index = 0; index < Number(storage.length || 0); index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(RETIRED_CURSOR_STORAGE_PREFIX)) retired.push(key);
    }
    for (const key of retired) {
      try { storage.removeItem(key); } catch { /* best effort */ }
    }
  };
  const persist = () => {
    if (!authority || !storage) return;
    try {
      storage.setItem(keyFor(authority), JSON.stringify(Object.fromEntries(positions)));
    } catch { /* read position durability is best effort */ }
  };
  const load = () => {
    positions.clear();
    if (!authority || !storage) return;
    try {
      const value = JSON.parse(storage.getItem(keyFor(authority)) || '{}');
      for (const [channelId, entry] of Object.entries(value || {})) {
        const mine = historyNumeric(entry?.mine);
        const all = historyNumeric(entry?.all);
        positions.set(channelId, { mine, all: Math.min(all, mine) });
      }
    } catch { positions.clear(); }
  };
  retireOldCursors();
  return Object.freeze({
    selectReadAuthority({ principalId = '', serverBoot = '' } = {}) {
      const next = principalId && serverBoot ? `${principalId}\u0000${serverBoot}` : '';
      if (next === authority) return false;
      // A new ledger world is a new history: the old world's positions say
      // nothing about it.
      if (authority && storage) {
        try { storage.removeItem(keyFor(authority)); } catch { /* best effort */ }
      }
      authority = next;
      load();
      return true;
    },
    clearReadAuthority() {
      authority = '';
      positions.clear();
    },
    isReadAuthorityReady: () => Boolean(authority),
    has: (channelId) => positions.has(channelId),
    readMine: (channelId) => positions.get(channelId)?.mine || 0,
    readAll: (channelId) => positions.get(channelId)?.all || 0,
    // First sight on this device: everything up to the current head is past.
    baseline(channelId, headSeq) {
      if (!authority || positions.has(channelId)) return false;
      const head = historyNumeric(headSeq);
      positions.set(channelId, { mine: head, all: head });
      persist();
      return true;
    },
    // The ledger head moved below a position (a rebuilt ledger in the same
    // world): nothing above the head can have been read.
    clampToHead(channelId, headSeq) {
      const current = positions.get(channelId);
      const head = historyNumeric(headSeq);
      if (!current || (current.mine <= head && current.all <= head)) return false;
      positions.set(channelId, { mine: Math.min(current.mine, head), all: Math.min(current.all, head) });
      persist();
      return true;
    },
    advance(channelId, seq, { all = false } = {}) {
      if (!authority) return false;
      const value = historyNumeric(seq);
      const current = positions.get(channelId) || { mine: 0, all: 0 };
      const next = {
        mine: Math.max(current.mine, value),
        all: all ? Math.max(current.all, value) : current.all,
      };
      if (next.mine === current.mine && next.all === current.all) return false;
      positions.set(channelId, next);
      persist();
      return true;
    },
    // Clearing local data forgets where the reader was.
    forgetAll() {
      const had = positions.size > 0;
      positions.clear();
      if (authority && storage) {
        try { storage.removeItem(keyFor(authority)); } catch { /* best effort */ }
      }
      return had;
    },
    destroy() { authority = ''; positions.clear(); },
  });
}

function historyInitial(channelId) {
  return {
    channelId, generation: 0, attached: false, headSeq: 0, beforeSeq: 0,
    messageCurrent: false, controlCurrent: false,
    controlCoverage: [], controlTailCoverage: false, controlParentClosure: false,
    notificationAuthorityRevision: 0,
    notificationContextReady: false,
    hasOlder: false, loading: false, foregroundLoading: false, backgroundLoading: false,
    error: '', errorCode: '', completedPages: 0, coverage: [], lastSource: '', buffered: 0,
    historyDemand: Object.freeze({ revision: 0, phase: 'idle', error: '' }),
  };
}

// A history demand may be issued by Workspace as soon as the wire reports
// `open`, while the grant/meta frame is still in flight. Keep only the
// replay-safe request fields; AbortSignal and operation callbacks belong to
// the superseded call and must never be replayed into a new generation.
function replayableHistoryRequest(request = {}) {
  const replay = { ...request };
  delete replay.signal;
  delete replay.onOperation;
  delete replay.semanticDemand;
  return replay;
}

function controlTailRange(status) {
  const target = historyNumeric(status?.headSeq);
  if (!target) return null;
  return (status?.controlCoverage || []).find((range) => (
    historyNumeric(range?.lowSeq) <= target
    && historyNumeric(range?.highSeq) >= target
  )) || null;
}

// A control tail is not complete merely because the newest sequence is
// present. Every lifecycle row in the admitted tail must have its exact
// parent in Replica's envelope index; otherwise a terminal/progress frame can
// still be reclassified when the parent arrives and resurrect a queued
// control. Compact terminal closures are represented in that same index by
// ChannelReplica, so this remains a read-only join rather than a second fold.
function controlParentClosure(state, tail) {
  if (!state || !tail || !(state.rows instanceof Map)) return true;
  const envelopes = state._envelopesById;
  if (!(envelopes instanceof Map)) return false;
  for (const [seq, envelope] of state.rows) {
    if (seq < tail.lowSeq || seq > tail.highSeq) continue;
    const parentID = String(envelope?.parent_id || '');
    if (parentID && !envelopes.has(parentID)) return false;
  }
  const visit = (entry) => {
    if (entry?.kind !== 'turn' || !entry.turn) return true;
    if (!entry.turn.terminal) {
      const requestSeq = historyNumeric(entry.turn.requestSeq || entry.seq);
      if (requestSeq && (requestSeq < tail.lowSeq || requestSeq > tail.highSeq)) return false;
    }
    return (entry.thread || []).every(visit);
  };
  if (!(state.timeline || []).every(visit)) return false;
  return true;
}

// A DOM tail boundary is only a candidate notification fence. Walk the
// canonical installed rows up to that frozen boundary and stop at the first
// physical gap or response-first terminal whose exact parent is not yet in
// Replica's envelope index. This is deliberately a Feed/Replica join rather
// than a second notification fold: a late parent must be able to make the
// earlier terminal visible even after a tail observation has arrived.
function rowsCoverRange(state, after, through) {
  const start = historyNumeric(after) + 1;
  const end = historyNumeric(through);
  if (end < start) return true;
  const seqs = [...(state?.rows?.keys?.() || [])]
    .map((seq) => historyNumeric(seq))
    .filter((seq) => seq >= start && seq <= end)
    .sort((left, right) => left - right);
  let expected = start;
  for (const seq of seqs) {
    if (seq < expected) continue;
    if (seq !== expected) return false;
    expected += 1;
    if (expected > end) return true;
  }
  return expected > end;
}

export function createChannelFeedRuntime(options = {}) {
  const {
    wireRef = { current: null }, rosterRef = { current: null }, accessRef = { current: null },
    activeChannelRef = { current: '' },
  } = options;
  let bindings = options;
  const callback = (name, ...args) => bindings[name]?.(...args);
  const replica = createChannelReplicaStore();
  const cache = createChannelReplicaCache();
  const cursors = createReadPositions();
  const admission = createHistoryPresentationAdmission({ onChange: publish });
  const histories = new Map();
  const grants = new Map();
  const deferredHistoryRequests = new Map();
  const subscribers = new Set();
  const ownerCommands = new Map();
  // An owner snapshot is a pure merge of the published snapshot with that
  // owner's fixed commands, but it is read once per render while the snapshot
  // only changes on publish. Returning a fresh object each render would make
  // every consumer memo keyed on `feed` recompute unconditionally, which is
  // how a keystroke ends up rebuilding cross-channel projections.
  const ownerSnapshots = new Map();
  // Background interests are owned by Feed, not by a consumer's component
  // lifecycle. A consumer receives only a typed lease and can release it;
  // Feed owns the AbortController and the history operation itself.
  const backgroundInterests = new Map();
  const executor = createHistoryBoundedExecutor({ concurrency: 2, timeoutMs: HISTORY_BATCH_TIMEOUT_MS });
  const networkBatches = new Map();
  const networkBatchAccessFailures = new Map();
  // One physical owner per admitted range.  The operation contains only raw
  // source work and its authority fence; every caller is represented by a
  // separate waiter below and performs its own projection/admission settle.
  const physicalOperations = new Map();
  const activePhysicalByChannel = new Map();
  const semanticDemands = new Map();
  const activityEntries = new Map();
  const timerEvents = [];
  // A committed following observation suppresses only the short interval
  // between a live ingress publication and the next DOM observation. It is
  // never persisted and never advances high-water by itself; leaving the
  // committed owner revokes it, after which any still-unconfirmed row is
  // visible again.
  let generation = 0;
  let semanticAuthorityRevision = 0;
  let principalEpoch = 0;
  let worldEpoch = 0;
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
  let lifecycleEpoch = 0;
  let snapshot;
  let activityConnected = false;
  let activityRevision = 0;
  let timerRevision = 0;
  let timerAcknowledgedRevision = 0;
  let timerOverflow = null;
  let notificationAuthorityRevision = 0;
  let releaseRailDiagnostic = null;

  // The cache is only a cache: its failures are recorded, never surfaced as
  // an application error and never allowed to stop a flow.
  const cacheError = (error) => {
    if (!destroyed && error?.code !== 'cache_owner_changed') diagnostic('warn', 'replica_cache.failed', { error });
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
        settledSeq: historyNumeric(row.seq),
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
      || !isCanonicalAgentTimerFire(row?.envelope)) return false;
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
      // A completion the reader has already read past is no longer news.
      const settledUnread = entry.state === 'settled'
        && !(entry.settledSeq > 0 && entry.settledSeq <= cursors.readMine(entry.channelId));
      if ((!visibleActive && !settledUnread) || (channelId && entry.channelId !== channelId)) continue;
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

  // Cancellation is a Feed-owned lifecycle edge. Once the local operation is
  // cancelled, a transport that has already detached cannot receive the
  // best-effort remote cancel; that is the same cancellation outcome, not a
  // new history failure. Keep the classification narrow so a server-side or
  // protocol error on an attached wire is still reported to the Feed owner.
  const detachedCancellationCodes = new Set(['unavailable', 'closed']);
  const cancelledBatches = new WeakSet();
  const isDetachedCancellation = (error) => detachedCancellationCodes.has(String(error?.code || ''));
  const cancelOwnedBatch = (batch, reason) => {
    if (cancelledBatches.has(batch)) return Promise.resolve({ kind: 'cancelled', duplicate: true });
    cancelledBatches.add(batch);
    return Promise.resolve()
      .then(() => adapters.cancel(batch, reason))
      .catch((error) => {
        if (isDetachedCancellation(error)) return { kind: 'cancelled', detached: true };
        if (destroyed) return { kind: 'cancelled', destroyed: true };
        // The local operation is already cancelled, but an attached-wire
        // failure must remain observable instead of being silently swallowed
        // by a void cancellation call.
        callback('onError', error);
        return { kind: 'failed', error };
      });
  };

  // Access failures belong to the complete physical authority tuple that sent
  // the request. Generation alone is insufficient because a same-generation
  // principal/world/attach replacement must not be revoked by a late result.
  function authorityTupleCurrent(channelId, authority) {
    const status = histories.get(channelId);
    return Boolean(authority
      && !destroyed
      && !incompatible
      && principalEpoch === authority.principalEpoch
      && worldEpoch === authority.worldEpoch
      && generation === authority.generation
      && attachEpoch === authority.attachEpoch
      && status?.attached === true
      && status.messageCurrent === true
      && status.generation === authority.generation);
  }

  function projectAccessFailure(channelId, error, authority) {
    if (destroyed) return false;
    const code = String(error?.code || error || '');
    if (!channelId || !authorityTupleCurrent(channelId, authority)
      || (code !== 'forbidden' && !ACCESS_UNAVAILABLE_CODES.has(code))) return false;
    let feedChanged = false;
    if (code === 'forbidden') {
      grants.delete(channelId);
      // A current forbidden result revokes both access authority and the
      // channel's in-memory projection.  Keep this channel-scoped: a late
      // result from an older authority is rejected above, and other granted
      // channels must remain visible.
      replica.reset(channelId);
      const status = histories.get(channelId);
      if (status?.generation === authority.generation
        && (status.attached || status.messageCurrent || status.controlCurrent)) {
        status.attached = false;
        status.messageCurrent = false;
        status.controlCurrent = false;
        status.controlCoverage = [];
        status.controlTailCoverage = false;
        status.controlParentClosure = false;
        status.notificationAuthorityRevision = ++notificationAuthorityRevision;
        feedChanged = true;
      }
      accessRef.current?.forbidden?.(channelId);
      rosterRef.current?.clearSelf?.(channelId);
    } else accessRef.current?.unavailable?.(channelId, code);
    if (feedChanged) publish();
    callback('onAccessChanged');
    return true;
  }

  function historyState(channelId) {
    if (histories.has(channelId)) return histories.get(channelId);
    const status = historyInitial(channelId);
    if (!destroyed) histories.set(channelId, status);
    return status;
  }

  function refreshControlCurrent(channelId, status = historyState(channelId)) {
    if (destroyed) return false;
    const target = historyNumeric(status.headSeq);
    const attached = status.attached === true
      && status.generation > 0
      && status.generation === generation
      && localReplicaReady !== false;
    const tail = attached && target > 0 ? controlTailRange(status) : null;
    const tailCovered = target === 0 ? attached : Boolean(tail);
    const parentClosed = target === 0
      ? true
      : Boolean(tail && controlParentClosure(replica.state(channelId), tail));
    const next = Boolean(attached && tailCovered && parentClosed);
    status.controlTailCoverage = tailCovered;
    status.controlParentClosure = parentClosed;
    status.controlCurrent = next;
    return next;
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
    coverageRows = null,
  } = {}) {
    if (destroyed || incompatible || (source === 'live' && producerToken !== ownerToken)) return [];
    const accepted = [];
    const landedMessageIDs = new Set();
    const closedRequestIDs = new Set();
    const landedSubmissionIdentities = new Map();
    const discoveredChannels = new Set();
    const newlyDiscoveredChannels = new Set();
    let accessChanged = false;
    let directoryInvalidatedEnvelope = null;
    for (const row of rows || []) {
      const selfID = rosterRef.current?.self?.(row?.channel_id) || '';
      const result = replica.commit(row, selfID, (value) => value, { source });
      if (!result.accepted) continue;
      accepted.push(result.row);
      discoveredChannels.add(row.channel_id);
      if (!histories.has(row.channel_id)) newlyDiscoveredChannels.add(row.channel_id);
      const status = histories.get(row.channel_id);
      // An inactive grant with no local Meta/rows must not advance its
      // notification boundary merely because the server advertised a head.
      // The first post-grant live row is the narrow point at which the
      // existing tail can become a usable baseline; history/cache admission
      // keeps its own closure rules.
      if (source === 'live' && status?.attached && status.generation === generation
        && historyNumeric(row.seq) > historyNumeric(status.headSeq)) {
        // A channel first seen through a live row starts at the head before it.
        cursors.baseline(row.channel_id, status.headSeq);
      }
      if (source !== 'cache' && status?.attached && status.generation === generation
        && historyNumeric(row.seq) > 0
        && (!coverageRows || coverageRows.has(historyNumeric(row.seq)))) {
        status.controlCoverage = mergeReplicaCoverage(status.controlCoverage, {
          lowSeq: historyNumeric(row.seq), highSeq: historyNumeric(row.seq),
        });
      }
      if (source === 'live' && status?.attached && status.generation === generation) {
        const nextHead = Math.max(status.headSeq, historyNumeric(row.seq));
        const wasCurrent = status.messageCurrent === true;
        if (nextHead !== status.headSeq || !wasCurrent) {
          status.headSeq = nextHead;
          status.messageCurrent = true;
          // A live head advance is not an owner replacement. Frozen
          // notification confirmations must remain valid while later rows
          // arrive; only the first transition into a current attached
          // authority gets a new authority revision.
          if (!wasCurrent) status.notificationAuthorityRevision = ++notificationAuthorityRevision;
        }
      }
      if (source === 'live') {
        accessChanged = Boolean(accessRef.current?.live?.(row.channel_id)) || accessChanged;
        rosterRef.current?.handleEnvelope?.(row.channel_id, row.envelope);
        if (!directoryInvalidatedEnvelope && invalidatesChannelDirectory(row.envelope)) {
          directoryInvalidatedEnvelope = row.envelope;
        }
      }
      if (row.envelope?.id) {
        landedMessageIDs.add(row.envelope.id);
        landedSubmissionIdentities.set(
          `${row.channel_id}\u0000${row.envelope.id}`,
          { channelId: row.channel_id, messageId: row.envelope.id },
        );
      }
      if (row.envelope?.kind === 'response'
        && FINAL.has(argsOf(row.envelope)?.status)
        && row.envelope?.parent_id) {
        landedMessageIDs.add(row.envelope.parent_id);
        landedSubmissionIdentities.set(
          `${row.channel_id}\u0000${row.envelope.parent_id}`,
          { channelId: row.channel_id, messageId: row.envelope.parent_id },
        );
        closedRequestIDs.add(row.envelope.parent_id);
        const request = result.record.state._envelopesById.get(row.envelope.parent_id);
        const closedTarget = String(argsOf(request)?.target || argsOf(row.envelope)?.target || '');
        if (closedTarget) closedRequestIDs.add(closedTarget);
      }
      observeAgentActivity(result.row, source);
      observeTimerFiring(result.row, source);
    }
    // Admit the whole batch before applying the bounded mobile suffix.  The
    // Replica must see terminal/request pairs together so its existing
    // compact-closure reconciliation remains the only closure owner.
    for (const channelId of discoveredChannels) trimMobileReplica(replica, channelId);
    for (const channelId of discoveredChannels) {
      const status = histories.get(channelId);
      if (status) refreshControlCurrent(channelId, status);
    }
    if (accepted.length) {
      // A live row for an already-granted channel is not a channel discovery.
      // Re-notifying the shell for every progress frame bumps navigation and
      // recreates its channel projection, which can recursively restart
      // unrelated resource reads while Replica admits the live burst.
      if (newlyDiscoveredChannels.size) callback('onChannelsDiscovered', newlyDiscoveredChannels);
      if (producerToken === ownerToken) {
        let ownedSubmissionLanded = false;
        for (const identity of landedSubmissionIdentities.values()) {
          ownedSubmissionLanded = markOwnedSubmissionLanded(
            bindings.submissionCorrelationPort,
            identity.channelId,
            identity.messageId,
          ) || ownedSubmissionLanded;
        }
        // Passive progress is not evidence that one of the caller's pending
        // submissions changed. Terminal closures still cross this seam for
        // Composer-owned control state keyed by a closed request.
        if (ownedSubmissionLanded || closedRequestIDs.size) {
          callback('onSubmissionFeed', landedMessageIDs, closedRequestIDs, producerToken);
        }
      }
      if (accessChanged) callback('onAccessChanged');
      if (directoryInvalidatedEnvelope) callback('onDirectoryInvalidated', directoryInvalidatedEnvelope);
      // A reader following a channel on a visible page sees what arrives in
      // it: read it in the same publish, so it is never counted unread for
      // the frame before the reader's own report lands.
      if (source === 'live' && liveFollowers.size) readFollowedArrivals(accepted);
      if (publishChange) publish({ index: true });
      if (source === 'live') {
        for (const row of accepted) diagnostic('debug', 'feed.live_applied', { channelId: row.channel_id, seq: historyNumeric(row.seq), msgType: String(row.envelope?.msg_type || row.envelope?.type || ''), sender: String(row.envelope?.sender?.id || '') });
      }
      if (persist) void cache.saveRows(accepted).catch(cacheError);
    }
    return accepted;
  }

  function notificationContextState(channelId, state, boundary, selfID) {
    const status = histories.get(channelId);
    const pending = !cursors.isReadAuthorityReady()
      || !selfID
      || localReplicaReady !== true
      || status?.attached !== true
      || status?.messageCurrent !== true
      || status?.generation !== generation
      || status?.loading === true
      || status?.foregroundLoading === true
      || status?.historyDemand?.phase === 'pending';
    let unknown = pending || Boolean(localReplicaError || status?.error);
    const rows = state?.rows;
    const hasRows = rows instanceof Map && rows.size > 0;
    const target = Math.max(
      historyNumeric(status?.headSeq),
      replica.visibleNewest(channelId),
    );
    // A nonzero grant may have already supplied a durable physical head while
    // this inactive channel still has no local Meta/rows. Keep that context
    // unknown even when the cursor was baselined for the normal live-tail
    // path; the first materialized tail/history rows can then prove it.
    const reachesGrantedHead = replica.visibleNewest(channelId) >= target;
    if (target > 0 && status?.notificationContextReady !== true
      && (!hasRows || !reachesGrantedHead)) unknown = true;
    // A zero-head grant is an authoritative empty context even when the
    // channel is inactive. Only a head ahead of materialized rows, or a
    // sparse physical window, remains unknown; low-frequency identities must
    // not all fail-stop behind a permanent pending badge.
    if (!hasRows && target > boundary) unknown = true;
    if (target > boundary && !rowsCoverRange(state, boundary, target)) unknown = true;
    return { pending, unknown };
  }

  // Unread = notifiable rows from others above the reader's read position:
  // rows related to the reader above `mine`, the rest above `all`. Rows at or
  // below a position are history to this reader, however they were loaded.
  function unreadRoots(channelId, selfID = '') {
    const state = replica.state(channelId);
    const mine = cursors.readMine(channelId);
    const all = cursors.readAll(channelId);
    const low = Math.min(mine, all);
    const related = new Set();
    const other = new Set();
    let unknown = false;
    for (const [seq, envelope] of state?.rows || []) {
      if (seq <= low || samePerson(envelope?.sender?.id, selfID)) continue;
      const disposition = notificationDisposition(state, envelope, selfID);
      if (disposition === 'notification_context_unknown') {
        unknown = true;
        continue;
      }
      if (!isRailNotifiableDisposition(disposition)) continue;
      const rootID = notificationRootID(state, envelope);
      if (!rootID) {
        unknown = true;
        continue;
      }
      if (notificationRelatesTo(state, envelope, selfID)) {
        if (seq > mine) related.add(String(rootID));
      } else if (seq > all) other.add(String(rootID));
    }
    // A root belongs to one projection; related wins.
    for (const rootID of related) other.delete(rootID);
    return { related, other, unknown, low, state };
  }

  function unreadFor(channelId, selfID = '') {
    if (!cursors.isReadAuthorityReady() || !selfID) {
      return notificationProjection({ pending: true, unknown: true });
    }
    const roots = unreadRoots(channelId, selfID);
    const context = notificationContextState(channelId, roots.state, roots.low, selfID);
    return notificationProjection({
      related: roots.related.size,
      other: roots.other.size,
      pending: context.pending,
      unknown: context.unknown || roots.unknown,
    });
  }

  function unreadRootsFor(channelId, selfID = '') {
    if (!cursors.isReadAuthorityReady() || !selfID) return EMPTY_UNREAD_ROOTS;
    const roots = unreadRoots(channelId, selfID);
    return Object.freeze({ related: roots.related, other: roots.other });
  }

  // The reader has seen `seq` in this channel. In the unfiltered "all" view
  // everything up to it was on screen; in any other view only rows related to
  // the reader were. Monotone: a stale or repeated report changes nothing.
  const liveFollowers = new Map();
  // The reading owner registers while it follows the newest row of a visible
  // channel; every row that then arrives live is on its way onto the screen.
  function followLive(channelId, { all = false } = {}) {
    const id = String(channelId || '');
    if (!id || destroyed) return () => {};
    const token = {};
    liveFollowers.set(id, { all: all === true, token });
    return () => { if (liveFollowers.get(id)?.token === token) liveFollowers.delete(id); };
  }
  function readFollowedArrivals(rows) {
    if (globalThis.document?.visibilityState === 'hidden') return;
    const high = new Map();
    for (const row of rows) {
      const channelId = String(row?.channel_id || '');
      if (!liveFollowers.has(channelId)) continue;
      high.set(channelId, Math.max(high.get(channelId) || 0, historyNumeric(row.seq)));
    }
    for (const [channelId, seq] of high) {
      const status = histories.get(channelId);
      if (!status?.attached || status.generation !== generation) continue;
      const bounded = Math.min(seq, historyNumeric(status.headSeq) || seq);
      if (bounded > 0) cursors.advance(channelId, bounded, { all: liveFollowers.get(channelId).all });
    }
  }

  function markSeen(channelId, seq, { all = false } = {}) {
    if (destroyed) return false;
    const status = histories.get(channelId);
    if (!status?.attached || status.generation !== generation) return false;
    const bounded = Math.min(historyNumeric(seq), historyNumeric(status.headSeq));
    if (!(bounded > 0)) return false;
    const changed = cursors.advance(channelId, bounded, { all });
    if (changed) publish();
    return changed;
  }

  // Diagnostics is an observation port for the rail, not another owner.
  function railDiagnosticSnapshot(requestedChannelId = '') {
    const channelIDs = new Set([...replica.states().keys(), ...histories.keys()]);
    const channels = [];
    for (const channelId of channelIDs) {
      if (requestedChannelId && channelId !== requestedChannelId) continue;
      const selfID = rosterRef.current?.self?.(channelId) || '';
      const counts = unreadFor(channelId, selfID);
      channels.push(Object.freeze({
        channelId,
        authorityReady: cursors.isReadAuthorityReady(),
        readMine: cursors.readMine(channelId),
        readAll: cursors.readAll(channelId),
        headSeq: historyNumeric(histories.get(channelId)?.headSeq),
        counts: { related: counts.related, other: counts.other, pending: counts.pending, unknown: counts.unknown },
      }));
    }
    return Object.freeze({ version: 2, channels: Object.freeze(channels) });
  }

  function batchFor(channelId, request = {}) {
    const status = historyState(channelId);
    const beforeSeq = historyNumeric(request.beforeSeq)
      || replica.visibleOldest(channelId)
      || status.beforeSeq
      || status.headSeq + 1;
    const localMeta = cache.metaSnapshot().get(channelId);
    return {
      authority: Object.freeze({ principalEpoch, worldEpoch, generation, attachEpoch }),
      channelId,
      beforeSeq,
      limit: Math.max(1, historyNumeric(request.limit || request.revealRows) || HISTORY_PAGE_SIZE),
      byteLimit: Math.max(1, historyNumeric(request.byteLimit || request.revealBytes) || HISTORY_BATCH_BYTES),
      source: historySourceFor(localMeta, beforeSeq),
      ref: '',
    };
  }

  async function executeBatch(batch, signal, operation = null) {
    if (signal?.aborted) return { kind: 'cancelled' };
    adapters.prepare(batch);
    const abort = () => { void cancelOwnedBatch(batch, 'history operation aborted'); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const resultPromise = executor.run(() => adapters.execute(batch, {
        priority: operation?.physicalPriority || 'background',
      }), {
        id: operation?.executorID,
        priority: operation?.effectivePriority ?? 0,
        signal,
      });
      if (operation) {
        operation.executorHandle = resultPromise;
        operation.lastBatch = batch;
      }
      const result = await resultPromise;
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
      // Any cache failure — quota, an unreadable store, a page that does not
      // validate — is a miss: the same request goes to the network.
      if (batch.source === 'indexeddb') {
        cacheError(error);
        return { kind: 'cache-miss', cacheUnavailable: error?.code === 'cache_unavailable' };
      }
      return { kind: 'failed', error };
    } finally {
      signal?.removeEventListener('abort', abort);
      if (batch.ref) {
        if (operation && networkBatchAccessFailures.has(batch.ref)) {
          operation.accessFailureCode = networkBatchAccessFailures.get(batch.ref);
          networkBatchAccessFailures.delete(batch.ref);
        }
        networkBatches.delete(batch.ref);
      }
    }
  }

  function removeDeferredHistoryRequest(channelId, expected = null) {
    const current = deferredHistoryRequests.get(channelId);
    if (!current || (expected && current !== expected)) return false;
    current.signal?.removeEventListener?.('abort', current.onAbort);
    deferredHistoryRequests.delete(channelId);
    return true;
  }

  function deferHistoryRequest(channelId, request, demandRevision) {
    removeDeferredHistoryRequest(channelId);
    const record = {
      request: replayableHistoryRequest(request),
      semanticDemand: request.semanticDemand || null,
      signal: request.signal,
      onAbort: null,
    };
    record.onAbort = () => {
      if (!removeDeferredHistoryRequest(channelId, record)) return;
      if (record.semanticDemand) retireSemanticDemand(record.semanticDemand, 'aborted');
      const status = histories.get(channelId);
      if (status?.historyDemand?.revision === demandRevision
        && !record.semanticDemand) {
        status.historyDemand = Object.freeze({ revision: demandRevision, phase: 'idle', error: '' });
      }
      recomputePhysicalStatus(channelId);
      publish();
    };
    if (request.signal?.aborted) return false;
    deferredHistoryRequests.set(channelId, record);
    request.signal?.addEventListener?.('abort', record.onAbort, { once: true });
    return true;
  }

  function takeDeferredHistoryRequest(channelId) {
    const record = deferredHistoryRequests.get(channelId);
    if (!record) return null;
    removeDeferredHistoryRequest(channelId, record);
    return record;
  }

  function clearDeferredHistoryRequests() {
    for (const [channelId, record] of deferredHistoryRequests) {
      removeDeferredHistoryRequest(channelId, record);
    }
  }

  function physicalAuthorityCurrent(operation) {
    const authority = operation?.authority;
    return Boolean(authority
      && !destroyed
      && !incompatible
      && !operation.retired
      && !operation.abortController.signal.aborted
      && authorityTupleCurrent(operation.channelId, authority));
  }

  function historyAdmitted(channelId) {
    const status = historyState(channelId);
    return generation > 0
      && grants.has(channelId)
      && status.attached === true
      && status.generation === generation;
  }

  function physicalOperationKey(channelId, request = {}) {
    if (destroyed || incompatible || request.signal?.aborted) return '';
    const status = historyState(channelId);
    const admitted = historyAdmitted(channelId) && status.messageCurrent === true;
    if (!admitted) return '';
    const batch = batchFor(channelId, request);
    return [
      batch.authority.principalEpoch,
      batch.authority.worldEpoch,
      batch.authority.generation,
      batch.authority.attachEpoch,
      batch.channelId,
      batch.beforeSeq,
      batch.limit,
      batch.byteLimit,
      request.backgroundInterestKey || '',
    ].join('\u0000');
  }

  function semanticIdentity(channelId, request = {}) {
    const token = request.historyRevealIntent;
    if (token) return [
      'reveal', channelId, String(token.viewID || ''), String(token.epoch || ''),
      String(token.activationID || ''),
    ].join('\u0000');
    return [
      'demand', channelId, generation, String(request.intent || HISTORY_INTENT.initialView),
    ].join('\u0000');
  }

  function isSemanticRequest(request = {}) {
    return request.urgency !== HISTORY_URGENCY.anticipatory;
  }

  function ensureSemanticReveal(demand) {
    if (!demand?.revealIntent || demand.revealToken || demand.retired) return demand?.revealToken || null;
    const status = histories.get(demand.channelId);
    if (!status?.attached || !status.messageCurrent || status.generation !== generation) return null;
    demand.revealToken = admission.begin(demand.channelId, demand.revealIntent);
    return demand.revealToken;
  }

  function recomputePhysicalStatus(channelId) {
    const status = histories.get(channelId);
    if (!status) return false;
    const active = [...(activePhysicalByChannel.get(channelId) || [])]
      .filter((operation) => !operation.retired && !operation.settled);
    const hasForeground = active.some((operation) => operation.effectivePriority > 0);
    const hasBackground = active.some((operation) => operation.effectivePriority === 0);
    const demand = semanticDemands.get(channelId);
    const deferredDemand = demand?.phase === 'pending' && !status.attached;
    const next = {
      loading: active.length > 0 || deferredDemand || demand?.continuing === true,
      foregroundLoading: hasForeground || (deferredDemand && demand.foreground),
      backgroundLoading: !hasForeground && hasBackground,
    };
    const changed = status.loading !== next.loading
      || status.foregroundLoading !== next.foregroundLoading
      || status.backgroundLoading !== next.backgroundLoading;
    Object.assign(status, next);
    return changed;
  }

  function addActivePhysical(operation) {
    let active = activePhysicalByChannel.get(operation.channelId);
    if (!active) {
      active = new Set();
      activePhysicalByChannel.set(operation.channelId, active);
    }
    active.add(operation);
    recomputePhysicalStatus(operation.channelId);
  }

  function removeActivePhysical(operation) {
    const active = activePhysicalByChannel.get(operation.channelId);
    if (!active) return;
    active.delete(operation);
    if (!active.size) activePhysicalByChannel.delete(operation.channelId);
    recomputePhysicalStatus(operation.channelId);
  }

  function finishSemanticDemand(demand) {
    if (!demand || demand.retired || demand.operations.size || demand.waiters.size) return false;
    // A reveal scan settles its demand once, after its last physical page.
    if (demand.continuing === true) return false;
    const status = histories.get(demand.channelId);
    if (semanticDemands.get(demand.channelId) !== demand
      || status?.historyDemand?.revision !== demand.revision) return false;
    // A semantic demand may span several physical ranges.  A failed range is
    // only terminal when every range/waiter has settled; a later successful
    // range then clears that transient error.  Never publish `idle` together
    // with a stale status.error from an earlier physical failure.
    const phase = !demand.satisfied && demand.error ? 'error' : 'idle';
    const error = phase === 'error' ? demand.error : '';
    demand.phase = phase;
    demand.error = error;
    status.historyDemand = Object.freeze({ revision: demand.revision, phase, error });
    if (phase === 'error') {
      status.error = error;
      status.errorCode = 'history_failed';
    } else {
      status.error = '';
      status.errorCode = '';
    }
    semanticDemands.delete(demand.channelId);
    recomputePhysicalStatus(demand.channelId);
    return true;
  }

  function retireSemanticDemand(
    demand,
    reason = 'stale-authority',
    replacementAuthorityRevision = null,
  ) {
    if (!demand || demand.retired) return false;
    // Advance the semantic fence before detaching any waiter.  A replacement
    // caller may synchronously observe its own lease while old callbacks are
    // still unwinding, so the old demand must already be terminal/stale.
    const retiredAuthorityRevision = replacementAuthorityRevision
      || ++semanticAuthorityRevision;
    demand.retired = true;
    demand.phase = 'stale';
    demand.retiredAuthorityRevision = retiredAuthorityRevision;
    const operations = new Set(demand.operations);
    for (const [waiter, operation] of [...demand.waiters.entries()]) {
      operations.add(operation);
      waiter.semanticStale = true;
      settleWaiter(waiter, { kind: 'cancelled', reason });
    }
    // Detach all semantic waiters first.  Only then may a physical operation
    // be aborted; a replacement demand can already own another waiter on the
    // same raw range and must keep that operation alive.
    for (const operation of operations) {
      if (!operation.waiters.size) retireOrphanedOperation(operation, reason);
    }
    if (demand.revealToken && !demand.revealSettled) {
      admission.cancel(demand.channelId, demand.revealToken.operationID, {
        sourceRevision: demand.baselineSourceRevision,
      });
      demand.revealSettled = true;
    }
    const status = histories.get(demand.channelId);
    if (semanticDemands.get(demand.channelId) === demand) {
      semanticDemands.delete(demand.channelId);
      if (status?.historyDemand?.revision === demand.revision) {
        status.historyDemand = Object.freeze({ revision: demand.revision, phase: 'idle', error: '' });
        status.error = '';
        status.errorCode = '';
      }
    }
    recomputePhysicalStatus(demand.channelId);
    return true;
  }

  function semanticDemandFor(channelId, request = {}) {
    if (!isSemanticRequest(request)) return null;
    const supplied = request.semanticDemand;
    if (supplied && semanticDemands.get(channelId) === supplied && !supplied.retired) return supplied;
    const key = semanticIdentity(channelId, request);
    const current = semanticDemands.get(channelId);
    if (current && !current.retired && current.key === key) {
      ensureSemanticReveal(current);
      return current;
    }
    const authorityRevision = ++semanticAuthorityRevision;
    if (current && !current.retired) {
      retireSemanticDemand(current, 'stale-authority', authorityRevision);
    }
    const status = historyState(channelId);
    const revision = status.historyDemand.revision + 1;
    const demand = {
      channelId,
      key,
      authorityRevision,
      revision,
      phase: 'pending',
      error: '',
      satisfied: false,
      foreground: historySchedulerPriority(request.urgency || HISTORY_URGENCY.interactive) > 0,
      revealIntent: request.historyRevealIntent || null,
      revealToken: null,
      revealSettled: false,
      waiters: new Map(),
      operations: new Set(),
      retired: false,
      continuing: false,
      pagesIssued: 0,
      baselineSourceRevision: Number(replica.state(channelId)?._timelineRevision || 0),
    };
    semanticDemands.set(channelId, demand);
    Object.assign(status, {
      error: '', errorCode: '',
      historyDemand: Object.freeze({ revision, phase: 'pending', error: '' }),
    });
    ensureSemanticReveal(demand);
    recomputePhysicalStatus(channelId);
    return demand;
  }

  function attachSemanticDemand(operation, demand) {
    if (!demand || demand.retired) return;
    operation.semanticDemands.add(demand);
    demand.operations.add(operation);
    ensureSemanticReveal(demand);
  }

  function settleSemanticOperations(operation, outcome) {
    let changed = false;
    for (const demand of operation.semanticDemands) {
      demand.operations.delete(operation);
      if (demand.retired || semanticDemands.get(demand.channelId) !== demand) continue;
      if (outcome.kind === 'failed' && !demand.error) {
        demand.error = outcome.error?.message || '历史加载失败';
      } else if (outcome.kind === 'page'
        && (!demand.revealIntent || demand.lastObservation?.fulfilled)) {
        demand.satisfied = true;
      }
      changed = finishSemanticDemand(demand) || changed;
    }
    operation.semanticDemands.clear();
    return changed;
  }

  function settleWaiter(waiter, value) {
    if (!waiter || waiter.settled) return false;
    waiter.settled = true;
    waiter.signal?.removeEventListener?.('abort', waiter.onAbort);
    waiter.operation.waiters.delete(waiter);
    waiter.semanticDemand?.waiters.delete(waiter);
    waiter.resolve(value);
    return true;
  }

  function retireOrphanedOperation(operation, reason = 'aborted') {
    if (!operation || operation.waiters.size || operation.settled || operation.retired) return false;
    operation.retired = true;
    operation.abortController.abort(reason);
    if (physicalOperations.get(operation.key) === operation) physicalOperations.delete(operation.key);
    removeActivePhysical(operation);
    return true;
  }

  function releaseWaiter(waiter, reason = 'aborted') {
    if (!waiter || waiter.settled) return false;
    const operation = waiter.operation;
    settleWaiter(waiter, { kind: 'cancelled', reason });
    const demand = waiter.semanticDemand;
    if (demand && !demand.waiters.size && !demand.retired) {
      retireSemanticDemand(demand, reason);
    }
    retireOrphanedOperation(operation, reason);
    return true;
  }

  function cancelPhysicalOperations(reason, waiterReason = 'stale-generation') {
    const operations = [...physicalOperations.values()];
    for (const operation of operations) {
      operation.retired = true;
      for (const waiter of [...operation.waiters]) {
        settleWaiter(waiter, { kind: 'cancelled', reason: waiterReason });
      }
      operation.abortController.abort(reason);
      if (physicalOperations.get(operation.key) === operation) physicalOperations.delete(operation.key);
      removeActivePhysical(operation);
    }
    physicalOperations.clear();
    for (const demand of [...semanticDemands.values()]) retireSemanticDemand(demand, waiterReason);
    activePhysicalByChannel.clear();
  }

  function promotePhysicalOperation(operation, request = {}) {
    if (!operation || operation.settled || operation.retired) return false;
    const nextUrgency = request.urgency
      || (request.intent === HISTORY_INTENT.initialView ? HISTORY_URGENCY.interactive : '');
    const nextPriority = historySchedulerPriority(nextUrgency);
    if (nextPriority <= operation.effectivePriority) return false;
    operation.effectivePriority = nextPriority;
    operation.physicalPriority = nextPriority > 0 ? 'foreground' : 'background';
    operation.executorHandle?.promote?.(nextPriority);
    recomputePhysicalStatus(operation.channelId);
    publish();
    return true;
  }

  function waiterLease(waiter) {
    const operation = waiter.operation;
    return Object.freeze({
      signal: waiter.signal,
      viewSpec: waiter.viewSpec,
      reveal: waiter.semanticDemand?.revealToken || null,
      priority: waiter.priority,
      onOperation: waiter.onOperation,
      release: (reason = 'released') => releaseWaiter(waiter, reason),
      promote: (request = {}) => promotePhysicalOperation(operation, request),
    });
  }

  function publishPhysicalCompletion(operation, batch, result, rows, acceptedRows) {
    if (operation.completionPublished || !physicalAuthorityCurrent(operation)) return false;
    operation.completionPublished = true;
    diagnostic('info', 'history.batch_complete', historyBatchCompletionDetail(
      batch,
      result,
      rows,
      histories.get(operation.channelId),
      acceptedRows,
      operation,
    ));
    return true;
  }

  function physicalReceipt(batch, result, rows, acceptedRows) {
    return Object.freeze({
      authority: batch.authority,
      channelId: batch.channelId,
      beforeSeq: batch.beforeSeq,
      limit: batch.limit,
      byteLimit: batch.byteLimit,
      source: batch.source,
      ref: String(batch.ref || ''),
      rows: Array.isArray(rows) ? rows.length : 0,
      acceptedRows: historyNumeric(acceptedRows),
      nextBeforeSeq: historyRangeNumber(result?.next_before_seq ?? result?.nextBeforeSeq, batch.beforeSeq),
      hasOlder: Boolean(result?.has_older ?? result?.hasOlder ?? !result?.exhausted),
    });
  }

  async function runPhysicalOperation(operation) {
    if (!physicalAuthorityCurrent(operation)) {
      return { kind: 'cancelled', reason: 'stale-generation' };
    }
    let batch = operation.batch;
    let outcome = await executeBatch(batch, operation.abortController.signal, operation);
    const rows = [];
    const networkRows = [];
    let result = null;
    let lastSuccessfulBatch = batch;
    let cacheContinuation = 0;
    while (outcome.kind === 'page') {
      if (!physicalAuthorityCurrent(operation)) {
        return { kind: 'cancelled', reason: 'stale-generation' };
      }
      rows.push(...outcome.rows);
      if (batch.source === 'network') networkRows.push(...outcome.rows);
      result = outcome.result;
      lastSuccessfulBatch = batch;
      if (batch.source !== 'indexeddb' || outcome.result.exhausted || outcome.rows.length >= batch.limit) break;
      const nextBefore = historyNumeric(outcome.result.next_before_seq
        ?? outcome.result.nextBeforeSeq ?? batch.beforeSeq);
      cacheContinuation += 1;
      batch = {
        ...batch,
        beforeSeq: nextBefore,
        source: historySourceFor(cache.metaSnapshot().get(operation.channelId), nextBefore),
        ref: '',
      };
      outcome = await executeBatch(batch, operation.abortController.signal, operation);
    }
    if (outcome.kind === 'cache-miss') {
      batch = {
        ...batch,
        source: 'network',
        ref: '',
      };
      outcome = await executeBatch(batch, operation.abortController.signal, operation);
      if (outcome.kind === 'page') {
        rows.push(...outcome.rows);
        networkRows.push(...outcome.rows);
        result = outcome.result;
      }
    }
    if (outcome.kind !== 'page') {
      // A retained cache prefix remains a valid installed fact even when the
      // network continuation fails.  Commit that prefix once, then expose the
      // network failure so the caller can retry without pretending local EOF.
      if (rows.length && !networkRows.length && physicalAuthorityCurrent(operation)) {
        const accepted = applyRows(rows, {
          source: 'cache', persist: false, publishChange: false,
        });
        const status = histories.get(operation.channelId);
        status.beforeSeq = historyNumeric(result?.next_before_seq
          ?? result?.nextBeforeSeq ?? lastSuccessfulBatch.beforeSeq);
        status.hasOlder = true;
        status.lastSource = 'indexeddb';
        status.coverage = replica.record(operation.channelId)?.materializedCoverage || [];
        publishPhysicalCompletion(operation, lastSuccessfulBatch, result, rows, accepted.length);
        return {
          ...outcome,
          acceptedRows: accepted.length,
          receipt: physicalReceipt(lastSuccessfulBatch, result, rows, accepted.length),
        };
      }
      return outcome;
    }
    if (!physicalAuthorityCurrent(operation)) {
      return { kind: 'cancelled', reason: 'stale-generation' };
    }

    // The physical operation has one canonical commit and one durable write
    // boundary.  Cache continuation pages are folded into this raw result;
    // waiters below project the same installed Replica independently.
    const source = networkRows.length ? 'history' : 'cache';
    const coverageRows = networkRows.length
      ? new Set(networkRows.map((row) => historyNumeric(row?.seq)).filter(Boolean))
      : null;
    // Rows the network delivered are installed now; their cache copy is
    // written behind them and never holds a page back, warm or not.
    if (networkRows.length) void cache.saveRows(networkRows).catch(cacheError);
    if (!physicalAuthorityCurrent(operation)) {
      return { kind: 'cancelled', reason: 'stale-generation' };
    }
    const accepted = applyRows(rows, {
      source, persist: false, publishChange: false,
      coverageRows,
    });
    const status = histories.get(operation.channelId);
    status.completedPages += 1;
    status.lastSource = batch.source;
    status.beforeSeq = historyNumeric(result.next_before_seq ?? result.nextBeforeSeq ?? batch.beforeSeq);
    status.hasOlder = result.has_older ?? !result.exhausted ?? false;
    status.coverage = replica.record(operation.channelId)?.materializedCoverage || [];
    const scanLow = historyNumeric(result.scan_low_seq ?? result.scanLowSeq);
    const scanHigh = historyNumeric(result.scan_high_seq ?? result.scanHighSeq);
    if (scanLow && scanHigh >= scanLow) {
      status.controlCoverage = mergeReplicaCoverage(status.controlCoverage, {
        lowSeq: scanLow, highSeq: scanHigh,
      });
    }
    refreshControlCurrent(operation.channelId, status);
    publishPhysicalCompletion(operation, batch, result, rows, accepted.length);
    operation.rawResult = Object.freeze({
      kind: 'page', result, rows: Object.freeze([...rows]),
      acceptedRows: accepted.length,
      receipt: physicalReceipt(batch, result, rows, accepted.length),
    });
    operation.committed = true;
    return operation.rawResult;
  }

  function settleWaiterFromPhysical(waiter, outcome) {
    if (waiter.settled) return;
    const operation = waiter.operation;
    const demand = waiter.semanticDemand;
    if (demand && (
      demand.retired
      || waiter.authorityRevision !== demand.authorityRevision
      || semanticDemands.get(demand.channelId) !== demand
    )) {
      // A physical completion may race semantic navigation replacement.  It
      // is never allowed to settle an old waiter or project its result through
      // the replacement authority.
      settleWaiter(waiter, { kind: 'cancelled', reason: 'stale-authority' });
      return;
    }
    if (outcome.kind !== 'page') {
      settleWaiter(waiter, outcome);
      return;
    }
    const projection = selectTimelineItems(
      replica.state(operation.channelId), waiter.viewSpec || {},
    );
    let observed = demand?.lastObservation || null;
    const revealToken = demand?.revealToken || null;
    const status = histories.get(operation.channelId);
    let scanContinues = false;
    if (revealToken && !demand.revealSettled && !demand.retired) {
      observed = admission.observe(operation.channelId, projection.items, {
        operationID: revealToken.operationID,
        viewID: revealToken.viewID,
        epoch: revealToken.epoch,
        sourceRevision: replica.state(operation.channelId)?._timelineRevision || 0,
      });
      demand.lastObservation = observed;
      const anotherPhysicalPending = [...demand.operations]
        .some((candidate) => candidate !== operation && !candidate.settled && !candidate.retired);
      // A reveal scan (`untilRevealed`) is one semantic operation across as
      // many physical pages as it takes to expose visible rows for this view.
      // A page that only advanced the raw frontier is not a settlement: the
      // admission transaction stays pending with whatever it has staged, and
      // loadUntilRevealed issues the next page under the same demand/signal.
      scanContinues = waiter.request?.untilRevealed === true
        && !observed?.fulfilled
        && observed?.stale !== true
        && observed?.rebased !== true
        && status?.hasOlder === true
        && waiter.signal?.aborted !== true
        && Number(demand.pagesIssued || 0) < HISTORY_REVEAL_MAX_PAGES;
      // A shared reveal authority may span concurrent physical ranges. Keep
      // its one admission transaction pending after an underfilled range so
      // a later range can contribute candidates; settle immediately only
      // when the demand is fulfilled or no physical range remains.
      if (observed?.fulfilled || (!anotherPhysicalPending && !scanContinues)) {
        admission.settle(operation.channelId, observed?.fulfilled ? 'fulfilled' : 'exhausted');
        demand.revealSettled = true;
      }
    }
    const revealed = Number(observed?.completeUnits || 0);
    // One physical page has been projected for this waiter's view. This is
    // the per-page check of the reveal loop: raw rows released against the
    // anchor, and what the view now exposes.
    diagnostic('debug', 'history.projection_checked', {
      channelId: operation.channelId,
      anchorSeq: historyNumeric(waiter.request?.anchorSeq),
      firstVisibleSeq: Number(projection.firstVisibleSeq || 0),
      released: Number(outcome.acceptedRows || 0),
      revealed,
      revealRows: historyNumeric(waiter.request?.revealRows),
      revealBytes: historyNumeric(waiter.request?.revealBytes),
      page: Number(demand?.pagesIssued || 0),
      kind: scanContinues ? 'continue' : (observed?.fulfilled ? 'fulfilled' : ''),
    });
    // A reveal waiter is satisfied by visible rows, never by raw rows alone:
    // the reader asked to see older history, and a physically accepted page
    // with nothing visible for this view is a segment, not a settlement.
    const kind = scanContinues
      ? 'continue'
      : revealToken
        ? (observed?.fulfilled || revealed > 0 ? 'satisfied' : status?.hasOlder ? 'segment' : 'exhausted')
        : (outcome.acceptedRows || observed?.fulfilled
          ? 'satisfied' : status?.hasOlder ? 'segment' : 'exhausted');
    settleWaiter(waiter, {
      kind,
      released: outcome.acceptedRows,
      revealed,
      firstVisibleSeq: projection.firstVisibleSeq,
      projection,
    });
  }

  function semanticWaiterCurrent(waiter) {
    const demand = waiter?.semanticDemand;
    if (!demand || demand.retired
      || waiter.authorityRevision !== demand.authorityRevision
      || semanticDemands.get(demand.channelId) !== demand) return false;
    const revealToken = demand.revealToken;
    if (!revealToken) return true;
    const admissionState = admission.snapshot(demand.channelId);
    const currentToken = admissionState?.token || admissionState?.committed;
    return Boolean(currentToken
      && admissionState.phase !== 'idle'
      && admissionState.phase !== 'holding'
      && currentToken.cancelled !== true
      && String(currentToken.operationID || '') === String(revealToken.operationID || '')
      && String(currentToken.activationID || '') === String(revealToken.activationID || '')
      && String(currentToken.viewID || '') === String(revealToken.viewID || '')
      && String(currentToken.epoch || '') === String(revealToken.epoch || ''));
  }

  function hasCurrentSemanticWaiter(operation) {
    return [...(operation?.waiters || [])].some((waiter) => semanticWaiterCurrent(waiter));
  }

  function settlePhysicalOperation(operation, outcome) {
    if (operation.settled) return;
    operation.settled = true;
    // Physical rows/cache are allowed to finish after a semantic navigation
    // revoke.  The public Presentation/index notification is narrower: it
    // belongs only to an exact live semantic waiter whose admission still
    // addresses the current transaction.  A stale page therefore remains a
    // materialized fact without waking the current Reading owner.
    const currentSemanticWaiter = hasCurrentSemanticWaiter(operation);
    let publishNeeded = false;
    if (outcome.kind === 'failed') {
      const accessProjected = Boolean(operation.accessFailureCode)
        || projectAccessFailure(operation.channelId, outcome.error, operation.authority);
      if (!accessProjected) callback('onError', outcome.error);
    }
    for (const waiter of [...operation.waiters]) settleWaiterFromPhysical(waiter, outcome);
    const semanticChanged = settleSemanticOperations(operation, outcome);
    if (physicalOperations.get(operation.key) === operation) physicalOperations.delete(operation.key);
    removeActivePhysical(operation);
    recomputePhysicalStatus(operation.channelId);
    publishNeeded = currentSemanticWaiter && semanticChanged;
    // An anticipatory filtered scan has no semantic waiter by design.  Its
    // final zero-row page still owns the physical EOF fact, however: without
    // publishing the status transition, the current Presentation retains
    // the preceding `loading=true/hasOlder=true` snapshot forever and cannot
    // replace its partial empty feedback with the definitive one.  Keep the
    // stale-page fence for materialized rows; only this empty authoritative
    // boundary may wake the public status projection without a live semantic
    // waiter.
    const emptyAuthoritativeEOF = outcome.kind === 'page'
      && Number(outcome.acceptedRows || 0) === 0
      && histories.get(operation.channelId)?.hasOlder === false;
    if (publishNeeded || (currentSemanticWaiter && outcome.kind === 'page')
      || emptyAuthoritativeEOF) {
      publish({ index: outcome.kind === 'page' && outcome.acceptedRows > 0 });
    }
  }

  function createPhysicalOperation(channelId, request, key, semanticDemand = null) {
    const batch = batchFor(channelId, request);
    const operation = {
      key, channelId, batch,
      authority: Object.freeze({
        ...batch.authority,
        channelId,
        beforeSeq: batch.beforeSeq,
        limit: batch.limit,
        byteLimit: batch.byteLimit,
      }),
      abortController: new AbortController(),
      waiters: new Set(),
      semanticDemands: new Set(),
      effectivePriority: historySchedulerPriority(request.urgency || HISTORY_URGENCY.interactive),
      physicalPriority: historySchedulerPriority(request.urgency || HISTORY_URGENCY.interactive) > 0
        ? 'foreground' : 'background',
      executorID: `history:${key}`,
      executorHandle: null,
      rawResult: null,
      committed: false,
      completionPublished: false,
      settled: false,
      retired: false,
      lastBatch: batch,
    };
    attachSemanticDemand(operation, semanticDemand);
    physicalOperations.set(key, operation);
    addActivePhysical(operation);
    operation.promise = Promise.resolve().then(() => runPhysicalOperation(operation)).then(
      (outcome) => { settlePhysicalOperation(operation, outcome); return outcome; },
      (error) => {
        const outcome = { kind: 'failed', error };
        settlePhysicalOperation(operation, outcome);
        return outcome;
      },
    );
    void operation.promise.catch(() => {});
    return operation;
  }

  function attachHistoryWaiter(operation, request, semanticDemand = null) {
    let resolve;
    const promise = new Promise((settle) => { resolve = settle; });
    attachSemanticDemand(operation, semanticDemand);
    const waiter = {
      operation,
      request,
      viewSpec: historyViewSpecSnapshot(request.viewSpec || {}),
      semanticDemand,
      signal: request.signal,
      priority: historySchedulerPriority(request.urgency || HISTORY_URGENCY.interactive),
      onOperation: request.onOperation,
      onAbort: null,
      resolve,
      settled: false,
      authorityRevision: semanticDemand?.authorityRevision || 0,
    };
    waiter.onAbort = () => releaseWaiter(waiter, 'aborted');
    operation.waiters.add(waiter);
    if (semanticDemand && !semanticDemand.retired) {
      // Keep the operation and semantic demand registries in lockstep before
      // invoking any caller callback.  Replacement can therefore retire and
      // settle every old waiter synchronously, including callback re-entry.
      semanticDemand.waiters.set(waiter, operation);
    }
    request.signal?.addEventListener?.('abort', waiter.onAbort, { once: true });
    try {
      request.onOperation?.(waiterLease(waiter));
    } catch (error) {
      releaseWaiter(waiter, 'operation-callback-failed');
      callback('onError', error);
    }
    if (request.signal?.aborted) releaseWaiter(waiter, 'aborted');
    if (!waiter.settled && request.urgency !== HISTORY_URGENCY.anticipatory) {
      promotePhysicalOperation(operation, request);
    }
    if (operation.rawResult) queueMicrotask(() => settleWaiterFromPhysical(waiter, operation.rawResult));
    return promise;
  }

  function loadHistory(channelId, request = {}) {
    if (destroyed) return Promise.resolve({ kind: 'cancelled', reason: 'runtime-destroyed' });
    if (incompatible) return Promise.resolve({ kind: 'cancelled', reason: 'version-incompatible' });
    if (request.signal?.aborted) return Promise.resolve({ kind: 'cancelled', reason: 'aborted' });
    const status = historyState(channelId);
    const semanticDemand = semanticDemandFor(channelId, request);
    const admitted = historyAdmitted(channelId);
    if (!admitted) {
      deferHistoryRequest(channelId, { ...request, semanticDemand }, semanticDemand?.revision || status.historyDemand.revision);
      recomputePhysicalStatus(channelId);
      publish();
      return Promise.resolve({ kind: 'waiting', reason: 'history-grant-pending' });
    }
    removeDeferredHistoryRequest(channelId);
    if (request.untilRevealed === true && semanticDemand?.revealIntent && !request.revealScanPage) {
      return loadUntilRevealed(channelId, request, semanticDemand);
    }
    return loadPhysicalPage(channelId, request, semanticDemand);
  }

  function loadPhysicalPage(channelId, request, semanticDemand) {
    const key = physicalOperationKey(channelId, request);
    if (!key) return Promise.resolve({ kind: 'cancelled', reason: 'history-not-admitted' });
    let operation = physicalOperations.get(key);
    if (!operation || operation.retired) operation = createPhysicalOperation(channelId, request, key, semanticDemand);
    const promise = attachHistoryWaiter(operation, request, semanticDemand);
    publish();
    return promise;
  }

  // One reveal request is one semantic operation. next() is one bounded
  // physical page; project() is the waiter's own view projection, evaluated
  // by admission after every page. Empty or fully hidden pages continue the
  // same operation here, in the feed owner, with no React render or callback
  // edge in between. The operation settles on: visible rows for this view,
  // authoritative EOF, abort, source failure, or the page bound.
  async function loadUntilRevealed(channelId, request, demand) {
    demand.continuing = true;
    demand.pagesIssued = 0;
    let issuedBefore = 0;
    let outcome = { kind: 'cancelled', reason: 'reveal-scan-not-started' };
    try {
      for (let page = 0; page < HISTORY_REVEAL_MAX_PAGES; page += 1) {
        if (request.signal?.aborted) return { kind: 'cancelled', reason: 'aborted', pages: page };
        if (demand.retired || semanticDemands.get(channelId) !== demand) {
          return { kind: 'cancelled', reason: 'stale-authority', pages: page };
        }
        if (!historyAdmitted(channelId)) return { kind: 'cancelled', reason: 'history-not-admitted', pages: page };
        const status = historyState(channelId);
        const beforeSeq = page === 0
          ? batchFor(channelId, request).beforeSeq
          : historyNumeric(status.beforeSeq);
        // A page that failed to move the cursor strictly older is a bounded
        // terminal for this scan, not a reason to fetch the same range again.
        if (page > 0 && (!beforeSeq || beforeSeq >= issuedBefore)) {
          return { ...outcome, kind: status.hasOlder ? 'segment' : 'exhausted', reason: 'no-progress', pages: page };
        }
        demand.pagesIssued = page + 1;
        issuedBefore = beforeSeq;
        outcome = await loadPhysicalPage(channelId, {
          ...request, beforeSeq, semanticDemand: demand, revealScanPage: page + 1,
        }, demand);
        if (outcome.kind !== 'continue') return { ...outcome, pages: page + 1 };
        diagnostic('debug', 'history.reveal_scan_continue', {
          channelId, page: page + 1, beforeSeq,
          nextBeforeSeq: historyNumeric(historyState(channelId).beforeSeq),
          released: Number(outcome.released || 0), revealed: Number(outcome.revealed || 0),
        });
      }
      return { ...outcome, kind: historyState(channelId).hasOlder ? 'segment' : 'exhausted', reason: 'page-bound', pages: HISTORY_REVEAL_MAX_PAGES };
    } finally {
      demand.continuing = false;
      const finished = finishSemanticDemand(demand);
      const statusChanged = recomputePhysicalStatus(channelId);
      if (finished || statusChanged) publish();
    }
  }

  async function durableWarmRows(channelId) {
    // `saveRows` is the Replica cache's single write queue.  A warm waiter can
    // join a physical operation that was created by another anticipatory
    // caller, so fence this read behind any already-started durable write.
    await cache.saveRows([]);
    const result = await cache.readBefore(
      channelId,
      Number.MAX_SAFE_INTEGER,
      WARM_CACHE_TARGET_ROWS,
      HISTORY_BATCH_BYTES,
    );
    return result.rows.length;
  }

  function backgroundInterestCurrent(record) {
    return Boolean(record
      && !record.cancelled
      && !destroyed
      && !incompatible
      && !record.abortController.signal.aborted
      && historyAdmitted(record.channelId));
  }

  async function runChannelEntryWarm(record) {
    let previousBefore = 0;
    for (let page = 0; page < WARM_CACHE_MAX_PAGES; page += 1) {
      if (!backgroundInterestCurrent(record)) {
        return { kind: 'cancelled', reason: 'background-interest-stale' };
      }
      const statusBefore = historyState(record.channelId);
      const beforeSeq = historyNumeric(statusBefore.beforeSeq)
        || historyNumeric(statusBefore.headSeq) + 1;
      if (!beforeSeq) return { kind: 'unavailable', reason: 'history-cursor-unavailable' };
      const outcome = await loadHistory(record.channelId, {
        intent: record.intent,
        urgency: HISTORY_URGENCY.anticipatory,
        // Channel-entry warm pages share the canonical physical range key
        // with a foreground request so promotion/join remains exact-once.
        beforeSeq,
        signal: record.abortController.signal,
      });
      if (!backgroundInterestCurrent(record)) {
        return { kind: 'cancelled', reason: 'background-interest-stale' };
      }
      if (outcome.kind === 'cancelled') return outcome;
      if (outcome.kind === 'failed') {
        return { kind: 'unavailable', reason: 'history-page-failed', error: outcome.error };
      }
      if (outcome.kind === 'waiting') {
        return { kind: 'unavailable', reason: 'history-grant-lost' };
      }
      const durableRows = await durableWarmRows(record.channelId);
      if (!backgroundInterestCurrent(record)) {
        return { kind: 'cancelled', reason: 'background-interest-stale' };
      }
      const status = historyState(record.channelId);
      if (durableRows >= WARM_CACHE_TARGET_ROWS) {
        return { kind: 'warm', durableRows, pages: page + 1 };
      }
      if (!status.hasOlder) {
        return { kind: 'exhausted', durableRows, pages: page + 1 };
      }
      const nextBefore = historyNumeric(status.beforeSeq);
      // A page that accepted no new physical rows, or failed to move its
      // cursor strictly older, is a bounded terminal—not an EOF and not a
      // reason to retry the same range forever.
      if (!historyNumeric(outcome.released)
        || !nextBefore
        || nextBefore >= beforeSeq
        || (previousBefore && nextBefore >= previousBefore)) {
        return { kind: 'no-progress', durableRows, pages: page + 1 };
      }
      previousBefore = beforeSeq;
    }
    let durableRows = 0;
    try { durableRows = await durableWarmRows(record.channelId); } catch { /* fenced owner */ }
    return { kind: 'budget', durableRows, pages: WARM_CACHE_MAX_PAGES };
  }

  async function runBackgroundInterest(record) {
    if (record.intent === HISTORY_INTENT.channelEntry) return runChannelEntryWarm(record);
    return loadHistory(record.channelId, {
      intent: record.intent,
      urgency: HISTORY_URGENCY.anticipatory,
      backgroundInterestKey: record.key,
      signal: record.abortController.signal,
    });
  }

  function startBackgroundInterest(record) {
    if (!record || record.started || record.cancelled || destroyed || incompatible) return false;
    if (!historyAdmitted(record.channelId)) {
      record.awaitingAdmission = true;
      return false;
    }
    record.started = true;
    record.awaitingAdmission = false;
    record.promise = Promise.resolve()
      .then(() => runBackgroundInterest(record))
      .catch((error) => ({ kind: 'unavailable', reason: 'background-interest-failed', error }))
      .then((outcome) => {
        record.outcome = outcome;
        if (record.intent === HISTORY_INTENT.channelEntry && outcome.kind !== 'cancelled') {
          diagnostic('info', 'history.background_terminal', {
            channelId: record.channelId,
            intent: record.intent,
            kind: outcome.kind,
            reason: outcome.reason || outcome.kind,
            durableRows: historyNumeric(outcome.durableRows),
            pages: historyNumeric(outcome.pages),
          });
        }
        return outcome;
      })
      .finally(() => {
        if (destroyed) return;
        record.settled = true;
        if (backgroundInterests.get(record.key) === record) backgroundInterests.delete(record.key);
      });
    return true;
  }

  function startAdmittedBackgroundInterests() {
    for (const record of backgroundInterests.values()) {
      if (record.awaitingAdmission) startBackgroundInterest(record);
    }
  }

  // Search and other non-reading consumers may need a cold channel's rows,
  // but they must not become a second history-demand owner. Feed owns this
  // small typed-interest registry and the cancellable physical operation;
  // callers only receive a lease. Keeping the operation here also means a
  // closed dialog can retire a pending background demand without leaving a
  // history status stuck in `pending`.
  function requestBackgroundInterest(channelId, request = {}) {
    const id = String(channelId || '');
    const intent = String(request.intent || '');
    if (destroyed || incompatible || !id || !BACKGROUND_INTEREST_TYPES.has(intent)) {
      return Object.freeze({ accepted: false, channelId: id, intent, release: () => false });
    }
    const key = `${intent}\u0000${id}`;
    let record = backgroundInterests.get(key);
    if (!record || record.cancelled) {
      const abortController = new AbortController();
      record = {
        key,
        channelId: id,
        intent,
        abortController,
        leases: 0,
        cancelled: false,
        started: false,
        awaitingAdmission: false,
        settled: false,
      };
      backgroundInterests.set(key, record);
      startBackgroundInterest(record);
    }
    record.leases += 1;
    let released = false;
    return Object.freeze({
      accepted: true,
      channelId: id,
      intent,
      release() {
        if (destroyed || released) return false;
        released = true;
        record.leases = Math.max(0, record.leases - 1);
        if (record.leases === 0 && !record.settled) {
          record.cancelled = true;
          record.abortController.abort('background interest released');
          if (backgroundInterests.get(key) === record) backgroundInterests.delete(key);
        }
        return true;
      },
    });
  }

  function enqueue(payloadOrChannel, seq, envelope, detail, producerToken = ownerToken) {
    if (destroyed || incompatible) return false;
    const payload = typeof payloadOrChannel === 'object'
      ? payloadOrChannel
      : detail || { channel_id: payloadOrChannel, seq, envelope, source: 'live' };
    const batch = payload?.ref ? networkBatches.get(payload.ref) : null;
    // A ref identifies one Feed-owned network batch. Once an attach fence
    // retires that batch, an unknown ref is a stale receipt, never a live-row
    // fallback that could reinstall old physical facts.
    if (payload?.ref && !batch) return false;
    if (batch) return adapters.appendRow(batch, payload);
    if (payload.generation && historyNumeric(payload.generation) !== generation) return false;
    const source = payload.source || 'live';
    if (source === 'cache') {
      const status = histories.get(String(payload.channel_id || ''));
      const admitted = grants.has(String(payload.channel_id || ''))
        && status?.attached === true
        && status.generation === generation;
      // The transport has consumed this cache frame, but a revoked or
      // replacement-world channel must not acquire a new Replica state from
      // it. Keep enqueue's handled-result contract; admission is the commit
      // boundary, not a second caller-visible owner.
      if (!admitted) return true;
    }
    applyRows([payload], { source, producerToken });
    return true;
  }

  function pageEnd(payload = {}) {
    if (destroyed) return false;
    const batch = networkBatches.get(payload.ref);
    if (!batch || batch.authority?.attachEpoch !== attachEpoch) return false;
    if (payload.error_code && projectAccessFailure(batch.channelId, {
      code: payload.error_code,
      message: payload.error_detail || payload.error_code,
    }, batch.authority)) {
      networkBatchAccessFailures.set(String(payload.ref), String(payload.error_code));
    }
    return adapters.finish(batch, payload);
  }

  // Live resumes strictly after the attach head: the node anchors the lane
  // there and never replays `since`. Rows that landed while this page was
  // disconnected (a phone in the background) sit between what memory holds
  // and that head, and nothing else will ever fetch them — older-history
  // paging walks down from the oldest row. This fills that stretch newest
  // first with a cursor of its own; the older-history frontier is untouched.
  const TAIL_REFILL_MAX_PAGES = 16;
  const tailRefills = new Map();
  async function refillTail(channelId) {
    const status = histories.get(channelId);
    const head = historyNumeric(grants.get(channelId)?.head_seq);
    // Live rows after the head may already be in; the stretch to fill ends at
    // the newest row this page held at or below the head.
    let floor = 0;
    for (const seq of replica.state(channelId)?.rows?.keys() || []) if (seq <= head && seq > floor) floor = seq;
    // Nothing held: the ordinary cold path already reads from the head.
    if (!status?.attached || status.generation !== generation || !floor || head <= floor) return false;
    if (tailRefills.get(channelId) === attachEpoch) return false;
    tailRefills.set(channelId, attachEpoch);
    const authority = Object.freeze({ principalEpoch, worldEpoch, generation, attachEpoch });
    let beforeSeq = head + 1;
    let lowest = 0;
    try {
      for (let page = 0; page < TAIL_REFILL_MAX_PAGES && beforeSeq > floor + 1; page += 1) {
        const batch = { ...batchFor(channelId, { beforeSeq }), source: 'network', ref: '' };
        const outcome = await executeBatch(batch, null);
        if (outcome.kind !== 'page' || !authorityTupleCurrent(channelId, authority)) return false;
        const rows = outcome.rows.filter((row) => historyNumeric(row?.seq) > floor);
        if (rows.length) {
          void cache.saveRows(rows).catch(cacheError);
          applyRows(rows, {
            source: 'history', persist: false, publishChange: false,
            coverageRows: new Set(rows.map((row) => historyNumeric(row.seq))),
          });
          lowest = Math.min(...rows.map((row) => historyNumeric(row.seq)), lowest || Infinity);
        }
        const scanLow = historyNumeric(outcome.result?.scan_low_seq ?? outcome.result?.scanLowSeq);
        const scanHigh = historyNumeric(outcome.result?.scan_high_seq ?? outcome.result?.scanHighSeq);
        if (scanLow && scanHigh >= scanLow) {
          status.controlCoverage = mergeReplicaCoverage(status.controlCoverage, { lowSeq: scanLow, highSeq: scanHigh });
        }
        refreshControlCurrent(channelId, status);
        publish({ index: true });
        const next = historyNumeric(outcome.result?.next_before_seq ?? outcome.result?.nextBeforeSeq);
        if (outcome.result?.exhausted || !next || next >= beforeSeq) return true;
        beforeSeq = next;
      }
      if (beforeSeq <= floor + 1 || !lowest) return true;
      // Too far behind to join up: keep the fresh window and let older-history
      // paging continue from its bottom, rather than leave a hole under it.
      const keep = [...(replica.state(channelId)?.rows?.keys() || [])].filter((seq) => seq >= lowest).length;
      replica.trim(channelId, keep);
      status.beforeSeq = replica.visibleOldest(channelId) || lowest;
      status.hasOlder = true;
      status.coverage = replica.record(channelId)?.materializedCoverage || [];
      publish({ index: true });
      return true;
    } catch (error) {
      if (tailRefills.get(channelId) === attachEpoch) tailRefills.delete(channelId);
      diagnostic('warn', 'history.tail_refill_failed', { channelId, error: String(error?.message || error) });
      return false;
    }
  }

  async function refreshChannel(channelId) {
    if (destroyed) return false;
    const requestGeneration = generation;
    const requestAuthority = Object.freeze({ principalEpoch, worldEpoch, generation: requestGeneration, attachEpoch });
    const wire = wireRef.current;
    const isAdmitted = () => {
      if (destroyed) return false;
      const status = histories.get(channelId);
      return Boolean(
        channelId
        && requestGeneration
        && grants.has(channelId)
        && status?.generation === requestGeneration
        && authorityTupleCurrent(channelId, requestAuthority),
      );
    };
    if (incompatible || !wire?.channelMeta || !isAdmitted()) return false;
    try {
      const result = await wire.channelMeta(channelId, requestGeneration);
      return isAdmitted() && Boolean(result);
    } catch (error) {
      if (!isAdmitted()) return false;
      if (projectAccessFailure(channelId, error, requestAuthority)) return false;
      throw error;
    }
  }

  async function prepareLocalReplica(nextPrincipal, { focus = activeChannelRef.current || '' } = {}) {
    if (destroyed) return { resume: {} };
    const epoch = ++principalEpoch;
    // A cache-owner selection is a principal authority boundary even when
    // the caller re-selects the same principal.  Retire physical work before
    // the new owner can install rows into Replica.
    cancelPhysicalOperations('principal authority changed', 'stale-generation');
    for (const batch of networkBatches.values()) void cancelOwnedBatch(batch, 'principal authority changed');
    networkBatches.clear();
    networkBatchAccessFailures.clear();
    const selectedPrincipal = String(nextPrincipal || '');
    if (principal && principal !== selectedPrincipal) {
      for (const channelId of histories.keys()) admission.reset(channelId);
      clearDeferredHistoryRequests();
      histories.clear(); grants.clear(); replica.reset(); cursors.clearReadAuthority();
     
      activityEntries.clear(); timerEvents.splice(0); timerOverflow = null;
      timerAcknowledgedRevision = timerRevision; activityConnected = false; activityRevision += 1;
    }
    principal = selectedPrincipal;
    localReplicaError = ''; localReplicaErrorCode = '';
    if (!principal) {
      cursors.clearReadAuthority();
      localReplicaReady = true;
      for (const [channelId, status] of histories) refreshControlCurrent(channelId, status);
      publish();
      return { resume: {} };
    }
    // The page is ready on memory and the wire. The local cache is read
    // behind it and only ever adds rows and coverage it already holds.
    if (world) cursors.selectReadAuthority({ principalId: principal, serverBoot: world });
    // Channels granted before the reader was known start at their head too.
    for (const [channelId, entry] of grants) cursors.baseline(channelId, entry?.head_seq);
    localReplicaReady = true;
    for (const [channelId, status] of histories) refreshControlCurrent(channelId, status);
    publish({ index: true });
    // Settles once the cache has been folded in, for a caller that wants to
    // know; the connection itself never waits on it.
    await loadLocalReplica(() => !destroyed && epoch === principalEpoch, focus);
    return { resume: replicaResumeSnapshot(cache.metaSnapshot()) };
  }

  // Select this principal/world's cache owner and fold what it holds into the
  // live state: durable coverage, local notification context, and the rows a
  // focused or notified channel can show before its network page lands.
  async function loadLocalReplica(isCurrent, focus = '') {
    let selected;
    try {
      selected = await cache.ensureOwner(principal, { world });
    } catch (error) {
      if (isCurrent() && error?.code !== 'cache_owner_changed') {
        diagnostic('warn', 'replica_cache.unavailable', { error });
      }
      return;
    }
    if (!isCurrent()) return;
    const localMeta = selected.meta;
    for (const [channelId, value] of localMeta) {
      const held = replica.record(channelId)?.durableCoverage || [];
      replica.installMeta(channelId, {
        ...value,
        coverage: (value?.coverage || []).reduce((all, range) => mergeReplicaCoverage(all, range), held),
      });
    }
    for (const [channelId, status] of histories) {
      if (!localMeta.has(channelId) || status.notificationContextReady === true) continue;
      if (status.attached !== true || status.generation !== generation) continue;
      // A grant installed before the cache answered learns its local
      // notification context now, exactly as if the cache had been first.
      status.notificationContextReady = true;
      status.notificationAuthorityRevision = ++notificationAuthorityRevision;
    }
    publish({ index: true });
    const hydrate = async (channelId, beforeSeq) => {
      try {
        const cached = await cache.readBefore(channelId, beforeSeq, HISTORY_PAGE_SIZE, HISTORY_BATCH_BYTES);
        if (!isCurrent()) return;
        const accepted = applyRows(cached.rows, { source: 'cache', persist: false, publishChange: false });
        if (accepted.length) publish({ index: true });
      } catch (error) {
        if (isCurrent()) cacheError(error);
      }
    };
    const reads = [];
    for (const [channelId, value] of localMeta) {
      const head = Math.max(historyNumeric(histories.get(channelId)?.headSeq), historyNumeric(value?.headSeq || value?.newestSeq));
      if (!head) continue;
      const focused = channelId === focus && replica.visibleNewest(channelId) === 0;
      const notified = channelId !== focus && histories.has(channelId)
        && cursors.readMine(channelId) < head;
      if (focused || notified) reads.push(hydrate(channelId, head + 1));
    }
    await Promise.all(reads);
  }

  // Cache recovery remains a Feed command: the caller can request another
  // selection of the already committed principal, but it cannot supply a
  // principal or create a second cache owner.  prepareLocalReplica advances
  // principalEpoch and fences every late ensure/read result before it can
  // publish an error or readiness fact.
  function retryLocalReplica({ focus = activeChannelRef.current || '' } = {}) {
    if (destroyed || !principal) return Promise.resolve({ resume: {}, skipped: true });
    return prepareLocalReplica(principal, { focus });
  }

  async function setHistoryGrants(entries = [], detail = {}, requestEpoch = lifecycleEpoch) {
    const nextGeneration = historyNumeric(detail.generation);
    if (destroyed || requestEpoch !== lifecycleEpoch
      || !nextGeneration || nextGeneration < generation || incompatible) {
      return { stale: true, meta: cache.metaSnapshot() };
    }
    const epoch = ++attachEpoch;
    const nextWorld = String(detail.boot || world);
    const worldAuthorityChanged = nextWorld !== world;
    const worldChanged = Boolean(world) && worldAuthorityChanged;
    if (worldAuthorityChanged) worldEpoch += 1;
    generation = nextGeneration;
    // Attach and world fences advance before any replacement cache/meta work.
    cancelPhysicalOperations('history attach recalibrated', 'stale-generation');
    for (const batch of networkBatches.values()) void cancelOwnedBatch(batch, 'history attach recalibrated');
    networkBatches.clear();
    networkBatchAccessFailures.clear();
    world = nextWorld;
    if (worldChanged) {
      lifecycleEpoch += 1;
      for (const channelId of histories.keys()) admission.reset(channelId);
      clearDeferredHistoryRequests();
      histories.clear(); grants.clear(); replica.reset(); cursors.clearReadAuthority();
     
      activityEntries.clear();
      timerEvents.splice(0);
      timerAcknowledgedRevision = timerRevision;
      timerOverflow = null;
      activityRevision += 1;
    }
    const replayAfterAttach = [];
    const nextChannelIDs = new Set(entries.map((entry) => String(entry?.channel_id || '')).filter(Boolean));
    for (const [channelId, status] of histories) {
      if (nextChannelIDs.has(channelId)) {
        // A re-grant is a new control-context admission even when the wire
        // generation number is reused: the old tail *claim* does not survive
        // until the new tail proof lands. The coverage ranges themselves are
        // a fact about rows this client already holds, so they are kept and
        // corrected by what the grant and the next pages deliver; the claim
        // is recomputed from them, never from a cleared slate.
        status.controlCurrent = false;
        status.controlTailCoverage = false;
        status.controlParentClosure = false;
        if (detail?.forceReset === true) status.controlCoverage = [];
        continue;
      }
      status.attached = false;
      status.messageCurrent = false;
      status.controlCurrent = false;
      status.controlTailCoverage = false;
      status.controlParentClosure = false;
      if (detail?.forceReset === true) status.controlCoverage = [];
      status.notificationAuthorityRevision = ++notificationAuthorityRevision;
    }
    // The grant is installed from the receipt and from what memory already
    // holds. The cache owner for this world is selected behind it; whatever
    // it adds is folded in by loadLocalReplica, never waited for here.
    const selectedMeta = cache.metaSnapshotFor?.(principal, world) || new Map();
    if (principal && world) cursors.selectReadAuthority({ principalId: principal, serverBoot: world });
    grants.clear();
    const focus = String(detail.focus || activeChannelRef.current || '');
    for (const entry of entries) {
      const channelId = String(entry?.channel_id || '');
      if (!channelId) continue;
      grants.set(channelId, entry);
      const status = historyState(channelId);
      const grantedHeadSeq = historyNumeric(entry.head_seq);
      const headSeq = Math.max(status.headSeq, grantedHeadSeq, replica.visibleNewest(channelId));
      const hasLocalMeta = selectedMeta.has(channelId);
      const hasLocalRows = replica.visibleNewest(channelId) > 0;
      const authorityChanged = status.generation !== generation
        || status.attached !== true
        || status.messageCurrent !== true
        || status.controlCurrent !== true;
      Object.assign(status, {
        generation, attached: true, messageCurrent: true, headSeq,
        notificationContextReady: grantedHeadSeq === 0
          || channelId === focus
          || hasLocalMeta
          || hasLocalRows,
        controlCurrent: false,
        // Durable cache rows are readable but do not prove that current
        // queued controls have no later terminal. Only this attach's network
        // scan, live rows, or live checkpoint may establish control coverage.
        controlCoverage: [],
        controlTailCoverage: false,
        controlParentClosure: false,
        beforeSeq: replica.visibleOldest(channelId) || headSeq + 1,
        hasOlder: headSeq > 0,
        notificationAuthorityRevision: authorityChanged
          ? ++notificationAuthorityRevision
          : status.notificationAuthorityRevision,
      });
      replica.installMeta(channelId, { headSeq: entry.head_seq, coverage: selectedMeta.get(channelId)?.coverage });
      // First sight of a channel on this device starts at its head.
      cursors.baseline(channelId, grantedHeadSeq);
      cursors.clampToHead(channelId, grantedHeadSeq);
    }
    // Deferred demands are this attach's to replay now: nothing above waits.
    for (const channelId of nextChannelIDs) {
      const deferred = takeDeferredHistoryRequest(channelId);
      if (deferred) replayAfterAttach.push([channelId, deferred]);
    }
    let activityGenerationChanged = false;
    for (const entry of activityEntries.values()) {
      if (entry.state !== 'active' || entry.generation === generation) continue;
      // A same-boot reconnect hides the old live entry while disconnected,
      // but history is still allowed to settle that exact retained work. The
      // generation on the entry remains the admission fence: a new live
      // progress row replaces it, while a history terminal may only close
      // the matching channel/request key. A channel grant is not required to
      // retain the close proof; the connection owner may receive a terminal
      // while its replacement grant is still being assembled.
      activityGenerationChanged = true;
    }
    const connectionChanged = !activityConnected || activityGenerationChanged;
    activityConnected = true;
    if (connectionChanged) activityRevision += 1;
    localReplicaReady = true;
    for (const [channelId, status] of histories) refreshControlCurrent(channelId, status);
    publish({ index: true });
    // A channel-entry lease may have been acquired while the wire was open
    // but before its history grant arrived.
    startAdmittedBackgroundInterests();
    if (principal && world) {
      const attachPrincipalEpoch = principalEpoch;
      void loadLocalReplica(() => !destroyed && epoch === attachEpoch
        && principalEpoch === attachPrincipalEpoch && generation === nextGeneration, focus);
    }
    for (const [channelId, deferred] of replayAfterAttach) {
      const request = deferred?.request || deferred;
      const semanticDemand = deferred?.semanticDemand || null;
      void loadHistory(channelId, semanticDemand ? { ...request, semanticDemand } : request)
        .catch((error) => callback('onError', error));
    }
    // Every channel this page already holds rows for gets its disconnected
    // stretch back; the one being read first.
    const refillOrder = [...nextChannelIDs].sort((left, right) => Number(right === focus) - Number(left === focus));
    void (async () => {
      for (const channelId of refillOrder) {
        if (epoch !== attachEpoch) return;
        await refillTail(channelId);
      }
    })();
    return { changed: true, meta: selectedMeta };
  }

  function liveCheckpoint(payload = {}, producerToken = ownerToken) {
    if (destroyed || producerToken !== ownerToken || historyNumeric(payload.generation) !== generation) return false;
    const low = historyNumeric(payload.scan_low_seq);
    const high = historyNumeric(payload.scanned_seq);
    if (!payload.channel_id || !low || high < low) return false;
    const status = histories.get(payload.channel_id);
    if (status?.attached && status.generation === generation) {
      status.controlCoverage = mergeReplicaCoverage(status.controlCoverage, {
        lowSeq: low, highSeq: high,
      });
      refreshControlCurrent(payload.channel_id, status);
      publish();
    }
    void cache.saveCoverage(payload.channel_id, low, high).catch(cacheError);
    return true;
  }

  function historyFor(channelId) {
    const status = historyState(channelId);
    const presentationRevision = replica.state(channelId)?._timelineRevision || 0;
    const syncRevision = status.notificationAuthorityRevision;
    return Object.freeze({
      ...status,
      controlCoverage: Object.freeze((status.controlCoverage || []).map((range) => ({ ...range }))),
      authority: Object.freeze({
        principalId: principal,
        serverBoot: world,
        channelId,
      }),
      readMine: cursors.readMine(channelId),
      readAll: cursors.readAll(channelId),
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

  function cancelBackgroundInterests(reason = 'background interests retired') {
    for (const record of backgroundInterests.values()) {
      record.cancelled = true;
      record.abortController.abort(reason);
    }
    backgroundInterests.clear();
  }

  function clear() {
    if (destroyed) return false;
    lifecycleEpoch += 1;
    principalEpoch += 1;
    attachEpoch += 1;
    cancelBackgroundInterests('replica cleared');
    cancelPhysicalOperations('replica cleared', 'stale-generation');
    executor.clear('replica cleared');
    for (const batch of networkBatches.values()) void cancelOwnedBatch(batch, 'replica cleared');
    networkBatches.clear();
    networkBatchAccessFailures.clear();
    for (const channelId of histories.keys()) admission.reset(channelId);
    clearDeferredHistoryRequests();
    histories.clear(); grants.clear();
    activityEntries.clear();
   
    timerEvents.splice(0);
    timerAcknowledgedRevision = timerRevision;
    timerOverflow = null;
    activityConnected = false;
    activityRevision += 1;
    replica.reset(); publish({ index: true });
    return true;
  }

  function resetNotificationAuthority() {
    if (destroyed) return false;
    const changed = cursors.forgetAll();
    if (changed) publish();
    return changed;
  }
  async function resetPersistent() {
    if (destroyed) return false;
    await cache.clear();
    if (destroyed) return false;
    if (!clear()) return false;
    resetNotificationAuthority();
    return true;
  }
  function disconnectHistory(requestGeneration = generation) {
    if (destroyed) return false;
    if (requestGeneration && requestGeneration !== generation) return false;
    lifecycleEpoch += 1;
    cancelBackgroundInterests('history disconnected');
    clearDeferredHistoryRequests();
    for (const status of histories.values()) {
      const wasActive = status.attached || status.messageCurrent || status.controlCurrent;
      status.attached = false;
      status.messageCurrent = false;
      status.controlCurrent = false;
      // Rows and their coverage survive a disconnect; the reconnect grant
      // merges the new head and the missing stretch shows as a gap until the
      // tail is refilled. Only the claim is withdrawn here.
      status.controlTailCoverage = false;
      status.controlParentClosure = false;
      status.loading = false;
      status.foregroundLoading = false;
      status.backgroundLoading = false;
      if (status.historyDemand.phase === 'pending') {
        status.historyDemand = Object.freeze({
          revision: status.historyDemand.revision,
          phase: 'idle',
          error: '',
        });
      }
      if (wasActive) {
        status.notificationAuthorityRevision = ++notificationAuthorityRevision;
      }
    }
   
    attachEpoch += 1;
    cancelPhysicalOperations('history disconnected', 'stale-generation');
    if (activityConnected) { activityConnected = false; activityRevision += 1; }
    generation = 0;
    for (const batch of networkBatches.values()) void cancelOwnedBatch(batch, 'history disconnected');
    networkBatches.clear();
    networkBatchAccessFailures.clear();
    publish(); return true;
  }
  function stopIncompatible(requestGeneration = generation) {
    if (destroyed) return false;
    if (requestGeneration && generation && requestGeneration !== generation) return false;
    incompatible = true; disconnectHistory(generation); return true;
  }
  function acknowledgeAgentActivity(channelId, agentId) {
    if (destroyed) return false;
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
    if (destroyed) return false;
    const next = Math.min(timerRevision, Math.max(timerAcknowledgedRevision, historyNumeric(throughRevision)));
    if (next === timerAcknowledgedRevision) return false;
    timerAcknowledgedRevision = next;
    while (timerEvents[0]?.revision <= next) timerEvents.shift();
    if (timerOverflow && timerOverflow.throughRevision <= next) timerOverflow = null;
    publish();
    return true;
  }
  function attachAgentActivity(detail = {}) {
    if (destroyed) return false;
    const nextGeneration = historyNumeric(detail.generation);
    if (!nextGeneration || nextGeneration !== generation || incompatible) return false;
    if (activityConnected) return true;
    activityConnected = true;
    activityRevision += 1;
    publish();
    return true;
  }
  function disconnectAgentActivity() {
    if (destroyed) return false;
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
  const notificationAuthorityPort = Object.freeze({ reset: resetNotificationAuthority });
  const resumeLocalReplica = () => destroyed || !localReplicaReady
    ? {}
    : replicaResumeSnapshot(cache.metaSnapshot());

  function buildSnapshot() {
    const agentActivity = agentActivitySnapshot();
    const timerFirings = timerFiringSnapshot();
    const snapshotEpoch = lifecycleEpoch;
    return Object.freeze({
      version, indexVersion, localReplicaReady, localReplicaError, localReplicaErrorCode,
      agentActivity, timerFirings, agentActivityPort, notificationAuthorityPort,
      bump: () => destroyed ? false : publish({ index: true }),
      enqueue, pageEnd, liveCheckpoint,
      setHistoryGrants: (entries, detail) => setHistoryGrants(entries, detail, snapshotEpoch),
      prepareLocalReplica, retryLocalReplica, resumeLocalReplica,
      disconnectHistory, stopIncompatible, cancel: disconnectHistory, clear, resetPersistent,
      stateFor: (channelId) => replica.state(channelId),
      stateEntries: () => Object.freeze([...replica.states().entries()]),
      revisionFor: (channelId) => replica.revision(channelId),
      historyFor, unreadFor, generationFor: () => generation,
      focusHistory: (channelId) => {
        if (destroyed) return false;
        activeChannelRef.current = channelId;
        publish();
        return true;
      },
      refreshChannel,
      reconcileIdentity: (channelId) => {
        if (destroyed || !replica.state(channelId)) return false;
        publish();
        return true;
      },
      loadHistory, requestBackgroundInterest, markSeen, followLive, unreadRootsFor,
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
    lifecycleEpoch += 1;
    principalEpoch += 1;
    attachEpoch += 1;
    generation = 0;
    cancelBackgroundInterests('feed runtime destroyed');
    cancelPhysicalOperations('feed runtime destroyed', 'runtime-destroyed');
    releaseRailDiagnostic?.();
    releaseRailDiagnostic = null;
    for (const batch of networkBatches.values()) void cancelOwnedBatch(batch, 'feed runtime destroyed');
    networkBatches.clear();
    networkBatchAccessFailures.clear();
    executor.clear('feed runtime destroyed');
    clearDeferredHistoryRequests();
    for (const channelId of histories.keys()) admission.reset(channelId);
    histories.clear(); grants.clear();
    activityEntries.clear(); timerEvents.splice(0);
    replica.destroy(); cursors.destroy(); void cache.destroy();
    subscribers.clear(); ownerCommands.clear(); ownerSnapshots.clear();
  }

  return Object.freeze({
    subscribe(subscriber) { if (destroyed) return () => {}; subscribers.add(subscriber); return () => subscribers.delete(subscriber); },
    getSnapshot: () => snapshot,
    getOwnerSnapshot(producerToken, base = snapshot) {
      if (destroyed) {
        return Object.freeze({
          ...base,
          enqueue: () => false,
          liveCheckpoint: () => false,
        });
      }
      let commands = ownerCommands.get(producerToken);
      if (!commands) {
        commands = Object.freeze({
          enqueue: (payloadOrChannel, seq, envelope, detail) => enqueue(payloadOrChannel, seq, envelope, detail, producerToken),
          liveCheckpoint: (payload) => liveCheckpoint(payload, producerToken),
        });
        ownerCommands.set(producerToken, commands);
      }
      const cached = ownerSnapshots.get(producerToken);
      if (cached?.base === base) return cached.owned;
      const owned = Object.freeze({ ...base, ...commands });
      ownerSnapshots.set(producerToken, { base, owned });
      return owned;
    },
    bind(nextBindings) {
      if (destroyed) return () => {};
      bindings = nextBindings;
      const nextOwner = nextBindings.ownerToken ?? null;
      ownerToken = nextOwner;
      return () => { if (ownerToken === nextOwner) ownerToken = null; };
    },
    mount() {
      if (destroyed) throw new Error('ChannelFeedRuntime has been destroyed');
      if (mounted) return () => {};
      mounted = true;
      releaseRailDiagnostic?.();
      releaseRailDiagnostic = registerRailDiagnosticProvider(railDiagnosticSnapshot);
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
