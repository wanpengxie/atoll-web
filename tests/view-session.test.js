import { describe, expect, it } from 'vitest';
import { createViewSessionStore } from '../src/model/view-session.js';

describe('per-channel view sessions', () => {
  it('keeps disposable reader choices isolated by channel', () => {
    const sessions = createViewSessionStore();
    sessions.writeConversation('a', {
      scope: 'all',
      actorFilter: ['agent-b', 'agent-a', 'agent-a'],
      foldOverrides: [['turn-1', true]],
    });

    expect(sessions.read('a')).toEqual({
      mode: 'following',
      anchor: null,
      unseenTail: 0,
      scope: 'all',
      actorFilter: ['agent-a', 'agent-b'],
      foldOverrides: [['turn-1', true]],
      foldDefaults: [],
      viewportSnapshot: null,
    });
    expect(sessions.read('b')).toEqual({ mode: 'following', anchor: null, unseenTail: 0, scope: 'mine', actorFilter: [], foldOverrides: [], foldDefaults: [], viewportSnapshot: null });
  });

  it('merges semantic reading updates without becoming a second route store', () => {
    const sessions = createViewSessionStore();
    sessions.writeConversation('a', { mode: 'browsing', anchor: { rowID: 'turn-8', offset: -12, seq: 8 }, unseenTail: 3 });
    sessions.writeConversation('a', { scope: 'all' });

    expect(sessions.read('a')).toEqual({
      mode: 'browsing',
      anchor: { rowID: 'turn-8', offset: -12, seq: 8 },
      unseenTail: 3,
      scope: 'all',
      actorFilter: [],
      foldOverrides: [],
      foldDefaults: [],
      viewportSnapshot: null,
    });
  });

  it('returns defensive copies and can be discarded safely', () => {
    const sessions = createViewSessionStore();
    sessions.writeConversation('a', { actorFilter: ['agent-a'] });
    const snapshot = sessions.read('a');
    snapshot.actorFilter.push('agent-b');
    expect(sessions.read('a').actorFilter).toEqual(['agent-a']);
    sessions.forget('a');
    expect(sessions.read('a').actorFilter).toEqual([]);
  });

  it('defensively retains a disposable renderer snapshot beside the semantic anchor', () => {
    const sessions = createViewSessionStore();
    sessions.writeConversation('a', {
      mode: 'browsing',
      anchor: { rowID: 'row-1', offset: -8, seq: 1 },
      viewportSnapshot: {
        listKey: 'a:mine', geometryKey: '2:hash:', firstItemIndex: 999_998,
        state: { scrollTop: 120, ranges: [{ startIndex: 0, endIndex: 1, size: 84 }] },
      },
    });
    const first = sessions.read('a');
    first.viewportSnapshot.state.ranges[0].size = 999;
    expect(sessions.read('a').viewportSnapshot).toEqual({
      listKey: 'a:mine', geometryKey: '2:hash:', firstItemIndex: 999_998,
      state: { scrollTop: 120, ranges: [{ startIndex: 0, endIndex: 1, size: 84 }] },
    });
  });

  it('discards physical measurements when the semantic session follows the tail', () => {
    const sessions = createViewSessionStore();
    sessions.writeConversation('a', {
      mode: 'browsing',
      anchor: { rowID: 'row-1', offset: -8, seq: 1 },
      viewportSnapshot: {
        listKey: 'a:mine', geometryKey: '2:hash:', firstItemIndex: 999_998,
        state: { scrollTop: 120, ranges: [{ startIndex: 0, endIndex: 1, size: 84 }] },
      },
    });
    sessions.writeConversation('a', { mode: 'following', anchor: null });

    expect(sessions.read('a').viewportSnapshot).toBeNull();
  });
});
