// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

const ad178CacheControl = vi.hoisted(() => ({
  holdRead: false,
  pending: [],
}));

vi.mock('../src/model/channel-replica.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createChannelReplicaCache: (...args) => {
      const cache = actual.createChannelReplicaCache(...args);
      const readBefore = cache.readBefore.bind(cache);
      return Object.freeze({
        ...cache,
        readBefore: (...readArgs) => {
          if (!ad178CacheControl.holdRead) return readBefore(...readArgs);
          return new Promise((resolve, reject) => {
            ad178CacheControl.pending.push({ resolve, reject, readBefore, readArgs });
          });
        },
      });
    },
  };
});

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

function nextTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ChannelFeedRuntime ownership', () => {
  it('publishes attach Meta before hydrating the selected cache body', async () => {
    const principal = `ad178-body-principal-${Date.now()}-${Math.random()}`;
    const boot = `ad178-body-boot-${Date.now()}-${Math.random()}`;
    const grant = [{ channel_id: 'c0', head_seq: 100, has_rows: true }];
    const seed = createChannelFeedRuntime(runtimeOptions());
    seed.mount();
    await seed.getSnapshot().setHistoryGrants(grant, { generation: 1, boot, focus: '' });
    await seed.getSnapshot().prepareLocalReplica(principal, { focus: '' });
    expect(seed.getSnapshot().enqueue({
      channel_id: 'c0', seq: 100, generation: 1, source: 'live',
      envelope: historyRow(100).envelope,
    })).toBe(true);
    await nextTick();
    seed.destroy();

    const restored = createChannelFeedRuntime(runtimeOptions());
    restored.mount();
    try {
      await restored.getSnapshot().prepareLocalReplica(principal, { focus: '' });
      ad178CacheControl.pending.length = 0;
      ad178CacheControl.holdRead = true;
      const attached = restored.getSnapshot().setHistoryGrants(grant, {
        generation: 1, boot, focus: 'c0',
      });
      await expect(attached).resolves.toMatchObject({ changed: true });
      expect(ad178CacheControl.pending).toHaveLength(1);
      expect(restored.getSnapshot().historyFor('c0')).toMatchObject({
        attached: true, messageCurrent: true, headSeq: 100,
      });
      expect(restored.getSnapshot().resumeLocalReplica()).toMatchObject({ c0: 100 });
      expect(restored.getSnapshot().stateFor('c0')?.rows.has(100)).toBe(false);

      ad178CacheControl.holdRead = false;
      ad178CacheControl.pending.shift().resolve({
        rows: [historyRow(100)], nextBeforeSeq: 1, exhausted: true, bytes: 0,
      });
      await nextTick();
      expect(restored.getSnapshot().stateFor('c0')?.rows.has(100)).toBe(true);
    } finally {
      ad178CacheControl.holdRead = false;
      for (const pending of ad178CacheControl.pending.splice(0)) pending.reject(new Error('test cleanup'));
      restored.destroy();
    }
  });

  it('waits for the current history grant before cold loading and replays at the granted head', async () => {
    const requests = [];
    const wireRef = { current: {
      historyBefore: vi.fn((channelId, beforeSeq, limit, detail) => {
        const ref = `cold-history-${requests.length + 1}`;
        requests.push({ channelId, beforeSeq, limit, ref, ...detail });
        const receipt = Promise.resolve({ accepted: true, generation: detail.generation, channel_id: channelId });
        receipt.ref = ref;
        return receipt;
      }),
      cancelHistory: vi.fn(async () => undefined),
    } };
    const runtime = createChannelFeedRuntime({ ...runtimeOptions(), wireRef });
    runtime.mount();

    await expect(runtime.getSnapshot().loadHistory('c0', {
      intent: 'initial-view', urgency: 'blocking',
    })).resolves.toMatchObject({ kind: 'waiting', reason: 'history-grant-pending' });
    expect(wireRef.current.historyBefore).not.toHaveBeenCalled();
    expect(runtime.getSnapshot().historyFor('c0')).toMatchObject({
      attached: false, headSeq: 0, historyDemand: { phase: 'pending' },
    });

    await runtime.getSnapshot().setHistoryGrants([
      { channel_id: 'c0', head_seq: 844, has_rows: true },
    ], { generation: 1, boot: 'cold-history-boot', focus: 'c0' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      channelId: 'c0', beforeSeq: 845, generation: 1,
    });

    // Replacing the attach generation retires the first physical request.
    // Its late rows/page cannot repopulate the current Replica.
    await runtime.getSnapshot().setHistoryGrants([
      { channel_id: 'c0', head_seq: 844, has_rows: true },
    ], { generation: 2, boot: 'cold-history-boot-next', focus: 'c0' });
    expect(runtime.getSnapshot().enqueue({
      ref: requests[0].ref, channel_id: 'c0', seq: 844, generation: 1,
      envelope: { id: 'stale-844', kind: 'event', type: 'human.note' },
    })).toBe(false);
    expect(runtime.getSnapshot().pageEnd({
      ref: requests[0].ref, channel_id: 'c0', generation: 1,
      rows: 1, scan_low_seq: 1, scan_high_seq: 844,
      next_before_seq: 1, has_older: true,
    })).toBe(false);

    const current = runtime.getSnapshot().loadHistory('c0', {
      intent: 'initial-view', urgency: 'blocking',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      channelId: 'c0', beforeSeq: 845, generation: 2,
    });
    expect(runtime.getSnapshot().enqueue({
      ref: requests[1].ref, channel_id: 'c0', seq: 844, generation: 2,
      envelope: {
        id: 'active-844', kind: 'event', type: 'human.note', visibility: 'public',
        sender: { id: 'agent:cold:worker', kind: 'agent' }, audience: [],
        payload: { body: { text: 'active' } },
      },
    })).toBe(true);
    expect(runtime.getSnapshot().pageEnd({
      ref: requests[1].ref, channel_id: 'c0', generation: 2,
      rows: 1, scan_low_seq: 1, scan_high_seq: 844,
      next_before_seq: 1, has_older: true,
    })).toBe(true);
    await current;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.getSnapshot().stateFor('c0')?.rows.has(844)).toBe(true);
    expect(runtime.getSnapshot().historyFor('c0')).toMatchObject({
      attached: true, generation: 2, headSeq: 844,
    });
    runtime.destroy();
  });

  it('shares one in-flight physical page for concurrent identical ranges', async () => {
    const requests = [];
    const wireRef = { current: {
      historyBefore: vi.fn((channelId, beforeSeq, limit, detail) => {
        const ref = `concurrent-history-${requests.length + 1}`;
        requests.push({ channelId, beforeSeq, limit, ref, ...detail });
        const accepted = Promise.resolve({ accepted: true, generation: detail.generation, channel_id: channelId });
        accepted.ref = ref;
        return accepted;
      }),
      cancelHistory: vi.fn(async () => undefined),
    } };
    const runtime = createChannelFeedRuntime({ ...runtimeOptions(), wireRef });
    runtime.mount();
    const snapshot = runtime.getSnapshot();
    await snapshot.setHistoryGrants([
      { channel_id: 'c0', head_seq: 4, has_rows: true },
    ], { generation: 1, boot: 'concurrent-history-boot', focus: 'c0' });

    const first = snapshot.loadHistory('c0', { beforeSeq: 5, limit: 4 });
    const second = snapshot.loadHistory('c0', { beforeSeq: 5, limit: 4 });
    // Each caller owns an independent waiter/result even though the Feed
    // shares one physical page operation.
    expect(second).not.toBe(first);
    await nextTick();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      channelId: 'c0', beforeSeq: 5, limit: 4, generation: 1,
    });

    for (let seq = 1; seq <= 4; seq += 1) {
      expect(snapshot.enqueue({
        ref: requests[0].ref, channel_id: 'c0', seq,
        envelope: historyRow(seq).envelope,
      })).toBe(true);
    }
    expect(snapshot.pageEnd({
      ref: requests[0].ref, channel_id: 'c0', generation: 1,
      rows: 4, scan_low_seq: 1, scan_high_seq: 4,
      next_before_seq: 1, has_older: false,
    })).toBe(true);
    await expect(first).resolves.toMatchObject({ kind: 'satisfied', released: 4 });
    expect(snapshot.historyFor('c0')).toMatchObject({ completedPages: 1, beforeSeq: 1 });
    expect(snapshot.stateFor('c0')?.rows.size).toBe(4);
    runtime.destroy();
  });

  it('retires an unfinished history demand after disconnect and regrant', async () => {
    const requests = [];
    const wireRef = { current: {
      historyBefore: vi.fn((channelId, beforeSeq, _limit, detail) => {
        const ref = `disconnect-history-${requests.length + 1}`;
        requests.push({ channelId, beforeSeq, ref, ...detail });
        const receipt = Promise.resolve({ accepted: true, generation: detail.generation, channel_id: channelId });
        receipt.ref = ref;
        return receipt;
      }),
      cancelHistory: vi.fn(async () => undefined),
    } };
    const runtime = createChannelFeedRuntime({ ...runtimeOptions(), wireRef });
    runtime.mount();
    const snapshot = runtime.getSnapshot();

    await expect(snapshot.loadHistory('c1', { intent: 'initial-view' }))
      .resolves.toMatchObject({ kind: 'waiting', reason: 'history-grant-pending' });
    await snapshot.setHistoryGrants([
      { channel_id: 'c0', head_seq: 844, has_rows: true },
    ], { generation: 1, boot: 'disconnect-regrant-boot', focus: 'c0' });
    const pending = snapshot.loadHistory('c0', {
      intent: 'initial-view', urgency: 'blocking',
    });
    await nextTick();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ beforeSeq: 845, generation: 1 });

    expect(snapshot.disconnectHistory(1)).toBe(true);
    await expect(pending).resolves.toMatchObject({ kind: 'cancelled', reason: 'stale-generation' });
    await expect(snapshot.setHistoryGrants([
      { channel_id: 'c0', head_seq: 845, has_rows: true },
    ], { generation: 2, boot: 'disconnect-regrant-boot', focus: 'c0' }))
      .resolves.toMatchObject({ stale: true });
    const reconnected = runtime.getSnapshot();
    await reconnected.setHistoryGrants([
      { channel_id: 'c0', head_seq: 845, has_rows: true },
    ], { generation: 2, boot: 'disconnect-regrant-boot', focus: 'c0' });
    await nextTick();

    // Disconnect retires the unfinished demand. A replacement grant must not
    // replay an intent that was issued under the revoked authority.
    expect(requests).toHaveLength(1);
    expect(reconnected.historyFor('c0')).toMatchObject({
      attached: true, generation: 2, loading: false,
      historyDemand: { phase: 'idle' },
    });
    expect(reconnected.historyFor('c1')).toMatchObject({
      attached: false, loading: false, historyDemand: { phase: 'idle' },
    });

    const replacementDemand = reconnected.loadHistory('c0', {
      intent: 'initial-view', urgency: 'blocking',
    });
    await nextTick();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ beforeSeq: 846, generation: 2 });
    expect(reconnected.pageEnd({
      ref: requests[1].ref, channel_id: 'c0', generation: 2,
      rows: 0, scan_low_seq: 0, scan_high_seq: 845, next_before_seq: 0, has_older: false,
    })).toBe(true);
    await expect(replacementDemand).resolves.toMatchObject({ kind: 'exhausted', released: 0 });
    await nextTick();
    expect(reconnected.historyFor('c0')).toMatchObject({
      attached: true, generation: 2, loading: false,
      historyDemand: { phase: 'idle' },
    });
    runtime.destroy();
  });

  it('drops a late in-flight page when the attach world changes', async () => {
    const requests = [];
    const wireRef = { current: {
      historyBefore: vi.fn((channelId, beforeSeq, _limit, detail) => {
        const ref = `world-history-${requests.length + 1}`;
        requests.push({ channelId, beforeSeq, ref, ...detail });
        const receipt = Promise.resolve({ accepted: true, generation: detail.generation, channel_id: channelId });
        receipt.ref = ref;
        return receipt;
      }),
      cancelHistory: vi.fn(async () => undefined),
    } };
    const runtime = createChannelFeedRuntime({ ...runtimeOptions(), wireRef });
    runtime.mount();
    const snapshot = runtime.getSnapshot();
    await snapshot.setHistoryGrants([
      { channel_id: 'c0', head_seq: 844, has_rows: true },
    ], { generation: 1, boot: 'world-a', focus: 'c0' });
    const pending = snapshot.loadHistory('c0', { intent: 'initial-view' });
    await nextTick();
    expect(requests).toHaveLength(1);

    await snapshot.setHistoryGrants([
      { channel_id: 'c0', head_seq: 845, has_rows: true },
    ], { generation: 2, boot: 'world-b', focus: 'c0' });
    expect(snapshot.pageEnd({
      ref: requests[0].ref, channel_id: 'c0', generation: 1,
      rows: 1, scan_low_seq: 1, scan_high_seq: 844,
      next_before_seq: 1, has_older: true,
    })).toBe(false);
    await expect(pending).resolves.toMatchObject({ kind: 'cancelled', reason: 'stale-generation' });
    expect(requests).toHaveLength(1);
    expect(snapshot.historyFor('c0')).toMatchObject({
      attached: true, generation: 2, headSeq: 845,
      authority: { serverBoot: 'world-b' },
      historyDemand: { phase: 'idle' },
    });
    expect(snapshot.stateFor('c0')?.rows.has(844)).not.toBe(true);
    runtime.destroy();
  });

  it('retires deferred history demand when the attach world changes', async () => {
    const requests = [];
    const wireRef = { current: {
      historyBefore: vi.fn((channelId, beforeSeq, _limit, detail) => {
        const ref = `world-deferred-history-${requests.length + 1}`;
        requests.push({ channelId, beforeSeq, ref, ...detail });
        const receipt = Promise.resolve({ accepted: true, generation: detail.generation, channel_id: channelId });
        receipt.ref = ref;
        return receipt;
      }),
      cancelHistory: vi.fn(async () => undefined),
    } };
    const runtime = createChannelFeedRuntime({ ...runtimeOptions(), wireRef });
    runtime.mount();
    const snapshot = runtime.getSnapshot();

    await expect(snapshot.loadHistory('c1', { intent: 'initial-view' }))
      .resolves.toMatchObject({ kind: 'waiting', reason: 'history-grant-pending' });
    await snapshot.setHistoryGrants([
      { channel_id: 'c0', head_seq: 10, has_rows: true },
    ], { generation: 1, boot: 'world-a', focus: 'c0' });
    expect(requests).toHaveLength(0);

    await snapshot.setHistoryGrants([
      { channel_id: 'c0', head_seq: 11, has_rows: true },
    ], { generation: 2, boot: 'world-b', focus: 'c0' });
    expect(requests).toHaveLength(0);
    expect(snapshot.historyFor('c1')).toMatchObject({
      attached: false, loading: false, historyDemand: { phase: 'idle' },
    });
    await expect(snapshot.setHistoryGrants([
      { channel_id: 'c0', head_seq: 12, has_rows: true },
    ], { generation: 3, boot: 'world-c', focus: 'c0' }))
      .resolves.toMatchObject({ stale: true });
    const current = runtime.getSnapshot();
    await current.setHistoryGrants([
      { channel_id: 'c0', head_seq: 12, has_rows: true },
    ], { generation: 3, boot: 'world-c', focus: 'c0' });
    expect(current.historyFor('c0')).toMatchObject({
      attached: true, generation: 3, authority: { serverBoot: 'world-c' },
    });
    runtime.destroy();
  });

  it.each(['clear', 'destroy'])('does not resurrect a %s runtime on a late grant', async (lifecycle) => {
    const requests = [];
    const wireRef = { current: {
      historyBefore: vi.fn((channelId, beforeSeq, _limit, detail) => {
        const ref = `terminal-history-${requests.length + 1}`;
        requests.push({ channelId, beforeSeq, ref, ...detail });
        const receipt = Promise.resolve({ accepted: true, generation: detail.generation, channel_id: channelId });
        receipt.ref = ref;
        return receipt;
      }),
      cancelHistory: vi.fn(async () => undefined),
    } };
    const runtime = createChannelFeedRuntime({ ...runtimeOptions(), wireRef });
    runtime.mount();
    const snapshot = runtime.getSnapshot();
    await expect(snapshot.loadHistory('c0', { intent: 'initial-view' }))
      .resolves.toMatchObject({ kind: 'waiting', reason: 'history-grant-pending' });
    if (lifecycle === 'clear') snapshot.clear();
    else runtime.destroy();

    await snapshot.setHistoryGrants([
      { channel_id: 'c0', head_seq: 844, has_rows: true },
    ], { generation: 1, boot: 'late-grant-boot', focus: 'c0' });
    await nextTick();
    expect(requests).toHaveLength(0);
    expect(snapshot.stateEntries()).toHaveLength(0);
    expect(snapshot.historyFor('c0')).toMatchObject({
      attached: false, generation: 0, loading: false,
      historyDemand: { phase: 'idle' },
    });
  });

  it('starts a clean demand on a normal replacement runtime', async () => {
    const requests = [];
    const wireRef = { current: {
      historyBefore: vi.fn((channelId, beforeSeq, _limit, detail) => {
        const ref = `replacement-history-${requests.length + 1}`;
        requests.push({ channelId, beforeSeq, ref, ...detail });
        const receipt = Promise.resolve({ accepted: true, generation: detail.generation, channel_id: channelId });
        receipt.ref = ref;
        return receipt;
      }),
      cancelHistory: vi.fn(async () => undefined),
    } };
    const retired = createChannelFeedRuntime({ ...runtimeOptions(), wireRef });
    retired.mount();
    await retired.getSnapshot().loadHistory('c0', { intent: 'initial-view' });
    retired.destroy();

    const runtime = createChannelFeedRuntime({ ...runtimeOptions(), wireRef });
    runtime.mount();
    const snapshot = runtime.getSnapshot();
    await snapshot.setHistoryGrants([
      { channel_id: 'c0', head_seq: 2, has_rows: true },
    ], { generation: 1, boot: 'replacement-boot', focus: 'c0' });
    const pending = snapshot.loadHistory('c0', { intent: 'initial-view' });
    await nextTick();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ beforeSeq: 3, generation: 1 });
    expect(snapshot.pageEnd({
      ref: requests[0].ref, channel_id: 'c0', generation: 1,
      rows: 0, scan_low_seq: 0, scan_high_seq: 2, next_before_seq: 0, has_older: false,
    })).toBe(true);
    await expect(pending).resolves.toMatchObject({ kind: 'exhausted', released: 0 });
    expect(snapshot.historyFor('c0')).toMatchObject({
      attached: true, generation: 1, loading: false,
      historyDemand: { phase: 'idle' },
    });
    runtime.destroy();
  });

  it('rejects a live frame from an old snapshot after destroy', async () => {
    const runtime = createChannelFeedRuntime(runtimeOptions());
    runtime.mount();
    const snapshot = runtime.getSnapshot();
    await snapshot.setHistoryGrants([
      { channel_id: 'c0', head_seq: 1, has_rows: true },
    ], { generation: 1, boot: 'destroy-enqueue-boot', focus: 'c0' });
    runtime.destroy();

    expect(snapshot.enqueue({
      channel_id: 'c0', seq: 1, generation: 1, source: 'live',
      envelope: {
        id: 'destroyed-frame', kind: 'event', type: 'message',
        sender: { id: 'agent:old:1', kind: 'agent' }, audience: [],
        payload: { text: 'must not land' },
      },
    })).toBe(false);
    expect(snapshot.stateEntries()).toHaveLength(0);
  });

  it('cancels loadHistory invoked through an old snapshot after destroy', async () => {
    const requests = [];
    const wireRef = { current: {
      historyBefore: vi.fn((channelId, beforeSeq, _limit, detail) => {
        const ref = `destroyed-load-${requests.length + 1}`;
        requests.push({ channelId, beforeSeq, ref, ...detail });
        const receipt = Promise.resolve({ accepted: true, generation: detail.generation, channel_id: channelId });
        receipt.ref = ref;
        return receipt;
      }),
      cancelHistory: vi.fn(async () => undefined),
    } };
    const runtime = createChannelFeedRuntime({ ...runtimeOptions(), wireRef });
    runtime.mount();
    const snapshot = runtime.getSnapshot();
    await snapshot.setHistoryGrants([
      { channel_id: 'c0', head_seq: 1, has_rows: true },
    ], { generation: 1, boot: 'destroy-load-boot', focus: 'c0' });
    runtime.destroy();

    const result = await snapshot.loadHistory('c0', { intent: 'initial-view' });
    expect(result).toMatchObject({ kind: 'cancelled' });
    expect(requests).toHaveLength(0);
    expect(snapshot.stateEntries()).toHaveLength(0);
  });

  it('rejects setHistoryGrants invoked through an old snapshot after destroy', async () => {
    const requests = [];
    const wireRef = { current: {
      historyBefore: vi.fn((channelId, beforeSeq, _limit, detail) => {
        const ref = `destroyed-grant-${requests.length + 1}`;
        requests.push({ channelId, beforeSeq, ref, ...detail });
        const receipt = Promise.resolve({ accepted: true, generation: detail.generation, channel_id: channelId });
        receipt.ref = ref;
        return receipt;
      }),
      cancelHistory: vi.fn(async () => undefined),
    } };
    const runtime = createChannelFeedRuntime({ ...runtimeOptions(), wireRef });
    runtime.mount();
    const snapshot = runtime.getSnapshot();
    await snapshot.setHistoryGrants([
      { channel_id: 'c0', head_seq: 1, has_rows: true },
    ], { generation: 1, boot: 'destroy-grant-boot', focus: 'c0' });
    runtime.destroy();

    await expect(snapshot.setHistoryGrants([
      { channel_id: 'c0', head_seq: 844, has_rows: true },
    ], { generation: 1, boot: 'destroyed-grant-boot', focus: 'c0' }))
      .resolves.toMatchObject({ stale: true });
    expect(requests).toHaveLength(0);
    expect(snapshot.stateEntries()).toHaveLength(0);
  });

  it('starts a fresh runtime with an independent demand after destroy', async () => {
    const requests = [];
    const wireRef = { current: {
      historyBefore: vi.fn((channelId, beforeSeq, _limit, detail) => {
        const ref = `fresh-runtime-${requests.length + 1}`;
        requests.push({ channelId, beforeSeq, ref, ...detail });
        const receipt = Promise.resolve({ accepted: true, generation: detail.generation, channel_id: channelId });
        receipt.ref = ref;
        return receipt;
      }),
      cancelHistory: vi.fn(async () => undefined),
    } };
    const retired = createChannelFeedRuntime({ ...runtimeOptions(), wireRef });
    retired.mount();
    const retiredSnapshot = retired.getSnapshot();
    retired.destroy();

    const runtime = createChannelFeedRuntime({ ...runtimeOptions(), wireRef });
    runtime.mount();
    const snapshot = runtime.getSnapshot();
    await snapshot.setHistoryGrants([
      { channel_id: 'c0', head_seq: 2, has_rows: true },
    ], { generation: 1, boot: 'fresh-runtime-boot', focus: 'c0' });
    const pending = snapshot.loadHistory('c0', { intent: 'initial-view' });
    await nextTick();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ beforeSeq: 3, generation: 1 });
    expect(snapshot.pageEnd({
      ref: requests[0].ref, channel_id: 'c0', generation: 1,
      rows: 0, scan_low_seq: 0, scan_high_seq: 2, next_before_seq: 0, has_older: false,
    })).toBe(true);
    await expect(pending).resolves.toMatchObject({ kind: 'exhausted', released: 0 });
    expect(retiredSnapshot.stateEntries()).toHaveLength(0);
    // The fresh grant may install an empty metadata record for c0; the
    // independent-runtime fence is about canonical rows, not that metadata.
    expect(snapshot.stateFor('c0')?.rows.size).toBe(0);
    runtime.destroy();
  });

  it('fails closed for every public mutation after destroy', async () => {
    const runtime = createChannelFeedRuntime(runtimeOptions());
    runtime.mount();
    const snapshot = runtime.getSnapshot();
    const ownerToken = Object.freeze({ principalId: 'destroyed-owner' });
    runtime.destroy();

    expect(snapshot.bump()).toBe(false);
    expect(snapshot.enqueue({ channel_id: 'c0', seq: 1, envelope: historyRow(1).envelope })).toBe(false);
    expect(snapshot.pageEnd({ ref: 'late-page' })).toBe(false);
    expect(snapshot.liveCheckpoint({ generation: 1, channel_id: 'c0', scan_low_seq: 1, scanned_seq: 1 })).toBe(false);
    await expect(snapshot.loadHistory('c0')).resolves.toMatchObject({
      kind: 'cancelled', reason: 'runtime-destroyed',
    });
    await expect(snapshot.prepareLocalReplica('destroyed-owner')).resolves.toEqual({ resume: {} });
    await expect(snapshot.refreshChannel('c0')).resolves.toBe(false);
    expect(snapshot.disconnectHistory()).toBe(false);
    expect(snapshot.stopIncompatible()).toBe(false);
    expect(snapshot.clear()).toBe(false);
    await expect(snapshot.resetPersistent()).resolves.toBe(false);
    expect(snapshot.focusHistory('c0')).toBe(false);
    expect(snapshot.reconcileIdentity('c0')).toBe(false);
    expect(snapshot.markRead('c0')).toBe(false);
    expect(snapshot.acknowledgeNotifications({})).toBe(false);
    expect(snapshot.acknowledgeAgentActivity('c0', 'agent:destroyed:1')).toBe(false);
    expect(snapshot.acknowledgeTimerFirings()).toBe(false);
    expect(snapshot.agentActivityPort.attach({ generation: 1 })).toBe(false);
    expect(snapshot.agentActivityPort.disconnect()).toBe(false);
    expect(snapshot.notificationAuthorityPort.reset()).toBe(false);
    expect(snapshot.requestBackgroundInterest('c0', { intent: 'search-context' })).toMatchObject({
      accepted: false,
    });
    expect(runtime.getOwnerSnapshot(ownerToken).enqueue({
      channel_id: 'c0', seq: 2, envelope: historyRow(2).envelope,
    })).toBe(false);
    expect(runtime.getOwnerSnapshot(ownerToken).liveCheckpoint({
      generation: 1, channel_id: 'c0', scan_low_seq: 1, scanned_seq: 1,
    })).toBe(false);
    expect(snapshot.stateEntries()).toHaveLength(0);
    expect(snapshot.historyFor('c0')).toMatchObject({
      attached: false, generation: 0, loading: false, historyDemand: { phase: 'idle' },
    });
  });

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

  it('[TC-0456][AD-162] carries the committed producer owner through rAF batching and delayed roster callbacks', async () => {
    // 用户能力：live row 在 Feed owner 交接期间仍归属于最初提交它的 owner；
    // 迟到的旧 producer 不能再写入当前频道或提交一次假 landed 回调。
    // 不变量：ChannelFeedRuntime 的 owner token 是 Feed/Replica/roster projection
    // 的单一 admission fence；公开 owner 是 createChannelFeedRuntime + getOwnerSnapshot。
    const ownerA = Object.freeze({ principalId: 'tc0456-owner-a' });
    const ownerB = Object.freeze({ principalId: 'tc0456-owner-b' });
    const submissionCalls = [];
    const rosterCalls = [];
    let rosterOwner = ownerA;
    const options = runtimeOptions();
    options.onSubmissionFeed = vi.fn((...args) => {
      // Model the downstream rAF/settle delay without importing a private queue.
      queueMicrotask(() => submissionCalls.push(args));
    });
    options.rosterRef.current = {
      self: () => '',
      observeFeed: () => '',
      handleEnvelope: vi.fn((channelId, envelope) => {
        const committedOwner = rosterOwner;
        queueMicrotask(() => rosterCalls.push({ channelId, envelope, committedOwner }));
      }),
    };

    const runtime = createChannelFeedRuntime(options);
    runtime.mount();
    runtime.bind({ ...options, ownerToken: ownerA });
    try {
      await runtime.getSnapshot().setHistoryGrants([
        { channel_id: 'c0', head_seq: 0, has_rows: false },
      ], { generation: 1, boot: 'tc0456-boot', focus: 'c0' });

      const row = (seq, id) => ({
        channel_id: 'c0', seq, source: 'live', generation: 1,
        envelope: {
          id, kind: 'event', type: 'channel.info',
          sender: { id: 'system:c0:tc0456', kind: 'system' }, audience: [], payload: {},
        },
      });
      const producerA = runtime.getOwnerSnapshot(ownerA);
      expect(producerA.enqueue(row(1, 'owner-a-row'))).toBe(true);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      expect(runtime.getSnapshot().stateFor('c0')?.rows.has(1)).toBe(true);
      expect(submissionCalls).toHaveLength(1);
      expect(submissionCalls[0][2]).toBe(ownerA);
      expect(rosterCalls).toEqual([
        expect.objectContaining({ channelId: 'c0', committedOwner: ownerA }),
      ]);

      rosterOwner = ownerB;
      const releaseB = runtime.bind({ ...options, ownerToken: ownerB });
      const producerB = runtime.getOwnerSnapshot(ownerB);

      // The old public owner may retain a stable enqueue until its caller unmounts.
      // It must be harmless even after two animation-frame turns.
      expect(producerA.enqueue(row(2, 'late-owner-a-row'))).toBe(true);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      expect(runtime.getSnapshot().stateFor('c0')?.rows.has(2)).not.toBe(true);
      expect(submissionCalls).toHaveLength(1);
      expect(rosterCalls.some(({ envelope }) => envelope.id === 'late-owner-a-row')).toBe(false);

      expect(producerB.enqueue(row(3, 'owner-b-row'))).toBe(true);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      expect(runtime.getSnapshot().stateFor('c0')?.rows.has(3)).toBe(true);
      expect(submissionCalls).toHaveLength(2);
      expect(submissionCalls[1][2]).toBe(ownerB);
      expect(rosterCalls.some(({ envelope, committedOwner }) => (
        envelope.id === 'owner-b-row' && committedOwner === ownerB
      ))).toBe(true);
      releaseB();
    } finally {
      runtime.destroy();
    }
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

  it('settles detached background cancellation without hiding attached-wire errors', async () => {
    let requestNumber = 0;
    let cancelError = Object.assign(new Error('wire is not attached'), { code: 'unavailable' });
    const onError = vi.fn();
    const wireRef = { current: {
      historyBefore: vi.fn(() => {
        requestNumber += 1;
        const accepted = Promise.resolve({ accepted: true, generation: 1, channel_id: 'c0.project' });
        accepted.ref = `search-interest-${requestNumber}`;
        return accepted;
      }),
      cancelHistory: vi.fn(() => Promise.reject(cancelError)),
    } };
    const runtime = createChannelFeedRuntime({ ...runtimeOptions(), wireRef, onError });
    runtime.mount();
    await runtime.getSnapshot().setHistoryGrants([
      { channel_id: 'c0', head_seq: 0 },
      { channel_id: 'c0.project', head_seq: 1 },
    ], { generation: 1, boot: 'background-cancel' });

    const detached = runtime.getSnapshot().requestBackgroundInterest('c0.project', {
      intent: 'search-context',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(wireRef.current.historyBefore).toHaveBeenCalledTimes(1);
    detached.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(wireRef.current.cancelHistory).toHaveBeenCalledWith(
      'c0.project', 'search-interest-1', 1,
    );
    expect(onError).not.toHaveBeenCalled();
    expect(runtime.getSnapshot().historyFor('c0.project')).toMatchObject({
      loading: false,
      historyDemand: { phase: 'idle', error: '' },
    });

    cancelError = Object.assign(new Error('server refused cancellation'), { code: 'forbidden' });
    const attachedWireFailure = runtime.getSnapshot().requestBackgroundInterest('c0.project', {
      intent: 'search-context',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(wireRef.current.historyBefore).toHaveBeenCalledTimes(2);
    attachedWireFailure.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onError).toHaveBeenCalledWith(cancelError);
    expect(runtime.getSnapshot().historyFor('c0.project')).toMatchObject({
      loading: false,
      historyDemand: { phase: 'idle', error: '' },
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
