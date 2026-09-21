// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const VIEW_SPEC = Object.freeze({
  scope: 'mine',
  selfId: 'human:sz181:1',
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function stateFor() {
  const replica = createChannelReplicaStore();
  const base = replica.ensure('local-frontier').state;
  return {
    ...base,
    channelId: 'local-frontier',
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

function historyFor(request, overrides = {}) {
  return {
    request,
    refreshLatest: vi.fn(),
    status: {
      channelId: 'local-frontier',
      attached: false,
      generation: 0,
      messageCurrent: false,
      headSeq: 90,
      oldestSeq: 61,
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
      sourceLease: '1:2:9',
      presentationAdmission: admission(),
      ...overrides,
    },
  };
}

describe('SZ-181 local-only exhaustion and real supply progress', () => {
  it('closes one local obligation and reopens only for source/cache progress', async () => {
    // 用户能力：本地缓存到达边界时维持可理解的供给状态，并在新供给出现后继续读取。
    // 不变量：localOnly exhausted 只结算当前 supply certificate；demand revision 本身不是新供给。
    // 公开 owner：useConversationProjection → useHistoryConsumer viewport。
    let settleFirst;
    const first = new Promise((resolve) => { settleFirst = resolve; });
    const request = vi.fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValue({ kind: 'exhausted', localOnly: true });
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
      messageListKey: 'local-frontier:mine',
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: vi.fn(),
    };
    const { result, rerender, unmount } = renderHook(
      ({ history }) => useConversationProjection({ ...base, history }),
      { initialProps: { history: historyFor(request) } },
    );

    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(request.mock.calls[0][0]).toMatchObject({
      reason: 'projection-underfill',
      urgency: 'anticipatory',
      viewSpec: expect.objectContaining({ scope: 'mine', selfId: 'human:sz181:1' }),
    });

    // A foreground demand publication alone does not name a new local page.
    rerender({ history: historyFor(request, {
      historyDemand: { revision: 1, phase: 'pending', error: '' },
    }) });
    await act(async () => {
      settleFirst({ kind: 'exhausted', localOnly: true });
      await first;
    });
    rerender({ history: historyFor(request, {
      historyDemand: { revision: 2, phase: 'idle', error: '' },
    }) });
    await act(async () => { await Promise.resolve(); });
    expect(request).toHaveBeenCalledOnce();

    // A committed cache/frontier advance is real supply and reopens exactly
    // the same public underfill obligation once.
    rerender({ history: historyFor(request, { completedPages: 2, oldestSeq: 41 }) });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request.mock.calls[1][0]).toMatchObject({
      reason: 'projection-underfill',
      urgency: 'anticipatory',
    });

    // Source lease replacement and later Wire attachment are separate current
    // authorities; neither is sealed by the old gen0 local-only result.
    rerender({ history: historyFor(request, {
      completedPages: 2,
      oldestSeq: 41,
      sourceLease: '1:3:10',
    }) });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    rerender({ history: historyFor(request, {
      attached: true,
      generation: 1,
      messageCurrent: true,
      completedPages: 2,
      oldestSeq: 41,
      sourceLease: '1:3:10',
    }) });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(4));
    expect(result.current.viewport.status).toMatchObject({
      attached: true,
      generation: 1,
      messageCurrent: true,
      sourceLease: '1:3:10',
      completedPages: 2,
      oldestSeq: 41,
    });
    unmount();
  });
});
