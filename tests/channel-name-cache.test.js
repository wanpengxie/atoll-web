// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWireConnection, useWireSessionPort } from '../src/app/hooks/useWireSession.js';
import { createObsClient } from '../src/net/obs.js';
import { createWire } from '../src/net/wire.js';

// Channel labels are written by the wire-session owner while directory facts
// are refreshed. The old migration imported internal label-cache and
// access-reducer helpers directly even though they are private. Drive the
// exported connection hook and inspect the access port instead; this is the
// same boundary used by WorkspaceApp.
vi.mock('../src/net/obs.js', () => ({ createObsClient: vi.fn() }));
vi.mock('../src/net/wire.js', () => ({ createWire: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  globalThis.localStorage?.clear();
});

function profileEnvelope(profile) {
  return { declared: profile, actual: { measures: [{ name: 'open', value: profile.open, unknown: false }] } };
}

function publicConnectionHarness({ profiles = [], memberships = [] } = {}) {
  const obs = {
    spaceChannels: vi.fn(async (parentId) => ({ complete: true, items: parentId ? [] : profiles.map(profileEnvelope) })),
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
    activeChannelRef: { current: '' },
    accessActionsRef: { current: {} },
    agentActivityRef: { current: { attach: vi.fn(), disconnect: vi.fn() } },
    bumpAccess: vi.fn(), cancelFeedTask: vi.fn(), clearRoster: vi.fn(), disconnectHistory: vi.fn(),
    displayError: (error) => error?.message || String(error), enqueueFeed: vi.fn(), expireSession: vi.fn(),
    finishHistoryPage: vi.fn(), finishLiveCheckpoint: vi.fn(), onServerWorld: vi.fn(), onSession: vi.fn(),
    onWorldChanged: vi.fn(), prepareLocalReplica: vi.fn().mockResolvedValue(undefined), principalId: 'root',
    reconcileIdentity: vi.fn(), resetSubmissionWorld: vi.fn(), resumeLocalReplica: vi.fn(() => ({})),
    seedRoster: vi.fn(), setActiveChannelId: vi.fn(), setChannels: vi.fn(),
    setHistoryGrants: vi.fn().mockResolvedValue(undefined), setTopError: vi.fn(), stopIncompatibleFeed: vi.fn(),
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

async function currentRows(config) {
  const harness = await accessPort(config);
  const rows = harness.result.current.accessRef.current.rows();
  harness.unmount();
  return rows;
}

describe('频道名缓存（public useWireConnection port）', () => {
  it('记住的是名字,下次启动顶在没档案的行上', async () => {
    const first = await accessPort({
      profiles: [{ id: 'c-1', qualified_name: 'c0.dev', name: 'dev', status: 'present', open: true }],
      memberships: [{ channel_id: 'c-1', status: 'active' }],
    });
    expect(first.result.current.accessRef.current.rows().find((row) => row.id === 'c-1').qualified_name).toBe('c0.dev');
    first.unmount();
    // Keep the label cache but remove the bootstrap profile so the next owner
    // has to exercise its membership-only fallback.
    localStorage.removeItem('atoll.workspace.bootstrap.v2.root');
    const second = await accessPort({ profiles: [], memberships: [{ channel_id: 'c-1', status: 'active' }] });
    const row = second.result.current.accessRef.current.rows().find((item) => item.id === 'c-1');
    expect(row.name).toBe('c0.dev');
    expect(row.qualified_name).toBeUndefined();
    second.unmount();
  });

  it('已经有档案的行一个字不动', async () => {
    const first = await accessPort({ profiles: [{ id: 'c-1', qualified_name: '旧名', status: 'present', open: true }], memberships: [{ channel_id: 'c-1', status: 'active' }] });
    first.unmount();
    localStorage.removeItem('atoll.workspace.bootstrap.v2.root');
    const second = await accessPort({ profiles: [{ id: 'c-1', qualified_name: '新名', status: 'present', open: true }], memberships: [{ channel_id: 'c-1', status: 'active' }] });
    const row = second.result.current.accessRef.current.rows().find((item) => item.id === 'c-1');
    expect(row.qualified_name).toBe('新名');
    second.unmount();
  });

  it('名字就是 id 的兜底行不记（记了等于没记）', async () => {
    const first = await accessPort({ profiles: [{ id: 'c-2', name: 'c-2', status: 'present', open: true }], memberships: [{ channel_id: 'c-2', status: 'active' }] });
    first.unmount();
    localStorage.removeItem('atoll.workspace.bootstrap.v2.root');
    const second = await accessPort({ profiles: [], memberships: [{ channel_id: 'c-2', status: 'active' }] });
    const row = second.result.current.accessRef.current.rows().find((item) => item.id === 'c-2');
    expect(row.name).toBe('c-2');
    second.unmount();
  });

  it('没记过的行原样返回', async () => {
    const rows = await currentRows({ profiles: [], memberships: [{ channel_id: 'c-9', status: 'active' }] });
    expect(rows.find((item) => item.id === 'c-9').name).toBe('c-9');
  });

  it('缓存名字恒不让任何访问关系复活', async () => {
    const first = await accessPort({ profiles: [{ id: 'c-1', qualified_name: 'c0.dev', status: 'present', open: true }], memberships: [] });
    first.unmount();
    localStorage.removeItem('atoll.workspace.bootstrap.v2.root');
    const second = await accessPort({ profiles: [], memberships: [] });
    expect(second.result.current.accessRef.current.rows()).toEqual([]);
    expect(second.result.current.accessRef.current.state('c-1')).toBe(null);
    second.unmount();
  });
});

describe('拿到档案之前先显示已确认成员的缓存（public access port）', () => {
  it('有成员资格、还没有档案 → 沿用本地关系正常读写,不是暂不可用', async () => {
    const rows = await currentRows({ profiles: [], memberships: [{ channel_id: 'c-1', actor_id: 'human:root:1', status: 'active' }] });
    expect(rows.find((item) => item.id === 'c-1').access).toBe('member_active');
  });

  it('档案到了、频道确实没开 → 才是暂不可用', async () => {
    const rows = await currentRows({ profiles: [{ id: 'c-1', status: 'present', open: false }], memberships: [{ channel_id: 'c-1', status: 'active' }] });
    expect(rows.find((item) => item.id === 'c-1').access).toBe('member_unavailable');
  });

  it('档案到了、频道开着 → 可用', async () => {
    const rows = await currentRows({ profiles: [{ id: 'c-1', status: 'present', open: true }], memberships: [{ channel_id: 'c-1', status: 'active' }] });
    expect(rows.find((item) => item.id === 'c-1').access).toBe('member_active');
  });
});
