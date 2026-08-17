import { describe, expect, it } from 'vitest';
import { apply, createChannelState } from '../src/model/fold.js';
import { createFeedCache, resumeSnapshot } from '../src/model/feed-cache.js';

class MemoryStorage {
  constructor() { this.data = new Map(); }
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
}

function envelope(id, text) {
  return {
    id,
    ts: '2026-08-17T00:00:00Z',
    channel_id: 'c0',
    sender: { kind: 'human', id: 'root' },
    kind: 'request',
    type: 'human.text',
    payload: { text },
    visibility: 'public',
    audience: ['steward'],
  };
}

describe('feed cache', () => {
  it('restores folded channel state and supplies a matching resume cursor', () => {
    const storage = new MemoryStorage();
    const cache = createFeedCache(storage);
    const state = createChannelState('c0');
    apply(state, { channel_id: 'c0', seq: 4, envelope: envelope('m-4', 'hello') });
    apply(state, { channel_id: 'c0', seq: 7, envelope: envelope('m-7', 'again') });
    expect(cache.save(state)).toBe(true);

    const restored = cache.restore();
    expect(restored.get('c0').rows.size).toBe(2);
    expect(restored.get('c0').turns.size).toBe(2);
    expect(restored.get('c0').lastSeq).toBe(7);
    expect(resumeSnapshot(restored)).toEqual({ c0: 7 });
  });

  it('ignores a damaged cache so the channel can be replayed from zero', () => {
    const storage = new MemoryStorage();
    storage.setItem('atoll.feed.v3.c0', '{bad json');
    const restored = createFeedCache(storage).restore();
    expect(restored.size).toBe(0);
    expect(resumeSnapshot(restored)).toEqual({});
  });

  it('never persists device keys or nested credentials from feed payloads', () => {
    const storage = new MemoryStorage();
    const state = createChannelState('c0');
    const row = envelope('mint', 'mint');
    row.kind = 'response';
    row.payload = { status: 'completed', value: { device_id: 'd1', key: 'one-time-key', nested: { token: 'token-value' } } };
    apply(state, { channel_id: 'c0', seq: 1, envelope: row });
    createFeedCache(storage).save(state);
    const saved = storage.getItem('atoll.feed.v4.c0');
    expect(saved).not.toContain('one-time-key');
    expect(saved).not.toContain('token-value');
    expect(saved).toContain('已隐藏');
  });
});
