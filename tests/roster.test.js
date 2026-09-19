// @vitest-environment jsdom
//
// The old session roster helper is gone. The channel-roster hook owns the
// canonical OBS/cache facts and publishes the authority projection consumed by
// the workspace and RosterFeature.
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChannelRoster } from '../src/app/hooks/useChannelRoster.js';
import { TYPES } from '../src/protocol/vocab.js';
import { ActorDetailPanel, RosterFeature } from '../src/ui/features/roster/RosterFeature.jsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const actors = [
  {
    id: 'human:root', kind: 'human', name: 'Root', decl_id: '', description: '',
    principal: 'principal-root', bound: false, deviceOnline: false,
  },
  {
    id: 'agent:demo:1', kind: 'agent', name: 'Demo', decl_id: '', description: '',
    principal: '', bound: false, deviceOnline: false,
  },
];

function observation(rows) {
  return {
    complete: true,
    items: rows.map((row) => ({
      declared: {
        id: row.id,
        kind: row.kind,
        name: row.name,
        principal: row.principal,
      },
      actual: { measures: [] },
    })),
  };
}

function setup({ ownerToken = 'attach-1', generation = 4, roster = {} } = {}) {
  const obsRef = { current: { channelActors: vi.fn(async () => observation(actors)) } };
  const rosterRef = { current: null };
  const onError = vi.fn();
  const reconcileIdentity = vi.fn();
  const generationRef = { current: generation };
  const versionIncompatibleEpochRef = { current: 0 };
  const versionIncompatibleRef = { current: false };
  const hook = renderHook(({ token }) => useChannelRoster({
    generationFor: () => generationRef.current,
    obsRef,
    onError,
    ownerToken: token,
    principalId: 'principal-root',
    reconcileIdentity,
    rosterRef,
    versionIncompatibleEpochRef,
    versionIncompatibleRef,
  }), { initialProps: { token: ownerToken } });
  if (Object.keys(roster).length) act(() => hook.result.current.seed(roster));
  return { ...hook, generationRef, obsRef, onError, rosterRef, reconcileIdentity };
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

  it('does not label a roster row as the current human when the public identity is unknown', () => {
    render(React.createElement(RosterFeature, {
      port: { rows: [{ id: 'human:root', kind: 'human', name: 'Root' }], selfId: '' },
    }));
    expect(screen.queryByText('我')).toBeNull();
  });

  it('passes the current target authority through the capability invocation port', async () => {
    const authority = { current: true, actorIDs: new Set(['agent:demo:1']) };
    const invoke = vi.fn().mockResolvedValue(true);
    render(React.createElement(ActorDetailPanel, {
      port: {
        selectedActor: { id: 'agent:demo:1', kind: 'agent', name: 'Demo' },
        actorDetail: { capabilities: [{ type: 'agent.compact', label: '压缩上下文' }] },
        targetAuthority: authority,
        commands: { invoke },
      },
    }));

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'agent.compact' } });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '{"depth":1}' } });
    fireEvent.click(screen.getByRole('button', { name: '提交调用' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith({
      actor: expect.objectContaining({ id: 'agent:demo:1' }),
      type: 'agent.compact',
      payload: { depth: 1 },
      targetAuthority: authority,
    }));
  });

  it('refreshes the public projection after a successful member observation', async () => {
    const { result, obsRef } = setup();
    obsRef.current.channelActors.mockResolvedValueOnce(observation([
      ...actors,
      {
        id: 'agent:new:1', kind: 'agent', name: 'New', decl_id: '', description: '',
        principal: '', bound: false, deviceOnline: false,
      },
    ]));
    await act(async () => { await result.current.refresh('c0', true); });
    expect(result.current.rosters.get('c0')).toEqual([
      ...actors,
      {
        id: 'agent:new:1', kind: 'agent', name: 'New', decl_id: '', description: '',
        principal: '', bound: false, deviceOnline: false,
      },
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

  it('does not republish an already-cleared channel projection', () => {
    const { result } = setup();
    act(() => result.current.clearChannel('c0'));
    const cleared = result.current.rosters;
    act(() => result.current.clearChannel('c0'));
    expect(result.current.rosters).toBe(cleared);
  });

  it('rejects a cached ensure from a port after its owner hands off', async () => {
    const { result, obsRef, rosterRef, rerender } = setup({ roster: { c0: actors } });
    const oldPort = rosterRef.current;
    const replacement = [
      ...actors,
      {
        id: 'agent:new-owner:1', kind: 'agent', name: 'New owner', decl_id: '', description: '',
        principal: '', bound: false, deviceOnline: false,
      },
    ];
    obsRef.current.channelActors.mockResolvedValueOnce(observation(replacement));
    rerender({ token: 'attach-2' });

    await expect(oldPort.ensure('c0')).resolves.toBeNull();
    let refreshed;
    await act(async () => { refreshed = await rosterRef.current.ensure('c0'); });
    expect(refreshed).toEqual(replacement);
    expect(obsRef.current.channelActors).toHaveBeenCalledTimes(1);
    expect(result.current.rosters.get('c0')).toEqual(replacement);
  });

  it('refetches cache rows when the committed owner generation advances', async () => {
    const { generationRef, obsRef, rosterRef } = setup({ roster: { c0: actors } });
    const replacement = [
      ...actors,
      {
        id: 'agent:new-generation:1', kind: 'agent', name: 'New generation', decl_id: '', description: '',
        principal: '', bound: false, deviceOnline: false,
      },
    ];
    obsRef.current.channelActors.mockResolvedValueOnce(observation(replacement));
    generationRef.current = 5;

    let refreshed;
    await act(async () => { refreshed = await rosterRef.current.ensure('c0'); });
    expect(refreshed).toEqual(replacement);
    expect(obsRef.current.channelActors).toHaveBeenCalledTimes(1);
  });

  it('cancels a scheduled member refresh when the channel is cleared', () => {
    vi.useFakeTimers();
    const { result, obsRef, rosterRef } = setup();
    act(() => rosterRef.current.handleEnvelope('c0', { type: TYPES.narration.memberCreated }));
    act(() => result.current.clearChannel('c0'));
    act(() => { vi.advanceTimersByTime(301); });
    expect(obsRef.current.channelActors).not.toHaveBeenCalled();
    expect(result.current.rosters.get('c0')).toEqual([]);
  });

  it('fences a late OBS result so a cleared channel cannot be resurrected', async () => {
    let resolveObservation;
    const { result, obsRef } = setup();
    obsRef.current.channelActors.mockReturnValueOnce(new Promise((resolve) => {
      resolveObservation = resolve;
    }));
    let pending;
    act(() => { pending = result.current.refresh('c0', true); });
    act(() => result.current.clearChannel('c0'));
    resolveObservation(observation(actors));
    await act(async () => { await pending; });
    expect(result.current.rosters.get('c0')).toEqual([]);
    expect(result.current.authorities.has('c0')).toBe(false);
  });

  it('does not report a late OBS error after the channel generation is cleared', async () => {
    let rejectObservation;
    const { result, obsRef, onError } = setup();
    obsRef.current.channelActors.mockReturnValueOnce(new Promise((resolve, reject) => {
      rejectObservation = reject;
    }));
    let pending;
    act(() => { pending = result.current.refresh('c0', true); });
    act(() => result.current.clearChannel('c0'));
    rejectObservation(new Error('late OBS failure'));
    await act(async () => { await pending; });
    expect(onError).not.toHaveBeenCalled();
  });
});
