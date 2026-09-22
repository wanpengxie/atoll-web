// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const SELF = 'human:sz204:1';

const VIEW_SPEC = Object.freeze({
  scope: 'all',
  selfId: SELF,
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function request(id, seq) {
  return {
    id,
    kind: 'request',
    type: 'human.approve',
    sender: { id: 'agent:live' },
    audience: [SELF],
    payload: { body: { text: id } },
    seq,
  };
}

function final(id, parentID, seq) {
  return {
    id,
    kind: 'response',
    type: 'human.approve',
    parent_id: parentID,
    sender: { id: 'agent:live' },
    audience: [SELF],
    payload: { body: { status: 'completed', text: id } },
    seq,
  };
}

function liveRow(channelID, seq, envelope) {
  return { channel_id: channelID, seq, envelope, source: 'live', generation: 1 };
}

function historyFor(channelId, headSeq) {
  return {
    request: vi.fn(() => Promise.resolve({ kind: 'loaded' })),
    refreshLatest: vi.fn(),
    status: {
      channelId,
      attached: true,
      generation: 1,
      sourceLease: 'sz204-source',
      messageCurrent: true,
      headSeq,
      oldestSeq: 1,
      coverage: [{ lowSeq: 1, highSeq: headSeq }],
      loaded: true,
      completedPages: 1,
      hasOlder: false,
      buffered: 0,
      loading: false,
      localReplicaReady: true,
      presentationRevision: headSeq,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: headSeq, error: '' },
      presentationAdmission: {
        evaluate: (_channelID, items) => ({ items, receipt: null }),
        sourceFence: () => headSeq,
      },
    },
  };
}

describe('SZ-204 live activation unseen public owner', () => {
  it.skip('does not count a stable identity received before the current activation', async () => {
    // 用户能力：进入 browsing 后，动态提示只反映本次 activation 之后的新动态。
    // 不变量：旧 activation 的 arrival 不污染新 activation；同一稳定 identity
    // 仍按当前公开 arrival receipt 计数，而不是按 rows 数量猜测。
    // 公开 owner：ChannelReplica.arrivalReceipts → useTimelineArrivalReceipt → Reading viewport。
    const replica = createChannelReplicaStore();
    const state = replica.ensure('sz204-live').state;
    const releasePriorConsumer = state.arrivalReceipts.attachTimelineConsumer(Symbol('sz204-prior'));
    replica.commit(liveRow('sz204-live', 1, request('prior-live', 1)), SELF, (value) => value, { source: 'live' });
    expect(state.arrivalReceipts.timeline().events).toEqual([
      expect.objectContaining({ key: 'prior-live', rowID: 'prior-live', seq: 1 }),
    ]);

    const viewSessions = {
      readView: () => ({ mode: 'browsing', revision: 2, unseenTail: 0, unseenKeys: [] }),
      activate: vi.fn(),
      save: vi.fn(() => true),
      deactivate: vi.fn(),
    };
    const base = {
      viewSessions,
      historyViewSpec: VIEW_SPEC,
      messageListKey: 'sz204-live:all',
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: vi.fn(),
    };
    const { result, rerender, unmount } = renderHook(
      ({ state: nextState, history }) => useConversationProjection({
        ...base,
        state: nextState,
        history,
      }),
      { initialProps: { state: { ...state }, history: historyFor('sz204-live', 1) } },
    );

    await waitFor(() => expect(result.current.viewport.availability).toBe('readable'));
    expect(result.current.viewport.unseenNotice).toBe(0);

    act(() => {
      replica.commit(liveRow('sz204-live', 2, request('current-live', 2)), SELF, (value) => value, { source: 'live' });
      rerender({ state: { ...state }, history: historyFor('sz204-live', 2) });
    });
    await waitFor(() => expect(result.current.viewport.unseenNotice).toBe(1));
    expect(result.current.viewport.unseen).toBe(1);
    expect(state.arrivalReceipts.timeline().events.map((event) => event.rowID)).toEqual([
      'prior-live',
      'current-live',
    ]);

    releasePriorConsumer();
    unmount();
  });

  it.skip('counts a stable live identity received after the current activation once', async () => {
    const replica = createChannelReplicaStore();
    const state = replica.ensure('sz204-current').state;
    replica.commit({
      channel_id: 'sz204-current',
      seq: 1,
      envelope: {
        id: 'history-row',
        kind: 'request',
        type: 'human.approve',
        sender: { id: 'agent:history' },
        audience: [SELF],
        payload: { body: { text: 'history-row' } },
      },
      source: 'history',
      generation: 1,
    }, SELF, (value) => value, { source: 'history' });

    const viewSessions = {
      readView: () => ({ mode: 'browsing', revision: 2, unseenTail: 0, unseenKeys: [] }),
      activate: vi.fn(),
      save: vi.fn(() => true),
      deactivate: vi.fn(),
    };
    const base = {
      viewSessions,
      state: { ...state },
      historyViewSpec: VIEW_SPEC,
      messageListKey: 'sz204-current:all',
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: vi.fn(),
    };
    const { result, rerender, unmount } = renderHook(
      ({ state: nextState, history }) => useConversationProjection({
        ...base,
        state: nextState,
        history,
      }),
      { initialProps: { state: { ...state }, history: historyFor('sz204-current', 1) } },
    );

    await waitFor(() => expect(result.current.viewport.availability).toBe('readable'));
    expect(result.current.viewport.unseenNotice).toBe(0);

    act(() => {
      replica.commit(liveRow('sz204-current', 2, request('current-only', 2)), SELF, (value) => value, { source: 'live' });
      rerender({ state: { ...state }, history: historyFor('sz204-current', 2) });
    });
    await waitFor(() => expect(result.current.viewport.unseenNotice).toBe(1));
    expect(result.current.viewport.unseen).toBe(1);
    expect(state.arrivalReceipts.timeline().events).toEqual([
      expect.objectContaining({ key: 'current-only', rowID: 'current-only', seq: 2 }),
    ]);
    unmount();
  });

  it.skip('captures each activation prefix and counts one stable identity after re-entry', async () => {
    const replica = createChannelReplicaStore();
    const state = replica.ensure('sz204-reentry').state;
    const viewSessions = {
      readView: () => ({ mode: 'browsing', revision: 2, unseenTail: 0, unseenKeys: [] }),
      activate: vi.fn(),
      save: vi.fn(() => true),
      deactivate: vi.fn(),
    };
    const base = {
      viewSessions,
      historyViewSpec: VIEW_SPEC,
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: vi.fn(),
    };
    const { result, rerender, unmount } = renderHook(
      ({ state: nextState, viewKey, history }) => useConversationProjection({
        ...base,
        state: nextState,
        messageListKey: viewKey,
        history,
      }),
      {
        initialProps: {
          state: { ...state },
          viewKey: 'sz204-reentry:all:a',
          history: historyFor('sz204-reentry', 0),
        },
      },
    );

    await waitFor(() => expect(result.current.viewport.activationID).toBeTruthy());
    const activationA = result.current.viewport.activationID;
    act(() => {
      replica.commit(liveRow('sz204-reentry', 1, request('stable-root', 1)), SELF, (value) => value, { source: 'live' });
      rerender({
        state: { ...state },
        viewKey: 'sz204-reentry:all:a',
        history: historyFor('sz204-reentry', 1),
      });
    });
    await waitFor(() => expect(result.current.viewport.unseenNotice).toBe(1));

    act(() => {
      rerender({
        state: { ...state },
        viewKey: 'sz204-reentry:all:b',
        history: historyFor('sz204-reentry', 1),
      });
    });
    await waitFor(() => expect(result.current.viewport.activationID).not.toBe(activationA));
    expect(result.current.viewport.unseenNotice).toBe(0);

    act(() => {
      replica.commit(liveRow('sz204-reentry', 2, final('stable-final', 'stable-root', 2)), SELF, (value) => value, { source: 'live' });
      rerender({
        state: { ...state },
        viewKey: 'sz204-reentry:all:b',
        history: historyFor('sz204-reentry', 2),
      });
    });
    await waitFor(() => expect(result.current.viewport.unseenNotice).toBe(1));
    expect(result.current.viewport.unseen).toBe(1);
    expect(state.arrivalReceipts.timeline().events.at(-1)).toEqual(expect.objectContaining({
      key: 'stable-root',
      seq: 2,
    }));

    act(() => rerender({
      state: { ...state },
      viewKey: 'sz204-reentry:all:b',
      history: historyFor('sz204-reentry', 2),
    }));
    await waitFor(() => expect(result.current.viewport.unseenNotice).toBe(1));
    expect(result.current.viewport.unseen).toBe(1);
    unmount();
  });
});
