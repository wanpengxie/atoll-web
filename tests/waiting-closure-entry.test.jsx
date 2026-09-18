// @vitest-environment jsdom
import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { createHistoryScheduler } from '../src/model/history-scheduler.js';
import { trimChannelState } from '../src/model/memory-window.js';
import { selectWaitingPresentation } from '../src/model/waiting-presentation.js';

const CHANNEL = 'c0';
const SELF = 'human:root:1';
const AGENT = { id: 'agent:worker:1', kind: 'agent' };

function request(seq = 1) {
  return { channel_id: CHANNEL, seq, envelope: {
    id: 'work', kind: 'request', type: 'agent.ask', sender: { id: SELF, kind: 'human' },
    audience: [AGENT.id], visibility: 'public', payload: { text: 'work' },
  } };
}

function queued(seq = 2) {
  return { channel_id: CHANNEL, seq, envelope: {
    id: 'work-queued', parent_id: 'work', kind: 'response', type: 'agent.ask', sender: AGENT,
    audience: [SELF], visibility: 'public', payload: { status: 'queued' },
  } };
}

function terminal(seq = 3) {
  return { channel_id: CHANNEL, seq, envelope: {
    id: 'work-done', parent_id: 'work', kind: 'response', type: 'agent.ask', sender: AGENT,
    audience: [SELF], visibility: 'public', payload: { status: 'completed', text: 'done' },
  } };
}

function note(seq) {
  return { channel_id: CHANNEL, seq, envelope: {
    id: `note-${seq}`, kind: 'event', type: 'human.note', sender: { id: SELF, kind: 'human' },
    visibility: 'public', payload: { text: `${seq}` },
  } };
}

function accepted(ref, channelId, generation) {
  const promise = Promise.resolve({ accepted: true, channel_id: channelId, generation });
  promise.ref = ref;
  return promise;
}

function networkHarness() {
  const calls = [];
  const requestPage = vi.fn((channelId, beforeSeq, limit, options) => {
    const ref = `page-${calls.length + 1}`;
    calls.push({ ref, channelId, beforeSeq, limit, ...options });
    return accepted(ref, channelId, options.generation);
  });
  return { calls, requestPage };
}

function createReplicaScheduler({ requestPage, readCache, localMeta = new Map(), attached = true } = {}) {
  const replica = createChannelReplicaStore();
  const reveals = [];
  const errors = [];
  const scheduler = createHistoryScheduler({
    requestPage,
    readCache,
    onError: (error) => errors.push(error),
    hasVisibleRow: (channelId, seq) => replica.hasRow(channelId, seq),
    hasPresentedRows: (channelId) => Boolean(replica.state(channelId)?.rows.size),
    visibleOldestSeq: (channelId) => replica.visibleOldest(channelId),
    visibleNewestSeq: (channelId) => replica.visibleNewest(channelId),
    revealRows: (channelId, entries) => {
      reveals.push(entries.map(([seq]) => seq));
      for (const [seq, envelope] of entries) replica.commit({ channel_id: channelId, seq, envelope }, SELF);
    },
  });
  if (attached) {
    scheduler.attach([{ channel_id: CHANNEL, head_seq: 20, has_rows: true }], {
      generation: 1, focus: CHANNEL, localMeta,
    });
  } else {
    scheduler.setLocalMeta(localMeta, { localReady: true });
    scheduler.focus(CHANNEL);
  }
  return { errors, replica, reveals, scheduler };
}

function endNetworkPage(scheduler, call, rows, { nextBefore, hasOlder }) {
  for (const row of rows) scheduler.historyRow({
    source: 'history', ref: call.ref, generation: call.generation,
    channel_id: CHANNEL, seq: row.seq, envelope: row.envelope,
  });
  scheduler.pageEnd({
    source: 'history', ref: call.ref, generation: call.generation,
    channel_id: CHANNEL, purpose: call.purpose, head_seq: 20,
    oldest_seq: rows[0]?.seq || 0,
    scan_low_seq: nextBefore, scan_high_seq: call.beforeSeq - 1,
    next_before_seq: nextBefore, rows: rows.length, bytes: rows.length * 256, has_older: hasOlder,
  });
}

