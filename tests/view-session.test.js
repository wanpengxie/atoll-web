import { describe, expect, it } from 'vitest';
import { createViewSessionStore } from '../src/model/view-session.js';

class MemoryStorage {
  data = new Map();
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
}

describe('view session ownership', () => {
  it('separates channel choices from filtered-view reading state', () => {
    const store = createViewSessionStore();
    store.writeConversation('c0', { scope: 'all', actorFilter: ['b', 'a', 'a'] });
    expect(store.read('c0')).toMatchObject({ scope: 'all', actorFilter: ['a', 'b'], mode: 'following' });
    expect(store.activate('c0', 'all:a', 'activation-1')).toMatchObject({ mode: 'following', bookmark: null });
  });

  it('prevents an old activation from overwriting a newer A→B→A session', () => {
    const store = createViewSessionStore();
    const first = store.activate('c0', 'all', 'old');
    store.activate('c0', 'mine', 'middle');
    const latest = store.activate('c0', 'all', 'new');
    expect(store.save('c0', 'all', 'old', first.revision, { mode: 'browsing', bookmark: { messageID: 'old' } })).toBe(false);
    expect(store.save('c0', 'all', 'new', latest.revision, { mode: 'browsing', bookmark: { messageID: 'new' } })).toBe(true);
    expect(store.readView('c0', 'all').bookmark.messageID).toBe('new');
  });

  it('keeps a browsing bookmark only for this page session and starts a new page at latest', () => {
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

  it('does not let a second page overwrite this page session position', () => {
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

  it('uses revision compare-and-swap inside the current activation', () => {
    const store = createViewSessionStore();
    const saved = store.activate('c0', 'all', 'a1');
    expect(store.save('c0', 'all', 'a1', saved.revision, { mode: 'browsing', bookmark: { messageID: 'm1' } })).toBe(true);
    expect(store.save('c0', 'all', 'a1', saved.revision, { mode: 'browsing', bookmark: { messageID: 'stale' } })).toBe(false);
  });

  it('does not forget unseen stable identities past the former 256-key boundary', () => {
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

  it('migrates viewport unseen state from finite records and discards legacy derived surplus', () => {
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
    const restored = store.readView('c0', 'all');
    expect(restored).toMatchObject({
      revision: 7,
      mode: 'following',
      bookmark: null,
      unseenTail: 2,
    });
    expect(restored.unseenKeys).toEqual(['valid-a', 'valid-without-key']);
    expect(restored.unseenRecords).toEqual([['valid-a', 6], ['valid-without-key', 5]]);
    expect(store.read('c0')).toMatchObject({
      scope: 'all', actorFilter: ['agent:a:1'], foldOverrides: [['fold-1', true]],
    });
  });

  it('drops count-only and key-only viewport unseen state at the storage boundary', () => {
    const storage = new MemoryStorage();
    storage.setItem('atoll.view-session.v2.me', JSON.stringify({
      schema: 2,
      preferences: {},
      readings: {
        'c0\u0000all': {
          revision: 3,
          mode: 'browsing',
          bookmark: { messageID: 'bookmark-2' },
          unseenTail: 3,
          unseenKeys: ['legacy-only'],
        },
      },
    }));

    const restored = createViewSessionStore({ principalID: 'me', storage }).readView('c0', 'all');
    expect(restored).toMatchObject({
      revision: 3,
      mode: 'following',
      bookmark: null,
      unseenTail: 0,
      unseenKeys: [],
      unseenRecords: [],
    });
  });
});
