// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWireConnection, useWireSessionPort } from '../src/app/hooks/useWireSession.js';
import { createObsClient } from '../src/net/obs.js';
import { createWire } from '../src/net/wire.js';

vi.mock('../src/net/obs.js', () => ({ createObsClient: vi.fn() }));
vi.mock('../src/net/wire.js', () => ({ createWire: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  globalThis.localStorage?.clear();
});

function connectionHarness({
  activeChannelId = '',
  historyMeta = [],
  onWorldChanged,
  refreshHistoryChannel = vi.fn().mockResolvedValue(true),
  setHistoryGrants,
  cancelFeedTask = vi.fn(),
  roster = null,
  memberships = [],
}) {
  const obs = {
    spaceChannels: vi.fn(async () => ({ complete: true, items: [] })),
    spacePrincipals: vi.fn(async () => ({ complete: true, items: [] })),
    spaceActorDescriptions: vi.fn(async () => ({ complete: true, items: [] })),
    spaceDaemons: vi.fn(async () => ({ complete: true, items: [] })),
    channelActors: vi.fn(async () => ({ complete: true, items: [] })),
  };
  vi.mocked(createObsClient).mockReturnValue(obs);
  vi.mocked(createWire).mockImplementation((options) => {
    const detail = {
      boot: 'world-b',
      session: 'session-b',
      generation: 1,
      memberships,
      memberships_complete: true,
      history_meta: historyMeta,
    };
    queueMicrotask(() => {
      void options.onAttach(detail);
      options.onState('attached', detail);
    });
    return { close: vi.fn() };
  });

  const stable = {
    activeChannelRef: { current: activeChannelId },
    accessActionsRef: { current: {} },
    agentActivityRef: { current: { attach: vi.fn(), disconnect: vi.fn() } },
    bumpAccess: vi.fn(),
    cancelFeedTask,
    clearRoster: vi.fn(),
    disconnectHistory: vi.fn(),
    displayError: (error) => error?.message || String(error),
    enqueueFeed: vi.fn(),
    expireSession: vi.fn(),
    finishHistoryPage: vi.fn(),
    finishLiveCheckpoint: vi.fn(),
    onServerWorld: vi.fn(),
    onWorldChanged,
    prepareLocalReplica: vi.fn().mockResolvedValue(undefined),
    principalId: 'root',
    reconcileIdentity: vi.fn(),
    refreshHistoryChannel,
    resetSubmissionWorld: vi.fn(),
    resumeLocalReplica: vi.fn(() => ({})),
    seedRoster: vi.fn(),
    setActiveChannelId: vi.fn(),
    setChannels: vi.fn(),
    setHistoryGrants,
    setTopError: vi.fn(),
    stopIncompatibleFeed: vi.fn(),
  };
  const { result, unmount } = renderHook(() => {
    const port = useWireSessionPort();
    if (roster) port.rosterRef.current = roster;
    useWireConnection({ ...stable, port });
    return port;
  });
  return { cancelFeedTask, obs, result, unmount };
}

describe('server-world reset seam', () => {
  it('waits for the public world reset port before installing new grants', async () => {
    localStorage.setItem('atoll.server.boot.v2', 'world-a');
    let release;
    const events = [];
    const reset = new Promise((resolve) => {
      release = () => { events.push('reset'); resolve(); };
    });
    const onWorldChanged = vi.fn(() => reset);
    const setHistoryGrants = vi.fn(() => { events.push('grants'); return Promise.resolve(); });
    const harness = connectionHarness({ onWorldChanged, setHistoryGrants });
    const access = harness.result.current.accessRef.current;
    access.directoryObserved({
      principals: [],
      actorDescriptions: [{ id: 'old-world@1', name: 'old-world', version: 1, status: 'present' }],
      devices: [],
      support: { principals: true, actorDescriptions: true, devices: true },
    });
    expect(access.directory().actorDescriptions).toEqual([{ id: 'old-world@1', name: 'old-world', version: 1, status: 'present' }]);

    await waitFor(() => expect(onWorldChanged).toHaveBeenCalledTimes(1));
    // The session owner must clear the old world's space directory synchronously
    // at the world boundary, while the public reset waiter still blocks new grants.
    expect(access.directory().actorDescriptions).toEqual([]);
    expect(setHistoryGrants).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(setHistoryGrants).toHaveBeenCalledTimes(1));
    expect(events).toEqual(['reset', 'grants']);
    expect(localStorage.getItem('atoll.server.boot.v2')).toBe('world-b');
    harness.unmount();
    expect(harness.cancelFeedTask).toHaveBeenCalledWith(createWire.mock.results[0].value, 1);
  });

  it('refreshes the focused channel only after the attach grant is installed', async () => {
    const events = [];
    let releaseGrant;
    const setHistoryGrants = vi.fn(() => {
      events.push('grant-start');
      return new Promise((resolve) => {
        releaseGrant = () => {
          events.push('grant-done');
          resolve({ changed: true });
        };
      });
    });
    const refreshHistoryChannel = vi.fn(() => {
      events.push('channel-meta');
      return Promise.resolve(true);
    });
    const harness = connectionHarness({
      activeChannelId: 'c0.project',
      historyMeta: [{ channel_id: 'c0.project', head_seq: 1, has_rows: true }],
      onWorldChanged: vi.fn(),
      refreshHistoryChannel,
      setHistoryGrants,
    });

    await waitFor(() => expect(setHistoryGrants).toHaveBeenCalledTimes(1));
    expect(refreshHistoryChannel).not.toHaveBeenCalled();
    releaseGrant();
    await waitFor(() => expect(refreshHistoryChannel).toHaveBeenCalledWith('c0.project'));
    expect(events).toEqual(['grant-start', 'grant-done', 'channel-meta']);
    harness.unmount();
  });

  it('closes roster authority on transport loss and restores it only after a new attach', async () => {
    const roster = {
      attach: vi.fn((generation) => ({ generation, token: {} })),
      close: vi.fn(),
      noteSelf: vi.fn((channelId, actorId, token) => token ? actorId : ''),
      clearSelf: vi.fn(),
      reset: vi.fn(),
    };
    const harness = connectionHarness({
      onWorldChanged: vi.fn(),
      roster,
      setHistoryGrants: vi.fn().mockResolvedValue({ changed: true }),
    });

    await waitFor(() => expect(harness.result.current.state).toBe('open'));
    const wireOptions = createWire.mock.calls[0][0];
    roster.close.mockClear();
    roster.attach.mockClear();
    act(() => wireOptions.onState('reconnecting', { generation: 1 }));
    expect(roster.close).toHaveBeenCalledTimes(1);

    const next = {
      boot: 'world-b', session: 'session-c', generation: 2,
      memberships: [{ channel_id: 'c0', actor_id: 'human:root:new', status: 'active' }],
      memberships_complete: true, history_meta: [],
    };
    await act(async () => { await wireOptions.onAttach(next); });
    act(() => wireOptions.onState('attached', next));
    expect(roster.attach).toHaveBeenCalledWith(2, next.memberships);
    expect(roster.noteSelf).toHaveBeenCalledWith('c0', 'human:root:new', expect.anything());
    harness.unmount();
  });
});

