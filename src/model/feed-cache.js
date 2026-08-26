import { apply, createChannelState } from './fold.js';
import { diagnostic } from './diagnostics.js';

const DB_NAME = 'atoll-feed-v6';
const DB_VERSION = 1;
const ROWS = 'rows';
const META = 'meta';
const LEGACY_PREFIX = 'atoll.feed.v5.';
export const FEED_CACHE_ROWS_PER_CHANNEL = 5_000;
export const FEED_CACHE_GLOBAL_BYTES = 256 * 1024 * 1024;
const SENSITIVE_FIELD = /^(password|secret|secret_hash|token|access_token|refresh_token|private_key|key|credential)$/i;

export function redactFeedSecrets(value, key = '') {
  if (key && SENSITIVE_FIELD.test(key)) return '已隐藏';
  if (Array.isArray(value)) return value.map((item) => redactFeedSecrets(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactFeedSecrets(item, name)]));
  }
  return value;
}

export function resumeSnapshot(states) {
  return Object.fromEntries(
    [...(states || new Map())]
      .filter(([, state]) => Number.isSafeInteger(state?.lastSeq) && state.lastSeq > 0)
      .map(([channelId, state]) => [channelId, state.lastSeq]),
  );
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
  });
}

function openDatabase(indexedDBImpl, databaseName) {
  if (!indexedDBImpl) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDBImpl.open(databaseName, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ROWS)) db.createObjectStore(ROWS, { keyPath: ['channelId', 'seq'] });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'channelId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    request.onblocked = () => diagnostic('warn', 'feed_cache.open_blocked', { databaseName, version: DB_VERSION });
  });
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

function rowKey(channelId, seq) { return `${channelId}:${seq}`; }

