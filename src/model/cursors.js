import { relatedEnvelopeIds } from './timeline-scope.js';
import { KIND, PROVISIONAL } from '../protocol/envelope.js';
import { TYPES } from '../protocol/vocab.js';

const CURSOR_PREFIX = 'atoll.cursor.v3.';
// v4 changes the meaning from "every loaded envelope after this seq" to
// "root timeline entries after the last tail the user actually saw". Reusing
// v3 would turn an old, cache-relative number into a false unread boundary.
const READ_PREFIX = 'atoll.read.v4.';

function safeNumber(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

export function createCursors(storage = globalThis.localStorage) {
  const memory = new Map();

  function get(key) {
    if (storage) return storage.getItem(key);
    return memory.get(key) ?? null;
  }

  function set(key, value) {
    if (storage) storage.setItem(key, String(value));
    else memory.set(key, String(value));
  }

  function remove(key) {
    if (storage) storage.removeItem(key);
    else memory.delete(key);
  }

  function keys() {
    if (!storage) return [...memory.keys()];
    const result = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) result.push(key);
    }
    return result;
  }

  return {
    reconcile(available = {}) {
      for (const key of keys()) {
        // Resume cursors are bounded by what IndexedDB can actually restore.
        // Read cursors are user state, not cache state: FIFO eviction must not
        // make old history unread again.
        if (!key.startsWith(CURSOR_PREFIX)) continue;
        const channelId = key.slice(CURSOR_PREFIX.length);
        const maximum = safeNumber(available[channelId]);
        const current = safeNumber(get(key));
        if (current > maximum) set(key, maximum);
      }
    },
    snapshot() {
      const result = {};
      for (const key of keys()) {
        if (!key.startsWith(CURSOR_PREFIX)) continue;
        result[key.slice(CURSOR_PREFIX.length)] = safeNumber(get(key));
      }
      return result;
    },
    value(channelId) {
      return safeNumber(get(`${CURSOR_PREFIX}${channelId}`));
    },
    advance(channelId, seq) {
      const current = this.value(channelId);
      const next = Math.max(current, safeNumber(seq));
      set(`${CURSOR_PREFIX}${channelId}`, next);
      return next;
    },
    read(channelId) {
      return safeNumber(get(`${READ_PREFIX}${channelId}`));
    },
    hasRead(channelId) {
      return get(`${READ_PREFIX}${channelId}`) != null;
    },
    baselineRead(channelId, seq) {
      const key = `${READ_PREFIX}${channelId}`;
      const head = safeNumber(seq);
      const raw = get(key);
      // No local read fact means "start observing after this attach snapshot",
      // not "all hydrated history since seq zero is unread". A cursor above
      // the current head belongs to a replaced/truncated ledger and is clamped.
      if (raw == null || safeNumber(raw) > head) set(key, head);
      return this.read(channelId);
    },
    markRead(channelId, seq) {
      const current = this.read(channelId);
      const next = Math.max(current, safeNumber(seq));
      set(`${READ_PREFIX}${channelId}`, next);
      return next;
    },
    resetReads() {
      for (const key of keys()) if (key.startsWith(READ_PREFIX)) remove(key);
    },
  };
}

// Channel badges are notifications, not a ledger row counter. One request may
// produce many queued/processing/deferred response frames while an agent works;
// those frames update the existing turn and must not look like new messages.
// Keep only conversational requests and settled responses. Events remain in
// the complete timeline, but are deliberately too noisy for the channel rail.
const HIDDEN_CONTROL_TYPES = new Set([
  TYPES.agentHold,
  TYPES.agentUnhold,
  TYPES.agentInterrupt,
  TYPES.agentContext,
  TYPES.agentFork,
  TYPES.describe,
]);

function isNotifiable(envelope) {
  if (HIDDEN_CONTROL_TYPES.has(envelope?.type)) return false;
  if (envelope?.kind === KIND.request) return true;
  return envelope?.kind === KIND.response && !PROVISIONAL.has(envelope?.payload?.status);
}

export function unreadCount(channelState, readSeq, selfId) {
  if (!channelState?.rows) return 0;
  let count = 0;
  for (const [seq, envelope] of channelState.rows) {
    if (seq <= readSeq) continue;
    if (envelope?.visibility === 'system') continue;
    if (selfId && envelope?.sender?.id === selfId) continue;
    if (!isNotifiable(envelope)) continue;
    count += 1;
  }
  return count;
}

// The channel rail carries two different signals:
//   related — messages in the same conversation scope as the "@我" timeline
//   total   — every new conversational request/settled response not authored
//             by this user
//
// Keep one read cursor for both. They describe the same unread interval; only
// the visual priority differs. In particular, generic system traffic belongs
// to total but cannot become a strong notification unless it is genuinely in
// one of this user's conversations.
export function unreadCounts(channelState, readSeq, selfId) {
  if (!channelState?.rows) return { related: 0, total: 0 };
  const relatedIds = relatedEnvelopeIds(channelState, selfId);
  const byId = new Map();
  for (const envelope of channelState.rows.values()) {
    if (!envelope?.id) continue;
    byId.set(envelope.id, envelope);
  }

  function rootId(envelope) {
    let current = envelope;
    const seen = new Set();
    while (current?.parent_id && !seen.has(current.parent_id)) {
      seen.add(current.parent_id);
      const parent = byId.get(current.parent_id);
      if (!parent) break;
      current = parent;
    }
    return current?.id || envelope?.id || '';
  }

  const totalRoots = new Set();
  const relatedRoots = new Set();
  for (const [seq, envelope] of channelState.rows) {
    if (seq <= readSeq) continue;
    if (selfId && envelope?.sender?.id === selfId) continue;
    if (!isNotifiable(envelope)) continue;
    const root = rootId(envelope);
    if (!root) continue;
    totalRoots.add(root);
    if (envelope?.id && (relatedIds.has(envelope.id) || relatedIds.has(root))) relatedRoots.add(root);
  }
  return { related: relatedRoots.size, total: totalRoots.size };
}
