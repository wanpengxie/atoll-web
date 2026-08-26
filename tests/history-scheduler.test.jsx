// @vitest-environment jsdom
import React, { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChannelFeed } from '../src/app/hooks/useChannelFeed.js';
import { createHistoryScheduler, HISTORY_MAX_INFLIGHT } from '../src/model/history-scheduler.js';

function accepted(ref, channelId, generation, purpose) {
  const promise = Promise.resolve({ accepted: true, channel_id: channelId, generation, purpose });
  promise.ref = ref;
  return promise;
}

function requestHarness() {
  let serial = 0;
  const calls = [];
  const requestPage = vi.fn((channelId, beforeSeq, limit, options) => {
    const ref = `history-${++serial}`;
    calls.push({ ref, channelId, beforeSeq, limit, ...options });
    return accepted(ref, channelId, options.generation, options.purpose);
  });
  return { calls, requestPage };
}

function finish(scheduler, call, { oldest = call.beforeSeq - 2, hasOlder = true, rows = 2 } = {}) {
  for (let index = 0; index < rows; index += 1) {
    const seq = oldest + index;
    scheduler.historyRow({
      source: 'history', ref: call.ref, generation: call.generation,
      channel_id: call.channelId, seq,
      envelope: { id: `${call.channelId}-${seq}`, kind: 'event', type: 'human.note', payload: { text: `${seq}` } },
    });
  }
  scheduler.pageEnd({
    source: 'history', ref: call.ref, generation: call.generation,
    channel_id: call.channelId, purpose: call.purpose,
    head_seq: call.beforeSeq, oldest_seq: oldest,
    next_before_seq: oldest, has_older: hasOlder,
  });
}

afterEach(() => vi.restoreAllMocks());

describe('v4 history batch coordinator', () => {
  it('starts several active channels concurrently while respecting the global limit', async () => {
    const harness = requestHarness();
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, revealRows: () => {} });
    scheduler.attach(Array.from({ length: 8 }, (_, index) => ({
      channel_id: `c${index}`, head_seq: 1_000 - index, has_rows: true, last_activity: 100 - index,
    })), { generation: 1, focus: 'c0' });
    await waitFor(() => expect(harness.calls).toHaveLength(HISTORY_MAX_INFLIGHT));
    expect(new Set(harness.calls.map((call) => call.channelId)).size).toBe(HISTORY_MAX_INFLIGHT);
    expect(harness.calls[0].channelId).toBe('c0');
    expect(harness.calls.every((call) => call.beforeSeq === 0)).toBe(true);
    scheduler.destroy();
  });

  it('never runs two batches for one channel and re-scores after completion', async () => {
    const harness = requestHarness();
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, revealRows: () => {} });
    scheduler.attach([{ channel_id: 'c0', head_seq: 1_000, has_rows: true }], { generation: 1, focus: 'c0' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    scheduler.tick();
    expect(harness.calls).toHaveLength(1);
    finish(scheduler, harness.calls[0], { oldest: 800 });
    await waitFor(() => expect(harness.calls).toHaveLength(2));
    expect(harness.calls[1]).toMatchObject({ channelId: 'c0', beforeSeq: 800, purpose: 'hydrate' });
    scheduler.destroy();
  });

  it('routes concurrent rows by ref instead of guessing from seq', async () => {
    const harness = requestHarness();
    const revealed = new Map();
    const scheduler = createHistoryScheduler({
      requestPage: harness.requestPage,
      revealRows: (channelId, rows) => revealed.set(channelId, rows),
    });
    scheduler.attach([
      { channel_id: 'a', head_seq: 100, has_rows: true },
      { channel_id: 'b', head_seq: 100, has_rows: true },
    ], { generation: 1, focus: 'a' });
    await waitFor(() => expect(harness.calls).toHaveLength(2));
    const a = harness.calls.find((call) => call.channelId === 'a');
    const b = harness.calls.find((call) => call.channelId === 'b');
    finish(scheduler, b, { oldest: 90, rows: 1, hasOlder: false });
    finish(scheduler, a, { oldest: 80, rows: 1, hasOlder: false });
    await waitFor(() => expect(revealed.size).toBe(2));
    expect(revealed.get('a')[0][0]).toBe(80);
    expect(revealed.get('b')[0][0]).toBe(90);
    scheduler.destroy();
  });

  it('keeps user demand sticky when the reservoir is empty', async () => {
    const harness = requestHarness();
    const revealRows = vi.fn();
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, revealRows });
    scheduler.attach([{ channel_id: 'c0', head_seq: 100, has_rows: true }], { generation: 1, focus: 'c0' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    expect(scheduler.take('c0', 32)).toBe(0);
    finish(scheduler, harness.calls[0], { oldest: 68, rows: 32 });
    await waitFor(() => expect(revealRows).toHaveBeenCalled());
    expect(revealRows.mock.calls[0][1]).toHaveLength(32);
    scheduler.destroy();
  });

  it('uses an overlapping IndexedDB tail as the same bounded batch type', async () => {
    const readCache = vi.fn(async (channelId, beforeSeq) => ({
      rows: [{ channel_id: channelId, seq: 99, envelope: { id: 'cached-99', kind: 'event', type: 'human.note' } }],
      nextBeforeSeq: 99, exhausted: true, bytes: 10,
    }));
	const requestPage = vi.fn((channelId, _before, _limit, options) => accepted('after-cache', channelId, options.generation, options.purpose));
    const revealRows = vi.fn();
    const scheduler = createHistoryScheduler({ requestPage, readCache, revealRows });
    scheduler.attach([{ channel_id: 'c0', head_seq: 100, has_rows: true }], {
      generation: 1, focus: 'c0',
      localMeta: new Map([['c0', { newestSeq: 100, oldestSeq: 20, rowCount: 81, lastActivity: 1 }]]),
    });
    await waitFor(() => expect(readCache).toHaveBeenCalledWith('c0', 0, 200, 4 * 1024 * 1024));
	expect(readCache.mock.invocationCallOrder[0]).toBeLessThan(requestPage.mock.invocationCallOrder[0]);
	expect(requestPage).toHaveBeenCalledWith('c0', 20, 200, expect.objectContaining({ purpose: 'hydrate' }));
    expect(revealRows).toHaveBeenCalledWith('c0', [[99, expect.objectContaining({ id: 'cached-99' })]], { initial: true });
    scheduler.destroy();
  });

  it('ignores stale-generation terminals without closing the current batch', async () => {
    const harness = requestHarness();
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, revealRows: () => {} });
    scheduler.attach([{ channel_id: 'c0', head_seq: 100, has_rows: true }], { generation: 2, focus: 'c0' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    const call = harness.calls[0];
    expect(scheduler.pageEnd({ source: 'history', ref: call.ref, generation: 1, channel_id: 'c0' })).toBe(false);
    expect(scheduler.snapshot('c0').loading).toBe(true);
    finish(scheduler, call, { oldest: 90, hasOlder: false });
    await waitFor(() => expect(scheduler.snapshot('c0').loading).toBe(false));
    scheduler.destroy();
  });
});

