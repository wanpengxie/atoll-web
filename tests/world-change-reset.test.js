// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
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

function connectionHarness({ onWorldChanged, setHistoryGrants }) {
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
      history_meta: [],
    };
    queueMicrotask(() => {
      void options.onAttach(detail);
      options.onState('attached', detail);
    });
    return { close: vi.fn() };
  });

  const stable = {
    activeChannelRef: { current: '' },
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
    onWorldChanged,
    prepareLocalReplica: vi.fn().mockResolvedValue(undefined),
    principalId: 'root',
    reconcileIdentity: vi.fn(),
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
    useWireConnection({ ...stable, port });
    return port;
  });
  return { result, unmount };
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

    await waitFor(() => expect(onWorldChanged).toHaveBeenCalledTimes(1));
    expect(setHistoryGrants).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(setHistoryGrants).toHaveBeenCalledTimes(1));
    expect(events).toEqual(['reset', 'grants']);
    expect(localStorage.getItem('atoll.server.boot.v2')).toBe('world-b');
    harness.unmount();
  });
});
