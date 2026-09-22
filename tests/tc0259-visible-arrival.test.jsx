// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const SELF = 'human:tc0259:1';

function request(id, seq) {
  return {
    id,
    kind: 'request',
    type: 'human.approve',
    sender: { id: 'agent:steward' },
    audience: [SELF],
    payload: { body: { text: id } },
    seq,
  };
}

function row(channelID, seq, envelope, source = 'history') {
  return { channel_id: channelID, seq, envelope, source, generation: 1 };
}

function historyFor(headSeq, presentationRevision = headSeq) {
  const presentationAdmission = {
    evaluate: (_channelID, items) => ({ items, receipt: null }),
    sourceFence: () => headSeq,
  };
  return {
    request: vi.fn(() => Promise.resolve({ kind: 'exhausted', localOnly: true })),
    refreshLatest: vi.fn(),
    status: {
      attached: true,
      generation: 1,
      messageCurrent: true,
      headSeq,
      coverage: [{ lowSeq: 1, highSeq: headSeq }],
      loaded: true,
      completedPages: 1,
      hasOlder: false,
      buffered: 0,
      loading: false,
      localReplicaReady: true,
      presentationRevision,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 0, fulfilledRevision: 0, targetHead: headSeq },
      presentationAdmission,
    },
  };
}

function renderProjection(state) {
  const viewSessions = {
    readView: () => ({}),
    save: vi.fn(),
    activate: vi.fn(),
    deactivate: vi.fn(),
  };
  const args = {
    state,
    viewSessions,
    historyViewSpec: {
      scope: 'all',
      selfId: SELF,
      actorFilter: new Set(),
      editingTargetId: '',
      editingReplacementId: '',
      showNarration: false,
    },
    messageListKey: 'c0:all',
    timelineLocalEchoes: [],
    identityPending: false,
    surfaceVisible: true,
    onTailCaughtUp: vi.fn(),
  };
  return renderHook(
    ({ history }) => useConversationProjection({ ...args, history }),
    { initialProps: { history: historyFor(2, 2) } },
  );
}

describe('TC0259 visible arrival accumulation', () => {
  it.skip('keeps the first arrival when latest is interrupted before its settled paint', () => {
    const replica = createChannelReplicaStore();
    const state = replica.ensure('c0').state;
    replica.commit(row('c0', 1, request('old-1', 1)), SELF, (value) => value, { source: 'history' });
    replica.commit(row('c0', 2, request('old-2', 2)), SELF, (value) => value, { source: 'history' });

    const { result, rerender } = renderProjection(state);
    act(() => result.current.viewport.beginNavigation({ direction: 'older', gestureID: 'browse-1' }));

    replica.commit(row('c0', 3, request('arrival-1', 3), 'live'), SELF, (value) => value, { source: 'live' });
    rerender({ history: historyFor(3, 3) });
    expect(result.current.viewport.unseenNotice).toBe(1);

    // The jump command is only an intent. No settled physical receipt exists.
    act(() => result.current.viewport.jumpToLatest());
    expect(state.arrivalReceipts.timeline().events).toHaveLength(1);

    // A wheel before paint revokes that intent; the first arrival remains
    // pending while a second arrival is appended.
    act(() => result.current.viewport.beginNavigation({ direction: 'older', gestureID: 'browse-2' }));
    replica.commit(row('c0', 4, request('arrival-2', 4), 'live'), SELF, (value) => value, { source: 'live' });
    rerender({ history: historyFor(4, 4) });

    expect(result.current.viewport.unseenNotice).toBe(2);
    expect(state.arrivalReceipts.timeline().events.map((event) => event.rowID))
      .toEqual(['arrival-1', 'arrival-2']);
  });
});
