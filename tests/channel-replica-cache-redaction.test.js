// @vitest-environment jsdom
import 'fake-indexeddb/auto';
// 恢复对应：tests/feed-cache.test.js（master，已删除）里的
// 'redacts device keys and nested credentials before IndexedDB persistence'。
// 旧结构 src/model/feed-cache.js 导出的纯函数 redactFeedSecrets() 在写 IndexedDB 之前
// 剥离 device key / 嵌套 token 等敏感字段。迁移到
// createChannelReplicaCache() 时 saveRows() 曾直接把整条 envelope 原样写入 rows store；
// 这组测试固定 canonical IndexedDB 行为，并覆盖重新加载与旧 row 迁移，不接受 renderer
// 遮盖或另建一份 cache 的替代实现。
import { describe, expect, it } from 'vitest';
import { createChannelReplicaCache } from '../src/model/channel-replica.js';

function rawDbEntries(databaseName, storeName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction([storeName], 'readonly');
      const getAll = tx.objectStore(storeName).getAll();
      let result;
      getAll.onsuccess = () => { result = getAll.result; };
      getAll.onerror = () => reject(getAll.error);
      tx.oncomplete = () => { db.close(); resolve(result || []); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  });
}

function rawDbRows(databaseName) {
  return rawDbEntries(databaseName, 'rows');
}

function rawDbMeta(databaseName) {
  return rawDbEntries(databaseName, 'meta');
}

function rawDbPut(databaseName, row) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['rows'], 'readwrite');
      tx.objectStore('rows').put(row);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  });
}

function rawDbMetaPut(databaseName, entry) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['meta'], 'readwrite');
      tx.objectStore('meta').put(entry);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  });
}

async function clearCache() {
  const cache = createChannelReplicaCache({ indexedDB });
  await cache.ensureOwner('root', { world: 'boot-a' });
  await cache.clear();
  await cache.destroy();
}

function sensitiveRow(seq = 1) {
  return {
    channel_id: 'c0', seq,
    envelope: {
      id: `device-attach-${seq}`, kind: 'response', type: 'device.attach',
      payload: { body: {
        device_id: 'd1', key: `one-time-key-${seq}-should-not-persist`,
        nested: { token: `token-value-${seq}-should-not-persist` },
        text: '业务字段应保留',
      } },
    },
  };
}

function expectRedactedBusinessRow(row, seq = 1) {
  expect(row).toMatchObject({
    channel_id: 'c0', seq,
    envelope: {
      id: `device-attach-${seq}`,
      payload: { body: { device_id: 'd1', key: '已隐藏', nested: { token: '已隐藏' }, text: '业务字段应保留' } },
    },
  });
  const serialized = JSON.stringify(row);
  expect(serialized).not.toContain(`one-time-key-${seq}-should-not-persist`);
  expect(serialized).not.toContain(`token-value-${seq}-should-not-persist`);
}

