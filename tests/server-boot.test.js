import { describe, expect, it } from 'vitest';
import { ensureServerBoot } from '../src/model/server-boot.js';

class MemoryStorage {
  constructor(entries = []) { this.data = new Map(entries); }
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}

describe('server boot guard', () => {
  it('records the first boot without invalidating state created by this login', () => {
    const storage = new MemoryStorage([['atoll.cursor.v3.c0', '9']]);
    expect(ensureServerBoot('boot-a', storage)).toBe(true);
    expect(storage.getItem('atoll.cursor.v3.c0')).toBe('9');
    expect(storage.getItem('atoll.server.boot.v1')).toBe('boot-a');
  });

  it('invalidates Atoll local state when an established boot changes', () => {
    const storage = new MemoryStorage([
      ['atoll.server.boot.v1', 'boot-a'],
      ['atoll.cursor.v3.c0', '9'],
      ['unrelated', 'keep'],
    ]);
    expect(ensureServerBoot('boot-b', storage)).toBe(false);
    expect(storage.getItem('atoll.cursor.v3.c0')).toBeNull();
    expect(storage.getItem('unrelated')).toBe('keep');
  });
});
