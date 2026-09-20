// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
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

  it('advances a queued durable record through transmit and accepted without changing its id', async () => {
    const store = createOutboxStore({ databaseName: databaseName() });
    await store.putMany('root', [row('m3')]);
    const transmitting = await store.patch('root', 'm3', ['queued'], { state: 'transmitting' });
    expect(transmitting).toMatchObject({ messageId: 'm3', state: 'transmitting' });
    const accepted = await store.patch('root', 'm3', ['transmitting'], { state: 'accepted' });
    expect(accepted).toMatchObject({ messageId: 'm3', state: 'accepted' });
    expect((await store.restore('root'))[0]).toMatchObject({ messageId: 'm3', state: 'accepted' });
    store.close();
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

  it('does not consume a newer draft when accepting immutable frames', async () => {
    const store = createOutboxStore({ databaseName: databaseName() });
    const first = await store.writeDraft('root', 'c0', { text: 'first', editorRevision: 1 }, 0);
    const newer = await store.writeDraft('root', 'c0', { text: 'newer', editorRevision: 2 }, first.record.revision);
    const result = await store.acceptDraft({
      principalId: 'root',
      channelId: 'c0',
      expectedRevision: first.record.revision,
      editorRevision: 1,
      submissions: [row('m6')],
    });
    expect(result).toMatchObject({ accepted: true, consumed: false });
    expect((await store.restore('root'))[0]).toMatchObject({ messageId: 'm6' });
    expect((await store.restoreDrafts('root'))[0]).toMatchObject({ revision: newer.record.revision, draft: { text: 'newer' } });
    store.close();
  });

  it('fails closed for a stale picker update after another owner consumed the draft', async () => {
    const harness = runtimeHarness({ principalId: 'late-picker-root' });
    const first = await harness.store.writeDraft(harness.principalId, 'c0', { text: 'late picker', editorRevision: 1 }, 0);
    const writeDraft = vi.fn((...args) => harness.store.writeDraft(...args));
    const outbox = { ...harness.store, writeDraft };
    harness.outboxFactory = () => outbox;
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(harness));
    await waitFor(() => expect(result.current.draftFor('c0')).toMatchObject({
      revision: first.record.revision, text: 'late picker',
    }));

    const accepted = await harness.store.acceptDraft({
      principalId: harness.principalId, channelId: 'c0', expectedRevision: first.record.revision,
      editorRevision: 1, submissions: [row('late-picker')],
    });
    expect(accepted).toMatchObject({ accepted: true, consumed: true, record: { draft: null } });

    await expect(act(async () => result.current.updateDraft(
      'c0', { text: 'late picker', editorRevision: 1 }, { preserveEditorRevision: true },
    ))).rejects.toMatchObject({ code: 'draft_consumed' });
    expect(writeDraft).toHaveBeenCalledTimes(1);
    expect((await harness.store.restoreDrafts(harness.principalId))[0]).toMatchObject({
      revision: accepted.record.revision, draft: null,
    });
    await waitFor(() => expect(result.current.draftFor('c0')).toMatchObject({ text: '', editorRevision: 0 }));

    await act(async () => {
      await result.current.updateDraft('c0', { text: 'fresh draft', editorRevision: 2 }, { preserveEditorRevision: true });
    });
    expect((await harness.store.restoreDrafts(harness.principalId))[0]).toMatchObject({ draft: { text: 'fresh draft' } });
    unmount();
    harness.store.close();
  });

  it('rejects a same-runtime pending picker snapshot after send consumes its draft', async () => {
    const harness = runtimeHarness({ principalId: 'same-runtime-picker-root' });
    const first = await harness.store.writeDraft(harness.principalId, 'c0', { text: 'pending picker', editorRevision: 1 }, 0);
    const writeDraft = vi.fn((...args) => harness.store.writeDraft(...args));
    const outbox = { ...harness.store, writeDraft };
    harness.outboxFactory = () => outbox;
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(harness));
    await waitFor(() => expect(result.current.draftFor('c0')).toMatchObject({
      revision: first.record.revision, text: 'pending picker',
    }));

    await act(async () => {
      await result.current.send({
        channelId: 'c0', draftRevision: first.record.revision, editorRevision: 1,
        text: 'pending picker', msgType: 'agent.ask', audience: ['agent:worker:1'],
      });
    });
    const consumed = (await harness.store.restoreDrafts(harness.principalId))[0];
    expect(consumed).toMatchObject({ draft: null, editorRevision: 1 });

    await expect(act(async () => result.current.updateDraft(
      'c0', { text: 'pending picker', editorRevision: 1 }, { preserveEditorRevision: true },
    ))).rejects.toMatchObject({ code: 'draft_consumed' });
    expect(writeDraft).toHaveBeenCalledTimes(1);
    expect((await harness.store.restoreDrafts(harness.principalId))[0]).toMatchObject({ draft: null });
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

  it('serializes one submission lease and refuses a live lease owned by another runtime', async () => {
    let now = 100;
    const store = createOutboxStore({ databaseName: databaseName(), now: () => now });
    await store.putMany('root', [row('m8')]);
    expect(await store.acquireLease('root', 'm8', 'tab-a', 1000)).toMatchObject({ leaseOwner: 'tab-a', leaseUntil: 1100 });
    expect(await store.acquireLease('root', 'm8', 'tab-b', 1000)).toBeNull();
    expect(await store.releaseLease('root', 'm8', 'tab-b')).toBe(false);
    now = 1200;
    expect(await store.acquireLease('root', 'm8', 'tab-b', 1000)).toMatchObject({ leaseOwner: 'tab-b' });
    store.close();
  });
});
