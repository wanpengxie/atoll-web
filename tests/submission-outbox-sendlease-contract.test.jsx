// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useComposerSubmissionRuntime } from '../src/ui/composer/useComposerSubmissionRuntime.js';
import { createOutboxStore } from '../src/model/outbox-store.js';

let databaseSerial = 0;
const liveStores = new Set();
const databaseName = () => `submission-send-lease-${++databaseSerial}-${Date.now()}`;

function memberAccess({ relationship = 'member', existence = 'present', runtime = 'open', unavailable = false, authorityEpoch = 1 } = {}) {
  return { relationship, existence, runtime, unavailable, authorityEpoch };
}

function frame(messageId, text = messageId) {
  return {
    id: messageId,
    channel_id: 'c0',
    msg_type: 'agent.ask',
    kind: 'request',
    payload: { text },
    audience: ['agent:worker:1'],
    visibility: 'public',
  };
}

function row(messageId, state = 'uncertain') {
  return {
    key: messageId,
    messageId,
    channelId: 'c0',
    state,
    frame: frame(messageId),
    createdAt: 1,
    updatedAt: 1,
    error: null,
  };
}

function runtimeHarness({ wireState = 'reconnecting', submit = vi.fn(), access = memberAccess(), principalId = `send-lease-root-${databaseSerial + 1}` } = {}) {
  const wireRef = { current: wireState === 'open' ? { submit } : null };
  const accessRef = { current: { state: () => access } };
  const store = createOutboxStore({ databaseName: databaseName() });
  liveStores.add(store);
  return {
    activeChannelId: 'c0',
    principalId,
    producerOwnerToken: `owner-${principalId}`,
    wireState,
    wireRef,
    accessRef,
    onError: vi.fn(),
    onNotice: vi.fn(),
    onFeedChanged: vi.fn(),
    onAccessChanged: vi.fn(),
    outboxFactory: () => store,
    store,
  };
}

function settlementBarrier(store) {
  let release;
  let started;
  const waiting = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { started = resolve; });
  let blocked = true;
  return {
    store: {
      ...store,
      async patch(...args) {
        if (blocked && args[3]?.state === 'rejected') {
          blocked = false;
          started();
          await waiting;
        }
        return store.patch(...args);
      },
    },
    entered,
    release,
  };
}

afterEach(() => {
  for (const store of liveStores) store.close();
  liveStores.clear();
  vi.restoreAllMocks();
});

