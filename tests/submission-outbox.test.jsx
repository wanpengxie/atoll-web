// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { Suspense, startTransition, useLayoutEffect, useState } from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSubmissions } from '../src/app/hooks/useSubmissions.js';
import { createChannelAccessTracker } from '../src/model/channel-access.js';
import { clearDiagnostics, diagnosticsSnapshot } from '../src/model/diagnostics.js';
import { createOutboxStore } from '../src/model/outbox-store.js';
import { saveSubmissions } from '../src/model/submissions.js';

afterEach(() => {
  clearDiagnostics();
  localStorage.clear();
});

function activeMemberAccess(principalId, channelId = 'c0') {
  const access = createChannelAccessTracker({ principalId });
  access.wire('attached', 'test-session');
  access.channelsObserved([{ id: channelId, status: 'present', open: true }]);
  access.membershipsObserved([{
    principal_id: principalId,
    channel_id: channelId,
    actor_id: `human:${principalId}:1`,
    status: 'active',
  }]);
  return access;
}

describe('offline submission outbox', () => {
  it('does not publish transport authority from a suspended candidate render', async () => {
    const submit = vi.fn().mockResolvedValue({ message_id: 'committed-world-message' });
    const wireRef = { current: { submit } };
    const common = {
      principalId: `commit-port-${globalThis.crypto.randomUUID()}`,
      activeChannelId: 'c0', wireRef,
      rosterRef: { current: { recordSubmission: vi.fn(), observeFeed: vi.fn() } },
      accessRef: { current: { state: () => ({ relationship: 'member', runtime: 'open', unavailable: false }) } },
      channelStatesRef: { current: new Map() },
      onError: vi.fn(), onNotice: vi.fn(), onFeedChanged: vi.fn(), onAccessChanged: vi.fn(),
    };
    let committedApi;
    let release;
    const suspended = new Promise((resolve) => { release = resolve; });
    function Subject({ wireState, block }) {
      const api = useSubmissions({ ...common, wireState });
      useLayoutEffect(() => { committedApi = api; });
      if (block) throw suspended;
      return <p>{wireState}</p>;
    }
    const view = render(<Suspense fallback={<p>fallback</p>}><Subject wireState="open" block={false} /></Suspense>);
    await waitFor(() => expect(committedApi?.pending).toEqual([]));
    const stableCommittedSend = committedApi.send;

    await act(async () => {
      startTransition(() => view.rerender(<Suspense fallback={<p>fallback</p>}><Subject wireState="reconnecting" block /></Suspense>));
    });
    expect(document.body.textContent).toContain('open');

    await act(async () => {
      const original = globalThis.crypto.randomUUID;
      globalThis.crypto.randomUUID = () => 'committed-world-message';
      try {
        await stableCommittedSend({ text: 'use committed open authority', msgType: 'agent.ask', audience: ['agent:a'] });
      } finally {
        globalThis.crypto.randomUUID = original;
      }
    });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    view.unmount();
    release();
  });

  it('reads transport authority at execution time through a stable Composer callback', async () => {
    const submit = vi.fn().mockResolvedValue({ message_id: 'stale-port-message' });
    const wireRef = { current: { submit } };
    const common = {
      principalId: `stale-port-${globalThis.crypto.randomUUID()}`,
      activeChannelId: 'c0', wireRef,
      rosterRef: { current: { recordSubmission: vi.fn(), observeFeed: vi.fn() } },
      accessRef: { current: { state: () => ({ relationship: 'member', runtime: 'open', unavailable: false }) } },
      channelStatesRef: { current: new Map() },
      onError: vi.fn(), onNotice: vi.fn(), onFeedChanged: vi.fn(), onAccessChanged: vi.fn(),
    };
    const { result, rerender } = renderHook(({ wireState }) => useSubmissions({ ...common, wireState }), {
      initialProps: { wireState: 'open' },
    });
    await waitFor(() => expect(result.current.pending).toEqual([]));
    // AppShell intentionally exposes one stable forwarding function. A click
    // can therefore enter an older send closure after a wire-state render; the
    // closure must consult the current authority rather than its old capture.
    const stableComposerPort = result.current.send;
    rerender({ wireState: 'reconnecting' });
    await act(async () => {
      const original = globalThis.crypto.randomUUID;
      globalThis.crypto.randomUUID = () => 'stale-port-message';
      try {
        await stableComposerPort({ text: 'queue, do not transmit', msgType: 'agent.ask', audience: ['agent:a'] });
      } finally {
        globalThis.crypto.randomUUID = original;
      }
    });
    expect(submit).not.toHaveBeenCalled();
    expect(result.current.pending[0]).toMatchObject({ messageId: 'stale-port-message', state: 'queued' });
  });

  it('accepts locally while disconnected and automatically transmits after reconnect', async () => {
    const wireRef = { current: null };
    const submit = vi.fn().mockResolvedValue({ message_id: 'fixed-message' });
    const common = {
      principalId: 'root', activeChannelId: 'c0', wireRef,
      rosterRef: { current: { recordSubmission: vi.fn(), observeFeed: vi.fn() } },
      accessRef: { current: { receipt: vi.fn(), state: () => ({ relationship: 'member', runtime: 'open', unavailable: false }) } }, channelStatesRef: { current: new Map() },
      onError: vi.fn(), onNotice: vi.fn(), onFeedChanged: vi.fn(), onAccessChanged: vi.fn(),
    };
    const { result, rerender } = renderHook(({ wireState }) => useSubmissions({ ...common, wireState }), {
      initialProps: { wireState: 'reconnecting' },
    });
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await act(async () => {
      const original = globalThis.crypto.randomUUID;
      globalThis.crypto.randomUUID = () => 'fixed-message';
      try {
        await result.current.send({ text: 'offline', msgType: 'agent.ask', audience: ['agent:a'] });
      } finally {
        globalThis.crypto.randomUUID = original;
      }
    });
    expect(submit).not.toHaveBeenCalled();
    expect(result.current.pending[0]).toMatchObject({ state: 'queued', text: 'offline' });

    wireRef.current = { submit };
    rerender({ wireState: 'open' });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.pending[0]?.state).toBe('accepted'));
  });

  it('does not durably queue unknown access, then accepts after membership is confirmed', async () => {
    let relationship = 'unknown';
    const submit = vi.fn().mockResolvedValue({ message_id: 'membership-message' });
    const wireRef = { current: { submit } };
    const common = {
      principalId: 'membership-root', activeChannelId: 'c0', wireState: 'open', wireRef,
      rosterRef: { current: { recordSubmission: vi.fn(), observeFeed: vi.fn() } },
      accessRef: { current: { state: () => ({ relationship, runtime: 'open', unavailable: false }) } },
      channelStatesRef: { current: new Map() },
      onError: vi.fn(), onNotice: vi.fn(), onFeedChanged: vi.fn(), onAccessChanged: vi.fn(),
    };
    const { result, rerender } = renderHook(({ accessVersion }) => useSubmissions({ ...common, accessVersion }), {
      initialProps: { accessVersion: 0 },
    });
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await expect(act(async () => {
      const original = globalThis.crypto.randomUUID;
      globalThis.crypto.randomUUID = () => 'membership-message';
      try {
        await result.current.send({ text: 'wait for membership', msgType: 'agent.ask', audience: ['agent:a'] });
      } finally {
        globalThis.crypto.randomUUID = original;
      }
    })).rejects.toThrow('没有已确认的频道成员权限');
    expect(submit).not.toHaveBeenCalled();
    expect(result.current.pending).toEqual([]);

    relationship = 'member';
    rerender({ accessVersion: 1 });
    await act(async () => {
      const original = globalThis.crypto.randomUUID;
      globalThis.crypto.randomUUID = () => 'membership-message';
      try {
        await result.current.send({ text: 'confirmed membership', msgType: 'agent.ask', audience: ['agent:a'] });
      } finally {
        globalThis.crypto.randomUUID = original;
      }
    });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.pending[0]?.state).toBe('accepted'));
  });

  it('keeps a retryable unavailable refusal queued and reuses its stable id once service recovers', async () => {
    const principalId = `retryable-unavailable-${globalThis.crypto.randomUUID()}`;
    const access = activeMemberAccess(principalId);
    const submit = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('channel is not serving'), { code: 'channel_unavailable' }))
      .mockResolvedValueOnce({ message_id: 'retryable-unavailable-message' });
    const common = {
      principalId,
      activeChannelId: 'c0', wireState: 'open', wireRef: { current: { submit } },
      rosterRef: { current: { recordSubmission: vi.fn(), forgetSubmission: vi.fn(), observeFeed: vi.fn() } },
      accessRef: { current: access },
      channelStatesRef: { current: new Map() },
      onError: vi.fn(), onNotice: vi.fn(), onFeedChanged: vi.fn(), onAccessChanged: vi.fn(),
    };
    const { result, rerender } = renderHook(({ accessVersion }) => useSubmissions({ ...common, accessVersion }), {
      initialProps: { accessVersion: 0 },
    });
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await act(async () => {
      const original = globalThis.crypto.randomUUID;
      globalThis.crypto.randomUUID = () => 'retryable-unavailable-message';
      try {
        await result.current.send({ text: 'keep this intent', msgType: 'agent.ask', audience: ['agent:a'] });
      } finally {
        globalThis.crypto.randomUUID = original;
      }
    });
    await waitFor(() => expect(result.current.pending[0]).toMatchObject({
      messageId: 'retryable-unavailable-message', state: 'queued',
      error: { code: 'channel_unavailable' },
    }));
    expect(access.state('c0')).toMatchObject({
      existence: 'present', relationship: 'member', unavailable: true, reason: 'channel_unavailable',
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));
    expect(submit).toHaveBeenCalledOnce();

    access.channelsObserved([{ id: 'c0', status: 'present', open: true }]);
    rerender({ accessVersion: 1 });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.pending[0]?.state).toBe('accepted'));
    expect(submit.mock.calls.map(([frame]) => frame.id)).toEqual([
      'retryable-unavailable-message',
      'retryable-unavailable-message',
    ]);
  });

  it.each([
    ['revoked membership', { existence: 'present', relationship: 'denied', runtime: 'open', unavailable: false }, 'forbidden'],
    ['retired channel', { existence: 'retired', relationship: 'member', runtime: 'closed', unavailable: false }, 'channel_not_found'],
  ])('rejects an unattempted queued intent after %s without deleting its draft or auto-reviving it', async (_label, deniedState, code) => {
    const principalId = `queued-access-${code}-${globalThis.crypto.randomUUID()}`;
    const access = activeMemberAccess(principalId);
    const submit = vi.fn().mockResolvedValue({ message_id: `queued-${code}` });
    const common = {
      principalId,
      activeChannelId: 'c0', wireRef: { current: null },
      rosterRef: { current: { recordSubmission: vi.fn(), forgetSubmission: vi.fn(), observeFeed: vi.fn() } },
      accessRef: { current: access },
      channelStatesRef: { current: new Map() },
      onError: vi.fn(), onNotice: vi.fn(), onFeedChanged: vi.fn(), onAccessChanged: vi.fn(),
    };
    const { result, rerender } = renderHook(({ wireState, accessVersion }) => useSubmissions({
      ...common, wireState, accessVersion,
    }), { initialProps: { wireState: 'reconnecting', accessVersion: 0 } });
    await waitFor(() => expect(result.current.pending).toEqual([]));
    await act(async () => {
      await result.current.updateDraft('c0', { text: 'preserve my draft', editorRevision: 1 });
      const original = globalThis.crypto.randomUUID;
      globalThis.crypto.randomUUID = () => `queued-${code}`;
      try {
        await result.current.send({ text: 'preserve my queued content', msgType: 'agent.ask', audience: ['agent:a'] });
      } finally {
        globalThis.crypto.randomUUID = original;
      }
    });
    expect(result.current.pending[0]?.state).toBe('queued');

    if (deniedState.existence === 'retired') access.retire('c0');
    else access.membershipsObserved([{ principal_id: principalId, channel_id: 'c0', status: 'revoked' }]);
    common.wireRef.current = { submit };
    rerender({ wireState: 'open', accessVersion: 1 });
    await waitFor(() => expect(result.current.pending[0]).toMatchObject({
      messageId: `queued-${code}`, state: 'rejected', error: { code },
    }));
    expect(result.current.draftFor('c0')).toMatchObject({ text: 'preserve my draft' });
    expect(submit).not.toHaveBeenCalled();

    if (code === 'forbidden') {
      access.membershipsObserved([{
        principal_id: principalId, channel_id: 'c0', actor_id: `human:${principalId}:2`, status: 'active',
      }]);
    }
    rerender({ wireState: 'open', accessVersion: 2 });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(result.current.pending[0]?.state).toBe('rejected');
    expect(submit).not.toHaveBeenCalled();
  });

  it('does not downgrade an in-flight submission when access changes before its accepted receipt', async () => {
    const principalId = `late-accepted-${globalThis.crypto.randomUUID()}`;
    const access = activeMemberAccess(principalId);
    let resolveReceipt;
    const receipt = new Promise((resolve) => { resolveReceipt = resolve; });
    const submit = vi.fn(() => receipt);
    const common = {
      principalId,
      activeChannelId: 'c0', wireRef: { current: { submit } },
      rosterRef: { current: { recordSubmission: vi.fn(), observeFeed: vi.fn() } },
      accessRef: { current: access },
      channelStatesRef: { current: new Map() },
      onError: vi.fn(), onNotice: vi.fn(), onFeedChanged: vi.fn(), onAccessChanged: vi.fn(),
    };
    const { result, rerender } = renderHook(({ accessVersion }) => useSubmissions({ ...common, wireState: 'open', accessVersion }), {
      initialProps: { accessVersion: 0 },
    });
    await waitFor(() => expect(result.current.pending).toEqual([]));
    await act(async () => {
      const original = globalThis.crypto.randomUUID;
      globalThis.crypto.randomUUID = () => 'late-accepted-message';
      try {
        await result.current.send({ text: 'already in flight', msgType: 'agent.ask', audience: ['agent:a'] });
      } finally {
        globalThis.crypto.randomUUID = original;
      }
    });
    await waitFor(() => expect(result.current.pending[0]?.state).toBe('transmitting'));

    access.membershipsObserved([{ principal_id: principalId, channel_id: 'c0', status: 'revoked' }]);
    rerender({ accessVersion: 1 });
    expect(result.current.pending[0]?.state).toBe('transmitting');
    resolveReceipt({ message_id: 'late-accepted-message' });
    await waitFor(() => expect(result.current.pending[0]?.state).toBe('accepted'));
  });

  it('does not durably accept a new submission for a retired channel even if its old relationship was member', async () => {
    const principalId = `retired-durable-${globalThis.crypto.randomUUID()}`;
    const access = activeMemberAccess(principalId);
    access.retire('c0');
    const submit = vi.fn();
    const common = {
      principalId,
      activeChannelId: 'c0', wireState: 'open', wireRef: { current: { submit } },
      rosterRef: { current: { recordSubmission: vi.fn(), observeFeed: vi.fn() } },
      accessRef: { current: access },
      channelStatesRef: { current: new Map() },
      onError: vi.fn(), onNotice: vi.fn(), onFeedChanged: vi.fn(), onAccessChanged: vi.fn(),
    };
    const { result } = renderHook(() => useSubmissions(common));
    await waitFor(() => expect(result.current.pending).toEqual([]));
    await expect(result.current.send({ text: 'must not queue', msgType: 'agent.ask', audience: ['agent:a'] }))
      .rejects.toThrow('没有已确认的频道成员权限');
    expect(result.current.pending).toEqual([]);
    expect(submit).not.toHaveBeenCalled();
  });

  it('does not hot-loop the same durable id while an open wire keeps returning uncertain', async () => {
    const seen = [];
    let concurrent = 0;
    let maxConcurrent = 0;
    const submit = vi.fn((frame) => {
      seen.push(frame.id);
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      concurrent -= 1;
      return Promise.reject(Object.assign(new Error('connection closed'), { code: 'closed' }));
    });
    const wireRef = { current: { submit } };
    const principalId = `uncertain-root-${globalThis.crypto.randomUUID()}`;
    const common = {
      principalId, activeChannelId: 'c0', wireRef,
      rosterRef: { current: { recordSubmission: vi.fn(), observeFeed: vi.fn() } },
      accessRef: { current: { state: () => ({ relationship: 'member', runtime: 'open', unavailable: false }) } },
      channelStatesRef: { current: new Map() },
      onError: vi.fn(), onNotice: vi.fn(), onFeedChanged: vi.fn(),
    };
    const { result, rerender } = renderHook(({ wireState }) => {
      const [accessVersion, setAccessVersion] = useState(0);
      return useSubmissions({
        ...common,
        wireState,
        accessVersion,
        // Match App's production feedback: every failed transport asks the
        // access owner to publish a new revision.
        onAccessChanged: () => setAccessVersion((value) => value + 1),
      });
    }, { initialProps: { wireState: 'open' } });
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await act(async () => {
      const original = globalThis.crypto.randomUUID;
      globalThis.crypto.randomUUID = () => 'same-durable-message';
      try {
        await result.current.send({ text: 'one intent', msgType: 'agent.ask', audience: ['agent:a'] });
      } finally {
        globalThis.crypto.randomUUID = original;
      }
    });
    await waitFor(() => expect(result.current.pending[0]?.state).toBe('uncertain'));
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(new Set(seen)).toEqual(new Set(['same-durable-message']));
    expect(maxConcurrent).toBe(1);

    rerender({ wireState: 'reconnecting' });
    rerender({ wireState: 'open' });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.pending[0]?.state).toBe('uncertain'));
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));
    expect(submit).toHaveBeenCalledTimes(2);
    expect(new Set(seen)).toEqual(new Set(['same-durable-message']));
    expect(maxConcurrent).toBe(1);

    await act(async () => { await result.current.retry(result.current.pending[0]); });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.pending[0]?.state).toBe('uncertain'));
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));
    expect(submit).toHaveBeenCalledTimes(3);
    expect(new Set(seen)).toEqual(new Set(['same-durable-message']));
  });

  it('keeps a definitive rejection visible without self-retrying it', async () => {
    const submit = vi.fn().mockRejectedValue(Object.assign(new Error('forbidden'), { code: 'forbidden' }));
    const common = {
      principalId: `rejected-root-${globalThis.crypto.randomUUID()}`,
      activeChannelId: 'c0', wireRef: { current: { submit } },
      rosterRef: { current: { recordSubmission: vi.fn(), forgetSubmission: vi.fn(), observeFeed: vi.fn(), clearSelf: vi.fn() } },
      accessRef: { current: {
        state: () => ({ relationship: 'member', runtime: 'open', unavailable: false }),
        forbidden: vi.fn(),
      } },
      channelStatesRef: { current: new Map() },
      onError: vi.fn(), onNotice: vi.fn(), onFeedChanged: vi.fn(),
    };
    const { result } = renderHook(() => {
      const [accessVersion, setAccessVersion] = useState(0);
      return useSubmissions({
        ...common,
        wireState: 'open',
        accessVersion,
        onAccessChanged: () => setAccessVersion((value) => value + 1),
      });
    });
    await waitFor(() => expect(result.current.pending).toEqual([]));
    await act(async () => {
      const original = globalThis.crypto.randomUUID;
      globalThis.crypto.randomUUID = () => 'rejected-message';
      try {
        await result.current.send({ text: 'reject once', msgType: 'agent.ask', audience: ['agent:a'] });
      } finally {
        globalThis.crypto.randomUUID = original;
      }
    });
    await waitFor(() => expect(result.current.pending[0]?.state).toBe('rejected'));
    expect(common.rosterRef.current.forgetSubmission).toHaveBeenCalledWith('c0', 'rejected-message');
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));
    expect(submit).toHaveBeenCalledOnce();

    await act(async () => { await result.current.retry(result.current.pending[0]); });
    await waitFor(() => expect(result.current.pending[0]?.state).toBe('rejected'));
    expect(submit).toHaveBeenCalledTimes(2);
    expect(common.rosterRef.current.forgetSubmission).toHaveBeenCalledTimes(2);
  });

  it('treats feed-before-receipt as landed without retransmitting or emitting another send phase', async () => {
    let resolveReceipt;
    const receipt = new Promise((resolve) => { resolveReceipt = resolve; });
    const submit = vi.fn(() => receipt);
    const wireRef = { current: { submit } };
    const principalId = `feed-first-${globalThis.crypto.randomUUID()}`;
    const common = {
      principalId, activeChannelId: 'c0', wireRef,
      rosterRef: { current: { recordSubmission: vi.fn(), observeFeed: vi.fn() } },
      accessRef: { current: { state: () => ({ relationship: 'member', runtime: 'open', unavailable: false }) } },
      channelStatesRef: { current: new Map() },
      onError: vi.fn(), onNotice: vi.fn(), onFeedChanged: vi.fn(), onAccessChanged: vi.fn(),
    };
    const { result, rerender } = renderHook(({ wireState, accessVersion }) => useSubmissions({
      ...common, wireState, accessVersion,
    }), { initialProps: { wireState: 'open', accessVersion: 0 } });
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await act(async () => {
      const original = globalThis.crypto.randomUUID;
      globalThis.crypto.randomUUID = () => 'feed-first-message';
      try {
        await result.current.send({ text: 'race', msgType: 'agent.ask', audience: ['agent:a'] });
      } finally {
        globalThis.crypto.randomUUID = original;
      }
    });
    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    // Feed publication can repeat before React commits pending removal. The
    // durable id must still have one cleanup/log phase and one transmit.
    act(() => {
      result.current.reconcileFeed(new Set(['feed-first-message']), new Set());
      result.current.reconcileFeed(new Set(['feed-first-message']), new Set());
    });
    await waitFor(() => expect(result.current.pending).toEqual([]));

    resolveReceipt({ message_id: 'feed-first-message' });
    await act(async () => { await receipt; });
    rerender({ wireState: 'open', accessVersion: 1 });
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(submit).toHaveBeenCalledOnce();
    const diagnostics = diagnosticsSnapshot();
    expect(diagnostics.filter((entry) => (
      entry.event === 'submission.outbox_accepted'
      && entry.detail?.messageIds?.includes('feed-first-message')
    ))).toHaveLength(1);
    expect(diagnostics.filter((entry) => (
      entry.event === 'submission.feed_landed'
      && entry.detail?.messageIds?.includes('feed-first-message')
    ))).toHaveLength(1);
    const phases = diagnostics.filter((entry) => entry.detail?.messageId === 'feed-first-message');
    expect(phases.filter((entry) => entry.event === 'submission.transmit_started')).toHaveLength(1);
    expect(phases.filter((entry) => entry.event === 'submission.receipt_accepted')).toHaveLength(1);
  });

  it('treats receipt-before-feed as one attempt and leaves rejection/retry decisions to the user', async () => {
    const submit = vi.fn().mockResolvedValue({ message_id: 'receipt-first-message' });
    const common = {
      principalId: `receipt-first-${globalThis.crypto.randomUUID()}`,
      activeChannelId: 'c0', wireState: 'open', wireRef: { current: { submit } },
      rosterRef: { current: { recordSubmission: vi.fn(), observeFeed: vi.fn() } },
      accessRef: { current: { state: () => ({ relationship: 'member', runtime: 'open', unavailable: false }) } },
      channelStatesRef: { current: new Map() },
      onError: vi.fn(), onNotice: vi.fn(), onFeedChanged: vi.fn(), onAccessChanged: vi.fn(),
    };
    const { result, rerender } = renderHook(({ accessVersion }) => useSubmissions({ ...common, accessVersion }), {
      initialProps: { accessVersion: 0 },
    });
    await waitFor(() => expect(result.current.pending).toEqual([]));
    await act(async () => {
      const original = globalThis.crypto.randomUUID;
      globalThis.crypto.randomUUID = () => 'receipt-first-message';
      try {
        await result.current.send({ text: 'receipt first', msgType: 'agent.ask', audience: ['agent:a'] });
      } finally {
        globalThis.crypto.randomUUID = original;
      }
    });
    await waitFor(() => expect(result.current.pending[0]?.state).toBe('accepted'));
    act(() => result.current.reconcileFeed(new Set(['receipt-first-message']), new Set()));
    await waitFor(() => expect(result.current.pending).toEqual([]));
    rerender({ accessVersion: 1 });
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(submit).toHaveBeenCalledOnce();
  });

  it('does not resurrect a ledger-confirmed id when feed races principal hydration', async () => {
    const principalId = `hydrate-race-${globalThis.crypto.randomUUID()}`;
    const messageId = 'already-landed-message';
    const store = createOutboxStore();
    await store.putMany(principalId, [{
      key: messageId,
      messageId,
      channelId: 'c0',
      state: 'queued',
      frame: { id: messageId, channel_id: 'c0', msg_type: 'agent.ask', payload: { text: 'once' } },
      createdAt: 1,
      updatedAt: 1,
      error: null,
    }]);
    store.close();
    const submit = vi.fn().mockResolvedValue({ message_id: messageId });
    const common = {
      principalId, activeChannelId: 'c0', wireRef: { current: { submit } },
      rosterRef: { current: { recordSubmission: vi.fn(), observeFeed: vi.fn() } },
      accessRef: { current: { state: () => ({ relationship: 'member', runtime: 'open', unavailable: false }) } },
      channelStatesRef: { current: new Map() },
      onError: vi.fn(), onNotice: vi.fn(), onFeedChanged: vi.fn(), onAccessChanged: vi.fn(),
    };
    const { result, rerender } = renderHook(({ wireState }) => useSubmissions({ ...common, wireState }), {
      initialProps: { wireState: 'reconnecting' },
    });
    act(() => result.current.reconcileFeed(new Set([messageId]), new Set()));
    await waitFor(() => expect(result.current.pending).toEqual([]));

    rerender({ wireState: 'open' });
    await act(() => new Promise((resolve) => setTimeout(resolve, 40)));
    expect(submit).not.toHaveBeenCalled();
    const verify = createOutboxStore();
    expect((await verify.restore(principalId)).some((item) => item.messageId === messageId)).toBe(false);
    verify.close();
  });

  it('does not resurrect a ledger-confirmed legacy id when feed races its migration', async () => {
    const principalId = `legacy-hydrate-race-${globalThis.crypto.randomUUID()}`;
    const messageId = 'already-landed-legacy-message';
    saveSubmissions(principalId, [{
      key: messageId,
      messageId,
      channelId: 'c0',
      state: 'queued',
      frame: { id: messageId, channel_id: 'c0', msg_type: 'agent.ask', payload: { text: 'once' } },
      createdAt: 1,
      updatedAt: 1,
      error: null,
    }]);
    const submit = vi.fn().mockResolvedValue({ message_id: messageId });
    const common = {
      principalId, activeChannelId: 'c0', wireRef: { current: { submit } },
      rosterRef: { current: { recordSubmission: vi.fn(), observeFeed: vi.fn() } },
      accessRef: { current: { state: () => ({ relationship: 'member', runtime: 'open', unavailable: false }) } },
      channelStatesRef: { current: new Map() },
      onError: vi.fn(), onNotice: vi.fn(), onFeedChanged: vi.fn(), onAccessChanged: vi.fn(),
    };
    const { result, rerender } = renderHook(({ wireState }) => useSubmissions({ ...common, wireState }), {
      initialProps: { wireState: 'reconnecting' },
    });
    act(() => result.current.reconcileFeed(new Set([messageId]), new Set()));
    await waitFor(() => expect(result.current.pending).toEqual([]));

    rerender({ wireState: 'open' });
    await act(() => new Promise((resolve) => setTimeout(resolve, 40)));
    expect(submit).not.toHaveBeenCalled();
    const verify = createOutboxStore();
    expect((await verify.restore(principalId)).some((item) => item.messageId === messageId)).toBe(false);
    verify.close();
  });

  it('atomically accepts immutable frames without consuming a newer draft', async () => {
    const store = createOutboxStore({ databaseName: `outbox-test-${crypto.randomUUID()}` });
    const first = await store.writeDraft('root', 'c0', { text: 'first', editorRevision: 1 }, 0);
    const newer = await store.writeDraft('root', 'c0', { text: 'newer', editorRevision: 2 }, first.record.revision);
    const submission = {
      key: 'c0:m1', channelId: 'c0', messageId: 'm1', state: 'queued',
      frame: { id: 'm1', channel_id: 'c0', msg_type: 'agent.ask', payload: { text: 'first' } },
      createdAt: 1, updatedAt: 1,
    };
    const result = await store.acceptDraft({
      principalId: 'root', channelId: 'c0', expectedRevision: first.record.revision,
      editorRevision: 1, submissions: [submission],
    });
    expect(result).toMatchObject({ accepted: true, consumed: false });
    expect((await store.restore('root'))[0].frame.payload.text).toBe('first');
    expect((await store.restoreDrafts('root'))[0]).toMatchObject({ revision: newer.record.revision, draft: { text: 'newer' } });
    store.close();
  });
});
