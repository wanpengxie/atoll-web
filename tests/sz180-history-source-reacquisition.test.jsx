// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const VIEW_SPEC = Object.freeze({
  scope: 'mine',
  selfId: 'human:sz180:1',
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function stateFor() {
  const replica = createChannelReplicaStore();
  const state = replica.ensure('c0').state;
  return {
    ...state,
    channelId: 'c0',
    timeline: [],
    lastSeq: 0,
    _timelineRevision: 0,
    _timelineProjectionVersion: 0,
  };
}

function admission() {
  return {
    evaluate: (_channelID, items) => ({ items, receipt: null }),
    sourceFence: () => 90,
  };
}

function historyFor({ sourceLease, request }) {
  return {
    request,
    refreshLatest: vi.fn(),
    status: {
      channelId: 'c0',
      attached: true,
      generation: 1,
      sourceLease,
      messageCurrent: true,
      headSeq: 90,
      oldestSeq: 1,
      coverage: [{ lowSeq: 1, highSeq: 90 }],
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

describe('SZ-180 current history source reacquisition contract', () => {
  it('reacquires once after source A settles and does not duplicate across B to C', async () => {
    let settleFirst;
    const first = new Promise((resolve) => { settleFirst = resolve; });
    const requestA = vi.fn(() => first);
    const requestB = vi.fn(() => new Promise(() => {}));
    let settleSuccessor;
    let successorResult;
    const successor = new Promise((resolve) => {
      settleSuccessor = (result) => {
        successorResult = result;
        resolve(result);
      };
    });
    const requestC = vi.fn(() => successor);
    const state = stateFor();
    const viewSessions = {
      readView: () => ({ mode: 'following', revision: 0 }),
      activate: vi.fn(),
      save: vi.fn(() => true),
      deactivate: vi.fn(),
    };
    const base = {
      state,
      viewSessions,
      historyViewSpec: VIEW_SPEC,
      messageListKey: 'c0:mine',
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: vi.fn(),
    };
    const { result, rerender, unmount } = renderHook(
      ({ history }) => useConversationProjection({ ...base, history }),
      {
        initialProps: {
          history: historyFor({ sourceLease: 'source-A', request: requestA }),
        },
      },
    );

    // The current public projection owner creates the one anticipatory
    // underfill demand for the local empty window.
    await waitFor(() => expect(requestA).toHaveBeenCalledOnce());
    expect(requestA.mock.calls[0][0]).toMatchObject({
      reason: 'projection-underfill',
      urgency: 'anticipatory',
    });

    await act(async () => {
      settleFirst({ kind: 'cancelled' });
      await first;
    });

    // Source B then C replace the authority while the same public Reading
    // owner is still mounted. Only the committed C successor may run; the
    // transient B replacement must not create a second operation.
    await act(async () => {
      rerender({ history: historyFor({ sourceLease: 'source-B', request: requestB }) });
      rerender({ history: historyFor({ sourceLease: 'source-C', request: requestC }) });
    });
    await waitFor(() => expect(requestC).toHaveBeenCalledOnce());
    expect(requestB).not.toHaveBeenCalled();

    expect(result.current.viewport.status).toMatchObject({
      generation: 1,
      attached: true,
      sourceLease: 'source-C',
      messageCurrent: true,
      hasOlder: true,
    });
    expect(requestC.mock.calls[0][0]).toMatchObject({
      reason: 'projection-underfill',
      urgency: 'anticipatory',
    });

    await act(async () => {
      settleSuccessor({ kind: 'loaded' });
      await successor;
    });
    expect(successorResult).toEqual({ kind: 'loaded' });
    expect(requestA).toHaveBeenCalledOnce();
    expect(requestC).toHaveBeenCalledOnce();
    unmount();
  });
});
