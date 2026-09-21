// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const VIEW_SPEC = Object.freeze({
  scope: 'all',
  selfId: 'human:sz185:1',
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
      seq: 1,
      envelope: {
        id: 'cached-row',
        seq: 1,
        ts: 1_000,
        type: 'human.note',
        sender: { id: 'human:other:1', kind: 'human' },
        payload: { body: { text: 'cached readable row' } },
      },
    }],
    lastSeq: 1,
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

function historyFor({ retryLocalReplica, localReplicaReady = true, localReplicaError = '' }) {
  return {
    request: vi.fn(),
    refreshLatest: vi.fn(),
    retryLocalReplica,
    status: {
      channelId: 'c0',
      attached: false,
      generation: 0,
      messageCurrent: false,
      headSeq: 0,
      oldestSeq: 1,
      coverage: [{ lowSeq: 1, highSeq: 1 }],
      loaded: true,
      completedPages: 1,
      hasOlder: false,
      buffered: 0,
      loading: false,
      localReplicaReady,
      localReplicaError,
      localReplicaErrorCode: localReplicaError ? 'cache_selection_timeout' : '',
      sourceLease: '1:2:9',
      presentationRevision: 1,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 0, fulfilledRevision: 0, targetHead: 0, error: '' },
      presentationAdmission: admission(),
    },
  };
}

describe('SZ-185 detached cache retry public projection', () => {
  it('keeps readable rows readable while exposing independent cache error and retry', async () => {
    const retryLocalReplica = vi.fn(() => Promise.resolve(true));
    const state = stateFor();
    const viewSessions = {
      readView: () => ({ mode: 'following', revision: 0 }),
      activate: vi.fn(),
      save: vi.fn(() => true),
      deactivate: vi.fn(),
    };
    const { result, rerender, unmount } = renderHook(
      ({ history }) => useConversationProjection({
        state,
        history,
        viewSessions,
        historyViewSpec: VIEW_SPEC,
        messageListKey: 'c0:all',
        timelineLocalEchoes: [],
        identityPending: false,
        surfaceVisible: true,
        onTailCaughtUp: vi.fn(),
      }),
      { initialProps: { history: historyFor({ retryLocalReplica, localReplicaError: '本地缓存初始化超时，请重试' }) } },
    );

    await waitFor(() => expect(result.current.viewport.availability).toBe('readable'));
    expect(result.current.projection.presentation.rows.map((row) => row.id)).toContain('cached-row');
    expect(result.current.viewport.cache).toEqual({
      phase: 'error',
      error: '本地缓存初始化超时，请重试',
      code: 'cache_selection_timeout',
    });

    await act(async () => {
      await result.current.viewport.retryAvailability();
    });
    expect(retryLocalReplica).toHaveBeenCalledOnce();

    rerender({ history: historyFor({ retryLocalReplica, localReplicaReady: false }) });
    expect(result.current.viewport.availability).toBe('readable');
    expect(result.current.viewport.cache).toMatchObject({ phase: 'pending' });
    unmount();
  });
});
