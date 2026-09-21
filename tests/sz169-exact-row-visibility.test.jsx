// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const SELF = 'human:sz169:1';
const ROOT_NODE = {};

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

function observationFor(viewport, projection, visibleRowID) {
  const status = viewport.status || {};
  const session = viewport.getSession();
  const presentation = projection.projection.presentation;
  const presentationRevision = Number(presentation.revision || 0);
  const tailID = String(presentation.rows.at(-1)?.id || '');
  return {
    type: 'reading-authority',
    activationID: viewport.activationID,
    inputEpoch: Number(session.inputEpoch),
    source: 'layout',
    // The exact arrival row is the committed tail, but the settled paint saw
    // another row. This is a valid non-tail observation, not an empty oracle.
    atTail: false,
    settled: true,
    surfaceVisible: true,
    installedHighSeq: Number(status.headSeq || 0),
    presentationRevision,
    domPresentationRevision: presentationRevision,
    rootIdentity: 1,
    rootNode: ROOT_NODE,
    tailID,
    visibleRows: [{ messageID: visibleRowID }],
    visibleRowIDs: [visibleRowID],
    observationIdentity: {
      activationID: viewport.activationID,
      inputEpoch: Number(session.inputEpoch),
      intentRevision: Number(session.intentRevision || 0),
      presentationRevision,
      tailID,
      generation: Number(status.generation || 0),
      authorityRevision: Number(status.notificationAuthorityRevision || 0),
      rootIdentity: 1,
    },
  };
}

describe('SZ-169 exact-row Reading observation contract', () => {
  it('keeps a committed arrival unseen when its exact row is absent from the settled paint', () => {
    const replica = createChannelReplicaStore();
    const state = replica.ensure('c0').state;
    replica.commit(row('c0', 1, request('old-1', 1)), SELF, (value) => value, { source: 'history' });
    replica.commit(row('c0', 2, request('old-2', 2)), SELF, (value) => value, { source: 'history' });

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
    const { result, rerender } = renderHook(
      ({ history }) => useConversationProjection({ ...args, history }),
      { initialProps: { history: historyFor(2, 2) } },
    );

    act(() => result.current.viewport.beginNavigation({ direction: 'older', gestureID: 'sz169-browse' }));

    replica.commit(row('c0', 3, request('hidden-turn', 3), 'live'), SELF, (value) => value, { source: 'live' });
    rerender({ history: historyFor(3, 3) });

    expect(result.current.projection.presentation.rows.map((entry) => entry.id)).toContain('hidden-turn');
    expect(result.current.viewport.unseenNotice).toBe(1);
    expect(state.arrivalReceipts.timeline().events).toEqual([
      expect.objectContaining({ key: 'hidden-turn', rowID: 'hidden-turn', seq: 3 }),
    ]);

    const exactRowNotVisible = observationFor(result.current.viewport, result.current, 'old-2');
    expect(exactRowNotVisible.visibleRowIDs).not.toContain('hidden-turn');
    act(() => {
      expect(result.current.viewport.onReadingObservation(exactRowNotVisible)).toBe(true);
    });

    // The settled paint did not contain the committed row, so the receipt and
    // the user-facing unseen obligation remain pending. No private Replica
    // field is used as evidence.
    expect(result.current.viewport.tailCaughtUp.caughtUp).toBe(false);
    expect(result.current.viewport.unseenNotice).toBe(1);
    expect(state.arrivalReceipts.timeline().events).toEqual([
      expect.objectContaining({ key: 'hidden-turn', rowID: 'hidden-turn', seq: 3 }),
    ]);
  });
});
