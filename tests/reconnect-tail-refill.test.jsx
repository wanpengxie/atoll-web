// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';

function options(wireRef) {
  return {
    wireRef,
    rosterRef: { current: { self: () => '', observeFeed: () => '', handleEnvelope: () => {} } },
    accessRef: { current: { live: () => false } },
    activeChannelRef: { current: 'c0' },
    onRoster: vi.fn(), onError: vi.fn(), onChannelsDiscovered: vi.fn(), onDirectoryInvalidated: vi.fn(),
    onTimerFired: vi.fn(), onSubmissionFeed: vi.fn(), onAccessChanged: vi.fn(), onAgentActivity: vi.fn(),
  };
}
const envelope = (seq) => ({ id: `row-${seq}`, kind: 'event', type: 'human.note', payload: { body: { text: `row ${seq}` } } });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeWire() {
  const requests = [];
  const wireRef = { current: {
    historyBefore: vi.fn((channelId, beforeSeq, limit, detail) => {
      const ref = `refill-${requests.length + 1}`;
      requests.push({ channelId, beforeSeq, limit, ref, ...detail });
      const receipt = Promise.resolve({ accepted: true, generation: detail.generation, channel_id: channelId });
      receipt.ref = ref;
      return receipt;
    }),
    cancelHistory: vi.fn(async () => undefined),
  } };
  return { wireRef, requests };
}

// Answer one history request with rows (low..high], newest page semantics.
function answer(snapshot, request, generation, low) {
  const high = request.beforeSeq - 1;
  const from = Math.max(low, high - request.limit + 1);
  for (let seq = from; seq <= high; seq += 1) {
    snapshot.enqueue({ ref: request.ref, channel_id: 'c0', seq, envelope: envelope(seq) });
  }
  snapshot.pageEnd({
    ref: request.ref, channel_id: 'c0', generation, rows: high - from + 1,
    scan_low_seq: from, scan_high_seq: high, next_before_seq: from, has_older: from > 1,
  });
}

describe('reconnect refills the stretch that landed while disconnected', () => {
  it('fetches from the new head down to what memory held, across pages, without touching older paging', async () => {
    const { wireRef, requests } = fakeWire();
    const runtime = createChannelFeedRuntime(options(wireRef));
    runtime.mount();
    let snapshot = runtime.getSnapshot();
    await snapshot.setHistoryGrants([{ channel_id: 'c0', head_seq: 10, has_rows: true }],
      { generation: 1, boot: 'refill-boot', focus: 'c0' });
    for (let seq = 1; seq <= 10; seq += 1) {
      snapshot.enqueue({ channel_id: 'c0', seq, source: 'live', generation: 1, envelope: envelope(seq) });
    }
    snapshot.disconnectHistory(1);

    snapshot = runtime.getSnapshot();
    await snapshot.setHistoryGrants([{ channel_id: 'c0', head_seq: 400, has_rows: true }],
      { generation: 2, boot: 'refill-boot', focus: 'c0' });
    // Live after the head may arrive before the refill runs.
    snapshot.enqueue({ channel_id: 'c0', seq: 401, source: 'live', generation: 2, envelope: envelope(401) });

    for (let page = 0; page < 10; page += 1) {
      await tick();
      const request = requests[page];
      if (!request) break;
      answer(runtime.getSnapshot(), request, 2, 11);
    }
    await tick();
    expect(requests[0]).toMatchObject({ beforeSeq: 401, generation: 2 });
    expect(requests.length).toBeGreaterThan(1);
    const state = runtime.getSnapshot().stateFor('c0');
    const seqs = [...state.rows.keys()].sort((a, b) => a - b);
    expect(seqs).toHaveLength(401);
    expect(seqs[0]).toBe(1);
    expect(seqs.at(-1)).toBe(401);
    // Older paging still continues below the oldest row held, not from inside the refilled stretch.
    expect(runtime.getSnapshot().historyFor('c0').beforeSeq).toBe(1);
    runtime.destroy();
  });

  it('asks for nothing when no row was held or nothing landed meanwhile', async () => {
    const { wireRef, requests } = fakeWire();
    const runtime = createChannelFeedRuntime(options(wireRef));
    runtime.mount();
    const snapshot = runtime.getSnapshot();
    await snapshot.setHistoryGrants([{ channel_id: 'c0', head_seq: 5, has_rows: true }],
      { generation: 1, boot: 'refill-boot-2', focus: 'c0' });
    await tick();
    expect(requests).toHaveLength(0);
    for (let seq = 1; seq <= 5; seq += 1) {
      snapshot.enqueue({ channel_id: 'c0', seq, source: 'live', generation: 1, envelope: envelope(seq) });
    }
    snapshot.disconnectHistory(1);
    await runtime.getSnapshot().setHistoryGrants([{ channel_id: 'c0', head_seq: 5, has_rows: true }],
      { generation: 2, boot: 'refill-boot-2', focus: 'c0' });
    await tick();
    expect(requests).toHaveLength(0);
    runtime.destroy();
  });
});
