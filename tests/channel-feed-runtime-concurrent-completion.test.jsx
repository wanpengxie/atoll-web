// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { clearDiagnostics, diagnosticsSnapshot } from '../src/model/diagnostics.js';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';

function runtimeOptions(wireRef) {
  return {
    wireRef,
    rosterRef: { current: { self: () => '', observeFeed: () => '', handleEnvelope: () => {} } },
    accessRef: { current: { live: () => false } },
    activeChannelRef: { current: 'c0' },
    onRoster: vi.fn(),
    onError: vi.fn(),
    onChannelsDiscovered: vi.fn(),
    onDirectoryInvalidated: vi.fn(),
    onTimerFired: vi.fn(),
    onSubmissionFeed: vi.fn(),
    onAccessChanged: vi.fn(),
    onAgentActivity: vi.fn(),
  };
}

describe('ChannelFeedRuntime public completion identity', () => {
  it('publishes one batch_complete for two concurrent default-page demands', async () => {
    const requests = [];
    const wireRef = { current: {
      historyBefore: vi.fn((channelId, beforeSeq, limit, detail) => {
        const ref = `concurrent-completion-${requests.length + 1}`;
        requests.push({ channelId, beforeSeq, limit, ref, ...detail });
        const receipt = Promise.resolve({ accepted: true, generation: detail.generation, channel_id: channelId });
        receipt.ref = ref;
        return receipt;
      }),
      cancelHistory: vi.fn(async () => undefined),
    } };
    const runtime = createChannelFeedRuntime(runtimeOptions(wireRef));
    runtime.mount();
    clearDiagnostics();
    const snapshot = runtime.getSnapshot();
    await snapshot.setHistoryGrants([
      { channel_id: 'c0', head_seq: 20, has_rows: true },
    ], { generation: 1, boot: 'concurrent-completion-boot', focus: 'c0' });

    const first = snapshot.loadHistory('c0', { intent: 'initial-view', urgency: 'blocking' });
    const second = snapshot.loadHistory('c0', { intent: 'initial-view', urgency: 'blocking' });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({
      channelId: 'c0', beforeSeq: 21, limit: 128, generation: 1,
    });
    expect(snapshot.enqueue({
      ref: requests[0].ref,
      channel_id: 'c0',
      seq: 20,
      generation: 1,
      envelope: { id: 'concurrent-completion-row', kind: 'event', type: 'human.note' },
    })).toBe(true);
    expect(snapshot.pageEnd({
      ref: requests[0].ref,
      channel_id: 'c0',
      generation: 1,
      rows: 1,
      scan_low_seq: 20,
      scan_high_seq: 20,
      next_before_seq: 20,
      has_older: true,
    })).toBe(true);
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ kind: 'satisfied', released: 1 }),
      expect.objectContaining({ kind: 'satisfied', released: 1 }),
    ]);

    const completions = diagnosticsSnapshot().filter((entry) => (
      entry.event === 'history.batch_complete' && entry.detail?.channelId === 'c0'
    ));
    expect(completions).toHaveLength(1);
    expect(completions[0].detail).toMatchObject({
      ref: requests[0].ref,
      requestedBeforeSeq: 21,
      scanLowSeq: 20,
      scanHighSeq: 20,
      nextBeforeSeq: 20,
      acceptedRows: 1,
    });
    runtime.destroy();
  });
});
