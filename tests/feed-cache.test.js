import { describe, expect, it, vi } from 'vitest';
import { indexedDB, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
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
	it('publishes in-memory Meta only after its IndexedDB transaction commits', async () => {
	  const databaseName = `feed-cache-meta-commit-${crypto.randomUUID()}`;
	  const cache = createFeedCache({ indexedDBImpl: indexedDB, IDBKeyRangeImpl: IDBKeyRange, databaseName });
	  await cache.openMeta();
	  const originalPut = IDBObjectStore.prototype.put;
	  let failed = false;
	  IDBObjectStore.prototype.put = function put(value, ...args) {
		if (!failed && this.name === 'globalMeta' && value?.id === 'global') {
		  failed = true;
		  throw new Error('injected globalMeta failure');
		}
		return originalPut.call(this, value, ...args);
	  };
	  try {
		await expect(cache.saveRows([
		  { channel_id: 'c0', seq: 1, envelope: envelope('m-1', 'must rollback') },
		])).rejects.toThrow('injected globalMeta failure');
	  } finally {
		IDBObjectStore.prototype.put = originalPut;
	  }

	  expect(failed).toBe(true);
	  expect(cache.metaSnapshot().has('c0')).toBe(false);
	  const reopened = createFeedCache({ indexedDBImpl: indexedDB, IDBKeyRangeImpl: IDBKeyRange, databaseName });
	  expect((await reopened.openMeta()).has('c0')).toBe(false);
	  await expect(reopened.readBefore('c0', 0, 20)).resolves.toMatchObject({ rows: [], cacheMiss: true });
	});

	it('keeps the last committed Meta when global trimming rolls back', async () => {
	  const databaseName = `feed-cache-trim-rollback-${crypto.randomUUID()}`;
	  const cache = createFeedCache({
		indexedDBImpl: indexedDB,
		IDBKeyRangeImpl: IDBKeyRange,
		databaseName,
		globalBytes: 1,
	  });
	  await cache.openMeta();
	  const originalPut = IDBObjectStore.prototype.put;
	  let channelMetaPuts = 0;
	  IDBObjectStore.prototype.put = function put(value, ...args) {
		if (this.name === 'channelMeta' && value?.channelId === 'c0') {
		  channelMetaPuts += 1;
		  if (channelMetaPuts === 2) throw new Error('injected trim Meta failure');
		}
		return originalPut.call(this, value, ...args);
	  };
	  try {
		await expect(cache.saveRows([
		  { channel_id: 'c0', seq: 1, envelope: envelope('m-1', 'committed before trim') },
		])).rejects.toThrow('injected trim Meta failure');
	  } finally {
		IDBObjectStore.prototype.put = originalPut;
	  }

	  expect(cache.metaSnapshot().get('c0')).toMatchObject({
		oldestSeq: 1, newestSeq: 1, rowCount: 1,
	  });
	  const reopened = createFeedCache({ indexedDBImpl: indexedDB, IDBKeyRangeImpl: IDBKeyRange, databaseName });
	  expect((await reopened.openMeta()).get('c0')).toMatchObject({
		oldestSeq: 1, newestSeq: 1, rowCount: 1,
	  });
	  await reopened.saveCoverage('c0', 1, 1);
	  await reopened.idle();
	  expect((await reopened.readBefore('c0', 0, 20)).rows.map((row) => row.seq)).toEqual([1]);
	});

	it('does not publish zero-fact coverage when its transaction rolls back', async () => {
	  const databaseName = `feed-cache-coverage-rollback-${crypto.randomUUID()}`;
	  const cache = createFeedCache({ indexedDBImpl: indexedDB, IDBKeyRangeImpl: IDBKeyRange, databaseName });
	  await cache.openMeta();
	  const originalPut = IDBObjectStore.prototype.put;
	  IDBObjectStore.prototype.put = function put(value, ...args) {
		if (this.name === 'channelMeta' && value?.channelId === 'quiet') {
		  throw new Error('injected coverage Meta failure');
		}
		return originalPut.call(this, value, ...args);
	  };
	  try {
		await expect(cache.saveCoverage('quiet', 20, 40)).rejects.toThrow('injected coverage Meta failure');
	  } finally {
		IDBObjectStore.prototype.put = originalPut;
	  }

	  expect(cache.metaSnapshot().has('quiet')).toBe(false);
	  const reopened = createFeedCache({ indexedDBImpl: indexedDB, IDBKeyRangeImpl: IDBKeyRange, databaseName });
	  expect((await reopened.openMeta()).has('quiet')).toBe(false);
	});

	it('publishes quota-recovery trims and the retry only after each transaction commits', async () => {
	  const cache = createFeedCache({
		indexedDBImpl: indexedDB,
		IDBKeyRangeImpl: IDBKeyRange,
		databaseName: `feed-cache-quota-commit-${crypto.randomUUID()}`,
		rowsPerChannel: 8,
	  });
	  await cache.openMeta();
	  await cache.saveRows(Array.from({ length: 8 }, (_, index) => ({
		channel_id: 'c0', seq: index + 1, envelope: envelope(`m-${index + 1}`, `row ${index + 1}`),
	  })));
	  const originalPut = IDBObjectStore.prototype.put;
	  let quotaFailed = false;
	  IDBObjectStore.prototype.put = function put(value, ...args) {
		if (!quotaFailed && this.name === 'rows' && value?.seq === 9) {
		  quotaFailed = true;
		  throw new DOMException('quota', 'QuotaExceededError');
		}
		return originalPut.call(this, value, ...args);
	  };
	  try {
		await cache.saveRows([{ channel_id: 'c0', seq: 9, envelope: envelope('m-9', 'row 9') }]);
	  } finally {
		IDBObjectStore.prototype.put = originalPut;
	  }
	  await cache.saveCoverage('c0', 5, 9);
	  await cache.idle();

	  expect(quotaFailed).toBe(true);
	  expect(cache.metaSnapshot().get('c0')).toMatchObject({
		oldestSeq: 5, newestSeq: 9, rowCount: 5, coverage: [{ lowSeq: 5, highSeq: 9 }],
	  });
	  expect((await cache.readBefore('c0', 0, 20)).rows.map((row) => row.seq)).toEqual([5, 6, 7, 8, 9]);
	});

	it('does not publish a principal owner when its transaction rolls back', async () => {
	  const databaseName = `feed-cache-owner-rollback-${crypto.randomUUID()}`;
	  const options = { indexedDBImpl: indexedDB, IDBKeyRangeImpl: IDBKeyRange, databaseName };
	  const cache = createFeedCache(options);
	  await cache.ensureOwner('alice');
	  await cache.ensureBoot('boot-a');
	  await cache.saveRows([{ channel_id: 'c0', seq: 1, envelope: envelope('alice-row', 'alice') }]);
	  await cache.saveCoverage('c0', 1, 1);
	  await cache.idle();

	  const originalPut = IDBObjectStore.prototype.put;
	  IDBObjectStore.prototype.put = function put(value, ...args) {
		if (this.name === 'globalMeta' && value?.owner === 'bob') {
		  throw new Error('injected owner commit failure');
		}
		return originalPut.call(this, value, ...args);
	  };
	  try {
		await expect(cache.ensureOwner('bob')).rejects.toThrow('injected owner commit failure');
	  } finally {
		IDBObjectStore.prototype.put = originalPut;
	  }

	  // A same-boot continuation must retain the last committed owner. It must
	  // not launder the failed bob draft into durable global Meta.
	  await cache.ensureBoot('boot-a');
	  const reopened = createFeedCache(options);
	  await expect(reopened.ensureOwner('bob')).resolves.toMatchObject({ changed: true });
	  await expect(reopened.readBefore('c0', 0, 20)).resolves.toMatchObject({ rows: [] });
	});

	it('publishes zero-byte row deletion and continues global trimming', async () => {
	  const databaseName = `feed-cache-zero-byte-trim-${crypto.randomUUID()}`;
	  const cache = createFeedCache({
		indexedDBImpl: indexedDB,
		IDBKeyRangeImpl: IDBKeyRange,
		databaseName,
		globalBytes: 1,
	  });
	  const now = vi.spyOn(Date, 'now').mockReturnValue(1);
	  await cache.openMeta();
	  await cache.saveRows([{ channel_id: 'a', seq: 1, envelope: undefined }]);
	  now.mockRestore();
	  await cache.saveRows([{
		channel_id: 'b', seq: 1, envelope: { ...envelope('positive-row', 'positive'), ts: 2 },
	  }]);
	  await cache.idle();

	  expect(cache.metaSnapshot().get('a')).toMatchObject({ rowCount: 0, oldestSeq: 0, newestSeq: 0 });
	  const reopened = createFeedCache({ indexedDBImpl: indexedDB, IDBKeyRangeImpl: IDBKeyRange, databaseName });
	  expect((await reopened.openMeta()).get('a')).toMatchObject({ rowCount: 0, oldestSeq: 0, newestSeq: 0 });
	});

	it('changes principal ownership in place instead of requiring a page reload', async () => {
	  const storage = new MemoryStorage();
	  const databaseName = `feed-cache-owner-${crypto.randomUUID()}`;
	  const cache = createFeedCache({ indexedDBImpl: indexedDB, IDBKeyRangeImpl: IDBKeyRange, databaseName, legacyStorage: storage });
	  await cache.ensureOwner('alice');
	  await cache.saveRows([{ channel_id: 'c0', seq: 1, envelope: envelope('m-1', 'alice') }]);
	  await cache.saveCoverage('c0', 1, 1);
	  await cache.idle();
	  expect((await cache.readBefore('c0', 0, 20)).rows).toHaveLength(1);

	  await expect(cache.ensureOwner('bob')).resolves.toMatchObject({ changed: true });
	  expect((await cache.readBefore('c0', 0, 20)).rows).toHaveLength(0);
	});

	it('does not assign ownerless legacy rows to whichever principal opens them first', async () => {
	  const databaseName = `feed-cache-ownerless-${crypto.randomUUID()}`;
	  const cache = createFeedCache({ indexedDBImpl: indexedDB, IDBKeyRangeImpl: IDBKeyRange, databaseName });
	  await cache.openMeta();
	  await cache.saveRows([{ channel_id: 'c0', seq: 1, envelope: envelope('legacy', 'unknown owner') }]);
	  await cache.saveCoverage('c0', 1, 1);
	  await cache.idle();

	  await expect(cache.ensureOwner('alice')).resolves.toMatchObject({ changed: true });
	  expect((await cache.readBefore('c0', 0, 20)).rows).toHaveLength(0);
	});

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

	it('restores an unread suffix beyond one presentation batch with its older parent lifecycle', async () => {
	  const cache = createFeedCache({
		indexedDBImpl: indexedDB, IDBKeyRangeImpl: IDBKeyRange,
		databaseName: `feed-cache-notification-context-${crypto.randomUUID()}`,
	  });
	  const request = envelope('task-root', 'background task');
	  const rows = [
		{ channel_id: 'c0', seq: 2, envelope: request },
		{ channel_id: 'c0', seq: 3, envelope: { ...envelope('task-processing', 'processing'), kind: 'response', parent_id: request.id, payload: { status: 'processing' } } },
		...Array.from({ length: 260 }, (_, index) => ({
		  channel_id: 'c0', seq: index + 4, envelope: envelope(`noise-${index}`, `noise ${index}`),
		})),
		{ channel_id: 'c0', seq: 264, envelope: { ...envelope('task-final', 'done'), kind: 'response', parent_id: request.id, payload: { status: 'completed' } } },
	  ];
	  await cache.openMeta();
	  await cache.saveRows(rows);
	  await cache.saveCoverage('c0', 1, 264);
	  await cache.idle();

	  const restored = await cache.readNotificationContext('c0', 180, { limit: 48 });
	  expect(restored).toMatchObject({ complete: true, cancelled: false, boundaryReached: true });
	  expect(restored.batches).toBeGreaterThan(1);
	  expect(restored.rows.some((row) => row.seq === 2 && row.envelope.id === request.id)).toBe(true);
	  expect(restored.rows.some((row) => row.seq === 3 && row.envelope.id === 'task-processing')).toBe(true);
	  expect(restored.rows.some((row) => row.seq === 264 && row.envelope.id === 'task-final')).toBe(true);
	  expect(restored.rows.some((row) => row.seq === 100)).toBe(false);
	});

	it('keeps notification restoration unknown when a cached terminal has no parent request', async () => {
	  const cache = createFeedCache({
		indexedDBImpl: indexedDB, IDBKeyRangeImpl: IDBKeyRange,
		databaseName: `feed-cache-notification-missing-parent-${crypto.randomUUID()}`,
	  });
	  await cache.openMeta();
	  await cache.saveRows([{
		channel_id: 'c0', seq: 50,
		envelope: { ...envelope('orphan-final', 'done'), kind: 'response', parent_id: 'trimmed-request', payload: { status: 'completed' } },
	  }]);
	  await cache.saveCoverage('c0', 50, 50);
	  await cache.idle();

	  await expect(cache.readNotificationContext('c0', 49)).resolves.toMatchObject({
		complete: false,
		cancelled: false,
		missingParents: ['trimmed-request'],
	  });
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

  it('does not adopt unidentified cached rows into the first observed server world', async () => {
	const databaseName = `feed-cache-unidentified-world-${crypto.randomUUID()}`;
	const cache = createFeedCache({ indexedDBImpl: indexedDB, IDBKeyRangeImpl: IDBKeyRange, databaseName });
	await cache.ensureOwner('alice');
	await cache.saveRows([{ channel_id: 'c0', seq: 10, envelope: envelope('m-10', 'unknown world') }]);
	await cache.saveCoverage('c0', 10, 10);
	await cache.idle();

	await expect(cache.ensureBoot('boot-a')).resolves.toMatchObject({ changed: true, boot: 'boot-a' });
	expect(cache.metaSnapshot().size).toBe(0);
	expect((await cache.readBefore('c0', 0, 20)).rows).toHaveLength(0);
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
