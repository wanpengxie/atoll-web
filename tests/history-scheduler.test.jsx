// @vitest-environment jsdom
import React, { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChannelFeed } from '../src/app/hooks/useChannelFeed.js';
import { createHistoryScheduler, HISTORY_MAX_BACKGROUND_INFLIGHT, HISTORY_MAX_INFLIGHT } from '../src/model/history-scheduler.js';

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
	scan_low_seq: oldest, scan_high_seq: call.beforeSeq - 1,
	next_before_seq: oldest, rows, bytes: rows * 10, has_older: hasOlder,
  });
}

afterEach(() => vi.restoreAllMocks());

describe('v5 history batch coordinator', () => {
  it('starts several active channels concurrently while respecting the global limit', async () => {
    const harness = requestHarness();
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, revealRows: () => {} });
    scheduler.attach(Array.from({ length: 8 }, (_, index) => ({
      channel_id: `c${index}`, head_seq: 1_000 - index, has_rows: true, last_activity: 100 - index,
    })), { generation: 1, focus: 'c0' });
    await waitFor(() => expect(harness.calls).toHaveLength(HISTORY_MAX_INFLIGHT));
    expect(new Set(harness.calls.map((call) => call.channelId)).size).toBe(HISTORY_MAX_INFLIGHT);
    expect(harness.calls[0].channelId).toBe('c0');
    expect(harness.calls[0].priority).toBe('foreground');
    expect(harness.calls.filter((call) => call.priority === 'background')).toHaveLength(HISTORY_MAX_BACKGROUND_INFLIGHT);
    expect(harness.calls.every((call, index) => call.beforeSeq === 1_001 - index)).toBe(true);
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

  it('keeps one foreground operation attached to an already-running empty batch', async () => {
    const harness = requestHarness();
    const revealRows = vi.fn();
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, revealRows });
    scheduler.attach([{ channel_id: 'c0', head_seq: 100, has_rows: true }], { generation: 1, focus: 'c0' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));
	const operation = scheduler.beginOperation('c0');
	const segment = operation.next();
    finish(scheduler, harness.calls[0], { oldest: 68, rows: 32 });
	await expect(segment).resolves.toMatchObject({ kind: 'segment' });
    await waitFor(() => expect(revealRows).toHaveBeenCalled());
    expect(revealRows.mock.calls[0][1]).toHaveLength(32);
	operation.release();
    scheduler.destroy();
  });

  it('keeps a foreground operation that arrives before attach metadata', async () => {
    const harness = requestHarness();
    const revealRows = vi.fn();
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, revealRows });

	const operation = scheduler.beginOperation('c0');
	const segment = operation.next();
	expect(scheduler.snapshot('c0').attached).toBe(false);
    scheduler.attach([{ channel_id: 'c0', head_seq: 100, has_rows: true }], { generation: 1, focus: 'c0' });

    await waitFor(() => expect(harness.calls).toHaveLength(1));
    expect(harness.calls[0]).toMatchObject({ channelId: 'c0', purpose: 'user-demand' });
    finish(scheduler, harness.calls[0], { oldest: 68, rows: 32, hasOlder: false });
	await expect(segment).resolves.toMatchObject({ kind: 'segment' });
    await waitFor(() => expect(revealRows).toHaveBeenCalled());
    expect(scheduler.snapshot('c0').attached).toBe(true);
	operation.release();
    scheduler.destroy();
  });

  it('cancels an unowned foreground batch and releases its operation', async () => {
    const harness = requestHarness();
    const cancelPage = vi.fn(async () => ({ cancelled: true }));
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, cancelPage, revealRows: () => {} });
    const controller = new AbortController();
    const operation = scheduler.nextSegment('c0', { signal: controller.signal });
    scheduler.attach([{ channel_id: 'c0', head_seq: 100, has_rows: true }], { generation: 1, focus: 'c0' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    expect(harness.calls[0]).toMatchObject({ purpose: 'user-demand', priority: 'foreground' });
    controller.abort();
    await expect(operation).resolves.toEqual({ kind: 'cancelled' });
    await waitFor(() => expect(cancelPage).toHaveBeenCalledWith('c0', harness.calls[0].ref, 1));
    await waitFor(() => expect(harness.calls).toHaveLength(2));
    expect(harness.calls[1]).toMatchObject({ purpose: 'initial-tail', priority: 'foreground' });
    scheduler.destroy();
  });

  it('cancels and reissues background work when that channel becomes focused', async () => {
    const harness = requestHarness();
    const cancelPage = vi.fn(async () => ({ cancelled: true }));
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, cancelPage, revealRows: () => {} });
    scheduler.attach([
      { channel_id: 'a', head_seq: 100, has_rows: true },
      { channel_id: 'b', head_seq: 100, has_rows: true },
    ], { generation: 1, focus: 'a' });
    await waitFor(() => expect(harness.calls).toHaveLength(2));
    const background = harness.calls.find((call) => call.channelId === 'b');
    expect(background).toMatchObject({ priority: 'background' });

    scheduler.focus('b');
    await waitFor(() => expect(cancelPage).toHaveBeenCalledWith('b', background.ref, 1));
    await waitFor(() => expect(harness.calls.filter((call) => call.channelId === 'b')).toHaveLength(2));
    expect(harness.calls.filter((call) => call.channelId === 'b')[1]).toMatchObject({
      purpose: 'initial-tail', priority: 'foreground', beforeSeq: 101,
    });
    scheduler.destroy();
  });

  it('waits for cancel acknowledgement before issuing the promoted replacement', async () => {
    const harness = requestHarness();
    let acknowledge;
    const cancelPage = vi.fn(() => new Promise((resolve) => { acknowledge = resolve; }));
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, cancelPage, revealRows: () => {} });
    scheduler.attach([
      { channel_id: 'a', head_seq: 100, has_rows: true },
      { channel_id: 'b', head_seq: 100, has_rows: true },
    ], { generation: 1, focus: 'a' });
    await waitFor(() => expect(harness.calls).toHaveLength(2));
    scheduler.focus('b');
    await waitFor(() => expect(cancelPage).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.calls.filter((call) => call.channelId === 'b')).toHaveLength(1);

    acknowledge({ cancelled: true });
    await waitFor(() => expect(harness.calls.filter((call) => call.channelId === 'b')).toHaveLength(2));
    expect(harness.calls.filter((call) => call.channelId === 'b')[1].priority).toBe('foreground');
    scheduler.destroy();
  });

  it('uses an overlapping IndexedDB tail as the same bounded batch type', async () => {
    const readCache = vi.fn(async (channelId, beforeSeq) => ({
      rows: [{ channel_id: channelId, seq: 99, envelope: { id: 'cached-99', kind: 'event', type: 'human.note' } }],
      nextBeforeSeq: 20, exhausted: true, bytes: 10,
    }));
	const requestPage = vi.fn((channelId, _before, _limit, options) => accepted('after-cache', channelId, options.generation, options.purpose));
    const revealRows = vi.fn();
    const scheduler = createHistoryScheduler({ requestPage, readCache, revealRows });
    scheduler.attach([{ channel_id: 'c0', head_seq: 100, has_rows: true }], {
      generation: 1, focus: 'c0',
      localMeta: new Map([['c0', { newestSeq: 100, oldestSeq: 20, rowCount: 81, lastActivity: 1, coverage: [{ lowSeq: 20, highSeq: 100 }] }]]),
    });
    await waitFor(() => expect(readCache).toHaveBeenCalledWith('c0', 101, 200, 4 * 1024 * 1024));
	expect(readCache.mock.invocationCallOrder[0]).toBeLessThan(requestPage.mock.invocationCallOrder[0]);
	expect(requestPage).toHaveBeenCalledWith('c0', 20, 200, expect.objectContaining({ purpose: 'hydrate' }));
    expect(revealRows).toHaveBeenCalledWith('c0', [[99, expect.objectContaining({ id: 'cached-99' })]], { initial: true });
    scheduler.destroy();
  });

	it('loads the current network tail before a lagged cache and switches only at exact coverage', async () => {
	  const harness = requestHarness();
	  const readCache = vi.fn(async (channelId, beforeSeq) => ({
		rows: [{ channel_id: channelId, seq: 100, envelope: { id: 'cached-100', kind: 'event', type: 'human.note' } }],
		nextBeforeSeq: 1, exhausted: true, bytes: 10,
	  }));
	  const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, readCache, revealRows: () => {} });
	  scheduler.attach([{ channel_id: 'c0', head_seq: 1_000, has_rows: true }], {
		generation: 1, focus: 'c0',
		localMeta: new Map([['c0', { newestSeq: 100, oldestSeq: 1, rowCount: 100, coverage: [{ lowSeq: 1, highSeq: 100 }] }]]),
	  });
	  await waitFor(() => expect(harness.calls).toHaveLength(1));
	  expect(harness.calls[0]).toMatchObject({ beforeSeq: 1_001, priority: 'foreground' });
	  expect(readCache).not.toHaveBeenCalled();
	  finish(scheduler, harness.calls[0], { oldest: 101, rows: 2, hasOlder: true });
	  await waitFor(() => expect(readCache).toHaveBeenCalledWith('c0', 101, 200, 4 * 1024 * 1024));
	  scheduler.destroy();
	});

	it('rejects a non-atomic page terminal without advancing the cursor', async () => {
	  const harness = requestHarness();
	  const cancelPage = vi.fn(async () => ({}));
	  const onError = vi.fn();
	  const revealRows = vi.fn();
	  const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, cancelPage, revealRows, onError });
	  scheduler.attach([{ channel_id: 'c0', head_seq: 100, has_rows: true }], { generation: 1, focus: 'c0' });
	  await waitFor(() => expect(harness.calls).toHaveLength(1));
	  const call = harness.calls[0];
	  scheduler.historyRow({ source: 'history', ref: call.ref, generation: 1, channel_id: 'c0', seq: 90, envelope: { id: 'm90', kind: 'event', type: 'human.note' } });
	  scheduler.pageEnd({
		source: 'history', ref: call.ref, generation: 1, channel_id: 'c0',
		scan_low_seq: 90, scan_high_seq: 100, next_before_seq: 90,
		rows: 2, bytes: 10, has_older: true,
	  });
	  await waitFor(() => expect(onError).toHaveBeenCalled());
	  expect(revealRows).not.toHaveBeenCalled();
	  expect(scheduler.snapshot('c0').oldestSeq).toBe(101);
	  expect(cancelPage).toHaveBeenCalledWith('c0', call.ref, 1);
	  scheduler.destroy();
	});

  it('does not reopen authoritative exhaustion when a newer cache checkpoint arrives', async () => {
    const harness = requestHarness();
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, revealRows: () => {} });
    scheduler.attach([{ channel_id: 'c0', head_seq: 100, has_rows: true }], { generation: 1, focus: 'c0' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    finish(scheduler, harness.calls[0], { oldest: 1, rows: 1, hasOlder: false });
    await waitFor(() => expect(scheduler.snapshot('c0').loading).toBe(false));
    expect(scheduler.snapshot('c0')).toMatchObject({ oldestSeq: 1, hasOlder: false });

    scheduler.setLocalMeta(new Map([['c0', {
      rowCount: 1, newestSeq: 101, coverage: [{ lowSeq: 101, highSeq: 101 }],
    }]]));
    scheduler.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.calls).toHaveLength(1);
    expect(scheduler.snapshot('c0').hasOlder).toBe(false);
    scheduler.destroy();
  });

  it('falls back to network at the same frontier when a stale cache claim misses', async () => {
    const harness = requestHarness();
    const readCache = vi.fn(async (_channelId, beforeSeq) => ({
      rows: [], nextBeforeSeq: beforeSeq, exhausted: true, cacheMiss: true, bytes: 0,
    }));
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, readCache, revealRows: () => {} });
    scheduler.attach([{ channel_id: 'c0', head_seq: 100, has_rows: true }], {
      generation: 1,
      focus: 'c0',
      localMeta: new Map([['c0', { rowCount: 1, coverage: [{ lowSeq: 1, highSeq: 100 }] }]]),
    });
    await waitFor(() => expect(readCache).toHaveBeenCalledOnce());
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    expect(harness.calls[0]).toMatchObject({ channelId: 'c0', beforeSeq: 101 });
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