describe('live feed priority', () => {
  it('applies live rows immediately while a history batch is in flight', async () => {
    const historyBefore = vi.fn((channelId, _before, _limit, options) => accepted('history-live', channelId, options.generation, options.purpose));
    const hook = renderHook(() => useChannelFeed({
      wireRef: { current: { historyBefore } },
      rosterRef: { current: { self: () => '', observeFeed: () => '', handleEnvelope: () => {} } },
      accessRef: { current: { feed: () => {}, self: () => {} } },
      activeChannelRef: { current: 'c0' },
      onRoster: () => {}, onError: () => {}, onChannelsDiscovered: () => {},
      onDirectoryInvalidated: () => {}, onTimerFired: () => {},
      onSubmissionFeed: () => {}, onAccessChanged: () => {},
    }), { wrapper: ({ children }) => <StrictMode>{children}</StrictMode> });
    act(() => hook.result.current.setHistoryGrants([{ channel_id: 'c0', head_seq: 100, has_rows: true }], { generation: 1, focus: 'c0' }));
    await waitFor(() => expect(historyBefore).toHaveBeenCalledOnce());
    expect(hook.result.current.cursorsRef.current.read('c0')).toBe(100);
    act(() => hook.result.current.enqueue('c0', 101, {
      id: 'live', kind: 'event', type: 'human.note', visibility: 'public',
      sender: { id: 'me', kind: 'human' }, payload: { text: '实时' },
    }, { source: 'live', generation: 1, channel_id: 'c0', seq: 101, envelope: {
      id: 'live', kind: 'event', type: 'human.note', visibility: 'public',
      sender: { id: 'me', kind: 'human' }, payload: { text: '实时' },
    } }));
    expect(hook.result.current.statesRef.current.get('c0').rows.has(101)).toBe(true);
    // Merely being the selected channel is not evidence that the user saw the
    // tail; Timeline advances this only after its scroller confirms bottom.
    expect(hook.result.current.cursorsRef.current.read('c0')).toBe(100);
    act(() => hook.result.current.markRead('c0', 101));
    expect(hook.result.current.cursorsRef.current.read('c0')).toBe(101);
    hook.unmount();
  });
});
