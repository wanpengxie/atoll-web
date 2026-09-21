// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const VIEW_SPEC = Object.freeze({
  scope: 'all',
  selfId: 'human:sz186:1',
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function message(id, seq) {
  return {
    kind: 'standalone',
    seq,
    envelope: {
      id,
      seq,
      ts: seq * 1_000,
      type: 'human.note',
      sender: { id: 'human:other:1', kind: 'human' },
      audience: ['human:sz186:1'],
      payload: { body: { text: id } },
    },
  };
}

function stateFor(rows, sourceRevision) {
  const replica = createChannelReplicaStore();
  const base = replica.ensure('c0').state;
  const lastSeq = rows.at(-1)?.seq || 0;
  return {
    ...base,
    channelId: 'c0',
    timeline: rows,
    lastSeq,
    _timelineRevision: sourceRevision,
    _timelineProjectionVersion: sourceRevision,
  };
}

const ADMISSION = Object.freeze({
  // No sourceFence override: projectTimeline must expose the Replica's
  // _timelineRevision as the public projection sourceRevision.
  evaluate: (_channelID, items) => ({ items, receipt: null }),
});

function historyFor({ request, presentationRevision, attached, generation, headSeq }) {
  return {
    request,
    refreshLatest: vi.fn(),
    status: {
      channelId: 'c0',
      attached,
      generation,
      messageCurrent: attached,
      headSeq,
      oldestSeq: 1,
      coverage: headSeq ? [{ lowSeq: 1, highSeq: headSeq }] : [],
      loaded: true,
      completedPages: attached ? 1 : 0,
      hasOlder: false,
      buffered: 0,
      loading: false,
      localReplicaReady: true,
      sourceLease: attached ? 'sz186-lease' : '',
      presentationRevision,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: {
        interestRevision: headSeq ? 1 : 0,
        fulfilledRevision: headSeq ? 1 : 0,
        targetHead: headSeq,
        error: '',
      },
      presentationAdmission: ADMISSION,
    },
  };
}

describe('SZ-186 fresh following cached projection authority', () => {
  it('shows cached rows immediately but withholds tail authority until Replica revision catches up', async () => {
    const request = vi.fn();
    const viewSessions = {
      readView: () => ({ mode: 'following', revision: 0 }),
      activate: vi.fn(),
      save: vi.fn(() => true),
      deactivate: vi.fn(),
    };
    const base = {
      viewSessions,
      historyViewSpec: VIEW_SPEC,
      messageListKey: 'c0:all',
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: vi.fn(),
    };
    const emptyState = stateFor([], 0);
    const laggingState = stateFor([message('head-row', 7)], 10);
    const currentState = stateFor([message('head-row', 7)], 11);
    const emptyHistory = historyFor({
      request,
      presentationRevision: 0,
      attached: false,
      generation: 0,
      headSeq: 0,
    });
    const laggingHistory = historyFor({
      request,
      presentationRevision: 11,
      attached: true,
      generation: 1,
      headSeq: 99,
    });
    const currentHistory = historyFor({
      request,
      presentationRevision: 11,
      attached: true,
      generation: 1,
      headSeq: 99,
    });
    const { result, rerender, unmount } = renderHook(
      ({ state, history }) => useConversationProjection({ ...base, state, history }),
      { initialProps: { state: emptyState, history: emptyHistory } },
    );

    await waitFor(() => expect(result.current.viewport.initializing).toBe(true));
    expect(request).not.toHaveBeenCalled();

    rerender({ state: laggingState, history: laggingHistory });
    await waitFor(() => expect(result.current.viewport.initializing).toBe(false));
    expect(result.current.projection.presentation.rows.map((row) => row.id)).toContain('head-row');
    expect(result.current.projection.presentation.sourceRevision).toBe(10);
    expect(result.current.viewport.availability).toBe('readable');
    expect(result.current.viewport.bottomReady).toBe(false);
    expect(result.current.viewport.tailCaughtUp.caughtUp).toBe(false);
    expect(request).not.toHaveBeenCalled();

    act(() => {
      result.current.viewport.onSurfaceVisibilityChange(true);
    });
    expect(result.current.viewport.bottomReady).toBe(false);

    rerender({ state: currentState, history: currentHistory });
    await waitFor(() => expect(result.current.viewport.bottomReady).toBe(true));
    expect(result.current.projection.presentation.sourceRevision).toBe(11);
    expect(result.current.viewport.availability).toBe('readable');
    expect(result.current.projection.presentation.rows.map((row) => row.id)).toEqual(['head-row']);
    // This test proves semantic following authority only; no physical Vendor
    // receipt is manufactured by a cached Projection rerender.
    expect(result.current.viewport.tailCaughtUp.caughtUp).toBe(false);
    expect(request).not.toHaveBeenCalled();
    unmount();
  });
});
