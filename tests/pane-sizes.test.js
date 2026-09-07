import { describe, expect, it } from 'vitest';
import { clampPaneWidth, readPaneWidth, writePaneWidth } from '../src/model/pane-sizes.js';

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) };
}

describe('pane-sizes', () => {
  it('左栏有固定上下限，右侧面板上限随视口给对话区留位', () => {
    expect(clampPaneWidth('rail', 100)).toBe(200);
    expect(clampPaneWidth('rail', 9999)).toBe(520);
    expect(clampPaneWidth('rail', 300.4)).toBe(300);
    expect(clampPaneWidth('context', 2000, 1280)).toBe(1280 - 420);
    expect(clampPaneWidth('artifact', 100, 1280)).toBe(420);
    expect(clampPaneWidth('rail', 'x')).toBeNull();
    expect(() => clampPaneWidth('nope', 1)).toThrow();
  });

  it('读写 localStorage，删除即回到 CSS 默认', () => {
    const storage = memoryStorage();
    expect(readPaneWidth('rail', storage)).toBeNull();
    writePaneWidth('rail', 333.7, storage);
    expect(readPaneWidth('rail', storage)).toBe(334);
    writePaneWidth('rail', 50, storage);
    expect(readPaneWidth('rail', storage)).toBe(200);
    writePaneWidth('rail', null, storage);
    expect(readPaneWidth('rail', storage)).toBeNull();
  });
});
