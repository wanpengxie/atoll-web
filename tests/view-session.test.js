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
    });
    expect(sessions.read('b')).toEqual({ mode: 'following', anchor: null, unseenTail: 0, scope: 'mine', actorFilter: [], foldOverrides: [] });
  });

  it('merges semantic reading position with Surface and Context state', () => {
    const sessions = createViewSessionStore();
    sessions.writeConversation('a', { mode: 'browsing', anchor: { rowID: 'turn-8', offset: -12, seq: 8 }, unseenTail: 3 });
    sessions.writeConversation('a', { scope: 'all' });
    sessions.writeSurface('a', 'tasks');
    sessions.writeContext('a', { kind: 'artifact', key: 'file-1', sourceRowID: 'turn-8' });

    expect(sessions.readSession('a')).toEqual({
      primarySurface: 'tasks',
      context: { kind: 'artifact', key: 'file-1', sourceRowID: 'turn-8' },
      conversation: {
        mode: 'browsing',
        anchor: { rowID: 'turn-8', offset: -12, seq: 8 },
        unseenTail: 3,
        scope: 'all',
        actorFilter: [],
        foldOverrides: [],
      },
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
});
