// @vitest-environment jsdom
// 旧 src/model/space-administration.js（actorTemplateCommand/channelTemplateCommand/
// deviceCommand/isProtectedDeclaration/overlayCommand/parseJSONObject/
// profileCommand/safeChannelDeviceRows/safeDaemonRows/terminalValue）整体删除，
// 无任何独立可导出的替代模块。
//
// 命令构造、保护声明和 overlay 写路径属于产品缺口（详见 S-Z 账本）；
// safeDaemonRows 的公开能力仍有对应入口：WorkspaceApp 使用的
// useWireConnection -> accessRef.directory()。本测从该公开 port 驱动 OBS，
// 不导入 useWireSession.js 的私有投影 helper。
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

function publicConnectionHarness() {
  const obs = {
    spaceChannels: vi.fn(async () => ({ complete: true, items: [] })),
    spacePrincipals: vi.fn(async () => ({ complete: true, items: [] })),
    spaceDecls: vi.fn(async () => ({ complete: true, items: [] })),
    spaceDaemons: vi.fn(async () => ({
      complete: true,
      items: [{
        key: 'd1',
        declared: { id: 'd1', name: 'Mac', status: 'present', key: 'secret' },
        actual: { measures: [{ name: 'online', value: true, unknown: false }] },
      }],
    })),
    channelActors: vi.fn(async () => ({ complete: true, items: [] })),
  };
  vi.mocked(createObsClient).mockReturnValue(obs);
  vi.mocked(createWire).mockImplementation((options) => {
    queueMicrotask(() => options.onState('attached', {
      boot: 'world-a', session: 'session-a', memberships: [], memberships_complete: true,
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
    principalId: 'root',
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
  return { obs, result, unmount };
}

describe('space directory projection (public useWireConnection port)', () => {
  it('does not expose daemon declaration secrets through the directory owner', async () => {
    const harness = publicConnectionHarness();
    await waitFor(() => expect(harness.result.current.accessRef.current).toBeTruthy());
    await waitFor(() => expect(harness.result.current.accessRef.current.directory().devices).toHaveLength(1));

    const devices = harness.result.current.accessRef.current.directory().devices;
    expect(devices[0]).toMatchObject({ id: 'd1', name: 'Mac', status: 'present', online: true });
    // This is intentionally a product regression until the public projection
    // strips non-display declaration fields at loadSpaceDirectory.
    expect(JSON.stringify(devices)).not.toContain('secret');
    harness.unmount();
  });
});
