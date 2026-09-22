// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React, { Suspense, startTransition, useLayoutEffect } from 'react';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useComposerSubmissionRuntime } from '../src/ui/composer/useComposerSubmissionRuntime.js';
import { createOutboxStore } from '../src/model/outbox-store.js';

let databaseSerial = 0;
const databaseName = () => `submission-owner-${++databaseSerial}-${Date.now()}`;

function memberAccess({ relationship = 'member', existence = 'present', runtime = 'open', unavailable = false } = {}) {
  return { relationship, existence, runtime, unavailable };
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

function row(messageId, state = 'queued') {
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

function runtimeHarness({ wireState = 'reconnecting', submit = vi.fn(), access = memberAccess(), principalId = `root-${databaseSerial + 1}`, channelId = 'c0' } = {}) {
  const wireRef = { current: wireState === 'open' ? { submit } : null };
  const accessRef = { current: { state: () => access } };
  const store = createOutboxStore({ databaseName: databaseName() });
  const common = {
    activeChannelId: channelId,
    principalId,
    producerOwnerToken: `owner-${principalId}`,
    wireState,
    wireRef,
    accessRef,
    rosterRef: { current: { recordSubmission: vi.fn(), forgetSubmission: vi.fn() } },
    onError: vi.fn(),
    onNotice: vi.fn(),
    onFeedChanged: vi.fn(),
    onAccessChanged: vi.fn(),
    outboxFactory: () => store,
  };
  return { ...common, store };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('current submission owner: outbox-store + composer runtime', () => {
  it('restores an in-flight row as uncertain across a same-principal remount', async () => {
    const principalId = `remount-root-${databaseSerial + 1}`;
    const database = databaseName();
    const firstStore = createOutboxStore({ databaseName: database });
    await firstStore.putMany(principalId, [
      { ...row('remount-transmitting', 'transmitting'), leaseOwner: 'old-runtime', leaseUntil: Date.now() + 10_000 },
      { ...row('remount-rejected', 'rejected'), error: { code: 'forbidden', detail: '权限已撤销' } },
    ]);
    const base = {
      activeChannelId: 'c0',
      principalId,
      producerOwnerToken: `owner-${principalId}`,
      wireState: 'closed',
      wireRef: { current: null },
      accessRef: { current: { state: () => memberAccess() } },
      onError: vi.fn(),
      onNotice: vi.fn(),
      onFeedChanged: vi.fn(),
      onAccessChanged: vi.fn(),
    };
    const first = renderHook(() => useComposerSubmissionRuntime({
      ...base,
      outboxFactory: () => firstStore,
    }));
    await waitFor(() => expect(first.result.current.pending).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageId: 'remount-transmitting', state: 'uncertain' }),
      expect.objectContaining({ messageId: 'remount-rejected', state: 'rejected', error: expect.objectContaining({ code: 'forbidden' }) }),
    ])));
    first.unmount();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    const secondStore = createOutboxStore({ databaseName: database });
    const second = renderHook(() => useComposerSubmissionRuntime({
      ...base,
      outboxFactory: () => secondStore,
    }));
    await waitFor(() => expect(second.result.current.pending).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageId: 'remount-transmitting', state: 'uncertain' }),
      expect.objectContaining({ messageId: 'remount-rejected', state: 'rejected', error: expect.objectContaining({ code: 'forbidden' }) }),
    ])));
    expect(second.result.current.pending.find((item) => item.messageId === 'remount-transmitting')).not.toHaveProperty('state', 'accepted');
    expect((await secondStore.restore(principalId)).find((item) => item.messageId === 'remount-transmitting')).toMatchObject({ state: 'transmitting' });
    second.unmount();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  });

  it('does not publish transport authority from a suspended Composer candidate render', async () => {
    const submit = vi.fn().mockResolvedValue({ message_id: 'candidate-world-message' });
    const harness = runtimeHarness({ wireState: 'open', submit });
    let committedApi;
    let release;
    const suspended = new Promise((resolve) => { release = resolve; });

    function Subject({ wireState, block }) {
      const api = useComposerSubmissionRuntime({ ...harness, wireState });
      useLayoutEffect(() => { committedApi = api; });
      if (block) throw suspended;
      return <p>{wireState}</p>;
    }

    const view = render(
      <Suspense fallback={<p>candidate fallback</p>}>
        <Subject wireState="open" block={false} />
      </Suspense>,
    );
    await waitFor(() => expect(committedApi?.pending).toEqual([]));
    const stableCommittedSend = committedApi.send;

    await act(async () => {
      startTransition(() => view.rerender(
        <Suspense fallback={<p>candidate fallback</p>}>
          <Subject wireState="reconnecting" block />
        </Suspense>,
      ));
    });
    expect(document.body.textContent).toContain('open');
    expect(await harness.store.restore(harness.principalId)).toEqual([]);

    await act(async () => {
      await stableCommittedSend({
        messageId: 'candidate-world-message',
        text: 'use committed open authority',
        msgType: 'agent.ask',
        audience: ['agent:worker:1'],
      });
    });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(committedApi.pending[0]).toMatchObject({
      messageId: 'candidate-world-message', state: 'accepted',
    }));
    view.unmount();
    release();
    harness.store.close();
  });

  it('persists a stable queued message id and removes it only after a landed feed fact', async () => {
    const harness = runtimeHarness();
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(harness));
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await act(async () => {
      await result.current.send({ messageId: 'm1', text: 'offline', msgType: 'agent.ask', audience: ['agent:worker:1'] });
    });
    expect(result.current.pending[0]).toMatchObject({ messageId: 'm1', state: 'queued' });
    expect((await harness.store.restore(harness.principalId))[0]).toMatchObject({ messageId: 'm1', state: 'queued' });

    expect(result.current.reconcileFeed(new Set(['m1']), new Set(), harness.producerOwnerToken)).toBe(true);
    await waitFor(() => expect(result.current.pending).toEqual([]));
    await waitFor(async () => expect(await harness.store.restore(harness.principalId)).toEqual([]));
    unmount();
    harness.store.close();
  });

  it('exposes Composer-owned correlation state without delegating identity ownership to roster', async () => {
    const harness = runtimeHarness();
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(harness));
    await waitFor(() => expect(result.current.pending).toEqual([]));
    const port = result.current.submissionCorrelationPort;

    await act(async () => {
      await result.current.send({ messageId: 'correlation-1', text: 'offline', msgType: 'agent.ask', audience: ['agent:worker:1'] });
    });
    expect(result.current.submissionCorrelationPort).toBe(port);
    expect(port.pending).toEqual([{ channelId: 'c0', messageId: 'correlation-1' }]);
    expect(harness.rosterRef.current.recordSubmission).not.toHaveBeenCalled();

    expect(result.current.reconcileFeed(new Set(['correlation-1']), new Set(), harness.producerOwnerToken)).toBe(true);
    await waitFor(() => expect(result.current.pending).toEqual([]));
    expect(port.pending).toEqual([]);
    expect(port.landed).toEqual([{ channelId: 'c0', messageId: 'correlation-1' }]);
    expect(port.owns({ channelId: 'c0', messageId: 'correlation-1' })).toBe(true);
    expect(harness.rosterRef.current.forgetSubmission).not.toHaveBeenCalled();

    expect(port.forget({ channelId: 'c0', messageId: 'correlation-1' })).toBe(true);
    expect(port.owns({ channelId: 'c0', messageId: 'correlation-1' })).toBe(false);
    unmount();
    harness.store.close();
  });

  it('reads transport authority at execution time and keeps a disconnected send durable', async () => {
    const submit = vi.fn().mockResolvedValue({ message_id: 'm2' });
    const harness = runtimeHarness({ wireState: 'open', submit });
    const { result, rerender, unmount } = renderHook(({ wireState }) => useComposerSubmissionRuntime({ ...harness, wireState }), {
      initialProps: { wireState: 'open' },
    });
    await waitFor(() => expect(result.current.pending).toEqual([]));
    const stableSend = result.current.send;
    rerender({ wireState: 'reconnecting' });
    await act(async () => {
      await stableSend({ messageId: 'm2', text: 'wait', msgType: 'agent.ask', audience: ['agent:worker:1'] });
    });
    expect(submit).not.toHaveBeenCalled();
    expect(result.current.pending[0]).toMatchObject({ messageId: 'm2', state: 'queued' });
    unmount();
    harness.store.close();
  });

  it('keeps an accepted receipt visible until feed lands without retransmitting', async () => {
    let resolveReceipt;
    const submit = vi.fn(() => new Promise((resolve) => {
      resolveReceipt = resolve;
    }));
    const harness = runtimeHarness({ wireState: 'open', submit, principalId: 'receipt-before-feed-root' });
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(harness));
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await act(async () => {
      await result.current.send({ messageId: 'receipt-before-feed', text: 'receipt first', msgType: 'agent.ask', audience: ['agent:worker:1'] });
    });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    await waitFor(async () => expect((await harness.store.restore(harness.principalId))[0]).toMatchObject({
      messageId: 'receipt-before-feed', state: 'transmitting',
    }));

    await act(async () => { resolveReceipt({ message_id: 'receipt-before-feed' }); });
    await waitFor(() => expect(result.current.pending[0]).toMatchObject({
      messageId: 'receipt-before-feed', state: 'accepted',
    }));
    expect((await harness.store.restore(harness.principalId))[0]).toMatchObject({
      messageId: 'receipt-before-feed', state: 'accepted',
    });
    expect(submit).toHaveBeenCalledTimes(1);

    expect(result.current.reconcileFeed(
      new Set(['receipt-before-feed']), new Set(), harness.producerOwnerToken,
    )).toBe(true);
    await waitFor(() => expect(result.current.pending).toEqual([]));
    await waitFor(async () => expect(await harness.store.restore(harness.principalId)).toEqual([]));
    expect(submit).toHaveBeenCalledTimes(1);
    unmount();
    harness.store.close();
  });

  it('reconnects an uncertain id once despite duplicate open notifications', async () => {
    const firstSubmit = vi.fn().mockRejectedValue(Object.assign(new Error('closed'), { code: 'closed' }));
    let resolveRetry;
    const retrySubmit = vi.fn(() => new Promise((resolve) => {
      resolveRetry = resolve;
    }));
    const harness = runtimeHarness({
      wireState: 'open', submit: firstSubmit, principalId: 'uncertain-reconnect-root',
    });
    const { wireRef } = harness;
    const { result, rerender, unmount } = renderHook(
      ({ wireState }) => useComposerSubmissionRuntime({ ...harness, wireState }),
      { initialProps: { wireState: 'open' } },
    );
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await act(async () => {
      await result.current.send({ messageId: 'uncertain-reconnect', text: 'retry once', msgType: 'agent.ask', audience: ['agent:worker:1'] });
    });
    await waitFor(() => expect(result.current.pending[0]).toMatchObject({
      messageId: 'uncertain-reconnect', state: 'uncertain',
    }));
    expect(firstSubmit).toHaveBeenCalledTimes(1);

    wireRef.current = null;
    rerender({ wireState: 'reconnecting' });
    wireRef.current = { submit: retrySubmit };
    rerender({ wireState: 'open' });
    await waitFor(() => expect(retrySubmit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.pending[0]).toMatchObject({
      messageId: 'uncertain-reconnect', state: 'transmitting',
    }));

    // A second open notification receives a fresh transport object while the
    // first reconnect attempt is still in flight. It must not create a second
    // transmit for the same durable id.
    wireRef.current = null;
    rerender({ wireState: 'reconnecting' });
    wireRef.current = { submit: retrySubmit };
    rerender({ wireState: 'open' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(retrySubmit).toHaveBeenCalledTimes(1);

    await act(async () => { resolveRetry({ message_id: 'uncertain-reconnect' }); });
    await waitFor(() => expect(result.current.pending[0]).toMatchObject({
      messageId: 'uncertain-reconnect', state: 'accepted',
    }));
    expect(firstSubmit).toHaveBeenCalledTimes(1);
    expect(retrySubmit).toHaveBeenCalledTimes(1);
    unmount();
    harness.store.close();
  });

  it('refuses durable acceptance without confirmed membership and accepts after access changes', async () => {
    let access = memberAccess({ relationship: 'unknown' });
    const submit = vi.fn().mockResolvedValue({ message_id: 'm4' });
    const harness = runtimeHarness({ wireState: 'open', submit });
    harness.accessRef.current.state = () => access;
    const { result, rerender, unmount } = renderHook(({ accessVersion }) => useComposerSubmissionRuntime({ ...harness, accessVersion }), {
      initialProps: { accessVersion: 0 },
    });
    await waitFor(() => expect(result.current.pending).toEqual([]));
    await expect(act(async () => result.current.send({ messageId: 'm4', text: 'blocked', msgType: 'agent.ask', audience: ['agent:worker:1'] })))
      .rejects.toThrow();
    expect(result.current.pending).toEqual([]);
    access = memberAccess();
    rerender({ accessVersion: 1 });
    await act(async () => {
      await result.current.send({ messageId: 'm4', text: 'allowed', msgType: 'agent.ask', audience: ['agent:worker:1'] });
    });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    unmount();
    harness.store.close();
  });

  it('keeps an unavailable refusal queued and reuses its stable id after service recovery', async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('service unavailable'), { code: 'unavailable' }))
      .mockResolvedValue({ message_id: 'm-recover' });
    const harness = runtimeHarness({ wireState: 'open', submit });
    const { result, rerender, unmount } = renderHook(({ wireState }) => useComposerSubmissionRuntime({ ...harness, wireState }), {
      initialProps: { wireState: 'open' },
    });
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await act(async () => {
      await result.current.send({ messageId: 'm-recover', text: 'recover me', msgType: 'agent.ask', audience: ['agent:worker:1'] });
    });
    await waitFor(() => expect(result.current.pending[0]).toMatchObject({
      messageId: 'm-recover', state: 'queued', error: { code: 'unavailable' },
    }));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0].id).toBe('m-recover');

    rerender({ wireState: 'reconnecting' });
    rerender({ wireState: 'open' });
    await waitFor(() => expect(result.current.pending[0]?.state).toBe('accepted'));
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][0].id).toBe('m-recover');
    expect(result.current.pending[0].messageId).toBe('m-recover');

    unmount();
    harness.store.close();
  });

  it('keeps retryable transport failure queued and exposes definitive rejection without self-retrying', async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('closed'), { code: 'closed' }))
      .mockRejectedValueOnce(Object.assign(new Error('forbidden'), { code: 'forbidden' }));
    const harness = runtimeHarness({ wireState: 'open', submit });
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(harness));
    await waitFor(() => expect(result.current.pending).toEqual([]));
    await act(async () => {
      await result.current.send({ messageId: 'm5', text: 'uncertain', msgType: 'agent.ask', audience: ['agent:worker:1'] });
    });
    await waitFor(() => expect(result.current.pending[0]?.state).toBe('uncertain'));
    expect(result.current.pending[0].error.code).toBe('closed');
    await act(async () => { await result.current.retry(result.current.pending[0]); });
    await waitFor(() => expect(result.current.pending[0]?.state).toBe('rejected'));
    expect(submit).toHaveBeenCalledTimes(2);
    unmount();
    harness.store.close();
  });

  it('rejects a same-runtime pending picker snapshot after send consumes its draft', async () => {
    const harness = runtimeHarness({ principalId: 'same-runtime-picker-root' });
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(harness));
    await waitFor(() => expect(result.current.pending).toEqual([]));
    let first;
    await act(async () => {
      first = await result.current.updateDraft('c0', { recipients: ['agent:pending:1'], editorRevision: 1 });
    });
    expect(result.current.draftFor('c0')).toMatchObject({ revision: first.revision, recipients: ['agent:pending:1'] });

    await act(async () => {
      await result.current.send({
        channelId: 'c0', draftRevision: first.revision, editorRevision: 1,
        text: 'pending picker', msgType: 'agent.ask', audience: ['agent:worker:1'],
      });
    });
    expect(result.current.draftFor('c0')).toMatchObject({ recipients: [], editorRevision: 0 });

    await expect(act(async () => result.current.updateDraft(
      'c0', { recipients: ['agent:pending:1'], editorRevision: 1 }, { preserveEditorRevision: true },
    ))).rejects.toMatchObject({ code: 'draft_consumed' });
    expect(result.current.draftFor('c0')).toMatchObject({ recipients: [] });
    await waitFor(async () => expect((await harness.store.restoreDrafts(harness.principalId))[0])
      .toMatchObject({ draft: null, editorRevision: 1 }));
    unmount();
    harness.store.close();
  });

  it('rejects renderer-only attachments instead of making an unrecoverable durable record', async () => {
    const store = createOutboxStore({ databaseName: databaseName() });
    await expect(store.putMany('root', [{ ...row('m7'), frame: { ...frame('m7'), payload: { attachments: [{ resource_id: 'blob:local' }] } } }]))
      .rejects.toThrow('附件尚未成为可恢复');
    expect(await store.restore('root')).toEqual([]);
    store.close();
  });

});
