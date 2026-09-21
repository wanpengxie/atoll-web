import { describe, expect, it } from 'vitest';
import { detectProfile, PROFILE_DESKTOP, PROFILE_MOBILE } from '../src/model/device-profile.js';

function media(map) {
  return (query) => ({ matches: Boolean(map[query]) });
}

const storage = () => {
  const rows = new Map();
  return { getItem: (k) => rows.get(k) ?? null, setItem: (k, v) => rows.set(k, v), length: 0, key: () => null };
};

describe('性能路径的判据', () => {
  it('[TC-0602][AD-308] 触屏 + 窄屏 → 移动端', () => {
    expect(detectProfile({ matchMedia: media({ '(pointer: coarse)': true, '(max-width: 900px)': true }), search: '', storage: storage() })).toBe(PROFILE_MOBILE);
  });

  // PC 上把窗口拖窄不该切路径:窄但不是触屏,恒是 desktop。
  it('[TC-0603][AD-309] 窄屏但不是触屏 → 桌面端', () => {
    expect(detectProfile({ matchMedia: media({ '(max-width: 900px)': true }), search: '', storage: storage() })).toBe(PROFILE_DESKTOP);
  });

  it('触屏但宽屏（平板横放、触屏一体机）→ 桌面端', () => {
    expect(detectProfile({ matchMedia: media({ '(pointer: coarse)': true }), search: '', storage: storage() })).toBe(PROFILE_DESKTOP);
  });

  // 覆盖开关是移动端路径唯一能在 PC 上被测到的入口,所以它必须比判据更硬。
  it('?perf=mobile 压过判据,并被记住', () => {
    const store = storage();
    const desktopMedia = media({});
    expect(detectProfile({ matchMedia: desktopMedia, search: '?perf=mobile', storage: store })).toBe(PROFILE_MOBILE);
    expect(detectProfile({ matchMedia: desktopMedia, search: '', storage: store })).toBe(PROFILE_MOBILE);
    expect(detectProfile({ matchMedia: desktopMedia, search: '?perf=desktop', storage: store })).toBe(PROFILE_DESKTOP);
  });

  it('判据缺失（jsdom、旧浏览器）恒落到今天已经在跑的那条路径', () => {
    expect(detectProfile({ matchMedia: undefined, search: '', storage: storage() })).toBe(PROFILE_DESKTOP);
  });
});
