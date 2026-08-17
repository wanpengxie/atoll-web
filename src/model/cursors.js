const CURSOR_PREFIX = 'atoll.cursor.v2.';
const READ_PREFIX = 'atoll.read.v2.';

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

export function unreadCount(channelState, readSeq, selfId) {
  if (!channelState?.rows) return 0;
  let count = 0;
  for (const [seq, envelope] of channelState.rows) {
    if (seq <= readSeq) continue;
    if (envelope?.visibility === 'system') continue;
    if (selfId && envelope?.sender?.id === selfId) continue;
    count += 1;
  }
  return count;
}