async function installAndTrimClosedRoot(harness) {
  await waitFor(() => expect(harness.calls).toHaveLength(1));
  const initial = [request(), queued(), terminal(), ...Array.from({ length: 17 }, (_, index) => note(index + 4))];
  endNetworkPage(harness.scheduler, harness.calls[0], initial, { nextBefore: 1, hasOlder: false });
  await waitFor(() => expect(harness.replica.state(CHANNEL)?.turns.get('work')?.terminal).toBeTruthy());
  trimChannelState(harness.replica.state(CHANNEL), { maxRows: 8, maxBytes: 1e9 });
  harness.replica.afterTrim(CHANNEL);
  expect(harness.replica.state(CHANNEL).turns.has('work')).toBe(false);
  expect(harness.replica.state(CHANNEL)._unmatchedTerminalClosures.has('work')).toBe(true);
}

describe('terminal closure across real replay entrances', () => {
  it('keeps a matched live terminal across trim until an older in-flight page releases', async () => {
    const network = networkHarness();
    const harness = { ...network, ...createReplicaScheduler({ requestPage: network.requestPage }) };
    await waitFor(() => expect(harness.calls).toHaveLength(1));
    const stale = harness.calls[0];
    for (const row of [request(), queued()]) harness.scheduler.historyRow({
      source: 'history', ref: stale.ref, generation: stale.generation,
      channel_id: CHANNEL, seq: row.seq, envelope: row.envelope,
    });

    // The page is still buffered. Live commits the same root, closes it, and
    // advances far enough for the mobile window to evict the matched turn.
    for (const row of [
      request(), queued(),
      ...Array.from({ length: 18 }, (_, index) => note(index + 3)),
      terminal(21),
      ...Array.from({ length: 29 }, (_, index) => note(index + 22)),
    ]) {
      harness.replica.commit(row, SELF);
      harness.scheduler.observeLive(CHANNEL, Date.now(), { seq: row.seq });
    }
    trimChannelState(harness.replica.state(CHANNEL), { maxRows: 8, maxBytes: 1e9 });
    harness.replica.afterTrim(CHANNEL);
    expect(harness.replica.state(CHANNEL).turns.has('work')).toBe(false);

    // Same-generation pageEnd is still valid. Its rows were buffered before
    // the live close, but hasVisibleRow is evaluated only now, after trim.
    harness.scheduler.pageEnd({
      source: 'history', ref: stale.ref, generation: stale.generation,
      channel_id: CHANNEL, purpose: stale.purpose, head_seq: 50,
      oldest_seq: 1, scan_low_seq: 1, scan_high_seq: stale.beforeSeq - 1,
      next_before_seq: 1, rows: 2, bytes: 512, has_older: false,
    });
    await waitFor(() => expect(harness.replica.state(CHANNEL).turns.has('work')).toBe(true));
    expect(harness.replica.state(CHANNEL).turns.get('work')).toMatchObject({ latestStatus: 'completed', terminalSeq: 21 });
    expect(selectWaitingPresentation(harness.replica.state(CHANNEL), { controlCurrent: true })).toEqual([]);
    expect(harness.errors).toEqual([]);
    harness.scheduler.destroy();
  });

  it('releases the newer terminal visible-gap page before the older request page', async () => {
    const network = networkHarness();
    const harness = { ...network, ...createReplicaScheduler({ requestPage: network.requestPage }) };
    await installAndTrimClosedRoot(harness);

    const operation = harness.scheduler.beginOperation(CHANNEL);
    const terminalSegment = operation.next({ count: 32 });
    await waitFor(() => expect(harness.calls).toHaveLength(2));
    endNetworkPage(harness.scheduler, harness.calls[1], [terminal()], { nextBefore: 3, hasOlder: true });
    await expect(terminalSegment).resolves.toMatchObject({ kind: 'segment', released: 1 });
    expect(harness.replica.state(CHANNEL)._unmatchedTerminalClosures.has('work')).toBe(true);

    const requestSegment = operation.next({ count: 32 });
    await waitFor(() => expect(harness.calls).toHaveLength(3));
    endNetworkPage(harness.scheduler, harness.calls[2], [request(), queued()], { nextBefore: 1, hasOlder: false });
    await expect(requestSegment).resolves.toMatchObject({ kind: 'segment', released: 2 });
    expect(harness.replica.state(CHANNEL).turns.get('work')).toMatchObject({ latestStatus: 'completed', terminalSeq: 3 });
    expect(selectWaitingPresentation(harness.replica.state(CHANNEL), { controlCurrent: true })).toEqual([]);
    expect(harness.errors).toEqual([]);
    operation.release();
    harness.scheduler.destroy();
  });

  it('drains one bounded reservoir newest-first across partial reveal segments', async () => {
    const network = networkHarness();
    const harness = { ...network, ...createReplicaScheduler({ requestPage: network.requestPage }) };
    await installAndTrimClosedRoot(harness);

    const operation = harness.scheduler.beginOperation(CHANNEL);
    const first = operation.next({ count: 1 });
    await waitFor(() => expect(harness.calls).toHaveLength(2));
    endNetworkPage(harness.scheduler, harness.calls[1], [request(), queued(), terminal()], { nextBefore: 1, hasOlder: false });
    await expect(first).resolves.toMatchObject({ kind: 'segment', released: 1 });
    expect(harness.reveals.at(-1)).toEqual([3]);
    expect(harness.replica.state(CHANNEL)._unmatchedTerminalClosures.has('work')).toBe(true);

    await expect(operation.next({ count: 1 })).resolves.toMatchObject({ kind: 'segment', released: 1 });
    expect(harness.reveals.at(-1)).toEqual([2]);
    expect(harness.replica.state(CHANNEL).turns.has('work')).toBe(false);

    await expect(operation.next({ count: 1 })).resolves.toMatchObject({ kind: 'segment', released: 1 });
    expect(harness.reveals.at(-1)).toEqual([1]);
    expect(harness.replica.state(CHANNEL).turns.get('work')).toMatchObject({ latestStatus: 'completed' });
    expect(selectWaitingPresentation(harness.replica.state(CHANNEL), { controlCurrent: true })).toEqual([]);
    expect(harness.errors).toEqual([]);
    operation.release();
    harness.scheduler.destroy();
  });

  it('merges a concurrent live terminal before publishing its buffered replay page', async () => {
    const network = networkHarness();
    const harness = { ...network, ...createReplicaScheduler({ requestPage: network.requestPage }) };
    await installAndTrimClosedRoot(harness);

    const operation = harness.scheduler.beginOperation(CHANNEL);
    const segment = operation.next({ count: 32 });
    await waitFor(() => expect(harness.calls).toHaveLength(2));
    const call = harness.calls[1];
    for (const row of [request(), queued()]) harness.scheduler.historyRow({
      source: 'history', ref: call.ref, generation: call.generation,
      channel_id: CHANNEL, seq: row.seq, envelope: row.envelope,
    });
    // The live lane flushes before the historical page is released. Fold owns
    // the shared closure and the following replay cannot reopen the root.
    harness.replica.commit(terminal(21), SELF);
    harness.scheduler.observeLive(CHANNEL, Date.now(), { seq: 21 });
    harness.scheduler.pageEnd({
      source: 'history', ref: call.ref, generation: call.generation,
      channel_id: CHANNEL, purpose: call.purpose, head_seq: 21,
      oldest_seq: 1, scan_low_seq: 1, scan_high_seq: call.beforeSeq - 1,
      next_before_seq: 1, rows: 2, bytes: 512, has_older: false,
    });
    await expect(segment).resolves.toMatchObject({ kind: 'segment', released: 2 });
    expect(harness.replica.state(CHANNEL).turns.get('work')).toMatchObject({ latestStatus: 'completed', terminalSeq: 3 });
    expect(selectWaitingPresentation(harness.replica.state(CHANNEL), { controlCurrent: true })).toEqual([]);
    expect(harness.errors).toEqual([]);
    operation.release();
    harness.scheduler.destroy();
  });

  it('uses IndexedDB pages in the same terminal-before-request order', async () => {
    const reads = [];
    const pages = new Map([
      [21, { rows: [request(), queued(), terminal(), ...Array.from({ length: 17 }, (_, index) => note(index + 4))], nextBeforeSeq: 1, exhausted: true, bytes: 5_120 }],
      [15, { rows: [terminal()], nextBeforeSeq: 3, exhausted: false, bytes: 256 }],
      [3, { rows: [request(), queued()], nextBeforeSeq: 1, exhausted: true, bytes: 512 }],
    ]);
    const readCache = vi.fn(async (_channelId, beforeSeq) => {
      reads.push(beforeSeq);
      return pages.get(beforeSeq);
    });
    const localMeta = new Map([[CHANNEL, {
      newestSeq: 20, rowCount: 20, coverage: [{ lowSeq: 1, highSeq: 20 }],
    }]]);
    const harness = createReplicaScheduler({
      readCache, localMeta, attached: false,
      requestPage: () => { throw new Error('network not expected'); },
    });
    await waitFor(() => expect(reads).toEqual([21]));
    await waitFor(() => expect(harness.replica.state(CHANNEL)?.turns.get('work')?.terminal).toBeTruthy());
    trimChannelState(harness.replica.state(CHANNEL), { maxRows: 8, maxBytes: 1e9 });
    harness.replica.afterTrim(CHANNEL);
    expect(harness.replica.state(CHANNEL)._unmatchedTerminalClosures.has('work')).toBe(true);

    const operation = harness.scheduler.beginOperation(CHANNEL);
    await expect(operation.next({ count: 32 })).resolves.toMatchObject({ kind: 'segment', released: 1 });
    await waitFor(() => expect(reads).toEqual([21, 15]));
    expect(harness.replica.state(CHANNEL)._unmatchedTerminalClosures.has('work')).toBe(true);

    await expect(operation.next({ count: 32 })).resolves.toMatchObject({ kind: 'segment', released: 2 });
    await waitFor(() => expect(reads).toEqual([21, 15, 3]));
    expect(harness.replica.state(CHANNEL).turns.get('work')).toMatchObject({ latestStatus: 'completed' });
    expect(selectWaitingPresentation(harness.replica.state(CHANNEL), { controlCurrent: true })).toEqual([]);
    expect(harness.errors).toEqual([]);
    operation.release();
    harness.scheduler.destroy();
  });

  it('merges a cached terminal into an already-materialized canonical request', async () => {
    const replica = createChannelReplicaStore();
    replica.commit(request(), SELF);
    replica.commit(note(3), SELF);
    const reads = [];
    const errors = [];
    const readCache = vi.fn(async (_channelId, beforeSeq) => {
      reads.push(beforeSeq);
      return {
        rows: [terminal(2)], nextBeforeSeq: 2, exhausted: true, bytes: 256,
      };
    });
    const scheduler = createHistoryScheduler({
      requestPage: () => { throw new Error('network not expected'); },
      readCache,
      onError: (error) => errors.push(error),
      hasVisibleRow: (channelId, seq) => replica.hasRow(channelId, seq),
      hasPresentedRows: () => true,
      visibleOldestSeq: (channelId) => replica.visibleOldest(channelId),
      visibleNewestSeq: (channelId) => replica.visibleNewest(channelId),
      revealRows: (channelId, entries) => {
        for (const [seq, envelope] of entries) replica.commit({ channel_id: channelId, seq, envelope }, SELF);
      },
    });
    scheduler.setLocalMeta(new Map([[CHANNEL, {
      newestSeq: 3, rowCount: 3, coverage: [{ lowSeq: 1, highSeq: 3 }],
    }]]), { localReady: true });
    scheduler.focus(CHANNEL);
    await waitFor(() => expect(reads).toEqual([4]));
    await waitFor(() => expect(scheduler.snapshot(CHANNEL).buffered).toBe(1));
    const operation = scheduler.beginOperation(CHANNEL);
    await expect(operation.next({ count: 1 })).resolves.toMatchObject({ kind: 'segment', released: 1 });
    await waitFor(() => expect(replica.state(CHANNEL).turns.get('work')).toMatchObject({ latestStatus: 'completed', terminalSeq: 2 }));
    expect(selectWaitingPresentation(replica.state(CHANNEL), { controlCurrent: true })).toEqual([]);
    expect(errors).toEqual([]);
    operation.release();
    scheduler.destroy();
  });
});
