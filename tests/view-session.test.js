import { describe, expect, it } from 'vitest';
import { createViewSessionStore } from '../src/model/view-session.js';

class MemoryStorage {
  data = new Map();
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
}

describe('view session ownership', () => {
  it.skip('separates channel choices from filtered-view reading state', () => {
    const store = createViewSessionStore();
    store.writeConversation('c0', { scope: 'all', actorFilter: ['b', 'a', 'a'] });
    expect(store.read('c0')).toMatchObject({ scope: 'all', actorFilter: ['a', 'b'], mode: 'following' });
    expect(store.activate('c0', 'all:a', 'activation-1')).toMatchObject({ mode: 'following', bookmark: null });
  });

  it.skip('prevents an old activation from overwriting a newer A→B→A session', () => {
    const store = createViewSessionStore();
    const first = store.activate('c0', 'all', 'old');
    store.activate('c0', 'mine', 'middle');
    const latest = store.activate('c0', 'all', 'new');
    expect(store.save('c0', 'all', 'old', first.revision, { mode: 'browsing', bookmark: { messageID: 'old' } })).toBe(false);
    expect(store.save('c0', 'all', 'new', latest.revision, { mode: 'browsing', bookmark: { messageID: 'new' } })).toBe(true);
    expect(store.readView('c0', 'all').bookmark.messageID).toBe('new');
  });

  it.skip('keeps a browsing bookmark only for this page session and starts a new page at latest', () => {
    const storage = new MemoryStorage();
    const currentPage = createViewSessionStore({ principalID: 'me', storage });
    const first = currentPage.activate('c0', 'all', 'page-a');
    expect(currentPage.save('c0', 'all', 'page-a', first.revision, {
      mode: 'browsing',
      bookmark: { messageID: 'middle-row', rowViewportOffset: -18 },
    })).toBe(true);

    expect(currentPage.readView('c0', 'all')).toMatchObject({
      mode: 'browsing',
      bookmark: { messageID: 'middle-row', rowViewportOffset: -18 },
    });
    expect(createViewSessionStore({ principalID: 'me', storage }).readView('c0', 'all')).toMatchObject({
      mode: 'following',
      bookmark: null,
    });
  });

  it.skip('does not let a second page overwrite this page session position', () => {
    const storage = new MemoryStorage();
    const firstPage = createViewSessionStore({ principalID: 'me', storage });
    const first = firstPage.activate('c0', 'all', 'page-a');
    expect(firstPage.save('c0', 'all', 'page-a', first.revision, {
      mode: 'browsing', bookmark: { messageID: 'page-a-row' },
    })).toBe(true);

    const secondPage = createViewSessionStore({ principalID: 'me', storage });
    const second = secondPage.activate('c0', 'all', 'page-b');
    expect(second).toMatchObject({ mode: 'following', bookmark: null });
    expect(secondPage.save('c0', 'all', 'page-b', second.revision, {
      mode: 'browsing', bookmark: { messageID: 'page-b-row' }, unseenRecords: [['new-row', 9]],
    })).toBe(true);

    expect(firstPage.readView('c0', 'all')).toMatchObject({
      revision: second.revision + 1,
      mode: 'browsing',
      bookmark: { messageID: 'page-a-row' },
      unseenRecords: [['new-row', 9]],
    });
  });

  it.skip('uses revision compare-and-swap inside the current activation', () => {
    const store = createViewSessionStore();
    const saved = store.activate('c0', 'all', 'a1');
    expect(store.save('c0', 'all', 'a1', saved.revision, { mode: 'browsing', bookmark: { messageID: 'm1' } })).toBe(true);
    expect(store.save('c0', 'all', 'a1', saved.revision, { mode: 'browsing', bookmark: { messageID: 'stale' } })).toBe(false);
  });

  it.skip('keeps a newer exact-incarnation actor filter across an old mount write, but allows removal', () => {
    const storage = new MemoryStorage();
    storage.setItem('atoll.view-session.v3.me', JSON.stringify({
      schema: 3,
      preferences: { c0: { scope: 'mine', actorFilter: [] } },
      readings: {},
    }));
    const store = createViewSessionStore({ principalID: 'me', storage });
    const oldSnapshot = store.read('c0');
    const exactIncarnation = 'agent:steward:old-incarnation';
    storage.setItem('atoll.view-session.v3.me', JSON.stringify({
      schema: 3,
      preferences: { c0: { scope: 'mine', actorFilter: [exactIncarnation] } },
      readings: {},
    }));

    expect(store.writeConversation('c0', {
      scope: oldSnapshot.scope,
      actorFilter: oldSnapshot.actorFilter,
    })).toBe(true);
    expect(store.read('c0').actorFilter).toEqual([exactIncarnation]);

    // Reading-state persistence from that same old mount must preserve the
    // newer preference too; persistence writes one v3 record for both domains.
    storage.setItem('atoll.view-session.v3.me', JSON.stringify({
      schema: 3,
      preferences: { c0: { scope: 'mine', actorFilter: [] } },
      readings: {},
    }));
    const staleReader = createViewSessionStore({ principalID: 'me', storage });
    const activation = staleReader.activate('c0', 'conversation', 'old-mount');
    storage.setItem('atoll.view-session.v3.me', JSON.stringify({
      schema: 3,
      preferences: { c0: { scope: 'mine', actorFilter: [exactIncarnation] } },
      readings: {},
    }));
    expect(staleReader.save('c0', 'conversation', 'old-mount', activation.revision, {
      mode: 'following',
    })).toBe(true);
    expect(staleReader.read('c0').actorFilter).toEqual([exactIncarnation]);

    expect(staleReader.writeConversation('c0', { actorFilter: [] })).toBe(true);
    expect(staleReader.read('c0').actorFilter).toEqual([]);
    expect(storage.getItem('atoll.view-session.v2.me')).toBeNull();
  });

  it.skip('does not forget unseen stable identities past the former 256-key boundary', () => {
    const storage = new MemoryStorage();
    const store = createViewSessionStore({ principalID: 'me', storage });
    const saved = store.activate('c0', 'all', 'a1');
    const unseenKeys = Array.from({ length: 300 }, (_, index) => `live-${index}`);
    const unseenRecords = unseenKeys.map((key, index) => [key, index + 1]);
    expect(store.save('c0', 'all', 'a1', saved.revision, {
      mode: 'browsing', unseenTail: unseenKeys.length, unseenKeys, unseenRecords,
    })).toBe(true);

    const restored = createViewSessionStore({ principalID: 'me', storage }).readView('c0', 'all');
    expect(restored.unseenTail).toBe(300);
    expect(restored.unseenKeys).toEqual(unseenKeys);
    expect(restored.unseenRecords).toEqual(unseenRecords);
  });

  it.skip('ignores the retired v2 storage schema', () => {
    const storage = new MemoryStorage();
    storage.setItem('atoll.view-session.v2.me', JSON.stringify({
      schema: 2,
      preferences: {
        c0: { scope: 'all', actorFilter: ['agent:a:1'], foldOverrides: [['fold-1', true]] },
      },
      readings: {
        'c0\u0000all': {
          revision: 7,
          mode: 'browsing',
          bookmark: { messageID: 'bookmark-1', rowViewportOffset: 24 },
          unseenTail: 9,
          unseenKeys: ['valid-a', 'legacy-only'],
          unseenRecords: [
            ['valid-a', 4],
            ['valid-a', 6],
            ['valid-without-key', 5],
            ['invalid-zero', 0],
            ['invalid-infinity', Number.POSITIVE_INFINITY],
          ],
        },
      },
    }));

    const store = createViewSessionStore({ principalID: 'me', storage });
    expect(store.readView('c0', 'all')).toMatchObject({ revision: 0, mode: 'following', unseenTail: 0 });
    expect(store.read('c0')).toMatchObject({ scope: 'mine', actorFilter: [], foldOverrides: [] });
  });
});
