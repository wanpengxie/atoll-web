import { describe, expect, it } from 'vitest';
import { FILE_READING_HISTORY_LIMIT, readFileReadingHistory, rememberFileRead, writeFileReadingHistory } from '../src/model/file-reading-history.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe('文件阅读历史', () => {
  it('按频道和资源去重，把最近打开的放在最前', () => {
    const first = { channelId: 'c0', resourceId: 'daemon://d/c0/a.md', name: 'a.md', mediaType: 'text/markdown' };
    let rows = rememberFileRead([], first, 10);
    rows = rememberFileRead(rows, { ...first, line: 42 }, 20);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'a.md', line: 42, lastOpenedAt: 20 });
  });

  it('只持久化有限的文件元数据，并按 principal 隔离', () => {
    const storage = memoryStorage();
    let rows = [];
    for (let index = 0; index < FILE_READING_HISTORY_LIMIT + 3; index += 1) {
      rows = rememberFileRead(rows, { channelId: 'c0', resourceId: `file-${index}`, name: `${index}.txt`, ticket: 'secret' }, index);
    }
    writeFileReadingHistory('alice', 'boot-a', rows, storage);
    expect(readFileReadingHistory('alice', 'boot-a', storage)).toHaveLength(FILE_READING_HISTORY_LIMIT);
    expect(readFileReadingHistory('bob', 'boot-a', storage)).toEqual([]);
    expect(JSON.stringify(readFileReadingHistory('alice', 'boot-a', storage))).not.toContain('secret');
    expect(readFileReadingHistory('alice', 'boot-b', storage)).toEqual([]);
  });
});
