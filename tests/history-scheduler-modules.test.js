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

  it('rejects a network page whose receipt belongs to another generation or channel', async () => {
    const requestPage = vi.fn(() => {
      const receipt = Promise.resolve({ accepted: true, generation: 8, channel_id: 'other', ref: 'bad' });
      receipt.ref = 'bad';
      return receipt;
    });
    const adapters = createHistorySourceAdapters({
      requestPage,
      cancelPage: vi.fn(async () => {}),
      readCache: vi.fn(async () => ({ rows: [], nextBeforeSeq: 1 })),
      registerNetwork: vi.fn(),
    });
    const batch = {
      source: 'network', channelId: 'c0', beforeSeq: 7, limit: 3, byteLimit: 100,
      generation: 8, purpose: 'user-demand', priority: 'foreground', intent: 'scroll-history',
      urgency: 'interactive', rangeKind: 'backfill',
    };
    adapters.prepare(batch);
    await expect(adapters.execute(batch)).rejects.toThrow('回执不匹配');
    expect(adapters.status(batch)).toBe('failed');
  });

  it('accepts a network page only when its declared scan and row ranges are contiguous', async () => {
    let registered;
    const requestPage = vi.fn(() => {
      const receipt = Promise.resolve({ accepted: true, generation: 3, channel_id: 'c0', ref: 'page-3' });
      receipt.ref = 'page-3';
      return receipt;
    });
    const adapters = createHistorySourceAdapters({
      requestPage,
      cancelPage: vi.fn(async () => {}),
      readCache: vi.fn(async () => ({ rows: [], nextBeforeSeq: 1 })),
      registerNetwork: (batch) => { registered = batch; },
    });
    const batch = {
      source: 'network', channelId: 'c0', beforeSeq: 7, limit: 3, byteLimit: 100,
      generation: 3, purpose: 'user-demand', priority: 'foreground', intent: 'scroll-history',
      urgency: 'interactive', rangeKind: 'backfill',
    };
    adapters.prepare(batch);
    const execution = adapters.execute(batch);
    await vi.waitFor(() => expect(registered?.ref).toBe('page-3'));
    const row = { channel_id: 'c0', seq: 5, envelope: { id: 'm5' } };
    expect(adapters.appendRow(registered, row)).toBe(true);
    adapters.finish(registered, {
      generation: 3, channel_id: 'c0', rows: 1,
      scan_high_seq: 6, scan_low_seq: 4, next_before_seq: 4, has_older: true,
    });
    const result = await execution;
    expect(() => adapters.validate(batch, result, result.rows)).not.toThrow();
    expect(() => adapters.validate(batch, { ...result, scan_high_seq: 5 }, result.rows))
      .toThrow('scan_high');
    expect(() => adapters.validate(batch, { ...result, scan_low_seq: 3 }, result.rows))
      .toThrow('scan_low');
  });

  it('validates cache pages against the same before cursor without inventing an EOF', async () => {
    const adapters = createHistorySourceAdapters({
      requestPage: vi.fn(),
      cancelPage: vi.fn(async () => {}),
      readCache: vi.fn(async () => ({
        rows: [{ channel_id: 'c0', seq: 4, envelope: { id: 'm4' } }],
        nextBeforeSeq: 4,
      })),
      registerNetwork: vi.fn(),
    });
    const batch = {
      source: 'indexeddb', channelId: 'c0', beforeSeq: 7, limit: 3, byteLimit: 100,
      generation: 1, purpose: 'initial-tail', priority: 'foreground', intent: 'initial-view',
      urgency: 'blocking', rangeKind: 'backfill',
    };
    adapters.prepare(batch);
    const result = await adapters.execute(batch);
    expect(() => adapters.validate(batch, result, result.rows)).not.toThrow();
    expect(() => adapters.validate(batch, { nextBeforeSeq: 7 }, result.rows))
      .toThrow('cursor 未前进');
    expect(() => adapters.validate(batch, { nextBeforeSeq: 4 }, [{ seq: 8 }]))
      .toThrow('扫描区间外');
  });

  it('cancels an in-flight network page exactly once and ignores late rows', async () => {
    let resolveReceipt;
    let registered;
    const requestPage = vi.fn(() => {
      const receipt = new Promise((resolve) => { resolveReceipt = resolve; });
      receipt.ref = 'cancel-me';
      return receipt;
    });
    const cancelPage = vi.fn(async () => {});
    const adapters = createHistorySourceAdapters({
      requestPage, cancelPage,
      readCache: vi.fn(async () => ({ rows: [], nextBeforeSeq: 1 })),
      registerNetwork: (batch) => { registered = batch; },
    });
    const batch = {
      source: 'network', channelId: 'c0', beforeSeq: 4, limit: 2, byteLimit: 100,
      generation: 1, purpose: 'user-demand', priority: 'foreground', intent: 'scroll-history',
      urgency: 'interactive', rangeKind: 'backfill',
    };
    adapters.prepare(batch);
    const execution = adapters.execute(batch);
    await vi.waitFor(() => expect(requestPage).toHaveBeenCalledOnce());
    expect(adapters.phase(batch)).toBe('network-receipt');
    await adapters.cancel(batch, 'owner replaced');
    await expect(execution).rejects.toMatchObject({ code: 'history_cancelled' });
    expect(cancelPage).toHaveBeenCalledWith('c0', 'cancel-me', 1);
    expect(adapters.status(batch)).toBe('cancelled');
    expect(adapters.appendRow(registered || batch, { channel_id: 'c0', seq: 3, envelope: { id: 'late' } }))
      .toBe(false);
    resolveReceipt?.({ accepted: true, generation: 1, channel_id: 'c0', ref: 'cancel-me' });
  });

  it('does not reopen a terminal source operation when a late page end arrives', async () => {
    const adapters = createHistorySourceAdapters({
      requestPage: vi.fn(),
      cancelPage: vi.fn(async () => {}),
      readCache: vi.fn(async () => ({ rows: [], nextBeforeSeq: 1 })),
      registerNetwork: vi.fn(),
    });
    const batch = {
      source: 'indexeddb', channelId: 'c0', beforeSeq: 4, limit: 2, byteLimit: 100,
      generation: 1, purpose: 'initial-tail', priority: 'foreground', intent: 'initial-view',
      urgency: 'blocking', rangeKind: 'backfill',
    };
    adapters.prepare(batch);
    expect(await adapters.execute(batch)).toMatchObject({ rows: [], nextBeforeSeq: 1 });
    adapters.complete(batch);
    expect(adapters.finish(batch, { rows: 0, nextBeforeSeq: 1 })).toBe(false);
    expect(adapters.appendRow(batch, { channel_id: 'c0', seq: 3, envelope: { id: 'late' } })).toBe(false);
    expect(adapters.status(batch)).toBe('completed');
  });
});
