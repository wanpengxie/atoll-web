// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useComposerSubmissionRuntime } from '../src/ui/composer/useComposerSubmissionRuntime.js';
import { createOutboxStore } from '../src/model/outbox-store.js';

let databaseSerial = 0;
const liveStores = new Set();
const databaseName = () => `submission-tc0307-${++databaseSerial}-${Date.now()}`;

function memberAccess() {
  return { relationship: 'member', existence: 'present', runtime: 'open', unavailable: false };
}

function runtimeHarness({ wireState = 'open', transport, principalId = `tc0307-${databaseSerial + 1}` } = {}) {
  const wireRef = { current: wireState === 'open' ? transport : null };
  const store = createOutboxStore({ databaseName: databaseName() });
  liveStores.add(store);
  return {
    activeChannelId: 'c0',
    principalId,
    producerOwnerToken: `owner-${principalId}`,
    wireState,
    wireRef,
    accessRef: { current: { state: memberAccess } },
    onError: vi.fn(),
    onNotice: vi.fn(),
    onFeedChanged: vi.fn(),
    onAccessChanged: vi.fn(),
    outboxFactory: () => store,
    store,
  };
}

function stampOrigin(frame, session) {
  if (frame?.payload?.origin) return frame;
  return {
    ...frame,
    payload: { ...frame.payload, origin: { session } },
  };
}

afterEach(() => {
  for (const store of liveStores) store.close();
  liveStores.clear();
  vi.restoreAllMocks();
});

