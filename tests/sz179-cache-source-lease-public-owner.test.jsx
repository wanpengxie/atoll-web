// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const VIEW_SPEC = Object.freeze({
  scope: 'mine',
  selfId: 'human:sz179:1',
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function stateFor() {
  const replica = createChannelReplicaStore();
  const base = replica.ensure('lease-handoff').state;
  return {
    ...base,
    channelId: 'lease-handoff',
    timeline: [],
    lastSeq: 0,
    _timelineRevision: 1,
    _timelineProjectionVersion: 1,
  };
}

function admission() {
  return {
    evaluate: (_channelID, items) => ({ items, receipt: null }),
    sourceFence: () => 1,
  };
}

function historyFor({ request, attached, generation, messageCurrent, sourceLease }) {
  return {
    request,
    refreshLatest: vi.fn(),
    status: {
      channelId: 'lease-handoff',
      attached,
      generation,
      sourceLease,
      messageCurrent,
      headSeq: 90,
      oldestSeq: 1,
      coverage: [],
      loaded: true,
      completedPages: 1,
      hasOlder: true,
      buffered: 0,
      loading: false,
      localReplicaReady: true,
      presentationRevision: 1,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: 90, error: '' },
      presentationAdmission: admission(),
    },
  };
}

describe('SZ-179 gen0-to-gen1 source lease handoff', () => {
  it.skip('reacquires zero-row projection supply after a gen0 request settles late', async () => {
    // 用户能力：本地缓存供给转入当前 source lease 时，空投影仍能继续加载。
    // 不变量：gen0 请求的 late cancel 不能封存 gen1 的当前供给义务。
    // 公开 owner：useConversationProjection → useHistoryConsumer viewport。
    let settleFirst;
    const first = new Promise((resolve) => { settleFirst = resolve; });
    const request = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementation(() => new Promise(() => {}));
    const viewSessions = {
      readView: () => ({ mode: 'following', revision: 0 }),
      activate: vi.fn(),
      save: vi.fn(() => true),
      deactivate: vi.fn(),
    };
    const state = stateFor();
    const base = {
      state,
      viewSessions,
      historyViewSpec: VIEW_SPEC,
      messageListKey: 'lease-handoff:mine',
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: vi.fn(),
    };
    const localHistory = historyFor({
      request,
      attached: false,
      generation: 0,
      messageCurrent: false,
      sourceLease: '1:2:9',
    });
    const { result, rerender, unmount } = renderHook(
      ({ history }) => useConversationProjection({ ...base, history }),
      { initialProps: { history: localHistory } },
    );

    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(request.mock.calls[0][0]).toMatchObject({
      reason: 'projection-underfill',
      urgency: 'anticipatory',
      viewSpec: expect.objectContaining({ scope: 'mine', selfId: 'human:sz179:1' }),
    });
    expect(result.current.viewport.status).toMatchObject({
      generation: 0,
      attached: false,
      sourceLease: '1:2:9',
    });

    // Publish gen1 while the gen0 operation still owns the request slot. This
    // is the lost-edge ordering: the next supply must wait for the old result
    // to settle before issuing the current lease's operation.
    const attachedHistory = historyFor({
      request,
      attached: true,
      generation: 1,
      messageCurrent: true,
      sourceLease: '1:3:10',
    });
    rerender({ history: attachedHistory });
    expect(request).toHaveBeenCalledOnce();
    expect(result.current.viewport.status).toMatchObject({
      generation: 1,
      attached: true,
      messageCurrent: true,
      sourceLease: '1:3:10',
    });

    await act(async () => {
      settleFirst({ kind: 'cancelled' });
      await first;
    });

    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request.mock.calls[1][0]).toMatchObject({
      reason: 'projection-underfill',
      urgency: 'anticipatory',
      viewSpec: expect.objectContaining({ scope: 'mine', selfId: 'human:sz179:1' }),
    });
    expect(result.current.viewport.status).toMatchObject({
      generation: 1,
      attached: true,
      sourceLease: '1:3:10',
    });
    unmount();
  });
});
