// @vitest-environment jsdom
import React, { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChannelFeed } from '../src/app/hooks/useChannelFeed.js';
import {
  createHistoryScheduler,
  HISTORY_BATCH_BYTES,
  HISTORY_PAGE_SIZE,
} from '../src/model/history-scheduler.js';
import {
  clearDiagnostics,
  enableReadingTrace,
  readingTraceSnapshot,
} from '../src/model/diagnostics.js';

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

function finish(scheduler, call, {
  oldest = call.beforeSeq - 2,
  hasOlder = true,
  rows = 2,
  headSeq = call.beforeSeq - 1,
} = {}) {
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
    head_seq: headSeq, oldest_seq: oldest,
	scan_low_seq: oldest, scan_high_seq: call.beforeSeq - 1,
	next_before_seq: oldest, rows, bytes: rows * 10, has_older: hasOlder,
  });
}

afterEach(() => {
  clearDiagnostics();
  vi.restoreAllMocks();
});

describe('v5 history batch coordinator', () => {
  it('keeps physical warm batches silent and exposes one stable foreground edge-demand lifecycle', async () => {
    const harness = requestHarness();
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, revealRows: () => {} });
    scheduler.attach([{ channel_id: 'c0', head_seq: 100, has_rows: true }], { generation: 1, focus: 'c0' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));

    // Initial-tail and background reservoir work are scheduler facts, not a
    // user-visible claim that the current readable timeline is blocked.
    expect(scheduler.snapshot('c0')).toMatchObject({
      loading: true,
      backgroundLoading: true,
      foregroundLoading: false,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
    });

    const operation = scheduler.beginOperation('c0', {
      intent: 'scroll-history', urgency: 'interactive',
    });
    const revision = scheduler.snapshot('c0').historyDemand.revision;
    expect(scheduler.snapshot('c0')).toMatchObject({
      foregroundLoading: true,
      historyDemand: { revision, phase: 'pending', error: '' },
    });

    const segment = operation.next({ count: 8 });
    finish(scheduler, harness.calls[0], { oldest: 90, rows: 2 });
    await expect(segment).resolves.toMatchObject({ kind: 'segment' });
    // A physical page completion does not unmount/recreate the semantic wait.
    expect(scheduler.snapshot('c0')).toMatchObject({
      foregroundLoading: true,
      historyDemand: { revision, phase: 'pending', error: '' },
    });
    operation.release();
    expect(scheduler.snapshot('c0')).toMatchObject({
      foregroundLoading: false,
      historyDemand: { revision, phase: 'idle', error: '' },
    });
    scheduler.destroy();
  });

  it('keeps anticipatory runway and under-fill operations out of foreground presentation', async () => {
    const harness = requestHarness();
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, revealRows: () => {} });
    scheduler.attach([{ channel_id: 'c0', head_seq: 100, has_rows: true }], { generation: 1, focus: 'c0' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));

    const operation = scheduler.beginOperation('c0', {
      intent: 'scroll-history', urgency: 'anticipatory',
    });
    expect(scheduler.snapshot('c0')).toMatchObject({
      foregroundLoading: false,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
    });
    operation.release();
    scheduler.destroy();
  });

  it('promotes one anticipatory operation to interactive presentation without opening a second operation or page', async () => {
    const harness = requestHarness();
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, revealRows: () => {} });
    const operation = scheduler.beginOperation('c0', {
      intent: 'scroll-history', urgency: 'anticipatory',
    });
    const segment = operation.next({ count: 1 });
    scheduler.attach([{ channel_id: 'c0', head_seq: 100, has_rows: true }], { generation: 1, focus: 'c0' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    expect(harness.calls[0]).toMatchObject({
      purpose: 'user-demand', urgency: 'anticipatory',
    });
    expect(scheduler.snapshot('c0').historyDemand).toEqual({ revision: 0, phase: 'idle', error: '' });

    expect(operation.promote({ intent: 'scroll-history', urgency: 'interactive' })).toBe(true);
    const revision = scheduler.snapshot('c0').historyDemand.revision;
    expect(scheduler.snapshot('c0').historyDemand).toEqual({ revision, phase: 'pending', error: '' });
    expect(revision).toBe(1);
    expect(operation.promote({ intent: 'scroll-history', urgency: 'interactive' })).toBe(false);
    expect(scheduler.snapshot('c0').historyDemand.revision).toBe(revision);
    expect(harness.calls).toHaveLength(1);

    finish(scheduler, harness.calls[0], { oldest: 99, rows: 1, hasOlder: true });
    await expect(segment).resolves.toMatchObject({ kind: 'segment', released: 1 });
    expect(scheduler.snapshot('c0').historyDemand).toEqual({ revision, phase: 'pending', error: '' });
    operation.release();
    expect(scheduler.snapshot('c0').historyDemand).toEqual({ revision, phase: 'idle', error: '' });
    scheduler.destroy();
  });

  it('keeps one demand revision pending across filtered physical pages and settles only at the semantic boundary', async () => {
    const harness = requestHarness();
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, revealRows: () => {} });
    const operation = scheduler.beginOperation('c0', {
      intent: 'scroll-history', urgency: 'interactive',
    });
    const first = operation.next({ count: 1 });
    scheduler.attach([{ channel_id: 'c0', head_seq: 300, has_rows: true }], { generation: 1, focus: 'c0' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    const revision = scheduler.snapshot('c0').historyDemand.revision;

    finish(scheduler, harness.calls[0], { oldest: 200, rows: 0, hasOlder: true });
    await expect(first).resolves.toMatchObject({ kind: 'segment', released: 0, scanAdvanced: true });
    expect(scheduler.snapshot('c0').historyDemand).toEqual({ revision, phase: 'pending', error: '' });

    const second = operation.next({ count: 1 });
    await waitFor(() => expect(harness.calls).toHaveLength(2));
    expect(scheduler.snapshot('c0').historyDemand).toEqual({ revision, phase: 'pending', error: '' });
    finish(scheduler, harness.calls[1], { oldest: 100, rows: 0, hasOlder: true });
    await expect(second).resolves.toMatchObject({ kind: 'segment', released: 0, scanAdvanced: true });
    expect(scheduler.snapshot('c0').historyDemand).toEqual({ revision, phase: 'pending', error: '' });

    const third = operation.next({ count: 1 });
    await waitFor(() => expect(harness.calls).toHaveLength(3));
    finish(scheduler, harness.calls[2], { oldest: 99, rows: 1, hasOlder: true });
    await expect(third).resolves.toMatchObject({ kind: 'segment', released: 1 });
    expect(scheduler.snapshot('c0').historyDemand).toEqual({ revision, phase: 'pending', error: '' });

    operation.release();
    expect(scheduler.snapshot('c0').historyDemand).toEqual({ revision, phase: 'idle', error: '' });
    scheduler.destroy();
  });

  it('settles an authoritative EOF without reopening a physical page', async () => {
    const harness = requestHarness();
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, revealRows: () => {} });
    scheduler.attach([{ channel_id: 'empty', head_seq: 0, has_rows: false }], { generation: 1, focus: 'empty' });
    const operation = scheduler.beginOperation('empty', { intent: 'scroll-history' });
    const revision = scheduler.snapshot('empty').historyDemand.revision;

    await expect(operation.next()).resolves.toEqual({ kind: 'exhausted' });
    expect(harness.calls).toHaveLength(0);
    expect(scheduler.snapshot('empty').historyDemand).toEqual({ revision, phase: 'pending', error: '' });
    operation.release();
    expect(scheduler.snapshot('empty').historyDemand).toEqual({ revision, phase: 'idle', error: '' });
    scheduler.destroy();
  });

  it('keeps a user-owned failure actionable without exposing background failures', async () => {
    const rejects = [];
    const requestPage = vi.fn(() => new Promise((_, reject) => rejects.push(reject)));
    const scheduler = createHistoryScheduler({ requestPage, revealRows: () => {}, onError: () => {} });
    scheduler.attach([{ channel_id: 'c0', head_seq: 100, has_rows: true }], { generation: 1, focus: 'c0' });
    await waitFor(() => expect(rejects).toHaveLength(1));
    const operation = scheduler.beginOperation('c0', { intent: 'scroll-history' });
    const failed = operation.next();
    rejects[0](new Error('history unavailable'));
    await expect(failed).resolves.toMatchObject({ kind: 'failed' });
    operation.release();
    expect(scheduler.snapshot('c0').historyDemand).toMatchObject({
      phase: 'error', error: 'history unavailable',
    });

    // An explicit retry starts a new semantic demand immediately; it does not
    // wait behind the automatic retry timer and does not inherit stale error UI.
    const retry = scheduler.beginOperation('c0', { intent: 'scroll-history' });
    const retryResult = retry.next();
    await waitFor(() => expect(requestPage).toHaveBeenCalledTimes(2));
    expect(scheduler.snapshot('c0').error).toBe('');
    expect(scheduler.snapshot('c0').historyDemand).toMatchObject({ phase: 'pending', error: '' });
    rejects[1](new Error('still unavailable'));
    await expect(retryResult).resolves.toMatchObject({ kind: 'failed' });
    retry.release();
    scheduler.destroy();
  });

  it('aggregates a page trace without losing arrival order or flooding the ring', async () => {
    let clock = 10;
    const harness = requestHarness();
    const scheduler = createHistoryScheduler({
      requestPage: harness.requestPage,
      revealRows: () => {},
      now: () => ++clock,
    });
    enableReadingTrace({ case: 'history-arrival-order' });
    scheduler.attach([{ channel_id: 'c0', head_seq: 100, has_rows: true }], { generation: 1, focus: 'c0' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    const call = harness.calls[0];
    for (const seq of [90, 88, 89]) {
      scheduler.historyRow({
        source: 'history', ref: call.ref, generation: call.generation,
        channel_id: call.channelId, seq,
        envelope: { id: `m-${seq}`, kind: 'event', type: 'human.note' },
      });
    }
    scheduler.pageEnd({
      source: 'history', ref: call.ref, generation: call.generation,
      channel_id: call.channelId, purpose: call.purpose,
      head_seq: 100, oldest_seq: 88, scan_low_seq: 88, scan_high_seq: 99,
      next_before_seq: 88, rows: 3, bytes: 30, has_older: true,
    });
    const pageEnded = readingTraceSnapshot().entries.find((entry) => entry.event === 'history.page-ended');
    expect(pageEnded?.detail).toMatchObject({
      arrivalCount: 3,
      firstSeq: 90,
      lastSeq: 89,
      minSeq: 88,
      maxSeq: 90,
    });
    expect(readingTraceSnapshot().entries.filter((entry) => entry.event === 'history.row-arrived')).toHaveLength(0);
    scheduler.destroy();
  });

  it('自动失败按 scheduler retryAt 有界退避，同一 coverage 不会紧密重发', async () => {
    let clock = 0;
    let timerSerial = 0;
    const timers = new Map();
    const requestPage = vi.fn(() => Promise.reject(new Error('temporary history failure')));
    const onError = vi.fn();
    const scheduler = createHistoryScheduler({
      requestPage,
      revealRows: () => {},
      onError,
      now: () => clock,
      setTimeoutImpl: (callback, delay) => {
        const id = ++timerSerial;
        timers.set(id, { callback, delay });
        return id;
      },
      clearTimeoutImpl: (id) => timers.delete(id),
    });
    scheduler.attach([{ channel_id: 'c0', head_seq: 100, has_rows: true }], { generation: 1, focus: 'c0' });

    await waitFor(() => expect(requestPage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect([...timers.values()]).toHaveLength(1);
    expect([...timers.values()][0].delay).toBe(500);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requestPage).toHaveBeenCalledTimes(1);

    const [firstID, firstWake] = [...timers.entries()][0];
    timers.delete(firstID);
    clock += firstWake.delay;
    firstWake.callback();
    await waitFor(() => expect(requestPage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
    expect([...timers.values()]).toHaveLength(1);
    expect([...timers.values()][0].delay).toBe(1_000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requestPage).toHaveBeenCalledTimes(2);
    scheduler.destroy();
  });

  it('does not mistake an unpresentable live head for an installed tail', async () => {
    const harness = requestHarness();
    const scheduler = createHistoryScheduler({
      requestPage: harness.requestPage,
      maxBackgroundInflight: 0,
      hasVisibleRow: () => true,
      hasPresentedRows: () => false,
      revealRows: () => {},
    });
    scheduler.attach([{ channel_id: 'c0.project', head_seq: 25, has_rows: true }], {
      generation: 1,
      focus: '',
    });
    scheduler.observeLive('c0.project', Date.now(), { seq: 28, related: true });
    scheduler.focus('c0.project');

    await waitFor(() => expect(harness.calls).toHaveLength(1));
    expect(harness.calls[0]).toMatchObject({
      channelId: 'c0.project',
      purpose: 'initial-tail',
      beforeSeq: 26,
      priority: 'foreground',
    });
    expect(scheduler.snapshot('c0.project').loaded).toBe(false);
    scheduler.destroy();
  });

  it('hydrates the focused channel from IndexedDB before any remote attach', async () => {
    const requestPage = vi.fn();
    const readCache = vi.fn(async (channelId, beforeSeq) => ({
      rows: [
        { channel_id: channelId, seq: 99, envelope: { id: 'cached-99', kind: 'event', type: 'human.note' } },
        { channel_id: channelId, seq: 100, envelope: { id: 'cached-100', kind: 'event', type: 'human.note' } },
      ],
      nextBeforeSeq: 1,
      exhausted: true,
      bytes: 20,
    }));
    const revealRows = vi.fn();
    const scheduler = createHistoryScheduler({ requestPage, readCache, revealRows });
    scheduler.focus('c0');
    scheduler.setLocalMeta(new Map([['c0', {
      newestSeq: 100, rowCount: 100, coverage: [{ lowSeq: 1, highSeq: 100 }],
    }]]));

    await waitFor(() => expect(readCache).toHaveBeenCalledWith('c0', 101, HISTORY_PAGE_SIZE, HISTORY_BATCH_BYTES));
    await waitFor(() => expect(revealRows).toHaveBeenCalledWith('c0', [
      [99, expect.objectContaining({ id: 'cached-99' })],
      [100, expect.objectContaining({ id: 'cached-100' })],
    ], { initial: true }));
    expect(requestPage).not.toHaveBeenCalled();
    expect(scheduler.snapshot('c0')).toMatchObject({ loaded: true, hasOlder: false, generation: 0 });
    scheduler.destroy();
  });

  it('keeps the local cursor when remote attach confirms the same cached head', async () => {
    const harness = requestHarness();
    const readCache = vi.fn(async (channelId) => ({
      rows: [{ channel_id: channelId, seq: 100, envelope: { id: 'cached-100', kind: 'event', type: 'human.note' } }],
      nextBeforeSeq: 20,
      exhausted: true,
      bytes: 10,
    }));
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, readCache, revealRows: () => {} });
    const meta = new Map([['c0', {
      newestSeq: 100, rowCount: 81, coverage: [{ lowSeq: 20, highSeq: 100 }],
    }]]);
    scheduler.focus('c0');
    scheduler.setLocalMeta(meta);
    await waitFor(() => expect(readCache).toHaveBeenCalledOnce());
    await waitFor(() => expect(scheduler.snapshot('c0').loaded).toBe(true));

    scheduler.attach([{ channel_id: 'c0', head_seq: 100, has_rows: true }], {
      generation: 1, focus: 'c0', localMeta: meta,
    });
    expect(scheduler.snapshot('c0').controlCurrent).toBe(true);
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    expect(harness.calls[0]).toMatchObject({ channelId: 'c0', beforeSeq: 20 });
    expect(readCache).toHaveBeenCalledOnce();
    scheduler.destroy();
  });

  it('keeps a silent background reservoir when attach confirms its cache coverage', async () => {
    const harness = requestHarness();
    const meta = new Map([
      ['a', { newestSeq: 100, rowCount: 1, coverage: [{ lowSeq: 1, highSeq: 100 }], lastActivity: 2 }],
      ['b', { newestSeq: 100, rowCount: 1, coverage: [{ lowSeq: 1, highSeq: 100 }], lastActivity: 1 }],
    ]);
    const readCache = vi.fn(async (channelId) => ({
      rows: [{ channel_id: channelId, seq: 100, envelope: { id: `${channelId}-cached`, kind: 'event', type: 'human.note' } }],
      nextBeforeSeq: 1,
      exhausted: true,
      bytes: 10,
    }));
    const revealRows = vi.fn();
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, readCache, revealRows });
    scheduler.focus('a');
    scheduler.setLocalMeta(meta);
    await waitFor(() => expect(readCache.mock.calls.some(([channelId]) => channelId === 'b')).toBe(true));
    await waitFor(() => expect(scheduler.snapshot('b')).toMatchObject({ buffered: 1, loaded: false, completedPages: 1 }));

    scheduler.attach([
      { channel_id: 'a', head_seq: 100, has_rows: true },
      { channel_id: 'b', head_seq: 100, has_rows: true },
    ], { generation: 1, focus: 'a', localMeta: meta });
    expect(scheduler.snapshot('b')).toMatchObject({ buffered: 1, loaded: false, completedPages: 1, oldestSeq: 1 });
    expect(revealRows.mock.calls.some(([channelId]) => channelId === 'b')).toBe(false);
    scheduler.destroy();
  });

  it('lets a compatible IndexedDB pull finish across remote attach', async () => {
    let resolveCache;
    const readCache = vi.fn(() => new Promise((resolve) => { resolveCache = resolve; }));
    const harness = requestHarness();
    const revealRows = vi.fn();
    const meta = new Map([['c0', {
      newestSeq: 100, rowCount: 81, coverage: [{ lowSeq: 20, highSeq: 100 }],
    }]]);
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, readCache, revealRows });
    scheduler.focus('c0');
    scheduler.setLocalMeta(meta);
    await waitFor(() => expect(readCache).toHaveBeenCalledOnce());

    scheduler.attach([{ channel_id: 'c0', head_seq: 100, has_rows: true }], {
      generation: 1, focus: 'c0', localMeta: meta,
    });
    resolveCache({
      rows: [{ channel_id: 'c0', seq: 100, envelope: { id: 'cached-100', kind: 'event', type: 'human.note' } }],
      nextBeforeSeq: 20, exhausted: true, bytes: 10,
    });

    await waitFor(() => expect(revealRows).toHaveBeenCalledWith('c0', [[100, expect.objectContaining({ id: 'cached-100' })]], { initial: true }));
    await waitFor(() => expect(harness.calls[0]).toMatchObject({ channelId: 'c0', beforeSeq: 20 }));
    scheduler.destroy();
  });

  it('gates first paint, then fills the frontend P0/P1/P2 working set under bounded concurrency', async () => {
    const harness = requestHarness();
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, revealRows: () => {} });
    scheduler.attach(Array.from({ length: 8 }, (_, index) => ({
      channel_id: `c${index}`, head_seq: 1_000 - index, has_rows: true, last_activity: 100 - index,
    })), { generation: 1, focus: 'c0' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    expect(harness.calls[0].channelId).toBe('c0');
    expect(harness.calls[0].priority).toBe('foreground');
    expect(harness.calls[0].beforeSeq).toBe(1_001);
    expect(scheduler.snapshot('c0')).toMatchObject({ tier: 0, completedPages: 0 });

    finish(scheduler, harness.calls[0], { oldest: 900 });
    await waitFor(() => expect(harness.calls).toHaveLength(3));
    expect(harness.calls.slice(1).map((call) => call.channelId)).toEqual(['c0', 'c1']);
    expect(harness.calls.slice(1).filter((call) => call.priority === 'background')).toHaveLength(1);
    // The scheduler classifies the complete working set immediately, but only
    // admits two requests globally and one background request at a time.
    expect(harness.calls.slice(1).filter((call) => call.priority === 'foreground')).toHaveLength(1);
    expect(scheduler.snapshot('c1').tier).toBe(1);
    expect(scheduler.snapshot('c4').tier).toBe(2);
    expect(scheduler.snapshot('c7').tier).toBe(2);
    scheduler.destroy();
  });

  it('keeps background pages silent and reveals the warm reservoir on focus', async () => {
    const harness = requestHarness();
    const revealRows = vi.fn();
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, revealRows });
    scheduler.attach([
      { channel_id: 'a', head_seq: 100, has_rows: true, last_activity: 10 },
      { channel_id: 'b', head_seq: 100, has_rows: true, last_activity: 9 },
    ], { generation: 1, focus: 'a' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    finish(scheduler, harness.calls[0], { oldest: 90, rows: 1 });
    await waitFor(() => expect(harness.calls.some((call) => call.channelId === 'b')).toBe(true));
    const background = harness.calls.find((call) => call.channelId === 'b');
    finish(scheduler, background, { oldest: 80, rows: 1 });
    await waitFor(() => expect(scheduler.snapshot('b').buffered).toBe(1));
    expect(revealRows.mock.calls.some(([channelId]) => channelId === 'b')).toBe(false);

    scheduler.focus('b');
    expect(revealRows).toHaveBeenCalledWith('b', [[80, expect.objectContaining({ id: 'b-80' })]], { initial: true });
    expect(scheduler.snapshot('b')).toMatchObject({ loaded: true, tier: 0, buffered: 0 });
    scheduler.destroy();
  });

  it('adopts an in-flight background batch when its channel becomes the focus', async () => {
    const harness = requestHarness();
    const cancelPage = vi.fn(async () => ({ cancelled: true }));
    const revealRows = vi.fn();
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, cancelPage, revealRows });
    scheduler.attach([
      { channel_id: 'a', head_seq: 100, has_rows: true, last_activity: 10 },
      { channel_id: 'b', head_seq: 100, has_rows: true, last_activity: 9 },
    ], { generation: 1, focus: 'a' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    finish(scheduler, harness.calls[0], { oldest: 90, rows: 1 });
    await waitFor(() => expect(harness.calls.some((call) => call.channelId === 'b')).toBe(true));
    const background = harness.calls.find((call) => call.channelId === 'b');
    expect(background.priority).toBe('background');

    scheduler.focus('b');
    expect(cancelPage).not.toHaveBeenCalled();
    expect(harness.calls.filter((call) => call.channelId === 'b')).toHaveLength(1);
    finish(scheduler, background, { oldest: 80, rows: 1 });

    await waitFor(() => expect(revealRows).toHaveBeenCalledWith(
      'b', [[80, expect.objectContaining({ id: 'b-80' })]], { initial: true },
    ));
    scheduler.destroy();
  });

  it('settles an offline history request at the local frontier instead of waiting forever', async () => {
    const scheduler = createHistoryScheduler({ requestPage: vi.fn(), revealRows: () => {} });
    scheduler.focus('offline');
    scheduler.disconnected();
    await expect(scheduler.nextSegment('offline')).resolves.toEqual({ kind: 'exhausted', localOnly: true });
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

  it('fills and refills a P0 resident target instead of stopping on a lifetime page count', async () => {
    const harness = requestHarness();
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, revealRows: () => {} });
    scheduler.attach([{ channel_id: 'c0', head_seq: 1_000, has_rows: true }], { generation: 1, focus: 'c0' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    finish(scheduler, harness.calls[0], { oldest: 873, rows: 128 });
    await waitFor(() => expect(harness.calls).toHaveLength(2));
    expect(harness.calls[1].limit).toBe(160);
    finish(scheduler, harness.calls[1], { oldest: 713, rows: 160 });
    await waitFor(() => expect(scheduler.snapshot('c0')).toMatchObject({ loading: false, completedPages: 2, buffered: 256 }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.calls).toHaveLength(2);

    const operation = scheduler.beginOperation('c0');
    const segment = operation.next({ count: 32 });
    await expect(segment).resolves.toMatchObject({ kind: 'segment', released: 32 });
    operation.release();
    await waitFor(() => expect(harness.calls).toHaveLength(3));
    expect(harness.calls[2]).toMatchObject({ channelId: 'c0', limit: 32 });
    scheduler.destroy();
  });

  it('threads a bounded raw-record and byte budget through an operation release', async () => {
    const harness = requestHarness();
    const revealRows = vi.fn();
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, revealRows });
    scheduler.attach([{ channel_id: 'c0', head_seq: 1_000, has_rows: true }], { generation: 1, focus: 'c0' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    finish(scheduler, harness.calls[0], { oldest: 961, rows: 40 });
    await waitFor(() => expect(scheduler.snapshot('c0').buffered).toBe(8));

    const operation = scheduler.beginOperation('c0', { intent: 'scroll-history', urgency: 'anticipatory' });
    // Every encoded fixture record is larger than one byte. The first record
    // is the documented liveness exception; the byte budget stops the rest.
    await expect(operation.next({ count: 8, byteLimit: 1 })).resolves.toEqual({ kind: 'segment', released: 1 });
    expect(revealRows.mock.calls.at(-1)[1]).toHaveLength(1);
    expect(scheduler.snapshot('c0').buffered).toBe(7);
    operation.release();
    scheduler.destroy();
  });

  it('promotes a newly related live channel into P1 without routing live through history', async () => {
    const harness = requestHarness();
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, revealRows: () => {} });
    scheduler.attach(Array.from({ length: 10 }, (_, index) => ({
      channel_id: `c${index}`, head_seq: 100, has_rows: true, last_activity: 100 - index,
    })), { generation: 1, focus: 'c0' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));

    scheduler.observeLive('c9', 1_000, { related: true, seq: 101 });
    expect(scheduler.snapshot('c9')).toMatchObject({ tier: 1, headSeq: 101 });
    expect(harness.calls).toHaveLength(1);
    scheduler.destroy();
  });

  it('adapts the next network row limit from observed small-batch time', async () => {
    let clock = 0;
    const harness = requestHarness();
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, revealRows: () => {}, now: () => clock });
    scheduler.attach([{ channel_id: 'c0', head_seq: 1_000, has_rows: true }], { generation: 1, focus: 'c0' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    expect(harness.calls[0].limit).toBe(128);
    clock = 100;
    finish(scheduler, harness.calls[0], { oldest: 873, rows: 128 });
    await waitFor(() => expect(harness.calls).toHaveLength(2));
    expect(harness.calls[1].limit).toBe(160);
    scheduler.destroy();
  });

  it('restores a mobile materialization gap before continuing the deep-history frontier', async () => {
    let visibleOldest = 0;
    const harness = requestHarness();
    const revealed = [];
    const scheduler = createHistoryScheduler({
      requestPage: harness.requestPage,
      visibleOldestSeq: () => visibleOldest,
      revealRows: (_channelId, rows) => revealed.push(rows),
    });
    scheduler.attach([{ channel_id: 'c0', head_seq: 1_000, has_rows: true }], { generation: 1, focus: 'c0' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    finish(scheduler, harness.calls[0], { oldest: 900, rows: 1, hasOlder: false });
    await waitFor(() => expect(scheduler.snapshot('c0')).toMatchObject({ oldestSeq: 900, hasOlder: false }));

    visibleOldest = 950;
    const operation = scheduler.beginOperation('c0');
    const next = operation.next({ count: 1 });
    await waitFor(() => expect(harness.calls).toHaveLength(2));
    expect(harness.calls[1]).toMatchObject({ beforeSeq: 950, rangeKind: 'visible-gap', purpose: 'user-demand' });
    finish(scheduler, harness.calls[1], { oldest: 940, rows: 1, hasOlder: true });
    await expect(next).resolves.toMatchObject({ kind: 'segment', released: 1 });
    expect(revealed.at(-1)[0][0]).toBe(940);
    expect(scheduler.snapshot('c0').oldestSeq).toBe(900);
    operation.release();
    scheduler.destroy();
  });

  it('treats a stale local coverage claim as a local miss instead of blocking startup', async () => {
    const readCache = vi.fn(async (_channelId, beforeSeq) => ({
      rows: [], nextBeforeSeq: beforeSeq, exhausted: true, cacheMiss: true, bytes: 0,
    }));
    const scheduler = createHistoryScheduler({ requestPage: vi.fn(), readCache, revealRows: () => {} });
    scheduler.focus('c0');
    scheduler.setLocalMeta(new Map([['c0', {
      newestSeq: 100, rowCount: 1, coverage: [{ lowSeq: 1, highSeq: 100 }],
    }]]));
    await expect(scheduler.nextSegment('c0')).resolves.toMatchObject({ kind: 'exhausted', localOnly: true });
    scheduler.destroy();
  });

  it('routes concurrent rows by ref instead of guessing from seq', async () => {
    const harness = requestHarness();
    const revealed = new Map();
    const scheduler = createHistoryScheduler({
      requestPage: harness.requestPage,
      revealRows: (channelId, rows) => revealed.set(channelId, rows),
    });
    const operationA = scheduler.beginOperation('a');
    const segmentA = operationA.next();
    const operationB = scheduler.beginOperation('b');
    const segmentB = operationB.next();
    scheduler.attach([
      { channel_id: 'a', head_seq: 100, has_rows: true },
      { channel_id: 'b', head_seq: 100, has_rows: true },
    ], { generation: 1, focus: 'a' });
    await waitFor(() => expect(harness.calls).toHaveLength(2));
    const a = harness.calls.find((call) => call.channelId === 'a');
    const b = harness.calls.find((call) => call.channelId === 'b');
    finish(scheduler, b, { oldest: 90, rows: 1, hasOlder: false });
    finish(scheduler, a, { oldest: 80, rows: 1, hasOlder: false });
    await Promise.all([segmentA, segmentB]);
    await waitFor(() => expect(revealed.size).toBe(2));
    expect(revealed.get('a')[0][0]).toBe(80);
    expect(revealed.get('b')[0][0]).toBe(90);
    operationA.release();
    operationB.release();
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

  it('carries visual intent and urgency into the scheduler-owned batch', async () => {
    const harness = requestHarness();
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, revealRows: () => {} });
    const operation = scheduler.beginOperation('c0', {
      intent: 'restore-position',
      urgency: 'blocking',
    });
    scheduler.attach([{ channel_id: 'c0', head_seq: 100, has_rows: true }], { generation: 1, focus: 'c0' });

    await waitFor(() => expect(harness.calls).toHaveLength(1));
    expect(harness.calls[0]).toMatchObject({
      purpose: 'user-demand',
      priority: 'foreground',
      intent: 'restore-position',
      urgency: 'blocking',
    });
    operation.release();
    scheduler.destroy();
  });

  it('settles pending foreground work when the local replica epoch is reset', async () => {
    const scheduler = createHistoryScheduler({ requestPage: vi.fn(), revealRows: () => {} });
    const operation = scheduler.beginOperation('c0');
    const segment = operation.next();

    scheduler.resetReplica();

    await expect(segment).resolves.toEqual({ kind: 'cancelled' });
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

  it('cancels an abandoned initial tail when focus moves to another channel', async () => {
    const harness = requestHarness();
    const cancelPage = vi.fn(async () => ({ cancelled: true }));
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, cancelPage, revealRows: () => {} });
    scheduler.attach([
      { channel_id: 'a', head_seq: 100, has_rows: true },
      { channel_id: 'b', head_seq: 100, has_rows: true },
    ], { generation: 1, focus: 'a' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    const abandoned = harness.calls[0];
    expect(abandoned).toMatchObject({ channelId: 'a', priority: 'foreground' });

    scheduler.focus('b');
    await waitFor(() => expect(cancelPage).toHaveBeenCalledWith('a', abandoned.ref, 1));
    await waitFor(() => expect(harness.calls.filter((call) => call.channelId === 'b')).toHaveLength(1));
    expect(harness.calls.find((call) => call.channelId === 'b')).toMatchObject({
      purpose: 'initial-tail', priority: 'foreground', beforeSeq: 101,
    });
    scheduler.destroy();
  });

  it('does not expose a partial current-tail page when focus lands during cooperative ingestion', async () => {
    const harness = requestHarness();
    let enteredYield;
    let resumeYield;
    const yieldEntered = new Promise((resolve) => { enteredYield = resolve; });
    const yieldGate = new Promise((resolve) => { resumeYield = resolve; });
    const revealed = [];
    const scheduler = createHistoryScheduler({
      requestPage: harness.requestPage,
      revealRows: (_channelId, entries) => revealed.push(entries.map(([seq]) => seq)),
      yieldTask: () => {
        enteredYield();
        return yieldGate;
      },
    });
    scheduler.attach([{ channel_id: 'c0', head_seq: 100, has_rows: true }], { generation: 1, focus: 'c0' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    finish(scheduler, harness.calls[0], { oldest: 63, rows: 38, headSeq: 100 });

    await yieldEntered;
    // React may commit the focus effect while rememberRows is yielding after a
    // transport chunk. The focus edge must not release that incomplete prefix.
    scheduler.focus('c0');
    expect(revealed).toEqual([]);
    resumeYield();

    await waitFor(() => expect(revealed).toHaveLength(1));
    expect(revealed[0]).toEqual(Array.from({ length: 32 }, (_, index) => 69 + index));
    expect(scheduler.snapshot('c0')).toMatchObject({ buffered: 6, bufferedNewest: 68 });
    scheduler.destroy();
  });

  it('does not make the new focus wait for cancellation of the old focus', async () => {
    const harness = requestHarness();
    let acknowledge;
    const cancelPage = vi.fn(() => new Promise((resolve) => { acknowledge = resolve; }));
    const scheduler = createHistoryScheduler({ requestPage: harness.requestPage, cancelPage, revealRows: () => {} });
    scheduler.attach([
      { channel_id: 'a', head_seq: 100, has_rows: true },
      { channel_id: 'b', head_seq: 100, has_rows: true },
    ], { generation: 1, focus: 'a' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    scheduler.focus('b');
    await waitFor(() => expect(cancelPage).toHaveBeenCalledOnce());
    await waitFor(() => expect(harness.calls.filter((call) => call.channelId === 'b')).toHaveLength(1));
    expect(harness.calls.find((call) => call.channelId === 'b').priority).toBe('foreground');

    expect(harness.calls.filter((call) => call.channelId === 'b')).toHaveLength(1);

    acknowledge({ cancelled: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.calls.filter((call) => call.channelId === 'a')).toHaveLength(1);
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
    await waitFor(() => expect(readCache).toHaveBeenCalledWith('c0', 101, HISTORY_PAGE_SIZE, HISTORY_BATCH_BYTES));
	expect(readCache.mock.invocationCallOrder[0]).toBeLessThan(requestPage.mock.invocationCallOrder[0]);
	expect(requestPage).toHaveBeenCalledWith('c0', 20, HISTORY_PAGE_SIZE, expect.objectContaining({ purpose: 'hydrate' }));
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
	  await waitFor(() => expect(readCache).toHaveBeenCalledWith('c0', 101, HISTORY_PAGE_SIZE, HISTORY_BATCH_BYTES));
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

  it('uses a focused Meta refresh to catch up the latest tail without moving the deep-history cursor', async () => {
    const harness = requestHarness();
    const visible = new Set();
    const revealRows = vi.fn((_channelId, entries) => entries.forEach(([seq]) => visible.add(seq)));
    const scheduler = createHistoryScheduler({
      requestPage: harness.requestPage,
      revealRows,
      hasVisibleRow: (_channelId, seq) => visible.has(seq),
      visibleNewestSeq: () => Math.max(0, ...visible),
    });
    scheduler.attach([{ channel_id: 'c0', head_seq: 10, has_rows: true }], { generation: 1, focus: 'c0' });
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    finish(scheduler, harness.calls[0], { oldest: 9, rows: 2, hasOlder: false });
    await waitFor(() => expect(scheduler.snapshot('c0').loading).toBe(false));
    const deepFrontier = scheduler.snapshot('c0').oldestSeq;

    expect(scheduler.refreshRemoteMeta({
      channel_id: 'c0', head_seq: 13, has_rows: true, generation: 1,
    })).toBe(true);
    await waitFor(() => expect(harness.calls).toHaveLength(2));
    const refresh = harness.calls[1];
    expect(refresh).toMatchObject({
      channelId: 'c0', beforeSeq: 14, priority: 'foreground', rangeKind: 'tail-refresh',
    });
    finish(scheduler, refresh, { oldest: 11, rows: 3, hasOlder: true });
    await waitFor(() => expect(scheduler.snapshot('c0').loading).toBe(false));
    expect([...visible].sort((left, right) => left - right)).toEqual([9, 10, 11, 12, 13]);
    expect(scheduler.snapshot('c0').oldestSeq).toBe(deepFrontier);
    expect(revealRows).toHaveBeenLastCalledWith('c0', [
      [11, expect.any(Object)], [12, expect.any(Object)], [13, expect.any(Object)],
    ], { initial: false });
    scheduler.destroy();
  });

  it('treats attach Meta as an immediate tail fence before exposing cached controls', async () => {
    const harness = requestHarness();
    const visible = new Set([100]);
    const scheduler = createHistoryScheduler({
      requestPage: harness.requestPage,
      revealRows: (_channelId, entries) => entries.forEach(([seq]) => visible.add(seq)),
      visibleNewestSeq: () => Math.max(0, ...visible),
    });

    scheduler.attach([{ channel_id: 'c0', head_seq: 105, has_rows: true }], { generation: 1, focus: 'c0' });
    expect(scheduler.snapshot('c0').controlCurrent).toBe(false);
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    expect(harness.calls[0]).toMatchObject({ beforeSeq: 106, rangeKind: 'tail-refresh', priority: 'foreground' });

    finish(scheduler, harness.calls[0], { oldest: 101, rows: 5, hasOlder: true });
    await waitFor(() => expect(scheduler.snapshot('c0').controlCurrent).toBe(true));
    scheduler.destroy();
  });

  it('bridges a remote head that arrives before the local cache frontier is ready', async () => {
    const harness = requestHarness();
    const readCache = vi.fn(async (_channelId, beforeSeq) => ({
      rows: [], nextBeforeSeq: beforeSeq, exhausted: true, cacheMiss: true, bytes: 0,
    }));
    const scheduler = createHistoryScheduler({
      requestPage: harness.requestPage,
      readCache,
      revealRows: () => {},
    });

    // App startup attaches the authoritative channel Meta before IndexedDB has
    // finished decoding its newest durable interval. The later cache frontier
    // must not replace the remote upper bound and silently skip 845..848.
    scheduler.setLocalMeta(new Map(), { localReady: false });
    scheduler.attach([{ channel_id: 'c0', head_seq: 848, has_rows: true }], {
      generation: 1,
      focus: 'c0',
    });
    expect(harness.calls).toHaveLength(0);

    scheduler.setLocalMeta(new Map([['c0', {
      newestSeq: 844,
      rowCount: 844,
      coverage: [{ lowSeq: 715, highSeq: 844 }],
    }]]), { localReady: true });

    await waitFor(() => expect(readCache).toHaveBeenCalledWith('c0', 845, HISTORY_PAGE_SIZE, HISTORY_BATCH_BYTES));
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    expect(harness.calls[0]).toMatchObject({
      channelId: 'c0',
      beforeSeq: 849,
      rangeKind: 'tail-refresh',
      priority: 'foreground',
    });
    expect(scheduler.snapshot('c0').controlCurrent).toBe(false);

    finish(scheduler, harness.calls[0], { oldest: 845, rows: 4, hasOlder: true, headSeq: 848 });
    await waitFor(() => expect(scheduler.snapshot('c0').controlCurrent).toBe(true));
    expect(scheduler.snapshot('c0').oldestSeq).toBe(845);
    scheduler.destroy();
  });

  it('bridges a remote head that advances while the initial page is in flight', async () => {
    const harness = requestHarness();
    const visible = new Set();
    const scheduler = createHistoryScheduler({
      requestPage: harness.requestPage,
      revealRows: (_channelId, entries) => entries.forEach(([seq]) => visible.add(seq)),
      visibleNewestSeq: () => Math.max(0, ...visible),
    });

    scheduler.attach([{ channel_id: 'c0', head_seq: 844, has_rows: true }], {
      generation: 1,
      focus: 'c0',
    });
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    expect(harness.calls[0]).toMatchObject({ beforeSeq: 845, rangeKind: 'backfill' });

    for (const seq of [843, 844]) {
      scheduler.historyRow({
        source: 'history', ref: harness.calls[0].ref, generation: 1,
        channel_id: 'c0', seq,
        envelope: { id: `c0-${seq}`, kind: 'event', type: 'human.note', payload: { text: `${seq}` } },
      });
    }
    scheduler.pageEnd({
      source: 'history', ref: harness.calls[0].ref, generation: 1,
      channel_id: 'c0', purpose: 'initial-tail', head_seq: 848,
      oldest_seq: 843, scan_low_seq: 843, scan_high_seq: 844,
      next_before_seq: 843, rows: 2, bytes: 20, has_older: true,
    });

    await waitFor(() => expect(harness.calls).toHaveLength(2));
    expect(harness.calls[1]).toMatchObject({
      beforeSeq: 849,
      rangeKind: 'tail-refresh',
      priority: 'foreground',
    });
    expect(scheduler.snapshot('c0').controlCurrent).toBe(false);

    finish(scheduler, harness.calls[1], { oldest: 845, rows: 4, hasOlder: true, headSeq: 848 });
    await waitFor(() => expect(scheduler.snapshot('c0').controlCurrent).toBe(true));
    expect([...visible].sort((left, right) => left - right)).toEqual([843, 844, 845, 846, 847, 848]);
    scheduler.destroy();
  });
});

describe('live feed priority', () => {
  async function attachWithReadAuthority(hook, grants, {
    principalId,
    generation = 1,
    focus = 'c0',
    boot = 'history-test-boot',
  }) {
    await act(async () => {
      await hook.result.current.prepareLocalReplica(principalId, { focus });
    });
    await act(async () => {
      await hook.result.current.setHistoryGrants(grants, {
        generation, focus, boot,
      });
    });
    expect(hook.result.current.cursorsRef.current.isReadAuthorityReady()).toBe(true);
  }

  it('exposes the one scheduler operation so a coalesced visual demand can promote it in place', async () => {
    const hook = renderHook(() => useChannelFeed({
      wireRef: { current: { historyBefore: vi.fn() } },
      rosterRef: { current: { self: () => '', observeFeed: () => '', handleEnvelope: () => {} } },
      accessRef: { current: { live: () => {} } },
      activeChannelRef: { current: 'c0' },
      onRoster: () => {}, onError: () => {}, onChannelsDiscovered: () => {},
      onDirectoryInvalidated: () => {}, onTimerFired: () => {},
      onSubmissionFeed: () => {}, onAccessChanged: () => {},
    }), { wrapper: ({ children }) => <StrictMode>{children}</StrictMode> });
    const controller = new AbortController();
    const onOperation = vi.fn();
    let result;
    act(() => {
      result = hook.result.current.loadHistory('c0', {
        signal: controller.signal,
        urgency: 'anticipatory',
        onOperation,
      });
    });
    expect(onOperation).toHaveBeenCalledOnce();
    expect(onOperation.mock.calls[0][0]).toMatchObject({
      next: expect.any(Function), promote: expect.any(Function), release: expect.any(Function),
    });
    controller.abort();
    await expect(result).resolves.toEqual({ kind: 'cancelled' });
    hook.unmount();
  });

  it('applies live rows on the next frame while a history batch is in flight', async () => {
    const historyBefore = vi.fn((channelId, _before, _limit, options) => accepted('history-live', channelId, options.generation, options.purpose));
    const hook = renderHook(() => useChannelFeed({
      wireRef: { current: { historyBefore } },
      rosterRef: { current: { self: () => '', observeFeed: () => '', handleEnvelope: () => {} } },
      accessRef: { current: { live: () => {} } },
      activeChannelRef: { current: 'c0' },
      onRoster: () => {}, onError: () => {}, onChannelsDiscovered: () => {},
      onDirectoryInvalidated: () => {}, onTimerFired: () => {},
      onSubmissionFeed: () => {}, onAccessChanged: () => {},
    }), { wrapper: ({ children }) => <StrictMode>{children}</StrictMode> });
    await attachWithReadAuthority(hook, [
      { channel_id: 'c0', head_seq: 100, has_rows: true },
    ], { principalId: 'history-live-principal' });
    await waitFor(() => expect(historyBefore).toHaveBeenCalledOnce());
    expect(hook.result.current.cursorsRef.current.read('c0')).toBe(100);
    act(() => hook.result.current.enqueue('c0', 101, {
      id: 'live', kind: 'event', type: 'human.note', visibility: 'public',
      sender: { id: 'me', kind: 'human' }, payload: { text: '实时' },
    }, { source: 'live', generation: 1, channel_id: 'c0', seq: 101, envelope: {
      id: 'live', kind: 'event', type: 'human.note', visibility: 'public',
      sender: { id: 'me', kind: 'human' }, payload: { text: '实时' },
    } }));
    // Desktop and mobile share the same frame boundary: live still bypasses the
    // history executor, but a burst publishes once instead of once per row.
    await waitFor(() => expect(hook.result.current.statesRef.current.get('c0')?.rows.has(101)).toBe(true));
    // Merely being the selected channel is not evidence that the user saw the
    // tail; Timeline advances this only after its scroller confirms bottom.
    expect(hook.result.current.cursorsRef.current.read('c0')).toBe(100);
    const version = hook.result.current.version;
    act(() => hook.result.current.markRead('c0', { physicalSeq: 101, identities: [] }));
    expect(hook.result.current.cursorsRef.current.read('c0')).toBe(101);
    // A readable standalone event belongs to the open viewport's dynamics,
    // not the request/final-only channel rail. Advancing the physical cursor
    // therefore does not publish a spurious rail-cache revision.
    expect(hook.result.current.version).toBe(version);
    hook.unmount();
  });

  it('invalidates the rail cache when marking a weak public notification read', async () => {
    const historyBefore = vi.fn((channelId, _before, _limit, options) => accepted('history-system', channelId, options.generation, options.purpose));
    const hook = renderHook(() => useChannelFeed({
      wireRef: { current: { historyBefore } },
      rosterRef: { current: { self: () => 'me', observeFeed: () => '', handleEnvelope: () => {} } },
      accessRef: { current: { live: () => {} } },
      activeChannelRef: { current: 'c0' },
      onRoster: () => {}, onError: () => {}, onChannelsDiscovered: () => {},
      onDirectoryInvalidated: () => {}, onTimerFired: () => {},
      onSubmissionFeed: () => {}, onAccessChanged: () => {},
    }));
    await attachWithReadAuthority(hook, [
      { channel_id: 'c0', head_seq: 100, has_rows: true },
    ], { principalId: 'me' });
    act(() => hook.result.current.enqueue({
      source: 'live', generation: 1, channel_id: 'c0', seq: 101,
      envelope: {
        id: 'weak-tool-call', kind: 'request', type: 'tool.run', visibility: 'public',
        sender: { id: 'agent:worker:1', kind: 'agent' }, audience: ['tool:runner:1'], payload: {},
      },
    }));
    await waitFor(() => expect(hook.result.current.unreadFor('c0', 'me').total).toBe(1));
    act(() => hook.result.current.markRead('c0', { physicalSeq: 101, identities: [] }));
    expect(hook.result.current.unreadFor('c0', 'me')).toEqual({ related: 0, total: 0 });
    hook.unmount();
  });
});
