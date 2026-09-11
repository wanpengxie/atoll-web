// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cachedChannelName, forgetChannelNames, rememberChannelNames, withCachedChannelName } from '../src/model/channel-name-cache.js';
import { CHANNEL_ACCESS, createChannelAccessTracker, deriveChannelAccess } from '../src/model/channel-access.js';

afterEach(() => forgetChannelNames());

describe('频道名缓存', () => {
  it('记住的是名字,下次启动顶在没档案的行上', () => {
    rememberChannelNames([{ id: 'c-1', qualified_name: 'c0.dev', name: 'dev' }]);
    expect(cachedChannelName('c-1')).toBe('c0.dev');
    const row = { id: 'c-1', name: 'c-1', accessState: { profile: null } };
    expect(withCachedChannelName(row)).toMatchObject({ name: 'c0.dev', qualified_name: 'c0.dev' });
  });

  // 已经有档案的行是权威,缓存恒不能盖它——否则改过名之后永远显示旧的。
  it('已经有档案的行一个字不动', () => {
    rememberChannelNames([{ id: 'c-1', qualified_name: '旧名' }]);
    const row = { id: 'c-1', qualified_name: '新名', accessState: { profile: { id: 'c-1' } } };
    expect(withCachedChannelName(row)).toBe(row);
  });

  it('名字就是 id 的兜底行不记（记了等于没记）', () => {
    rememberChannelNames([{ id: 'c-2', name: 'c-2' }]);
    expect(cachedChannelName('c-2')).toBe('');
  });

  it('没记过的行原样返回', () => {
    const row = { id: 'c-9', name: 'c-9', accessState: { profile: null } };
    expect(withCachedChannelName(row)).toBe(row);
  });

  // 缓存的只有名字。访问关系恒不落盘,重开一个 tracker 必须一无所知。
  it('缓存名字恒不让任何访问关系复活', () => {
    rememberChannelNames([{ id: 'c-1', qualified_name: 'c0.dev' }]);
    const tracker = createChannelAccessTracker({ principalId: 'root' });
    expect(tracker.rows()).toEqual([]);
    expect(tracker.state('c-1')).toBeNull();
  });
});

describe('拿到档案之前不说"暂不可用"', () => {
  // 成员资格由 attach 回执带来,频道档案另走一趟 HTTP——回执先到是常态。
  // 那一刻 runtime 还是 unknown,旧代码据此报 member_unavailable,是一句会被
  // 下一秒打脸的断言。
  it('有成员资格、还没有档案 → 确认中,不是暂不可用', () => {
    const tracker = createChannelAccessTracker({ principalId: 'root' });
    tracker.wire('attached', 'epoch-1');
    tracker.feed('c-1');
    const row = tracker.rows().find((item) => item.id === 'c-1');
    expect(row.access).toBe(CHANNEL_ACCESS.loading);
  });

  it('档案到了、频道确实没开 → 才是暂不可用', () => {
    expect(deriveChannelAccess({ id: 'c-1', open: false }, { status: 'active' }, { connected: true }))
      .toBe(CHANNEL_ACCESS.memberUnavailable);
  });

  it('档案到了、频道开着 → 可用', () => {
    expect(deriveChannelAccess({ id: 'c-1', open: true }, { status: 'active' }, { connected: true }))
      .toBe(CHANNEL_ACCESS.memberActive);
  });
});
