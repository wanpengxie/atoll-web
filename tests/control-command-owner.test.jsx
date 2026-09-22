// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOutboxStore } from '../src/model/outbox-store.js';
import { TYPES } from '../src/protocol/vocab.js';
import { useComposerSubmissionRuntime } from '../src/ui/composer/useComposerSubmissionRuntime.js';

let serial = 0;
const databaseName = () => `control-owner-${++serial}-${Date.now()}`;

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

function harness({
  submit = vi.fn().mockResolvedValue({ message_id: 'stop-1' }),
  resolve = vi.fn().mockResolvedValue({ request_id: 'request-1' }),
} = {}) {
  const store = createOutboxStore({ databaseName: databaseName() });
  const access = {
    relationship: 'member', existence: 'present', runtime: 'open', freshness: 'fresh',
    unavailable: false, authorityEpoch: 1,
  };
  return {
    activeChannelId: 'c0',
    principalId: 'human:root:1',
    producerOwnerToken: 'owner-1',
    wireState: 'open',
    wireRef: { current: { submit, resolve } },
    accessRef: { current: { state: () => access } },
    rosterRef: { current: { recordSubmission: vi.fn(), forgetSubmission: vi.fn() } },
    onError: vi.fn(), onNotice: vi.fn(), onFeedChanged: vi.fn(), onAccessChanged: vi.fn(),
    outboxFactory: () => store,
    submit,
    resolve,
    store,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('submission control owner', () => {
  it('rejects raw agent interrupt sends and emits a canonical interrupt frame only through control', async () => {
    const config = harness();
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(config));
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await expect(act(async () => result.current.send({
      messageId: 'raw-stop', channelId: 'c0', msgType: TYPES.agentInterrupt,
      payload: {}, audience: ['agent:worker:1'],
    }))).rejects.toMatchObject({ code: 'control_owner_required' });
    await expect(act(async () => result.current.control({
      channelId: 'c0', type: TYPES.agentInterrupt, actorId: 'agent:worker:1', payload: {},
      controlContext: {
        source: 'timeline',
        turn: turn(),
        targetAuthority: { current: true, actorIDs: new Set(['agent:worker:1']) },
      },
    }))).resolves.toBeTruthy();
    await waitFor(() => expect(config.submit).toHaveBeenCalledOnce());
    expect(config.submit.mock.calls[0][0]).toMatchObject({
      channel_id: 'c0', msg_type: TYPES.agentInterrupt,
      audience: ['agent:worker:1'], payload: {},
    });
    unmount();
    config.store.close();
  });

  it('rejects direct Composer control without a current processing turn context', async () => {
    const config = harness();
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(config));
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await expect(act(async () => result.current.control({
      channelId: 'c0', msgType: TYPES.agentInterrupt,
      audience: ['agent:worker:1'], payload: {},
    }))).rejects.toMatchObject({ code: 'control_target_invalid' });
    expect(config.submit).not.toHaveBeenCalled();
    unmount();
    config.store.close();
  });

  it.skip('rejects a Waiting feature interrupt when its target authority is missing', async () => {
    const config = harness();
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(config));
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await expect(act(async () => result.current.control({
      channelId: 'c0', msgType: TYPES.agentInterrupt,
      audience: ['agent:worker:1'], payload: {},
      controlContext: { source: 'feature', turn: turn() },
    }))).rejects.toMatchObject({ code: 'control_authority_stale' });
    expect(config.submit).not.toHaveBeenCalled();
    unmount();
    config.store.close();
  });

  it('projects a backend control rejection as bounded code/detail data', async () => {
    const failure = Object.assign(new Error('transport wording must not leak'), {
      code: 'control_rejected',
      detail: '服务端拒绝该控制命令',
    });
    const config = harness({ submit: vi.fn().mockRejectedValue(failure) });
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(config));
    await waitFor(() => expect(result.current.pending).toEqual([]));

    const messageId = await act(async () => result.current.control({
      channelId: 'c0', type: TYPES.agentInterrupt, actorId: 'agent:worker:1', payload: {},
      controlContext: {
        source: 'timeline', turn: turn(),
        targetAuthority: { current: true, actorIDs: new Set(['agent:worker:1']) },
      },
    }));
    await waitFor(() => expect(result.current.pending).toEqual([
      expect.objectContaining({ messageId, state: 'rejected' }),
    ]));
    expect(result.current.pending[0].error).toEqual({
      code: 'control_rejected', detail: '服务端拒绝该控制命令',
    });
    expect(JSON.parse(JSON.stringify(result.current.pending[0].error))).toEqual({
      code: 'control_rejected', detail: '服务端拒绝该控制命令',
    });
    await waitFor(async () => expect((await config.store.restore(config.principalId))
      .find((row) => row.messageId === messageId)).toMatchObject({ state: 'rejected' }));
    const persisted = (await config.store.restore(config.principalId))
      .find((row) => row.messageId === messageId);
    expect(persisted).toMatchObject({
      state: 'rejected',
      error: { code: 'control_rejected', detail: '服务端拒绝该控制命令' },
    });
    expect(persisted.error).not.toHaveProperty('message');
    expect(config.submit).toHaveBeenCalledOnce();
    unmount();
    config.store.close();
  });

  it('rechecks the member authority at the submission owner before enqueueing', async () => {
    const config = harness();
    const access = config.accessRef.current.state();
    config.accessRef.current.state = () => ({ ...access, freshness: 'stale' });
    const { result, unmount } = renderHook(() => useComposerSubmissionRuntime(config));
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await expect(act(async () => result.current.control({
      channelId: 'c0', msgType: TYPES.agentInterrupt,
      audience: ['agent:worker:1'], payload: {},
      controlContext: {
        source: 'timeline', turn: turn(),
        targetAuthority: { current: true, actorIDs: new Set(['agent:worker:1']) },
      },
    }))).rejects.toMatchObject({ code: 'control_authority_stale' });
    expect(config.submit).not.toHaveBeenCalled();
    unmount();
    config.store.close();
  });

  it('projects a resolve rejection as serializable approval error data', async () => {
    const failure = Object.assign(new Error('raw backend wording must stay private'), {
      code: 'resolve_rejected',
      detail: '服务端拒绝审批结果',
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
    expect(result.current.approvalStates['request-1'].error).not.toBeInstanceOf(Error);
    expect(JSON.parse(JSON.stringify(result.current.approvalStates['request-1'])))
      .toEqual({ error: { code: 'resolve_rejected', detail: '服务端拒绝审批结果' } });
    expect(config.resolve).toHaveBeenCalledWith({
      channel_id: 'c0', req_id: 'request-1', decision: 'approve',
    });
    unmount();
    config.store.close();
  });
});
