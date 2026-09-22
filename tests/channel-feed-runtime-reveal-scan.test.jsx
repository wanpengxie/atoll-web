// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime, HISTORY_REVEAL_MAX_PAGES } from '../src/model/channel-feed-runtime.js';

function runtimeOptions(wireRef) {
  return {
    wireRef,
    rosterRef: { current: { self: () => 'human:root:1', handleEnvelope: () => {} } },
    accessRef: { current: { live: () => false } },
    activeChannelRef: { current: 'c0' },
    onError: vi.fn(),
    onChannelsDiscovered: vi.fn(),
    onDirectoryInvalidated: vi.fn(),
    onAccessChanged: vi.fn(),
    onSubmissionFeed: vi.fn(),
  };
}

function row(seq, sender) {
  return {
    channel_id: 'c0', seq,
    envelope: {
      id: `reveal-row-${seq}`, kind: 'event', type: 'human.note',
      sender, payload: { body: { text: `row ${seq}` } },
    },
  };
}
const other = { id: 'agent:other:1', kind: 'agent' };
const me = { id: 'human:root:1', kind: 'human' };

function wireHarness() {
  const requests = [];
  const wireRef = { current: {
    historyBefore: vi.fn((channelId, beforeSeq, limit, detail) => {
      const ref = `reveal-${requests.length + 1}`;
      requests.push({ channelId, beforeSeq, limit, ref, ...detail });
      const receipt = Promise.resolve({ accepted: true, generation: detail.generation, channel_id: channelId });
      receipt.ref = ref;
      return receipt;
    }),
    cancelHistory: vi.fn(async () => undefined),
  } };
  return { requests, wireRef };
}

function reveal(demandUnits = 1) {
  return {
    operationID: 'history:activation-current:1', activationID: 'activation-current',
    viewID: 'c0:mine', epoch: 'c0:1', inputEpoch: 1, intentRevision: 1,
    durableBaselineIDs: [], uiBaselineIDs: [], demandUnits,
  };
}

async function attachedRuntime(headSeq = 10) {
  const harness = wireHarness();
  const runtime = createChannelFeedRuntime(runtimeOptions(harness.wireRef));
  runtime.mount();
  await runtime.getSnapshot().setHistoryGrants([
    { channel_id: 'c0', head_seq: headSeq, has_rows: true },
  ], { generation: 1, boot: 'reveal-scan-boot', focus: 'c0' });
  return { ...harness, runtime, snapshot: runtime.getSnapshot() };
}

function deliver(snapshot, request, rows, { nextBefore, hasOlder }) {
  for (const item of rows) expect(snapshot.enqueue({ ...item, ref: request.ref, generation: 1 })).toBe(true);
  expect(snapshot.pageEnd({
    ref: request.ref, channel_id: 'c0', generation: 1,
    rows: rows.length, scan_low_seq: rows.at(-1)?.seq || nextBefore, scan_high_seq: rows[0]?.seq || request.beforeSeq - 1,
    next_before_seq: nextBefore, has_older: hasOlder,
  })).toBe(true);
}

const mineView = { scope: 'mine', selfId: 'human:root:1' };

