import { describe, expect, it } from 'vitest';
import { createCursors, unreadCount, unreadCounts } from '../src/model/cursors.js';

class MemoryStorage {
  data = new Map();
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
}

describe('channel cursors', () => {
  it('only advances and snapshots feed cursors', () => {
    const cursors = createCursors(new MemoryStorage());
    expect(cursors.advance('c0', 8)).toBe(8);
    expect(cursors.advance('c0', 3)).toBe(8);
    cursors.advance('lobby', 2);
    expect(cursors.snapshot()).toEqual({ c0: 8, lobby: 2 });
  });

  it('tracks read cursors separately and counts non-system, non-self rows', () => {
    const cursors = createCursors(new MemoryStorage());
    cursors.markRead('c0', 2);
    cursors.markRead('c0', 1);
    expect(cursors.read('c0')).toBe(2);
    const state = { rows: new Map([
      [2, { visibility: 'public', sender: { id: 'other' } }],
      [3, { visibility: 'system', sender: { id: 'system' } }],
      [4, { visibility: 'public', sender: { id: 'me' } }],
      [5, { visibility: 'public', sender: { id: 'other' } }],
    ]) };
    expect(unreadCount(state, cursors.read('c0'), 'me')).toBe(1);
  });

  it('caps stale persisted cursors at the last locally restorable sequence', () => {
    const storage = new MemoryStorage();
    const cursors = createCursors(storage);
    cursors.advance('c0', 48);
    cursors.markRead('c0', 48);
    cursors.advance('missing-cache', 99);
    cursors.markRead('missing-cache', 99);

    cursors.reconcile({ c0: 33 });

    expect(cursors.snapshot()).toEqual({ c0: 33, 'missing-cache': 0 });
    expect(cursors.read('c0')).toBe(33);
    expect(cursors.read('missing-cache')).toBe(0);
  });

  it('separates @me unread messages from the weak all-message count', () => {
    const state = { rows: new Map([
      [1, { id: 'old', visibility: 'public', audience: ['me'], sender: { id: 'agent' } }],
      [2, { id: 'system-noise', visibility: 'public', audience: [], sender: { id: 'system' } }],
      [3, { id: 'ask-me', visibility: 'public', audience: ['me'], sender: { id: 'agent' } }],
      [4, { id: 'reply-to-me', parent_id: 'ask-me', visibility: 'system', audience: ['me'], sender: { id: 'system' } }],
      [5, { id: 'mine', visibility: 'public', audience: ['agent'], sender: { id: 'me' } }],
    ]) };

    expect(unreadCounts(state, 1, 'me')).toEqual({ related: 2, total: 3 });
    expect(unreadCounts(state, 2, 'me')).toEqual({ related: 2, total: 2 });
  });
});
