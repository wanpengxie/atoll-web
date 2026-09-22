// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const VIEW_SPEC = Object.freeze({
  scope: 'all',
  selfId: 'human:sz184:1',
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function stateFor() {
  const replica = createChannelReplicaStore();
  const base = replica.ensure('restore-retry').state;
  return {
    ...base,
    channelId: 'restore-retry',
    timeline: [],
    lastSeq: 0,
    _timelineRevision: 1,
    _timelineProjectionVersion: 1,
  };
}

function admission() {
  return {
    evaluate: (_channelID, items) => ({ items, receipt: null }),
    sourceFence: () => 90,
  };
}

function historyFor(request, overrides = {}) {
  return {
    request,
    refreshLatest: vi.fn(),
    status: {
      channelId: 'restore-retry',
      attached: true,
      generation: 1,
      messageCurrent: true,
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
      historyDemand: { revision: 1, phase: 'error', error: 'offline' },
      sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: 90, error: '' },
      sourceLease: '1:3:10',
      presentationAdmission: admission(),
      ...overrides,
    },
  };
}

describe('SZ-184 saved bookmark retry after unmount cancellation', () => {
  it.skip('cancels the active restore on unmount and retries the same immutable target', async () => {
    const signals = [];
    const request = vi.fn((options) => {
      signals.push(options.signal);
      if (request.mock.calls.length === 1) {
        return Promise.resolve({ kind: 'failed', error: new Error('offline') });
      }
      return new Promise((resolve) => {
        options.signal.addEventListener('abort', () => resolve({ kind: 'cancelled' }), { once: true });
      });
    });
    const viewSessions = {
      readView: () => ({
        mode: 'browsing',
        revision: 1,
        bookmark: { messageID: 'saved-target', seq: 3, rowViewportOffset: 8 },
      }),
      activate: vi.fn(),
      save: vi.fn(() => true),
      deactivate: vi.fn(),
    };
    const base = {
      state: stateFor(),
      viewSessions,
      historyViewSpec: VIEW_SPEC,
      messageListKey: 'restore-retry:all',
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: vi.fn(),
    };
    const { result, unmount } = renderHook(
      ({ history }) => useConversationProjection({ ...base, history }),
      { initialProps: { history: historyFor(request) } },
    );

    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { void result.current.viewport.retryHistoryDemand(); });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));

    for (const [options] of request.mock.calls) {
      expect(options).toMatchObject({
        intent: 'initial-view',
        targetSeq: 3,
        requiredVisibleCoverage: { messageID: 'saved-target', seq: 3 },
      });
    }

    unmount();
    expect(signals[1].aborted).toBe(true);
  });
});