describe('Feed reveal scan: one top operation crosses hidden physical pages', () => {
  it('continues the same operation across pages with nothing visible and settles on the first visible row', async () => {
    const { requests, runtime, snapshot } = await attachedRuntime();
    const pending = snapshot.loadHistory('c0', {
      beforeSeq: 11, limit: 2, urgency: 'interactive', untilRevealed: true,
      viewSpec: mineView, historyRevealIntent: reveal(1),
    });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    deliver(snapshot, requests[0], [row(10, other), row(9, other)], { nextBefore: 9, hasOlder: true });
    // Hidden page: no settlement, the same demand issues the next page.
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1].beforeSeq).toBe(9);
    expect(snapshot.historyFor('c0')).toMatchObject({ loading: true });
    expect(snapshot.historyFor('c0').historyDemand.phase).toBe('pending');
    deliver(snapshot, requests[1], [row(8, other), row(7, other)], { nextBefore: 7, hasOlder: true });
    await vi.waitFor(() => expect(requests).toHaveLength(3));
    deliver(snapshot, requests[2], [row(6, me), row(5, other)], { nextBefore: 5, hasOlder: true });
    const result = await pending;
    expect(result).toMatchObject({ kind: 'satisfied', pages: 3 });
    expect(result.revealed).toBeGreaterThan(0);
    expect(requests).toHaveLength(3);
    expect(snapshot.historyFor('c0')).toMatchObject({ loading: false });
    expect(snapshot.historyFor('c0').historyDemand.phase).toBe('idle');
    runtime.destroy();
  });

  it('settles exhausted at authoritative EOF when nothing became visible', async () => {
    const { requests, runtime, snapshot } = await attachedRuntime();
    const pending = snapshot.loadHistory('c0', {
      beforeSeq: 11, limit: 2, urgency: 'interactive', untilRevealed: true,
      viewSpec: mineView, historyRevealIntent: reveal(1),
    });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    deliver(snapshot, requests[0], [row(10, other), row(9, other)], { nextBefore: 9, hasOlder: true });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    deliver(snapshot, requests[1], [row(8, other)], { nextBefore: 8, hasOlder: false });
    await expect(pending).resolves.toMatchObject({ kind: 'exhausted', pages: 2 });
    expect(snapshot.historyFor('c0')).toMatchObject({ loading: false, hasOlder: false });
    runtime.destroy();
  });

  it('stops at the page bound as a segment so the reading level can re-arm', async () => {
    const { requests, runtime, snapshot } = await attachedRuntime(1000);
    const pending = snapshot.loadHistory('c0', {
      beforeSeq: 1001, limit: 1, urgency: 'interactive', untilRevealed: true,
      viewSpec: mineView, historyRevealIntent: reveal(1),
    });
    for (let page = 0; page < HISTORY_REVEAL_MAX_PAGES; page += 1) {
      await vi.waitFor(() => expect(requests).toHaveLength(page + 1));
      const seq = 1000 - page;
      deliver(snapshot, requests[page], [row(seq, other)], { nextBefore: seq, hasOlder: true });
    }
    await expect(pending).resolves.toMatchObject({ kind: 'segment', pages: HISTORY_REVEAL_MAX_PAGES });
    expect(requests).toHaveLength(HISTORY_REVEAL_MAX_PAGES);
    expect(snapshot.historyFor('c0')).toMatchObject({ loading: false, hasOlder: true });
    runtime.destroy();
  });

  it('aborting the request between pages cancels the scan without a further fetch', async () => {
    const { requests, runtime, snapshot } = await attachedRuntime();
    const abort = new AbortController();
    const pending = snapshot.loadHistory('c0', {
      beforeSeq: 11, limit: 2, urgency: 'interactive', untilRevealed: true, signal: abort.signal,
      viewSpec: mineView, historyRevealIntent: reveal(1),
    });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    deliver(snapshot, requests[0], [row(10, other), row(9, other)], { nextBefore: 9, hasOlder: true });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    abort.abort('reader-left');
    await expect(pending).resolves.toMatchObject({ kind: 'cancelled' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requests).toHaveLength(2);
    expect(snapshot.historyFor('c0')).toMatchObject({ loading: false });
    runtime.destroy();
  });

  it('a request without untilRevealed still settles after one physical page', async () => {
    const { requests, runtime, snapshot } = await attachedRuntime();
    const pending = snapshot.loadHistory('c0', {
      beforeSeq: 11, limit: 2, urgency: 'interactive',
      viewSpec: mineView, historyRevealIntent: reveal(1),
    });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    deliver(snapshot, requests[0], [row(10, other), row(9, other)], { nextBefore: 9, hasOlder: true });
    await expect(pending).resolves.toMatchObject({ kind: 'segment', released: 2 });
    expect(requests).toHaveLength(1);
    runtime.destroy();
  });
});
