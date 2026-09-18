// @vitest-environment jsdom
import React, { StrictMode } from 'react';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const doubles = vi.hoisted(() => ({
  cache: null,
}));

vi.mock('../src/model/feed-cache.js', () => ({
  createFeedCache: () => doubles.cache,
  resumeSnapshot: (meta) => Object.fromEntries([...meta].map(([channelId, value]) => [channelId, value.newestSeq || 0])),
}));

vi.mock('../src/ui/timeline/LegendMessageList.jsx', async () => ({
  MessageList: (await import('./helpers/PresentationMessageList.jsx')).PresentationMessageList,
}));

import { useChannelFeed } from '../src/app/hooks/useChannelFeed.js';
import { createAgentActivityTracker } from '../src/model/agent-activity.js';
import { setDeviceProfile } from '../src/model/device-profile.js';
import { apply, createChannelState } from '../src/model/fold.js';
import { createRoster } from '../src/model/roster.js';
import { Timeline } from '../src/ui/Timeline.jsx';

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
  setDeviceProfile('');
  cleanup();
  vi.restoreAllMocks();
});

describe('channel feed startup lanes', () => {
  it('keeps an inactive rail unknown until cached unread context and its parent are folded', async () => {
    let resolveContext;
    const context = new Promise((resolve) => { resolveContext = resolve; });
    const meta = new Map([['c1', {
      newestSeq: 3, rowCount: 3, coverage: [{ lowSeq: 1, highSeq: 3 }],
    }]]);
    doubles.cache = {
      ensureOwner: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      ensureBoot: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      readBefore: vi.fn(async () => ({ rows: [], exhausted: true, bytes: 0 })),
      readNotificationContext: vi.fn(() => context),
      saveRows: vi.fn(async () => {}), saveCoverage: vi.fn(async () => {}),
      metaSnapshot: vi.fn(() => meta), clear: vi.fn(async () => {}),
    };
    const hook = renderHook(() => useChannelFeed(feedProps()));
    act(() => {
      hook.result.current.cursorsRef.current.selectReadAuthority({ principalId: 'root', serverBoot: 'boot-a' });
      hook.result.current.cursorsRef.current.markRead('c1', 1);
    });
    await act(async () => { await hook.result.current.prepareLocalReplica('root', { focus: 'c0' }); });
    expect(hook.result.current.unreadFor('c1')).toMatchObject({ related: 0, total: 0, pending: true });

    await act(async () => {
      resolveContext({
        complete: true, cancelled: false, missingParents: [],
        rows: [
          {
            channel_id: 'c1', seq: 1,
            envelope: {
              id: 'cached-request', kind: 'request', type: 'human.ask', visibility: 'public',
              sender: { id: 'human:other:1', kind: 'human' }, audience: ['human:root:1'], payload: { text: 'question' },
            },
          },
          {
            channel_id: 'c1', seq: 3,
            envelope: {
              id: 'cached-final', parent_id: 'cached-request', kind: 'response', type: 'human.ask', visibility: 'public',
              sender: { id: 'agent:worker:1', kind: 'agent' }, audience: ['human:root:1'], payload: { status: 'completed', text: 'answer' },
            },
          },
        ],
      });
      await context;
    });
    await waitFor(() => expect(hook.result.current.unreadFor('c1').total).toBe(1));
    expect(hook.result.current.unreadFor('c1')).not.toHaveProperty('pending');
    expect(hook.result.current.statesRef.current.get('c1')?.turns.has('cached-request')).toBe(true);
    hook.unmount();
  });

  it('rejects a cached notification completion after a boot replacement revokes its Replica epoch', async () => {
    let resolveContext;
    const context = new Promise((resolve) => { resolveContext = resolve; });
    const oldMeta = new Map([['c1', {
      newestSeq: 3, rowCount: 2, coverage: [{ lowSeq: 1, highSeq: 3 }],
    }]]);
    const emptyMeta = new Map();
    doubles.cache = {
      ensureOwner: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta: oldMeta })),
      ensureBoot: vi.fn(async () => ({ changed: true, boot: 'boot-b', meta: emptyMeta })),
      readBefore: vi.fn(async () => ({ rows: [], exhausted: true, bytes: 0 })),
      readNotificationContext: vi.fn(() => context),
      saveRows: vi.fn(async () => {}), saveCoverage: vi.fn(async () => {}),
      metaSnapshot: vi.fn(() => emptyMeta), clear: vi.fn(async () => {}),
    };
    const hook = renderHook(() => useChannelFeed(feedProps()));
    act(() => {
      hook.result.current.cursorsRef.current.selectReadAuthority({ principalId: 'root', serverBoot: 'boot-a' });
      hook.result.current.cursorsRef.current.markRead('c1', 1);
    });
    await act(async () => { await hook.result.current.prepareLocalReplica('root', { focus: 'c0' }); });
    expect(hook.result.current.unreadFor('c1')).toMatchObject({ pending: true });

    await act(async () => {
      await hook.result.current.setHistoryGrants([
        { channel_id: 'c0', head_seq: 0, has_rows: false },
      ], { generation: 1, focus: 'c0', boot: 'boot-b' });
    });
    await act(async () => {
      resolveContext({
        complete: true, cancelled: false, missingParents: [],
        rows: [{ channel_id: 'c1', seq: 3, envelope: { id: 'stale-final', kind: 'event', type: 'human.note' } }],
      });
      await context;
    });
    await waitFor(() => expect(hook.result.current.statesRef.current.get('c1')?.rows.has(3)).not.toBe(true));
    expect(hook.result.current.unreadFor('c1')).not.toHaveProperty('pending');
    hook.unmount();
  });

  it('keeps incomplete notification context unknown until the ordinary viewport physically reads it', async () => {
    const meta = new Map([['c1', {
      newestSeq: 3, rowCount: 1, coverage: [{ lowSeq: 3, highSeq: 3 }],
    }]]);
    doubles.cache = {
      ensureOwner: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      ensureBoot: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      readBefore: vi.fn(async () => ({ rows: [], exhausted: true, bytes: 0 })),
      readNotificationContext: vi.fn(async () => ({
        complete: false, cancelled: false, rows: [], missingParents: ['missing-request'],
      })),
      saveRows: vi.fn(async () => {}), saveCoverage: vi.fn(async () => {}),
      metaSnapshot: vi.fn(() => meta), clear: vi.fn(async () => {}),
    };
    const hook = renderHook(() => useChannelFeed(feedProps()));
    act(() => {
      hook.result.current.cursorsRef.current.selectReadAuthority({ principalId: 'root', serverBoot: 'boot-a' });
      hook.result.current.cursorsRef.current.markRead('c1', 1);
    });
    await act(async () => { await hook.result.current.prepareLocalReplica('root', { focus: 'c0' }); });
    await waitFor(() => expect(hook.result.current.unreadFor('c1')).toMatchObject({ unknown: true }));

    act(() => hook.result.current.markRead('c1', { physicalSeq: 3, identities: [] }));
    expect(hook.result.current.unreadFor('c1')).not.toHaveProperty('unknown');
    hook.unmount();
  });

  it('carries the committed producer owner through rAF batching and delayed roster callbacks', async () => {
    const meta = new Map();
    doubles.cache = {
      ensureOwner: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      ensureBoot: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      readBefore: vi.fn(async () => ({ rows: [], exhausted: true, bytes: 0 })),
      saveRows: vi.fn(async () => {}), saveCoverage: vi.fn(async () => {}),
      metaSnapshot: vi.fn(() => meta), clear: vi.fn(async () => {}),
    };
    const ownerA = Object.freeze({ principalId: 'principal-a' });
    const ownerB = Object.freeze({ principalId: 'principal-b' });
    const onSubmissionFeed = vi.fn();
    const onRoster = vi.fn();
    let finishRoster;
    const base = feedProps();
    base.onSubmissionFeed = onSubmissionFeed;
    base.onRoster = onRoster;
    base.rosterRef.current = {
      self: () => '',
      observeFeed: () => '',
      handleEnvelope: (_channelId, _envelope, callback) => { finishRoster = callback; },
    };
    const hook = renderHook(
      ({ ownerToken }) => useChannelFeed({ ...base, ownerToken }),
      { initialProps: { ownerToken: ownerA } },
    );
    await act(async () => {
      await hook.result.current.setHistoryGrants([
        { channel_id: 'c0', head_seq: 0, has_rows: false },
      ], { generation: 1, focus: 'c0', boot: 'boot-a' });
    });
    const oldProducerEnqueue = hook.result.current.enqueue;

    act(() => oldProducerEnqueue({
      source: 'live', generation: 1, channel_id: 'c0', seq: 1,
      envelope: {
        id: 'principal-a-row', kind: 'event', type: 'channel.info',
        sender: { id: 'system:c0:1', kind: 'system' }, payload: {},
      },
    }));
    await waitFor(() => expect(onSubmissionFeed).toHaveBeenCalledOnce());
    expect(onSubmissionFeed.mock.calls[0][2]).toBe(ownerA);
    const finishOwnerARoster = finishRoster;

    act(() => hook.rerender({ ownerToken: ownerB }));
    expect(finishOwnerARoster).toBeTypeOf('function');
    act(() => finishOwnerARoster([{ id: 'agent-a', kind: 'agent' }], null));
    expect(onRoster).toHaveBeenCalledWith('c0', [{ id: 'agent-a', kind: 'agent' }], ownerA);

    // An old producer may still call its stable enqueue after B committed.
    // Its row and checkpoint provenance must be rejected before Replica and
    // cache publication, not merely hidden from submission reconciliation.
    act(() => oldProducerEnqueue({
      source: 'live', generation: 1, channel_id: 'c0', seq: 2,
      envelope: {
        id: 'late-principal-a-row', kind: 'event', type: 'channel.info',
        sender: { id: 'system:c0:1', kind: 'system' }, payload: {},
      },
    }));
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    expect(hook.result.current.statesRef.current.get('c0')?.rows.has(2)).not.toBe(true);
    expect(onSubmissionFeed).toHaveBeenCalledOnce();
    expect(doubles.cache.saveRows.mock.calls.some(([rows]) => rows.some((row) => row.seq === 2))).toBe(false);

    act(() => hook.result.current.enqueue({
      source: 'live', generation: 1, channel_id: 'c0', seq: 3,
      envelope: {
        id: 'principal-b-row', kind: 'event', type: 'channel.info',
        sender: { id: 'system:c0:2', kind: 'system' }, payload: {},
      },
    }));
    await waitFor(() => expect(onSubmissionFeed).toHaveBeenCalledTimes(2));
    expect(onSubmissionFeed.mock.calls[1][2]).toBe(ownerB);
    expect(hook.result.current.statesRef.current.get('c0')?.rows.has(3)).toBe(true);
    hook.unmount();
  });

  it('classifies exact local submission ids before first self discovery without hiding another device', async () => {
    const meta = new Map();
    doubles.cache = {
      ensureOwner: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      ensureBoot: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      readBefore: vi.fn(async () => ({ rows: [], exhausted: true, bytes: 0 })),
      saveRows: vi.fn(async () => {}), saveCoverage: vi.fn(async () => {}),
      metaSnapshot: vi.fn(() => meta), clear: vi.fn(async () => {}),
    };
    const roster = createRoster({ obs: { channelActors: vi.fn() }, me: 'principal-root' });
    const observeFeed = vi.spyOn(roster, 'observeFeed');
    const props = feedProps();
    props.rosterRef.current = roster;
    const hook = renderHook(() => useChannelFeed(props));
    await act(async () => {
      await hook.result.current.setHistoryGrants([
        { channel_id: 'c0', head_seq: 0, has_rows: false },
        { channel_id: 'c1', head_seq: 0, has_rows: false },
      ], { generation: 1, focus: 'c0', boot: 'boot-a' });
    });

    const enqueueRequest = (channelId, seq, id, senderId, principal = 'principal-root') => act(() => hook.result.current.enqueue({
      source: 'live', generation: 1, channel_id: channelId, seq,
      envelope: {
        id, kind: 'request', type: 'human.note', visibility: 'public',
        sender: { id: senderId, kind: 'human', principal }, payload: { text: id },
      },
    }));

    roster.recordSubmission('c0', 'own-first');
    expect(roster.self('c0')).toBe('');
    enqueueRequest('c0', 1, 'own-first', 'human:self:c0');
    await waitFor(() => expect(hook.result.current.statesRef.current.get('c0')?.rows.has(1)).toBe(true));
    expect(hook.result.current.statesRef.current.get('c0')._liveArrivalRevision).toBe(0);
    expect(roster.self('c0')).toBe('human:self:c0');

    enqueueRequest('c0', 2, 'own-known', 'human:self:c0');
    await waitFor(() => expect(hook.result.current.statesRef.current.get('c0')?.rows.has(2)).toBe(true));
    expect(hook.result.current.statesRef.current.get('c0')._liveArrivalRevision).toBe(0);

    // Same principal on another device is still a real external arrival. Only
    // the exact locally-recorded message id may inherit local ownership.
    enqueueRequest('c0', 3, 'other-device', 'human:self:other-device');
    await waitFor(() => expect(hook.result.current.statesRef.current.get('c0')?.rows.has(3)).toBe(true));
    expect(hook.result.current.statesRef.current.get('c0')._liveArrivalRevision).toBe(1);

    roster.recordSubmission('c1', 'late-own');
    enqueueRequest('c1', 1, 'other-before-own', 'human:c1:other', 'principal-other');
    await waitFor(() => expect(hook.result.current.statesRef.current.get('c1')?.rows.has(1)).toBe(true));
    expect(roster.ownsSubmission('c1', 'late-own')).toBe(true);
    enqueueRequest('c1', 2, 'late-own', 'human:self:c1');
    await waitFor(() => expect(hook.result.current.statesRef.current.get('c1')?.rows.has(2)).toBe(true));
    expect(hook.result.current.statesRef.current.get('c1')._liveArrivalRevision).toBe(1);
    expect(roster.self('c1')).toBe('human:self:c1');
    expect(observeFeed).toHaveBeenCalledTimes(5);
    hook.unmount();
    roster.close();
  });

  it('preserves accepted live generation through batching into Agent active, settled and acknowledgement', async () => {
    const meta = new Map();
    doubles.cache = {
      ensureOwner: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      ensureBoot: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      readBefore: vi.fn(async () => ({ rows: [], exhausted: true, bytes: 0 })),
      saveRows: vi.fn(async () => {}), saveCoverage: vi.fn(async () => {}),
      metaSnapshot: vi.fn(() => meta), clear: vi.fn(async () => {}),
    };
    const tracker = createAgentActivityTracker();
    tracker.attach({ boot: 'boot-a', generation: 7 });
    const observed = [];
    const props = feedProps();
    const onSubmissionFeed = vi.fn();
    props.onSubmissionFeed = onSubmissionFeed;
    props.onAgentActivity = (payload, context) => {
      observed.push(payload);
      return tracker.observe(payload, context);
    };
    const hook = renderHook(() => useChannelFeed(props));
    await act(async () => {
      await hook.result.current.setHistoryGrants([
        { channel_id: 'c0', head_seq: 0, has_rows: false },
      ], { generation: 7, focus: 'c0', boot: 'boot-a' });
    });

    act(() => hook.result.current.enqueue({
      source: 'live', generation: 7, channel_id: 'c0', seq: 1,
      envelope: {
        id: 'work-processing', parent_id: 'work', kind: 'response', type: 'agent.ask', ts: 1_000,
        sender: { id: 'agent:steward:7', kind: 'agent' }, payload: { status: 'processing' },
      },
    }));
    await waitFor(() => expect(tracker.snapshot().byChannel.c0?.active).toEqual([
      expect.objectContaining({ requestId: 'work', agentId: 'agent:steward:7' }),
    ]));
    expect(onSubmissionFeed).toHaveBeenCalledTimes(1);
    expect([...onSubmissionFeed.mock.calls[0][0]]).toEqual(['work-processing']);
    expect(observed[0]).toMatchObject({ source: 'live', generation: 7, channel_id: 'c0', seq: 1 });

    act(() => hook.result.current.enqueue({
      source: 'live', generation: 7, channel_id: 'c0', seq: 2,
      envelope: {
        id: 'work-completed', parent_id: 'work', kind: 'response', type: 'agent.ask', ts: 4_000,
        sender: { id: 'agent:steward:7', kind: 'agent' }, payload: { status: 'completed' },
      },
    }));
    await waitFor(() => expect(tracker.snapshot().byChannel.c0?.agents['agent:steward:7'])
      .toEqual({ active: 0, settled: 1, state: 'settled' }));
    expect(onSubmissionFeed).toHaveBeenCalledTimes(2);
    expect([...onSubmissionFeed.mock.calls[1][0]].sort()).toEqual(['work', 'work-completed']);
    expect(observed[1]).toMatchObject({ source: 'live', generation: 7, channel_id: 'c0', seq: 2 });
    expect(tracker.acknowledge('c0', 'agent:steward:7')).toBe(true);
    expect(tracker.snapshot().byChannel).toEqual({});
    hook.unmount();
  });

  it('leaves initial freshness to the explicit channel-entry interest instead of probing twice from attach', async () => {
    const meta = new Map();
    doubles.cache = {
      ensureOwner: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      ensureBoot: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      readBefore: vi.fn(async () => ({ rows: [], exhausted: true, bytes: 0 })),
      saveRows: vi.fn(async () => {}), saveCoverage: vi.fn(async () => {}),
      metaSnapshot: vi.fn(() => meta), clear: vi.fn(async () => {}),
    };
    const channelMeta = vi.fn(async (channelId) => ({
      channel_id: channelId, head_seq: 0, has_rows: false, generation: 1,
    }));
    const props = feedProps();
    props.wireRef.current = {
      channelMeta,
      historyBefore: vi.fn(),
      cancelHistory: vi.fn(async () => {}),
    };
    const hook = renderHook(() => useChannelFeed(props));

    await act(async () => {
      await hook.result.current.setHistoryGrants([
        { channel_id: 'c0', head_seq: 0, has_rows: false },
      ], { generation: 1, focus: 'c0', boot: 'boot-a' });
    });
    expect(channelMeta).not.toHaveBeenCalled();
    expect(hook.result.current.historyFor('c0').sync.interestRevision).toBe(0);

    await act(async () => { await hook.result.current.refreshChannel('c0'); });
    await waitFor(() => expect(hook.result.current.historyFor('c0').sync).toMatchObject({
      interestRevision: 1,
      fulfilledRevision: 1,
    }));
    expect(channelMeta).toHaveBeenCalledOnce();
    hook.unmount();
  });

  it('resumes an empty-channel entry obligation and creates one fresh probe per reconnect or foreground return', async () => {
    const meta = new Map();
    doubles.cache = {
      ensureOwner: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      ensureBoot: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      readBefore: vi.fn(async () => ({ rows: [], exhausted: true, bytes: 0 })),
      saveRows: vi.fn(async () => {}), saveCoverage: vi.fn(async () => {}),
      metaSnapshot: vi.fn(() => meta), clear: vi.fn(async () => {}),
    };
    let generation = 1;
    const channelMeta = vi.fn(async (channelId) => ({
      channel_id: channelId,
      head_seq: 0,
      has_rows: false,
      generation,
    }));
    const props = feedProps();
    props.wireRef.current = {
      channelMeta,
      historyBefore: vi.fn(),
      cancelHistory: vi.fn(async () => {}),
    };
    const hook = renderHook(() => useChannelFeed(props));

    // Entering while disconnected creates the durable obligation. Attach
    // resumes it instead of minting a duplicate, even with no rows or push.
    await act(async () => { await hook.result.current.refreshChannel('c0'); });
    expect(hook.result.current.historyFor('c0').sync).toMatchObject({
      interestRevision: 1,
      fulfilledRevision: 0,
    });
    await act(async () => {
      await hook.result.current.setHistoryGrants([
        { channel_id: 'c0', head_seq: 0, has_rows: false },
      ], { generation, focus: 'c0', boot: 'boot-a' });
    });
    await waitFor(() => expect(hook.result.current.historyFor('c0').sync).toMatchObject({
      interestRevision: 1,
      fulfilledRevision: 1,
    }));
    expect(channelMeta).toHaveBeenCalledTimes(1);

    // A new attach generation is a new freshness boundary after the old
    // obligation was already fulfilled. Repeated Meta in that generation is
    // not another boundary.
    act(() => hook.result.current.disconnectHistory(generation));
    generation = 2;
    await act(async () => {
      await hook.result.current.setHistoryGrants([
        { channel_id: 'c0', head_seq: 0, has_rows: false },
      ], { generation, focus: 'c0', boot: 'boot-a' });
    });
    await waitFor(() => expect(hook.result.current.historyFor('c0').sync).toMatchObject({
      interestRevision: 2,
      fulfilledRevision: 2,
    }));
    expect(channelMeta).toHaveBeenCalledTimes(2);
    await act(async () => {
      await hook.result.current.setHistoryGrants([
        { channel_id: 'c0', head_seq: 0, has_rows: false },
      ], { generation, focus: 'c0', boot: 'boot-a' });
    });
    await act(async () => { await Promise.resolve(); });
    expect(channelMeta).toHaveBeenCalledTimes(2);

    // Returning to a visible tab is an explicit lifecycle interest, not a
    // timer. Merely hiding flushes and creates no probe.
    const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    try {
      // A duplicate visible notification is not a foreground transition and
      // must not manufacture freshness work.
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      await act(async () => { await Promise.resolve(); });
      expect(channelMeta).toHaveBeenCalledTimes(2);

      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      expect(channelMeta).toHaveBeenCalledTimes(2);
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      await waitFor(() => expect(hook.result.current.historyFor('c0').sync).toMatchObject({
        interestRevision: 3,
        fulfilledRevision: 3,
      }));
      expect(channelMeta).toHaveBeenCalledTimes(3);

      act(() => document.dispatchEvent(new Event('visibilitychange')));
      await act(async () => { await Promise.resolve(); });
      expect(channelMeta).toHaveBeenCalledTimes(3);
    } finally {
      if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
      else delete document.visibilityState;
    }
    hook.unmount();
  });

  it('does not probe a revoked active channel and resumes its pending interest when a later generation grants it', async () => {
    const meta = new Map();
    doubles.cache = {
      ensureOwner: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      ensureBoot: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      readBefore: vi.fn(async () => ({ rows: [], exhausted: true, bytes: 0 })),
      saveRows: vi.fn(async () => {}), saveCoverage: vi.fn(async () => {}),
      metaSnapshot: vi.fn(() => meta), clear: vi.fn(async () => {}),
    };
    let generation = 1;
    let resolveOldProbe;
    const oldProbe = new Promise((resolve) => { resolveOldProbe = resolve; });
    const channelMeta = vi.fn((channelId) => (
      channelMeta.mock.calls.length === 1
        ? oldProbe
        : Promise.resolve({ channel_id: channelId, head_seq: 0, has_rows: false, generation })
    ));
    const props = feedProps();
    props.wireRef.current = {
      channelMeta,
      historyBefore: vi.fn(),
      cancelHistory: vi.fn(async () => {}),
    };
    const hook = renderHook(() => useChannelFeed(props));

    await act(async () => {
      await hook.result.current.setHistoryGrants([
        { channel_id: 'c0', head_seq: 0, has_rows: false },
      ], { generation, focus: 'c0', boot: 'boot-a' });
    });
    act(() => { void hook.result.current.refreshChannel('c0'); });
    await waitFor(() => expect(channelMeta).toHaveBeenCalledOnce());

    act(() => hook.result.current.disconnectHistory(generation));
    generation = 2;
    await act(async () => {
      await hook.result.current.setHistoryGrants([], { generation, focus: 'c0', boot: 'boot-a' });
    });
    expect(hook.result.current.historyFor('c0').sync).toMatchObject({
      admitted: false, interestRevision: 1, fulfilledRevision: 0,
    });
    expect(channelMeta).toHaveBeenCalledOnce();
    expect(hook.result.current.historyFor('c0').sync.fulfilledRevision).toBe(0);

    await act(async () => { await hook.result.current.refreshChannel('c0'); });
    expect(channelMeta).toHaveBeenCalledOnce();
    expect(hook.result.current.historyFor('c0').sync).toMatchObject({
      admitted: false, interestRevision: 2, fulfilledRevision: 0,
    });

    act(() => hook.result.current.disconnectHistory(generation));
    generation = 3;
    await act(async () => {
      await hook.result.current.setHistoryGrants([
        { channel_id: 'c0', head_seq: 0, has_rows: false },
      ], { generation, focus: 'c0', boot: 'boot-a' });
    });
    await waitFor(() => expect(hook.result.current.historyFor('c0').sync).toMatchObject({
      admitted: true, interestRevision: 2, fulfilledRevision: 2,
    }));
    expect(channelMeta).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveOldProbe({ channel_id: 'c0', head_seq: 99, has_rows: true, generation: 1 });
      await Promise.resolve();
    });
    expect(hook.result.current.historyFor('c0').sync).toMatchObject({
      admitted: true, fulfilledRevision: 2, targetHead: 0,
    });
    hook.unmount();
  });

  it('turns only a current channel_meta forbidden into authoritative revoke and resumes on a later grant', async () => {
    const meta = new Map();
    doubles.cache = {
      ensureOwner: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      ensureBoot: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      readBefore: vi.fn(async () => ({ rows: [], exhausted: true, bytes: 0 })),
      saveRows: vi.fn(async () => {}), saveCoverage: vi.fn(async () => {}),
      metaSnapshot: vi.fn(() => meta), clear: vi.fn(async () => {}),
    };
    let generation = 1;
    const forbidden = Object.assign(new Error('forbidden'), { code: 'forbidden' });
    const channelMeta = vi.fn((channelId) => (
      channelMeta.mock.calls.length === 1
        ? Promise.reject(forbidden)
        : Promise.resolve({ channel_id: channelId, head_seq: 0, has_rows: false, generation })
    ));
    const access = { live: vi.fn(), forbidden: vi.fn() };
    const roster = { self: vi.fn(() => 'human:self:1'), observeFeed: vi.fn(), handleEnvelope: vi.fn(), clearSelf: vi.fn() };
    const props = feedProps();
    props.accessRef.current = access;
    props.rosterRef.current = roster;
    props.onAccessChanged = vi.fn();
    props.wireRef.current = { channelMeta, historyBefore: vi.fn(), cancelHistory: vi.fn(async () => {}) };
    const hook = renderHook(() => useChannelFeed(props));

    await act(async () => {
      await hook.result.current.setHistoryGrants([
        { channel_id: 'c0', head_seq: 0, has_rows: false },
      ], { generation, focus: 'c0', boot: 'boot-a' });
      await hook.result.current.refreshChannel('c0');
    });
    await waitFor(() => expect(access.forbidden).toHaveBeenCalledWith('c0'));
    expect(roster.clearSelf).toHaveBeenCalledWith('c0');
    expect(props.onAccessChanged).toHaveBeenCalledOnce();
    expect(hook.result.current.historyFor('c0')).toMatchObject({
      attached: false,
      sync: { admitted: false, interestRevision: 1, fulfilledRevision: 0, retryAt: 0 },
    });

    await act(async () => { await hook.result.current.refreshChannel('c0'); });
    expect(channelMeta).toHaveBeenCalledOnce();

    generation = 2;
    await act(async () => {
      await hook.result.current.setHistoryGrants([
        { channel_id: 'c0', head_seq: 0, has_rows: false },
      ], { generation, focus: 'c0', boot: 'boot-a' });
    });
    await waitFor(() => expect(hook.result.current.historyFor('c0')).toMatchObject({
      attached: true,
      sync: { admitted: true, interestRevision: 2, fulfilledRevision: 2 },
    }));
    expect(channelMeta).toHaveBeenCalledTimes(2);
    hook.unmount();
  });

  it('keeps transient channel_meta failures admitted and retryable', async () => {
    const meta = new Map();
    doubles.cache = {
      ensureOwner: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      ensureBoot: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      readBefore: vi.fn(async () => ({ rows: [], exhausted: true, bytes: 0 })),
      saveRows: vi.fn(async () => {}), saveCoverage: vi.fn(async () => {}),
      metaSnapshot: vi.fn(() => meta), clear: vi.fn(async () => {}),
    };
    const channelMeta = vi.fn().mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' }));
    const access = { live: vi.fn(), forbidden: vi.fn() };
    const props = feedProps();
    props.accessRef.current = access;
    props.wireRef.current = { channelMeta, historyBefore: vi.fn(), cancelHistory: vi.fn(async () => {}) };
    const hook = renderHook(() => useChannelFeed(props));
    await act(async () => {
      await hook.result.current.setHistoryGrants([
        { channel_id: 'c0', head_seq: 0, has_rows: false },
      ], { generation: 1, focus: 'c0', boot: 'boot-a' });
      await hook.result.current.refreshChannel('c0');
    });
    await waitFor(() => expect(hook.result.current.historyFor('c0').sync).toMatchObject({
      admitted: true, fulfilledRevision: 0, attempt: 1,
    }));
    expect(access.forbidden).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('does not leave cached access visible when the scheduler resets during a current forbidden probe', async () => {
    const meta = new Map();
    doubles.cache = {
      ensureOwner: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      ensureBoot: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      readBefore: vi.fn(async () => ({ rows: [], exhausted: true, bytes: 0 })),
      saveRows: vi.fn(async () => {}), saveCoverage: vi.fn(async () => {}),
      metaSnapshot: vi.fn(() => meta), clear: vi.fn(async () => {}),
    };
    let rejectProbe;
    const probe = new Promise((_resolve, reject) => { rejectProbe = reject; });
    const access = { live: vi.fn(), forbidden: vi.fn() };
    const props = feedProps();
    props.accessRef.current = access;
    props.onAccessChanged = vi.fn();
    props.wireRef.current = {
      channelMeta: vi.fn(() => probe), historyBefore: vi.fn(), cancelHistory: vi.fn(async () => {}),
    };
    const hook = renderHook(() => useChannelFeed(props));
    await act(async () => {
      await hook.result.current.setHistoryGrants([
        { channel_id: 'c0', head_seq: 0, has_rows: false },
      ], { generation: 1, focus: 'c0', boot: 'boot-a' });
    });
    let pending;
    act(() => { pending = hook.result.current.refreshChannel('c0'); });
    await waitFor(() => expect(props.wireRef.current.channelMeta).toHaveBeenCalledOnce());
    act(() => hook.result.current.clear());
    await act(async () => {
      rejectProbe(Object.assign(new Error('forbidden'), { code: 'forbidden' }));
      await pending;
    });
    expect(access.forbidden).toHaveBeenCalledWith('c0');
    expect(props.onAccessChanged).toHaveBeenCalledOnce();
    expect(hook.result.current.historyFor('c0').sync).toMatchObject({ admitted: false, retryAt: 0 });
    hook.unmount();
  });

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
    expect(hook.result.current.markRead('c0', {
      physicalSeq: 0,
      identities: [{ messageID: 'tail-before-meta', seqHigh: 1 }],
      receipt: { generation: 1, viewKey: 'c0:mine:steward' },
    })).toBe(false);
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
    expect(hook.result.current.markRead('c0', {
      physicalSeq: 0,
      identities: [{ messageID: 'tail-before-meta', seqHigh: 1 }],
      receipt: { generation: 1, viewKey: 'c0:mine:steward' },
    })).toBe(true);
    expect(saveRows).not.toHaveBeenCalled();
    // A brand-new cache has no boot yet. The already-attached remote boot is
    // nevertheless the current read authority while ensureBoot is pending.
    resolveOwner({ changed: false, boot: '', meta });
    await act(async () => { await Promise.resolve(); });
    expect(doubles.cache.ensureBoot).toHaveBeenCalledWith('boot-a');
    expect(hook.result.current.cursorsRef.current.isReadAuthorityReady()).toBe(true);
    await waitFor(() => expect(
      hook.result.current.cursorsRef.current.acknowledgedReadIdentities('c0').get('tail-before-meta'),
    ).toBe(1));
    expect(hook.result.current.cursorsRef.current.read('c0')).toBe(0);
    expect(hook.result.current.cursorsRef.current.acknowledgedReadIdentities('c0')
      .has('outside-filter-or-future')).toBe(false);
    expect(saveRows).not.toHaveBeenCalled();
    resolveBoot({ changed: false, boot: 'boot-a', meta });
    await act(async () => { await preparation; });
    await waitFor(() => expect(saveRows).toHaveBeenCalledOnce());
    hook.unmount();
  });

  it('does not retain rejected pre-Meta receipts across a revoked channel or successor generation', async () => {
    let resolveOwner;
    const owner = new Promise((resolve) => { resolveOwner = resolve; });
    const meta = new Map();
    doubles.cache = {
      ensureOwner: vi.fn(() => owner),
      ensureBoot: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      readBefore: vi.fn(async () => ({ rows: [], exhausted: true, bytes: 0 })),
      saveRows: vi.fn(async () => {}), saveCoverage: vi.fn(async () => {}),
      metaSnapshot: vi.fn(() => meta), clear: vi.fn(async () => {}),
    };
    const hook = renderHook(() => useChannelFeed(feedProps()));
    let preparation;
    act(() => { preparation = hook.result.current.prepareLocalReplica('root', { focus: 'c0' }); });
    expect(hook.result.current.markRead('c0', {
      physicalSeq: 0,
      identities: [{ messageID: 'revoked-generation-one', seqHigh: 10 }],
      receipt: { generation: 1 },
    })).toBe(false);
    expect(hook.result.current.markRead('c1', {
      physicalSeq: 0,
      identities: [{ messageID: 'stale-generation-one', seqHigh: 11 }],
      receipt: { generation: 1 },
    })).toBe(false);

    let grants;
    act(() => {
      grants = hook.result.current.setHistoryGrants([
        { channel_id: 'c1', head_seq: 0, has_rows: false },
      ], { generation: 2, focus: 'c1', boot: 'boot-a' });
    });
    await act(async () => { await Promise.resolve(); });
    expect(hook.result.current.cursorsRef.current.acknowledgedReadIdentities('c0')
      .has('revoked-generation-one')).toBe(false);
    expect(hook.result.current.cursorsRef.current.acknowledgedReadIdentities('c1')
      .has('stale-generation-one')).toBe(false);

    resolveOwner({ changed: false, boot: '', meta });
    await act(async () => { await Promise.all([preparation, grants]); });
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

describe('canonical waiting read path', () => {
  it('has no request-backed log query port and never submits when an old query terminal is observed', async () => {
    const meta = new Map();
    doubles.cache = {
      ensureOwner: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      ensureBoot: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      readBefore: vi.fn(async () => ({ rows: [], exhausted: true, bytes: 0 })),
      saveRows: vi.fn(async () => {}), saveCoverage: vi.fn(async () => {}),
      metaSnapshot: vi.fn(() => meta), clear: vi.fn(async () => {}),
    };
    const submit = vi.fn();
    const props = feedProps();
    props.wireRef.current = { submit };
    const hook = renderHook(() => useChannelFeed(props));

    expect(hook.result.current).not.toHaveProperty('queryLog');
    act(() => hook.result.current.enqueue({
      source: 'live', generation: 7, channel_id: 'c0', seq: 1,
      envelope: {
        id: 'old-query-terminal', parent_id: 'old-query', kind: 'response', type: 'system.log.query',
        visibility: 'public', sender: { id: 'system', kind: 'system' },
        payload: { status: 'completed', head_seq: 50, turns: [] },
      },
    }));
    await waitFor(() => expect(hook.result.current.statesRef.current.get('c0')?.rows.has(1)).toBe(true));
    expect(submit).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('projects accepted live facts through the feed into the real waiting UI without submitting', async () => {
    const meta = new Map();
    doubles.cache = {
      ensureOwner: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      ensureBoot: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      readBefore: vi.fn(async () => ({ rows: [], exhausted: true, bytes: 0 })),
      saveRows: vi.fn(async () => {}), saveCoverage: vi.fn(async () => {}),
      metaSnapshot: vi.fn(() => meta), clear: vi.fn(async () => {}),
    };
    const submit = vi.fn();
    const props = feedProps();
    props.wireRef.current = { submit };
    const agentID = 'agent:a:7';
    const hook = renderHook(() => {
      const feed = useChannelFeed(props);
      return { feed, status: feed.historyFor('c0') };
    });

    await act(async () => {
      await hook.result.current.feed.prepareLocalReplica('human:root', { focus: 'c0' });
      await hook.result.current.feed.setHistoryGrants([
        { channel_id: 'c0', head_seq: 0, has_rows: false },
      ], { generation: 7, focus: 'c0', boot: 'boot-a' });
    });
    act(() => {
      hook.result.current.feed.enqueue({
        source: 'live', generation: 7, channel_id: 'c0', seq: 1,
        envelope: {
          id: 'work', kind: 'request', type: 'agent.ask', sender: { id: 'human:root:1', kind: 'human' },
          audience: [agentID], visibility: 'public', payload: { text: '完整接线任务' },
        },
      });
      hook.result.current.feed.enqueue({
        source: 'live', generation: 7, channel_id: 'c0', seq: 2,
        envelope: {
          id: 'work-queued', parent_id: 'work', kind: 'response', type: 'agent.ask',
          sender: { id: agentID, kind: 'agent' }, audience: ['human:root:1'], visibility: 'public',
          payload: { status: 'queued', controls: [{ word: 'agent.interrupt' }] },
        },
      });
    });
    await waitFor(() => expect(
      hook.result.current.feed.statesRef.current.get('c0')?.turns.get('work')?.latestStatus,
    ).toBe('queued'));

    const state = hook.result.current.feed.statesRef.current.get('c0') || createChannelState('c0');
    const timelineProps = () => ({
      state,
      history: { status: { ...hook.result.current.status, controlCurrent: true } },
      roster: [{ id: 'human:root:1', kind: 'human', name: '我' }, { id: agentID, kind: 'agent', name: 'Agent' }],
      selfId: 'human:root:1',
      pending: [],
      approvalStates: {},
      access: 'member_active',
      capabilityIndex: new Map(),
    });
    const timeline = render(<Timeline {...timelineProps()} />);
    expect(screen.getByRole('region', { name: '等待区' }).textContent).toContain('完整接线任务');
    expect(submit).not.toHaveBeenCalled();

    act(() => hook.result.current.feed.enqueue({
      source: 'live', generation: 7, channel_id: 'c0', seq: 3,
      envelope: {
        id: 'work-done', parent_id: 'work', kind: 'response', type: 'agent.ask',
        sender: { id: agentID, kind: 'agent' }, audience: ['human:root:1'], visibility: 'public',
        payload: { status: 'completed', text: 'done' },
      },
    }));
    await waitFor(() => expect(
      hook.result.current.feed.statesRef.current.get('c0')?.turns.get('work')?.terminal,
    ).toBeTruthy());
    timeline.rerender(<Timeline {...timelineProps()} />);
    expect(screen.queryByRole('region', { name: '等待区' })).toBeNull();
    act(() => hook.result.current.feed.enqueue({
      source: 'live', generation: 7, channel_id: 'c0', seq: 4,
      envelope: {
        id: 'work-late-queued', parent_id: 'work', kind: 'response', type: 'agent.ask',
        sender: { id: agentID, kind: 'agent' }, audience: ['human:root:1'], visibility: 'public',
        payload: { status: 'queued', controls: [{ word: 'agent.interrupt' }] },
      },
    }));
    await waitFor(() => expect(
      hook.result.current.feed.statesRef.current.get('c0')?.turns.get('work')?.latestStatus,
    ).toBe('completed'));
    timeline.rerender(<Timeline {...timelineProps()} />);
    expect(screen.queryByRole('region', { name: '等待区' })).toBeNull();
    expect(submit).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('keeps a terminal-first Gateway suffix closed across mobile trim and the older request page', async () => {
    setDeviceProfile('mobile');
    const meta = new Map();
    doubles.cache = {
      ensureOwner: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      ensureBoot: vi.fn(async () => ({ changed: false, boot: 'boot-a', meta })),
      readBefore: vi.fn(async () => ({ rows: [], exhausted: true, bytes: 0 })),
      saveRows: vi.fn(async () => {}), saveCoverage: vi.fn(async () => {}),
      metaSnapshot: vi.fn(() => meta), clear: vi.fn(async () => {}),
    };
    const historyCalls = [];
    const historyBefore = vi.fn((channelId, beforeSeq, _limit, options) => {
      const ref = `split-page-${historyCalls.length + 1}`;
      historyCalls.push({ channelId, beforeSeq, generation: options.generation, ref, purpose: options.purpose });
      const receipt = Promise.resolve({ accepted: true, channel_id: channelId, generation: options.generation });
      receipt.ref = ref;
      return receipt;
    });
    const props = feedProps();
    props.wireRef.current = { historyBefore, cancelHistory: vi.fn(async () => {}) };
    const hook = renderHook(() => ({ feed: useChannelFeed(props) }));

    await act(async () => {
      await hook.result.current.feed.prepareLocalReplica('human:root', { focus: 'c0' });
      await hook.result.current.feed.setHistoryGrants([
        { channel_id: 'c0', head_seq: 960, has_rows: true },
      ], { generation: 7, focus: 'c0', boot: 'boot-a' });
    });
    await waitFor(() => expect(historyCalls.length).toBeGreaterThanOrEqual(1));
    const suffix = historyCalls[0];
    const terminal = {
      id: 'old-terminal', parent_id: 'old-request', kind: 'response', type: 'agent.ask',
      sender: { id: 'agent:a:7', kind: 'agent' }, audience: ['human:root:1'], visibility: 'public',
      payload: { status: 'completed', text: 'old answer' },
    };
    act(() => {
      for (let seq = 429; seq < 460; seq += 1) hook.result.current.feed.enqueue({
        source: 'history', ref: suffix.ref, generation: 7, channel_id: 'c0', seq,
        envelope: { id: `suffix-noise-${seq}`, kind: 'event', type: 'human.note', payload: { text: 'noise' } },
      });
      hook.result.current.feed.enqueue({
        source: 'history', ref: suffix.ref, generation: 7, channel_id: 'c0', seq: 460, envelope: terminal,
      });
      hook.result.current.feed.pageEnd({
        source: 'history', ref: suffix.ref, generation: 7, channel_id: 'c0', purpose: suffix.purpose,
        head_seq: 960, oldest_seq: 429, scan_low_seq: 429, scan_high_seq: 960,
        next_before_seq: 429, rows: 32, bytes: 4_096, has_older: true,
      });
    });
    await waitFor(() => expect(
      hook.result.current.feed.statesRef.current.get('c0')?._unmatchedByParent.has('old-request'),
    ).toBe(true));

    act(() => {
      for (let seq = 461; seq <= 970; seq += 1) hook.result.current.feed.enqueue({
        source: 'live', generation: 7, channel_id: 'c0', seq,
        envelope: { id: `live-noise-${seq}`, kind: 'event', type: 'human.note', payload: { text: 'noise' } },
      });
    });
    await waitFor(() => expect(hook.result.current.feed.statesRef.current.get('c0')?.rows.size).toBeGreaterThan(500));
    act(() => hook.result.current.feed.markRead('c0', { physicalSeq: 970, identities: [] }));
    const afterTrim = hook.result.current.feed.statesRef.current.get('c0');
    expect(afterTrim.rows.has(460)).toBe(false);
    expect(afterTrim._unmatchedByParent.has('old-request')).toBe(false);
    expect(afterTrim._unmatchedTerminalClosures.get('old-request')).toMatchObject({ seq: 460, closureOnly: true });

    await waitFor(() => expect(historyCalls.length).toBeGreaterThanOrEqual(2));
    const older = historyCalls[1];
    act(() => {
      hook.result.current.feed.enqueue({
        source: 'history', ref: older.ref, generation: 7, channel_id: 'c0', seq: 100,
        envelope: {
          id: 'old-request', kind: 'request', type: 'agent.ask', sender: { id: 'human:root:1', kind: 'human' },
          audience: ['agent:a:7'], visibility: 'public', payload: { text: 'old queued work' },
        },
      });
      hook.result.current.feed.enqueue({
        source: 'history', ref: older.ref, generation: 7, channel_id: 'c0', seq: 101,
        envelope: {
          id: 'old-queued', parent_id: 'old-request', kind: 'response', type: 'agent.ask',
          sender: { id: 'agent:a:7', kind: 'agent' }, audience: ['human:root:1'], visibility: 'public',
          payload: { status: 'queued', controls: [{ word: 'agent.interrupt' }] },
        },
      });
      hook.result.current.feed.pageEnd({
        source: 'history', ref: older.ref, generation: 7, channel_id: 'c0', purpose: older.purpose,
        head_seq: 960, oldest_seq: 100, scan_low_seq: 100, scan_high_seq: 428,
        next_before_seq: 100, rows: 2, bytes: 512, has_older: false,
      });
    });
    await act(async () => {
      await hook.result.current.feed.loadHistory('c0', { revealRows: 32, revealBytes: 1_000_000 });
    });
    await waitFor(() => expect(
      hook.result.current.feed.statesRef.current.get('c0')?.turns.get('old-request'),
    ).toMatchObject({ terminalSeq: 460, latestStatus: 'completed' }));

    const state = hook.result.current.feed.statesRef.current.get('c0');
    render(<Timeline
      state={state}
      history={{ status: { ...hook.result.current.feed.historyFor('c0'), controlCurrent: true } }}
      roster={[]} selfId="human:root:1" pending={[]} approvalStates={{}}
      access="member_active" capabilityIndex={new Map()}
    />);
    expect(screen.queryByRole('region', { name: '等待区' })).toBeNull();
    hook.unmount();
  });

});
