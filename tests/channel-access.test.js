// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWireConnection, useWireSessionPort } from '../src/app/hooks/useWireSession.js';
import { createObsClient } from '../src/net/obs.js';
import { createWire } from '../src/net/wire.js';

// Access facts are composed by the public wire-session owner. The previous
// migration imported internal access-reducer helpers from useWireSession.js;
// those are private implementation details and must not become a compatibility
// API just to make this suite load. This harness drives the exported hook and
// observes the access port that WorkspaceApp itself consumes.
vi.mock('../src/net/obs.js', () => ({ createObsClient: vi.fn() }));
vi.mock('../src/net/wire.js', () => ({ createWire: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  globalThis.localStorage?.clear();
});

function declaredProfile(profile) {
  return {
    declared: profile,
    actual: { measures: [{ name: 'open', value: profile.open, unknown: false }] },
  };
}

function publicConnectionHarness({ profiles = [], memberships = [], principalId = 'root' } = {}) {
  const obs = {
    spaceChannels: vi.fn(async (parentId) => ({
      complete: true,
      items: parentId ? [] : profiles.map(declaredProfile),
    })),
    spacePrincipals: vi.fn(async () => ({ complete: true, items: [] })),
    spaceDecls: vi.fn(async () => ({ complete: true, items: [] })),
    spaceDaemons: vi.fn(async () => ({ complete: true, items: [] })),
    channelActors: vi.fn(async () => ({ complete: true, items: [] })),
  };
  vi.mocked(createObsClient).mockReturnValue(obs);
  vi.mocked(createWire).mockImplementation((options) => {
    queueMicrotask(() => options.onState('attached', {
      boot: 'world-a', session: 'session-a', memberships, memberships_complete: true,
    }));
    return { close: vi.fn() };
  });

  const stable = {
    activeChannelRef: { current: 'c0' },
    accessActionsRef: { current: {} },
    agentActivityRef: { current: { attach: vi.fn(), disconnect: vi.fn() } },
    bumpAccess: vi.fn(),
    cancelFeedTask: vi.fn(),
    clearRoster: vi.fn(),
    disconnectHistory: vi.fn(),
    displayError: (error) => error?.message || String(error),
    enqueueFeed: vi.fn(),
    expireSession: vi.fn(),
    finishHistoryPage: vi.fn(),
    finishLiveCheckpoint: vi.fn(),
    onServerWorld: vi.fn(),
    onSession: vi.fn(),
    onWorldChanged: vi.fn(),
    prepareLocalReplica: vi.fn().mockResolvedValue(undefined),
    principalId,
    reconcileIdentity: vi.fn(),
    resetSubmissionWorld: vi.fn(),
    resumeLocalReplica: vi.fn(() => ({})),
    seedRoster: vi.fn(),
    setActiveChannelId: vi.fn(),
    setChannels: vi.fn(),
    setHistoryGrants: vi.fn().mockResolvedValue(undefined),
    setTopError: vi.fn(),
    stopIncompatibleFeed: vi.fn(),
  };

  const { result, unmount } = renderHook(() => {
    const port = useWireSessionPort();
    useWireConnection({ ...stable, port });
    return port;
  });
  return { result, unmount };
}

async function accessPort(config) {
  const harness = publicConnectionHarness(config);
  await waitFor(() => expect(harness.result.current.accessRef.current).toBeTruthy());
  await waitFor(() => expect(harness.result.current.state).toBe('open'));
  const target = config.memberships?.[0]?.channel_id || config.profiles?.[0]?.id;
  if (target) await waitFor(() => expect(harness.result.current.accessRef.current.state(target)).toBeTruthy());
  return harness;
}

async function accessFor(profile, membership) {
  const harness = await accessPort({
    profiles: [profile],
    memberships: membership?.status === 'active' ? [{ channel_id: profile.id, ...membership }] : [],
  });
  const access = harness.result.current.accessRef.current;
  // loadChannelTree intentionally omits retired declarations; feed the
  // already-public access port here to preserve the retired-state contract
  // without importing the private session reducer.
  if (profile.status === 'retired') access.channelsObserved([profile], { complete: false });
  if (membership?.status && membership.status !== 'active') {
    access.membershipsObserved([{ channel_id: profile.id, ...membership }]);
  }
  const rows = access.rows({ includeRetired: true });
  harness.unmount();
  return rows.find((row) => row.id === profile.id)?.access;
}

describe('channel access model (public useWireConnection port)', () => {
  it('combines declaration, serving and membership without conflating discovery', async () => {
    await expect(accessFor({ id: 'a', status: 'present', open: true }, { status: 'active' })).resolves.toBe('member_active');
    await expect(accessFor({ id: 'b', status: 'present', open: false }, { status: 'active' })).resolves.toBe('member_unavailable');
    await expect(accessFor({ id: 'c', status: 'present' }, { status: 'active' })).resolves.toBe('member_unavailable');
    await expect(accessFor({ id: 'd', status: 'present', open: true }, null)).resolves.toBe('discoverable');
    await expect(accessFor({ id: 'e', status: 'present', open: true }, { status: 'revoked' })).resolves.toBe('access_denied');
    await expect(accessFor({ id: 'f', status: 'retired', open: false }, { status: 'active' })).resolves.toBe('retired');
  });

  it('[AD-143] always hides lobby and actor implementation channels and only permits writes in active member channels', async () => {
    const harness = await accessPort({
      profiles: [
        { id: 'c0', name: 'home', status: 'present', open: true },
        { id: 'c0.public', name: 'public', status: 'present', open: true },
        { id: 'c0.agent-runtime', name: 'agent-runtime', type: 'actor', status: 'present', open: true },
        { id: 'c0.lobby', name: 'lobby', status: 'present', open: true },
      ],
      memberships: [{ channel_id: 'c0', status: 'active' }],
    });
    const rows = harness.result.current.accessRef.current.rows();
    const access = harness.result.current.accessRef.current;
    // The public consumer derives its write gate from the same access facts:
    // the member row is open/member, while the public observer row is never a
    // member write target. Keep this invariant without importing the old
    // channel-access predicate.
    expect(access.state('c0')).toMatchObject({ relationship: 'member', runtime: 'open' });
    expect(access.state('c0.public')).toMatchObject({ relationship: 'discoverable', runtime: 'open' });
    // 公开 owner：useWireConnection().accessRef.rows() 是 WorkspaceApp 消费的
    // 唯一访问边界；actor/lobby 资料即使由 OBS 声明，也不能成为用户频道行。
    expect(rows.map((row) => row.id)).toEqual(['c0', 'c0.public']);
    expect(rows.map((row) => row.access)).toEqual(['member_active', 'discoverable']);
    harness.unmount();
  });

  it('never hides c0 and activates the root owner without a membership projection', async () => {
    const harness = await accessPort({
      profiles: [
        { id: 'c0', name: 'home', status: 'present', open: true, systemReserved: true, owner_principal: 'root' },
        { id: 'c0.lobby', name: 'lobby', status: 'present', open: true, systemReserved: true, owner_principal: 'root' },
        { id: 'c0.project', name: 'project', status: 'present', open: true, owner_principal: 'root' },
      ],
      memberships: [],
    });
    const access = harness.result.current.accessRef.current;
    expect(access.rows().map((row) => row.id)).toEqual(['c0', 'c0.project']);
    expect(access.rows().find((row) => row.id === 'c0').access).toBe('member_active');
    expect(access.rows().find((row) => row.id === 'c0.project').access).toBe('discoverable');
    harness.unmount();
  });

  it('keeps access dimensions distinct through disconnect, unavailable, revoke, partial OBS and retire', async () => {
    const harness = await accessPort({
      profiles: [{ id: 'c0', status: 'present', open: true }, { id: 'c1', status: 'present', open: true }],
      memberships: [{ channel_id: 'c0', actor_id: 'human-root', status: 'active' }],
    });
    const access = harness.result.current.accessRef.current;
    expect(access.state('c0')).toMatchObject({ existence: 'present', runtime: 'open', relationship: 'member', selfActorId: 'human-root' });
    expect(access.rows().find((row) => row.id === 'c0').access).toBe('member_active');
    access.wire('disconnected');
    expect(access.rows().find((row) => row.id === 'c0').access).toBe('member_active');
    access.wire('attached');
    access.unavailable('c0');
    expect(access.rows().find((row) => row.id === 'c0').access).toBe('member_unavailable');
    access.channelsObserved([{ id: 'c0', status: 'present', open: true }], { complete: false });
    expect(access.rows().find((row) => row.id === 'c0').access).toBe('member_active');
    expect(access.state('c1').existence).toBe('present');
    access.membershipsObserved([{ channel_id: 'c0', actor_id: 'human-root', status: 'revoked' }]);
    expect(access.state('c0')).toMatchObject({ relationship: 'denied', selfActorId: '' });
    expect(access.rows().find((row) => row.id === 'c0').access).toBe('access_denied');
    access.channelsObserved([{ id: 'c1', status: 'present', open: true }], { complete: true });
    expect(access.state('c0').existence).toBe('retired');
    expect(access.rows().some((row) => row.id === 'c0')).toBe(false);
    harness.unmount();
  });

  it('shows confirmed member history while the independent channel profile is pending', async () => {
    const harness = await accessPort({ profiles: [], memberships: [{ channel_id: 'c0.project', actor_id: 'human-root', status: 'active' }] });
    const access = harness.result.current.accessRef.current;
    expect(access.state('c0.project')).toMatchObject({ existence: 'present', relationship: 'member' });
    expect(access.rows()).toEqual([expect.objectContaining({ id: 'c0.project', access: 'member_active' })]);
    harness.unmount();
  });

  it('访问关系恒不跨实例还魂：新 hook owner 对上一个生命期一无所知', async () => {
    const first = await accessPort({ profiles: [{ id: 'c0', status: 'present', open: true }], memberships: [] });
    first.unmount();
    const rebuilt = await accessPort({ profiles: [], memberships: [] });
    expect(rebuilt.result.current.accessRef.current.rows()).toEqual([]);
    expect(rebuilt.result.current.accessRef.current.state('c0')).toBe(null);
    rebuilt.unmount();
  });

  it('live delivery proves read eligibility but never invents membership or a self actor', async () => {
    const harness = await accessPort({ profiles: [{ id: 'public', status: 'present', open: true }], memberships: [] });
    const access = harness.result.current.accessRef.current;
    access.live('public');
    expect(access.state('public')).toMatchObject({ relationship: 'observer', freshness: 'fresh', selfActorId: '' });
    expect(access.rows().find((row) => row.id === 'public').access).toBe('observer_active');
    harness.unmount();
  });
});
