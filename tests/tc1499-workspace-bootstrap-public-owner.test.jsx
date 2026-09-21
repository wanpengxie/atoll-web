// @vitest-environment jsdom
// TC-1499 public composition evidence.  This test drives the same exported
// identity/session/navigation owners that WorkspaceApp composes.  It never
// imports the private access reducer or the cache implementation.
import React, { useCallback, useRef } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const doubles = vi.hoisted(() => ({
  identity: { session: vi.fn(), logout: vi.fn() },
  currentPrincipal: 'root',
  attach: true,
  directoryBlocked: false,
  releaseDirectory: [],
  obs: null,
}));

vi.mock('../src/net/identity.js', () => ({
  createIdentityClient: vi.fn(() => doubles.identity),
}));
vi.mock('../src/net/obs.js', () => ({
  createObsClient: vi.fn(() => doubles.obs),
}));
vi.mock('../src/net/wire.js', () => ({
  createWire: vi.fn((options) => {
    if (doubles.attach) {
      queueMicrotask(() => options.onState('attached', {
        generation: 1,
        boot: 'tc1499-world',
        session: `tc1499-${doubles.currentPrincipal}`,
        memberships: doubles.currentPrincipal === 'root'
          ? [
            { channel_id: 'c0', actor_id: 'human:root', status: 'active' },
            { channel_id: 'c0.project', actor_id: 'human:root-project', status: 'active' },
          ]
          : [],
        memberships_complete: true,
        history_meta: [],
      }));
    }
    return { close: vi.fn() };
  }),
}));

const { useChannelNavigation, useIdentitySession, useWireConnection, useWireSessionPort } =
  await import('../src/app/hooks/useWireSession.js');

const PROFILES = [
  { id: 'c0', name: 'home', qualified_name: 'c0', status: 'present', open: true, owner_principal: 'root' },
  { id: 'c0.project', name: 'project', qualified_name: 'c0.project', status: 'present', open: true, owner_principal: 'root' },
];

function directoryObservation(value) {
  if (!doubles.directoryBlocked) return Promise.resolve(value);
  return new Promise((resolve) => {
    doubles.releaseDirectory.push(() => resolve(value));
  });
}

function publicProfileRows() {
  return PROFILES.map((declared) => ({
    key: declared.id,
    declared,
    actual: { measures: [{ name: 'open', value: declared.open, unknown: false }] },
  }));
}

function renderPublicWorkspaceBoundary() {
  function Probe() {
    const noop = useCallback(() => {}, []);
    const displayError = useCallback((error) => error?.message || String(error), []);
    const [topError, setTopError] = React.useState('');
    const identity = useIdentitySession({ onError: setTopError });
    const principalId = identity.principal?.id || '';
    const port = useWireSessionPort({ principalId });
    const navigation = useChannelNavigation({
      accessRef: port.accessRef,
      rosterRef: port.rosterRef,
      onSelect: noop,
      onNotice: noop,
    });
    const accessActionsRef = useRef({});
    const activeChannelRef = navigation.activeChannelRef;
    const agentActivityRef = useRef({ attach: noop, disconnect: noop });

    useWireConnection({
      accessActionsRef,
      activeChannelRef,
      agentActivityRef,
      bumpAccess: navigation.bump,
      cancelFeedTask: noop,
      disconnectHistory: noop,
      displayError,
      enqueueFeed: noop,
      expireSession: identity.expire,
      finishHistoryPage: noop,
      finishLiveCheckpoint: noop,
      onServerWorld: noop,
      onWorldChanged: noop,
      port,
      prepareLocalReplica: noop,
      principalId,
      reconcileIdentity: noop,
      refreshHistoryChannel: noop,
      resetSubmissionWorld: noop,
      resumeLocalReplica: noop,
      setActiveChannelId: navigation.setActiveChannelId,
      setChannels: navigation.setChannels,
      setHistoryGrants: noop,
      setTopError,
      stopIncompatibleFeed: noop,
    });

    // Keep the rendered facts on the public navigation/access ports.  This is
    // the same projection WorkspaceApp passes to WorkspaceLayout.
    return (
      <main data-testid="tc1499-workspace" data-principal={identity.principal?.id || ''}>
        <output data-testid="tc1499-error">{topError}</output>
        <h1>{navigation.activeChannel?.name || '正在准备工作区'}</h1>
        <ul aria-label="频道目录">
          {navigation.channels.map((channel) => (
            <li
              key={channel.id}
              data-testid={`tc1499-channel-${channel.id}`}
              data-access={channel.access || ''}
              data-self-actor={channel.selfActorId || ''}
            >
              {channel.name || channel.id}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => void identity.logout()}>退出</button>
      </main>
    );
  }
  return render(<Probe />);
}

function setupObs() {
  doubles.obs = {
    spaceChannels: vi.fn((parentId) => directoryObservation({
      complete: true,
      items: parentId ? [] : publicProfileRows(),
    })),
    spacePrincipals: vi.fn(() => directoryObservation({ complete: true, items: [] })),
    spaceDecls: vi.fn(() => directoryObservation({ complete: true, items: [] })),
    spaceDaemons: vi.fn(() => directoryObservation({ complete: true, items: [] })),
  };
}

beforeEach(() => {
  doubles.identity.session.mockReset();
  doubles.identity.logout.mockReset().mockResolvedValue({ ok: true });
  doubles.currentPrincipal = 'root';
  doubles.attach = true;
  doubles.directoryBlocked = false;
  doubles.releaseDirectory = [];
  setupObs();
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ current_version: 'v0.06', latest_version: 'v0.06', available: false, status: 'unsupported' }),
  })));
});

