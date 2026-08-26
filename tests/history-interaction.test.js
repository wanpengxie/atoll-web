import { describe, expect, it, vi } from 'vitest';
import { createTopIntentController, HISTORY_OPERATION, loadUntilVisible } from '../src/model/history-interaction.js';

describe('loadUntilVisible', () => {
  it('crosses any number of zero-visible segments under one operation', async () => {
    let firstVisibleSeq = 1_000;
    let calls = 0;
    const result = await loadUntilVisible({
      anchorSeq: 1_000,
      next: async () => {
        calls += 1;
        if (calls === 20) firstVisibleSeq = 397;
        return { kind: 'segment', rows: 32 };
      },
      project: () => ({ firstVisibleSeq }),
    });
    expect(result).toMatchObject({ kind: HISTORY_OPERATION.satisfied, firstVisibleSeq: 397 });
    expect(calls).toBe(20);
  });

  it('distinguishes authoritative exhaustion from an invisible segment', async () => {
    const next = vi.fn()
      .mockResolvedValueOnce({ kind: 'segment', rows: 0 })
      .mockResolvedValueOnce({ kind: HISTORY_OPERATION.exhausted });
    const result = await loadUntilVisible({ anchorSeq: 10, next, project: () => ({ firstVisibleSeq: 10 }) });
    expect(result.kind).toBe(HISTORY_OPERATION.exhausted);
    expect(next).toHaveBeenCalledTimes(2);
  });
});

describe('top intent controller', () => {
  it('joins duplicate top callbacks and cancels only on a real state transition', async () => {
    let finish;
    const load = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const controller = createTopIntentController({ load });
    controller.setView('c0:mine');
    const first = controller.enterTop({ anchorSeq: 100 });
    const duplicate = controller.enterTop({ anchorSeq: 100 });
    expect(duplicate).toBe(first);
    expect(load).toHaveBeenCalledOnce();
    finish({ kind: HISTORY_OPERATION.satisfied, firstVisibleSeq: 50 });
    await expect(first).resolves.toMatchObject({ kind: HISTORY_OPERATION.satisfied });

    controller.leaveTop();
    controller.enterTop({ anchorSeq: 50 });
    expect(load).toHaveBeenCalledTimes(2);
    controller.leaveTop();
    expect(controller.snapshot().active).toBe(false);
  });

  it('ignores a cancelled epoch that settles after its replacement', async () => {
    const finishes = [];
    const load = vi.fn(() => new Promise((resolve) => finishes.push(resolve)));
    const controller = createTopIntentController({ load });
    controller.setView('c0:mine');
    const stale = controller.enterTop({ anchorSeq: 100 });
    controller.setView('c0:all');
    const current = controller.enterTop({ anchorSeq: 100 });
    finishes[0]({ kind: HISTORY_OPERATION.cancelled });
    await stale;
    expect(controller.snapshot()).toMatchObject({ viewKey: 'c0:all', active: true, consumed: false });
    finishes[1]({ kind: HISTORY_OPERATION.satisfied, firstVisibleSeq: 50 });
    await current;
    expect(controller.snapshot()).toMatchObject({ viewKey: 'c0:all', active: false, consumed: true });
  });

  it('closes the epoch as failed when the loader throws synchronously', async () => {
    const controller = createTopIntentController({ load: () => { throw new Error('boom'); } });
    controller.setView('c0:mine');
    await expect(controller.enterTop({ anchorSeq: 100 })).resolves.toMatchObject({
      kind: HISTORY_OPERATION.failed,
      error: expect.objectContaining({ message: 'boom' }),
    });
    expect(controller.snapshot()).toMatchObject({ active: false, consumed: true });
  });
});
