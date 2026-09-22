// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const VIEW_SPEC = Object.freeze({
  scope: 'all',
  selfId: 'human:sz197:1',
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function stateFor() {
  const replica = createChannelReplicaStore();
  const base = replica.ensure('sz197-admission').state;
  return {
    ...base,
    channelId: 'sz197-admission',
    timeline: [],
    lastSeq: 0,
    _timelineRevision: 211,
    _timelineProjectionVersion: 211,
  };
}

function historyFor({ request, presentationAdmission, admissionState }) {
  return {
    request,
    refreshLatest: vi.fn(),
    status: {
      channelId: 'sz197-admission',
      attached: true,
      generation: 7,
      messageCurrent: true,
      headSeq: 90,
      oldestSeq: 0,
      coverage: [],
      loaded: true,
      completedPages: 1,
      revealVersion: 0,
      buffered: 0,
      hasOlder: true,
      loading: false,
      localReplicaReady: true,
      presentationRevision: 211,
      sourceLease: '1:2:9',
      historyDemand: { revision: 1, phase: 'idle', error: '' },
      sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: 90, error: '' },
      presentationAdmission,
      presentationAdmissionState: admissionState,
    },
  };
}

describe('SZ-197 zero-row admission queues interactive demand', () => {
  it.skip('commits the first empty supply before issuing one queued interactive top demand', async () => {
    // 用户能力：当前 Presentation 为空时，首个 live-admission supply 先完成
    // 提交；用户随后真实触发的 top demand 必须在同一事务后继续，而不能
    // 覆盖首批或并行启动第二个 Scheduler request。
    // 不变量：K0 的 zero-row settle 先交给 Admission；blocking 阶段只保留
    // 一个 interactive waiter，release 后 reason=top 且 urgency=interactive。
    // 公开 owner：useConversationProjection → useHistoryConsumer viewport；
    // Feed/history request 是唯一 acquisition owner。
    let settleFirst;
    let liveAdmission = { phase: 'idle', token: null };
    const presentationAdmission = {
      snapshot: vi.fn(() => liveAdmission),
      evaluate: (_channelID, items) => ({ items, receipt: null }),
      sourceFence: () => 211,
    };
    const request = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { settleFirst = resolve; }))
      .mockImplementation(() => new Promise(() => {}));
    const viewSessions = {
      readView: () => ({ mode: 'following', revision: 0 }),
      activate: vi.fn(),
      save: vi.fn(() => true),
      deactivate: vi.fn(),
    };
    const base = {
      state: stateFor(),
      viewSessions,
      historyViewSpec: VIEW_SPEC,
      messageListKey: 'sz197-admission:all',
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: vi.fn(),
    };
    const { result, rerender, unmount } = renderHook(
      ({ history }) => useConversationProjection({ ...base, history }),
      {
        initialProps: {
          history: historyFor({
            request,
            presentationAdmission,
            admissionState: liveAdmission,
          }),
        },
      },
    );

    await waitFor(() => expect(result.current.viewport.activationID).toBeTruthy());
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    liveAdmission = {
      phase: 'pending-baseline-commit',
      token: {
        activationID: result.current.viewport.activationID,
        viewID: 'sz197-admission:all',
        epoch: 'sz197-admission:7',
        operationID: 'history:sz197:1',
      },
    };
    rerender({ history: historyFor({
      request, presentationAdmission, admissionState: liveAdmission,
    }) });
    await act(async () => {
      settleFirst({ kind: 'satisfied' });
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledTimes(1);

    // A real user top gesture while the first zero-row transaction is staged
    // is retained as one typed interactive demand, not dropped or issued now.
    act(() => { void result.current.viewport.onAtTop({ gestureID: 'sz197-top' }); });
    expect(request).toHaveBeenCalledTimes(1);

    liveAdmission = { phase: 'idle', token: null };
    rerender({ history: historyFor({
      request, presentationAdmission, admissionState: liveAdmission,
    }) });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request.mock.calls[1][0]).toMatchObject({
      reason: 'top',
      urgency: 'interactive',
    });
    expect(request.mock.calls[1][0].intent).toBe('scroll-history');
    unmount();
  });
});
