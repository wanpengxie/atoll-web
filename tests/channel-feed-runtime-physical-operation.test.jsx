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
    expect(requests[0]).not.toHaveProperty('purpose');
    expect(requests[0]).not.toHaveProperty('intent');
    expect(requests[0]).not.toHaveProperty('urgency');
    expect(requests[0]).not.toHaveProperty('rangeKind');
    expect(requests[0]).toMatchObject({ priority: 'foreground', generation: 1, byteLimit: 1024 * 1024 });
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
    expect(diagnosticsSnapshot().find((entry) => entry.event === 'history.batch_complete')?.detail)
      .not.toHaveProperty('purpose');
    runtime.destroy();
  });

  it('aggregates two physical ranges without clearing the other range loading state', async () => {
    const { requests, runtime, snapshot } = await attachedRuntime();
    const first = snapshot.loadHistory('c0', { beforeSeq: 3, limit: 1, urgency: 'blocking' });
    const second = snapshot.loadHistory('c0', { beforeSeq: 6, limit: 1, urgency: 'blocking' });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(snapshot.historyFor('c0')).toMatchObject({ loading: true, foregroundLoading: true, backgroundLoading: false });

    expect(snapshot.enqueue({ ...row(2), ref: requests[0].ref, generation: 1 })).toBe(true);
    expect(snapshot.pageEnd({
      ref: requests[0].ref, channel_id: 'c0', generation: 1,
      rows: 1, scan_low_seq: 1, scan_high_seq: 2, next_before_seq: 1, has_older: true,
    })).toBe(true);
    await expect(first).resolves.toMatchObject({ kind: 'satisfied', released: 1 });
    expect(snapshot.historyFor('c0')).toMatchObject({ loading: true, foregroundLoading: true, backgroundLoading: false });

    expect(snapshot.enqueue({ ...row(5), ref: requests[1].ref, generation: 1 })).toBe(true);
    expect(snapshot.pageEnd({
      ref: requests[1].ref, channel_id: 'c0', generation: 1,
      rows: 1, scan_low_seq: 4, scan_high_seq: 5, next_before_seq: 4, has_older: true,
    })).toBe(true);
    await expect(second).resolves.toMatchObject({ kind: 'satisfied', released: 1 });
    expect(snapshot.historyFor('c0')).toMatchObject({ loading: false, foregroundLoading: false, backgroundLoading: false });
    runtime.destroy();
  });

  it('promotes one physical operation and recomputes foreground/background flags', async () => {
    const { requests, runtime, snapshot } = await attachedRuntime();
    const warm = snapshot.loadHistory('c0', { beforeSeq: 3, limit: 2, urgency: 'anticipatory' });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(snapshot.historyFor('c0')).toMatchObject({ loading: true, foregroundLoading: false, backgroundLoading: true });
    const foreground = snapshot.loadHistory('c0', { beforeSeq: 3, limit: 2, urgency: 'blocking' });
    expect(snapshot.historyFor('c0')).toMatchObject({ loading: true, foregroundLoading: true, backgroundLoading: false });
    expect(snapshot.enqueue({ ...row(1), ref: requests[0].ref, generation: 1 })).toBe(true);
    expect(snapshot.enqueue({ ...row(2), ref: requests[0].ref, generation: 1 })).toBe(true);
    expect(snapshot.pageEnd({
      ref: requests[0].ref, channel_id: 'c0', generation: 1,
      rows: 2, scan_low_seq: 1, scan_high_seq: 2, next_before_seq: 1, has_older: false,
    })).toBe(true);
    await expect(warm).resolves.toMatchObject({ kind: 'satisfied', released: 2 });
    await expect(foreground).resolves.toMatchObject({ kind: 'satisfied', released: 2 });
    expect(snapshot.historyFor('c0')).toMatchObject({ loading: false, foregroundLoading: false, backgroundLoading: false });
    runtime.destroy();
  });

  it('joins same reveal authority and supersedes an older reveal authority', async () => {
    const { requests, runtime, snapshot } = await attachedRuntime();
    const token = (operationID, activationID = 'activation-a', epoch = 'c0:1') => ({
      operationID, activationID, viewID: 'c0:timeline', epoch,
      inputEpoch: 2, intentRevision: 1, durableBaselineIDs: [], uiBaselineIDs: [], demandUnits: 1,
    });
    const first = snapshot.loadHistory('c0', {
      beforeSeq: 3, limit: 2, urgency: 'blocking', intent: 'scroll-history',
      historyRevealIntent: token('history:a:1'),
    });
    const same = snapshot.loadHistory('c0', {
      beforeSeq: 3, limit: 2, urgency: 'blocking', intent: 'scroll-history',
      historyRevealIntent: token('history:a:2'),
    });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(snapshot.historyFor('c0').presentationAdmissionState.token.operationID).toBe('history:a:1');
    expect(snapshot.enqueue({ ...row(1), ref: requests[0].ref, generation: 1 })).toBe(true);
    expect(snapshot.enqueue({ ...row(2), ref: requests[0].ref, generation: 1 })).toBe(true);
    expect(snapshot.pageEnd({
      ref: requests[0].ref, channel_id: 'c0', generation: 1,
      rows: 2, scan_low_seq: 1, scan_high_seq: 2, next_before_seq: 1, has_older: false,
    })).toBe(true);
    await expect(first).resolves.toMatchObject({ kind: 'satisfied' });
    await expect(same).resolves.toMatchObject({ kind: 'satisfied' });

    const replacement = snapshot.loadHistory('c0', {
      beforeSeq: 4, limit: 2, urgency: 'blocking', intent: 'scroll-history',
      historyRevealIntent: token('history:b:1', 'activation-b', 'c0:1'),
    });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(snapshot.historyFor('c0').presentationAdmissionState.token.operationID).toBe('history:b:1');
    expect(snapshot.pageEnd({
      ref: requests[1].ref, channel_id: 'c0', generation: 1,
      rows: 0, scan_low_seq: 0, scan_high_seq: 3, next_before_seq: 0, has_older: false,
    })).toBe(true);
    await expect(replacement).resolves.toMatchObject({ kind: 'satisfied' });
    runtime.destroy();
  });

  it('keeps one reveal transaction pending across underfilled concurrent ranges', async () => {
    const { requests, runtime, snapshot } = await attachedRuntime();
    const reveal = (operationID) => ({
      operationID, activationID: 'activation-shared', viewID: 'c0:timeline', epoch: 'c0:1',
      inputEpoch: 1, intentRevision: 1, durableBaselineIDs: [], uiBaselineIDs: [], demandUnits: 2,
    });
    const first = snapshot.loadHistory('c0', {
      beforeSeq: 3, limit: 1, urgency: 'blocking', intent: 'scroll-history',
      historyRevealIntent: reveal('history:shared:a'),
    });
    const second = snapshot.loadHistory('c0', {
      beforeSeq: 6, limit: 1, urgency: 'blocking', intent: 'scroll-history',
      historyRevealIntent: reveal('history:shared:b'),
    });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(snapshot.enqueue({ ...row(2), ref: requests[0].ref, generation: 1 })).toBe(true);
    expect(snapshot.pageEnd({
      ref: requests[0].ref, channel_id: 'c0', generation: 1,
      rows: 1, scan_low_seq: 1, scan_high_seq: 2, next_before_seq: 1, has_older: true,
    })).toBe(true);
    await expect(first).resolves.toMatchObject({ kind: 'satisfied' });
    expect(snapshot.historyFor('c0').presentationAdmissionState.phase).toBe('pending');

    expect(snapshot.enqueue({ ...row(5), ref: requests[1].ref, generation: 1 })).toBe(true);
    expect(snapshot.pageEnd({
      ref: requests[1].ref, channel_id: 'c0', generation: 1,
      rows: 1, scan_low_seq: 4, scan_high_seq: 5, next_before_seq: 4, has_older: true,
    })).toBe(true);
    await expect(second).resolves.toMatchObject({ kind: 'satisfied' });
    expect(snapshot.historyFor('c0').presentationAdmissionState).toMatchObject({
      phase: 'pending-baseline-commit', completeUnits: 2,
    });
    runtime.destroy();
  });

  it('retires every waiter of a replaced reveal demand before accepting its late page', async () => {
    const { requests, wireRef, runtime, snapshot } = await attachedRuntime();
    const reveal = (operationID, activationID) => ({
      operationID, activationID, viewID: 'c0:timeline', epoch: 'c0:1',
      inputEpoch: 1, intentRevision: 1, durableBaselineIDs: [], uiBaselineIDs: [], demandUnits: 1,
    });
    const old = snapshot.loadHistory('c0', {
      beforeSeq: 3, limit: 1, urgency: 'blocking', intent: 'scroll-history',
      historyRevealIntent: reveal('history:replace:old', 'activation-old'),
    });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const replacement = snapshot.loadHistory('c0', {
      beforeSeq: 6, limit: 1, urgency: 'blocking', intent: 'scroll-history',
      historyRevealIntent: reveal('history:replace:new', 'activation-new'),
    });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    await expect(old).resolves.toMatchObject({ kind: 'cancelled', reason: 'stale-authority' });
    await vi.waitFor(() => expect(wireRef.current.cancelHistory).toHaveBeenCalledTimes(1));
    expect(snapshot.enqueue({ ...row(2), ref: requests[0].ref, generation: 1 })).toBe(false);
    expect(snapshot.pageEnd({
      ref: requests[0].ref, channel_id: 'c0', generation: 1,
      rows: 1, scan_low_seq: 1, scan_high_seq: 2, next_before_seq: 1, has_older: true,
    })).toBe(false);

    expect(snapshot.enqueue({ ...row(5), ref: requests[1].ref, generation: 1 })).toBe(true);
    expect(snapshot.pageEnd({
      ref: requests[1].ref, channel_id: 'c0', generation: 1,
      rows: 1, scan_low_seq: 4, scan_high_seq: 5, next_before_seq: 4, has_older: true,
    })).toBe(true);
    await expect(replacement).resolves.toMatchObject({ kind: 'satisfied' });
    runtime.destroy();
  });

  it('keeps aggregate demand pending across failure plus success and clears prior error on success', async () => {
    const { requests, runtime, snapshot } = await attachedRuntime();
    const failed = snapshot.loadHistory('c0', {
      beforeSeq: 3, limit: 1, urgency: 'blocking', intent: 'scroll-history',
    });
    const successful = snapshot.loadHistory('c0', {
      beforeSeq: 6, limit: 1, urgency: 'blocking', intent: 'scroll-history',
    });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(snapshot.pageEnd({
      ref: requests[0].ref, channel_id: 'c0', generation: 1,
      error_code: 'offline', error_detail: 'temporary offline',
    })).toBe(true);
    await expect(failed).resolves.toMatchObject({ kind: 'failed' });
    expect(snapshot.historyFor('c0')).toMatchObject({
      loading: true, historyDemand: { phase: 'pending' },
    });

    expect(snapshot.enqueue({ ...row(5), ref: requests[1].ref, generation: 1 })).toBe(true);
    expect(snapshot.pageEnd({
      ref: requests[1].ref, channel_id: 'c0', generation: 1,
      rows: 1, scan_low_seq: 4, scan_high_seq: 5, next_before_seq: 4, has_older: true,
    })).toBe(true);
    await expect(successful).resolves.toMatchObject({ kind: 'satisfied' });
    expect(snapshot.historyFor('c0')).toMatchObject({
      loading: false, historyDemand: { phase: 'idle', error: '' },
    });
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

  it('aborts the physical operation when its last waiter leaves', async () => {
    const { requests, wireRef, runtime, snapshot } = await attachedRuntime();
    const controller = new AbortController();
    const pending = snapshot.loadHistory('c0', {
      beforeSeq: 3, limit: 1, urgency: 'blocking', signal: controller.signal,
    });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    controller.abort('last waiter retired');
    await expect(pending).resolves.toMatchObject({ kind: 'cancelled', reason: 'aborted' });
    await vi.waitFor(() => expect(wireRef.current.cancelHistory).toHaveBeenCalledTimes(1));
    expect(snapshot.historyFor('c0')).toMatchObject({
      loading: false, foregroundLoading: false, backgroundLoading: false,
      historyDemand: { phase: 'idle' },
    });
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

  it('rejects an old ref after same-generation attach replacement', async () => {
    const { requests, runtime, snapshot } = await attachedRuntime();
    const pending = snapshot.loadHistory('c0', { beforeSeq: 3, limit: 1, urgency: 'blocking' });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await snapshot.setHistoryGrants([
      { channel_id: 'c0', head_seq: 2, has_rows: true },
    ], { generation: 1, boot: 'physical-operation-boot', focus: 'c0' });
    await expect(pending).resolves.toMatchObject({ kind: 'cancelled', reason: 'stale-generation' });
    expect(snapshot.enqueue({ ...row(2), ref: requests[0].ref, generation: 1 })).toBe(false);
    expect(snapshot.pageEnd({
      ref: requests[0].ref, channel_id: 'c0', generation: 1,
      rows: 1, scan_low_seq: 1, scan_high_seq: 2, next_before_seq: 1, has_older: true,
    })).toBe(false);
    expect(snapshot.stateFor('c0')?.rows.size).toBe(0);
    runtime.destroy();
  });

  it('ignores a late forbidden probe from a replaced physical authority', async () => {
    const { wireRef, runtime, snapshot } = await attachedRuntime();
    let rejectProbe;
    wireRef.current.channelMeta = vi.fn(() => new Promise((_, reject) => {
      rejectProbe = reject;
    }));
    const pending = snapshot.refreshChannel('c0');
    await vi.waitFor(() => expect(wireRef.current.channelMeta).toHaveBeenCalledOnce());

    await snapshot.setHistoryGrants([
      { channel_id: 'c0', head_seq: 2, has_rows: true },
    ], { generation: 1, boot: 'physical-operation-boot', focus: 'c0' });
    rejectProbe(Object.assign(new Error('old forbidden'), { code: 'forbidden' }));

    await expect(pending).resolves.toBe(false);
    expect(snapshot.historyFor('c0')).toMatchObject({
      attached: true, messageCurrent: true, generation: 1,
    });
    runtime.destroy();
  });

});
