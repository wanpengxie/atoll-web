// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const VIEW_SPEC = Object.freeze({
  scope: 'all',
  selfId: 'human:sz193:1',
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function stateFor() {
  const replica = createChannelReplicaStore();
  const base = replica.ensure('sz193-reservoir').state;
  return {
    ...base,
    channelId: 'sz193-reservoir',
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
      channelId: 'sz193-reservoir',
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

describe('SZ-193 reservoir-before-EOF settle handoff', () => {
  it('retains one successor for reservoir progress and ignores the old EOF boundary', async () => {
    // 用户能力：新 reservoir 在旧供给 attempt 尚未 settle 时到达，用户的
    // 同一 viewport history obligation 不能丢失或复制；旧 EOF 不能封住新供给。
    // 不变量：旧 attempt 与新 reservoir progress 各自只产生一个 successor；
    // stale K0 EOF 不得成为 K1 的当前 exhaustion。
    // 公开 owner：useConversationProjection → useHistoryConsumer viewport；
    // Feed/Admission 仅提供 typed status，VendorListExecutor 是 DOM owner。
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
      messageListKey: 'sz193-reservoir:all',
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

    // Reservoir progress arrives before K0 settles. It reopens the same public
    // obligation, but must wait for K0 rather than starting a duplicate writer.
    rerender({ history: historyFor({ request, completedPages: 4, buffered: 148 }) });
    let successor;
    act(() => { successor = result.current.viewport.onUnderfill(); });
    expect(request).toHaveBeenCalledTimes(1);

    await act(async () => {
      settleFirst({ kind: 'exhausted' });
      await firstAttempt;
    });
    await act(async () => { await successor; });
    expect(request).toHaveBeenCalledTimes(1);

    // K1 is now the current supply boundary and may issue exactly one request.
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
