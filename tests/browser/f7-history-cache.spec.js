import { expect, test } from '@playwright/test';

test('F7 IndexedDB cache keeps the newest bounded tail and recovers from quota pressure', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createFeedCache } = await import('/src/model/feed-cache.js');
    const databaseName = `atoll-feed-browser-${Date.now()}`;
    const options = { databaseName, rowsPerChannel: 8, globalBytes: 1024 * 1024, legacyStorage: null };
    const envelope = (seq) => ({
      id: `m-${seq}`,
      kind: 'event',
      type: 'human.note',
      sender: { kind: 'human', id: 'human:root:1' },
      visibility: 'public',
      payload: { text: `message ${seq}`, token: `secret-${seq}` },
    });

    const cache = createFeedCache(options);
    await cache.openMeta();
    await cache.saveRows(Array.from({ length: 8 }, (_, index) => ({ channel_id: 'c0', seq: index + 1, envelope: envelope(index + 1) })));
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
    try {
      await cache.saveRows([{ channel_id: 'c0', seq: 9, envelope: envelope(9) }]);
      await cache.idle();
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    await cache.saveRows(Array.from({ length: 6 }, (_, index) => ({ channel_id: 'c0', seq: index + 10, envelope: envelope(index + 10) })));
    await cache.saveCoverage('c0', 1, 15);
    await cache.idle();

    const restored = createFeedCache(options);
    const page = await restored.readBefore('c0', 0, 200, 4 * 1024 * 1024);
    const rows = new Map(page.rows.map((row) => [row.seq, row.envelope]));
    return {
      failed,
      seqs: [...rows.keys()],
      token: rows.get(15)?.payload?.token,
    };
  });

  expect(result).toEqual({ failed: true, seqs: [8, 9, 10, 11, 12, 13, 14, 15], token: '已隐藏' });
});