describe('Composer SendLease failure contracts', () => {
  it('keeps a restored uncertain row and correlation when an old rejection follows revoke/regrant', async () => {
    let access = memberAccess();
    let rejectReceipt;
    const receipt = new Promise((resolve, reject) => { rejectReceipt = reject; });
    const submit = vi.fn(() => receipt);
    const harness = runtimeHarness({ wireState: 'open', submit, principalId: 'send-lease-restored-root' });
    harness.accessRef.current.state = () => access;
    await harness.store.putMany(harness.principalId, [row('restored-uncertain')]);

    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(harness));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.pending[0]).toMatchObject({
      messageId: 'restored-uncertain', state: 'transmitting',
    }));

    // A new Composer correlation reuses the durable id while the restored
    // attempt is in flight. The old receipt must not forget that new intent.
    await act(async () => {
      await result.current.send({
        messageId: 'restored-uncertain', text: 'replacement', msgType: 'agent.ask',
        audience: ['agent:worker:1'],
      });
    });
    expect(result.current.pending[0]).toMatchObject({ messageId: 'restored-uncertain', state: 'queued' });

    access = memberAccess({ relationship: 'denied', authorityEpoch: 2 });
    access = memberAccess({ authorityEpoch: 3 });
    rejectReceipt(Object.assign(new Error('forbidden after stale attempt'), { code: 'forbidden' }));

    await waitFor(() => expect(result.current.pending[0]).toMatchObject({
      messageId: 'restored-uncertain', state: 'queued',
    }));
    expect(result.current.submissionCorrelationPort.pending).toEqual([
      { channelId: 'c0', messageId: 'restored-uncertain' },
    ]);
    expect((await harness.store.restore(harness.principalId))[0]).toMatchObject({
      messageId: 'restored-uncertain', state: 'queued',
    });
    unmount();
  });

  it('makes a transmitting callback after revoke/regrant a no-op when a new correlation owns the entry', async () => {
    let access = memberAccess();
    let releaseTransmitting;
    const transmittingBarrier = new Promise((resolve) => { releaseTransmitting = resolve; });
    const submit = vi.fn().mockResolvedValue({ message_id: 'stale-transmitting' });
    const harness = runtimeHarness({ wireState: 'reconnecting', submit, principalId: 'send-lease-regrant-root' });
    harness.accessRef.current.state = () => access;
    const store = harness.store;
    const gatedStore = {
      ...store,
      async patch(...args) {
        const next = await store.patch(...args);
        if (args[3]?.state === 'transmitting' && next) await transmittingBarrier;
        return next;
      },
    };
    harness.outboxFactory = () => gatedStore;
    const { result, rerender, unmount } = renderHook(
      ({ wireState }) => useComposerSubmissionRuntime({ ...harness, wireState }),
      { initialProps: { wireState: 'reconnecting' } },
    );
    await waitFor(() => expect(result.current.pending).toEqual([]));
    await act(async () => {
      await result.current.send({
        messageId: 'stale-transmitting', text: 'old', msgType: 'agent.ask',
        audience: ['agent:worker:1'],
      });
    });

    harness.wireRef.current = { submit };
    rerender({ wireState: 'open' });
    await waitFor(async () => expect(await store.restore(harness.principalId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageId: 'stale-transmitting', state: 'transmitting' }),
    ])));

    access = memberAccess({ relationship: 'denied', authorityEpoch: 2 });
    access = memberAccess({ authorityEpoch: 3 });
    await act(async () => {
      await result.current.send({
        messageId: 'stale-transmitting', text: 'new correlation', msgType: 'agent.ask',
        audience: ['agent:worker:1'],
      });
    });
    expect(result.current.submissionCorrelationPort.pending).toEqual([
      { channelId: 'c0', messageId: 'stale-transmitting' },
    ]);

    releaseTransmitting();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(submit).not.toHaveBeenCalled();
    expect(result.current.submissionCorrelationPort.pending).toEqual([
      { channelId: 'c0', messageId: 'stale-transmitting' },
    ]);
    expect((await store.restore(harness.principalId))[0]).toMatchObject({
      messageId: 'stale-transmitting', state: 'queued',
    });
    unmount();
  });

  it('returns to queued for same-lease unavailability before the wire boundary', async () => {
    let access = memberAccess();
    let releaseTransmitting;
    const transmittingBarrier = new Promise((resolve) => { releaseTransmitting = resolve; });
    const submit = vi.fn().mockResolvedValue({ message_id: 'same-lease-unavailable' });
    const harness = runtimeHarness({ wireState: 'reconnecting', submit, principalId: 'send-lease-unavailable-root' });
    harness.accessRef.current.state = () => access;
    const store = harness.store;
    const gatedStore = {
      ...store,
      async patch(...args) {
        const next = await store.patch(...args);
        if (args[3]?.state === 'transmitting' && next) await transmittingBarrier;
        return next;
      },
    };
    harness.outboxFactory = () => gatedStore;
    const { result, rerender, unmount } = renderHook(
      ({ wireState }) => useComposerSubmissionRuntime({ ...harness, wireState }),
      { initialProps: { wireState: 'reconnecting' } },
    );
    await waitFor(() => expect(result.current.pending).toEqual([]));
    await act(async () => {
      await result.current.send({
        messageId: 'same-lease-unavailable', text: 'wait', msgType: 'agent.ask',
        audience: ['agent:worker:1'],
      });
    });
    harness.wireRef.current = { submit };
    rerender({ wireState: 'open' });
    await waitFor(async () => expect(await store.restore(harness.principalId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageId: 'same-lease-unavailable', state: 'transmitting' }),
    ])));

    access = memberAccess({ runtime: 'closed', unavailable: true, authorityEpoch: 2 });
    releaseTransmitting();

    await waitFor(() => expect(result.current.pending[0]).toMatchObject({
      messageId: 'same-lease-unavailable', state: 'queued', error: { code: 'channel_unavailable' },
    }));
    expect(submit).not.toHaveBeenCalled();
    expect(result.current.submissionCorrelationPort.pending).toEqual([
      { channelId: 'c0', messageId: 'same-lease-unavailable' },
    ]);
    unmount();
  });

  it('keeps a wire-started restored receipt after access revoke', async () => {
    let access = memberAccess();
    let resolveReceipt;
    const receipt = new Promise((resolve) => { resolveReceipt = resolve; });
    const submit = vi.fn(() => receipt);
    const harness = runtimeHarness({ wireState: 'open', submit, principalId: 'send-lease-wire-started-root' });
    harness.accessRef.current.state = () => access;
    await harness.store.putMany(harness.principalId, [row('wire-started-restored')]);
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(harness));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));

    access = memberAccess({ relationship: 'denied', authorityEpoch: 2 });
    resolveReceipt({ message_id: 'wire-started-restored' });
    await waitFor(() => expect(result.current.pending[0]).toMatchObject({
      messageId: 'wire-started-restored', state: 'accepted',
    }));
    expect(result.current.submissionCorrelationPort.pending).toEqual([
      { channelId: 'c0', messageId: 'wire-started-restored' },
    ]);
    expect(result.current.submissionCorrelationPort.owns({
      channelId: 'c0', messageId: 'wire-started-restored',
    })).toBe(true);
    unmount();
  });

  it('does not reject or forget when access changes while prewire settlement waits', async () => {
    let access = memberAccess();
    const harness = runtimeHarness({ wireState: 'reconnecting', principalId: 'send-lease-settle-access-root' });
    harness.accessRef.current.state = () => access;
    const barrier = settlementBarrier(harness.store);
    harness.outboxFactory = () => barrier.store;
    const submit = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ wireState }) => useComposerSubmissionRuntime({ ...harness, wireState }),
      { initialProps: { wireState: 'reconnecting' } },
    );
    await act(async () => {
      await result.current.send({
        messageId: 'settle-access-change', text: 'access', msgType: 'agent.ask',
        audience: ['agent:worker:1'],
      });
    });
    access = memberAccess({ relationship: 'denied', authorityEpoch: 2 });
    harness.wireRef.current = { submit };
    await act(async () => { rerender({ wireState: 'open' }); });
    await barrier.entered;

    access = memberAccess({ authorityEpoch: 3 });
    await act(async () => {
      barrier.release();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await waitFor(() => expect(result.current.pending[0]).toMatchObject({
      messageId: 'settle-access-change', state: 'queued',
    }));
    expect((await harness.store.restore(harness.principalId))[0]).toMatchObject({
      messageId: 'settle-access-change', state: 'queued',
    });
    expect(result.current.submissionCorrelationPort.pending).toEqual([
      { channelId: 'c0', messageId: 'settle-access-change' },
    ]);
    expect(submit).not.toHaveBeenCalled();
    expect(harness.onError).not.toHaveBeenCalled();
    unmount();
  });

  it('does not settle when world changes while prewire settlement waits', async () => {
    let access = memberAccess();
    const harness = runtimeHarness({ wireState: 'reconnecting', principalId: 'send-lease-settle-world-root' });
    harness.accessRef.current.state = () => access;
    const barrier = settlementBarrier(harness.store);
    harness.outboxFactory = () => barrier.store;
    const submit = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ wireState, serverWorld }) => useComposerSubmissionRuntime({ ...harness, wireState, serverWorld }),
      { initialProps: { wireState: 'reconnecting', serverWorld: 'world-a' } },
    );
    await act(async () => {
      await result.current.send({
        messageId: 'settle-world-change', text: 'world', msgType: 'agent.ask',
        audience: ['agent:worker:1'],
      });
    });
    access = memberAccess({ relationship: 'denied', authorityEpoch: 2 });
    harness.wireRef.current = { submit };
    await act(async () => { rerender({ wireState: 'open', serverWorld: 'world-a' }); });
    await barrier.entered;

    await act(async () => { rerender({ wireState: 'open', serverWorld: 'world-b' }); });
    await act(async () => {
      barrier.release();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await waitFor(() => expect(result.current.pending[0]).toMatchObject({
      messageId: 'settle-world-change', state: 'queued',
    }));
    expect((await harness.store.restore(harness.principalId))[0]).toMatchObject({
      messageId: 'settle-world-change', state: 'queued',
    });
    expect(result.current.submissionCorrelationPort.pending).toEqual([
      { channelId: 'c0', messageId: 'settle-world-change' },
    ]);
    expect(submit).not.toHaveBeenCalled();
    expect(harness.onError).not.toHaveBeenCalled();
    unmount();
  });

  it('does not settle when transport changes while prewire settlement waits', async () => {
    let access = memberAccess();
    const harness = runtimeHarness({ wireState: 'reconnecting', principalId: 'send-lease-settle-transport-root' });
    harness.accessRef.current.state = () => access;
    const barrier = settlementBarrier(harness.store);
    harness.outboxFactory = () => barrier.store;
    const firstSubmit = vi.fn();
    const secondSubmit = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ wireState }) => useComposerSubmissionRuntime({ ...harness, wireState }),
      { initialProps: { wireState: 'reconnecting' } },
    );
    await act(async () => {
      await result.current.send({
        messageId: 'settle-transport-change', text: 'transport', msgType: 'agent.ask',
        audience: ['agent:worker:1'],
      });
    });
    access = memberAccess({ relationship: 'denied', authorityEpoch: 2 });
    harness.wireRef.current = { submit: firstSubmit };
    await act(async () => { rerender({ wireState: 'open' }); });
    await barrier.entered;

    harness.wireRef.current = { submit: secondSubmit };
    await act(async () => {
      barrier.release();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await waitFor(() => expect(result.current.pending[0]).toMatchObject({
      messageId: 'settle-transport-change', state: 'queued',
    }));
    expect((await harness.store.restore(harness.principalId))[0]).toMatchObject({
      messageId: 'settle-transport-change', state: 'queued',
    });
    expect(result.current.submissionCorrelationPort.pending).toEqual([
      { channelId: 'c0', messageId: 'settle-transport-change' },
    ]);
    expect(firstSubmit).not.toHaveBeenCalled();
    expect(secondSubmit).not.toHaveBeenCalled();
    expect(harness.onError).not.toHaveBeenCalled();
    unmount();
  });
});
