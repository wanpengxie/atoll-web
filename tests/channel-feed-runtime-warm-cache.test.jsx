// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { diagnosticsSnapshot, clearDiagnostics } from '../src/model/diagnostics.js';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';

function row(seq) {
  return {
    channel_id: 'c0',
    seq,
    envelope: {
      id: `warm-row-${seq}`,
      kind: 'event',
      type: 'human.note',
      payload: { body: { text: `warm ${seq}` } },
    },
  };
}

function harness() {
  const requests = [];
  const wireRef = { current: {
    historyBefore: vi.fn((channelId, beforeSeq, limit, detail) => {
      const ref = `warm-page-${requests.length + 1}`;
      requests.push({ channelId, beforeSeq, limit, ref, ...detail });
      const receipt = Promise.resolve({
        accepted: true, generation: detail.generation, channel_id: channelId,
      });
      receipt.ref = ref;
      return receipt;
    }),
    cancelHistory: vi.fn(async () => undefined),
  } };
  return { requests, wireRef };
}

function runtimeOptions(wireRef) {
  return {
    wireRef,
    rosterRef: { current: { self: () => '', handleEnvelope: () => {} } },
    accessRef: { current: { live: () => false } },
    activeChannelRef: { current: 'c0' },
    onError: vi.fn(),
    onChannelsDiscovered: vi.fn(),
    onDirectoryInvalidated: vi.fn(),
    onTimerFired: vi.fn(),
    onSubmissionFeed: vi.fn(),
    onAccessChanged: vi.fn(),
    onAgentActivity: vi.fn(),
  };
}

function finishPage(snapshot, request, rows, nextBefore, hasOlder) {
  for (const item of rows) {
    expect(snapshot.enqueue({
      ...item, ref: request.ref, generation: 1,
    })).toBe(true);
  }
  expect(snapshot.pageEnd({
    ref: request.ref,
    channel_id: 'c0',
    generation: 1,
    rows: rows.length,
    scan_low_seq: nextBefore,
    scan_high_seq: request.beforeSeq - 1,
    next_before_seq: nextBefore,
    has_older: hasOlder,
  })).toBe(true);
}

describe('ChannelFeedRuntime startup warm coverage', () => {
  it('continues a pending channel-entry lease to durable target without Reading demand', async () => {
    clearDiagnostics();
    const { requests, wireRef } = harness();
    const runtime = createChannelFeedRuntime(runtimeOptions(wireRef));
    runtime.mount();
    const snapshot = runtime.getSnapshot();
    const lease = snapshot.requestBackgroundInterest('c0', { intent: 'channel-entry' });

    // The lease is admitted before the wire grant, but no speculative request
    // is sent. Feed starts it from the current attach owner below.
    expect(lease.accepted).toBe(true);
    expect(requests).toHaveLength(0);
    await snapshot.prepareLocalReplica(`warm-principal-${Date.now()}`);
    await snapshot.setHistoryGrants([
      { channel_id: 'c0', head_seq: 1000, has_rows: true },
    ], { generation: 1, boot: 'warm-boot', focus: 'c0' });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(snapshot.historyFor('c0')).toMatchObject({
      backgroundLoading: true,
      foregroundLoading: false,
      historyDemand: { phase: 'idle' },
    });
    expect(requests[0]).toMatchObject({ beforeSeq: 1001, priority: 'background' });

    let nextBefore = 961;
    for (let page = 0; page < 4; page += 1) {
      const request = requests[page];
      const rows = Array.from({ length: 40 }, (_, index) => row(nextBefore + index));
      const hasOlder = page < 3;
      finishPage(snapshot, request, rows, nextBefore, hasOlder);
      if (hasOlder) {
        const expected = 1001 - ((page + 1) * 40);
        await vi.waitFor(() => expect(requests).toHaveLength(page + 2));
        expect(requests[page + 1].beforeSeq).toBe(expected);
        nextBefore = expected - 40;
      }
    }

    await vi.waitFor(() => expect(snapshot.stateFor('c0')?.rows.size).toBe(160));
    expect(snapshot.historyFor('c0')).toMatchObject({
      backgroundLoading: false,
      foregroundLoading: false,
      historyDemand: { phase: 'idle' },
    });
    const completed = diagnosticsSnapshot().filter((entry) => (
      entry.event === 'history.batch_complete' && entry.detail?.channelId === 'c0'
    ));
    expect(completed).toHaveLength(4);
    expect(completed.every((entry) => entry.detail.priority === 'background')).toBe(true);
    expect(diagnosticsSnapshot().find((entry) => entry.event === 'history.background_terminal'))
      .toMatchObject({ detail: { kind: 'warm', durableRows: 128, pages: 4 } });
    lease.release();
    runtime.destroy();
  });

  it('stops a no-progress warm page once without retrying the same cursor', async () => {
    clearDiagnostics();
    const { requests, wireRef } = harness();
    const runtime = createChannelFeedRuntime(runtimeOptions(wireRef));
    runtime.mount();
    const snapshot = runtime.getSnapshot();
    await snapshot.prepareLocalReplica(`warm-no-progress-${Date.now()}`);
    await snapshot.setHistoryGrants([
      { channel_id: 'c0', head_seq: 1000, has_rows: true },
    ], { generation: 1, boot: 'warm-no-progress', focus: 'c0' });
    const lease = snapshot.requestBackgroundInterest('c0', { intent: 'channel-entry' });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    finishPage(snapshot, requests[0], [], 999, true);
    await vi.waitFor(() => expect(
      diagnosticsSnapshot().some((entry) => entry.event === 'history.background_terminal'),
    ).toBe(true));
    expect(requests).toHaveLength(1);
    expect(diagnosticsSnapshot().find((entry) => entry.event === 'history.background_terminal'))
      .toMatchObject({ detail: { kind: 'no-progress', durableRows: 0, pages: 1 } });
    expect(snapshot.historyFor('c0')).toMatchObject({
      backgroundLoading: false,
      historyDemand: { phase: 'idle' },
    });
    lease.release();
    runtime.destroy();
  });
});
