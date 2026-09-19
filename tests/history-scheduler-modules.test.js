import { describe, expect, it, vi } from 'vitest';
import { createHistoryBoundedExecutor } from '../src/model/history-bounded-executor.js';
import { reduceHistoryCandidates } from '../src/model/history-candidate-reducer.js';
import { createHistorySourceAdapters } from '../src/model/history-source-adapters.js';

function reducerInput(state) {
  return {
    states: [state],
    focus: 'c0',
    generation: 7,
    replicaEpoch: 2,
    localMetaEpoch: 3,
    localMetaReady: true,
    localSelectionPending: false,
    inflightByChannel: new Map(),
    now: 100,
    globalReservoirBytes: 0,
    reservedInflightBytes: 0,
    dispatchSerial: 4,
    dispatchWheelIndex: 0,
    maxBackgroundInflight: 1,
    transportStats: {
      indexeddb: { durationMs: 80, rowsPerMs: 1, bytesPerMs: 1_000, averageRowBytes: 100, rowLimit: 128 },
      network: { durationMs: 400, rowsPerMs: 1, bytesPerMs: 1_000, averageRowBytes: 100, rowLimit: 128 },
    },
    visibleOldestByChannel: new Map([['c0', 0]]),
    visibleNewestByChannel: new Map([['c0', 0]]),
    config: {
      maxInflight: 2,
      p1Channels: 3,
      p2Channels: 6,
      reservoirSize: 5_000,
      reservoirChannelBytes: 16 * 1024 * 1024,
      reservoirGlobalBytes: 64 * 1024 * 1024,
      batchBytes: 1024 * 1024,
      fairnessDispatches: 8,
      targets: {
        0: { rows: 256, bytes: 8 * 1024 * 1024, scanBudget: 384 },
        1: { rows: 256, bytes: 4 * 1024 * 1024, scanBudget: 256 },
        2: { rows: 128, bytes: 1024 * 1024, scanBudget: 128 },
      },
    },
  };
}

describe('history scheduler modules', () => {
  it('reduces one immutable observation into an obligation without mutating channel lifecycle', () => {
    const state = Object.freeze({
      id: 'c0', attachedGeneration: 7, remoteEligible: true,
      beforeSeq: 11, tailRefreshBeforeSeq: 0, cacheBypassBeforeSeq: 0,
      localMeta: null, hasRows: true, hasOlder: true, tailVisible: false,
      foregroundOwners: new Set(), foregroundWaiters: [], currentWaiters: new Set(),
      reservoir: new Map(), reservoirBytes: 0, retryAt: 0, projectionPending: false,
      completedPages: 0, warmScanned: 0, waitDispatches: 0,
      lastFocusOrder: 1, relatedUnreadOrder: 0, liveOrder: 0, activity: 0,
      stateLease: 9, blockedSource: null,
    });

    const first = reduceHistoryCandidates(reducerInput(state));
    const second = reduceHistoryCandidates(reducerInput(state));

    expect(first.selected).toMatchObject({
      id: '2:7:c0:5', channelId: 'c0', source: 'network',
      purpose: 'initial-tail', rangeKind: 'backfill', beforeSeq: 11, tier: 0,
    });
    expect(second.selected).toEqual(first.selected);
    expect(first.tiers.get('c0')).toBe(0);
    expect(state).not.toHaveProperty('tier');
  });

  it('bounds physical execution without knowing source or obligation state', async () => {
    let releaseFirst;
    const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
    const started = [];
    const executor = createHistoryBoundedExecutor({ concurrency: 1, timeoutMs: 1_000 });
    const first = executor.run(async () => { started.push('first'); await firstGate; }, { id: 'first' });
    const second = executor.run(async () => { started.push('second'); }, { id: 'second' });

    await vi.waitFor(() => expect(started).toEqual(['first']));
    expect(executor.snapshot()).toEqual({ running: 1, queued: 1 });
    releaseFirst();
    await Promise.all([first, second]);
    expect(started).toEqual(['first', 'second']);
  });

  it('settles queued executor jobs when the executor is cleared', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const executor = createHistoryBoundedExecutor({ concurrency: 1, timeoutMs: 1_000 });
    const running = executor.run(() => gate, { id: 'running' });
    const queued = executor.run(async () => {}, { id: 'queued' });
    await vi.waitFor(() => expect(executor.snapshot()).toEqual({ running: 1, queued: 1 }));
    executor.clear('replica reset');
    await expect(queued).rejects.toMatchObject({ code: 'history_cancelled' });
    release();
    await running;
  });

  it('keeps network adaptation to I/O and validation facts', async () => {
    const requestPage = vi.fn(() => {
      const receipt = Promise.resolve({ accepted: true, generation: 7, channel_id: 'c0' });
      receipt.ref = 'page-1';
      return receipt;
    });
    let registered;
    const adapters = createHistorySourceAdapters({
      requestPage,
      cancelPage: vi.fn(async () => {}),
      readCache: vi.fn(async () => ({ rows: [], nextBeforeSeq: 1 })),
      registerNetwork: (batch) => { registered = batch; },
    });
    const batch = {
      source: 'network', channelId: 'c0', beforeSeq: 11, limit: 10,
      byteLimit: 1_000, generation: 7, purpose: 'initial-tail',
      priority: 'foreground', intent: '', urgency: '', rangeKind: 'backfill',
    };
    adapters.prepare(batch);
    const execution = adapters.execute(batch);
    await vi.waitFor(() => expect(registered?.ref).toBe('page-1'));
    adapters.appendRow(registered, { channel_id: 'c0', seq: 10, envelope: { id: 'm10' } });
    adapters.finish(registered, {
      generation: 7, channel_id: 'c0', rows: 1,
      scan_high_seq: 10, scan_low_seq: 1, next_before_seq: 1, has_older: false,
    });
    const result = await execution;
    expect(() => adapters.validate(batch, result, result.rows)).not.toThrow();
    expect(result.rows).toHaveLength(1);
    expect(requestPage).toHaveBeenCalledOnce();
    expect(adapters.status(batch)).toBe('delivered');
    adapters.complete(batch);
    expect(adapters.status(batch)).toBe('completed');
  });

  it('gives cancellation and failure one terminal source status', async () => {
    const adapters = createHistorySourceAdapters({
      requestPage: vi.fn(() => { throw new Error('offline'); }),
      cancelPage: vi.fn(async () => {}),
      readCache: vi.fn(async () => ({ rows: [], nextBeforeSeq: 1 })),
      registerNetwork: vi.fn(),
    });
    const failed = { source: 'network', channelId: 'c0', beforeSeq: 2, generation: 1 };
    adapters.prepare(failed);
    await expect(adapters.execute(failed)).rejects.toThrow('offline');
    expect(adapters.status(failed)).toBe('failed');

    const cancelled = { source: 'indexeddb', channelId: 'c0', beforeSeq: 2, limit: 1, byteLimit: 100 };
    adapters.prepare(cancelled);
    const terminal = adapters.cancellation(cancelled);
    await adapters.cancel(cancelled, 'replica reset');
    await expect(terminal).rejects.toMatchObject({ code: 'history_cancelled' });
    expect(adapters.status(cancelled)).toBe('cancelled');
  });
});
