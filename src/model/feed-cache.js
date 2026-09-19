import Dexie from 'dexie';
import { diagnostic } from './diagnostics.js';

const DB_NAME = 'atoll-feed-v9';
const GLOBAL_META_ID = 'global';
export const FEED_CACHE_ROWS_PER_CHANNEL = 5_000;
export const FEED_CACHE_GLOBAL_BYTES = 256 * 1024 * 1024;
export const FEED_CACHE_BATCH_SIZE = 200;
export const FEED_CACHE_BATCH_BYTES = 4 * 1024 * 1024;
const SENSITIVE_FIELD = /^(password|secret|secret_hash|token|access_token|refresh_token|private_key|key|credential)$/i;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export function redactFeedSecrets(value, key = '') {
  if (key && SENSITIVE_FIELD.test(key)) return '已隐藏';
  if (Array.isArray(value)) return value.map((item) => redactFeedSecrets(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactFeedSecrets(item, name)]));
  }
  return value;
}

export function resumeSnapshot(source) {
  const entries = source instanceof Map ? [...source] : Object.entries(source || {});
  return Object.fromEntries(entries.flatMap(([channelId, value]) => {
    const coverageHigh = normalizeCoverage(value?.coverage).reduce((high, interval) => Math.max(high, interval.highSeq), 0);
    const seq = Math.max(Number(value?.newestSeq ?? 0), coverageHigh);
    return Number.isSafeInteger(seq) && seq > 0 ? [[channelId, seq]] : [];
  }));
}

function encodedRecord(channelId, seq, envelope) {
  const redacted = redactFeedSecrets(envelope);
  const bytes = new TextEncoder().encode(JSON.stringify(redacted)).byteLength;
  return {
	channelId, seq, envelope: redacted, bytes,
	activity: Number(envelope?.ts) || Date.now(),
	parentId: String(envelope?.parent_id || ''),
  };
}

async function encodeRecords(rows = []) {
  const records = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    records.push(encodedRecord(row.channelId, row.seq, row.envelope));
    // Redaction and JSON sizing of large tool payloads are main-thread work.
    // Yield between small chunks so realtime/input tasks are not trapped behind
    // a complete history page or live burst.
    if (index > 0 && index % 16 === 0) await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  }
  return records;
}

function normalizeMeta(value = {}) {
  return {
    channelId: value.channelId || '',
    oldestSeq: Number(value.oldestSeq) || 0,
    newestSeq: Number(value.newestSeq) || 0,
    rowCount: Number(value.rowCount) || 0,
    bytes: Number(value.bytes) || 0,
    lastActivity: Number(value.lastActivity) || 0,
    coverage: normalizeCoverage(value.coverage),
  };
}

function normalizeCoverage(intervals = []) {
  const ordered = (Array.isArray(intervals) ? intervals : [])
    .map((entry) => ({ lowSeq: Number(entry?.lowSeq) || 0, highSeq: Number(entry?.highSeq) || 0 }))
    .filter((entry) => entry.lowSeq > 0 && entry.highSeq >= entry.lowSeq)
    .sort((left, right) => left.lowSeq - right.lowSeq);
  const merged = [];
  for (const interval of ordered) {
    const previous = merged.at(-1);
    if (previous && interval.lowSeq <= previous.highSeq + 1) previous.highSeq = Math.max(previous.highSeq, interval.highSeq);
    else merged.push({ ...interval });
  }
  return merged.slice(-64);
}

