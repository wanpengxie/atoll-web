// @vitest-environment jsdom
//
// Attach identity is committed by the session owner and projected through the
// public channel-roster hook.  This test deliberately does not import the
// private createSessionRoster helper from useWireSession.js.
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useChannelRoster } from '../src/app/hooks/useChannelRoster.js';

function rosterHook() {
  const rosterRef = { current: { authority: () => null, self: () => '' } };
  return renderHook(() => useChannelRoster({
    generationFor: () => 1,
    onError: vi.fn(),
    ownerToken: 'attach-1',
    principalId: 'root',
    reconcileIdentity: vi.fn(),
    rosterRef,
    versionIncompatibleEpochRef: { current: 0 },
    versionIncompatibleRef: { current: false },
  }));
}

describe('attach roster publication through the public owner', () => {
  it('publishes an attach roster immediately for the current producer', () => {
    const { result } = rosterHook();
    const rows = [{ id: 'human:root:1', kind: 'human', principal: 'root' }];
    act(() => result.current.receive('c0', rows, 'attach-1'));
    expect(result.current.rosters.get('c0')).toEqual(rows);
  });

  it('does not duplicate an identical attach roster', () => {
    const { result } = rosterHook();
    const rows = [{ id: 'human:root:1', kind: 'human', principal: 'root' }];
    act(() => {
      result.current.receive('c0', rows, 'attach-1');
      result.current.receive('c0', rows, 'attach-1');
    });
    expect(result.current.rosters.get('c0')).toEqual(rows);
  });

  it('ignores an attach roster from a retired producer', () => {
    const { result } = rosterHook();
    const current = [{ id: 'human:root:2', kind: 'human', principal: 'root' }];
    act(() => {
      result.current.receive('c0', current, 'attach-1');
      result.current.receive('c0', [{ id: 'human:root:1', kind: 'human' }], 'attach-0');
    });
    expect(result.current.rosters.get('c0')).toEqual(current);
  });

  it('clears the projected identity surface when the channel is no longer current', () => {
    const { result } = rosterHook();
    act(() => {
      result.current.receive('c0', [{ id: 'human:root:1', kind: 'human' }], 'attach-1');
      result.current.clearChannel('c0');
    });
    expect(result.current.rosters.get('c0')).toEqual([]);
  });
});