describe('Replica 缓存持久化前应隐藏设备密钥/凭据（恢复自 tests/feed-cache.test.js）', () => {
  it('一次性设备密钥和嵌套 token 不应该原样写进 IndexedDB', async () => {
    await clearCache();
    const cache = createChannelReplicaCache({ indexedDB });
    await cache.ensureOwner('root', { world: 'boot-a' });
    await cache.saveRows([sensitiveRow()]);

    // 直接掀开 IndexedDB 看原始持久化内容，不经过任何应用层的读路径包装——
    // 这就是磁盘上真实躺着的字节。
    const rows = await rawDbRows('atoll-channel-replica-v1');
    const persisted = JSON.stringify(rows);
    expect(persisted).not.toContain('one-time-key-1-should-not-persist');
    expect(persisted).not.toContain('token-value-1-should-not-persist');
    expect(persisted).toContain('已隐藏');
    await cache.destroy();
  });

  it('写入后重新创建 cache 仍保留业务字段且只返回脱敏值', async () => {
    await clearCache();
    const writer = createChannelReplicaCache({ indexedDB });
    await writer.ensureOwner('root', { world: 'boot-a' });
    await writer.saveRows([sensitiveRow(2)]);
    await writer.destroy();

    const reader = createChannelReplicaCache({ indexedDB });
    await reader.ensureOwner('root', { world: 'boot-a' });
    const page = await reader.readBefore('c0', 3, 10, 10_000);
    expect(page.rows).toHaveLength(1);
    expectRedactedBusinessRow(page.rows[0], 2);
    await reader.destroy();
  });

  it('旧的未脱敏 IndexedDB row 在重载时被归一化并回写 canonical rows store', async () => {
    await clearCache();
    await rawDbPut('atoll-channel-replica-v1', {
      owner: 'root\u0000boot-a', channelId: 'c0', seq: 3, row: sensitiveRow(3),
    });

    const cache = createChannelReplicaCache({ indexedDB });
    await cache.ensureOwner('root', { world: 'boot-a' });
    const page = await cache.readBefore('c0', 4, 10, 10_000);
    expect(page.rows).toHaveLength(1);
    expectRedactedBusinessRow(page.rows[0], 3);

    // The migration uses the existing rows store; there is no renderer-only
    // masking and no second cache that can leave the old secret behind.
    const migrated = JSON.stringify(await rawDbRows('atoll-channel-replica-v1'));
    expect(migrated).not.toContain('one-time-key-3-should-not-persist');
    expect(migrated).not.toContain('token-value-3-should-not-persist');
    expect(migrated).toContain('已隐藏');
    await cache.destroy();
  });

  it('QuotaExceededError 回收旧半窗后重试同一 rows store，顺序重载不丢新行', async () => {
    await clearCache();
    const cache = createChannelReplicaCache({ indexedDB });
    await cache.ensureOwner('root', { world: 'boot-a' });
    const envelope = (seq) => ({
      id: `quota-row-${seq}`, kind: 'event', type: 'human.note',
      sender: { kind: 'human', id: 'human:root:1' }, visibility: 'public',
      payload: { body: { text: `message ${seq}`, token: `secret-${seq}` } },
    });
    await cache.saveRows(Array.from({ length: 8 }, (_, index) => ({
      channel_id: 'c0', seq: index + 1, envelope: envelope(index + 1),
    })));

    const originalPut = IDBObjectStore.prototype.put;
    let quotaFailed = false;
    let thrown = null;
    IDBObjectStore.prototype.put = function put(value, ...args) {
      if (!quotaFailed && this.name === 'rows' && value?.seq === 9) {
        quotaFailed = true;
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return originalPut.call(this, value, ...args);
    };
    try {
      await cache.saveRows([{ channel_id: 'c0', seq: 9, envelope: envelope(9) }]);
    } catch (error) {
      thrown = error;
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }

    // Reload before the next append: the bound is part of the same channel
    // Meta row, so a new cache instance must continue atomic tail recovery.
    await cache.destroy();
    const reloaded = createChannelReplicaCache({ indexedDB });
    await reloaded.ensureOwner('root', { world: 'boot-a' });
    expect(reloaded.metaSnapshot().get('c0')).toMatchObject({
      oldestSeq: 5, newestSeq: 9, rowCount: 5, quotaTailRows: 8,
      coverage: [{ lowSeq: 5, highSeq: 9 }],
    });

    // Deliberately arrive out of order after reload. The canonical rows store,
    // not insertion order or a second cache, owns the restored order.
    await reloaded.saveRows([15, 10, 12, 11, 14, 13].map((seq) => ({
      channel_id: 'c0', seq, envelope: envelope(seq),
    })), { coverage: { channelId: 'c0', lowSeq: 1, highSeq: 15 } });
    await reloaded.destroy();

    const restored = createChannelReplicaCache({ indexedDB });
    await restored.ensureOwner('root', { world: 'boot-a' });
    const page = await restored.readBefore('c0', Number.MAX_SAFE_INTEGER, 200, 4 * 1024 * 1024);
    expect(quotaFailed).toBe(true);
    expect(thrown).toBeNull();
    expect(page.rows.map((row) => row.seq)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    expect(page.rows.at(-1)?.envelope?.payload?.body).toMatchObject({
      text: 'message 15', token: '已隐藏',
    });
    expect(restored.metaSnapshot().get('c0')).toMatchObject({
      oldestSeq: 8, newestSeq: 15, rowCount: 8,
      // Quota recovery may only publish coverage for physical surviving rows;
      // the discarded 1..7 range must not become a resume promise.
      coverage: [{ lowSeq: 8, highSeq: 15 }],
    });
    await restored.destroy();
  });

  it('quota recovery is channel-local and a second quota leaves the old window for network refetch', async () => {
    await clearCache();
    const cache = createChannelReplicaCache({ indexedDB });
    await cache.ensureOwner('root', { world: 'boot-a' });
    const row = (channel_id, seq) => ({
      channel_id, seq,
      envelope: { id: `${channel_id}-row-${seq}`, kind: 'event', type: 'human.note',
        payload: { body: { text: `${channel_id}:${seq}` } } },
    });
    await cache.saveRows([
      ...Array.from({ length: 8 }, (_, index) => row('c0', index + 1)),
      row('c1', 1), row('c1', 2),
    ]);

    const originalPut = IDBObjectStore.prototype.put;
    let quotaFailures = 0;
    IDBObjectStore.prototype.put = function put(value, ...args) {
      if (this.name === 'rows' && value?.channelId === 'c0' && value?.seq === 9) {
        quotaFailures += 1;
        throw new DOMException('quota', 'QuotaExceededError');
      }
      return originalPut.call(this, value, ...args);
    };
    try {
      await expect(cache.saveRows([row('c0', 9)], {
        coverage: { channelId: 'c0', lowSeq: 1, highSeq: 9 },
      })).rejects.toMatchObject({
        code: 'cache_unavailable',
        message: '本地缓存不可用，已转网络重取',
      });
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }

    // The failed clear/rebuild is atomic: c0 keeps its old rows and broad
    // coverage, while c1 is never touched by the c0 quota attempt.
    expect(quotaFailures).toBe(2);
    expect((await cache.readBefore('c0', 10, 20, 10_000)).rows.map((item) => item.seq))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect((await cache.readBefore('c1', 3, 20, 10_000)).rows.map((item) => item.seq))
      .toEqual([1, 2]);
    expect(cache.metaSnapshot().get('c0')).toMatchObject({
      oldestSeq: 1, newestSeq: 8, rowCount: 8,
      coverage: [{ lowSeq: 1, highSeq: 8 }],
    });
    expect(cache.metaSnapshot().get('c1')).toMatchObject({
      oldestSeq: 1, newestSeq: 2, rowCount: 2,
      coverage: [{ lowSeq: 1, highSeq: 2 }],
    });
    await cache.destroy();

    const reloaded = createChannelReplicaCache({ indexedDB });
    await reloaded.ensureOwner('root', { world: 'boot-a' });
    expect(reloaded.metaSnapshot().get('c0')).toMatchObject({ rowCount: 8, coverage: [{ lowSeq: 1, highSeq: 8 }] });
    await reloaded.destroy();
  });

  it('启动时以物理 rows 重建旧 Meta、删除孤儿 Meta，并再次脱敏 survivors', async () => {
    await clearCache();
    await rawDbPut('atoll-channel-replica-v1', {
      owner: 'root\u0000boot-a', channelId: 'c0', seq: 4, row: sensitiveRow(4),
    });
    await rawDbMetaPut('atoll-channel-replica-v1', {
      owner: 'root\u0000boot-a', channelId: 'c0',
      value: {
        headSeq: 99, oldestSeq: 1, newestSeq: 99, rowCount: 99,
        quotaTailRows: 8, coverage: [{ lowSeq: 1, highSeq: 99 }],
      },
    });
    await rawDbMetaPut('atoll-channel-replica-v1', {
      owner: 'root\u0000boot-a', channelId: 'orphan-meta',
      value: { headSeq: 50, oldestSeq: 1, newestSeq: 50, rowCount: 50, coverage: [{ lowSeq: 1, highSeq: 50 }] },
    });

    const cache = createChannelReplicaCache({ indexedDB });
    await cache.ensureOwner('root', { world: 'boot-a' });
    expect(cache.metaSnapshot().get('c0')).toMatchObject({
      headSeq: 4, oldestSeq: 4, newestSeq: 4, rowCount: 1,
      quotaTailRows: 8, coverage: [{ lowSeq: 4, highSeq: 4 }],
    });
    expect(cache.metaSnapshot().has('orphan-meta')).toBe(false);
    expectRedactedBusinessRow((await cache.readBefore('c0', 5, 10, 10_000)).rows[0], 4);
    const stored = JSON.stringify(await rawDbRows('atoll-channel-replica-v1'));
    expect(stored).not.toContain('one-time-key-4-should-not-persist');
    expect(stored).not.toContain('token-value-4-should-not-persist');
    expect((await rawDbMeta('atoll-channel-replica-v1')).some((entry) => entry.channelId === 'orphan-meta')).toBe(false);
    await cache.destroy();
  });

  it('quota window rebuild re-redacts an old physical survivor before writing it back', async () => {
    await clearCache();
    await rawDbPut('atoll-channel-replica-v1', {
      owner: 'root\u0000boot-a', channelId: 'c0', seq: 4, row: sensitiveRow(4),
    });
    await rawDbMetaPut('atoll-channel-replica-v1', {
      owner: 'root\u0000boot-a', channelId: 'c0',
      value: { headSeq: 4, oldestSeq: 4, newestSeq: 4, rowCount: 1, quotaTailRows: 8, coverage: [{ lowSeq: 4, highSeq: 4 }] },
    });
    const cache = createChannelReplicaCache({ indexedDB });
    await cache.ensureOwner('root', { world: 'boot-a' });

    // Simulate an old raw row arriving between startup reconciliation and the
    // bounded rebuild. The rebuild itself must remain a durable redaction boundary.
    await rawDbPut('atoll-channel-replica-v1', {
      owner: 'root\u0000boot-a', channelId: 'c0', seq: 4, row: sensitiveRow(4),
    });
    await cache.saveRows([sensitiveRow(9)]);
    const stored = JSON.stringify(await rawDbRows('atoll-channel-replica-v1'));
    expect(stored).not.toContain('one-time-key-4-should-not-persist');
    expect(stored).not.toContain('token-value-4-should-not-persist');
    expectRedactedBusinessRow((await cache.readBefore('c0', 10, 10, 10_000)).rows[0], 4);
    await cache.destroy();
  });

  it('serializes concurrent bounded saveRows calls without losing the later row', async () => {
    await clearCache();
    for (let seq = 1; seq <= 8; seq += 1) {
      await rawDbPut('atoll-channel-replica-v1', {
        owner: 'root\u0000boot-a', channelId: 'c0', seq, row: sensitiveRow(seq),
      });
    }
    await rawDbMetaPut('atoll-channel-replica-v1', {
      owner: 'root\u0000boot-a', channelId: 'c0',
      value: { headSeq: 8, oldestSeq: 1, newestSeq: 8, rowCount: 8, quotaTailRows: 8, coverage: [{ lowSeq: 1, highSeq: 8 }] },
    });
    const cache = createChannelReplicaCache({ indexedDB });
    await cache.ensureOwner('root', { world: 'boot-a' });
    await Promise.all([cache.saveRows([sensitiveRow(9)]), cache.saveRows([sensitiveRow(10)])]);
    expect((await cache.readBefore('c0', 11, 20, 100_000)).rows.map((row) => row.seq))
      .toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    await cache.destroy();
  });

  it('does not call a partial tail exhausted, and older refill keeps the existing newer tail', async () => {
    await clearCache();
    for (let seq = 8; seq <= 14; seq += 1) {
      await rawDbPut('atoll-channel-replica-v1', {
        owner: 'root\u0000boot-a', channelId: 'c0', seq, row: sensitiveRow(seq),
      });
    }
    await rawDbMetaPut('atoll-channel-replica-v1', {
      owner: 'root\u0000boot-a', channelId: 'c0',
      // The broad legacy coverage is deliberately stale; startup must derive
      // the physical interval before answering the cache read.
      value: { headSeq: 14, oldestSeq: 8, newestSeq: 14, rowCount: 7, quotaTailRows: 8, coverage: [{ lowSeq: 1, highSeq: 14 }] },
    });

    const cache = createChannelReplicaCache({ indexedDB });
    await cache.ensureOwner('root', { world: 'boot-a' });
    const partial = await cache.readBefore('c0', 9, 20, 100_000);
    expect(partial.rows.map((row) => row.seq)).toEqual([8]);
    expect(partial.exhausted).toBe(false);
    expect(cache.metaSnapshot().get('c0').coverage).toEqual([{ lowSeq: 8, highSeq: 14 }]);

    // A network page older than the current tail must not evict 8..14 merely
    // because physicalWindow used to protect every incoming row.
    await cache.saveRows(Array.from({ length: 7 }, (_, index) => sensitiveRow(index + 1)), {
      coverage: { channelId: 'c0', lowSeq: 1, highSeq: 7 },
    });
    const stored = (await rawDbRows('atoll-channel-replica-v1'))
      .filter((entry) => entry.owner === 'root\u0000boot-a' && entry.channelId === 'c0')
      .sort((left, right) => left.seq - right.seq);
    expect(stored.map((entry) => entry.seq)).toEqual([7, 8, 9, 10, 11, 12, 13, 14]);
    expect(cache.metaSnapshot().get('c0')).toMatchObject({
      oldestSeq: 7, newestSeq: 14, rowCount: 8,
      coverage: [{ lowSeq: 7, highSeq: 14 }],
    });
    const afterRefill = await cache.readBefore('c0', 9, 20, 100_000);
    expect(afterRefill.rows.map((row) => row.seq)).toEqual([7, 8]);
    expect(afterRefill.exhausted).toBe(false);
    await cache.destroy();
  });

  it('publishes clear only after its durable transaction succeeds', async () => {
    await clearCache();
    const cache = createChannelReplicaCache({ indexedDB });
    await cache.ensureOwner('root', { world: 'boot-a' });
    await cache.saveRows([sensitiveRow(1)]);
    const originalDelete = IDBObjectStore.prototype.delete;
    let injected = false;
    IDBObjectStore.prototype.delete = function deleteRow(key, ...args) {
      if (!injected && this.name === 'rows' && key?.[2] === 1) {
        injected = true;
        throw new Error('injected clear failure');
      }
      return originalDelete.call(this, key, ...args);
    };
    try {
      await expect(cache.clear()).rejects.toThrow('injected clear failure');
    } finally {
      IDBObjectStore.prototype.delete = originalDelete;
    }
    expect(injected).toBe(true);
    expect(cache.metaSnapshot().get('c0')).toMatchObject({ rowCount: 1, oldestSeq: 1, newestSeq: 1 });
    expect((await cache.readBefore('c0', 2, 10, 10_000)).rows.map((row) => row.seq)).toEqual([1]);
    await cache.destroy();
  });

  it('写入事务失败时不提前发布 Meta 或留下半条 row', async () => {
    await clearCache();
    const cache = createChannelReplicaCache({ indexedDB });
    await cache.ensureOwner('root', { world: 'boot-a' });
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function put(value, ...args) {
      if (this.name === 'rows' && value?.seq === 1) throw new Error('injected row failure');
      return originalPut.call(this, value, ...args);
    };
    try {
      await expect(cache.saveRows([sensitiveRow(1)])).rejects.toThrow('injected row failure');
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    expect(cache.metaSnapshot().has('c0')).toBe(false);
    expect((await cache.readBefore('c0', 2, 10, 10_000)).rows).toEqual([]);
    await cache.destroy();
  });
});
