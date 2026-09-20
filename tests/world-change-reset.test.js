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
}) {
  const obs = {
    spaceChannels: vi.fn(async () => ({ complete: true, items: [] })),
    spacePrincipals: vi.fn(async () => ({ complete: true, items: [] })),
    spaceDecls: vi.fn(async () => ({ complete: true, items: [] })),
    spaceDaemons: vi.fn(async () => ({ complete: true, items: [] })),
    channelActors: vi.fn(async () => ({ complete: true, items: [] })),
  };
  vi.mocked(createObsClient).mockReturnValue(obs);
  vi.mocked(createWire).mockImplementation((options) => {
    const detail = {
      boot: 'world-b',
      session: 'session-b',
      generation: 1,
      memberships: [],
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
  return { cancelFeedTask, result, unmount };
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
    expect(access.channelTemplatesObserved([{ id: 'old-world:team', name: '旧世界模板' }])).toBe(true);
    expect(access.directory().channelTemplates).toEqual([{ id: 'old-world:team', name: '旧世界模板' }]);

    await waitFor(() => expect(onWorldChanged).toHaveBeenCalledTimes(1));
    // The session owner must clear Registrar projections synchronously at the
    // world boundary, while the public reset waiter still blocks new grants.
    expect(access.directory().channelTemplates).toBeNull();
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
