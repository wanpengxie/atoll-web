// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { createViewSessionStore } from '../src/model/view-session.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const SELF = 'human:sz205:1';
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

function final(id, parentID, seq) {
  return {
    id,
    kind: 'response',
    type: 'human.approve',
    parent_id: parentID,
    sender: { id: 'agent:steward' },
    audience: [SELF],
    payload: { body: { status: 'completed', text: id } },
    seq,
  };
}

function row(seq, envelope, source = 'history') {
  return { channel_id: 'c0', seq, envelope, source, generation: 1 };
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

function renderProjection(state, viewSessions) {
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
    { initialProps: { history: historyFor(1100, 1100) } },
  );
}

function tailObservation(result) {
  const viewport = result.current.viewport;
  const status = viewport.status || {};
  const session = viewport.getSession();
  const presentation = result.current.projection.presentation;
  const presentationRevision = Number(presentation.revision || 0);
  const tailID = String(presentation.rows.at(-1)?.id || '');
  const identity = {
    activationID: viewport.activationID,
    inputEpoch: Number(session.inputEpoch),
    intentRevision: Number(session.intentRevision || 0),
    presentationRevision,
    tailID,
    generation: Number(status.generation || 0),
    authorityRevision: Number(status.notificationAuthorityRevision || 0),
    rootIdentity: 1,
  };
  return {
    type: 'reading-authority',
    activationID: viewport.activationID,
    inputEpoch: Number(session.inputEpoch),
    source: 'user',
    atTail: true,
    settled: true,
    surfaceVisible: true,
    installedHighSeq: Number(status.headSeq || 0),
    presentationRevision,
    domPresentationRevision: presentationRevision,
    rootIdentity: 1,
    rootNode: ROOT_NODE,
    tailID,
    visibleRows: [{ messageID: tailID }],
    visibleRowIDs: [tailID],
    observationIdentity: identity,
    geometryRevision: 0,
  };
}

describe('SZ205 live arrival overflow public owner', () => {
  it.skip('retains an overflowed 1100-identity batch and de-duplicates a newer stable identity', async () => {
    const replica = createChannelReplicaStore();
    const state = replica.ensure('c0').state;
    const sessions = createViewSessionStore({ storage: null });
    for (let seq = 1; seq <= 1100; seq += 1) {
      replica.commit(row(seq, request(`old-${seq}`, seq)), SELF, (value) => value, { source: 'history' });
    }

    const { result, rerender } = renderProjection(state, sessions);
    act(() => result.current.viewport.onReadingRootActivation({ rootNode: ROOT_NODE, rootIdentity: 1 }));
    act(() => result.current.viewport.beginNavigation({ direction: 'older', gestureID: 'browse-1' }));

    for (let seq = 1; seq <= 1100; seq += 1) {
      replica.commit(row(1100 + seq, request(`live-${seq}`, 1100 + seq), 'live'), SELF, (value) => value, { source: 'live' });
    }
    rerender({ history: historyFor(2200, 2200) });

    expect(result.current.viewport.unseenNotice).toBe(1100);
    expect(state.arrivalReceipts.timeline().events).toHaveLength(1100);
    expect(state.arrivalReceipts.timeline().events.at(0)).toMatchObject({ key: 'live-1', seq: 1101 });

    replica.commit(row(2201, final('live-1-update', 'live-1', 2201), 'live'), SELF, (value) => value, { source: 'live' });
    rerender({ history: historyFor(2201, 2201) });

    expect(result.current.viewport.unseenNotice).toBe(1100);
    expect(sessions.readView('c0', 'c0:all').unseenRecords).toHaveLength(1100);
    expect(sessions.readView('c0', 'c0:all').unseenRecords)
      .toContainEqual(['live-1', 2201]);
    expect(state.arrivalReceipts.timeline().events).toHaveLength(1101);

    // The actual tail paint is the only acknowledgement boundary. Rebind the
    // status receipt to the committed Presentation revision before reporting
    // the hit-tested tail; this keeps the test on the public authority tuple.
    rerender({ history: historyFor(2201, result.current.projection.presentation.revision) });
    act(() => result.current.viewport.beginNavigation({
      direction: 'newer', gestureID: 'drag-to-tail', geometryRevision: 0,
    }));
    act(() => {
      expect(result.current.viewport.onReadingObservation(tailObservation(result))).toBe(true);
    });
    await waitFor(() => expect(result.current.viewport.tailCaughtUp.caughtUp).toBe(true));
    rerender({ history: historyFor(2201, result.current.projection.presentation.revision) });
    expect(state.arrivalReceipts.timeline().events).toEqual([]);
    expect(sessions.readView('c0', 'c0:all').unseenRecords).toEqual([]);
  });
});
