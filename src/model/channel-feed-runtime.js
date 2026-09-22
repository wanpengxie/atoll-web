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
const CURSOR_STORAGE_PREFIX = 'atoll.feed-cursors.v1.';
const NOTIFICATION_LEASE_REVOKE = 'notification-lease-revoke';
const NOTIFICATION_LEASE_REVOKE_REASONS = new Set([
  'physical-leave',
  'surface-hidden',
  'activation-cleanup',
]);

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

function notificationInputEpoch(value) {
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
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

function notificationOwnerKey(owner) {
  return `${owner?.viewKey || ''}\u0000${owner?.activationID || ''}\u0000${historyNumeric(owner?.generation)}`;
}

// The rail has one canonical root ledger.  Keep the two person-visible
// projections explicit so a filtered/partial observation cannot silently turn
// `other` into a total or clear a root it never presented.
function notificationProjection({ related = 0, other = 0, pending = false, unknown = false } = {}) {
  return Object.freeze({
    related: historyNumeric(related),
    other: historyNumeric(other),
    pending: pending === true,
    unknown: unknown === true,
  });
}

function notificationScope(value) {
  return value === 'mine' ? 'mine' : 'all';
}

function notificationActorFiltered(event) {
  return event?.actorFiltered === true || historyNumeric(event?.actorFilterCount) > 0;
}

function sameNotificationRootMask(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const rightIDs = new Set(right.map((id) => String(id || '')));
  return left.every((id) => rightIDs.has(String(id || '')));
}

function followingSuppressesNotification(observation, seq, related, rootID = '') {
  if (!observation || observation.active === false
    || historyNumeric(seq) > historyNumeric(observation.headSeq)) return false;
  // An actor-filtered view is a semantic subset only. It cannot suppress
  // either channel-level projection.
  if (observation.actorFiltered === true) return false;
  if (observation.exactRootMask === true) {
    const maskedRootIDs = new Set(observation.maskedRootIDs || []);
    if (!rootID || !maskedRootIDs.has(String(rootID))) return false;
    return observation.scope !== 'mine' || related === true;
  }
  // A mine tail is an ephemeral related-only mask. Other roots stay visible
  // until a separate unfiltered all-channel receipt advances high-water.
  if (observation.scope === 'mine') return related === true;
  return true;
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

function createCursorOwner(storage = globalThis.localStorage) {
  const reads = new Map();
  const notifications = new Map();
  // Sparse visible-root receipts live in the same durable cursor record as
  // the channel high-water. This is not a second acknowledgement owner: the
  // identity map is only the bounded exception for roots seen beyond a gap.
  const notificationIdentities = new Map();
  let authority = '';
  const identityCount = () => [...notificationIdentities.values()]
    .reduce((count, entries) => count + entries.size, 0);
  const identitiesFor = (channelId, create = false) => {
    let entries = notificationIdentities.get(channelId);
    if (!entries && create) {
      entries = new Map();
      notificationIdentities.set(channelId, entries);
    }
    return entries;
  };
  const persistedKeys = () => {
    if (!storage || typeof storage.key !== 'function') return [];
    const keys = [];
    for (let index = 0; index < Number(storage.length || 0); index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(CURSOR_STORAGE_PREFIX)) keys.push(key);
    }
    return keys;
  };
  const resetAuthority = () => {
    let changed = Boolean(authority || reads.size || notifications.size || identityCount());
    for (const key of persistedKeys()) {
      try { storage.removeItem(key); changed = true; } catch { /* best effort */ }
    }
    authority = '';
    reads.clear();
    notifications.clear();
    notificationIdentities.clear();
    return changed;
  };
  const persist = () => {
    if (!authority || !storage) return;
    try {
      const persistedIdentities = Object.fromEntries([...notificationIdentities].map(([channelId, entries]) => [
        channelId,
        Object.fromEntries(entries),
      ]));
      storage.setItem(`${CURSOR_STORAGE_PREFIX}${authority}`, JSON.stringify({
        reads: Object.fromEntries(reads),
        notifications: Object.fromEntries(notifications),
        notificationIdentities: persistedIdentities,
      }));
    } catch { /* cursor durability is best effort */ }
  };
  const load = () => {
    reads.clear(); notifications.clear(); notificationIdentities.clear();
    if (!authority || !storage) return false;
    try {
      const raw = storage.getItem(`${CURSOR_STORAGE_PREFIX}${authority}`);
      if (!raw) return false;
      const value = JSON.parse(raw);
      for (const [id, seq] of Object.entries(value.reads || {})) reads.set(id, historyNumeric(seq));
      for (const [id, seq] of Object.entries(value.notifications || {})) notifications.set(id, historyNumeric(seq));
      for (const [channelId, values] of Object.entries(value.notificationIdentities || {})) {
        if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
        const entries = identitiesFor(channelId, true);
        for (const [rootID, seq] of Object.entries(values)) {
          const valueSeq = historyNumeric(seq);
          if (rootID && valueSeq > 0) entries.set(rootID, valueSeq);
        }
        if (!entries.size) notificationIdentities.delete(channelId);
      }
      return true;
    } catch { return false; }
  };
  return Object.freeze({
    selectReadAuthority({ principalId = '', serverBoot = '' } = {}) {
      const next = principalId && serverBoot ? `${principalId}\u0000${serverBoot}` : '';
      const changed = next !== authority;
      if (!changed) return { changed: false, reused: Boolean(authority), fresh: false };
      // A live authority replacement invalidates every prior principal/world
      // prefix. The first selection in a fresh runtime is allowed to restore
      // the exact tuple; its caller handles an actual world transition via
      // resetAuthority before selecting the replacement.
      if (authority) resetAuthority();
      authority = next;
      const restored = load();
      return { changed: true, reused: Boolean(authority) && restored, fresh: Boolean(authority) && !restored };
    },
    clearReadAuthority: resetAuthority,
    resetAuthority,
    isReadAuthorityReady: () => Boolean(authority),
    reconcileReads(snapshot = {}) {
      for (const [channelId, seq] of Object.entries(snapshot)) {
        const value = historyNumeric(seq);
        reads.set(channelId, Math.max(reads.get(channelId) || 0, value));
      }
      persist();
    },
    resetReads() { reads.clear(); notifications.clear(); notificationIdentities.clear(); persist(); },
    read: (channelId) => reads.get(channelId) || 0,
    markRead(channelId, seq) { const next = Math.max(reads.get(channelId) || 0, historyNumeric(seq)); reads.set(channelId, next); persist(); return next; },
    baselineRead(channelId, seq) { if (!reads.has(channelId)) reads.set(channelId, historyNumeric(seq)); persist(); },
    notificationHighWater: (channelId) => notifications.get(channelId) || 0,
    notificationIdentities: (channelId) => new Map(identitiesFor(channelId) || []),
    acknowledgeNotificationIdentities(channelId, identities = new Map()) {
      const entries = identitiesFor(channelId, true);
      const current = notifications.get(channelId) || 0;
      let changed = false;
      const values = identities instanceof Map ? identities.entries() : Object.entries(identities || {});
      for (const [rootID, seq] of values) {
        const key = String(rootID || '');
        const valueSeq = historyNumeric(seq);
        if (!key || !valueSeq || valueSeq <= current || (entries.get(key) || 0) >= valueSeq) continue;
        entries.set(key, valueSeq);
        changed = true;
      }
      if (!entries.size) notificationIdentities.delete(channelId);
      if (changed) persist();
      return changed;
    },
    acknowledgeNotifications(channelId, seq) {
      const next = Math.max(notifications.get(channelId) || 0, historyNumeric(seq));
      notifications.set(channelId, next);
      const entries = identitiesFor(channelId);
      if (entries) {
        for (const [rootID, identitySeq] of entries) {
          if (identitySeq <= next) entries.delete(rootID);
        }
        if (!entries.size) notificationIdentities.delete(channelId);
      }
      persist(); return next;
    },
    baselineNotifications(channelId, seq) { if (!notifications.has(channelId)) notifications.set(channelId, historyNumeric(seq)); persist(); },
    clampNotificationsToHead(channelId, seq) {
      const head = historyNumeric(seq);
      const notification = notifications.get(channelId);
      const nextNotification = notification === undefined
        ? undefined
        : Math.min(notification, head);
      const changed = nextNotification !== notification;
      if (nextNotification !== undefined) notifications.set(channelId, nextNotification);
      const entries = identitiesFor(channelId);
      let identitiesChanged = false;
      if (entries) {
        for (const [rootID, identitySeq] of entries) {
          if (identitySeq > head) {
            entries.delete(rootID);
            identitiesChanged = true;
          }
        }
        if (!entries.size) {
          notificationIdentities.delete(channelId);
          identitiesChanged = true;
        }
      }
      if (changed || identitiesChanged) persist();
      return changed || identitiesChanged;
    },
    destroy() { authority = ''; reads.clear(); notifications.clear(); notificationIdentities.clear(); },
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
function closedNotificationBoundary(state, boundary, previous = 0) {
  if (!state || !(state.rows instanceof Map)) return previous;
  const target = historyNumeric(boundary);
  let closed = historyNumeric(previous);
  for (let seq = closed + 1; seq <= target; seq += 1) {
    if (!state.rows.has(seq)) break;
    const envelope = state.rows.get(seq);
    if (envelope?.kind === 'response'
      && envelope.parent_id
      && FINAL.has(argsOf(envelope)?.status)
      && !state._envelopesById?.has?.(String(envelope.parent_id))) break;
    closed = seq;
  }
  return closed;
}

function notificationReceiptVisibleIDs(event) {
  const directRoots = Array.isArray(event?.visibleRootIDs)
    ? event.visibleRootIDs
    : Array.isArray(event?.captured?.visibleRootIDs)
      ? event.captured.visibleRootIDs
      : null;
  if (directRoots) {
    return Object.freeze([...new Set(directRoots.map((id) => String(id || '')).filter(Boolean))]);
  }
  const rows = Array.isArray(event?.visibleRowIDs)
    ? event.visibleRowIDs
    : Array.isArray(event?.captured?.visibleRowIDs)
      ? event.captured.visibleRowIDs
      : null;
  return rows
    ? Object.freeze([...new Set(rows.map((id) => String(id || '')).filter(Boolean))])
    : null;
}

function notificationReceiptRootIDs(state, event) {
  const visibleIDs = notificationReceiptVisibleIDs(event);
  if (!visibleIDs) return null;
  if (Array.isArray(event?.visibleRootIDs) || Array.isArray(event?.captured?.visibleRootIDs)) {
    return visibleIDs;
  }
  const rowsByID = new Map();
  for (const envelope of state?.rows?.values?.() || []) {
    if (envelope?.id) rowsByID.set(String(envelope.id), envelope);
  }
  const rootIDs = new Set();
  for (const messageID of visibleIDs) {
    const envelope = state?._envelopesById?.get?.(messageID) || rowsByID.get(messageID);
    const rootID = envelope ? notificationRootID(state, envelope) : messageID;
    if (rootID) rootIDs.add(String(rootID));
  }
  return Object.freeze([...rootIDs]);
}

// Persist only the visible roots that sit beyond the durable contiguous
// frontier. On reload these identities continue to suppress their own rows,
// while an unvisited sibling remains an actionable unread root.
function notificationIdentityEntries(state, boundary, visibleRootIDs) {
  if (!state || !(state.rows instanceof Map) || !Array.isArray(visibleRootIDs)) return null;
  const roots = new Set(visibleRootIDs.map((id) => String(id || '')).filter(Boolean));
  if (!roots.size) return null;
  const target = historyNumeric(boundary);
  const entries = new Map();
  for (const [seq, envelope] of state.rows) {
    if (historyNumeric(seq) > target) continue;
    const rootID = notificationRootID(state, envelope);
    if (!rootID || !roots.has(String(rootID))) continue;
    const key = String(rootID);
    entries.set(key, Math.max(entries.get(key) || 0, historyNumeric(seq)));
  }
  return entries;
}

// A durable all-channel receipt may only advance through the canonical
// contiguous frontier.  The frozen DOM root mask is evidence of what was
// presented, not permission to jump over an unvisited sibling or a physical
// response-first gap.
function notificationBoundaryForVisibleRoots(state, boundary, previous, visibleRootIDs, selfID) {
  if (!state || !(state.rows instanceof Map)) return previous;
  const target = historyNumeric(boundary);
  const visited = new Set(visibleRootIDs || []);
  let closed = historyNumeric(previous);
  for (let seq = closed + 1; seq <= target; seq += 1) {
    if (!state.rows.has(seq)) break;
    const envelope = state.rows.get(seq);
    if (envelope?.kind === 'response'
      && envelope.parent_id
      && FINAL.has(argsOf(envelope)?.status)
      && !state._envelopesById?.has?.(String(envelope.parent_id))) break;
    const disposition = notificationDisposition(state, envelope, selfID);
    if (isRailNotifiableDisposition(disposition)) {
      const rootID = notificationRootID(state, envelope);
      if (!rootID || !visited.has(String(rootID))) break;
    }
    closed = seq;
  }
  return closed;
}

// A related-only tail can use the same durable cursor when the frozen
// boundary contains no outside-scope notification. This is deliberately
// stricter than a normal mine mask: seeing a related prefix is not enough if
// the receipt also spans an unvisited `other` root, because a scalar
// high-water would hide that sibling. In that case the existing ephemeral
// related lease remains the only valid projection.
function notificationBoundaryForRelatedOnly(state, boundary, previous, selfID) {
  if (!state || !(state.rows instanceof Map) || !selfID) return previous;
  const target = historyNumeric(boundary);
  let closed = historyNumeric(previous);
  for (let seq = closed + 1; seq <= target; seq += 1) {
    if (!state.rows.has(seq)) break;
    const envelope = state.rows.get(seq);
    if (envelope?.kind === 'response'
      && envelope.parent_id
      && FINAL.has(argsOf(envelope)?.status)
      && !state._envelopesById?.has?.(String(envelope.parent_id))) break;
    const disposition = notificationDisposition(state, envelope, selfID);
    if (disposition === 'notification_context_unknown') break;
    if (isRailNotifiableDisposition(disposition)
      && !notificationRelatesTo(state, envelope, selfID)) return previous;
    closed = seq;
  }
  return closed;
}

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

function unresolvedTerminalBoundary(state, after = 0) {
  if (!state || !(state.rows instanceof Map)) return 0;
  const start = historyNumeric(after);
  const rows = [...state.rows.entries()].sort(([left], [right]) => left - right);
  for (const [seq, envelope] of rows) {
    if (seq <= start) continue;
    if (envelope?.kind === 'response'
      && envelope.parent_id
      && FINAL.has(argsOf(envelope)?.status)
      && !state._envelopesById?.has?.(String(envelope.parent_id))) return seq;
  }
  return 0;
}

// A following observation is an ephemeral lease owned by the exact attached
// notification authority.  The channel/generation tuple alone is not enough:
// a same-generation reconnect or regrant advances notificationAuthorityRevision
// while the old observation object may still be retained until its next
// positive receipt.  Consumers must therefore ignore that old lease rather
// than hide rows or extend it across the replacement authority.
function followingObservationAuthorityCurrent(observation, status, {
  principal = '', world = '', generation = 0,
} = {}) {
  return Boolean(observation
    && status?.attached === true
    && status?.messageCurrent === true
    && status?.generation > 0
    && status.generation === generation
    && observation.authority?.principalId === principal
    && observation.authority?.serverBoot === world
    && observation.authorityRevision === status.notificationAuthorityRevision
    && observation.owner?.generation === status.generation);
}

function followingObservationCurrent(observation, status, authority) {
  return followingObservationAuthorityCurrent(observation, status, authority)
    && observation.active !== false;
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
  const followingObservations = new Map();
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

  const cacheError = (error) => {
    if (!destroyed && error?.code !== 'cache_owner_changed') callback('onError', error);
  };

  function cacheHydrationCurrent(channelId, authority) {
    return authorityTupleCurrent(channelId, authority);
  }

  async function hydrateCacheRows(channelId, beforeSeq, authority) {
    try {
      const cached = await cache.readBefore(channelId, beforeSeq, HISTORY_PAGE_SIZE, HISTORY_BATCH_BYTES);
      if (!cacheHydrationCurrent(channelId, authority)) return false;
      const accepted = applyRows(cached.rows, {
        source: 'cache', persist: false, publishChange: false,
      });
      if (accepted.length) publish({ index: true });
      return true;
    } catch (error) {
      if (cacheHydrationCurrent(channelId, authority)) cacheError(error);
      return false;
    }
  }

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
        followingObservations.delete(channelId);
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
        && status.notificationContextReady !== true
        && historyNumeric(row.seq) > historyNumeric(status.headSeq)
        && cursors.isReadAuthorityReady()) {
        cursors.baselineNotifications(row.channel_id, status.headSeq);
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
        const following = followingObservations.get(row.channel_id);
        if (followingObservationCurrent(following, status, {
          principal, world, generation,
        })) {
          // A following lease may absorb safe request/event arrivals until
          // the next observation, but it must remember the first unresolved
          // terminal it crossed. Once that terminal's parent arrives, a
          // mutable head must not retroactively expand the old lease and hide
          // the newly closed notification; only a fresh frozen confirmation
          // may clear this obligation.
          const blockedBoundary = following.unresolvedBoundary
            || unresolvedTerminalBoundary(replica.state(row.channel_id), following.headSeq);
          const closedHead = closedNotificationBoundary(
            replica.state(row.channel_id), status.headSeq, following.headSeq,
          );
          followingObservations.set(row.channel_id, Object.freeze({
            ...following,
            headSeq: Math.max(
              following.headSeq,
              blockedBoundary ? Math.min(closedHead, blockedBoundary - 1) : closedHead,
            ),
            unresolvedBoundary: blockedBoundary || 0,
          }));
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

  function unreadFor(channelId, selfID = '') {
    const boundary = cursors.notificationHighWater(channelId);
    const state = replica.state(channelId);
    const context = notificationContextState(channelId, state, boundary, selfID);
    if (context.pending && (!cursors.isReadAuthorityReady() || !selfID)) {
      return notificationProjection({ pending: true, unknown: true });
    }
    const following = followingObservations.get(channelId);
    const acknowledgedIdentities = cursors.notificationIdentities(channelId);
    const roots = new Map();
    let unknown = context.unknown;
    for (const [seq, envelope] of state?.rows || []) {
      if (seq <= boundary || samePerson(envelope?.sender?.id, selfID)) continue;
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
      const identitySeq = acknowledgedIdentities.get(String(rootID)) || 0;
      if (identitySeq > 0 && historyNumeric(seq) <= identitySeq) continue;
      const related = notificationRelatesTo(state, envelope, selfID);
      const root = roots.get(rootID) || { related: false, rows: [] };
      root.related = root.related || related;
      root.rows.push({ seq, related });
      roots.set(rootID, root);
    }
    const relatedRoots = new Set();
    const otherRoots = new Set();
    const observation = followingObservationCurrent(following, histories.get(channelId), {
      principal, world, generation,
    }) ? following : null;
    for (const [rootID, root] of roots) {
      const visible = root.rows.some(({ seq, related }) => (
        !followingSuppressesNotification(observation, seq, related, rootID)
      ));
      if (!visible) continue;
      if (root.related) relatedRoots.add(rootID);
      else otherRoots.add(rootID);
    }
    // A root belongs to exactly one projection. If a turn contains both an
    // unrelated request and a related readable terminal, related wins.
    for (const rootID of relatedRoots) otherRoots.delete(rootID);
    return notificationProjection({
      related: relatedRoots.size,
      other: otherRoots.size,
      pending: context.pending,
      unknown,
    });
  }

  // Diagnostics is an observation port for the existing rail, not another
  // notification owner. Keep the provider beside Feed's canonical cursor and
  // Replica state so the public snapshot cannot silently fall back to the
  // empty provider when the old hook composition is absent.
  function railDiagnosticSnapshot(requestedChannelId = '') {
    const channelIDs = new Set([
      ...replica.states().keys(),
      ...histories.keys(),
    ]);
    const channels = [];
    for (const channelId of channelIDs) {
      if (requestedChannelId && channelId !== requestedChannelId) continue;
      const state = replica.state(channelId);
      const selfID = rosterRef.current?.self?.(channelId) || '';
      const notificationHighWater = cursors.notificationHighWater(channelId);
      const counts = unreadFor(channelId, selfID);
      const status = histories.get(channelId);
      const following = followingObservations.get(channelId);
      const acknowledgedIdentities = cursors.notificationIdentities(channelId);
      const seenRoots = new Set();
      const rows = [];
      for (const [seq, envelope] of state?.rows || []) {
        if (rows.length >= 200) break;
        const rootID = notificationRootID(state, envelope);
        let ackReason = '';
        if (seq <= notificationHighWater) ackReason = 'high_water';
        else if (samePerson(envelope?.sender?.id, selfID)) ackReason = 'self';
        else {
          const disposition = notificationDisposition(state, envelope, selfID);
          if (!isRailNotifiableDisposition(disposition)) ackReason = disposition;
          else {
            const related = notificationRelatesTo(state, envelope, selfID);
            if (followingSuppressesNotification(
              followingObservationCurrent(following, status, {
                principal, world, generation,
              }) ? following : null,
              seq,
              related,
              rootID,
            )) ackReason = related && following?.scope === 'mine'
              ? 'following_related_presented' : 'following_presented';
            else if (rootID && acknowledgedIdentities.get(String(rootID)) >= seq) {
              ackReason = 'identity_acknowledged';
            }
            else if (!rootID) ackReason = 'missing_root';
            else if (seenRoots.has(rootID)) ackReason = 'duplicate_root';
            else {
              seenRoots.add(rootID);
              ackReason = related ? 'counted_related' : 'counted_other';
            }
          }
        }
        rows.push({
          id: rootID || envelope?.id || '',
          type: envelope?.type || '',
          kind: envelope?.kind || '',
          status: String(argsOf(envelope)?.status || ''),
          seq,
          ackReason,
        });
      }
      channels.push(Object.freeze({
        channelId,
        authorityReady: cursors.isReadAuthorityReady(),
        readSeq: cursors.read(channelId),
        notificationHighWater,
        counts: {
          related: counts.related,
          other: counts.other,
          pending: counts.pending,
          unknown: counts.unknown,
        },
        rows: Object.freeze(rows),
      }));
    }
    return Object.freeze({ version: 1, channels: Object.freeze(channels) });
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
      // A durable cache quota failure is a recoverable source failure, not a
      // history terminal. Let loadHistory issue the same request against the
      // network and keep the user-facing diagnostic understandable.
      if (batch.source === 'indexeddb' && error?.code === 'cache_unavailable') {
        return { kind: 'cache-miss', cacheUnavailable: true };
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
    let persistenceError = null;
    if (networkRows.length) {
      const persistence = cache.saveRows(networkRows);
      if (operation.warm) {
        try {
          // Warm pages are an anticipatory durable obligation. Do not install
          // their rows into Replica, advance history status, or publish a
          // completion until the cache write has settled. This keeps an
          // attach/world/disconnect replacement during the await from leaking
          // an old page into the current Replica authority.
          await persistence;
        } catch (error) {
          persistenceError = error;
          cacheError(error);
        }
        if (!physicalAuthorityCurrent(operation)) {
          return { kind: 'cancelled', reason: 'stale-generation' };
        }
        if (persistenceError) return { kind: 'failed', error: persistenceError };
      } else void persistence.catch(cacheError);
    }
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
      persistenceError,
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
      persistenceError: outcome.persistenceError || null,
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
      warm: request.warm === true,
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
    if (request.warm === true) operation.warm = true;
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
        warm: true,
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
      if (outcome.persistenceError) {
        return {
          kind: 'unavailable', reason: 'cache-persist-failed',
          error: outcome.persistenceError, durableRows,
        };
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
      followingObservations.clear();
      activityEntries.clear(); timerEvents.splice(0); timerOverflow = null;
      timerAcknowledgedRevision = timerRevision; activityConnected = false; activityRevision += 1;
    }
    principal = selectedPrincipal;
    localReplicaReady = false; localReplicaError = ''; localReplicaErrorCode = '';
    publish();
    if (!principal) {
      cursors.clearReadAuthority();
      localReplicaReady = true;
      for (const [channelId, status] of histories) refreshControlCurrent(channelId, status);
      publish();
      return { resume: {} };
    }
    try {
      const selected = await cache.ensureOwner(principal, { world });
      if (destroyed || epoch !== principalEpoch) return { resume: {} };
      for (const [channelId, value] of selected.meta) replica.installMeta(channelId, value);
      if (world) cursors.selectReadAuthority({ principalId: principal, serverBoot: world });
      cursors.reconcileReads(replicaResumeSnapshot(selected.meta));
      if (focus && selected.meta.has(focus)) {
        const before = historyNumeric(selected.meta.get(focus)?.headSeq || selected.meta.get(focus)?.newestSeq) + 1;
        const cached = await cache.readBefore(focus, before, HISTORY_PAGE_SIZE, HISTORY_BATCH_BYTES);
        if (destroyed || epoch !== principalEpoch) return { resume: {} };
        applyRows(cached.rows, { source: 'cache', persist: false, publishChange: false });
      }
      localReplicaReady = true;
      for (const [channelId, status] of histories) refreshControlCurrent(channelId, status);
      publish({ index: true });
      return { resume: replicaResumeSnapshot(selected.meta) };
    } catch (error) {
      if (destroyed || epoch !== principalEpoch || error?.code === 'cache_owner_changed') return { resume: {} };
      localReplicaError = error?.message || '本地缓存初始化失败';
      localReplicaErrorCode = String(error?.code || 'cache_selection_failed');
      callback('onError', error);
      publish();
      return { resume: {} };
    }
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
      followingObservations.clear();
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
    let selectedMeta = cache.metaSnapshot();
    if (principal && world) {
      let selected;
      try {
        selected = await cache.ensureOwner(principal, { world });
      } catch (error) {
        if (destroyed || epoch !== attachEpoch || error?.code === 'cache_owner_changed') return { stale: true, meta: new Map() };
        throw error;
      }
      if (destroyed || epoch !== attachEpoch || generation !== nextGeneration) return { stale: true, meta: new Map() };
      selectedMeta = selected.meta;
    }
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
      if (cursors.isReadAuthorityReady()) {
        cursors.baselineRead(channelId, grantedHeadSeq);
        if (status.notificationContextReady === true) {
          cursors.baselineNotifications(channelId, grantedHeadSeq);
        }
        cursors.clampNotificationsToHead(channelId, grantedHeadSeq);
      }
    }
    let focusHydration = null;
    if (focus && selectedMeta.has(focus) && replica.visibleNewest(focus) === 0) {
      const head = historyNumeric(selectedMeta.get(focus)?.headSeq || selectedMeta.get(focus)?.newestSeq);
      focusHydration = { channelId: focus, beforeSeq: head + 1 };
    }
    // A persisted notification obligation is a cache admission demand even
    // when its channel is not the active focus. Reuse the existing Replica
    // cache read/commit path; do not create a second notification hydrator or
    // infer a count from metadata alone. New/bootstrap authorities have
    // already been baselined above, so only a durable suffix below head is
    // admitted here.
    for (const [channelId, meta] of selectedMeta) {
      if (channelId === focus || !histories.has(channelId)) continue;
      const targetHead = Math.max(
        historyNumeric(histories.get(channelId)?.headSeq),
        historyNumeric(meta?.headSeq || meta?.newestSeq),
      );
      if (!targetHead || cursors.notificationHighWater(channelId) >= targetHead) continue;
      const cached = await cache.readBefore(channelId, targetHead + 1, HISTORY_PAGE_SIZE, HISTORY_BATCH_BYTES);
      if (destroyed || epoch !== attachEpoch || generation !== nextGeneration) return { stale: true, meta: selectedMeta };
      applyRows(cached.rows, { source: 'cache', persist: false, publishChange: false });
    }
    // Do not consume a deferred demand until every attach-owned cache/meta
    // await above has passed the current attach epoch fence. A replacement
    // attach must inherit the obligation instead of losing it to a stale
    // generation that happened to finish its cache work first.
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
    // but before its history grant arrived.  Start it only after this attach
    // has selected the current cache owner and authority.
    startAdmittedBackgroundInterests();
    if (focusHydration) {
      queueMicrotask(() => {
        void hydrateCacheRows(
          focusHydration.channelId,
          focusHydration.beforeSeq,
          {
            principalEpoch,
            worldEpoch,
            generation: nextGeneration,
            attachEpoch: epoch,
          },
        );
      });
    }
    for (const [channelId, deferred] of replayAfterAttach) {
      const request = deferred?.request || deferred;
      const semanticDemand = deferred?.semanticDemand || null;
      void loadHistory(channelId, semanticDemand ? { ...request, semanticDemand } : request)
        .catch((error) => callback('onError', error));
    }
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
      // Read-only rail handoff for the existing Workspace consumer. The
      // durable value remains owned by this runtime; callers must not inspect
      // cursor storage or derive it from physical read state.
      notificationHighWater: cursors.notificationHighWater(channelId),
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
    followingObservations.clear();
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
    const changed = cursors.resetAuthority();
    followingObservations.clear();
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
    followingObservations.clear();
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
  function markRead(channelId, acknowledgement = {}) {
    if (destroyed) return false;
    const status = histories.get(channelId);
    const physicalSeq = historyNumeric(acknowledgement.physicalSeq);
    const authority = acknowledgement.authority;
    if (!authority
      || authority.channelId !== channelId
      || authority.principalId !== principal
      || authority.serverBoot !== world
      || !cursors.isReadAuthorityReady() || !status?.attached || !status.messageCurrent
      || acknowledgement.generation !== status.generation
      || acknowledgement.authorityRevision !== status.notificationAuthorityRevision
      || physicalSeq <= 0 || physicalSeq > status.headSeq) return false;
    return cursors.markRead(channelId, physicalSeq);
  }
  // Commit one frozen notification confirmation. The event carries the
  // boundary selected by its producing Presentation/DOM observation; this
  // reducer must never replace it with the mutable current head.
  function acknowledgeNotifications(channelOrEvent, maybeConfirmation = {}) {
    if (destroyed) return false;
    const event = channelOrEvent && typeof channelOrEvent === 'object'
      ? channelOrEvent
      : maybeConfirmation;
    const channelId = String(
      (typeof channelOrEvent === 'string' ? channelOrEvent : '')
      || event?.channelId
      || event?.authority?.channelId
      || '',
    );
    const status = histories.get(channelId);
    const authority = event?.authority;
    const owner = event?.owner;
    const captured = event?.captured;
    const eventGeneration = historyNumeric(event?.generation);
    const authorityRevisionValue = historyNumeric(event?.authorityRevision);
    const boundary = historyNumeric(event?.boundary);
    const cause = event?.cause;
    const typedRevoke = event?.kind === NOTIFICATION_LEASE_REVOKE;
    const hasInputEpoch = Boolean(event && Object.prototype.hasOwnProperty.call(event, 'inputEpoch'));
    const inputEpoch = hasInputEpoch ? notificationInputEpoch(event.inputEpoch) : null;
    const receiptInputEpoch = inputEpoch === null ? 0 : inputEpoch;
    const retracting = typedRevoke || event?.caughtUp !== true
      || event?.atTail !== true
      || event?.following !== true
      || event?.surfaceVisible !== true;

    if ((hasInputEpoch && inputEpoch === null)
      || (typedRevoke && (inputEpoch === null
        || !NOTIFICATION_LEASE_REVOKE_REASONS.has(String(event.reason || ''))))) return false;

    // A notification confirmation is an immutable cross-owner event. Do not
    // accept the former flat channel/generation shape: without the exact
    // authority tuple, committed owner identity, revision, and captured DOM
    // boundary, a late callback could borrow a newer head.
    if (!authority || !owner || !captured
      || !String(authority.principalId || '')
      || !String(authority.serverBoot || '')
      || !String(authority.channelId || '')
      || !String(owner.viewKey || '')
      || !String(owner.activationID || '')
      || !Number.isSafeInteger(Number(owner.generation))
      || !Number.isSafeInteger(Number(event.generation))
      || !Number.isSafeInteger(Number(event.authorityRevision))
      || !Number.isSafeInteger(Number(captured.presentationRevision))
      || !Number.isSafeInteger(Number(captured.sourceRevision))
      || !Number.isSafeInteger(Number(captured.installedHighSeq))
      || authority.channelId !== channelId
      || authority.principalId !== principal
      || authority.serverBoot !== world
      || owner.channelId && owner.channelId !== channelId
      || Number(owner.generation) !== eventGeneration
      || (retracting
        ? boundary !== 0
        : boundary !== historyNumeric(captured.installedHighSeq))) return false;

    // Retractions are authority-boundary events too.  In particular, do not
    // let a typed physical-leave receipt install a fence while its channel is
    // disconnected or while a same-generation regrant has already advanced
    // the current authority revision.  Such a receipt belongs to the retired
    // attach, even if its owner/generation tuple happens to be reused.
    const currentAuthority = Boolean(status?.attached === true
      && status.messageCurrent === true
      && status.generation > 0
      && status.generation === generation
      && eventGeneration === status.generation
      && authorityRevisionValue === status.notificationAuthorityRevision);
    if (!currentAuthority) return false;

    const observation = followingObservations.get(channelId);
    const ownerKey = notificationOwnerKey(owner);
    const observationCurrent = followingObservationAuthorityCurrent(observation, status, {
      principal, world, generation,
    });
    const currentObservation = observationCurrent ? observation : null;
    const observationKey = currentObservation ? notificationOwnerKey(currentObservation.owner) : '';
    const sameOwner = Boolean(currentObservation && observationKey === ownerKey);
    const retiredOwnerKeys = Array.isArray(currentObservation?.retiredOwnerKeys)
      ? currentObservation.retiredOwnerKeys : [];
    // A receipt that explicitly reports the committed owner no longer being
    // at a visible tail revokes only that same owner. A stale cleanup from a
    // replaced activation cannot revoke the new owner’s short observation
    // lease. This is a retraction, not a notification confirmation.
    if (retracting) {
      // Browsing -> following promotion can publish a transient negative
      // receipt while the committed DOM is still at the physical tail.  It
      // is never a revoke, including when the previous observation was
      // invalidated by a reconnect.
      if (event.atTail === true && event.surfaceVisible === true) return false;
      if (typedRevoke && !currentObservation) {
        // Keep the revoke epoch even when no active lease is visible. A
        // positive receipt issued before this input may still be queued and
        // must not recreate the lease after the synchronous revoke.
        followingObservations.set(channelId, Object.freeze({
          authority: Object.freeze({ ...authority }),
          owner: Object.freeze({ ...owner }),
          authorityRevision: authorityRevisionValue,
          active: false,
          scope: notificationScope(event?.scope),
          actorFiltered: notificationActorFiltered(event),
          relatedMask: false,
          exactRootMask: false,
          maskedRootIDs: Object.freeze([]),
          inputEpoch,
          revokeInputEpoch: inputEpoch,
          retiredOwnerKeys: Object.freeze([]),
          headSeq: cursors.notificationHighWater(channelId),
        }));
        publish();
        return false;
      }
      if (sameOwner) {
        // During browsing -> following promotion the reading surface can
        // publish one intermediate receipt with `following: false` while
        // the committed DOM is still at the physical tail. That receipt is
        // not evidence that the user left the tail: dropping the lease here
        // would make every live arrival re-count from the mutable head and
        // flash a rail badge until the next positive observation. A real
        // leave changes the physical-tail or surface-visible fact, so only
        // that boundary may revoke the existing observation.
        if (!typedRevoke) {
          followingObservations.delete(channelId);
          publish();
          return false;
        }
        const observationEpoch = notificationInputEpoch(observation.inputEpoch) ?? 0;
        const previousFence = notificationInputEpoch(observation.revokeInputEpoch) ?? -1;
        if (inputEpoch < observationEpoch || inputEpoch < previousFence) return false;
        followingObservations.set(channelId, Object.freeze({
          ...observation,
          active: false,
          inputEpoch: Math.max(observationEpoch, inputEpoch),
          revokeInputEpoch: Math.max(previousFence, inputEpoch),
        }));
        publish();
      }
      return false;
    }

    if (!cursors.isReadAuthorityReady() || !status?.attached || !status.messageCurrent
      || !eventGeneration || eventGeneration !== status.generation
      || authorityRevisionValue !== status.notificationAuthorityRevision
      || (cause !== 'tail-backlog' && cause !== 'presented-follow')
      || boundary <= 0 || boundary > status.headSeq) return false;

    const previous = cursors.notificationHighWater(channelId);
    const scope = notificationScope(event?.scope);
    const actorFiltered = notificationActorFiltered(event);
    const durableAll = scope === 'all' && !actorFiltered;
    const mineOnly = scope === 'mine' && !actorFiltered;
    const state = replica.state(channelId);
    const selfID = rosterRef.current?.self?.(channelId) || '';
    const receiptRootIDs = notificationReceiptRootIDs(state, event);
    // Sparse exact-root receipts are durable only for an unfiltered all view.
    // A mine tail normally installs an ephemeral related-only mask; the
    // related-only frontier below may use the scalar cursor only when the
    // whole frozen range is provably in-scope.
    const exactRootMask = durableAll && Array.isArray(receiptRootIDs);
    const maskedRootIDs = exactRootMask ? receiptRootIDs : [];
    // Only an unfiltered all-channel receipt may make sparse visible roots
    // durable. A mine receipt never persists sparse identities; it may only
    // close a wholly related numeric frontier below.
    const identityEntries = durableAll
      ? notificationIdentityEntries(state, boundary, receiptRootIDs)
      : null;
    const relatedOnlyBoundary = mineOnly
      ? notificationBoundaryForRelatedOnly(state, boundary, previous, selfID)
      : previous;
    const durableMine = mineOnly && relatedOnlyBoundary > previous;
    const durableReceipt = durableAll || durableMine;
    // The installed boundary is captured by Presentation, but only the
    // canonical Feed rows can prove that it is a continuous, parent-closed
    // notification frontier. In particular, do not let a response-first
    // terminal disappear behind high-water before its request arrives.
    const acknowledgedBoundary = exactRootMask
      ? notificationBoundaryForVisibleRoots(
        state,
        boundary,
        previous,
        receiptRootIDs,
        selfID,
      )
      : durableMine
        ? relatedOnlyBoundary
        : closedNotificationBoundary(replica.state(channelId), boundary, previous);
    if (currentObservation && sameOwner) {
      const previousFence = notificationInputEpoch(currentObservation.revokeInputEpoch) ?? -1;
      // A revoke is a tombstone for the whole receipt epoch.  A positive
      // callback issued in that same epoch may be late, but it is not a new
      // observation and must not re-install the lease.  Only a strictly newer
      // input epoch can prove a fresh tail observation for this owner.
      if (previousFence >= 0 && (!hasInputEpoch || receiptInputEpoch <= previousFence)) return false;
    } else if (currentObservation && retiredOwnerKeys.includes(ownerKey)) {
      return false;
    }
    const nextRetiredOwnerKeys = currentObservation && !sameOwner
      ? Object.freeze([...new Set([...retiredOwnerKeys, observationKey].filter(Boolean))].slice(-8))
      : Object.freeze(retiredOwnerKeys);
    const identityChanged = identityEntries
      ? cursors.acknowledgeNotificationIdentities(channelId, identityEntries)
      : false;
    if (!durableReceipt) {
      // A mine receipt that spans an outside-scope root remains a session-only
      // related mask. Actor-filtered receipts are even narrower and cannot
      // suppress either channel-level projection. Neither path may advance
      // the one durable channel high-water.
      const maskBoundary = mineOnly
        ? closedNotificationBoundary(replica.state(channelId), boundary, previous)
        : previous;
      const unresolvedBoundary = mineOnly
        ? unresolvedTerminalBoundary(replica.state(channelId), maskBoundary)
        : 0;
      const nextHeadSeq = Math.max(previous, exactRootMask ? boundary : maskBoundary);
      const duplicateObservation = currentObservation
        && notificationOwnerKey(currentObservation.owner) === ownerKey
        && currentObservation.authorityRevision === authorityRevisionValue
        && notificationInputEpoch(currentObservation.inputEpoch) === receiptInputEpoch
        && currentObservation.scope === scope
        && currentObservation.actorFiltered === actorFiltered
        && currentObservation.relatedMask === mineOnly
        && currentObservation.exactRootMask === exactRootMask
        && sameNotificationRootMask(currentObservation.maskedRootIDs, maskedRootIDs)
        && historyNumeric(currentObservation.headSeq) === nextHeadSeq
        && historyNumeric(currentObservation.unresolvedBoundary) === unresolvedBoundary;
      if (duplicateObservation) return false;
      followingObservations.set(channelId, Object.freeze({
        authority: Object.freeze({ ...authority }),
        owner: Object.freeze({ ...owner }),
        authorityRevision: authorityRevisionValue,
        active: mineOnly,
        scope,
        actorFiltered,
        relatedMask: mineOnly,
        exactRootMask,
        maskedRootIDs: Object.freeze(maskedRootIDs),
        inputEpoch: receiptInputEpoch,
        revokeInputEpoch: -1,
        retiredOwnerKeys: nextRetiredOwnerKeys,
        headSeq: nextHeadSeq,
        unresolvedBoundary,
      }));
      publish();
      return false;
    }
    if (acknowledgedBoundary > 0 && acknowledgedBoundary <= previous) {
      followingObservations.set(channelId, Object.freeze({
        authority: Object.freeze({ ...authority }),
        owner: Object.freeze({ ...owner }),
        authorityRevision: authorityRevisionValue,
        active: true,
        scope,
        actorFiltered,
        relatedMask: false,
        exactRootMask,
        maskedRootIDs: Object.freeze(maskedRootIDs),
        inputEpoch: receiptInputEpoch,
        revokeInputEpoch: -1,
        retiredOwnerKeys: nextRetiredOwnerKeys,
        // A positive receipt at an already-confirmed boundary still installs
        // the short following lease for future live ingress.
        headSeq: Math.max(
          previous,
          exactRootMask ? boundary : historyNumeric(currentObservation?.headSeq),
        ),
      }));
      if (identityChanged) publish();
      return previous || false;
    }
    if (acknowledgedBoundary <= previous) {
      if (identityChanged) publish();
      return previous || false;
    }
    const acknowledged = cursors.acknowledgeNotifications(channelId, acknowledgedBoundary);
    followingObservations.set(channelId, Object.freeze({
      authority: Object.freeze({ ...authority }),
      owner: Object.freeze({ ...owner }),
      authorityRevision: authorityRevisionValue,
      active: true,
      scope,
      actorFiltered,
      relatedMask: false,
      exactRootMask,
      maskedRootIDs: Object.freeze(maskedRootIDs),
      inputEpoch: receiptInputEpoch,
      revokeInputEpoch: -1,
      retiredOwnerKeys: nextRetiredOwnerKeys,
      // Only facts at or below the frozen DOM boundary are confirmed. A
      // lower backlog receipt must leave later already-committed rows
      // visible; subsequent live ingress advances this lease incrementally.
      headSeq: exactRootMask ? boundary : acknowledged,
    }));
    if (acknowledged > previous) publish();
    return acknowledged;
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
      loadHistory, requestBackgroundInterest, markRead, acknowledgeNotifications,
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
    activityEntries.clear(); followingObservations.clear(); timerEvents.splice(0);
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
