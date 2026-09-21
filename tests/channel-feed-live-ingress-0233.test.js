import { describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';

function runtimeOptions(overrides = {}) {
  return {
    wireRef: { current: null },
    rosterRef: { current: { self: () => 'human:root:1', handleEnvelope: () => {} } },
    accessRef: { current: { live: () => false } },
    activeChannelRef: { current: 'c0' },
    onError: vi.fn(),
    onChannelsDiscovered: vi.fn(),
    onDirectoryInvalidated: vi.fn(),
    onSubmissionFeed: vi.fn(),
    onAccessChanged: vi.fn(),
    ...overrides,
  };
}

function progressRow(seq, id = `progress-${seq}`) {
  return {
    source: 'live', generation: 1, channel_id: 'c0', seq,
    envelope: {
      id, parent_id: 'dense-request', correlation_id: 'dense-request',
      kind: 'response', type: 'agent.ask',
      sender: { kind: 'agent', id: 'steward' }, audience: ['human:root:1'],
      payload: { body: { status: 'processing', step: seq } },
    },
  };
}

async function attachedRuntime(options) {
  const ownerToken = Object.freeze({ principalId: 'tc0233' });
  const runtime = createChannelFeedRuntime(options);
  runtime.bind({ ...options, ownerToken });
  await runtime.getSnapshot().setHistoryGrants([
    { channel_id: 'c0', head_seq: 0 },
  ], { generation: 1, boot: 'tc0233-boot', focus: 'c0' });
  return { runtime, owner: runtime.getOwnerSnapshot(ownerToken) };
}

describe('TC0233 live progress ingress', () => {
  it('does not fan out passive progress rows as shell discovery or submission changes', async () => {
    const options = runtimeOptions();
    const { runtime, owner } = await attachedRuntime(options);
    try {
      for (let seq = 1; seq <= 640; seq += 1) expect(owner.enqueue(progressRow(seq))).toBe(true);

      expect(options.onChannelsDiscovered).not.toHaveBeenCalled();
      expect(options.onSubmissionFeed).not.toHaveBeenCalled();
      expect(owner.stateFor('c0').rows.get(640)).toEqual(expect.objectContaining({ id: 'progress-640' }));
    } finally {
      runtime.destroy();
    }
  });

  it('still forwards a live row that belongs to the Composer correlation port', async () => {
    const options = runtimeOptions();
    const correlation = {
      owns: vi.fn(({ messageId }) => messageId === 'owned-request'),
      markLanded: vi.fn(() => true),
    };
    options.submissionCorrelationPort = correlation;
    const { runtime, owner } = await attachedRuntime(options);
    try {
      expect(owner.enqueue(progressRow(1))).toBe(true);
      expect(owner.enqueue(progressRow(2, 'owned-request'))).toBe(true);
      expect(options.onSubmissionFeed).toHaveBeenCalledTimes(1);
      expect(correlation.markLanded).toHaveBeenCalledWith({ channelId: 'c0', messageId: 'owned-request' });
    } finally {
      runtime.destroy();
    }
  });
});
