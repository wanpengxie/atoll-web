// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { clearDiagnostics, diagnosticsSnapshot } from '../src/model/diagnostics.js';

const cacheControl = vi.hoisted(() => ({
  holdSaveRows: false,
  pendingSaveRows: [],
}));

vi.mock('../src/model/channel-replica.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createChannelReplicaCache: (...args) => {
      const cache = actual.createChannelReplicaCache(...args);
      const saveRows = cache.saveRows.bind(cache);
      return Object.freeze({
        ...cache,
        saveRows: (...saveArgs) => cacheControl.holdSaveRows
          ? new Promise((resolve, reject) => {
            cacheControl.pendingSaveRows.push({ resolve, reject, saveRows, saveArgs });
          })
          : saveRows(...saveArgs),
      });
    },
  };
});

const { createChannelFeedRuntime } = await import('../src/model/channel-feed-runtime.js');

function runtimeOptions(wireRef) {
  return {
    wireRef,
    rosterRef: { current: { self: () => '', handleEnvelope: () => {} } },
    accessRef: { current: { live: () => false } },
    activeChannelRef: { current: 'c0' },
    onError: vi.fn(),
    onChannelsDiscovered: vi.fn(),
    onDirectoryInvalidated: vi.fn(),
    onSubmissionFeed: vi.fn(),
    onAccessChanged: vi.fn(),
    onAgentActivity: vi.fn(),
  };
}

function wireHarness() {
  const requests = [];
  const wireRef = { current: {
    historyBefore: vi.fn((channelId, beforeSeq, limit, detail) => {
      const ref = `warm-authority-${requests.length + 1}`;
      requests.push({ channelId, beforeSeq, limit, ref, ...detail });
      const receipt = Promise.resolve({
        accepted: true,
        generation: detail.generation,
        channel_id: channelId,
      });
      receipt.ref = ref;
      return receipt;
    }),
    cancelHistory: vi.fn(async () => undefined),
  } };
  return { requests, wireRef };
}

function row(seq) {
  return {
    channel_id: 'c0',
    seq,
    envelope: {
      id: `warm-authority-row-${seq}`,
      kind: 'event',
      type: 'human.note',
      payload: { body: { text: `warm authority ${seq}` } },
    },
  };
}

async function attachedWarmRuntime() {
  const { requests, wireRef } = wireHarness();
  const runtime = createChannelFeedRuntime(runtimeOptions(wireRef));
  runtime.mount();
  const snapshot = runtime.getSnapshot();
  await snapshot.prepareLocalReplica(`warm-authority-${Date.now()}-${Math.random()}`);
  await snapshot.setHistoryGrants([
    { channel_id: 'c0', head_seq: 1000, has_rows: true },
  ], { generation: 1, boot: 'warm-authority-boot', focus: 'c0' });
  return { runtime, snapshot, requests };
}

function finishPage(snapshot, request) {
  expect(snapshot.enqueue({ ...row(999), ref: request.ref, generation: 1 })).toBe(true);
  expect(snapshot.enqueue({ ...row(1000), ref: request.ref, generation: 1 })).toBe(true);
  expect(snapshot.pageEnd({
    ref: request.ref,
    channel_id: 'c0',
    generation: 1,
    rows: 2,
    scan_low_seq: 999,
    scan_high_seq: 1000,
    next_before_seq: 999,
    has_older: true,
  })).toBe(true);
}

afterEach(() => {
  cacheControl.holdSaveRows = false;
  for (const pending of cacheControl.pendingSaveRows.splice(0)) pending.resolve(0);
  clearDiagnostics();
});

describe('TC0231 startup warm authority fence', () => {
  it.each([
    ['attach replacement', async (snapshot) => {
      await snapshot.setHistoryGrants([
        { channel_id: 'c0', head_seq: 1000, has_rows: true },
      ], { generation: 2, boot: 'warm-authority-boot', focus: 'c0' });
    }],
    ['world replacement', async (snapshot) => {
      await snapshot.setHistoryGrants([
        { channel_id: 'c0', head_seq: 1000, has_rows: true },
      ], { generation: 2, boot: 'warm-authority-world-2', focus: 'c0' });
    }],
    ['disconnect', async (snapshot) => {
      expect(snapshot.disconnectHistory(1)).toBe(true);
    }],
  ])('does not install a warm page after %s while cache persistence is pending', async (_name, replaceAuthority) => {
    const { runtime, snapshot, requests } = await attachedWarmRuntime();
    cacheControl.holdSaveRows = true;
    const lease = snapshot.requestBackgroundInterest('c0', { intent: 'channel-entry' });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    finishPage(snapshot, requests[0]);
    await vi.waitFor(() => expect(cacheControl.pendingSaveRows).toHaveLength(1));

    await replaceAuthority(snapshot);
    expect(snapshot.stateFor('c0')?.rows.size || 0).toBe(0);
    cacheControl.pendingSaveRows.shift()?.resolve(2);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(snapshot.stateFor('c0')?.rows.size || 0).toBe(0);
    expect(diagnosticsSnapshot().filter((entry) => entry.event === 'history.batch_complete'))
      .toHaveLength(0);
    lease.release();
    runtime.destroy();
  });

  it('restarts a cancelled started warm record for a replacement lease', async () => {
    const { runtime, snapshot, requests } = await attachedWarmRuntime();
    const first = snapshot.requestBackgroundInterest('c0', { intent: 'channel-entry' });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(first.release()).toBe(true);
    const second = snapshot.requestBackgroundInterest('c0', { intent: 'channel-entry' });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(second).toMatchObject({ accepted: true, channelId: 'c0', intent: 'channel-entry' });
    expect(requests[1].ref).not.toBe(requests[0].ref);
    second.release();
    runtime.destroy();
  });
});
