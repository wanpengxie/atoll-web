// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const ROOT_NODE = {};

function message(id, seq) {
  return {
    kind: 'standalone',
    seq,
    envelope: {
      id,
      seq,
      ts: seq * 1_000,
      type: 'project.task',
      sender: { id: 'agent-a' },
      payload: { body: { text: id } },
    },
  };
}

function historyFor() {
  const presentationAdmission = {
    evaluate: (_channelID, items) => ({ items, receipt: null }),
    sourceFence: () => 52,
  };
  return {
    request: vi.fn(() => Promise.resolve({ kind: 'exhausted', localOnly: true })),
    refreshLatest: vi.fn(),
    status: {
      attached: true,
      generation: 1,
      messageCurrent: true,
      headSeq: 52,
      coverage: [{ lowSeq: 1, highSeq: 52 }],
      loaded: true,
      completedPages: 1,
      hasOlder: false,
      buffered: 0,
      loading: false,
      localReplicaReady: true,
      presentationRevision: 2,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 0, fulfilledRevision: 0, targetHead: 52 },
      presentationAdmission,
    },
  };
}

function observationFor(viewport, presentation) {
  const status = viewport.status || {};
  const session = viewport.getSession();
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
    source: 'layout',
    atTail: true,
    settled: true,
    surfaceVisible: true,
    // The stable presentation tail is seq 40, while the installed channel
    // high-water also contains the above-viewport seq 52 update.
    installedHighSeq: 52,
    presentationRevision,
    domPresentationRevision: presentationRevision,
    rootIdentity: 1,
    rootNode: ROOT_NODE,
    tailID,
    visibleRows: [{ messageID: tailID }],
    visibleRowIDs: [tailID],
    observationIdentity: identity,
  };
}

describe('SZ-214 unfiltered tail high-water public owner', () => {
  it('emits physicalSeq at the installed high-water when the high-water row is above the viewport', () => {
    const replica = createChannelReplicaStore();
    const replicaState = replica.ensure('sz214').state;
    const state = {
      ...replicaState,
      channelId: 'sz214',
      // A late update to an earlier stable row reaches seq 52, while the
      // chronological presentation tail remains the separately visible row.
      timeline: [message('old-root', 52), message('tail', 40)],
      lastSeq: 52,
      _timelineRevision: 2,
      _timelineProjectionVersion: 2,
    };
    const receiptSink = vi.fn();
    const args = {
      state,
      history: historyFor(),
      viewSessions: {
        readView: () => ({}),
        save: vi.fn(),
        activate: vi.fn(),
        deactivate: vi.fn(),
      },
      historyViewSpec: {
        scope: 'all',
        selfId: '',
        actorFilter: new Set(),
        editingTargetId: '',
        editingReplacementId: '',
        showNarration: false,
      },
      messageListKey: 'sz214:all',
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: receiptSink,
    };
    const { result } = renderHook(() => useConversationProjection(args));
    const presentation = result.current.projection.presentation;
    expect(presentation.rows.at(-1)?.id).toBe('tail');

    act(() => {
      expect(result.current.viewport.onReadingObservation(
        observationFor(result.current.viewport, presentation),
      )).toBe(true);
    });

    expect(result.current.viewport.tailCaughtUp).toEqual(expect.objectContaining({
      caughtUp: true,
      boundary: 52,
      physicalSeq: 52,
      visibleRowIDs: ['tail'],
    }));
    expect(receiptSink).toHaveBeenCalledWith(expect.objectContaining({
      caughtUp: true,
      physicalSeq: 52,
      boundary: 52,
      visibleRowIDs: ['tail'],
    }));
  });
});
