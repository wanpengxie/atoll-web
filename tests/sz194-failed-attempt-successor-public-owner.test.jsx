// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const VIEW_SPEC = Object.freeze({
  scope: 'all',
  selfId: 'human:sz194:1',
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function stateFor() {
  const replica = createChannelReplicaStore();
  const base = replica.ensure('sz194-failure').state;
  return {
    ...base,
    channelId: 'sz194-failure',
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

function admission() {
  return {
    evaluate: (_channelID, items) => ({ items, receipt: null }),
    sourceFence: () => 211,
  };
}

function historyFor({ request, completedPages = 3, buffered = 0, demandRevision = 1 }) {
  return {
    request,
    refreshLatest: vi.fn(),
    status: {
      channelId: 'sz194-failure',
      attached: true,
      generation: 7,
      messageCurrent: true,
      headSeq: 1_101,
      oldestSeq: 100,
      coverage: [{ lowSeq: 100, highSeq: 1_101 }],
      loaded: true,
      completedPages,
      revealVersion: 0,
      buffered,
      hasOlder: true,
      loading: false,
      localReplicaReady: true,
      presentationRevision: 211,
      notificationAuthorityRevision: 0,
      sourceLease: '1:2:9',
      historyDemand: { revision: demandRevision, phase: 'idle', error: '' },
      sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: 1_101, error: '' },
      presentationAdmission: admission(),
    },
  };
}

describe('SZ-194 failed attempt successor handoff', () => {
  it('does not inherit an anticipatory failure after new supply progress', async () => {
    // 用户能力：旧供给 attempt 失败后，新 reservoir 供给仍允许同一
    // viewport obligation 继续执行，而不是把旧失败变成永久 unavailable。
    // 不变量：旧失败只封住旧 progress；新 supply progress 清除该失败门，
    // successor 仍只创建一个下一次 request。
    // 公开 owner：useConversationProjection → useHistoryConsumer viewport；
    // VendorListExecutor 是唯一 DOM/range owner。
    let settleFirst;
    const first = new Promise((resolve) => { settleFirst = resolve; });
    const request = vi.fn()
      .mockImplementationOnce(() => first)
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
      messageListKey: 'sz194-failure:all',
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: vi.fn(),
    };
    const { result, rerender, unmount } = renderHook(
      ({ history }) => useConversationProjection({ ...base, history }),
      { initialProps: { history: historyFor({ request }) } },
    );

    expect(result.current.projection.presentation.rows.map((row) => row.id)).toContain('visible-tail');

    let firstAttempt;
    act(() => { firstAttempt = result.current.viewport.onUnderfill(); });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    // New supply progress arrives while K0 is still pending. The successor
    // waits for K0 and cannot create a second physical writer yet.
    rerender({ history: historyFor({ request, completedPages: 4, buffered: 148 }) });
    let successor;
    act(() => { successor = result.current.viewport.onUnderfill(); });
    await act(async () => {
      settleFirst({ kind: 'failed', error: new Error('old source failed') });
      await firstAttempt;
    });
    await act(async () => { await successor; });
    expect(request).toHaveBeenCalledTimes(1);

    // The failure belonged to K0. Current K1 supply must open exactly one
    // successor; repeated underfill at the same K1 progress remains bounded.
    await act(async () => { await result.current.viewport.onUnderfill(); });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await act(async () => { await result.current.viewport.onUnderfill(); });
    expect(request).toHaveBeenCalledTimes(2);
    expect(result.current.viewport.status).toMatchObject({
      generation: 7,
      sourceLease: '1:2:9',
      completedPages: 4,
      buffered: 148,
      hasOlder: true,
    });
    unmount();
  });
});
