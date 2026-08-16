import { describe, expect, it } from 'vitest';
import { createCursors, unreadCount } from '../src/model/cursors.js';

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
});