function chunksOf(records, maxRows = FEED_CACHE_BATCH_SIZE, maxBytes = FEED_CACHE_BATCH_BYTES) {
  const chunks = [];
  let current = [];
  let bytes = 0;
  for (const record of records) {
    if (current.length && (current.length >= maxRows || bytes + record.bytes > maxBytes)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(record);
    bytes += record.bytes;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

export function createFeedCache({
  indexedDBImpl = globalThis.indexedDB,
  IDBKeyRangeImpl = globalThis.IDBKeyRange,
  rowsPerChannel = FEED_CACHE_ROWS_PER_CHANNEL,
  globalBytes = FEED_CACHE_GLOBAL_BYTES,
  databaseName = DB_NAME,
} = {}) {
  const meta = new Map();
  let database = null;
  let openPromise = null;
  let writeTail = Promise.resolve();
  let pendingRecords = [];
  let pendingCoverage = [];
  let pendingWaiters = [];
  let flushTimer = null;
  let owner = '';
  let ownerSelection = null;
  let destroyed = false;
  let persistenceEpoch = 0;
  let persistenceCancellation = deferred();
  void persistenceCancellation.promise.catch(() => {});
  const activeWriteTransactions = new Set();

  function assertPersistenceEpoch(selectedEpoch) {
    if (selectedEpoch !== persistenceEpoch) throw new Error('本地缓存写入世界已取消');
  }

  async function runWriteTransaction(selectedEpoch, tables, operation) {
    const record = { transaction: null, settled: deferred() };
    activeWriteTransactions.add(record);
    try {
      const selectedDatabase = database;
      return await selectedDatabase.transaction('rw', ...tables, async () => {
        record.transaction = Dexie.currentTransaction;
        if (selectedEpoch !== persistenceEpoch) {
          record.transaction?.abort();
          throw new Error('本地缓存写入世界已取消');
        }
        return operation();
      });
    } finally {
      activeWriteTransactions.delete(record);
      record.settled.resolve();
    }
  }

  function open() {
    if (destroyed) return Promise.resolve(null);
    if (openPromise) return openPromise;
    if (!indexedDBImpl || !IDBKeyRangeImpl) {
      diagnostic('warn', 'feed_cache.unavailable', { databaseName });
      openPromise = Promise.resolve(null);
      return openPromise;
    }
    database = new Dexie(databaseName, { indexedDB: indexedDBImpl, IDBKeyRange: IDBKeyRangeImpl });
    database.version(1).stores({
	  rows: '&[channelId+seq], [channelId+parentId], channelId, seq, activity',
      channelMeta: '&channelId, lastActivity, newestSeq',
      globalMeta: '&id',
    });
    const openingDatabase = database;
    openPromise = openingDatabase.open().then(async () => {
      const rows = await openingDatabase.channelMeta.toArray();
      // A cancelled owner selection may close this instance and install a new
      // one while the old open/read is still settling. Never publish the old
      // world's metadata into the process-local authority.
      if (database !== openingDatabase) return null;
      for (const row of rows) meta.set(row.channelId, normalizeMeta(row));
      diagnostic('info', 'feed_cache.meta_ready', { databaseName, channels: meta.size });
      return openingDatabase;
    }).catch((error) => {
      diagnostic('error', 'feed_cache.open_failed', { databaseName, error });
      if (database === openingDatabase) database = null;
      throw error;
    });
    return openPromise;
  }

  async function oldestKeys(channelId, count) {
    if (!count) return [];
    return database.rows
      .where('[channelId+seq]')
      .between([channelId, Dexie.minKey], [channelId, Dexie.maxKey])
      .limit(count)
      .primaryKeys();
  }

  async function trimChannel(channelId, count, currentValue = null) {
    if (count <= 0) return { reclaimed: 0, removedRows: 0, meta: null };
    const keys = await oldestKeys(channelId, count);
    if (!keys.length) return { reclaimed: 0, removedRows: 0, meta: null };
    const removed = await database.rows.bulkGet(keys);
    await database.rows.bulkDelete(keys);
    // The transaction's channelMeta row is the authority while a commit is in
    // progress. The process-local Map is only a post-commit publication and
    // must never be used as mutable transaction state.
    const current = normalizeMeta(currentValue || await database.channelMeta.get(channelId));
    current.channelId = channelId;
    const reclaimed = removed.reduce((sum, row) => sum + (Number(row?.bytes) || 0), 0);
    const first = await database.rows
      .where('[channelId+seq]')
      .between([channelId, Dexie.minKey], [channelId, Dexie.maxKey])
      .first();
    current.rowCount = Math.max(0, current.rowCount - keys.length);
    current.bytes = Math.max(0, current.bytes - reclaimed);
    current.oldestSeq = first?.seq || 0;
    if (!current.rowCount) current.newestSeq = 0;
    current.coverage = current.oldestSeq
      ? normalizeCoverage(current.coverage.map((entry) => ({ lowSeq: Math.max(entry.lowSeq, current.oldestSeq), highSeq: entry.highSeq })))
      : [];
    await database.channelMeta.put(current);
    return { reclaimed, removedRows: keys.length, meta: current };
  }

  async function trimGlobal(selectedEpoch = persistenceEpoch) {
    while (true) {
      let committedMeta = null;
      let stillOverLimit = false;
      await runWriteTransaction(selectedEpoch, [database.rows, database.channelMeta, database.globalMeta], async () => {
        const global = await database.globalMeta.get(GLOBAL_META_ID)
          || { id: GLOBAL_META_ID, totalBytes: 0, schemaVersion: 2, serverBoot: '' };
        if (global.totalBytes <= globalBytes) return;
        const channel = (await database.channelMeta.toArray())
          .map(normalizeMeta)
          .filter((entry) => entry.rowCount > 0)
          .sort((left, right) => left.lastActivity - right.lastActivity)[0];
        if (!channel) return;
        const trimmed = await trimChannel(
          channel.channelId,
          Math.min(FEED_CACHE_BATCH_SIZE, channel.rowCount),
          channel,
        );
        if (!trimmed.removedRows) return;
        global.totalBytes = Math.max(0, global.totalBytes - trimmed.reclaimed);
        await database.globalMeta.put(global);
        committedMeta = trimmed.meta;
        stillOverLimit = global.totalBytes > globalBytes;
      });
      assertPersistenceEpoch(selectedEpoch);
      if (committedMeta) meta.set(committedMeta.channelId, normalizeMeta(committedMeta));
      if (!committedMeta || !stillOverLimit) break;
    }
  }

  async function persist(records, coverageByChannel = new Map(), selectedEpoch = persistenceEpoch) {
	if (!(await open())) return;
	assertPersistenceEpoch(selectedEpoch);
	const byChannel = new Map();
	for (const row of records) {
	  if (!byChannel.has(row.channelId)) byChannel.set(row.channelId, []);
	  byChannel.get(row.channelId).push(row);
    }
    for (const [channelId, incoming] of byChannel) {
      let committedMeta = null;
      let committedAddedBytes = 0;
      let committedAddedRows = 0;
      await runWriteTransaction(selectedEpoch, [database.rows, database.channelMeta, database.globalMeta], async () => {
        const current = normalizeMeta(await database.channelMeta.get(channelId));
		current.channelId = channelId;
        let addedBytes = 0;
        let addedRows = 0;
        const uniqueIncoming = [...new Map(incoming.map((record) => [record.seq, record])).values()];
        const previousRows = await database.rows.bulkGet(uniqueIncoming.map((record) => [channelId, record.seq]));
        const writes = [];
        for (let index = 0; index < uniqueIncoming.length; index += 1) {
          const record = uniqueIncoming[index];
          const previous = previousRows[index];
          // The disk cache is a strict latest-tail FIFO. Older network history
          // remains in the bounded in-memory reservoir once the FIFO is full.
          if (!previous && current.rowCount >= rowsPerChannel && current.oldestSeq && record.seq < current.oldestSeq) continue;
          writes.push(record);
          if (!previous) {
            current.rowCount += 1;
            addedRows += 1;
            addedBytes += record.bytes;
            current.bytes += record.bytes;
          } else {
            const delta = record.bytes - (Number(previous.bytes) || 0);
            addedBytes += delta;
            current.bytes += delta;
          }
          current.oldestSeq = current.oldestSeq ? Math.min(current.oldestSeq, record.seq) : record.seq;
          current.newestSeq = Math.max(current.newestSeq, record.seq);
          current.lastActivity = Math.max(current.lastActivity, record.activity);
        }
        if (writes.length) await database.rows.bulkPut(writes);
        const coverage = coverageByChannel.get?.(channelId) || coverageByChannel[channelId];
        if (writes.length && coverage) current.coverage = normalizeCoverage([...current.coverage, coverage]);
        await database.channelMeta.put(current);
        const global = await database.globalMeta.get(GLOBAL_META_ID) || { id: GLOBAL_META_ID, totalBytes: 0, schemaVersion: 2, serverBoot: '' };
        global.totalBytes = Math.max(0, (Number(global.totalBytes) || 0) + addedBytes);
        if (current.rowCount > rowsPerChannel) {
          const trimmed = await trimChannel(channelId, current.rowCount - rowsPerChannel, current);
          global.totalBytes = Math.max(0, global.totalBytes - trimmed.reclaimed);
          committedMeta = trimmed.meta;
        }
        await database.globalMeta.put(global);
        committedMeta ||= current;
        committedAddedBytes = addedBytes;
        committedAddedRows = addedRows;
      });
      assertPersistenceEpoch(selectedEpoch);
      meta.set(channelId, normalizeMeta(committedMeta));
      diagnostic('debug', 'feed_cache.batch_written', {
        channelId, rows: committedAddedRows, bytes: committedAddedBytes,
      });
    }
	// A valid projection page may contain zero displayable rows (for example a
	// range consisting entirely of housekeeping). Its scan coverage is still a
	// durable fact and prevents treating that gap as unknown after restart.
	const coverageEntries = coverageByChannel instanceof Map
	  ? [...coverageByChannel]
	  : Object.entries(coverageByChannel || {});
	for (const [channelId, coverage] of coverageEntries) {
	  if (!channelId || !coverage || byChannel.has(channelId)) continue;
	  let committedMeta = null;
	  await runWriteTransaction(selectedEpoch, [database.channelMeta], async () => {
		const current = normalizeMeta(await database.channelMeta.get(channelId));
		current.channelId = channelId;
		// A checkpoint can legitimately cover a zero-fact interval newer than
		// every cached row. Keep that proof intact. Only clip the low edge when
		// the interval crosses the retained FIFO: seqs older than oldestSeq may
		// have contained evicted visible facts and therefore are not cached.
		const lowSeq = Number(coverage.lowSeq) || 0;
		const highSeq = Number(coverage.highSeq) || 0;
		const bounded = current.oldestSeq && lowSeq <= current.newestSeq
		  ? { lowSeq: Math.max(lowSeq, current.oldestSeq), highSeq }
		  : { lowSeq, highSeq };
		current.coverage = normalizeCoverage([...current.coverage, bounded]);
		await database.channelMeta.put(current);
		committedMeta = current;
	  });
	  assertPersistenceEpoch(selectedEpoch);
	  meta.set(channelId, normalizeMeta(committedMeta));
	}
    await trimGlobal(selectedEpoch);
  }

  async function writeBatch(rawRows, coverageEntries, selectedEpoch = persistenceEpoch) {
	const assertCurrent = () => assertPersistenceEpoch(selectedEpoch);
	const records = await encodeRecords(rawRows);
	assertCurrent();
	const coverageByChannel = new Map();
	for (const [channelId, coverage] of coverageEntries) {
	  if (!channelId || !coverage) continue;
	  coverageByChannel.set(channelId, [...(coverageByChannel.get(channelId) || []), coverage]);
	}
	const compactCoverage = [...coverageByChannel].flatMap(([channelId, intervals]) => (
	  normalizeCoverage(intervals).map((coverage) => [channelId, coverage])
	));
	try {
	  for (const chunk of chunksOf(records)) {
		assertCurrent();
		await persist(chunk, new Map(), selectedEpoch);
	  }
	  // Coverage is committed only after every corresponding fact queued ahead
	  // of it. A crash may cause a harmless refetch, never a false cache hit.
	  for (const [channelId, coverage] of compactCoverage) {
		assertCurrent();
		await persist([], new Map([[channelId, coverage]]), selectedEpoch);
	  }
	} catch (error) {
	  diagnostic('error', 'feed_cache.write_failed', { records: records.length, error });
	  if (error?.name !== 'QuotaExceededError' || !database) throw error;
	  for (const channelId of new Set(records.map((row) => row.channelId))) {
		assertCurrent();
		const current = normalizeMeta(await database.channelMeta.get(channelId));
		assertCurrent();
		let remaining = Math.max(1, Math.ceil((current?.rowCount || 0) / 2));
		while (remaining > 0) {
		  const count = Math.min(FEED_CACHE_BATCH_SIZE, remaining);
		  let committedMeta = null;
		  await runWriteTransaction(selectedEpoch, [database.rows, database.channelMeta, database.globalMeta], async () => {
			const durable = normalizeMeta(await database.channelMeta.get(channelId));
			const trimmed = await trimChannel(channelId, count, durable);
			const global = await database.globalMeta.get(GLOBAL_META_ID)
			  || { id: GLOBAL_META_ID, totalBytes: 0, schemaVersion: 2 };
			global.totalBytes = Math.max(0, Number(global.totalBytes || 0) - trimmed.reclaimed);
			await database.globalMeta.put(global);
			committedMeta = trimmed.meta;
		  });
		  assertCurrent();
		  if (committedMeta) meta.set(channelId, normalizeMeta(committedMeta));
		  remaining -= count;
		}
	  }
	  for (const chunk of chunksOf(records)) {
		assertCurrent();
		await persist(chunk, new Map(), selectedEpoch);
	  }
	  for (const [channelId, coverage] of compactCoverage) {
		assertCurrent();
		await persist([], new Map([[channelId, coverage]]), selectedEpoch);
	  }
	}
  }

  function flushPending() {
	if (flushTimer != null) clearTimeout(flushTimer);
	flushTimer = null;
	if (!pendingRecords.length && !pendingCoverage.length) return writeTail;
	const records = pendingRecords;
	const coverageEntries = pendingCoverage;
	const waiters = pendingWaiters;
	pendingRecords = [];
	pendingCoverage = [];
	pendingWaiters = [];
	const selectedEpoch = persistenceEpoch;
	const selectedCancellation = persistenceCancellation.promise;
	const work = writeTail.catch(() => {}).then(() => writeBatch(records, coverageEntries, selectedEpoch));
	const operation = Promise.race([work, selectedCancellation]);
	writeTail = operation;
	void operation.then(
	  () => waiters.forEach((waiter) => waiter.resolve()),
	  (error) => waiters.forEach((waiter) => waiter.reject(error)),
	);
	return operation;
  }

  function saveRows(rows, { coverageByChannel = new Map() } = {}) {
    if (destroyed) return Promise.resolve();
    const records = (rows || []).flatMap((row) => {
      const channelId = row?.channel_id;
      const seq = Number(row?.seq);
      return channelId && Number.isSafeInteger(seq) && seq > 0 ? [{ channelId, seq, envelope: row.envelope }] : [];
    });
	const coverageEntries = coverageByChannel instanceof Map
	  ? [...coverageByChannel]
	  : Object.entries(coverageByChannel || {});
	if (!records.length && !coverageEntries.length) return writeTail;
	pendingRecords.push(...records);
	pendingCoverage.push(...coverageEntries);
	const queued = new Promise((resolve, reject) => pendingWaiters.push({ resolve, reject }));
	if (flushTimer == null) flushTimer = setTimeout(flushPending, 10);
	return queued;
  }

  async function readBefore(channelId, beforeSeq = 0, limit = FEED_CACHE_BATCH_SIZE, byteLimit = FEED_CACHE_BATCH_BYTES) {
    if (!(await open())) return { rows: [], nextBeforeSeq: beforeSeq, exhausted: true, bytes: 0 };
    const channel = meta.get(channelId);
    const frontier = beforeSeq > 0 ? beforeSeq - 1 : Number(channel?.newestSeq || 0);
    const interval = (channel?.coverage || []).find((entry) => entry.lowSeq <= frontier && entry.highSeq >= frontier);
    if (!interval) {
      diagnostic('debug', 'feed_cache.coverage_miss', { channelId, beforeSeq, frontier });
      return { rows: [], nextBeforeSeq: beforeSeq, exhausted: true, cacheMiss: true, bytes: 0 };
    }
    const upper = beforeSeq > 0 ? beforeSeq : interval.highSeq + 1;
    const records = await database.rows
      .where('[channelId+seq]')
      .between([channelId, interval.lowSeq], [channelId, upper], true, false)
      .reverse()
      .limit(Math.max(1, limit))
      .toArray();
    const selected = [];
    let bytes = 0;
    for (const record of records) {
      if (selected.length && bytes + record.bytes > byteLimit) break;
      selected.push(record);
      bytes += Number(record.bytes) || 0;
    }
    selected.reverse();
    const oldest = selected[0]?.seq || interval.lowSeq;
    const exhausted = !selected.length || oldest <= interval.lowSeq;
    diagnostic('debug', 'feed_cache.batch_read', { channelId, beforeSeq, rows: selected.length, bytes, exhausted });
    return {
      rows: selected.map((row) => ({ channel_id: channelId, seq: row.seq, envelope: row.envelope })),
      nextBeforeSeq: oldest,
      exhausted,
      scanLowSeq: interval.lowSeq,
      scanHighSeq: Math.min(frontier, interval.highSeq),
      bytes,
    };
  }

  // Restore only the raw ledger context needed to classify facts newer than a
  // durable read cursor. The query walks backwards in the same bounded pages
  // as ordinary history. It stops once the unread suffix is covered and every
  // referenced parent request is present; a trimmed/missing parent leaves the
  // result explicitly incomplete instead of turning an empty Replica into a
  // false zero badge.
  async function readNotificationContext(channelId, afterSeq = 0, {
    limit = FEED_CACHE_BATCH_SIZE,
    byteLimit = FEED_CACHE_BATCH_BYTES,
    isCurrent = () => true,
  } = {}) {
    const cursor = Math.max(0, Number(afterSeq) || 0);
    const collected = new Map();
    const tail = new Map();
    let beforeSeq = 0;
    let boundaryReached = false;
    let cacheMiss = false;
    let exhausted = false;
    let batches = 0;
    const batchLimit = Math.max(1, Number(limit) || FEED_CACHE_BATCH_SIZE);
    const maximumBatches = Math.ceil(Math.max(1, rowsPerChannel) / batchLimit) + 1;

    const context = () => {
      const unread = [...collected.values()].filter((row) => Number(row.seq) > cursor);
      const required = new Set(unread.map((row) => String(row.envelope?.parent_id || '')).filter(Boolean));
      let changed = true;
      while (changed) {
        changed = false;
        for (const row of collected.values()) {
          const id = String(row.envelope?.id || '');
          if (!id || !required.has(id)) continue;
          const parent = String(row.envelope?.parent_id || '');
          if (parent && !required.has(parent)) {
            required.add(parent);
            changed = true;
          }
        }
      }
      const available = new Set([...collected.values()].map((row) => String(row.envelope?.id || '')).filter(Boolean));
      const missingParents = [...required].filter((id) => !available.has(id));
      return { unread, required, missingParents };
    };

    while (batches < maximumBatches) {
      if (!isCurrent()) return { rows: [], complete: false, cancelled: true, missingParents: [] };
      const page = await readBefore(channelId, beforeSeq, batchLimit, byteLimit);
      if (!isCurrent()) return { rows: [], complete: false, cancelled: true, missingParents: [] };
      batches += 1;
      cacheMiss = Boolean(page.cacheMiss);
      exhausted = Boolean(page.exhausted);
      for (const row of page.rows || []) {
        collected.set(Number(row.seq), row);
        if (batches === 1) tail.set(Number(row.seq), row);
      }
      const nextBeforeSeq = Number(page.nextBeforeSeq) || 0;
      boundaryReached = boundaryReached
        || (nextBeforeSeq > 0 && nextBeforeSeq <= cursor + 1)
        || (Number(page.scanLowSeq) > 0 && Number(page.scanLowSeq) <= cursor + 1 && exhausted);
      const currentContext = context();
      if (boundaryReached && currentContext.missingParents.length === 0) break;
      if (cacheMiss || exhausted || nextBeforeSeq <= 0 || (beforeSeq > 0 && nextBeforeSeq >= beforeSeq)) break;
      beforeSeq = nextBeforeSeq;
    }

    const { unread, required, missingParents } = context();
    // Keep the newest ordinary cache page intact. This is the same bounded
    // tail the history scheduler would initially reveal when the channel is
    // opened, so notification hydration neither creates a sparse one-row
    // presentation nor advances into older history. Older pages contribute
    // only lifecycle context for unread roots.
    const selected = new Map(tail);
    for (const row of unread) selected.set(Number(row.seq), row);
    for (const row of collected.values()) {
      const id = String(row.envelope?.id || '');
      const parent = String(row.envelope?.parent_id || '');
      if ((id && required.has(id)) || (parent && required.has(parent))) selected.set(Number(row.seq), row);
    }
    const complete = boundaryReached && missingParents.length === 0 && !cacheMiss;
    return {
      rows: [...selected.values()].sort((left, right) => Number(left.seq) - Number(right.seq)),
      complete,
      cancelled: false,
      missingParents,
      boundaryReached,
      exhausted,
      batches,
    };
  }

  async function ensureBoot(serverBoot = '') {
	// Finish the previous connection's ordered journal before deciding whether
	// this server boot owns it. If the boot changed, the transaction below then
	// clears the complete old world; no delayed write can resurrect it.
	await flushPending().catch(() => {});
    if (!(await open()) || !serverBoot) return { changed: false, meta: new Map(meta) };
    let changed = false;
    await database.transaction('rw', database.rows, database.channelMeta, database.globalMeta, async () => {
      const global = await database.globalMeta.get(GLOBAL_META_ID)
        || { id: GLOBAL_META_ID, totalBytes: 0, schemaVersion: 2, serverBoot: '', owner };
      // A cache containing rows without a world identity is not assignable to
      // whichever server happens to answer next. Treat it exactly like a boot
      // mismatch. Clearing conservatively can cause a refetch; adopting it can
      // make a false resume claim and permanently hide ledger rows.
      const hasData = Number(global.totalBytes || 0) > 0
        || await database.rows.count() > 0
        || await database.channelMeta.count() > 0;
      if (hasData && global.serverBoot !== serverBoot) {
        await database.rows.clear();
        await database.channelMeta.clear();
        global.totalBytes = 0;
        changed = true;
      }
      global.serverBoot = serverBoot;
      global.owner = owner || global.owner || '';
      global.schemaVersion = 2;
      await database.globalMeta.put(global);
    });
    if (changed) {
      meta.clear();
      diagnostic('warn', 'feed_cache.boot_reset', { databaseName, serverBoot });
    }
    return { changed, boot: serverBoot, meta: new Map([...meta].map(([id, value]) => [id, { ...value }])) };
  }

  async function ensureOwner(principalId) {
    const requested = String(principalId || '');
    if (!requested) return { changed: false, meta: new Map() };
    const selection = { cancelled: false, transaction: null, cancellation: deferred() };
    void selection.cancellation.promise.catch(() => {});
    ownerSelection = selection;
    try {
      await Promise.race([flushPending().catch(() => {}), selection.cancellation.promise]);
      if (selection.cancelled) throw new Error('本地缓存所有者选择已取消');
      if (!(await Promise.race([open(), selection.cancellation.promise]))) return { changed: false, meta: new Map() };
      if (selection.cancelled) throw new Error('本地缓存所有者选择已取消');
      let changed = false;
      let boot = '';
      await database.transaction('rw', database.rows, database.channelMeta, database.globalMeta, async () => {
      selection.transaction = Dexie.currentTransaction;
      if (selection.cancelled) selection.transaction?.abort();
      const global = await database.globalMeta.get(GLOBAL_META_ID)
        || { id: GLOBAL_META_ID, totalBytes: 0, schemaVersion: 2, serverBoot: '', owner: '' };
      const previous = String(global.owner || '');
      if (previous && previous !== requested) {
        await database.rows.clear();
        await database.channelMeta.clear();
        global.totalBytes = 0;
        changed = true;
      }
      global.owner = requested;
      global.schemaVersion = 2;
      boot = String(global.serverBoot || '');
      await database.globalMeta.put(global);
      });
      if (selection.cancelled) throw new Error('本地缓存所有者选择已取消');
      owner = requested;
      if (changed) meta.clear();
      return { changed, boot, meta: new Map([...meta].map(([id, value]) => [id, { ...value }])) };
    } finally {
      if (ownerSelection === selection) ownerSelection = null;
    }
  }

  async function cancelOwnerSelection() {
    const selection = ownerSelection;
    if (!selection || selection.cancelled) return false;
    selection.cancelled = true;
    const cancellationError = new Error('本地缓存所有者选择已取消');
    persistenceEpoch += 1;
    const activeTransactions = [...activeWriteTransactions];
    for (const record of activeTransactions) {
      try { record.transaction?.abort(); } catch { /* cancellation is best-effort */ }
    }
    try { selection.transaction?.abort(); } catch { /* cancellation is best-effort */ }
    // Opening IndexedDB can itself stall before a transaction exists. Closing
    // the selected Dexie instance rejects that open without authorizing a new
    // world to overtake a still-live owner transaction.
    if (!selection.transaction && database) {
      try { database.close(); } catch { /* cancellation is best-effort */ }
      database = null;
      openPromise = null;
    }
    // Do not unlock the persistence fence until every transaction that could
    // mutate the preceding world has physically committed or rolled back.
    // Pre-transaction encode/open work is fenced by persistenceEpoch before it
    // may enter a transaction; active transactions are aborted and joined.
    await Promise.all(activeTransactions.map((record) => record.settled.promise));
    persistenceCancellation.reject(cancellationError);
    persistenceCancellation = deferred();
    void persistenceCancellation.promise.catch(() => {});
    selection.cancellation.reject(cancellationError);
    return true;
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    persistenceEpoch += 1;
    const error = new Error('本地缓存生命周期已结束');
    if (flushTimer != null) clearTimeout(flushTimer);
    flushTimer = null;
    pendingRecords = [];
    pendingCoverage = [];
    for (const waiter of pendingWaiters) waiter.reject(error);
    pendingWaiters = [];
    persistenceCancellation.reject(error);
    persistenceCancellation = deferred();
    void persistenceCancellation.promise.catch(() => {});
    if (ownerSelection && !ownerSelection.cancelled) {
      ownerSelection.cancelled = true;
      ownerSelection.cancellation.reject(error);
    }
    for (const record of activeWriteTransactions) {
      try { record.transaction?.abort(); } catch { /* lifecycle release is best-effort */ }
    }
    try { database?.close(); } catch { /* lifecycle release is best-effort */ }
    database = null;
    openPromise = null;
    owner = '';
    meta.clear();
  }

  return {
    ensureOwner,
    cancelOwnerSelection,
    destroy,
    metaSnapshot: () => new Map([...meta].map(([id, value]) => [id, { ...value }])),
    readBefore,
    readNotificationContext,
    saveRows,
    saveCoverage(channelId, lowSeq, highSeq) {
      if (!channelId || !Number.isSafeInteger(lowSeq) || !Number.isSafeInteger(highSeq) || lowSeq <= 0 || highSeq < lowSeq) return writeTail;
      return saveRows([], { coverageByChannel: new Map([[channelId, { lowSeq, highSeq }]]) });
    },
    ensureBoot,
    async clear() {
	  flushPending();
      await writeTail.catch(() => {});
      if (!(await open())) return;
      await database.transaction('rw', database.rows, database.channelMeta, database.globalMeta, async () => {
        await Promise.all([database.rows.clear(), database.channelMeta.clear(), database.globalMeta.clear()]);
      });
      meta.clear();
      diagnostic('info', 'feed_cache.cleared', { databaseName });
    },
    async idle() { await flushPending(); },
  };
}
