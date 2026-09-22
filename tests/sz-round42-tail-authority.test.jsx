// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const message = (id, seq) => ({
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
});

const ROOT_NODE = {};

function observationFor(viewport, overrides = {}) {
  const status = viewport.status || {};
  const session = viewport.getSession();
  const base = {
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
    tailID: 'latest',
    visibleRows: [{ messageID: 'latest' }],
    visibleRowIDs: ['latest'],
    observationIdentity: {
      activationID: viewport.activationID,
      inputEpoch: Number(session.inputEpoch),
      intentRevision: Number(session.intentRevision || 0),
      presentationRevision: 1,
      tailID: 'latest',
      generation: Number(status.generation || 0),
      authorityRevision: Number(status.notificationAuthorityRevision || 0),
      rootIdentity: 1,
    },
  };
  return {
    ...base,
    ...overrides,
    observationIdentity: { ...base.observationIdentity, ...(overrides.observationIdentity || {}) },
  };
}

function viewSessions() {
  return {
    readView: () => ({}),
    save: vi.fn(),
    activate: vi.fn(),
    deactivate: vi.fn(),
  };
}

function historyFor(overrides = {}) {
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
      ...overrides,
    },
  };
}

function renderProjection(onTailCaughtUp = vi.fn()) {
  const replica = createChannelReplicaStore();
  const replicaState = replica.ensure('c0').state;
  const state = {
    ...replicaState,
    channelId: 'c0',
    timeline: [message('old', 1), message('latest', 2)],
    lastSeq: 2,
    _timelineRevision: 2,
    _timelineProjectionVersion: 2,
  };
  const args = {
    state,
    history: historyFor(),
    viewSessions: viewSessions(),
    historyViewSpec: {
      scope: 'all', selfId: '', actorFilter: new Set(),
      editingTargetId: '', editingReplacementId: '', showNarration: false,
    },
    messageListKey: 'c0:all',
    timelineLocalEchoes: [],
    identityPending: false,
    surfaceVisible: true,
    onTailCaughtUp,
  };
  return { ...renderHook(() => useConversationProjection(args)), args };
}

describe('S-Z SZ150 production tail read authority', () => {
  it.skip('keeps physical read at zero until the committed Timeline reports the exact tail', () => {
    const receiptSink = vi.fn();
    const { result } = renderProjection(receiptSink);
    const activationID = result.current.viewport.activationID;

    expect(result.current.viewport.tailCaughtUp.physicalSeq).toBe(0);
    expect(receiptSink).not.toHaveBeenCalledWith(expect.objectContaining({ physicalSeq: 2 }));

    act(() => {
      result.current.viewport.onReadingObservation(observationFor(result.current.viewport, {
        installedHighSeq: 0,
      }));
    });
    expect(result.current.viewport.tailCaughtUp.physicalSeq).toBe(0);

    act(() => {
      result.current.viewport.onReadingObservation(observationFor(result.current.viewport));
    });
    expect(result.current.viewport.tailCaughtUp).toEqual(expect.objectContaining({
      caughtUp: true,
      physicalSeq: 2,
      boundary: 2,
      cause: 'presented-follow',
    }));
    expect(receiptSink).toHaveBeenCalledWith(expect.objectContaining({
      physicalSeq: 2,
      boundary: 2,
    }));
  });

  it.skip('fails closed when the DOM claims a row beyond the authoritative physical head', () => {
    const receiptSink = vi.fn();
    const { result } = renderProjection(receiptSink);
    const activationID = result.current.viewport.activationID;

    act(() => {
      result.current.viewport.onReadingObservation(observationFor(result.current.viewport, {
        installedHighSeq: 3,
      }));
    });

    expect(result.current.viewport.tailCaughtUp).toEqual(expect.objectContaining({
      caughtUp: false,
      physicalSeq: 0,
      boundary: 0,
    }));
    expect(receiptSink).not.toHaveBeenCalledWith(expect.objectContaining({ physicalSeq: 3 }));
  });
});
