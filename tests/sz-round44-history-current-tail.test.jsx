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
  const presentationRevision = Number(overrides.presentationRevision || 1);
  const base = {
    type: 'reading-authority',
    activationID: viewport.activationID,
    inputEpoch: Number(session.inputEpoch),
    source: 'layout',
    atTail: true,
    settled: true,
    surfaceVisible: true,
    installedHighSeq: 2,
    presentationRevision,
    domPresentationRevision: presentationRevision,
    rootIdentity: 1,
    rootNode: ROOT_NODE,
    tailID: 'latest',
    visibleRows: [{ messageID: 'latest' }],
    visibleRowIDs: ['latest'],
    observationIdentity: {
      activationID: viewport.activationID,
      inputEpoch: Number(session.inputEpoch),
      intentRevision: Number(session.intentRevision || 0),
      presentationRevision,
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

function historyFor(presentationRevision, historyDemand) {
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
      presentationRevision,
      notificationAuthorityRevision: 0,
      historyDemand,
      sync: { interestRevision: 0, fulfilledRevision: 0, targetHead: 2 },
      presentationAdmission,
    },
  };
}

function renderProjection() {
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
  const onTailCaughtUp = vi.fn();
  const baseArgs = {
    state,
    viewSessions: {
      readView: () => ({}),
      save: vi.fn(),
      activate: vi.fn(),
      deactivate: vi.fn(),
    },
    historyViewSpec: {
      scope: 'mine', selfId: '', actorFilter: new Set(['agent-a']),
      editingTargetId: '', editingReplacementId: '', showNarration: false,
    },
    messageListKey: 'c0:mine:agent-a',
    timelineLocalEchoes: [],
    identityPending: false,
    surfaceVisible: true,
    onTailCaughtUp,
  };
  const initialHistory = historyFor(3, { revision: 1, phase: 'pending', error: '' });
  return {
    ...renderHook(
      ({ history }) => useConversationProjection({ ...baseArgs, history }),
      { initialProps: { history: initialHistory } },
    ),
    onTailCaughtUp,
  };
}

describe('S-Z SZ152 current history authority', () => {
  it.fails('retries the fenced tail receipt when presentation history becomes current without new geometry', () => {
    const { result, rerender, onTailCaughtUp } = renderProjection();
    const activationID = result.current.viewport.activationID;

    act(() => {
      result.current.viewport.onReadingObservation(observationFor(result.current.viewport));
    });
    expect(result.current.viewport.tailCaughtUp).toEqual(expect.objectContaining({
      caughtUp: true,
      physicalSeq: 0,
      boundary: 0,
      presentationRevision: 3,
      sourceRevision: 2,
    }));
    expect(onTailCaughtUp).not.toHaveBeenCalledWith(expect.objectContaining({ physicalSeq: 2 }));

    rerender({ history: historyFor(2, { revision: 1, phase: 'idle', error: '' }) });
    expect(result.current.viewport.tailCaughtUp).toEqual(expect.objectContaining({
      caughtUp: true,
      physicalSeq: 0,
      boundary: 2,
      presentationRevision: 2,
      sourceRevision: 2,
      actorFiltered: true,
      cause: 'presented-follow',
    }));
    expect(onTailCaughtUp).toHaveBeenCalledWith(expect.objectContaining({
      physicalSeq: 0,
      boundary: 2,
      presentationRevision: 2,
      actorFiltered: true,
    }));
  });

  it.skip('accepts the same public authority only after a fresh exact tail observation', () => {
    const { result, rerender, onTailCaughtUp } = renderProjection();
    const activationID = result.current.viewport.activationID;

    act(() => {
      result.current.viewport.onReadingObservation(observationFor(result.current.viewport));
    });
    rerender({ history: historyFor(2, { revision: 1, phase: 'idle', error: '' }) });
    onTailCaughtUp.mockClear();
    expect(result.current.viewport.status).toMatchObject({
      attached: true,
      generation: 1,
      messageCurrent: true,
      headSeq: 2,
      presentationRevision: 2,
      historyDemand: { revision: 1, phase: 'idle' },
    });

    act(() => {
      result.current.viewport.onReadingObservation(observationFor(result.current.viewport, {
        presentationRevision: Number(result.current.projection.revision || 1),
      }));
    });

    expect(result.current.viewport.tailCaughtUp).toEqual(expect.objectContaining({
      caughtUp: true,
      activationID,
      generation: 1,
      actorFiltered: true,
      physicalSeq: 0,
      boundary: 2,
      presentationRevision: 2,
      sourceRevision: 2,
      cause: 'presented-follow',
    }));
    expect(onTailCaughtUp).toHaveBeenCalledWith(expect.objectContaining({
      activationID,
      generation: 1,
      boundary: 2,
      physicalSeq: 0,
      actorFiltered: true,
    }));
  });
});
