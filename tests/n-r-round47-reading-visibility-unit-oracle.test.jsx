// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';
import { useBrowsingReadingController } from '../src/ui/timeline/useBrowsingReadingController.js';

const row = (id, seq) => ({
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

function historyFor() {
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

function projectionArgs() {
  const replica = createChannelReplicaStore();
  const replicaState = replica.ensure('c0').state;
  const state = {
    ...replicaState,
    channelId: 'c0',
    timeline: [row('old', 1), row('latest', 2)],
    lastSeq: 2,
    _timelineRevision: 2,
    _timelineProjectionVersion: 2,
  };
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
    messageListKey: 'c0:all',
    timelineLocalEchoes: [],
    identityPending: false,
    surfaceVisible: true,
    onTailCaughtUp: vi.fn(),
  };
  return args;
}

function projectionHarness() {
  const args = projectionArgs();
  return { ...renderHook(() => useConversationProjection(args)), args };
}

const ROOT_NODE = {};

function observationTuple(overrides = {}) {
  const activationID = overrides.activationID || 'active';
  const observationIdentity = {
    activationID,
    inputEpoch: 0,
    intentRevision: 0,
    presentationRevision: 1,
    tailID: 'tail',
    generation: 1,
    authorityRevision: 0,
    rootIdentity: 1,
    ...overrides.observationIdentity,
  };
  return {
    type: 'reading-authority',
    activationID,
    inputEpoch: 0,
    source: 'layout',
    atTail: true,
    settled: true,
    surfaceVisible: true,
    installedHighSeq: 2,
    presentationRevision: 1,
    domPresentationRevision: 1,
    rootIdentity: 1,
    rootNode: ROOT_NODE,
    tailID: 'tail',
    visibleRows: [{ messageID: 'tail' }],
    visibleRowIDs: ['tail'],
    observationIdentity,
    ...overrides,
  };
}

function projectionObservation(viewport, overrides = {}) {
  const status = viewport.status || {};
  const session = viewport.getSession();
  const observation = observationTuple({
    activationID: viewport.activationID,
    inputEpoch: Number(session.inputEpoch),
    rootNode: ROOT_NODE,
    rootIdentity: 1,
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
    ...overrides,
  });
  return {
    ...observation,
    observationIdentity: {
      ...observation.observationIdentity,
      ...(overrides.observationIdentity || {}),
    },
  };
}

function publicVisibilityHarness() {
  const args = projectionArgs();
  return renderHook(() => {
    const projection = useConversationProjection(args);
    const adapter = useBrowsingReadingController({
      reading: projection.viewport,
      snapshot: { revision: 1, rows: [{ id: 'latest' }] },
      rootNode: ROOT_NODE,
      rootIdentity: 1,
    });
    return { projection, adapter };
  });
}

describe('N-R Round 47 visibility observation unit oracle', () => {
  it('rejects an old inputEpoch before projection installs nextEvidence', () => {
    const { result } = projectionHarness();
    const viewport = result.current.viewport;
    const activationID = viewport.activationID;

    act(() => {
      viewport.onReadingObservation(projectionObservation(viewport));
    });
    expect(result.current.viewport.tailCaughtUp.caughtUp).toBe(true);

    act(() => {
      viewport.onSurfaceVisibilityChange(false);
      viewport.onSurfaceVisibilityChange(true);
    });
    const currentEpoch = result.current.viewport.getSession().inputEpoch;
    expect(currentEpoch).toBeGreaterThan(0);

    act(() => {
      result.current.viewport.onReadingObservation(projectionObservation(result.current.viewport, {
        inputEpoch: 0,
        observationIdentity: {
          ...projectionObservation(result.current.viewport).observationIdentity,
          inputEpoch: 0,
        },
      }));
    });

    expect(result.current.viewport.getSession().inputEpoch).toBe(currentEpoch);
    expect(result.current.viewport.tailCaughtUp.caughtUp).toBe(false);
  });

  it('rejects an old root before it reaches the Reading owner', () => {
    const { result } = publicVisibilityHarness();
    const before = result.current.projection.viewport.getSession();

    act(() => result.current.adapter.reportDomEvidence(observationTuple({
      activationID: 'retired-root',
    })));

    expect(result.current.projection.viewport.getSession()).toBe(before);
  });

  it.each([
    ['old domPresentationRevision', { domPresentationRevision: 6 }],
    ['empty visibleIDs', { visibleRowIDs: [] }],
  ])('marks %s as unsettled', (_label, change) => {
    const { result } = publicVisibilityHarness();
    const activationID = result.current.projection.viewport.activationID;

    act(() => result.current.adapter.reportDomEvidence(observationTuple({
      ...change,
      activationID,
    })));

    expect(result.current.projection.viewport.tailCaughtUp.caughtUp).toBe(false);
  });

  it('marks an old observationIdentity as unsettled', () => {
    const { result } = publicVisibilityHarness();
    const activationID = result.current.projection.viewport.activationID;

    act(() => result.current.adapter.reportDomEvidence(observationTuple({
      activationID,
      observationIdentity: {
        activationID,
        inputEpoch: -1,
        intentRevision: 0,
        presentationRevision: 0,
        tailID: 'old-tail',
      },
    })));

    expect(result.current.projection.viewport.tailCaughtUp.caughtUp).toBe(false);
  });

  it('accepts the current visibility tuple as settled', () => {
    const { result } = publicVisibilityHarness();
    const viewport = result.current.projection.viewport;

    act(() => result.current.adapter.reportDomEvidence(observationTuple({
      activationID: viewport.activationID,
      tailID: 'latest',
      visibleRows: [{ messageID: 'latest' }],
      visibleRowIDs: ['latest'],
      observationIdentity: {
        ...observationTuple().observationIdentity,
        activationID: viewport.activationID,
        tailID: 'latest',
      },
    })));

    expect(result.current.projection.viewport.tailCaughtUp.caughtUp).toBe(true);
  });
});
