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

function historyFor({ generation = 1, headSeq = 2, messageCurrent = true, coverage = [{ lowSeq: 1, highSeq: 2 }], presentationRevision = 2 } = {}) {
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
      messageCurrent,
      headSeq,
      coverage,
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

function renderProjection(history) {
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
    history,
    viewSessions: viewSessions(),
    historyViewSpec: {
      scope: 'all', selfId: '', actorFilter: new Set(),
      editingTargetId: '', editingReplacementId: '', showNarration: false,
    },
    messageListKey: 'c0:all',
    timelineLocalEchoes: [],
    identityPending: false,
    surfaceVisible: true,
    onTailCaughtUp: vi.fn(),
  };
  return { ...renderHook(() => useConversationProjection(args)), args };
}

describe('S-Z canonical Presentation authority receipt', () => {
  it('emits a typed surface-hidden revoke at a newer input epoch', () => {
    const initialHistory = historyFor();
    const { result, rerender, args } = renderProjection(initialHistory);
    const receiptSink = args.onTailCaughtUp;
    const activationID = result.current.viewport.activationID;

    act(() => {
      result.current.viewport.onReadingObservation(observationFor(result.current.viewport));
    });
    expect(receiptSink).toHaveBeenCalledWith(expect.objectContaining({ caughtUp: true }));
    const positive = receiptSink.mock.calls.at(-1)[0];
    expect(positive.inputEpoch).toBe(0);

    args.surfaceVisible = false;
    act(() => {
      result.current.viewport.onSurfaceVisibilityChange(false);
      rerender();
    });

    expect(receiptSink).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'notification-lease-revoke',
      reason: 'surface-hidden',
      inputEpoch: 1,
      caughtUp: false,
      surfaceVisible: false,
    }));
  });

  it('re-enters a hidden following surface only with a newer positive epoch', () => {
    const initialHistory = historyFor();
    const { result, rerender, args } = renderProjection(initialHistory);
    const receiptSink = args.onTailCaughtUp;
    const activationID = result.current.viewport.activationID;

    act(() => {
      result.current.viewport.onReadingObservation(observationFor(result.current.viewport));
    });
    expect(receiptSink).toHaveBeenLastCalledWith(expect.objectContaining({
      caughtUp: true,
      inputEpoch: 0,
    }));

    args.surfaceVisible = false;
    act(() => {
      result.current.viewport.onSurfaceVisibilityChange(false);
      rerender();
    });
    expect(receiptSink).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'notification-lease-revoke',
      inputEpoch: 1,
    }));

    args.surfaceVisible = true;
    act(() => {
      result.current.viewport.onSurfaceVisibilityChange(true);
      rerender();
      result.current.viewport.onReadingObservation(observationFor(result.current.viewport));
    });
    expect(receiptSink).toHaveBeenLastCalledWith(expect.objectContaining({
      caughtUp: true,
      inputEpoch: 2,
    }));
    expect(receiptSink.mock.calls.at(-1)[0].inputEpoch).toBeGreaterThan(
      receiptSink.mock.calls.at(-2)[0].inputEpoch,
    );
  });

  it('mints document visibility epochs once and dedupes matching surface edges', () => {
    const initialVisibility = document.visibilityState;
    const { result, args } = renderProjection(historyFor());
    const receiptSink = args.onTailCaughtUp;
    const activationID = result.current.viewport.activationID;
    const setVisibility = (value) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value });
      act(() => document.dispatchEvent(new Event('visibilitychange')));
    };

    try {
      act(() => {
        result.current.viewport.onReadingObservation(observationFor(result.current.viewport));
      });
      expect(result.current.viewport.getSession().inputEpoch).toBe(0);

      setVisibility('hidden');
      expect(result.current.viewport.getSession().inputEpoch).toBe(1);
      expect(receiptSink).toHaveBeenLastCalledWith(expect.objectContaining({
        kind: 'notification-lease-revoke',
        reason: 'surface-hidden',
        inputEpoch: 1,
      }));

      setVisibility('hidden');
      expect(result.current.viewport.getSession().inputEpoch).toBe(1);

      setVisibility('visible');
      expect(result.current.viewport.getSession().inputEpoch).toBe(2);
      act(() => {
        result.current.viewport.onSurfaceVisibilityChange(true);
        result.current.viewport.onReadingObservation(observationFor(result.current.viewport, {
          settled: false,
        }));
      });
      expect(result.current.viewport.getSession().inputEpoch).toBe(2);
      expect(result.current.viewport.tailCaughtUp.caughtUp).toBe(false);
      expect(receiptSink).toHaveBeenLastCalledWith(expect.objectContaining({
        kind: 'notification-lease-revoke',
        inputEpoch: 1,
      }));
      act(() => {
        result.current.viewport.onReadingObservation(observationFor(result.current.viewport));
      });
      expect(receiptSink).toHaveBeenLastCalledWith(expect.objectContaining({
        caughtUp: true,
        inputEpoch: 2,
      }));
    } finally {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: initialVisibility,
      });
    }
  });

  it('emits a typed activation-cleanup revoke at a newer input epoch', () => {
    const { result, unmount, args } = renderProjection(historyFor());
    const receiptSink = args.onTailCaughtUp;
    const activationID = result.current.viewport.activationID;

    act(() => {
      result.current.viewport.onReadingObservation(observationFor(result.current.viewport));
    });
    expect(receiptSink).toHaveBeenCalledWith(expect.objectContaining({ caughtUp: true }));

    act(() => unmount());
    expect(receiptSink).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'notification-lease-revoke',
      reason: 'activation-cleanup',
      inputEpoch: 1,
      caughtUp: false,
      surfaceVisible: false,
    }));
  });

  it('publishes the frozen four-field authority receipt to current Timeline consumers', () => {
    const { result } = renderProjection(historyFor());
    const authority = result.current.viewport.presentationAuthority;

    expect(authority).toEqual({
      epoch: 'c0:1',
      viewID: 'c0:all',
      sourceRevision: 2,
      candidateID: 'latest',
    });
    expect(Object.isFrozen(authority)).toBe(true);
    expect(Object.keys(authority)).toEqual(['epoch', 'viewID', 'sourceRevision', 'candidateID']);
    expect(result.current.latestRowID).toBe('latest');
  });

  it('fails closed when current head/readability authority is not proven', () => {
    const initial = historyFor();
    const { result, rerender, args } = renderProjection(initial);
    expect(result.current.viewport.presentationAuthority?.candidateID).toBe('latest');

    const stale = historyFor({ headSeq: 3, coverage: [{ lowSeq: 1, highSeq: 2 }] });
    args.history = stale;
    rerender();
    expect(result.current.viewport.presentationAuthority).toBeNull();
    expect(result.current.latestRowID).toBe('');

    const unreadable = historyFor({ messageCurrent: false });
    args.history = unreadable;
    rerender();
    expect(result.current.viewport.presentationAuthority).toBeNull();
  });

  it('reissues the receipt for a new view/epoch and fences a stale source revision', () => {
    const { result, rerender, args } = renderProjection(historyFor());
    const first = result.current.viewport.presentationAuthority;

    args.history = historyFor({ presentationRevision: 3 });
    rerender();
    expect(result.current.viewport.presentationAuthority).toBeNull();

    args.history = historyFor({ generation: 2 });
    args.messageListKey = 'c0:mine';
    args.historyViewSpec = {
      ...args.historyViewSpec,
      scope: 'mine',
    };
    rerender();
    expect(result.current.viewport.presentationAuthority).toEqual({
      epoch: 'c0:2',
      viewID: 'c0:mine',
      sourceRevision: 2,
      candidateID: 'latest',
    });
    expect(result.current.viewport.presentationAuthority).not.toBe(first);
  });
});
