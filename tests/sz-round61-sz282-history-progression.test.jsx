// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';
import { selectTimelineItems } from '../src/model/conversation-presentation.js';

function runtimeOptions(wireRef) {
  return {
    wireRef,
    rosterRef: { current: {
      self: () => 'human:root:1',
      handleEnvelope: () => {},
    } },
    accessRef: { current: { live: () => false } },
    activeChannelRef: { current: 'c0' },
    onError: vi.fn(),
    onChannelsDiscovered: vi.fn(),
    onDirectoryInvalidated: vi.fn(),
    onAccessChanged: vi.fn(),
    onSubmissionFeed: vi.fn(),
  };
}

function row(seq, id = `history-note-${seq}`) {
  return {
    channel_id: 'c0',
    seq,
    envelope: {
      id,
      kind: 'event',
      type: 'human.note',
      payload: { body: { text: `history ${seq}` } },
    },
  };
}

function wireHarness() {
  const requests = [];
  const wireRef = { current: {
    historyBefore: vi.fn((channelId, beforeSeq, limit, detail) => {
      const ref = `sz282-history-${requests.length + 1}`;
      requests.push({ channelId, beforeSeq, limit, ref, ...detail });
      const receipt = Promise.resolve({ accepted: true, generation: detail.generation, channel_id: channelId });
      receipt.ref = ref;
      return receipt;
    }),
    cancelHistory: vi.fn(async () => undefined),
  } };
  return { requests, wireRef };
}

async function attachedRuntime({ headSeq = 6 } = {}) {
  const harness = wireHarness();
  const runtime = createChannelFeedRuntime(runtimeOptions(harness.wireRef));
  runtime.mount();
  await runtime.getSnapshot().setHistoryGrants([
    { channel_id: 'c0', head_seq: headSeq, has_rows: true },
  ], { generation: 1, boot: 'sz282-history-boot', focus: 'c0' });
  return { ...harness, runtime, snapshot: runtime.getSnapshot() };
}

function projection(snapshot) {
  return selectTimelineItems(snapshot.stateFor('c0'), { scope: 'all' }).items
    .map((item) => ({ id: item.id || item.envelope?.id || '', seq: Number(item.seq || 0) }));
}

function complete(snapshot, request, rows, { nextBeforeSeq = 1, hasOlder = false } = {}) {
  for (const item of rows) {
    expect(snapshot.enqueue({ ...item, ref: request.ref, generation: 1 })).toBe(true);
  }
  expect(snapshot.pageEnd({
    ref: request.ref,
    channel_id: 'c0',
    generation: 1,
    rows: rows.length,
    scan_low_seq: rows.at(0)?.seq || 0,
    scan_high_seq: rows.at(-1)?.seq || 0,
    next_before_seq: nextBeforeSeq,
    has_older: hasOlder,
  })).toBe(true);
}

describe('SZ-282 public history progression', () => {
  it('keeps older pages in stable visible order and rejects duplicate facts', async () => {
    const { requests, runtime, snapshot } = await attachedRuntime();
    try {
      const newest = snapshot.loadHistory('c0', {
        beforeSeq: 7, limit: 3, intent: 'scroll-history', urgency: 'blocking',
      });
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      complete(snapshot, requests[0], [row(4), row(5), row(6)], { nextBeforeSeq: 4, hasOlder: true });
      await expect(newest).resolves.toMatchObject({ kind: 'satisfied' });
      expect(projection(snapshot).map((item) => item.seq)).toEqual([4, 5, 6]);

      const older = snapshot.loadHistory('c0', {
        beforeSeq: 4, limit: 3, intent: 'scroll-history', urgency: 'blocking',
      });
      await vi.waitFor(() => expect(requests).toHaveLength(2));
      expect(snapshot.enqueue({ ...row(2), ref: requests[1].ref, generation: 1 })).toBe(true);
      // The transport receipt may acknowledge the repeated frame, but the
      // public Replica projection must still contain one canonical fact.
      expect(snapshot.enqueue({ ...row(2), ref: requests[1].ref, generation: 1 })).toBe(true);
      expect(snapshot.enqueue({ ...row(1), ref: requests[1].ref, generation: 1 })).toBe(true);
      expect(snapshot.enqueue({ ...row(3), ref: requests[1].ref, generation: 1 })).toBe(true);
      expect(snapshot.pageEnd({
        ref: requests[1].ref, channel_id: 'c0', generation: 1, rows: 4,
        scan_low_seq: 1, scan_high_seq: 3, next_before_seq: 1, has_older: false,
      })).toBe(true);
      await expect(older).resolves.toMatchObject({ kind: 'satisfied' });

      const visible = projection(snapshot);
      expect(visible.map((item) => item.seq)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(new Set(visible.map((item) => item.id)).size).toBe(visible.length);
    } finally {
      runtime.destroy();
    }
  });

  it('surfaces pending before admission, typed error after a failed page, and clears it on retry', async () => {
    const harness = wireHarness();
    const runtime = createChannelFeedRuntime(runtimeOptions(harness.wireRef));
    runtime.mount();
    const snapshot = runtime.getSnapshot();
    try {
      await expect(snapshot.loadHistory('c0', {
        intent: 'scroll-history', urgency: 'blocking', beforeSeq: 7, limit: 3,
      })).resolves.toMatchObject({ kind: 'waiting', reason: 'history-grant-pending' });
      expect(snapshot.historyFor('c0')).toMatchObject({
        loading: true,
        historyDemand: { phase: 'pending', error: '' },
      });

      await snapshot.setHistoryGrants([
        { channel_id: 'c0', head_seq: 6, has_rows: true },
      ], { generation: 1, boot: 'sz282-history-retry-boot', focus: 'c0' });
      await vi.waitFor(() => expect(harness.requests).toHaveLength(1));
      // The initial pre-admission caller has no waiter after it receives its
      // typed `waiting` result.  A current explicit retry caller owns the
      // admitted physical outcome and is the public error/retry observable.
      const failed = snapshot.loadHistory('c0', {
        intent: 'scroll-history', urgency: 'blocking', beforeSeq: 7, limit: 3,
      });
      expect(snapshot.pageEnd({
        ref: harness.requests[0].ref, channel_id: 'c0', generation: 1,
        error_code: 'offline', error_detail: 'temporary offline',
      })).toBe(true);
      await expect(failed).resolves.toMatchObject({ kind: 'failed' });
      expect(snapshot.historyFor('c0')).toMatchObject({
        loading: false,
        errorCode: 'history_failed',
        historyDemand: { phase: 'error', error: 'temporary offline' },
      });

      const retry = snapshot.loadHistory('c0', {
        intent: 'scroll-history', urgency: 'blocking', beforeSeq: 7, limit: 3,
      });
      await vi.waitFor(() => expect(harness.requests).toHaveLength(2));
      complete(snapshot, harness.requests[1], [row(4), row(5), row(6)], {
        nextBeforeSeq: 4, hasOlder: true,
      });
      await expect(retry).resolves.toMatchObject({ kind: 'satisfied' });
      expect(snapshot.historyFor('c0')).toMatchObject({
        loading: false,
        error: '',
        errorCode: '',
        historyDemand: { phase: 'idle', error: '' },
      });
      expect(projection(snapshot).map((item) => item.seq)).toEqual([4, 5, 6]);
    } finally {
      runtime.destroy();
    }
  });
});
