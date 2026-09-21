// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOutboxStore } from '../src/model/outbox-store.js';
import { TYPES } from '../src/protocol/vocab.js';
import { useComposerSubmissionRuntime } from '../src/ui/composer/useComposerSubmissionRuntime.js';

let serial = 0;
const databaseName = () => `control-error-projection-${++serial}-${Date.now()}`;

function turn() {
  return {
    requestId: 'request-1',
    request: { id: 'request-1', type: TYPES.agentAsk, audience: ['agent:worker:1'] },
    terminal: null,
    local: false,
    provisional: [{
      seq: 4,
      envelope: { payload: { body: { status: 'processing', controls: [{ word: TYPES.agentInterrupt }] } } },
    }],
  };
}

function controlFrame(messageId, type = TYPES.agentInterrupt) {
  return {
    id: messageId,
    channel_id: 'c0',
    msg_type: type,
    kind: 'request',
    payload: {},
    audience: ['agent:worker:1'],
    visibility: 'public',
  };
}

function harness({
  wireState = 'open',
  submit = vi.fn().mockResolvedValue({ message_id: 'control-1' }),
  cancel = vi.fn().mockResolvedValue({ request_id: 'request-1' }),
  resolve = vi.fn().mockResolvedValue({ request_id: 'request-1' }),
  principalId = `root-${serial + 1}`,
  store = createOutboxStore({ databaseName: databaseName() }),
} = {}) {
  const wireRef = {
    current: wireState === 'open' ? { submit, cancel, resolve } : null,
  };
  const access = {
    relationship: 'member', existence: 'present', runtime: 'open', freshness: 'fresh',
    unavailable: false, authorityEpoch: 1,
  };
  return {
    activeChannelId: 'c0',
    principalId,
    producerOwnerToken: `owner-${principalId}`,
    serverWorld: 'world-a',
    wireState,
    wireRef,
    accessRef: { current: { state: () => access } },
    rosterRef: { current: { recordSubmission: vi.fn(), forgetSubmission: vi.fn() } },
    onError: vi.fn(),
    onNotice: vi.fn(),
    onFeedChanged: vi.fn(),
    onAccessChanged: vi.fn(),
    outboxFactory: () => store,
    submit,
    cancel,
    resolve,
    store,
    principalId,
  };
}

function expectBounded(error, code, detail) {
  expect(error).toEqual({ code, detail });
  expect(error).not.toBeInstanceOf(Error);
  expect(error).not.toHaveProperty('message');
  expect(JSON.parse(JSON.stringify(error))).toEqual({ code, detail });
}

function controlContext() {
  return {
    source: 'timeline',
    turn: turn(),
    targetAuthority: { current: true, actorIDs: new Set(['agent:worker:1']) },
  };
}

afterEach(() => vi.restoreAllMocks());

