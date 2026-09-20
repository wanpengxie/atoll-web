// @vitest-environment jsdom
//
// Attach identity is committed through the canonical channel-roster port.
// The owner exposes one stable port shared by attach, feed, and UI consumers.
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useChannelRoster } from '../src/app/hooks/useChannelRoster.js';

function rosterHook() {
  const rosterRef = { current: null };
  const obsRef = { current: { channelActors: async () => ({ complete: true, items: [] }) } };
  const versionIncompatibleEpochRef = { current: 0 };
  const versionIncompatibleRef = { current: false };
  const onError = vi.fn();
  const reconcileIdentity = vi.fn();
  const generationFor = () => 1;
  const hook = renderHook(() => useChannelRoster({
    generationFor,
    obsRef,
    onError,
    ownerToken: 'attach-1',
    principalId: 'root',
    reconcileIdentity,
    rosterRef,
    versionIncompatibleEpochRef,
    versionIncompatibleRef,
  }));
  return { ...hook, obsRef, rosterRef };
}

describe('canonical channel roster port', () => {
  it('seeds rows and exposes the same facts through the stable port', () => {
    const { result, rosterRef } = rosterHook();
    const port = rosterRef.current;
    const rows = [{ id: 'human:root:1', kind: 'human', principal: 'root' }];
    act(() => result.current.seed({ c0: rows }));
    expect(rosterRef.current).toBe(port);
    expect(result.current.rosters.get('c0')).toEqual(rows);
    expect(rosterRef.current.get('c0')).toBe(rows);
    act(() => rosterRef.current.noteSelf('c0', rows[0].id));
    expect(rosterRef.current.self('c0')).toBe(rows[0].id);
  });

  it('does not create a second semantic projection for a duplicate attach roster', () => {
    const { result, rosterRef } = rosterHook();
    const rows = [{ id: 'human:root:1', kind: 'human', principal: 'root' }];
    act(() => result.current.seed({ c0: rows }));
    const firstProjection = result.current.rosters.get('c0');
    const port = rosterRef.current;

    act(() => result.current.seed({ c0: rows }));

    expect(rosterRef.current).toBe(port);
    expect(result.current.rosters.get('c0')).toBe(firstProjection);
    expect(result.current.rosters.get('c0')).toHaveLength(1);
  });

  it('does not record an identity when the attach event lacks a channel or actor', () => {
    const { rosterRef } = rosterHook();

    expect(rosterRef.current.noteSelf('', 'human:root:1')).toBe('');
    expect(rosterRef.current.noteSelf('c0', '')).toBe('');
    expect(rosterRef.current.self('c0')).toBe('');
  });

  it('clears the canonical facts when the channel is no longer current', () => {
    const { result, rosterRef } = rosterHook();
    const rows = [{ id: 'human:root:1', kind: 'human', principal: 'root' }];
    act(() => {
      result.current.seed({ c0: rows });
      rosterRef.current.noteSelf('c0', rows[0].id);
      result.current.clearChannel('c0');
    });
    expect(result.current.rosters.get('c0')).toEqual([]);
    expect(rosterRef.current.get('c0')).toEqual([]);
    expect(rosterRef.current.self('c0')).toBe('');
  });
});
