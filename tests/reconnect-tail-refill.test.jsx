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

  // A phone sent back to the background mid-refill: the first refill filled
  // only the top page. The rows it filled sit above the hole, so the next
  // refill still has to reach down to what memory held before.
  it('a refill cut short is finished by the next attach, hole included', async () => {
    const { wireRef, requests } = fakeWire();
    const runtime = createChannelFeedRuntime(options(wireRef));
    runtime.mount();
    let snapshot = runtime.getSnapshot();
    await snapshot.setHistoryGrants([{ channel_id: 'c0', head_seq: 10, has_rows: true }],
      { generation: 1, boot: 'refill-boot-3', focus: 'c0' });
    for (let seq = 1; seq <= 10; seq += 1) {
      snapshot.enqueue({ channel_id: 'c0', seq, source: 'live', generation: 1, envelope: envelope(seq) });
    }
    snapshot.disconnectHistory(1);

    snapshot = runtime.getSnapshot();
    await snapshot.setHistoryGrants([{ channel_id: 'c0', head_seq: 400, has_rows: true }],
      { generation: 2, boot: 'refill-boot-3', focus: 'c0' });
    await tick();
    answer(runtime.getSnapshot(), requests[0], 2, 11);
    await tick();
    runtime.getSnapshot().disconnectHistory(2);

    const before = requests.length;
    await runtime.getSnapshot().setHistoryGrants([{ channel_id: 'c0', head_seq: 410, has_rows: true }],
      { generation: 3, boot: 'refill-boot-3', focus: 'c0' });
    for (let page = 0; page < 10; page += 1) {
      await tick();
      const request = requests[before + page];
      if (!request) break;
      answer(runtime.getSnapshot(), request, 3, 11);
    }
    await tick();
    const seqs = [...runtime.getSnapshot().stateFor('c0').rows.keys()].sort((a, b) => a - b);
    expect(seqs).toHaveLength(410);
    expect(seqs[0]).toBe(1);
    expect(seqs.at(-1)).toBe(410);
    runtime.destroy();
  });

  // Too far behind: the fresh window is kept and paging goes on below it. A
  // request held from before the hole must go too — its end lies in the
  // hole, and kept, it would sit in Waiting forever.
  it('too far behind drops what lies below the hole, open turns included', async () => {
    const { wireRef, requests } = fakeWire();
    const runtime = createChannelFeedRuntime(options(wireRef));
    runtime.mount();
    let snapshot = runtime.getSnapshot();
    await snapshot.setHistoryGrants([{ channel_id: 'c0', head_seq: 10, has_rows: true }],
      { generation: 1, boot: 'refill-boot-4', focus: 'c0' });
    for (let seq = 1; seq <= 10; seq += 1) {
      const row = seq === 5
        ? { id: 'ask', kind: 'request', type: 'agent.ask', audience: ['agent:x'], payload: { body: { text: 'hi' } } }
        : seq === 6
          ? { id: 'ask-queued', kind: 'response', type: 'agent.ask', parent_id: 'ask', payload: { body: { status: 'queued' } } }
          : envelope(seq);
      snapshot.enqueue({ channel_id: 'c0', seq, source: 'live', generation: 1, envelope: row });
    }
    snapshot.disconnectHistory(1);

    await runtime.getSnapshot().setHistoryGrants([{ channel_id: 'c0', head_seq: 5000, has_rows: true }],
      { generation: 2, boot: 'refill-boot-4', focus: 'c0' });
    for (let page = 0; page < 20; page += 1) {
      await tick();
      const request = requests[page];
      if (!request) break;
      answer(runtime.getSnapshot(), request, 2, 11);
    }
    await tick();
    const seqs = [...runtime.getSnapshot().stateFor('c0').rows.keys()].sort((a, b) => a - b);
    expect(seqs.includes(5)).toBe(false);
    expect(seqs.at(-1)).toBe(5000);
    expect(runtime.getSnapshot().historyFor('c0').beforeSeq).toBe(seqs[0]);
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
