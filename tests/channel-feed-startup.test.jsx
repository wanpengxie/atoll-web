// @vitest-environment jsdom
import React, { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const doubles = vi.hoisted(() => ({
  cache: null,
}));

vi.mock('../src/model/feed-cache.js', () => ({
  createFeedCache: () => doubles.cache,
  resumeSnapshot: (meta) => Object.fromEntries([...meta].map(([channelId, value]) => [channelId, value.newestSeq || 0])),
}));

import { useChannelFeed } from '../src/app/hooks/useChannelFeed.js';

function feedProps() {
  return {
    wireRef: { current: null },
    rosterRef: { current: { self: () => '', observeFeed: () => '', handleEnvelope: () => {} } },
    accessRef: { current: { live: () => {} } },
    activeChannelRef: { current: 'c0' },
    onRoster: () => {}, onError: () => {}, onChannelsDiscovered: () => {},
    onDirectoryInvalidated: () => {}, onTimerFired: () => {},
    onSubmissionFeed: () => {}, onAccessChanged: () => {}, onAgentActivity: () => {},
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('channel feed startup lanes', () => {
  it('commits live before owner/boot persistence is ready and fences the disk write', async () => {
    let resolveOwner;
    let resolveBoot;
    const owner = new Promise((resolve) => { resolveOwner = resolve; });
    const boot = new Promise((resolve) => { resolveBoot = resolve; });
    const meta = new Map();
    const saveRows = vi.fn(async () => {});
    doubles.cache = {
      ensureOwner: vi.fn(() => owner),
      ensureBoot: vi.fn(() => boot),
      readBefore: vi.fn(async () => ({ rows: [], exhausted: true, bytes: 0 })),
      saveRows,
      saveCoverage: vi.fn(async () => {}),
      metaSnapshot: vi.fn(() => meta),
      clear: vi.fn(async () => {}),
    };
    const hook = renderHook(() => useChannelFeed(feedProps()));

    let preparation;
    act(() => { preparation = hook.result.current.prepareLocalReplica('root', { focus: 'c0' }); });
    act(() => {
      void hook.result.current.setHistoryGrants([
        { channel_id: 'c0', head_seq: 0, has_rows: false },
      ], { generation: 1, focus: 'c0', boot: 'boot-a' });
      hook.result.current.enqueue({
        source: 'live', generation: 1, channel_id: 'c0', seq: 1,
        envelope: { id: 'live-1', kind: 'event', type: 'human.note', payload: { text: 'now' } },
      });
    });

    await waitFor(() => expect(hook.result.current.statesRef.current.get('c0')?.rows.has(1)).toBe(true));
    expect(saveRows).not.toHaveBeenCalled();
    resolveOwner({ changed: false, boot: 'boot-a', meta });
    await act(async () => { await Promise.resolve(); });
    expect(doubles.cache.ensureBoot).toHaveBeenCalledWith('boot-a');
    expect(saveRows).not.toHaveBeenCalled();
    resolveBoot({ changed: false, boot: 'boot-a', meta });
    await act(async () => { await preparation; });
    await waitFor(() => expect(saveRows).toHaveBeenCalledOnce());
    hook.unmount();
  });

  it('returns after meta creates queues without waiting for the selected cache body', async () => {
    let resolveBody;
    const body = new Promise((resolve) => { resolveBody = resolve; });
    const meta = new Map([['c0', {
      newestSeq: 100, rowCount: 1, coverage: [{ lowSeq: 1, highSeq: 100 }],
    }]]);
    doubles.cache = {
      ensureOwner: vi.fn(async () => ({ changed: false, meta })),
      ensureBoot: vi.fn(async () => ({ changed: false, meta })),
      readBefore: vi.fn(() => body),
      saveRows: vi.fn(async () => {}),
      saveCoverage: vi.fn(async () => {}),
      metaSnapshot: vi.fn(() => meta),
      clear: vi.fn(async () => {}),
    };
    const hook = renderHook(() => useChannelFeed(feedProps()), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    });

    let prepared;
    await act(async () => {
      prepared = await hook.result.current.prepareLocalReplica('root', { focus: 'c0' });
    });
    expect(prepared).toEqual({ resume: { c0: 100 } });
    expect(doubles.cache.readBefore).toHaveBeenCalledOnce();
    expect(hook.result.current.statesRef.current.has('c0')).toBe(true);

    act(() => hook.result.current.enqueue({
      source: 'live', channel_id: 'c0', seq: 101,
      envelope: { id: 'live', kind: 'event', type: 'human.note', payload: { text: 'live first' } },
    }));
    await waitFor(() => expect(hook.result.current.statesRef.current.get('c0')?.rows.has(101)).toBe(true));
    expect(hook.result.current.statesRef.current.get('c0')?.rows.has(100)).toBe(false);

    resolveBody({
      rows: [{ channel_id: 'c0', seq: 100, envelope: { id: 'cached', kind: 'event', type: 'human.note' } }],
      nextBeforeSeq: 1, exhausted: true, bytes: 10,
    });
    await waitFor(() => expect(hook.result.current.statesRef.current.get('c0')?.rows.has(100)).toBe(true));
    expect([...hook.result.current.statesRef.current.get('c0').rows.keys()].sort((a, b) => a - b)).toEqual([100, 101]);
    hook.unmount();
  });

  it('replay only folds ledger state while live delivery may update live control evidence and invalidate snapshots', async () => {
    const meta = new Map([['c0', {
      newestSeq: 1, rowCount: 1, coverage: [{ lowSeq: 1, highSeq: 1 }],
    }]]);
    doubles.cache = {
      ensureOwner: vi.fn(async () => ({ changed: false, meta })),
      ensureBoot: vi.fn(async () => ({ changed: false, meta })),
      readBefore: vi.fn(async () => ({
        rows: [{
          channel_id: 'c0', seq: 1,
          envelope: { id: 'cached-governance', kind: 'response', type: 'system.channel.set', payload: { status: 'completed' } },
        }],
        nextBeforeSeq: 1, exhausted: true, bytes: 10,
      })),
      saveRows: vi.fn(async () => {}), saveCoverage: vi.fn(async () => {}),
      metaSnapshot: vi.fn(() => meta), clear: vi.fn(async () => {}),
    };
    const access = { live: vi.fn(() => true) };
    const onDirectoryInvalidated = vi.fn();
    const roster = { self: () => '', observeFeed: () => '', handleEnvelope: vi.fn() };
    const hook = renderHook(() => useChannelFeed({
      ...feedProps(), accessRef: { current: access }, rosterRef: { current: roster }, onDirectoryInvalidated,
    }));

    await act(async () => { await hook.result.current.prepareLocalReplica('root', { focus: 'c0' }); });
    await waitFor(() => expect(hook.result.current.statesRef.current.get('c0')?.rows.has(1)).toBe(true));
    expect(access.live).not.toHaveBeenCalled();
    expect(onDirectoryInvalidated).not.toHaveBeenCalled();
    expect(roster.handleEnvelope).not.toHaveBeenCalled();

    act(() => hook.result.current.enqueue({
      source: 'live', generation: 1, channel_id: 'c0', seq: 2,
      envelope: { id: 'live-governance', kind: 'response', type: 'system.channel.set', payload: { status: 'completed' } },
    }));
    await waitFor(() => expect(hook.result.current.statesRef.current.get('c0')?.rows.has(2)).toBe(true));
    expect(access.live).toHaveBeenCalledWith('c0');
    expect(onDirectoryInvalidated).toHaveBeenCalledOnce();
    expect(roster.handleEnvelope).toHaveBeenCalledOnce();
    hook.unmount();
  });
});