describe('TC0307 Composer stable submission origin', () => {
  it('persists the first session origin so a receipt-drop retry is one equivalent submission', async () => {
    let session = 's-mock-1';
    const wireFrames = [];
    const prepareSubmit = vi.fn((frame) => stampOrigin(frame, session));
    const submit = vi.fn((frame) => {
      const wireFrame = stampOrigin(frame, session);
      wireFrames.push(JSON.parse(JSON.stringify(wireFrame)));
      if (wireFrames.length === 1) {
        return Promise.reject(Object.assign(new Error('receipt dropped'), { code: 'closed' }));
      }
      if (JSON.stringify(wireFrame) !== JSON.stringify(wireFrames[0])) {
        return Promise.reject(Object.assign(new Error('same id with different origin'), {
          code: 'idempotency_conflict',
        }));
      }
      return Promise.resolve({ message_id: 'tc0307-origin-stable' });
    });
    const transport = { prepareSubmit, submit };
    const harness = runtimeHarness({ transport, principalId: 'tc0307-origin-stable-root' });
    const { result, rerender, unmount } = renderHook(
      ({ wireState }) => useComposerSubmissionRuntime({ ...harness, wireState }),
      { initialProps: { wireState: 'open' } },
    );
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await act(async () => {
      await result.current.send({
        messageId: 'tc0307-origin-stable',
        text: 'retry with one origin',
        msgType: 'agent.ask',
        audience: ['agent:worker:1'],
      });
    });
    await waitFor(() => expect(result.current.pending[0]).toMatchObject({
      messageId: 'tc0307-origin-stable', state: 'uncertain',
    }));
    expect(wireFrames[0].payload.origin).toEqual({ session: 's-mock-1' });

    session = 's-mock-2';
    harness.wireRef.current = null;
    await act(async () => { rerender({ wireState: 'reconnecting' }); });
    harness.wireRef.current = transport;
    await act(async () => { rerender({ wireState: 'open' }); });

    await waitFor(() => expect(result.current.pending[0]).toMatchObject({
      messageId: 'tc0307-origin-stable', state: 'accepted',
    }));
    expect(harness.onNotice).toHaveBeenLastCalledWith('');
    expect(submit).toHaveBeenCalledTimes(2);
    expect(prepareSubmit).toHaveBeenCalledTimes(2);
    expect(wireFrames).toHaveLength(2);
    expect(wireFrames[1]).toEqual(wireFrames[0]);
    expect(wireFrames[1].payload.origin).toEqual({ session: 's-mock-1' });

    act(() => {
      expect(result.current.reconcileFeed(
        new Set(['tc0307-origin-stable']), new Set(), harness.producerOwnerToken,
      )).toBe(true);
    });
    await waitFor(() => expect(result.current.pending).toEqual([]));
    expect(harness.onFeedChanged).toHaveBeenCalledTimes(1);
    expect(wireFrames).toHaveLength(2);
    unmount();
  });

  it('does not cross the wire when the SendLease dies during prepareSubmit', async () => {
    let unmount;
    const prepareSubmit = vi.fn((frame) => {
      unmount();
      return stampOrigin(frame, 's-mock-prepare');
    });
    const submit = vi.fn().mockResolvedValue({ message_id: 'tc0307-prepare-stale' });
    const transport = { prepareSubmit, submit };
    const harness = runtimeHarness({ transport, principalId: 'tc0307-prepare-stale-root' });
    const hook = renderHook(() => useComposerSubmissionRuntime(harness));
    unmount = hook.unmount;
    await waitFor(() => expect(hook.result.current.pending).toEqual([]));

    await act(async () => {
      await hook.result.current.send({
        messageId: 'tc0307-prepare-stale',
        text: 'prepare lease fence',
        msgType: 'agent.ask',
        audience: ['agent:worker:1'],
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(prepareSubmit).toHaveBeenCalledTimes(1));
    expect(submit).not.toHaveBeenCalled();
  });

  it('does not let a stale receipt clear a newer uncertain notice', async () => {
    let releaseFirstReceipt;
    let submitCount = 0;
    const firstReceipt = new Promise((resolve) => { releaseFirstReceipt = resolve; });
    const submit = vi.fn(() => {
      submitCount += 1;
      if (submitCount === 1) return firstReceipt;
      return Promise.reject(Object.assign(new Error('receipt dropped'), { code: 'closed' }));
    });
    const harness = runtimeHarness({
      transport: { submit },
      principalId: 'tc0307-stale-receipt-root',
    });
    const hook = renderHook(() => useComposerSubmissionRuntime(harness));
    await waitFor(() => expect(hook.result.current.pending).toEqual([]));

    let firstSend;
    await act(async () => {
      firstSend = hook.result.current.send({
        messageId: 'tc0307-stale-receipt-old',
        text: 'first attempt',
        msgType: 'agent.ask',
        audience: ['agent:worker:1'],
      });
      await firstSend;
    });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));

    await act(async () => {
      await hook.result.current.send({
        messageId: 'tc0307-stale-receipt-new',
        text: 'replacement attempt',
        msgType: 'agent.ask',
        audience: ['agent:worker:1'],
      });
    });
    await waitFor(() => expect(harness.onNotice).toHaveBeenLastCalledWith(
      '发送结果待确认，正在通过重连账本核对。',
    ));
    expect(submit).toHaveBeenCalledTimes(2);

    await act(async () => {
      releaseFirstReceipt({ message_id: 'tc0307-stale-receipt-old' });
      await Promise.resolve();
    });
    expect(harness.onNotice).toHaveBeenLastCalledWith(
      '发送结果待确认，正在通过重连账本核对。',
    );
    await waitFor(async () => expect((await harness.store.restore(harness.principalId))
      .find((row) => row.messageId === 'tc0307-stale-receipt-old')).toMatchObject({ state: 'accepted' }));
    const restored = await harness.store.restore(harness.principalId);
    expect(restored).toHaveLength(2);
    expect(restored.find((row) => row.messageId === 'tc0307-stale-receipt-new')).toMatchObject({
      messageId: 'tc0307-stale-receipt-new',
      state: 'uncertain',
      frame: { payload: { text: 'replacement attempt' } },
    });
  });

  it('clears the bound uncertain notice when the feed lands the submission', async () => {
    const submit = vi.fn().mockRejectedValue(Object.assign(new Error('receipt dropped'), { code: 'closed' }));
    const harness = runtimeHarness({
      transport: { submit },
      principalId: 'tc0307-landed-notice-root',
    });
    const hook = renderHook(() => useComposerSubmissionRuntime(harness));
    await waitFor(() => expect(hook.result.current.pending).toEqual([]));

    await act(async () => {
      await hook.result.current.send({
        messageId: 'tc0307-landed-notice',
        text: 'landed after uncertain',
        msgType: 'agent.ask',
        audience: ['agent:worker:1'],
      });
    });
    await waitFor(() => expect(harness.onNotice).toHaveBeenLastCalledWith(
      '发送结果待确认，正在通过重连账本核对。',
    ));

    expect(hook.result.current.reconcileFeed(
      new Set(['tc0307-landed-notice']), new Set(), harness.producerOwnerToken,
    )).toBe(true);
    await waitFor(() => expect(hook.result.current.pending).toEqual([]));
    expect(harness.onNotice).toHaveBeenLastCalledWith('');
  });
});