describe('Composer public control error projection', () => {
  it('projects submission.control rejection in memory and durable pending state', async () => {
    const failure = Object.assign(new Error('raw submit wording'), {
      code: 'control_rejected', detail: '服务端拒绝该控制命令',
    });
    const config = harness({ submit: vi.fn().mockRejectedValue(failure) });
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(config));
    await waitFor(() => expect(result.current.pending).toEqual([]));

    const messageId = await act(async () => result.current.control({
      channelId: 'c0', type: TYPES.agentInterrupt, actorId: 'agent:worker:1', payload: {},
      controlContext: controlContext(),
    }));
    await waitFor(() => expect(result.current.pending[0]).toMatchObject({ messageId, state: 'rejected' }));
    expectBounded(result.current.pending[0].error, 'control_rejected', '服务端拒绝该控制命令');
    const persisted = (await config.store.restore(config.principalId)).find((row) => row.messageId === messageId);
    expect(persisted).toMatchObject({ state: 'rejected', controlSubmission: true });
    expectBounded(persisted.error, 'control_rejected', '服务端拒绝该控制命令');
    unmount();
    config.store.close();
  });

  it('marks every canonical control command, including system governance, as control-owned', async () => {
    const failure = Object.assign(new Error('raw governance wording'), {
      code: 'governance_rejected', detail: '治理请求被拒绝',
    });
    const config = harness({ submit: vi.fn().mockRejectedValue(failure) });
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(config));
    await waitFor(() => expect(result.current.pending).toEqual([]));

    const messageId = await act(async () => result.current.control({
      channelId: 'c0', type: TYPES.member.list, payload: { scope: 'current' },
    }));
    await waitFor(() => expect(result.current.pending[0]).toMatchObject({
      messageId, state: 'rejected', controlSubmission: true,
    }));
    expectBounded(result.current.pending[0].error, 'governance_rejected', '治理请求被拒绝');
    unmount();
    config.store.close();
  });

  it('projects cancel rejection in the public control state and its persisted record', async () => {
    const failure = Object.assign(new Error('raw cancel wording'), {
      code: 'cancel_rejected', detail: '服务端拒绝取消命令',
    });
    const config = harness({ cancel: vi.fn().mockRejectedValue(failure) });
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(config));
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await act(async () => {
      await expect(result.current.cancel('c0', 'request-1')).rejects.toBe(failure);
    });
    const key = 'c0:request-1:cancel';
    await waitFor(() => expect(result.current.controlStates[key]?.state).toBe('error'));
    expectBounded(result.current.controlStates[key].error, 'cancel_rejected', '服务端拒绝取消命令');
    const persisted = (await config.store.restore(config.principalId)).find((row) => row.controlKey === key);
    expect(persisted).toMatchObject({ kind: 'control', state: 'error' });
    expectBounded(persisted.error, 'cancel_rejected', '服务端拒绝取消命令');
    unmount();
    config.store.close();
  });

  it('projects resolve rejection in approvalStates without retaining the raw Error', async () => {
    const failure = Object.assign(new Error('raw resolve wording'), {
      code: 'resolve_rejected', detail: '服务端拒绝审批结果',
    });
    const config = harness({ resolve: vi.fn().mockRejectedValue(failure) });
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(config));
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await act(async () => {
      await expect(result.current.resolve('c0', 'request-1', 'approve')).rejects.toBe(failure);
    });
    await waitFor(() => expect(result.current.approvalStates['request-1']).toEqual({
      error: { code: 'resolve_rejected', detail: '服务端拒绝审批结果' },
    }));
    expectBounded(result.current.approvalStates['request-1'].error, 'resolve_rejected', '服务端拒绝审批结果');
    unmount();
    config.store.close();
  });

  it('[TC0659/AD-365] keeps resolve payloads in the backend field-closed forms', async () => {
    const resolve = vi.fn().mockResolvedValue({ request_id: 'request-1' });
    const config = harness({ resolve });
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(config));
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await act(async () => {
      await result.current.resolve('c0', 'ask-1', '', { text: '需要确认的回答' });
    });
    expect(resolve).toHaveBeenNthCalledWith(1, {
      channel_id: 'c0', req_id: 'ask-1', text: '需要确认的回答',
    });

    await act(async () => {
      await result.current.resolve('c0', 'approve-1', 'approve', { note: '已核对' });
    });
    expect(resolve).toHaveBeenNthCalledWith(2, {
      channel_id: 'c0', req_id: 'approve-1', decision: 'approve', note: '已核对',
    });

    unmount();
    config.store.close();
  });

  it('projects world reset of an in-flight control submission as a bounded durable error', async () => {
    let resolveReceipt;
    const receipt = new Promise((resolve) => { resolveReceipt = resolve; });
    const config = harness({ submit: vi.fn(() => receipt) });
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(config));
    await waitFor(() => expect(result.current.pending).toEqual([]));

    const messageId = await act(async () => result.current.control({
      channelId: 'c0', type: TYPES.agentInterrupt, actorId: 'agent:worker:1', payload: {},
      controlContext: controlContext(),
    }));
    await waitFor(() => expect(result.current.pending[0]).toMatchObject({ messageId, state: 'transmitting' }));
    await act(async () => { result.current.resetWorld(); });
    await waitFor(() => expect(result.current.pending[0]).toMatchObject({ messageId, state: 'rejected' }));
    expectBounded(result.current.pending[0].error, 'world_changed', '服务端数据世界已更换，请确认后重新发送');
    await waitFor(async () => expect((await config.store.restore(config.principalId)).find((row) => row.messageId === messageId)?.error)
      .toEqual({ code: 'world_changed', detail: '服务端数据世界已更换，请确认后重新发送' }));
    resolveReceipt({ message_id: messageId });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    unmount();
    config.store.close();
  });

  it('redacts legacy control error message fields when restoring a remounted Composer', async () => {
    const principalId = `remount-${serial + 1}`;
    const database = databaseName();
    const firstStore = createOutboxStore({ databaseName: database });
    await firstStore.putMany(principalId, [{
      key: 'legacy-control', messageId: 'legacy-control', channelId: 'c0', controlSubmission: true,
      state: 'rejected', frame: controlFrame('legacy-control'), createdAt: 1, updatedAt: 1,
      error: { code: 'forbidden', detail: '权限已撤销', message: 'raw persisted wording' },
    }, {
      key: 'control:c0:request-1:cancel', messageId: 'control:c0:request-1:cancel', kind: 'control',
      controlKey: 'c0:request-1:cancel', principalId, channelId: 'c0', requestId: 'request-1',
      action: 'cancel', state: 'error', createdAt: 1, updatedAt: 1,
      error: { code: 'cancel_rejected', detail: '服务端拒绝取消命令', message: 'raw control wording' },
    }]);
    const first = harness({ principalId, wireState: 'closed', store: firstStore });
    const mounted = renderHook(() => useComposerSubmissionRuntime(first));
    await waitFor(() => expect(mounted.result.current.pending[0]?.state).toBe('rejected'));
    expectBounded(mounted.result.current.pending[0].error, 'forbidden', '权限已撤销');
    await waitFor(() => expect(mounted.result.current.controlStates['c0:request-1:cancel']?.state).toBe('error'));
    expectBounded(mounted.result.current.controlStates['c0:request-1:cancel'].error, 'cancel_rejected', '服务端拒绝取消命令');
    mounted.unmount();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    const secondStore = createOutboxStore({ databaseName: database });
    const second = harness({ principalId, wireState: 'closed', store: secondStore });
    const remounted = renderHook(() => useComposerSubmissionRuntime(second));
    await waitFor(() => expect(remounted.result.current.pending[0]?.state).toBe('rejected'));
    expectBounded(remounted.result.current.pending[0].error, 'forbidden', '权限已撤销');
    await waitFor(() => expect(remounted.result.current.controlStates['c0:request-1:cancel']?.state).toBe('error'));
    expectBounded(remounted.result.current.controlStates['c0:request-1:cancel'].error, 'cancel_rejected', '服务端拒绝取消命令');
    remounted.unmount();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    secondStore.close();
  });

  it.each([
    ['system.channel.create', '治理频道创建请求正文'],
    ['system.member.list', '治理成员列表请求正文'],
    ['actor.describe', 'Actor 能力描述请求正文'],
  ])('preserves the business message for non-control %s rows on remount', async (type, businessMessage) => {
    const principalId = `system-remount-${serial + 1}`;
    const store = createOutboxStore({ databaseName: databaseName() });
    const messageId = `${type}-request`;
    await store.putMany(principalId, [{
      key: messageId, messageId, channelId: 'c0', state: 'rejected', frame: controlFrame(messageId, type),
      createdAt: 1, updatedAt: 1,
      error: { code: 'governance_rejected', detail: '服务端拒绝治理请求', message: businessMessage },
    }]);
    const config = harness({ principalId, wireState: 'closed', store });
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(config));
    await waitFor(() => expect(result.current.pending.find((row) => row.messageId === messageId)?.state).toBe('rejected'));
    expect(result.current.pending.find((row) => row.messageId === messageId)?.error).toEqual({
      code: 'governance_rejected', detail: '服务端拒绝治理请求', message: businessMessage,
    });
    unmount();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    store.close();
  });

  it('does not let a deferred resolve settlement repopulate approvalStates after world reset', async () => {
    let rejectResolve;
    const resolveReceipt = new Promise((resolve, reject) => { rejectResolve = reject; });
    const failure = Object.assign(new Error('late resolve wording'), {
      code: 'late_resolve', detail: '旧审批结果不应覆盖当前世界',
    });
    const config = harness({ resolve: vi.fn(() => resolveReceipt) });
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(config));
    await waitFor(() => expect(result.current.pending).toEqual([]));

    const deferred = result.current.resolve('c0', 'request-1', 'approve');
    await waitFor(() => expect(config.resolve).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.approvalStates['request-1']).toBe('sending'));
    await act(async () => { result.current.resetWorld(); });
    expect(result.current.approvalStates).toEqual({});
    rejectResolve(failure);
    await expect(deferred).rejects.toBe(failure);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(result.current.approvalStates).toEqual({});
    unmount();
    config.store.close();
  });

  it('does not let a deferred cancel settlement rewrite public or durable state after world reset', async () => {
    let rejectCancel;
    const cancelReceipt = new Promise((resolve, reject) => { rejectCancel = reject; });
    const failure = Object.assign(new Error('late cancel wording'), {
      code: 'late_cancel', detail: '旧取消结果不应覆盖当前世界',
    });
    const config = harness({ cancel: vi.fn(() => cancelReceipt) });
    await config.store.putMany(config.principalId, [{
      key: 'control:hydration-sentinel', messageId: 'control:hydration-sentinel', kind: 'control',
      controlKey: 'hydration-sentinel', principalId: config.principalId, channelId: 'c0',
      requestId: 'hydration-sentinel', action: 'cancel', state: 'accepted', createdAt: 1, updatedAt: 1,
      error: null,
    }]);
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(config));
    await waitFor(() => expect(result.current.controlStates['c0:hydration-sentinel:cancel']?.state).toBe('accepted'));

    const deferred = result.current.cancel('c0', 'request-1');
    const key = 'c0:request-1:cancel';
    await waitFor(() => expect(config.cancel).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.controlStates[key]?.state).toBe('sending'));
    await act(async () => { result.current.resetWorld(); });
    expect(result.current.controlStates).toEqual({});
    rejectCancel(failure);
    await expect(deferred).rejects.toBe(failure);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(result.current.controlStates).toEqual({});
    expect((await config.store.restore(config.principalId)).find((row) => row.controlKey === key)).toBeUndefined();
    unmount();
    config.store.close();
  });

  it('keeps a stale control settlement from overwriting the bounded world-reset error', async () => {
    let rejectReceipt;
    const receipt = new Promise((resolve, reject) => { rejectReceipt = reject; });
    const config = harness({ submit: vi.fn(() => receipt) });
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(config));
    await waitFor(() => expect(result.current.pending).toEqual([]));

    const messageId = await act(async () => result.current.control({
      channelId: 'c0', type: TYPES.agentInterrupt, actorId: 'agent:worker:1', payload: {},
      controlContext: controlContext(),
    }));
    await waitFor(() => expect(config.submit).toHaveBeenCalledOnce());
    await waitFor(() => expect(result.current.pending[0]).toMatchObject({ messageId, state: 'transmitting' }));
    await act(async () => { result.current.resetWorld(); });
    await waitFor(() => expect(result.current.pending[0]).toMatchObject({ messageId, state: 'rejected' }));
    rejectReceipt(Object.assign(new Error('late raw settlement'), {
      code: 'late_rejection', detail: '旧发送结果不应覆盖当前世界',
    }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expectBounded(result.current.pending[0].error, 'world_changed', '服务端数据世界已更换，请确认后重新发送');
    expect(result.current.pending[0].error).not.toHaveProperty('message');
    unmount();
    config.store.close();
  });
});
