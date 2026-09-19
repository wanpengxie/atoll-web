// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';
import { TYPES } from '../src/protocol/vocab.js';

function runtimeOptions() {
  return {
    wireRef: { current: null },
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

describe('ChannelFeedRuntime ownership', () => {
  it('uses the Composer correlation port for owned landed identities and no retired roster callback', () => {
    const options = runtimeOptions();
    const ownerToken = Object.freeze({ principalId: 'root' });
    const observeFeed = vi.fn();
    const handleEnvelope = vi.fn();
    const onRoster = vi.fn();
    const submissionCorrelationPort = {
      owns: vi.fn(({ channelId, messageId }) => channelId === 'c0' && messageId === 'local-request'),
      markLanded: vi.fn(() => true),
    };
    options.rosterRef.current = { self: () => '', observeFeed, handleEnvelope };
    options.onRoster = onRoster;
    options.submissionCorrelationPort = submissionCorrelationPort;
    const runtime = createChannelFeedRuntime({ ...options, ownerToken });
    runtime.bind({ ...options, ownerToken, submissionCorrelationPort });
    runtime.mount();

    const envelope = {
      id: 'local-request',
      kind: 'request',
      type: TYPES.agentAsk,
      sender: { id: 'human:root:1', kind: 'human' },
      audience: ['agent:worker:1'],
      payload: { body: { text: 'work' } },
    };
    expect(runtime.getOwnerSnapshot(ownerToken).enqueue({
      channel_id: 'c0', seq: 1, source: 'live', envelope,
    })).toBe(true);

    expect(observeFeed).not.toHaveBeenCalled();
    expect(onRoster).not.toHaveBeenCalled();
    expect(handleEnvelope).toHaveBeenCalledWith('c0', envelope);
    expect(submissionCorrelationPort.owns).toHaveBeenCalledWith({
      channelId: 'c0', messageId: 'local-request',
    });
    expect(submissionCorrelationPort.markLanded).toHaveBeenCalledWith({
      channelId: 'c0', messageId: 'local-request',
    });
    runtime.destroy();
  });

  it('keeps owner-scoped command identities stable across store publications', () => {
    const options = runtimeOptions();
    const ownerToken = Object.freeze({ principalId: 'root' });
    const runtime = createChannelFeedRuntime(options);
    runtime.bind({ ...options, ownerToken });

    const first = runtime.getOwnerSnapshot(ownerToken);
    first.bump();
    const second = runtime.getOwnerSnapshot(ownerToken);

    expect(second).not.toBe(first);
    expect(second.version).toBeGreaterThan(first.version);
    expect(second.enqueue).toBe(first.enqueue);
    expect(second.liveCheckpoint).toBe(first.liveCheckpoint);
  });

  it('survives a StrictMode effect probe and terminally releases its owned data plane', async () => {
    const runtime = createChannelFeedRuntime(runtimeOptions());

    const releaseProbe = runtime.mount();
    releaseProbe();
    const releaseCommitted = runtime.mount();
    await Promise.resolve();
    expect(runtime.getSnapshot().enqueue({
      channel_id: 'c0', seq: 1, source: 'live',
      envelope: {
        id: 'm-1', kind: 'event', type: 'message', ts: '2026-09-19T00:00:00Z',
        sender: { id: 'agent:codex:1', kind: 'agent' }, audience: [],
        payload: { text: 'owned row' },
      },
    })).toBe(true);
    expect(runtime.getSnapshot().stateEntries()).toHaveLength(1);

    releaseCommitted();
    await Promise.resolve();
    expect(runtime.getSnapshot().stateEntries()).toHaveLength(0);
    expect(() => runtime.mount()).toThrow('ChannelFeedRuntime has been destroyed');
  });

  it('uses the existing generation fence to drop late rows after an incompatible version', async () => {
    const options = runtimeOptions();
    const ownerToken = Object.freeze({ principalId: 'root' });
    const runtime = createChannelFeedRuntime(options);
    runtime.bind({ ...options, ownerToken });
    await runtime.getSnapshot().setHistoryGrants([], { generation: 1, boot: 'boot-a' });
    const owner = runtime.getOwnerSnapshot(ownerToken);
    const row = (seq) => ({
      channel_id: 'c0', seq, source: 'live', generation: 1,
      envelope: {
        id: `frame-fence-${seq}`, kind: 'event', type: 'message', ts: `2026-09-19T00:00:0${seq}Z`,
        sender: { id: 'agent:codex:1', kind: 'agent' }, audience: [], payload: { text: String(seq) },
      },
    });

    expect(owner.enqueue(row(1))).toBe(true);
    expect(runtime.getSnapshot().stateFor('c0').rows.size).toBe(1);
    expect(runtime.getSnapshot().stopIncompatible(1)).toBe(true);
    expect(owner.enqueue(row(2))).toBe(false);
    expect(runtime.getSnapshot().stateFor('c0').rows.size).toBe(1);
    runtime.destroy();
  });
});

// 旧 useChannelFeed.js（master 分支）在每个 live 行上判定
// invalidatesChannelDirectory(row.envelope) 并回调 onDirectoryInvalidated；
// 这条判定与回调在 applyRows() 里已经不存在了（见 src/model/channel-feed-runtime.js
// 的 applyRows）。对应旧用例：tests/directory-invalidation.test.js。
describe('ChannelFeedRuntime directory invalidation', () => {
  it('频道、成员和放置关系变化会使目录投影失效', () => {
    const options = runtimeOptions();
    const runtime = createChannelFeedRuntime(options);
    runtime.mount();

    const invalidatingEnvelopes = [
      { id: 'e-member-created', kind: 'event', type: TYPES.narration.memberCreated, visibility: 'system' },
      { id: 'e-member-deleted', kind: 'event', type: TYPES.narration.memberDeleted, visibility: 'system' },
      { id: 'e-channel-inbound', kind: 'event', type: TYPES.narration.channelInbound, visibility: 'system' },
      { id: 'e-member-create-resp', kind: 'response', type: TYPES.member.create },
      { id: 'e-member-admit-resp', kind: 'response', type: TYPES.member.admit },
      { id: 'e-member-remove-resp', kind: 'response', type: TYPES.member.remove },
      { id: 'e-channel-create-resp', kind: 'response', type: TYPES.channel.create },
      { id: 'e-channel-set-resp', kind: 'response', type: TYPES.channel.set },
      { id: 'e-channel-remove-resp', kind: 'response', type: TYPES.channel.remove },
      { id: 'e-device-attach-resp', kind: 'response', type: TYPES.device.attach },
      { id: 'e-device-detach-resp', kind: 'response', type: TYPES.device.detach },
      { id: 'e-device-remove-resp', kind: 'response', type: TYPES.device.remove },
    ];
    invalidatingEnvelopes.forEach((envelope, index) => {
      runtime.getSnapshot().enqueue({
        channel_id: 'c0', seq: index + 1, source: 'live',
        envelope: { ts: '2026-09-19T00:00:00Z', sender: { id: 'system', kind: 'system' }, audience: [], payload: {}, ...envelope },
      });
    });

    expect(options.onDirectoryInvalidated).toHaveBeenCalled();
  });

  it('普通消息、过程和只读治理词不会刷新目录', () => {
    const options = runtimeOptions();
    const runtime = createChannelFeedRuntime(options);
    runtime.mount();

    const nonInvalidatingEnvelopes = [
      { id: 'e-message', kind: 'event', type: 'message' },
      { id: 'e-agent-ask', kind: 'request', type: TYPES.agentAsk },
      { id: 'e-channel-get', kind: 'response', type: TYPES.channel.get },
      { id: 'e-channel-list', kind: 'response', type: TYPES.channel.list },
      { id: 'e-member-list', kind: 'response', type: TYPES.member.list },
      { id: 'e-member-get', kind: 'response', type: TYPES.member.get },
    ];
    nonInvalidatingEnvelopes.forEach((envelope, index) => {
      runtime.getSnapshot().enqueue({
        channel_id: 'c0', seq: index + 1, source: 'live',
        envelope: { ts: '2026-09-19T00:00:00Z', sender: { id: 'agent:codex:1', kind: 'agent' }, audience: [], payload: {}, ...envelope },
      });
    });

    expect(options.onDirectoryInvalidated).not.toHaveBeenCalled();
  });
});