export function createFeedCache({
  indexedDBImpl = globalThis.indexedDB,
  legacyStorage = globalThis.localStorage,
  rowsPerChannel = FEED_CACHE_ROWS_PER_CHANNEL,
  globalBytes = FEED_CACHE_GLOBAL_BYTES,
  databaseName = DB_NAME,
} = {}) {
  let dbPromise = null;
  let restored = false;
  let flushPromise = null;
  const known = new Map();
  const bytes = new Map();
  const activity = new Map();
  const pending = new Map();

  function db() {
    if (!dbPromise) dbPromise = openDatabase(indexedDBImpl, databaseName);
    return dbPromise;
  }

  function remember(record) {
    let seqs = known.get(record.channelId);
    if (!seqs) {
      seqs = new Set();
      known.set(record.channelId, seqs);
    }
    seqs.add(record.seq);
    bytes.set(rowKey(record.channelId, record.seq), Number(record.bytes) || 0);
  }

  async function deleteRows(channelId, seqs) {
    if (!seqs.length) return;
    const database = await db();
    if (!database) return;
    const tx = database.transaction([ROWS], 'readwrite');
    const store = tx.objectStore(ROWS);
    for (const seq of seqs) store.delete([channelId, seq]);
    await transactionDone(tx);
    const current = known.get(channelId);
    for (const seq of seqs) {
      current?.delete(seq);
      bytes.delete(rowKey(channelId, seq));
    }
  }

  async function trimChannel(channelId, keep = rowsPerChannel) {
    const seqs = [...(known.get(channelId) || [])].sort((left, right) => left - right);
    if (seqs.length <= keep) return;
    await deleteRows(channelId, seqs.slice(0, seqs.length - keep));
  }

  function totalBytes() {
    let total = 0;
    for (const value of bytes.values()) total += value;
    return total;
  }

  async function trimGlobal() {
    let total = totalBytes();
    if (total <= globalBytes) return;
    const channels = [...known.keys()].sort((left, right) => (activity.get(left) || 0) - (activity.get(right) || 0));
    for (const channelId of channels) {
      if (total <= globalBytes) break;
      const seqs = [...(known.get(channelId) || [])].sort((left, right) => left - right);
      const remove = seqs.slice(0, Math.max(1, Math.ceil(seqs.length / 2)));
      let reclaimed = 0;
      for (const seq of remove) reclaimed += bytes.get(rowKey(channelId, seq)) || 0;
      await deleteRows(channelId, remove);
      total -= reclaimed;
    }
  }

  async function write(records) {
    const database = await db();
    if (!database || !records.length) return;
    const tx = database.transaction([ROWS, META], 'readwrite');
    const rows = tx.objectStore(ROWS);
    const meta = tx.objectStore(META);
    const touched = new Set();
    for (const record of records) {
      rows.put(record);
      touched.add(record.channelId);
    }
    for (const channelId of touched) {
      const channelRecords = records.filter((record) => record.channelId === channelId);
      const lastSeq = Math.max(...channelRecords.map((record) => record.seq));
      meta.put({ channelId, lastSeq, lastActivity: activity.get(channelId) || Date.now() });
    }
    await transactionDone(tx);
    for (const record of records) remember(record);
  }

  async function flush() {
    const records = [...pending.values()];
    pending.clear();
    if (!records.length) return;
    try {
      await write(records);
    } catch (error) {
      if (error?.name !== 'QuotaExceededError') {
        diagnostic('error', 'feed_cache.write_failed', { records: records.length, error });
        throw error;
      }
      diagnostic('warn', 'feed_cache.quota_exceeded', { records: records.length, knownRows: bytes.size, totalBytes: totalBytes() });
      for (const channelId of new Set(records.map((record) => record.channelId))) {
        const count = known.get(channelId)?.size || 0;
        await trimChannel(channelId, Math.floor(count / 2));
      }
      await write(records);
    }
    for (const channelId of new Set(records.map((record) => record.channelId))) await trimChannel(channelId);
    await trimGlobal();
  }

  function scheduleFlush() {
    if (!flushPromise) {
      flushPromise = Promise.resolve().then(flush).finally(() => { flushPromise = null; });
    }
    return flushPromise;
  }

  return {
    async restore() {
      removeLegacy(legacyStorage);
      const states = new Map();
      const database = await db();
      if (!database) {
        restored = true;
        diagnostic('warn', 'feed_cache.unavailable', { databaseName });
        return states;
      }
      const tx = database.transaction([ROWS, META], 'readonly');
      const rowRecords = await requestResult(tx.objectStore(ROWS).getAll());
      const metas = await requestResult(tx.objectStore(META).getAll());
      await transactionDone(tx);
      for (const meta of metas) activity.set(meta.channelId, Number(meta.lastActivity) || 0);
      rowRecords.sort((left, right) => left.channelId.localeCompare(right.channelId) || left.seq - right.seq);
      for (const record of rowRecords) {
        remember(record);
        let state = states.get(record.channelId);
        if (!state) {
          state = createChannelState(record.channelId);
          states.set(record.channelId, state);
        }
        apply(state, { channel_id: record.channelId, seq: record.seq, envelope: record.envelope });
      }
      restored = true;
      diagnostic('info', 'feed_cache.restored', { databaseName, channels: states.size, rows: rowRecords.length, bytes: totalBytes() });
      return states;
    },

    save(state) {
      if (!state?.channelId) return Promise.resolve();
      activity.set(state.channelId, Date.now());
      for (const [seq, envelope] of state.rows) {
        if (known.get(state.channelId)?.has(seq) || pending.has(rowKey(state.channelId, seq))) continue;
        const redacted = redactFeedSecrets(envelope);
        const serialized = JSON.stringify(redacted);
        pending.set(rowKey(state.channelId, seq), {
          channelId: state.channelId,
          seq,
          envelope: redacted,
          bytes: new Blob([serialized]).size,
        });
      }
      return restored ? scheduleFlush() : Promise.resolve();
    },

    async clear() {
      pending.clear();
      // Serialize destructive generation reset after any already-started append.
      // The wire is closed before this call, so no new saves may enter; waiting
      // here guarantees an old transaction cannot repopulate the stores after
      // the clear transaction commits.
      if (flushPromise) {
        try { await flushPromise; }
        catch (error) { diagnostic('warn', 'feed_cache.stale_flush_failed_during_clear', { error }); }
      }
      known.clear();
      bytes.clear();
      activity.clear();
      const database = await db();
      if (!database) return;
      const tx = database.transaction([ROWS, META], 'readwrite');
      tx.objectStore(ROWS).clear();
      tx.objectStore(META).clear();
      await transactionDone(tx);
      diagnostic('info', 'feed_cache.cleared', { databaseName });
    },

    async idle() {
      await flushPromise;
    },
  };
}
