// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const VIEW_SPEC = Object.freeze({
  scope: 'all',
  selfId: 'human:sz196:1',
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function stateFor() {
  const replica = createChannelReplicaStore();
  const base = replica.ensure('sz196-admission').state;
  return {
    ...base,
    channelId: 'sz196-admission',
    timeline: [{
      kind: 'standalone',
      seq: 101,
      envelope: {
        id: 'baseline',
        seq: 101,
        ts: 101_000,
        type: 'human.note',
        sender: { id: 'human:other:1', kind: 'human' },
        payload: { body: { text: 'baseline' } },
      },
    }],
    lastSeq: 101,
    _timelineRevision: 211,
    _timelineProjectionVersion: 211,
  };
}

function historyFor({ request, presentationAdmission, admissionState }) {
  return {
    request,
    refreshLatest: vi.fn(),
    status: {
      channelId: 'sz196-admission',
      attached: true,
      generation: 7,
      messageCurrent: true,
      headSeq: 1_101,
      oldestSeq: 100,
      coverage: [{ lowSeq: 100, highSeq: 1_101 }],
      loaded: true,
      completedPages: 3,
      revealVersion: 0,
      buffered: 0,
      hasOlder: true,
      loading: false,
      localReplicaReady: true,
      presentationRevision: 211,
      sourceLease: '1:2:9',
      historyDemand: { revision: 1, phase: 'idle', error: '' },
      sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: 1_101, error: '' },
      presentationAdmission,
      presentationAdmissionState: admissionState,
    },
  };
}

describe('SZ-196 admission rejection preserves viewport debt', () => {
  it('hands the same DOM debt back and opens one successor attempt', async () => {
    // 用户能力：underfill 已有供给结果后，staging Admission 被拒绝/进入
    // holding 时，DOM 欠账不被消费；Admission 释放后同一义务仍可重试。
    // 不变量：K0 satisfied 不会绕过 blocking Admission；holding 期间不
    // 启动 K1，settle 后当前 DOM owner 只开启一个 successor。
    // 公开 owner：useConversationProjection → useHistoryConsumer viewport；
    // VendorListExecutor 是唯一物理 DOM/range owner。
    let settleFirst;
    let liveAdmission = { phase: 'idle', token: null };
    const presentationAdmission = {
      snapshot: vi.fn(() => liveAdmission),
      evaluate: (_channelID, items) => ({ items, receipt: null }),
      sourceFence: () => 211,
    };
    const request = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { settleFirst = resolve; }))
      .mockResolvedValue({ kind: 'exhausted' });
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
      messageListKey: 'sz196-admission:all',
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
    let first;
    act(() => { first = result.current.viewport.onUnderfill({ demandUnits: 3 }); });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    liveAdmission = {
      phase: 'pending-baseline-commit',
      token: {
        activationID: result.current.viewport.activationID,
        viewID: 'sz196-admission:all',
        epoch: 'sz196-admission:7',
        operationID: 'history:sz196:1',
      },
    };
    rerender({ history: historyFor({
      request, presentationAdmission, admissionState: liveAdmission,
    }) });
    await act(async () => {
      settleFirst({ kind: 'satisfied' });
      await first;
    });
    await expect(first).resolves.toMatchObject({
      kind: 'consumer-recheck',
      reason: 'acquisition-satisfied',
    });

    // Re-measure the unchanged baseline while Admission owns the staged
    // transaction. The same debt is deferred, not fetched a second time.
    let deferred;
    act(() => { deferred = result.current.viewport.onUnderfill({ demandUnits: 3 }); });
    expect(request).toHaveBeenCalledTimes(1);

    // Structural rejection enters holding; it cannot consume the debt.
    liveAdmission = { phase: 'holding', token: null };
    rerender({ history: historyFor({
      request, presentationAdmission, admissionState: liveAdmission,
    }) });
    await expect(deferred).resolves.toMatchObject({
      kind: 'consumer-recheck',
      reason: 'admission-settled',
    });

    await act(async () => { await result.current.viewport.onUnderfill({ demandUnits: 3 }); });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(result.current.viewport.status).toMatchObject({
      generation: 7,
      sourceLease: '1:2:9',
      hasOlder: true,
    });
    unmount();
  });
});
