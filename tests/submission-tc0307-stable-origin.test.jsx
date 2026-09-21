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

  it('does not cross the wire when the SendLease dies before the origin patch', async () => {
    let unmount;
    const prepareSubmit = vi.fn((frame) => stampOrigin(frame, 's-mock-patch'));
    const submit = vi.fn().mockResolvedValue({ message_id: 'tc0307-patch-stale' });
    const transport = { prepareSubmit, submit };
    const harness = runtimeHarness({ transport, principalId: 'tc0307-patch-stale-root' });
    const store = harness.store;
    const patch = vi.fn(async (...args) => {
      if (args[3]?.frame) unmount();
      return store.patch(...args);
    });
    harness.outboxFactory = () => ({ ...store, patch });
    const hook = renderHook(() => useComposerSubmissionRuntime(harness));
    unmount = hook.unmount;
    await waitFor(() => expect(hook.result.current.pending).toEqual([]));

    await act(async () => {
      await hook.result.current.send({
        messageId: 'tc0307-patch-stale',
        text: 'patch lease fence',
        msgType: 'agent.ask',
        audience: ['agent:worker:1'],
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(prepareSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(
      harness.principalId,
      'tc0307-patch-stale',
      ['transmitting'],
      expect.objectContaining({ frame: expect.any(Object) }),
      expect.objectContaining({ leaseGuard: expect.any(Function) }),
    ));
    expect(submit).not.toHaveBeenCalled();
  });
});
