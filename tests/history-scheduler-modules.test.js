import { describe, expect, it, vi } from 'vitest';
import { createHistoryBoundedExecutor } from '../src/model/history-bounded-executor.js';
import { createHistorySourceAdapters } from '../src/model/history-source-adapters.js';

describe('history scheduler modules', () => {
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
