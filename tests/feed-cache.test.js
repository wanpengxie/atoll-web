import { describe, expect, it } from 'vitest';
import { apply, createChannelState } from '../src/model/fold.js';
import { createFeedCache, redactFeedSecrets, resumeSnapshot } from '../src/model/feed-cache.js';

class MemoryStorage {
  constructor() { this.data = new Map(); }
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}

function envelope(id, text) {
  return {
    id, ts: 1, channel_id: 'c0', sender: { kind: 'human', id: 'root' },
    kind: 'request', type: 'agent.ask', payload: { text }, visibility: 'public', audience: ['steward'],
  };
}

describe('feed cache', () => {
  it('derives the resume cursor from the rows that are actually available', () => {
    const state = createChannelState('c0');
    apply(state, { channel_id: 'c0', seq: 4, envelope: envelope('m-4', 'hello') });
    apply(state, { channel_id: 'c0', seq: 7, envelope: envelope('m-7', 'again') });
    expect(resumeSnapshot(new Map([['c0', state]]))).toEqual({ c0: 7 });
  });

  it('removes the unbounded localStorage v5 cache during IndexedDB migration', async () => {
    const storage = new MemoryStorage();
    storage.setItem('atoll.feed.v5.c0', '[{"stale":true}]');
    storage.setItem('unrelated', 'keep');
    const restored = await createFeedCache({ indexedDBImpl: null, legacyStorage: storage }).restore();
    expect(restored.size).toBe(0);
    expect(storage.getItem('atoll.feed.v5.c0')).toBeNull();
    expect(storage.getItem('unrelated')).toBe('keep');
  });

  it('redacts device keys and nested credentials before IndexedDB persistence', () => {
    const value = redactFeedSecrets({ device_id: 'd1', key: 'one-time-key', nested: { token: 'token-value' } });
    const saved = JSON.stringify(value);
    expect(saved).not.toContain('one-time-key');
    expect(saved).not.toContain('token-value');
    expect(saved).toContain('已隐藏');
  });
});
