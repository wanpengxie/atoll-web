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

function historyFor({ generation, sourceLease, request }) {
  const attached = generation > 0;
  return {
    request,
    refreshLatest: vi.fn(),
    status: {
      channelId: 'c0',
      attached,
      generation,
      sourceLease,
      messageCurrent: attached,
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
    const request = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementation(() => new Promise(() => {}));
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
          history: historyFor({ generation: 0, sourceLease: 'source-A', request }),
        },
      },
    );

    // The current public projection owner creates the one anticipatory
    // underfill demand for the local empty window.
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(request.mock.calls[0][0]).toMatchObject({
      reason: 'projection-underfill',
      urgency: 'anticipatory',
    });

    await act(async () => {
      settleFirst({ kind: 'cancelled' });
      await first;
    });

    // Source B then C replace the authority while the same public Reading
    // owner is still mounted. Only one successor supply operation may exist.
    rerender({ history: historyFor({ generation: 1, sourceLease: 'source-B', request }) });
    rerender({ history: historyFor({ generation: 2, sourceLease: 'source-C', request }) });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.viewport.status).toMatchObject({
      generation: 2,
      sourceLease: 'source-C',
      hasOlder: true,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0]).toMatchObject({
      reason: 'projection-underfill',
      urgency: 'anticipatory',
    });
    unmount();
  });
});
