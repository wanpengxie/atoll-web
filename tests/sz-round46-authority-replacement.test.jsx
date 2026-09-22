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

function historyFor(generation) {
  const presentationAdmission = {
    evaluate: (_channelID, items) => ({ items, receipt: null }),
    sourceFence: () => 2,
  };
  return {
    request: vi.fn(() => Promise.resolve({ kind: 'exhausted', localOnly: true })),
    refreshLatest: vi.fn(),
    status: {
      attached: true,
      generation,
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
    timelineLocalEchoes: [],
    identityPending: false,
    surfaceVisible: true,
    onTailCaughtUp,
  };
  return {
    ...renderHook(
      ({ history, historyViewSpec, messageListKey }) => useConversationProjection({
        ...baseArgs,
        history,
        historyViewSpec,
        messageListKey,
      }),
      {
        initialProps: {
          history: historyFor(1),
          historyViewSpec: {
            scope: 'all', selfId: '', actorFilter: new Set(),
            editingTargetId: '', editingReplacementId: '', showNarration: false,
          },
          messageListKey: 'c0:all',
        },
      },
    ),
    onTailCaughtUp,
  };
}

function observeTail(result, presentationRevision = Number(result.current.projection?.revision || 1)) {
  act(() => {
    result.current.viewport.onReadingObservation(observationFor(result.current.viewport, {
      presentationRevision,
    }));
  });
}

describe('S-Z SZ154 current authority replacement fences', () => {
  it.skip('does not carry a positive tail authority across a generation replacement', () => {
    const { result, rerender, onTailCaughtUp } = renderProjection();
    const activationID = result.current.viewport.activationID;
    observeTail(result);
    expect(result.current.viewport.tailCaughtUp).toEqual(expect.objectContaining({
      caughtUp: true,
      activationID,
      generation: 1,
      boundary: 2,
      physicalSeq: 2,
    }));
    onTailCaughtUp.mockClear();

    rerender({
      history: historyFor(2),
      historyViewSpec: {
        scope: 'all', selfId: '', actorFilter: new Set(),
        editingTargetId: '', editingReplacementId: '', showNarration: false,
      },
      messageListKey: 'c0:all',
    });

    expect(result.current.viewport.tailCaughtUp).toEqual(expect.objectContaining({
      caughtUp: false,
      activationID,
      generation: 2,
      boundary: 0,
      physicalSeq: 0,
    }));
    expect(onTailCaughtUp).not.toHaveBeenCalledWith(expect.objectContaining({
      generation: 2,
      boundary: 2,
    }));
  });

  it.skip('requires a new observation after a semantic scope replacement', () => {
    const { result, rerender, onTailCaughtUp } = renderProjection();
    const firstActivationID = result.current.viewport.activationID;
    observeTail(result);
    expect(result.current.viewport.tailCaughtUp).toEqual(expect.objectContaining({
      caughtUp: true,
      activationID: firstActivationID,
      scope: 'all',
      boundary: 2,
      physicalSeq: 2,
    }));
    onTailCaughtUp.mockClear();

    rerender({
      history: historyFor(1),
      historyViewSpec: {
        scope: 'mine', selfId: '', actorFilter: new Set(['agent-a']),
        editingTargetId: '', editingReplacementId: '', showNarration: false,
      },
      messageListKey: 'c0:mine:agent-a',
    });
    const replacementActivationID = result.current.viewport.activationID;
    expect(replacementActivationID).not.toBe(firstActivationID);
    expect(result.current.viewport.tailCaughtUp).toEqual(expect.objectContaining({
      caughtUp: false,
      activationID: replacementActivationID,
      scope: 'mine',
      boundary: 0,
      physicalSeq: 0,
    }));
    expect(onTailCaughtUp).not.toHaveBeenCalledWith(expect.objectContaining({ boundary: 2 }));

    observeTail(result, 2);
    expect(result.current.viewport.tailCaughtUp).toEqual(expect.objectContaining({
      caughtUp: true,
      activationID: replacementActivationID,
      scope: 'mine',
      actorFiltered: true,
      boundary: 2,
      physicalSeq: 0,
    }));
  });
});
