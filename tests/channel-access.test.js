import { describe, expect, it } from 'vitest';
import { canWriteChannel, channelAccessRows, CHANNEL_ACCESS, createChannelAccessTracker, deriveChannelAccess } from '../src/model/channel-access.js';


describe('channel access model', () => {
  it('combines declaration, serving and membership without conflating discovery', () => {
    const active = { status: 'active' };
    expect(deriveChannelAccess({ status: 'present', open: true }, active)).toBe(CHANNEL_ACCESS.memberActive);
    expect(deriveChannelAccess({ status: 'present', open: false }, active)).toBe(CHANNEL_ACCESS.memberUnavailable);
    expect(deriveChannelAccess({ status: 'present' }, active)).toBe(CHANNEL_ACCESS.memberUnavailable);
    expect(deriveChannelAccess({ status: 'present', open: true }, null)).toBe(CHANNEL_ACCESS.discoverable);
    expect(deriveChannelAccess({ status: 'present', open: true }, { status: 'revoked' })).toBe(CHANNEL_ACCESS.accessDenied);
    expect(deriveChannelAccess({ status: 'retired', open: false }, active)).toBe(CHANNEL_ACCESS.retired);
  });

  it('always hides lobby and only permits writes in active member channels', () => {
    const rows = channelAccessRows([
      { id: 'c0', name: 'home', status: 'present', open: true },
      { id: 'c0.public', name: 'public', status: 'present', open: true },
      { id: 'c0.lobby', name: 'lobby', status: 'present', open: true },
    ], [{ channel_id: 'c0', status: 'active' }]);
    expect(rows.map((row) => row.id)).toEqual(['c0', 'c0.public']);
    expect(rows.map((row) => row.access)).toEqual(['member_active', 'discoverable']);
    expect(canWriteChannel(rows[0].access)).toBe(true);
    expect(canWriteChannel(rows[1].access)).toBe(false);
  });

  it('never hides c0 and activates the root owner without a membership projection', () => {
    const tracker = createChannelAccessTracker({ principalId: "root" });
    tracker.channelsObserved([
      { id: 'c0', name: 'home', status: 'present', open: true, systemReserved: true, owner_principal: 'root' },
      { id: 'c0.lobby', name: 'lobby', status: 'present', open: true, systemReserved: true, owner_principal: 'root' },
      { id: 'c0.project', name: 'project', status: 'present', open: true, owner_principal: 'root' },
    ]);
    tracker.membershipsObserved([], { supported: false, complete: false });
    tracker.wire('attached', 'epoch-root');

    expect(tracker.rows().map((row) => row.id)).toEqual(['c0', 'c0.project']);
    expect(tracker.rows().find((row) => row.id === 'c0').access).toBe('member_active');
    expect(tracker.rows().find((row) => row.id === 'c0.project').access).toBe('discoverable');
  });

  it('keeps access dimensions distinct through disconnect, unavailable, revoke, partial OBS and retire', () => {
    
    const tracker = createChannelAccessTracker({ principalId: "root", now: () => 10 });
    tracker.channelsObserved([{ id: 'c0', status: 'present', open: true }, { id: 'c1', status: 'present', open: true }]);
    tracker.membershipsObserved([{ channel_id: 'c0', actor_id: 'human-root', status: 'active' }]);
    tracker.wire('attached', 'epoch-1');
    expect(tracker.state('c0')).toMatchObject({ existence: 'present', runtime: 'open', relationship: 'member', selfActorId: 'human-root' });
    expect(tracker.rows().find((row) => row.id === 'c0').access).toBe('member_active');

    tracker.wire('disconnected');
    expect(tracker.rows().find((row) => row.id === 'c0').access).toBe('member_stale');
    tracker.wire('attached', 'epoch-2');
    tracker.unavailable('c0');
    expect(tracker.rows().find((row) => row.id === 'c0').access).toBe('member_unavailable');

    tracker.channelsObserved([{ id: 'c0', status: 'present', open: true }], { complete: false });
    expect(tracker.state('c1').existence).toBe('present');
    tracker.membershipsObserved([{ channel_id: 'c0', actor_id: 'human-root', status: 'revoked' }]);
    expect(tracker.state('c0')).toMatchObject({ relationship: 'denied', selfActorId: '' });
    expect(tracker.rows().find((row) => row.id === 'c0').access).toBe('access_denied');

    tracker.channelsObserved([{ id: 'c1', status: 'present', open: true }], { complete: true });
    expect(tracker.state('c0').existence).toBe('retired');
    expect(tracker.rows().some((row) => row.id === 'c0')).toBe(false);
  });

  it('访问关系恒不跨实例还魂：新 tracker 对上一个生命期一无所知', () => {
    const first = createChannelAccessTracker({ principalId: 'root' });
    first.channelsObserved([{ id: 'c0', status: 'present', open: true }]);
    first.wire('attached', 'epoch');
    first.feed('c0');
    // 活状态恒只活在内存：重建（= 页面刷新）后一切重新从 attach/obs 现取，
    // 恒不从任何持久层恢复旧关系。
    const rebuilt = createChannelAccessTracker({ principalId: 'root' });
    expect(rebuilt.rows()).toEqual([]);
    expect(rebuilt.state('c0')).toBe(null);
  });
});
