// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { diagnosticsSnapshot, clearDiagnostics } from '../src/model/diagnostics.js';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';

function runtimeOptions(wireRef) {
  return {
    wireRef,
    rosterRef: { current: {
      self: () => 'human:root:1',
      handleEnvelope: () => {},
    } },
    accessRef: { current: { live: () => false } },
    activeChannelRef: { current: 'c0' },
    onError: vi.fn(),
    onChannelsDiscovered: vi.fn(),
    onDirectoryInvalidated: vi.fn(),
    onAccessChanged: vi.fn(),
    onSubmissionFeed: vi.fn(),
  };
}

function row(seq, envelope = {}) {
  return {
    channel_id: 'c0', seq,
    envelope: {
      id: `physical-row-${seq}`,
      kind: 'event', type: 'human.note',
      payload: { body: { text: `row ${seq}` } },
      ...envelope,
    },
  };
}

function wireHarness() {
  const requests = [];
  const wireRef = { current: {
    historyBefore: vi.fn((channelId, beforeSeq, limit, detail) => {
      const ref = `physical-${requests.length + 1}`;
      requests.push({ channelId, beforeSeq, limit, ref, ...detail });
      const receipt = Promise.resolve({ accepted: true, generation: detail.generation, channel_id: channelId });
      receipt.ref = ref;
      return receipt;
    }),
    cancelHistory: vi.fn(async () => undefined),
  } };
  return { requests, wireRef };
}

async function attachedRuntime() {
  const harness = wireHarness();
  const runtime = createChannelFeedRuntime(runtimeOptions(harness.wireRef));
  runtime.mount();
  await runtime.getSnapshot().setHistoryGrants([
    { channel_id: 'c0', head_seq: 2, has_rows: true },
  ], { generation: 1, boot: 'physical-operation-boot', focus: 'c0' });
  return { ...harness, runtime, snapshot: runtime.getSnapshot() };
}

describe('Feed PhysicalOperation / WaiterLease boundary', () => {
  it('keeps one raw request while each caller receives its own semantic projection', async () => {
    const { requests, runtime, snapshot } = await attachedRuntime();
    clearDiagnostics();
    const firstLease = vi.fn();
    const secondLease = vi.fn();
    const first = snapshot.loadHistory('c0', {
      beforeSeq: 3, limit: 2,
      viewSpec: { scope: 'all' },
      onOperation: firstLease,
    });
    const second = snapshot.loadHistory('c0', {
      beforeSeq: 3, limit: 2,
      viewSpec: { scope: 'mine', selfId: 'human:root:1' },
      onOperation: secondLease,
    });

    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(second).not.toBe(first);
    expect(firstLease).toHaveBeenCalledOnce();
    expect(secondLease).toHaveBeenCalledOnce();
    expect(firstLease.mock.calls[0][0]).not.toBe(secondLease.mock.calls[0][0]);

    expect(snapshot.enqueue({
      ...row(1, { sender: { id: 'human:root:1', kind: 'human' } }),
      ref: requests[0].ref,
      generation: 1,
    })).toBe(true);
    expect(snapshot.enqueue({
      ...row(2, { sender: { id: 'agent:other:1', kind: 'agent' } }),
      ref: requests[0].ref,
      generation: 1,
    })).toBe(true);
    expect(snapshot.pageEnd({
      ref: requests[0].ref, channel_id: 'c0', generation: 1,
      rows: 2, scan_low_seq: 1, scan_high_seq: 2,
      next_before_seq: 1, has_older: false,
    })).toBe(true);

    const [allResult, mineResult] = await Promise.all([first, second]);
    expect(allResult).toMatchObject({ kind: 'satisfied', released: 2 });
    expect(mineResult).toMatchObject({ kind: 'satisfied', released: 2 });
    expect(allResult.projection.items).toHaveLength(2);
    expect(mineResult.projection.items).toHaveLength(1);
    expect(mineResult.projection.items[0].envelope.sender.id).toBe('human:root:1');
    expect(diagnosticsSnapshot().filter((entry) => entry.event === 'history.batch_complete'))
      .toHaveLength(1);
    runtime.destroy();
  });

  it('detaches only the aborted caller and keeps the physical operation for its joiner', async () => {
    const { requests, wireRef, runtime, snapshot } = await attachedRuntime();
    const firstController = new AbortController();
    const first = snapshot.loadHistory('c0', {
      beforeSeq: 3, limit: 2, signal: firstController.signal,
      urgency: 'anticipatory',
    });
    const second = snapshot.loadHistory('c0', {
      beforeSeq: 3, limit: 2, urgency: 'blocking',
    });
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    firstController.abort('first waiter retired');
    await expect(first).resolves.toMatchObject({ kind: 'cancelled', reason: 'aborted' });
    expect(wireRef.current.cancelHistory).not.toHaveBeenCalled();

    expect(snapshot.enqueue({
      ...row(1, { sender: { id: 'human:root:1', kind: 'human' } }),
      ref: requests[0].ref, generation: 1,
    })).toBe(true);
    expect(snapshot.enqueue({
      ...row(2, { sender: { id: 'agent:other:1', kind: 'agent' } }),
      ref: requests[0].ref, generation: 1,
    })).toBe(true);
    expect(snapshot.pageEnd({
      ref: requests[0].ref, channel_id: 'c0', generation: 1,
      rows: 2, scan_low_seq: 1, scan_high_seq: 2,
      next_before_seq: 1, has_older: false,
    })).toBe(true);
    await expect(second).resolves.toMatchObject({ kind: 'satisfied', released: 2 });
    expect(wireRef.current.cancelHistory).not.toHaveBeenCalled();
    runtime.destroy();
  });

  it('fences a late principal replacement before canonical commit', async () => {
    const { requests, runtime, snapshot } = await attachedRuntime();
    const pending = snapshot.loadHistory('c0', { beforeSeq: 3, limit: 2 });
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    await snapshot.prepareLocalReplica('replacement-principal', { focus: '' });
    await expect(pending).resolves.toMatchObject({ kind: 'cancelled', reason: 'stale-generation' });
    expect(snapshot.pageEnd({
      ref: requests[0].ref, channel_id: 'c0', generation: 1,
      rows: 1, scan_low_seq: 1, scan_high_seq: 2,
      next_before_seq: 1, has_older: false,
    })).toBe(false);
    expect(snapshot.stateFor('c0')?.rows.size).toBe(0);
    runtime.destroy();
  });

  it('fences a late world/attach replacement before canonical commit', async () => {
    const { requests, runtime, snapshot } = await attachedRuntime();
    const pending = snapshot.loadHistory('c0', { beforeSeq: 3, limit: 2 });
    await vi.waitFor(() => expect(requests).toHaveLength(1));

    await snapshot.setHistoryGrants([
      { channel_id: 'c0', head_seq: 2, has_rows: true },
    ], { generation: 2, boot: 'physical-operation-new-world', focus: 'c0' });
    await expect(pending).resolves.toMatchObject({ kind: 'cancelled', reason: 'stale-generation' });
    expect(snapshot.pageEnd({
      ref: requests[0].ref, channel_id: 'c0', generation: 1,
      rows: 1, scan_low_seq: 1, scan_high_seq: 2,
      next_before_seq: 1, has_older: false,
    })).toBe(false);
    expect(snapshot.stateFor('c0')?.rows.size).toBe(0);
    runtime.destroy();
  });
});
