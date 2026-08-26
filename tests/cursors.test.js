import { describe, expect, it } from 'vitest';
import { createCursors, unreadCount, unreadCounts } from '../src/model/cursors.js';

class MemoryStorage {
  data = new Map();
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}

describe('channel cursors', () => {
  it('only advances and snapshots feed cursors', () => {
    const cursors = createCursors(new MemoryStorage());
    expect(cursors.advance('c0', 8)).toBe(8);
    expect(cursors.advance('c0', 3)).toBe(8);
    cursors.advance('lobby', 2);
    expect(cursors.snapshot()).toEqual({ c0: 8, lobby: 2 });
  });

  it('tracks read cursors separately and counts non-system, non-self messages', () => {
    const cursors = createCursors(new MemoryStorage());
    cursors.markRead('c0', 2);
    cursors.markRead('c0', 1);
    expect(cursors.read('c0')).toBe(2);
    const state = { rows: new Map([
      [2, { id: 'already-read', kind: 'request', visibility: 'public', sender: { id: 'other' } }],
      [3, { id: 'system-row', kind: 'request', visibility: 'system', sender: { id: 'system' } }],
      [4, { id: 'mine', kind: 'request', visibility: 'public', sender: { id: 'me' } }],
      [5, { id: 'reply', kind: 'response', visibility: 'public', payload: { status: 'completed' }, sender: { id: 'other' } }],
    ]) };
    expect(unreadCount(state, cursors.read('c0'), 'me')).toBe(1);
  });

  it('caps feed resume cursors without rewinding cache-independent read cursors', () => {
    const storage = new MemoryStorage();
    const cursors = createCursors(storage);
    cursors.advance('c0', 48);
    cursors.markRead('c0', 48);
    cursors.advance('missing-cache', 99);
    cursors.markRead('missing-cache', 99);

    cursors.reconcile({ c0: 33 });

    expect(cursors.snapshot()).toEqual({ c0: 33, 'missing-cache': 0 });
    expect(cursors.read('c0')).toBe(48);
    expect(cursors.read('missing-cache')).toBe(99);
  });

  it('baselines a new browser at the attach head and preserves an older read boundary', () => {
    const cursors = createCursors(new MemoryStorage());
    expect(cursors.hasRead('c0')).toBe(false);
    expect(cursors.baselineRead('c0', 100)).toBe(100);
    expect(cursors.hasRead('c0')).toBe(true);
    cursors.markRead('c0', 120);
    // A later reconnect at the same ledger head never moves a valid read cursor
    // backwards, while a replaced/truncated ledger is allowed to clamp it.
    expect(cursors.baselineRead('c0', 130)).toBe(120);
    expect(cursors.baselineRead('c0', 80)).toBe(80);
    cursors.resetReads();
    expect(cursors.hasRead('c0')).toBe(false);
  });

  it('separates @me unread messages from the weak all-message count', () => {
    const state = { rows: new Map([
      [1, { id: 'old', kind: 'request', visibility: 'public', audience: ['me'], sender: { id: 'agent' } }],
      [2, { id: 'system-noise', kind: 'request', visibility: 'public', audience: [], sender: { id: 'system' } }],
      [3, { id: 'ask-me', kind: 'request', visibility: 'public', audience: ['me'], sender: { id: 'agent' } }],
      [4, { id: 'reply-to-me', kind: 'response', parent_id: 'ask-me', visibility: 'system', audience: ['me'], payload: { status: 'completed' }, sender: { id: 'system' } }],
      [5, { id: 'mine', kind: 'request', visibility: 'public', audience: ['agent'], sender: { id: 'me' } }],
    ]) };

    expect(unreadCounts(state, 1, 'me')).toEqual({ related: 1, total: 2 });
    expect(unreadCounts(state, 2, 'me')).toEqual({ related: 1, total: 1 });
  });

  it('counts requests and settled responses but ignores progress and events', () => {
    const state = { rows: new Map([
      [1, { id: 'request', kind: 'request', audience: ['me'], sender: { id: 'agent' } }],
      [2, { id: 'queued', kind: 'response', parent_id: 'request', audience: ['me'], payload: { status: 'queued' }, sender: { id: 'agent' } }],
      [3, { id: 'processing', kind: 'response', parent_id: 'request', audience: ['me'], payload: { status: 'processing', process: { kind: 'stage' } }, sender: { id: 'agent' } }],
      [4, { id: 'business-event', kind: 'event', audience: ['me'], sender: { id: 'agent' } }],
      [5, { id: 'completed', kind: 'response', parent_id: 'request', audience: ['me'], payload: { status: 'completed' }, sender: { id: 'agent' } }],
      [6, { id: 'failed', kind: 'response', parent_id: 'request', audience: ['me'], payload: { status: 'failed' }, sender: { id: 'agent' } }],
    ]) };

    expect(unreadCounts(state, 0, 'me')).toEqual({ related: 1, total: 1 });
  });

  it('does not notify for control turns hidden from the timeline', () => {
    const state = { rows: new Map([
      [1, { id: 'context', type: 'agent.context', kind: 'request', audience: ['agent'], sender: { id: 'me' } }],
      [2, { id: 'context-done', type: 'agent.context', kind: 'response', parent_id: 'context', audience: ['me'], payload: { status: 'completed' }, sender: { id: 'agent' } }],
    ]) };
    expect(unreadCounts(state, 0, 'me')).toEqual({ related: 0, total: 0 });
  });

  it('counts one notification per root turn even when several child frames settle', () => {
    const state = { rows: new Map([
      [1, { id: 'root', kind: 'request', audience: ['agent'], sender: { id: 'me' } }],
      [2, { id: 'child', kind: 'request', parent_id: 'root', audience: ['worker'], sender: { id: 'agent' } }],
      [3, { id: 'child-done', kind: 'response', parent_id: 'child', audience: ['agent'], payload: { status: 'completed' }, sender: { id: 'worker' } }],
      [4, { id: 'root-done', kind: 'response', parent_id: 'root', audience: ['me'], payload: { status: 'completed' }, sender: { id: 'agent' } }],
    ]) };
    expect(unreadCounts(state, 1, 'me')).toEqual({ related: 1, total: 1 });
  });
});
