// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const VIEW_SPEC = Object.freeze({
  scope: 'all',
  selfId: 'human:sz191:1',
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function stateFor() {
  const replica = createChannelReplicaStore();
  const base = replica.ensure('c0').state;
  return {
    ...base,
    channelId: 'c0',
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
      channelId: 'c0',
      attached: true,
      generation: 7,
      messageCurrent: true,
      headSeq: 1_101,
      oldestSeq: 100,
      coverage: [{ lowSeq: 100, highSeq: 1_101 }],
      loaded: true,
      completedPages,
      hasOlder: true,
      buffered,
      loading: false,
      localReplicaReady: true,
      revealVersion: 0,
      presentationRevision: 211,
      notificationAuthorityRevision: 0,
      sourceLease: '1:2:9',
      historyDemand: { revision: demandRevision, phase: 'idle', error: '' },
      sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: 1_101, error: '' },
      presentationAdmission: admission(),
    },
  };
}

describe('SZ-191 same-generation EOF and reservoir reopen contract', () => {
  it.skip('reopens one visible history obligation after reservoir progress without duplicating it', async () => {
    const request = vi.fn().mockResolvedValue({ kind: 'exhausted' });
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
      messageListKey: 'c0:all',
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

    // Remote EOF closes only the current supply certificate. The visible
    // obligation itself remains addressable through the public underfill port.
    await act(async () => { await result.current.viewport.onUnderfill(); });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toMatchObject({
      reason: 'underfill',
      urgency: 'anticipatory',
    });

    // A later reservoir publication reopens the same obligation exactly once.
    rerender({ history: historyFor({ request, completedPages: 4, buffered: 148 }) });
    await act(async () => { await result.current.viewport.onUnderfill(); });
    expect(request).toHaveBeenCalledTimes(2);

    // A demand revision alone is not new supply and must not replay the
    // already settled operation.
    rerender({ history: historyFor({
      request,
      completedPages: 4,
      buffered: 148,
      demandRevision: 2,
    }) });
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
