import { describe, expect, it } from 'vitest';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { createFeedCache, redactFeedSecrets, resumeSnapshot } from '../src/model/feed-cache.js';

class MemoryStorage {
  constructor() { this.data = new Map(); }
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}

function envelope(id, text) {
  return {
    id, ts: 1, channel_id: 'c0', sender: { kind: 'human', id: 'root' },
    kind: 'request', type: 'agent.ask', payload: { text }, visibility: 'public', audience: ['steward'],
  };
}

describe('feed cache', () => {
	it('derives the resume cursor from lightweight channel metadata', () => {
	expect(resumeSnapshot(new Map([['c0', { newestSeq: 7 }]]))).toEqual({ c0: 7 });
	expect(resumeSnapshot(new Map([['quiet', { newestSeq: 7, coverage: [{ lowSeq: 8, highSeq: 20 }] }]]))).toEqual({ quiet: 20 });
  });

  it('removes the unbounded localStorage v5 cache during IndexedDB migration', async () => {
    const storage = new MemoryStorage();
    storage.setItem('atoll.feed.v5.c0', '[{"stale":true}]');
    storage.setItem('unrelated', 'keep');
	const restored = await createFeedCache({ indexedDBImpl: null, IDBKeyRangeImpl: null, legacyStorage: storage }).restore();
    expect(restored.size).toBe(0);
    expect(storage.getItem('atoll.feed.v5.c0')).toBeNull();
    expect(storage.getItem('unrelated')).toBe('keep');
  });

  it('redacts device keys and nested credentials before IndexedDB persistence', () => {
    const value = redactFeedSecrets({ device_id: 'd1', key: 'one-time-key', nested: { token: 'token-value' } });
    const saved = JSON.stringify(value);
    expect(saved).not.toContain('one-time-key');
    expect(saved).not.toContain('token-value');
    expect(saved).toContain('已隐藏');
  });

	it('reads rows by reverse cursor in bounded batches and never restores bodies wholesale', async () => {
	const cache = createFeedCache({
	  indexedDBImpl: indexedDB, IDBKeyRangeImpl: IDBKeyRange,
	  databaseName: `feed-cache-batch-${crypto.randomUUID()}`,
	});
	await cache.openMeta();
	await cache.saveRows(Array.from({ length: 450 }, (_, index) => ({
	  channel_id: 'c0', seq: index + 1, envelope: envelope(`m-${index + 1}`, `row ${index + 1}`),
	})));
	await cache.saveCoverage('c0', 1, 450);
	await cache.idle();
	const newest = await cache.readBefore('c0', 0, 200);
	expect(newest.rows).toHaveLength(200);
	expect(newest.rows[0].seq).toBe(251);
	expect(newest.nextBeforeSeq).toBe(251);
	const older = await cache.readBefore('c0', newest.nextBeforeSeq, 200);
	expect(older.rows[0].seq).toBe(51);
	expect(older.rows.at(-1).seq).toBe(250);
	expect((await cache.restore()).size).toBe(0);
  });

	it('keeps a transactional per-channel FIFO of the latest rows', async () => {
	const cache = createFeedCache({
	  indexedDBImpl: indexedDB, IDBKeyRangeImpl: IDBKeyRange,
	  databaseName: `feed-cache-fifo-${crypto.randomUUID()}`,
	  rowsPerChannel: 5,
	});
	await cache.openMeta();
	await cache.saveRows(Array.from({ length: 8 }, (_, index) => ({
	  channel_id: 'c0', seq: index + 1, envelope: envelope(`m-${index + 1}`, `row ${index + 1}`),
	})));
	await cache.saveCoverage('c0', 1, 8);
	await cache.idle();
	const batch = await cache.readBefore('c0', 0, 20);
	expect(batch.rows.map((row) => row.seq)).toEqual([4, 5, 6, 7, 8]);
	expect(cache.metaSnapshot().get('c0')).toMatchObject({ oldestSeq: 4, newestSeq: 8, rowCount: 5 });
  });

  it('persists empty projected scan coverage and resets IndexedDB on boot change', async () => {
	const databaseName = `feed-cache-boot-${crypto.randomUUID()}`;
	const cache = createFeedCache({ indexedDBImpl: indexedDB, IDBKeyRangeImpl: IDBKeyRange, databaseName });
	await cache.openMeta();
	await cache.ensureBoot('boot-a');
	await cache.saveRows([{ channel_id: 'c0', seq: 10, envelope: envelope('m-10', 'ten') }]);
	await cache.saveCoverage('c0', 10, 10);
	await cache.saveRows([], { coverageByChannel: new Map([['quiet', { lowSeq: 20, highSeq: 40 }]]) });
	await cache.idle();
	expect(cache.metaSnapshot().get('quiet')?.coverage).toEqual([{ lowSeq: 20, highSeq: 40 }]);
	expect((await cache.readBefore('c0', 0, 20)).rows).toHaveLength(1);
	// Leave an old-generation journal batch queued. ensureBoot must flush it
	// before clearing, so its timer cannot resurrect rows after the reset.
	void cache.saveRows([{ channel_id: 'c0', seq: 11, envelope: envelope('m-11', 'eleven') }]);
	void cache.saveCoverage('c0', 11, 11);
	await expect(cache.ensureBoot('boot-b')).resolves.toMatchObject({ changed: true });
	expect((await cache.readBefore('c0', 0, 20)).rows).toHaveLength(0);
	expect(cache.metaSnapshot().size).toBe(0);
  });

	it('keeps a newer zero-fact checkpoint without claiming an unknown gap', async () => {
	  const cache = createFeedCache({
		indexedDBImpl: indexedDB, IDBKeyRangeImpl: IDBKeyRange,
		databaseName: `feed-cache-zero-fact-${crypto.randomUUID()}`,
	  });
	  await cache.openMeta();
	  await cache.saveRows([{ channel_id: 'c0', seq: 10, envelope: envelope('m-10', 'ten') }]);
	  await cache.saveCoverage('c0', 10, 10);
	  await cache.saveCoverage('c0', 20, 40);
	  await cache.idle();
	  expect(cache.metaSnapshot().get('c0')?.coverage).toEqual([
		{ lowSeq: 10, highSeq: 10 },
		{ lowSeq: 20, highSeq: 40 },
	  ]);
	  await expect(cache.readBefore('c0', 41, 20)).resolves.toMatchObject({
		rows: [], nextBeforeSeq: 20, exhausted: true, scanLowSeq: 20, scanHighSeq: 40,
	  });
	  await expect(cache.readBefore('c0', 20, 20)).resolves.toMatchObject({ cacheMiss: true, nextBeforeSeq: 20 });
	});

});
