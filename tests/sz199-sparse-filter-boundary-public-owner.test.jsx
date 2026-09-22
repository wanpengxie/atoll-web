// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

afterEach(cleanup);

const CHANNEL = 'sparse';
const VIEW_KEY = 'sparse:claude';
const VIEW_SPEC = Object.freeze({
  scope: 'mine',
  selfId: '',
  actorFilter: new Set(['agent:claude:4']),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function stateFor() {
  const replica = createChannelReplicaStore();
  const base = replica.ensure(CHANNEL).state;
  const row = {
    kind: 'standalone',
    seq: 78,
    envelope: {
      id: 'oldest-match',
      seq: 78,
      ts: 78_000,
      type: 'project.task',
      sender: { id: 'agent:claude:4', kind: 'agent' },
      payload: { body: { text: 'sparse filtered match' } },
    },
  };
  return {
    ...base,
    channelId: CHANNEL,
    timeline: [row],
    lastSeq: 78,
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

function historyFor({ hasOlder, buffered }) {
  return {
    request: vi.fn(() => Promise.resolve({ kind: 'exhausted', localOnly: true })),
    refreshLatest: vi.fn(),
    status: {
      channelId: CHANNEL,
      attached: true,
      generation: 4,
      sourceLease: 'sz199-lease',
      messageCurrent: true,
      headSeq: 999,
      oldestSeq: 78,
      coverage: [{ lowSeq: 1, highSeq: 999 }],
      loaded: true,
      completedPages: 9,
      hasOlder,
      buffered,
      loading: false,
      localReplicaReady: true,
      presentationRevision: 1,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: 999, error: '' },
      presentationAdmission: admission(),
    },
  };
}

describe('SZ-199 sparse-filter history boundary', () => {
  it.skip('publishes filtered exhaustion only after current generation has no buffered supply', async () => {
    const state = stateFor();
    const viewSessions = {
      readView: () => ({ mode: 'browsing', revision: 0 }),
      activate: vi.fn(),
      save: vi.fn(() => true),
      deactivate: vi.fn(),
    };
    const args = {
      state,
      viewSessions,
      historyViewSpec: VIEW_SPEC,
      messageListKey: VIEW_KEY,
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: vi.fn(),
    };
    const { result, rerender } = renderHook(
      ({ history }) => useConversationProjection({ ...args, history }),
      { initialProps: { history: historyFor({ hasOlder: true, buffered: 0 }) } },
    );

    await waitFor(() => expect(result.current.viewport.activationID).toBeTruthy());
    expect(result.current.projection.presentation.rows.map((row) => row.id)).toEqual(['oldest-match']);
    expect(result.current.viewport.historyBoundary).toBeNull();

    // A no-older status with buffered supply is not authoritative EOF for the
    // sparse filter: the current generation still has physical pages to scan.
    rerender({ history: historyFor({ hasOlder: false, buffered: 25 }) });
    await waitFor(() => expect(result.current.viewport.historyBoundary).toBeNull());

    // Only after that same current generation reports no older supply and no
    // buffered physical reservoir may the Reading owner publish the filtered
    // top boundary.
    rerender({ history: historyFor({ hasOlder: false, buffered: 0 }) });
    await waitFor(() => expect(result.current.viewport.historyBoundary).toMatchObject({
      kind: 'exhausted',
      filtered: true,
      actorFiltered: true,
      generation: 4,
    }));
  });
});
