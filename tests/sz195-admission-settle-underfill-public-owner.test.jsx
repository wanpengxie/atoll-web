// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const VIEW_SPEC = Object.freeze({
  scope: 'all',
  selfId: 'human:sz195:1',
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function stateFor() {
  const replica = createChannelReplicaStore();
  const base = replica.ensure('sz195-admission').state;
  return {
    ...base,
    channelId: 'sz195-admission',
    timeline: [{
      kind: 'standalone',
      seq: 101,
      envelope: {
        id: 'visible-tail',
        seq: 101,
        ts: 101_000,
        type: 'human.note',
        sender: { id: 'human:other:1', kind: 'human' },
        payload: { body: { text: 'visible tail' } },
      },
    }],
    lastSeq: 101,
    _timelineRevision: 211,
    _timelineProjectionVersion: 211,
  };
}

function historyFor({ request, presentationAdmission }) {
  return {
    request,
    refreshLatest: vi.fn(),
    status: {
      channelId: 'sz195-admission',
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
    },
  };
}

describe('SZ-195 admission-settle underfill handoff', () => {
  it('returns anticipatory underfill to the DOM owner without fetching during blocking admission', async () => {
    // 用户能力：Presentation 正在等待 blocking admission commit 时，DOM
    // underfill 不会直接发起历史 request；commit 结束后只交回 DOM owner 重验。
    // 不变量：Admission 是当前 staging authority，viewport debt 不被消费，
    // 也不复制第二 scheduler writer。
    // 公开 owner：useConversationProjection → useHistoryConsumer viewport；
    // VendorListExecutor 是唯一物理 DOM/range owner。
    let liveAdmission = { phase: 'idle', token: null };
    const presentationAdmission = {
      snapshot: vi.fn(() => liveAdmission),
      evaluate: (_channelID, items) => ({ items, receipt: null }),
      sourceFence: () => 211,
    };
    const request = vi.fn().mockResolvedValue({ kind: 'exhausted' });
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
      messageListKey: 'sz195-admission:all',
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: vi.fn(),
    };
    const { result, rerender, unmount } = renderHook(
      ({ history }) => useConversationProjection({ ...base, history }),
      {
        initialProps: {
          history: historyFor({ request, presentationAdmission }),
        },
      },
    );

    await waitFor(() => expect(result.current.viewport.activationID).toBeTruthy());
    liveAdmission = {
      phase: 'pending-baseline-commit',
      token: {
        activationID: result.current.viewport.activationID,
        viewID: 'sz195-admission:all',
        epoch: 'sz195-admission:7',
        operationID: 'history:existing:1',
      },
    };
    rerender({ history: historyFor({ request, presentationAdmission }) });

    let debt;
    act(() => { debt = result.current.viewport.onUnderfill({ demandUnits: 3 }); });
    expect(request).not.toHaveBeenCalled();

    liveAdmission = { phase: 'idle', token: null };
    rerender({ history: historyFor({ request, presentationAdmission }) });
    await expect(debt).resolves.toMatchObject({
      kind: 'consumer-recheck',
      reason: 'admission-settled',
    });
    expect(request).not.toHaveBeenCalled();
    unmount();
  });
});
