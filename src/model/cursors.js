import { relatedEnvelopeIds } from './timeline-scope.js';
import { KIND, PROVISIONAL } from '../protocol/envelope.js';

const CURSOR_PREFIX = 'atoll.cursor.v3.';
const READ_PREFIX = 'atoll.read.v3.';

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
        const prefix = key.startsWith(CURSOR_PREFIX)
          ? CURSOR_PREFIX
          : key.startsWith(READ_PREFIX) ? READ_PREFIX : '';
        if (!prefix) continue;
        const channelId = key.slice(prefix.length);
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
    markRead(channelId, seq) {
      const current = this.read(channelId);
      const next = Math.max(current, safeNumber(seq));
      set(`${READ_PREFIX}${channelId}`, next);
      return next;
    },
  };
}

// Channel badges are notifications, not a ledger row counter. One request may
// produce many queued/processing/deferred response frames while an agent works;
// those frames update the existing turn and must not look like new messages.
// Keep only conversational requests and settled responses. Events remain in
// the complete timeline, but are deliberately too noisy for the channel rail.
function isNotifiable(envelope) {
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
  let related = 0;
  let total = 0;
  for (const [seq, envelope] of channelState.rows) {
    if (seq <= readSeq) continue;
    if (selfId && envelope?.sender?.id === selfId) continue;
    if (!isNotifiable(envelope)) continue;
    total += 1;
    if (envelope?.id && relatedIds.has(envelope.id)) related += 1;
  }
  return { related, total };
}
