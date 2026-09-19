// @vitest-environment jsdom
//
// The old roster store and createSessionRoster helper are gone.  The public
// owner is the channel-roster hook, whose committed producer token and
// authority projection are what the workspace and RosterFeature consume.
import React from 'react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChannelRoster } from '../src/app/hooks/useChannelRoster.js';
import { RosterFeature } from '../src/ui/features/roster/RosterFeature.jsx';

afterEach(cleanup);

const actors = [
  { id: 'human:root', kind: 'human', name: 'Root' },
  { id: 'agent:demo:1', kind: 'agent', name: 'Demo' },
];

function setup({ ownerToken = 'attach-1', generation = 4, roster = {} } = {}) {
  const rosterRef = { current: {
    authority: (channelId) => ({ principalId: 'principal-root', channelId, complete: true }),
    ensure: vi.fn(async () => actors),
    refresh: vi.fn(async () => actors),
    self: vi.fn(() => 'human:root'),
  } };
  const reconcileIdentity = vi.fn();
  const hook = renderHook(() => useChannelRoster({
    generationFor: () => generation,
    onError: vi.fn(),
    ownerToken,
    principalId: 'principal-root',
    reconcileIdentity,
    rosterRef,
    versionIncompatibleEpochRef: { current: 0 },
    versionIncompatibleRef: { current: false },
  }));
  if (Object.keys(roster).length) act(() => hook.result.current.seed(roster));
  return { ...hook, rosterRef, reconcileIdentity };
}

describe('public channel roster owner', () => {
  it('publishes a cached roster before network observation is available', () => {
    const { result } = setup({ roster: { c0: actors } });
    expect(result.current.rosters.get('c0')).toEqual(actors);
    expect(result.current.authorities.has('c0')).toBe(false);
  });

  it('marks a complete refresh authoritative for the current principal and channel', async () => {
    const { result, reconcileIdentity } = setup();
    await act(async () => { await result.current.refresh('c0', true); });
    expect(result.current.authorities.get('c0')).toEqual({
      principalId: 'principal-root', channelId: 'c0', generation: 4, current: true,
    });
    expect(reconcileIdentity).toHaveBeenCalledWith('c0', 'human:root');
  });

  it('rejects rows from a stale attach producer instead of replacing the committed roster', () => {
    const { result } = setup({ roster: { c0: actors } });
    act(() => result.current.receive('c0', [{ id: 'stale', kind: 'agent' }], 'old-attach'));
    expect(result.current.rosters.get('c0')).toEqual(actors);
  });

  it('does not label a roster row as the current human when the public identity is unknown', () => {
    render(React.createElement(RosterFeature, {
      port: { rows: [{ id: 'human:root', kind: 'human', name: 'Root' }], selfId: '' },
    }));
    expect(screen.queryByText('我')).toBeNull();
  });

  it('refreshes the public projection after a successful member observation', async () => {
    const { result, rosterRef } = setup();
    rosterRef.current.refresh.mockResolvedValueOnce([
      ...actors,
      { id: 'agent:new:1', kind: 'agent', name: 'New' },
    ]);
    await act(async () => { await result.current.refresh('c0', true); });
    expect(result.current.rosters.get('c0')).toEqual([
      ...actors,
      { id: 'agent:new:1', kind: 'agent', name: 'New' },
    ]);
    expect(result.current.authorities.get('c0')?.current).toBe(true);
  });

  it('clears a channel projection and its authority when membership retires', async () => {
    const { result } = setup();
    await act(async () => { await result.current.refresh('c0', true); });
    act(() => result.current.clearChannel('c0'));
    expect(result.current.rosters.get('c0')).toEqual([]);
    expect(result.current.authorities.has('c0')).toBe(false);
  });
});
