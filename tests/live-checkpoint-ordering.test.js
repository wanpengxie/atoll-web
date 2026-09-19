import { describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';

function runtimeOptions() {
  return {
    wireRef: { current: null },
    rosterRef: { current: { self: () => '', observeFeed: () => '', handleEnvelope: () => {} } },
    accessRef: { current: { live: () => false } },
    activeChannelRef: { current: 'c0' },
    onRoster: vi.fn(), onError: vi.fn(), onChannelsDiscovered: vi.fn(),
    onDirectoryInvalidated: vi.fn(), onTimerFired: vi.fn(),
    onSubmissionFeed: vi.fn(), onAccessChanged: vi.fn(), onAgentActivity: vi.fn(),
  };
}

describe('live checkpoint ordering', () => {
  it('commits live rows to the replica before accepting their coverage checkpoint', async () => {
    const options = runtimeOptions();
    const ownerToken = Object.freeze({ principalId: 'root' });
    const runtime = createChannelFeedRuntime(options);
    runtime.bind({ ...options, ownerToken });
    await runtime.getSnapshot().setHistoryGrants([
      { channel_id: 'c0', head_seq: 2, has_rows: true },
    ], { generation: 7, boot: 'boot-a', focus: 'c0' });

    const owner = runtime.getOwnerSnapshot(ownerToken);
    expect(owner.enqueue({
      source: 'live', generation: 7, channel_id: 'c0', seq: 1,
      envelope: { id: 'm1', kind: 'event', type: 'human.note', payload: { text: 'one' } },
    })).toBe(true);
    expect(owner.enqueue({
      source: 'live', generation: 7, channel_id: 'c0', seq: 2,
      envelope: { id: 'm2', kind: 'event', type: 'human.note', payload: { text: 'two' } },
    })).toBe(true);

    expect(owner.liveCheckpoint({
      generation: 7, channel_id: 'c0', scan_low_seq: 1, scanned_seq: 2,
    })).toBe(true);
    expect(runtime.getSnapshot().stateFor('c0').rows).toEqual(new Map([
      [1, expect.objectContaining({ id: 'm1' })],
      [2, expect.objectContaining({ id: 'm2' })],
    ]));
    runtime.destroy();
  });

  it('rejects stale, ownerless and invalid coverage checkpoints', async () => {
    const options = runtimeOptions();
    const ownerToken = Object.freeze({ principalId: 'root' });
    const runtime = createChannelFeedRuntime(options);
    runtime.bind({ ...options, ownerToken });
    await runtime.getSnapshot().setHistoryGrants([], { generation: 3, boot: 'boot-a' });

    expect(runtime.getOwnerSnapshot(ownerToken).liveCheckpoint({
      generation: 2, channel_id: 'c0', scan_low_seq: 1, scanned_seq: 1,
    })).toBe(false);
    expect(runtime.getOwnerSnapshot(Object.freeze({ principalId: 'other' })).liveCheckpoint({
      generation: 3, channel_id: 'c0', scan_low_seq: 1, scanned_seq: 1,
    })).toBe(false);
    expect(runtime.getOwnerSnapshot(ownerToken).liveCheckpoint({
      generation: 3, channel_id: 'c0', scan_low_seq: 2, scanned_seq: 1,
    })).toBe(false);
    runtime.destroy();
  });
});
