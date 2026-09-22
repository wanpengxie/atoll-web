import { describe, expect, it } from 'vitest';
import {
  readerCaughtUp,
  viewportUnseenNotice,
} from '../src/model/notification-policy.js';

// IM 模型（监理 2026-09-18 14:58 补充裁定）：用户在底部且页面可见时新到达即读，
// 恒不产生未读计数；不在底部 / 在别的频道 / 页面不可见才计入。这里的三个纯函数
// 是视窗计数与频道徽标共用的那一条读侧规则——真相仍是回执，这里只压显示值。
describe('IM 读侧兜底', () => {
  const present = { following: true, atTail: true, surfaceVisible: true, documentVisible: true };

  // Old notification contract (receipts/leases/identities); see read-position-unread.test.jsx.
  it.skip('追平在场要四个条件同时成立', () => {
    expect(readerCaughtUp(present)).toBe(true);
    expect(readerCaughtUp({ ...present, following: false })).toBe(false);
    expect(readerCaughtUp({ ...present, atTail: false })).toBe(false);
    expect(readerCaughtUp({ ...present, surfaceVisible: false })).toBe(false);
    expect(readerCaughtUp({ ...present, documentVisible: false })).toBe(false);
    expect(readerCaughtUp()).toBe(false);
  });

  // Old notification contract (receipts/leases/identities); see read-position-unread.test.jsx.
  it.skip('视窗计数在追平时恒为 0，否则是真值', () => {
    expect(viewportUnseenNotice(7, true)).toBe(0);
    expect(viewportUnseenNotice(7, false)).toBe(7);
    expect(viewportUnseenNotice(-3, false)).toBe(0);
    expect(viewportUnseenNotice(undefined, false)).toBe(0);
  });

});
