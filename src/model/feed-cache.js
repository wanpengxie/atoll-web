import { apply, createChannelState } from './fold.js';

const FEED_PREFIX = 'atoll.feed.v3.';

function storageKeys(storage) {
  const result = [];
  for (let index = 0; index < (storage?.length || 0); index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(FEED_PREFIX)) result.push(key);
  }
  return result;
}

export function resumeSnapshot(states) {
  return Object.fromEntries(
    [...(states || new Map())]
      .filter(([, state]) => Number.isSafeInteger(state?.lastSeq) && state.lastSeq > 0)
      .map(([channelId, state]) => [channelId, state.lastSeq]),
  );
}

export function createFeedCache(storage = globalThis.localStorage) {
  return {
    restore() {
      const states = new Map();
      if (!storage) return states;
      for (const key of storageKeys(storage)) {
        try {
          const channelId = key.slice(FEED_PREFIX.length);
          const rows = JSON.parse(storage.getItem(key) || '[]');
          if (!channelId || !Array.isArray(rows)) continue;
          const state = createChannelState(channelId);
          for (const row of rows) {
            apply(state, { channel_id: channelId, seq: row?.seq, envelope: row?.envelope });
          }
          if (state.rows.size) states.set(channelId, state);
        } catch {
          // 损坏或来自旧版本的缓存不应阻止重新从 server 回放。
        }
      }
      return states;
    },

    save(state) {
      if (!storage || !state?.channelId) return false;
      const rows = [...state.rows]
        .sort(([left], [right]) => left - right)
        .map(([seq, envelope]) => ({ seq, envelope }));
      try {
        storage.setItem(`${FEED_PREFIX}${state.channelId}`, JSON.stringify(rows));
        return true;
      } catch {
        // localStorage 满额时保持实时账本可用；下次启动会对无缓存频道全量回放。
        return false;
      }
    },
  };
}
