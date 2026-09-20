// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';
import { createChannelReplicaCache } from '../src/model/channel-replica.js';
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

function historyRow(seq) {
  return {
    channel_id: 'c0', seq,
    envelope: {
      id: `history-row-${seq}`, kind: 'event', type: 'human.note',
      payload: { body: { text: `history ${seq}` } },
    },
  };
}

async function seedPartialReplicaCache(principal, boot) {
  const cache = createChannelReplicaCache({ indexedDB: null });
  await cache.ensureOwner(principal, { world: boot });
  await cache.clear();
  await cache.saveRows(Array.from({ length: 7 }, (_, index) => historyRow(index + 8)));
  await cache.destroy();
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

  it('exposes controlCurrent only after current tail coverage and exact parent closure', async () => {
    const options = runtimeOptions();
    const ownerToken = Object.freeze({ principalId: 'root' });
    const runtime = createChannelFeedRuntime(options);
    runtime.bind({ ...options, ownerToken });

    await runtime.getSnapshot().setHistoryGrants([
      { channel_id: 'c0', head_seq: 2, has_rows: true },
    ], { generation: 1, boot: 'boot-a' });
    expect(runtime.getSnapshot().historyFor('c0')).toMatchObject({
      attached: true, generation: 1, controlCurrent: false,
      controlTailCoverage: false,
    });

    const request = {
      id: 'queued-request', kind: 'request', type: TYPES.agentAsk,
      sender: { id: 'human:root:1', kind: 'human' }, audience: ['agent:worker:1'],
      payload: { body: { text: 'queued work' } },
    };
    const queued = {
      id: 'queued-status', parent_id: request.id, kind: 'response', type: TYPES.agentAsk,
      sender: { id: 'agent:worker:1', kind: 'agent' }, audience: ['human:root:1'],
      payload: { body: { status: 'queued', controls: [] } },
    };
    expect(runtime.getSnapshot().enqueue({ channel_id: 'c0', seq: 1, generation: 1, envelope: request })).toBe(true);
    expect(runtime.getSnapshot().historyFor('c0').controlCurrent).toBe(false);
    expect(runtime.getSnapshot().enqueue({ channel_id: 'c0', seq: 2, generation: 1, envelope: queued })).toBe(true);
    expect(runtime.getSnapshot().historyFor('c0')).toMatchObject({
      controlCurrent: true, controlTailCoverage: true, controlParentClosure: true,
      controlCoverage: [{ lowSeq: 1, highSeq: 2 }],
    });

    // A reused generation is still a new attach/control admission. The old
    // tail proof cannot silently re-authorize cached queued controls.
    await runtime.getSnapshot().setHistoryGrants([
      { channel_id: 'c0', head_seq: 2, has_rows: true },
      { channel_id: 'c1', head_seq: 2, has_rows: true },
    ], { generation: 1, boot: 'boot-a' });
    expect(runtime.getSnapshot().historyFor('c0').controlCurrent).toBe(false);

    // A current-generation checkpoint proves the tail without requiring a
    // row-by-row read; a terminal/progress frame whose parent is not present
    // remains unknown until the exact parent arrives.
    const orphanTerminal = {
      id: 'orphan-terminal', parent_id: 'missing-parent', kind: 'response', type: TYPES.agentAsk,
      sender: { id: 'agent:worker:1', kind: 'agent' }, audience: ['human:root:1'],
      payload: { body: { status: 'completed', text: 'done' } },
    };
    expect(runtime.getSnapshot().enqueue({ channel_id: 'c1', seq: 2, generation: 1, envelope: orphanTerminal })).toBe(true);
    expect(runtime.getSnapshot().historyFor('c1').controlCurrent).toBe(false);
    expect(runtime.getSnapshot().liveCheckpoint({
      generation: 1, channel_id: 'c1', scan_low_seq: 1, scanned_seq: 2,
    })).toBe(true);
    expect(runtime.getSnapshot().historyFor('c1')).toMatchObject({
      controlTailCoverage: true, controlParentClosure: false, controlCurrent: false,
    });
    expect(runtime.getSnapshot().enqueue({
      channel_id: 'c1', seq: 1, generation: 1,
      envelope: { ...request, id: 'missing-parent' },
    })).toBe(true);
    expect(runtime.getSnapshot().historyFor('c1')).toMatchObject({
      controlCurrent: true, controlParentClosure: true,
    });
    runtime.destroy();
  });

  it('clears controlCurrent on disconnect, regrant and forbidden history failure', async () => {
    const wireRef = { current: {
      historyBefore: vi.fn(() => {
        const accepted = Promise.resolve({ accepted: true, generation: 2, channel_id: 'c0' });
        accepted.ref = 'history-forbidden';
        return accepted;
      }),
      cancelHistory: vi.fn(async () => undefined),
    } };
    const options = { ...runtimeOptions(), wireRef };
    const runtime = createChannelFeedRuntime(options);
    runtime.mount();
    await runtime.getSnapshot().setHistoryGrants([{ channel_id: 'c0', head_seq: 0 }], {
      generation: 1, boot: 'boot-a', focus: 'c0',
    });
    expect(runtime.getSnapshot().historyFor('c0').controlCurrent).toBe(true);

    expect(runtime.getSnapshot().disconnectHistory(1)).toBe(true);
    expect(runtime.getSnapshot().historyFor('c0')).toMatchObject({
      attached: false, controlCurrent: false, controlCoverage: [],
    });

    await runtime.getSnapshot().setHistoryGrants([{ channel_id: 'c0', head_seq: 1 }], {
      generation: 2, boot: 'boot-b', focus: 'c0',
    });
    expect(runtime.getSnapshot().historyFor('c0').controlCurrent).toBe(false);
    const pending = runtime.getSnapshot().loadHistory('c0');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.getSnapshot().pageEnd({
      ref: 'history-forbidden', channel_id: 'c0', generation: 2,
      error_code: 'forbidden', error_detail: 'forbidden',
    })).toBe(true);
    await pending;
    expect(runtime.getSnapshot().historyFor('c0')).toMatchObject({
      attached: false, controlCurrent: false, controlCoverage: [],
    });
    runtime.destroy();
  });

  it('keeps cache-only queued controls readable but not current', async () => {
    const principal = `feed-cache-${Date.now()}-${Math.random()}`;
    const boot = `feed-cache-boot-${Date.now()}-${Math.random()}`;
    const grant = [{ channel_id: 'c0', head_seq: 2, has_rows: true }];
    const request = {
      id: `cache-request-${principal}`, kind: 'request', type: TYPES.agentAsk,
      sender: { id: 'human:root:1', kind: 'human' }, audience: ['agent:worker:1'],
      payload: { body: { text: 'cached queued work' } },
    };
    const queued = {
      id: `cache-queued-${principal}`, parent_id: request.id, kind: 'response', type: TYPES.agentAsk,
      sender: { id: 'agent:worker:1', kind: 'agent' }, audience: ['human:root:1'],
      payload: { body: { status: 'queued', controls: [] } },
    };

    const seed = createChannelFeedRuntime(runtimeOptions());
    seed.mount();
    await seed.getSnapshot().setHistoryGrants(grant, { generation: 1, boot, focus: 'c0' });
    await seed.getSnapshot().prepareLocalReplica(principal, { focus: 'c0' });
    expect(seed.getSnapshot().enqueue({ channel_id: 'c0', seq: 1, generation: 1, envelope: request })).toBe(true);
    expect(seed.getSnapshot().enqueue({ channel_id: 'c0', seq: 2, generation: 1, envelope: queued })).toBe(true);
    expect(seed.getSnapshot().historyFor('c0').controlCurrent).toBe(true);
    // applyRows persists through the same Replica cache owner used by attach;
    // allow that asynchronous cache write to settle before replacing runtime.
    await new Promise((resolve) => setTimeout(resolve, 0));
    seed.destroy();

    const restored = createChannelFeedRuntime(runtimeOptions());
    restored.mount();
    await restored.getSnapshot().setHistoryGrants(grant, { generation: 1, boot, focus: 'c0' });
    await restored.getSnapshot().prepareLocalReplica(principal, { focus: 'c0' });
    expect(restored.getSnapshot().stateFor('c0').rows).toEqual(new Map([
      [1, expect.objectContaining({ id: request.id })],
      [2, expect.objectContaining({ id: queued.id })],
    ]));
    expect(restored.getSnapshot().historyFor('c0')).toMatchObject({
      loaded: true,
      controlCurrent: false,
      controlTailCoverage: false,
      controlParentClosure: false,
      controlCoverage: [],
    });
    restored.destroy();
  });

  it('proves a network tail and revokes it for higher heads, lifecycle fences and old generations', async () => {
    let requestNumber = 0;
    const wireRef = { current: {
      historyBefore: vi.fn(() => {
        requestNumber += 1;
        const accepted = Promise.resolve({ accepted: true, generation: requestNumber === 1 ? 1 : 2, channel_id: 'c0' });
        accepted.ref = `history-matrix-${requestNumber}`;
        return accepted;
      }),
      cancelHistory: vi.fn(async () => undefined),
    } };
    const runtime = createChannelFeedRuntime({ ...runtimeOptions(), wireRef });
    runtime.mount();
    await runtime.getSnapshot().setHistoryGrants([
      { channel_id: 'c0', head_seq: 2, has_rows: true },
    ], { generation: 1, boot: 'matrix-boot-a', focus: 'c0' });

    const request = {
      id: 'network-request', kind: 'request', type: TYPES.agentAsk,
      sender: { id: 'human:root:1', kind: 'human' }, audience: ['agent:worker:1'],
      payload: { body: { text: 'network queued work' } },
    };
    const queued = {
      id: 'network-queued', parent_id: request.id, kind: 'response', type: TYPES.agentAsk,
      sender: { id: 'agent:worker:1', kind: 'agent' }, audience: ['human:root:1'],
      payload: { body: { status: 'queued', controls: [] } },
    };
    const pending = runtime.getSnapshot().loadHistory('c0');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.getSnapshot().enqueue({
      ref: 'history-matrix-1', channel_id: 'c0', seq: 1, envelope: request,
    })).toBe(true);
    expect(runtime.getSnapshot().enqueue({
      ref: 'history-matrix-1', channel_id: 'c0', seq: 2, envelope: queued,
    })).toBe(true);
    expect(runtime.getSnapshot().pageEnd({
      ref: 'history-matrix-1', channel_id: 'c0', generation: 1,
      rows: 2, scan_low_seq: 1, scan_high_seq: 2, next_before_seq: 1, has_older: false,
    })).toBe(true);
    await expect(pending).resolves.toMatchObject({ kind: 'satisfied', released: 2 });
    expect(runtime.getSnapshot().historyFor('c0')).toMatchObject({
      controlCurrent: true, controlTailCoverage: true, controlParentClosure: true,
      controlCoverage: [{ lowSeq: 1, highSeq: 2 }],
    });

    // A newer grant head is an authority replacement even when the wire
    // generation is reused; the old proof cannot float with the head.
    await runtime.getSnapshot().setHistoryGrants([
      { channel_id: 'c0', head_seq: 3, has_rows: true },
    ], { generation: 1, boot: 'matrix-boot-a', focus: 'c0' });
    expect(runtime.getSnapshot().historyFor('c0')).toMatchObject({
      headSeq: 3, controlCurrent: false, controlCoverage: [],
    });

    expect(runtime.getSnapshot().disconnectHistory(1)).toBe(true);
    expect(runtime.getSnapshot().historyFor('c0')).toMatchObject({
      attached: false, controlCurrent: false, controlCoverage: [],
    });

    await runtime.getSnapshot().setHistoryGrants([
      { channel_id: 'c0', head_seq: 3, has_rows: true },
    ], { generation: 2, boot: 'matrix-boot-b', focus: 'c0' });
    expect(runtime.getSnapshot().historyFor('c0')).toMatchObject({
      attached: true, generation: 2, controlCurrent: false, controlCoverage: [],
    });

    const forbidden = runtime.getSnapshot().loadHistory('c0');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.getSnapshot().pageEnd({
      ref: 'history-matrix-2', channel_id: 'c0', generation: 2,
      error_code: 'forbidden', error_detail: 'forbidden',
    })).toBe(true);
    await forbidden;
    expect(runtime.getSnapshot().historyFor('c0')).toMatchObject({
      attached: false, controlCurrent: false, controlCoverage: [],
    });

    // Late rows/checkpoints from the retired generation cannot re-open the
    // waiting surface after the forbidden projection.
    expect(runtime.getSnapshot().enqueue({
      generation: 1, source: 'live', channel_id: 'c0', seq: 3,
      envelope: { id: 'old-generation-row', kind: 'event', type: 'human.note' },
    })).toBe(false);
    expect(runtime.getSnapshot().liveCheckpoint({
      generation: 1, channel_id: 'c0', scan_low_seq: 1, scanned_seq: 3,
    })).toBe(false);
    expect(runtime.getSnapshot().historyFor('c0').controlCurrent).toBe(false);
    runtime.destroy();
  });

  it('merges a partial cache page, then continues one network page without duplicate rows', async () => {
    const principal = `partial-source-${Date.now()}-${Math.random()}`;
    const boot = `partial-source-boot-${Date.now()}-${Math.random()}`;
    await seedPartialReplicaCache(principal, boot);
    const requests = [];
    const wireRef = { current: {
      historyBefore: vi.fn((channelId, beforeSeq, limit) => {
        const ref = `partial-source-${requests.length + 1}`;
        requests.push({ channelId, beforeSeq, limit, ref });
        const accepted = Promise.resolve({ accepted: true, generation: 1, channel_id: channelId });
        accepted.ref = ref;
        return accepted;
      }),
      cancelHistory: vi.fn(async () => undefined),
    } };
    const options = { ...runtimeOptions(), activeChannelRef: { current: '' }, wireRef };
    const runtime = createChannelFeedRuntime(options);
    runtime.mount();
    await runtime.getSnapshot().setHistoryGrants([
      { channel_id: 'c0', head_seq: 14, has_rows: true },
    ], { generation: 1, boot, focus: '' });
    await runtime.getSnapshot().prepareLocalReplica(principal, { focus: '' });

    const pending = runtime.getSnapshot().loadHistory('c0', { beforeSeq: 9, limit: 20 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ channelId: 'c0', beforeSeq: 8, limit: 20 });
    for (let seq = 1; seq <= 7; seq += 1) {
      expect(runtime.getSnapshot().enqueue({
        ref: requests[0].ref, channel_id: 'c0', seq, envelope: historyRow(seq).envelope,
      })).toBe(true);
    }
    expect(runtime.getSnapshot().pageEnd({
      ref: requests[0].ref, channel_id: 'c0', generation: 1,
      rows: 7, scan_low_seq: 1, scan_high_seq: 7, next_before_seq: 1, has_older: false,
    })).toBe(true);
    await expect(pending).resolves.toMatchObject({ kind: 'satisfied', released: 8 });
    expect(requests).toHaveLength(1);
    expect([...runtime.getSnapshot().stateFor('c0').rows.keys()].sort((left, right) => left - right))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(runtime.getSnapshot().historyFor('c0')).toMatchObject({
      lastSource: 'network', beforeSeq: 1, hasOlder: false,
    });
    await runtime.getSnapshot().resetPersistent();
    runtime.destroy();
  });

  it('keeps the partial cache visible but reports network failure instead of local exhaustion', async () => {
    const principal = `partial-offline-${Date.now()}-${Math.random()}`;
    const boot = `partial-offline-boot-${Date.now()}-${Math.random()}`;
    await seedPartialReplicaCache(principal, boot);
    const onError = vi.fn();
    const options = {
      ...runtimeOptions(),
      activeChannelRef: { current: '' },
      wireRef: { current: { cancelHistory: vi.fn(async () => undefined) } },
      onError,
    };
    const runtime = createChannelFeedRuntime(options);
    runtime.mount();
    await runtime.getSnapshot().setHistoryGrants([
      { channel_id: 'c0', head_seq: 14, has_rows: true },
    ], { generation: 1, boot, focus: '' });
    await runtime.getSnapshot().prepareLocalReplica(principal, { focus: '' });

    await expect(runtime.getSnapshot().loadHistory('c0', { beforeSeq: 9, limit: 20 }))
      .resolves.toMatchObject({ kind: 'failed' });
    expect([...runtime.getSnapshot().stateFor('c0').rows.keys()].sort((left, right) => left - right)).toEqual([8]);
    expect(runtime.getSnapshot().historyFor('c0')).toMatchObject({
      hasOlder: true,
      historyDemand: { phase: 'error' },
    });
    expect(onError).toHaveBeenCalledOnce();
    await runtime.getSnapshot().resetPersistent();
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
