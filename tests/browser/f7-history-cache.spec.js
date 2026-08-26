import { expect, test } from '@playwright/test';

test('F7 IndexedDB cache keeps the newest bounded tail and recovers from quota pressure', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createFeedCache } = await import('/src/model/feed-cache.js');
    const databaseName = `atoll-feed-browser-${Date.now()}`;
    const options = { databaseName, rowsPerChannel: 8, globalBytes: 1024 * 1024, legacyStorage: null };
    const state = { channelId: 'c0', rows: new Map() };
    const envelope = (seq) => ({
      id: `m-${seq}`,
      kind: 'event',
      type: 'human.note',
      sender: { kind: 'human', id: 'human:root:1' },
      visibility: 'public',
      payload: { text: `message ${seq}`, token: `secret-${seq}` },
    });

    const cache = createFeedCache(options);
    await cache.restore();
    for (let seq = 1; seq <= 8; seq += 1) state.rows.set(seq, envelope(seq));
    await cache.save(state);
    await cache.idle();

    // Force the next row write to hit the browser's real QuotaExceededError
    // branch once. The cache must trim the oldest half and retry the append.
    const originalPut = IDBObjectStore.prototype.put;
    let failed = false;
    IDBObjectStore.prototype.put = function put(value, ...args) {
      if (!failed && this.name === 'rows' && value?.seq === 9) {
        failed = true;
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return originalPut.call(this, value, ...args);
    };
    state.rows.set(9, envelope(9));
    try {
      await cache.save(state);
      await cache.idle();
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    for (let seq = 10; seq <= 15; seq += 1) state.rows.set(seq, envelope(seq));
    await cache.save(state);
    await cache.idle();

    const restored = await createFeedCache(options).restore();
    const rows = restored.get('c0')?.rows || new Map();
    return {
      failed,
      seqs: [...rows.keys()],
      token: rows.get(15)?.payload?.token,
    };
  });

  expect(result).toEqual({ failed: true, seqs: [8, 9, 10, 11, 12, 13, 14, 15], token: '已隐藏' });
});
