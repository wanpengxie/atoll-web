// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const message = (id, seq, senderID) => ({
  kind: 'standalone',
  seq,
  envelope: {
    id,
    seq,
    ts: seq * 1_000,
    type: 'project.task',
    sender: { id: senderID },
    payload: { body: { text: id } },
  },
});

const ROOT_NODE = {};

function observationFor(viewport) {
  const status = viewport.status || {};
  const session = viewport.getSession();
  return {
    type: 'reading-authority',
    activationID: viewport.activationID,
    inputEpoch: Number(session.inputEpoch),
    source: 'layout',
    atTail: true,
    settled: true,
    surfaceVisible: true,
    installedHighSeq: 2,
    presentationRevision: 1,
    domPresentationRevision: 1,
    rootIdentity: 1,
    rootNode: ROOT_NODE,
    tailID: 'visible',
    visibleRows: [{ messageID: 'visible' }],
    visibleRowIDs: ['visible'],
    observationIdentity: {
      activationID: viewport.activationID,
      inputEpoch: Number(session.inputEpoch),
      intentRevision: Number(session.intentRevision || 0),
      presentationRevision: 1,
      tailID: 'visible',
      generation: Number(status.generation || 0),
      authorityRevision: Number(status.notificationAuthorityRevision || 0),
      rootIdentity: 1,
    },
  };
}

function history() {
  const presentationAdmission = {
    evaluate: (_channelID, items) => ({ items, receipt: null }),
    sourceFence: () => 2,
  };
  return {
    request: vi.fn(() => Promise.resolve({ kind: 'exhausted', localOnly: true })),
    refreshLatest: vi.fn(),
    status: {
      attached: true,
      generation: 1,
      messageCurrent: true,
      headSeq: 2,
      coverage: [{ lowSeq: 1, highSeq: 2 }],
      loaded: true,
      completedPages: 1,
      hasOlder: false,
      buffered: 0,
      loading: false,
      localReplicaReady: true,
      presentationRevision: 2,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 0, fulfilledRevision: 0, targetHead: 2 },
      presentationAdmission,
    },
  };
}

function renderFilteredTail(onTailCaughtUp) {
  const replica = createChannelReplicaStore();
  const replicaState = replica.ensure('c0').state;
  const state = {
    ...replicaState,
    channelId: 'c0',
    // The physical timeline contains both identities. The current Presentation
    // for this actor-filtered view installs only `visible`.
    timeline: [message('hidden', 1, 'agent-b'), message('visible', 2, 'agent-a')],
    lastSeq: 2,
    _timelineRevision: 2,
    _timelineProjectionVersion: 2,
  };
  const args = {
    state,
    history: history(),
    viewSessions: {
      readView: () => ({}),
      save: vi.fn(),
      activate: vi.fn(),
      deactivate: vi.fn(),
    },
    historyViewSpec: {
      scope: 'mine',
      selfId: '',
      actorFilter: new Set(['agent-a']),
      editingTargetId: '',
      editingReplacementId: '',
      showNarration: false,
    },
    messageListKey: 'c0:mine:agent-a',
    timelineLocalEchoes: [],
    identityPending: false,
    surfaceVisible: true,
    onTailCaughtUp,
  };
  return renderHook(() => useConversationProjection(args));
}

describe('S-Z SZ213 filtered-tail installed identities', () => {
  it.skip('acknowledges only the actor-filtered Presentation rows and never the physical cursor', () => {
    const receiptSink = vi.fn();
    const { result } = renderFilteredTail(receiptSink);

    act(() => {
      result.current.viewport.onReadingObservation(observationFor(result.current.viewport));
    });

    expect(result.current.projection.presentation.rows.map((row) => row.id)).toEqual(['visible']);
    expect(result.current.viewport.tailCaughtUp).toEqual(expect.objectContaining({
      caughtUp: true,
      entryBoundary: 2,
      boundary: 2,
      physicalSeq: 0,
      actorFiltered: true,
      actorFilterCount: 1,
      visibleRowIDs: ['visible'],
    }));
    expect(receiptSink).toHaveBeenCalledWith(expect.objectContaining({
      caughtUp: true,
      visibleRowIDs: ['visible'],
      physicalSeq: 0,
    }));
    expect(receiptSink.mock.calls.flatMap(([receipt]) => receipt?.visibleRowIDs || []))
      .not.toContain('hidden');
  });
});
