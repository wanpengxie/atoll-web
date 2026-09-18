import { describe, expect, it } from 'vitest';
import {
  projectChannelUnread,
  readerCaughtUp,
  viewportUnseenNotice,
} from '../src/model/notification-policy.js';

// IM 模型（监理 2026-09-18 14:58 补充裁定）：用户在底部且页面可见时新到达即读，
// 恒不产生未读计数；不在底部 / 在别的频道 / 页面不可见才计入。这里的三个纯函数
// 是视窗计数与频道徽标共用的那一条读侧规则——真相仍是回执，这里只压显示值。
describe('IM 读侧兜底', () => {
  const present = { following: true, atTail: true, surfaceVisible: true, documentVisible: true };

  it('追平在场要四个条件同时成立', () => {
    expect(readerCaughtUp(present)).toBe(true);
    expect(readerCaughtUp({ ...present, following: false })).toBe(false);
    expect(readerCaughtUp({ ...present, atTail: false })).toBe(false);
    expect(readerCaughtUp({ ...present, surfaceVisible: false })).toBe(false);
    expect(readerCaughtUp({ ...present, documentVisible: false })).toBe(false);
    expect(readerCaughtUp()).toBe(false);
  });

  it('视窗计数在追平时恒为 0，否则是真值', () => {
    expect(viewportUnseenNotice(7, true)).toBe(0);
    expect(viewportUnseenNotice(7, false)).toBe(7);
    expect(viewportUnseenNotice(-3, false)).toBe(0);
    expect(viewportUnseenNotice(undefined, false)).toBe(0);
  });

  const counts = { related: 3, total: 5 };

  it('无过滤的全部视图追平后，活动频道的两格徽标都归零', () => {
    expect(projectChannelUnread(counts, 'c0', {
      channelId: 'c0', caughtUp: true, scope: 'all', actorFiltered: false,
    })).toEqual({ related: 0, total: 0, pending: false, unknown: false });
  });

  it('@我视图只覆盖 related，过滤外 other 仍显示', () => {
    expect(projectChannelUnread(counts, 'c0', {
      channelId: 'c0', caughtUp: true, scope: 'mine', actorFiltered: false,
    })).toEqual({ related: 0, total: 2 });
  });

  it('actorFilter 不用聚合显示兜底掩盖过滤外真值', () => {
    const caughtUp = {
      channelId: 'c0', caughtUp: true, scope: 'all', actorFiltered: true,
    };
    expect(projectChannelUnread(counts, 'c0', caughtUp)).toBe(counts);
    expect(projectChannelUnread(counts, 'c0', { ...caughtUp, caughtUp: false })).toBe(counts);
  });

  it('只清活动频道：别的频道与未追平时原样返回', () => {
    const caught = { channelId: 'c0', caughtUp: true, scope: 'all', actorFiltered: false };
    expect(projectChannelUnread(counts, 'c1', caught)).toBe(counts);
    expect(projectChannelUnread(counts, 'c0', { ...caught, caughtUp: false })).toBe(counts);
    expect(projectChannelUnread(counts, 'c0', null)).toBe(counts);
  });

  it('追平时活动频道不再显示待同步占位', () => {
    expect(projectChannelUnread({ related: 0, total: 0, pending: true }, 'c0', {
      channelId: 'c0', caughtUp: true, scope: 'all', actorFiltered: false,
    })).toMatchObject({ pending: false, unknown: false });
  });
});
