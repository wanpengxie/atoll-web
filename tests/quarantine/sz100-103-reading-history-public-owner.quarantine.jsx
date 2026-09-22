// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';
import { useBrowsingReadingController } from '../src/ui/timeline/useBrowsingReadingController.js';

const VIEW_SESSIONS = Object.freeze({
  readView: () => ({}),
  save: vi.fn(),
  activate: vi.fn(),
  deactivate: vi.fn(),
});

const VIEW_SPEC = Object.freeze({
  scope: 'all',
  selfId: '',
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

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

function stateFor(count = 4) {
  const timeline = Array.from({ length: count }, (_value, index) => message(`history-${index + 1}`, index + 1));
  const replica = createChannelReplicaStore();
  const base = replica.ensure('c0').state;
  return {
    ...base,
    channelId: 'c0',
    timeline,
    lastSeq: count,
    _timelineRevision: count,
    _timelineProjectionVersion: count,
  };
}

function presentationAdmission() {
  return {
    evaluate: (_channelID, items) => ({ items, receipt: null }),
    sourceFence: () => 4,
  };
}

function historyFor({
  attached = true,
  generation = 1,
  messageCurrent = true,
  headSeq = 4,
  coverage = [{ lowSeq: 1, highSeq: 4 }],
  loaded = true,
  completedPages = 1,
  hasOlder = true,
  buffered = 0,
  loading = false,
  presentationRevision = 4,
  request = vi.fn(() => Promise.resolve({ kind: 'satisfied', released: 1 })),
} = {}) {
  return {
    request,
    refreshLatest: vi.fn(),
    status: {
      channelId: 'c0',
      attached,
      generation,
      messageCurrent,
      headSeq,
      coverage,
      loaded,
      completedPages,
      hasOlder,
      buffered,
      loading,
      localReplicaReady: true,
      presentationRevision,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 0, fulfilledRevision: 0, targetHead: headSeq },
      presentationAdmission: presentationAdmission(),
    },
  };
}

function renderProjection({ state = stateFor(), history = historyFor() } = {}) {
  const args = {
    state,
    history,
    viewSessions: VIEW_SESSIONS,
    historyViewSpec: VIEW_SPEC,
    messageListKey: 'c0:all',
    timelineLocalEchoes: [],
    identityPending: false,
    surfaceVisible: true,
    onTailCaughtUp: vi.fn(),
  };
  return renderHook(
    ({ nextState, nextHistory }) => useConversationProjection({
      ...args,
      state: nextState,
      history: nextHistory,
    }),
    { initialProps: { nextState: state, nextHistory: history } },
  );
}

function renderReadingBoundary({ state = stateFor(), history = historyFor() } = {}) {
  const rootMountedRef = { current: true };
  const args = {
    state,
    history,
    viewSessions: VIEW_SESSIONS,
    historyViewSpec: VIEW_SPEC,
    messageListKey: 'c0:all',
    timelineLocalEchoes: [],
    identityPending: false,
    surfaceVisible: true,
    onTailCaughtUp: vi.fn(),
  };
  return renderHook(
    ({ nextState, nextHistory }) => {
      const projection = useConversationProjection({
        ...args,
        state: nextState,
        history: nextHistory,
      });
      const readingController = useBrowsingReadingController({
        reading: projection.viewport,
        snapshot: projection.projection.presentation,
        rootNode: ROOT_NODE,
        rootIdentity: 1,
        rootMountedRef,
      });
      return { projection, readingController };
    },
    { initialProps: { nextState: state, nextHistory: history } },
  );
}

function viewportCoverage(viewport, projection, overrides = {}) {
  return {
    type: 'viewport-coverage',
    activationID: viewport.activationID,
    presentationRevision: Number(projection.projection.presentation.revision || 0),
    hasBothBoundaries: true,
    underfilled: true,
    scrollHeight: 360,
    clientHeight: 640,
    demandUnits: 1,
    root: ROOT_NODE,
    onWake: vi.fn(),
    ...overrides,
  };
}

describe('SZ-100..103 public Reading/history consumer owner', () => {
  it('SZ-100: reservoir growth leaves the visible Presentation unchanged and has no manual load action', () => {
    const state = stateFor();
    const initialHistory = historyFor({ buffered: 0 });
    const { result, rerender } = renderProjection({ state, history: initialHistory });
    const beforeIDs = result.current.projection.presentationRows.map((row) => row.id);
    const beforeCount = result.current.projection.presentationRows.length;
    const request = vi.fn(() => Promise.resolve({ kind: 'satisfied', released: 1 }));
    const warmedHistory = historyFor({ buffered: 5_000, request });

    rerender({ nextState: state, nextHistory: warmedHistory });

    expect(result.current.projection.presentationRows.map((row) => row.id)).toEqual(beforeIDs);
    expect(result.current.projection.presentationRows).toHaveLength(beforeCount);
    expect(request).not.toHaveBeenCalled();
    expect(result.current.viewport).not.toHaveProperty('loadOlder');
    expect(result.current.viewport.status).not.toHaveProperty('loadOlder');
  });

  it('SZ-101: scheduling facts stay under status while typed actions stay on the public viewport port', () => {
    const { result } = renderProjection({ history: historyFor({ buffered: 5 }) });
    const viewport = result.current.viewport;

    expect(viewport.status).toMatchObject({
      attached: true,
      hasOlder: true,
      buffered: 5,
    });
    expect(viewport.status).not.toHaveProperty('onAtTop');
    expect(viewport.status).not.toHaveProperty('onNearTop');
    expect(viewport.status).not.toHaveProperty('onUnderfill');
    expect(typeof viewport.onAtTop).toBe('function');
    expect(typeof viewport.onNearTop).toBe('function');
    expect(typeof viewport.onUnderfill).toBe('function');
    expect(viewport).not.toHaveProperty('loadOlder');
  });

  it('SZ-102: an attached short first screen emits one typed underfill demand for the existing reservoir', async () => {
    const request = vi.fn(() => Promise.resolve({ kind: 'satisfied', released: 1 }));
    const history = historyFor({ buffered: 5_000, request });
    const { result } = renderReadingBoundary({ history });
    const { projection, readingController } = result.current;

    act(() => {
      expect(readingController.reportDomEvidence(
        viewportCoverage(projection.viewport, projection),
      )).toBe(true);
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(request.mock.calls[0][0]).toMatchObject({
      reason: 'underfill',
      urgency: 'anticipatory',
      anchorSeq: 1,
    });
  });

  it('SZ-103: viewport underfill waits for attach and explicit hasOlder authority before creating demand', async () => {
    const request = vi.fn(() => Promise.resolve({ kind: 'satisfied', released: 1 }));
    const coldHistory = historyFor({
      attached: false,
      generation: 0,
      messageCurrent: false,
      headSeq: 0,
      coverage: [],
      hasOlder: false,
      buffered: 0,
      request,
    });
    const { result, rerender } = renderReadingBoundary({ history: coldHistory });
    const cold = result.current;

    act(() => {
      expect(cold.readingController.reportDomEvidence(
        viewportCoverage(cold.projection.viewport, cold.projection),
      )).toBe(false);
    });
    expect(request).not.toHaveBeenCalled();

    const attachedHistory = historyFor({ buffered: 5_000, request });
    rerender({ nextState: stateFor(), nextHistory: attachedHistory });
    const current = result.current;
    act(() => {
      expect(current.readingController.reportDomEvidence(
        viewportCoverage(current.projection.viewport, current.projection),
      )).toBe(true);
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(request.mock.calls[0][0]).toMatchObject({
      reason: 'underfill',
      urgency: 'anticipatory',
      anchorSeq: 1,
    });
  });
});
