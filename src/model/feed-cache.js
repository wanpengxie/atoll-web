import Dexie from 'dexie';
import { diagnostic } from './diagnostics.js';

const DB_NAME = 'atoll-feed-v7';
const LEGACY_PREFIX = 'atoll.feed.v5.';
const GLOBAL_META_ID = 'global';
export const FEED_CACHE_ROWS_PER_CHANNEL = 5_000;
export const FEED_CACHE_GLOBAL_BYTES = 256 * 1024 * 1024;
export const FEED_CACHE_BATCH_SIZE = 200;
export const FEED_CACHE_BATCH_BYTES = 4 * 1024 * 1024;
const SENSITIVE_FIELD = /^(password|secret|secret_hash|token|access_token|refresh_token|private_key|key|credential)$/i;

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
    const seq = Number(value?.newestSeq ?? value?.newest_seq ?? value?.lastSeq ?? 0);
    return Number.isSafeInteger(seq) && seq > 0 ? [[channelId, seq]] : [];
  }));
}

function removeLegacy(storage) {
  if (!storage) return;
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(LEGACY_PREFIX)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

function encodedRecord(channelId, seq, envelope) {
  const redacted = redactFeedSecrets(envelope);
  const bytes = new TextEncoder().encode(JSON.stringify(redacted)).byteLength;
  return { channelId, seq, envelope: redacted, bytes, activity: Number(envelope?.ts) || Date.now() };
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
  legacyStorage = globalThis.localStorage,
  rowsPerChannel = FEED_CACHE_ROWS_PER_CHANNEL,
  globalBytes = FEED_CACHE_GLOBAL_BYTES,
  databaseName = DB_NAME,
} = {}) {
  const meta = new Map();
  let database = null;
  let openPromise = null;
  let writeTail = Promise.resolve();

  function open() {
    if (openPromise) return openPromise;
    removeLegacy(legacyStorage);
    if (!indexedDBImpl || !IDBKeyRangeImpl) {
      diagnostic('warn', 'feed_cache.unavailable', { databaseName });
      openPromise = Promise.resolve(null);
      return openPromise;
    }
    database = new Dexie(databaseName, { indexedDB: indexedDBImpl, IDBKeyRange: IDBKeyRangeImpl });
    database.version(1).stores({
      rows: '&[channelId+seq], channelId, seq, activity',
      channelMeta: '&channelId, lastActivity, newestSeq',
      globalMeta: '&id',
    });
    openPromise = database.open().then(async () => {
      const rows = await database.channelMeta.toArray();
      for (const row of rows) meta.set(row.channelId, normalizeMeta(row));
      diagnostic('info', 'feed_cache.meta_ready', { databaseName, channels: meta.size });
      return database;
    }).catch((error) => {
      diagnostic('error', 'feed_cache.open_failed', { databaseName, error });
      database = null;
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

  async function trimChannel(channelId, count) {
    if (count <= 0) return 0;
    const keys = await oldestKeys(channelId, count);
    if (!keys.length) return 0;
    const removed = await database.rows.bulkGet(keys);
    await database.rows.bulkDelete(keys);
    const current = normalizeMeta(meta.get(channelId));
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
    meta.set(channelId, current);
    await database.channelMeta.put(current);
    return reclaimed;
  }

  async function trimGlobal() {
    const global = await database.globalMeta.get(GLOBAL_META_ID) || { id: GLOBAL_META_ID, totalBytes: 0, schemaVersion: 1, serverBoot: '' };
    if (global.totalBytes <= globalBytes) return;
    while (global.totalBytes > globalBytes) {
      const channel = [...meta.values()].filter((entry) => entry.rowCount > 0).sort((left, right) => left.lastActivity - right.lastActivity)[0];
      if (!channel) break;
      const reclaimed = await database.transaction('rw', database.rows, database.channelMeta, async () => trimChannel(channel.channelId, Math.min(FEED_CACHE_BATCH_SIZE, channel.rowCount)));
      if (!reclaimed) break;
      global.totalBytes = Math.max(0, global.totalBytes - reclaimed);
    }
    await database.globalMeta.put(global);
  }

  async function persist(records, coverageByChannel = new Map()) {
	if (!(await open())) return;
	const byChannel = new Map();
	for (const row of records) {
	  if (!byChannel.has(row.channelId)) byChannel.set(row.channelId, []);
	  byChannel.get(row.channelId).push(row);
	}
    for (const [channelId, incoming] of byChannel) {
      await database.transaction('rw', database.rows, database.channelMeta, database.globalMeta, async () => {
        const current = normalizeMeta(meta.get(channelId));
		current.channelId = channelId;
        let addedBytes = 0;
        let addedRows = 0;
        let wroteAny = false;
        for (const record of incoming) {
          // The disk cache is a strict latest-tail FIFO. Older network history
          // remains in the bounded in-memory reservoir once the FIFO is full.
          if (current.rowCount >= rowsPerChannel && current.oldestSeq && record.seq < current.oldestSeq) continue;
          const previous = await database.rows.get([channelId, record.seq]);
          await database.rows.put(record);
          wroteAny = true;
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
        const coverage = coverageByChannel.get?.(channelId) || coverageByChannel[channelId];
        if (wroteAny && coverage) current.coverage = normalizeCoverage([...current.coverage, coverage]);
        else if (wroteAny) current.coverage = normalizeCoverage([
          ...current.coverage,
          ...incoming.map((record) => ({ lowSeq: record.seq, highSeq: record.seq })),
        ]);
        meta.set(channelId, current);
        await database.channelMeta.put(current);
        const global = await database.globalMeta.get(GLOBAL_META_ID) || { id: GLOBAL_META_ID, totalBytes: 0, schemaVersion: 1, serverBoot: '' };
        global.totalBytes = Math.max(0, (Number(global.totalBytes) || 0) + addedBytes);
        if (current.rowCount > rowsPerChannel) {
          const reclaimed = await trimChannel(channelId, current.rowCount - rowsPerChannel);
          global.totalBytes = Math.max(0, global.totalBytes - reclaimed);
        }
        await database.globalMeta.put(global);
        diagnostic('debug', 'feed_cache.batch_written', { channelId, rows: addedRows, bytes: addedBytes });
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
	  await database.transaction('rw', database.channelMeta, async () => {
		const current = normalizeMeta(meta.get(channelId));
		current.channelId = channelId;
		current.coverage = normalizeCoverage([...current.coverage, coverage]);
		meta.set(channelId, current);
		await database.channelMeta.put(current);
	  });
	}
    await trimGlobal();
  }

  function saveRows(rows, { coverageByChannel = new Map() } = {}) {
    const records = (rows || []).flatMap((row) => {
      const channelId = row?.channel_id;
      const seq = Number(row?.seq);
      return channelId && Number.isSafeInteger(seq) && seq > 0 ? [encodedRecord(channelId, seq, row.envelope)] : [];
    });
	const hasCoverage = coverageByChannel instanceof Map
	  ? coverageByChannel.size > 0
	  : Object.keys(coverageByChannel || {}).length > 0;
	if (!records.length && !hasCoverage) return writeTail;
    writeTail = writeTail.then(async () => {
	  const chunks = chunksOf(records);
	  if (!chunks.length) await persist([], coverageByChannel);
	  else {
		for (const chunk of chunks) await persist(chunk);
		if (hasCoverage) await persist([], coverageByChannel);
	  }
    }).catch(async (error) => {
      diagnostic('error', 'feed_cache.write_failed', { records: records.length, error });
      if (error?.name !== 'QuotaExceededError' || !database) throw error;
      for (const channelId of new Set(records.map((row) => row.channelId))) {
        const current = meta.get(channelId);
        let remaining = Math.max(1, Math.ceil((current?.rowCount || 0) / 2));
        let reclaimed = 0;
        while (remaining > 0) {
          const count = Math.min(FEED_CACHE_BATCH_SIZE, remaining);
          reclaimed += await database.transaction('rw', database.rows, database.channelMeta, async () => trimChannel(channelId, count));
          remaining -= count;
        }
        const global = await database.globalMeta.get(GLOBAL_META_ID) || { id: GLOBAL_META_ID, totalBytes: 0, schemaVersion: 1 };
        global.totalBytes = Math.max(0, Number(global.totalBytes || 0) - reclaimed);
        await database.globalMeta.put(global);
      }
	  for (const chunk of chunksOf(records)) await persist(chunk);
	  if (hasCoverage) await persist([], coverageByChannel);
    });
    return writeTail;
  }

  async function readBefore(channelId, beforeSeq = 0, limit = FEED_CACHE_BATCH_SIZE, byteLimit = FEED_CACHE_BATCH_BYTES) {
    if (!(await open())) return { rows: [], nextBeforeSeq: beforeSeq, exhausted: true, bytes: 0 };
    const upper = beforeSeq > 0 ? beforeSeq : Dexie.maxKey;
    const records = await database.rows
      .where('[channelId+seq]')
      .between([channelId, Dexie.minKey], [channelId, upper], true, beforeSeq <= 0)
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
    const oldest = selected[0]?.seq || beforeSeq || 0;
    const channel = meta.get(channelId);
    const exhausted = !selected.length || !channel?.oldestSeq || oldest <= channel.oldestSeq;
    diagnostic('debug', 'feed_cache.batch_read', { channelId, beforeSeq, rows: selected.length, bytes, exhausted });
    return {
      rows: selected.map((row) => ({ channel_id: channelId, seq: row.seq, envelope: row.envelope })),
      nextBeforeSeq: oldest,
      exhausted,
      bytes,
    };
  }

  async function ensureBoot(serverBoot = '') {
    if (!(await open()) || !serverBoot) return { changed: false, meta: new Map(meta) };
    let changed = false;
    await database.transaction('rw', database.rows, database.channelMeta, database.globalMeta, async () => {
      const global = await database.globalMeta.get(GLOBAL_META_ID)
        || { id: GLOBAL_META_ID, totalBytes: 0, schemaVersion: 1, serverBoot: '' };
      if (global.serverBoot && global.serverBoot !== serverBoot) {
        await database.rows.clear();
        await database.channelMeta.clear();
        global.totalBytes = 0;
        changed = true;
      }
      global.serverBoot = serverBoot;
      global.schemaVersion = 1;
      await database.globalMeta.put(global);
    });
    if (changed) {
      meta.clear();
      diagnostic('warn', 'feed_cache.boot_reset', { databaseName, serverBoot });
    }
    return { changed, meta: new Map([...meta].map(([id, value]) => [id, { ...value }])) };
  }

  return {
    openMeta: async () => { await open(); return new Map([...meta].map(([id, value]) => [id, { ...value }])); },
    metaSnapshot: () => new Map([...meta].map(([id, value]) => [id, { ...value }])),
    readBefore,
    saveRows,
    ensureBoot,
    // Compatibility during the atomic v4 cutover: metadata only, never bodies.
    async restore() { await open(); return new Map(); },
    async clear() {
      await writeTail.catch(() => {});
      if (!(await open())) return;
      await database.transaction('rw', database.rows, database.channelMeta, database.globalMeta, async () => {
        await Promise.all([database.rows.clear(), database.channelMeta.clear(), database.globalMeta.clear()]);
      });
      meta.clear();
      diagnostic('info', 'feed_cache.cleared', { databaseName });
    },
    async idle() { await writeTail; },
  };
}
