// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const SELF = 'human:sz192:1';

const VIEW_SPEC = Object.freeze({
  scope: 'mine',
  selfId: SELF,
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function stateFor() {
  const replica = createChannelReplicaStore();
  const base = replica.ensure('viewport-recheck').state;
  const envelope = {
    id: 'visible-tail',
    seq: 101,
    ts: 101_000,
    type: 'human.note',
    sender: { id: SELF, kind: 'human' },
    payload: { body: { text: 'visible tail' } },
  };
  const row = {
    kind: 'standalone',
    seq: 101,
    envelope,
  };
  return {
    ...base,
    channelId: 'viewport-recheck',
    // Mine projection derives conversation membership from the canonical
    // replica rows. Keep the fixture on that public input instead of making
    // a private selector assertion or switching away from the claimed scope.
    rows: new Map([[envelope.id, envelope]]),
    timeline: [row],
    lastSeq: 101,
    _timelineRevision: 2,
    _timelineProjectionVersion: 2,
  };
}

function admission() {
  return {
    evaluate: (_channelID, items) => ({ items, receipt: null }),
    sourceFence: () => 211,
  };
}

function historyFor(request) {
  return {
    request,
    refreshLatest: vi.fn(),
    status: {
      channelId: 'viewport-recheck',
      attached: true,
      generation: 7,
      messageCurrent: true,
      headSeq: 1_101,
      oldestSeq: 100,
      coverage: [{ lowSeq: 100, highSeq: 101 }],
      loaded: true,
      completedPages: 3,
      revealVersion: 0,
      buffered: 0,
      hasOlder: true,
      loading: false,
      localReplicaReady: true,
      presentationRevision: 211,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 1, phase: 'idle', error: '' },
      sync: { interestRevision: 0, fulfilledRevision: 0, targetHead: 1_101, error: '' },
      sourceLease: '1:2:9',
      presentationAdmission: admission(),
    },
  };
}

describe('SZ-192 viewport-budget settle handoff', () => {
  it('rechecks the DOM owner after the active supply attempt settles', async () => {
    // 用户能力：同一供给请求期间 viewport 预算变化不会丢失欠供给义务。
    // 不变量：active attempt 只由一个 request 持有；settle 后把后续预算
    // 变化交回当前 DOM owner 重验，而不是复制 Scheduler 请求或吞掉需求。
    // 公开 owner：useConversationProjection → useHistoryConsumer viewport；
    // VendorListExecutor 是唯一物理 DOM/range owner。
    let settleFirst;
    const first = new Promise((resolve) => { settleFirst = resolve; });
    const request = vi.fn(() => first);
    const viewSessions = {
      readView: () => ({ mode: 'following', revision: 0 }),
      activate: vi.fn(),
      save: vi.fn(() => true),
      deactivate: vi.fn(),
    };
    const args = {
      state: stateFor(),
      history: historyFor(request),
      viewSessions,
      historyViewSpec: VIEW_SPEC,
      messageListKey: 'viewport-recheck:mine',
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: vi.fn(),
    };
    const { result, unmount } = renderHook(
      () => useConversationProjection(args),
    );

    await waitFor(() => expect(result.current.viewport.activationID).toBeTruthy());
    let active;
    let resized;
    act(() => { active = result.current.viewport.onUnderfill({ demandUnits: 2 }); });
    act(() => { resized = result.current.viewport.onUnderfill({ demandUnits: 7 }); });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toMatchObject({
      reason: 'underfill',
      urgency: 'anticipatory',
    });

    await act(async () => {
      settleFirst({ kind: 'exhausted' });
      await active;
    });
    await expect(resized).resolves.toMatchObject({
      kind: 'consumer-recheck',
      reason: 'attempt-settled',
    });
    expect(request).toHaveBeenCalledTimes(1);
    unmount();
  });
});