// 网关推来的成员清单（BATCH3 §12）：历史授予按到达先后装，只在多了新频道时才重装；
// 目录里没有的频道触发一次目录重读。
describe('memberships push', () => {
  const pushFrom = (memberships, historyMeta) => ({
    memberships: memberships.map((channelId) => ({ channel_id: channelId, actor_id: 'human:root' })),
    history_meta: historyMeta ?? memberships.map((channelId) => ({ channel_id: channelId, head_seq: 1 })),
    generation: 1,
  });

  it('lands a push that arrives during a world reset after the attach grants, not before', async () => {
    localStorage.setItem('atoll.server.boot.v2', 'world-a');
    let release;
    const reset = new Promise((resolve) => { release = resolve; });
    const installed = [];
    const setHistoryGrants = vi.fn((entries) => {
      installed.push(entries.map((entry) => entry.channel_id));
      return Promise.resolve({ changed: true });
    });
    const harness = connectionHarness({
      onWorldChanged: vi.fn(() => reset),
      setHistoryGrants,
      historyMeta: [{ channel_id: 'c0', head_seq: 1 }],
      memberships: [{ channel_id: 'c0', actor_id: 'human:root' }],
    });
    await waitFor(() => expect(harness.result.current.state).toBe('open'));
    const wireOptions = createWire.mock.calls[0][0];
    act(() => wireOptions.onMemberships(pushFrom(['c0', 'c0.new'])));
    expect(setHistoryGrants).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(setHistoryGrants).toHaveBeenCalledTimes(2));
    expect(installed).toEqual([['c0'], ['c0', 'c0.new']]);
    harness.unmount();
  });

  it('reinstalls grants only when the push lists a channel that was not a member channel', async () => {
    const setHistoryGrants = vi.fn().mockResolvedValue({ changed: true });
    const harness = connectionHarness({
      onWorldChanged: vi.fn(),
      setHistoryGrants,
      historyMeta: [{ channel_id: 'c0', head_seq: 1 }, { channel_id: 'c0.old', head_seq: 1 }],
      memberships: [{ channel_id: 'c0', actor_id: 'human:root' }, { channel_id: 'c0.old', actor_id: 'human:root' }],
    });
    await waitFor(() => expect(harness.result.current.state).toBe('open'));
    await waitFor(() => expect(setHistoryGrants).toHaveBeenCalledTimes(1));
    const wireOptions = createWire.mock.calls[0][0];
    const access = harness.result.current.accessRef.current;

    // 什么都没变、或只是退出一个频道：不碰历史。
    act(() => wireOptions.onMemberships(pushFrom(['c0', 'c0.old'])));
    act(() => wireOptions.onMemberships(pushFrom(['c0'])));
    await Promise.resolve();
    expect(setHistoryGrants).toHaveBeenCalledTimes(1);
    expect(access.state('c0.old')?.relationship).not.toBe('member');

    // 多了一个频道：按推来的授予重装。
    act(() => wireOptions.onMemberships(pushFrom(['c0', 'c0.new'])));
    await waitFor(() => expect(setHistoryGrants).toHaveBeenCalledTimes(2));
    expect(setHistoryGrants.mock.calls[1][0].map((entry) => entry.channel_id)).toEqual(['c0', 'c0.new']);
    expect(access.state('c0.new')?.relationship).toBe('member');
    harness.unmount();
  });

  it('rereads the channel directory when a pushed channel has no profile yet', async () => {
    const harness = connectionHarness({
      onWorldChanged: vi.fn(),
      setHistoryGrants: vi.fn().mockResolvedValue({ changed: true }),
      memberships: [{ channel_id: 'c0', actor_id: 'human:root' }],
    });
    await waitFor(() => expect(harness.result.current.state).toBe('open'));
    await waitFor(() => expect(harness.obs.spaceChannels).toHaveBeenCalledTimes(1));
    const wireOptions = createWire.mock.calls[0][0];
    const access = harness.result.current.accessRef.current;
    access.channelsObserved([{ id: 'c0', name: 'c0' }, { id: 'c0.known', name: 'known' }], { complete: false });

    act(() => wireOptions.onMemberships(pushFrom(['c0', 'c0.known'])));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(harness.obs.spaceChannels).toHaveBeenCalledTimes(1);

    act(() => wireOptions.onMemberships(pushFrom(['c0', 'c0.known', 'c0.theirs'])));
    await waitFor(() => expect(harness.obs.spaceChannels).toHaveBeenCalledTimes(2));
    harness.unmount();
  });
});