afterEach(() => {
  cleanup();
  for (const release of doubles.releaseDirectory) release();
  doubles.releaseDirectory = [];
  globalThis.localStorage?.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('TC-1499 Workspace bootstrap public owner', () => {
  it('restores the same principal directory on a cold reload before the next directory/attach facts', async () => {
    doubles.identity.session.mockResolvedValue({ id: 'root', display_name: 'Root' });
    const first = renderPublicWorkspaceBoundary();
    await waitFor(() => expect(screen.getByTestId('tc1499-workspace').getAttribute('data-principal')).toBe('root'));
    await waitFor(() => expect(screen.getByTestId('tc1499-channel-c0.project').getAttribute('data-access')).toBe('member_active'));
    expect(screen.getByTestId('tc1499-channel-c0.project').getAttribute('data-self-actor')).toBe('human:root-project');
    first.unmount();

    // Simulate the next browser document while the public OBS and wire facts
    // are still pending.  The cache is exercised only through the exported
    // identity/session/navigation composition, never by importing its model.
    doubles.identity.session.mockResolvedValue({ id: 'root', display_name: 'Root' });
    doubles.directoryBlocked = true;
    doubles.attach = false;
    renderPublicWorkspaceBoundary();
    await waitFor(() => expect(screen.getByTestId('tc1499-workspace').getAttribute('data-principal')).toBe('root'));
    await waitFor(() => expect(screen.getByTestId('tc1499-channel-c0.project').getAttribute('data-access')).toBe('member_active'));
    expect(screen.getByTestId('tc1499-channel-c0.project').getAttribute('data-self-actor')).toBe('human:root-project');
  });

  it('does not project another principal into the cached member directory, then forgets the identity on logout', async () => {
    doubles.identity.session.mockResolvedValue({ id: 'root', display_name: 'Root' });
    const first = renderPublicWorkspaceBoundary();
    await waitFor(() => expect(screen.getByTestId('tc1499-channel-c0.project').getAttribute('data-access')).toBe('member_active'));
    first.unmount();

    doubles.currentPrincipal = 'alice';
    doubles.identity.session.mockResolvedValue({ id: 'alice', display_name: 'Alice' });
    renderPublicWorkspaceBoundary();
    await waitFor(() => expect(screen.getByTestId('tc1499-workspace').getAttribute('data-principal')).toBe('alice'));
    const isolated = await waitFor(() => screen.getByTestId('tc1499-channel-c0.project'));
    expect(isolated.getAttribute('data-access')).toBe('discoverable');
    expect(isolated.getAttribute('data-self-actor')).toBe('');

    fireEvent.click(screen.getByRole('button', { name: '退出' }));
    await waitFor(() => expect(screen.getByTestId('tc1499-workspace').getAttribute('data-principal')).toBe(''));
    expect(doubles.identity.logout).toHaveBeenCalledOnce();
  });
});
