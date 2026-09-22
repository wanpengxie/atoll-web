// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { createViewSessionStore } from '../src/model/view-session.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const CHANNEL = 'sz218-real-presence';
const VIEW_KEY = `${CHANNEL}:all`;
const PRINCIPAL = 'human:sz218:1';
const ROOT_NODE = {};

function event(id, seq) {
  return {
    channel_id: CHANNEL,
    seq,
    envelope: {
      id,
      seq,
      kind: 'event',
      type: 'project.task',
      ts: seq * 1_000,
      sender: { id: 'agent:remote', kind: 'agent' },
      audience: [PRINCIPAL],
      visibility: 'public',
      payload: { body: { text: id } },
    },
  };
}

function historyFor(headSeq) {
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
      presentationRevision: headSeq,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 0, fulfilledRevision: 0, targetHead: headSeq },
      presentationAdmission,
    },
  };
}

function observationFor(viewport, projection, {
  atTail = true,
  surfaceVisible = true,
} = {}) {
  const status = viewport.status || {};
  const session = viewport.getSession();
  const presentationRevision = Number(projection.presentation.revision || 0);
  const tailID = String(projection.presentation.rows.at(-1)?.id || '');
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
    atTail,
    settled: true,
    surfaceVisible,
    installedHighSeq: 3,
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

describe('SZ-218 real-presence fallback fence', () => {
  it.skip('does not acknowledge a pending arrival while browsing or hidden', async () => {
    const replica = createChannelReplicaStore();
    const state = replica.ensure(CHANNEL).state;
    replica.commit(event('installed-1', 1), PRINCIPAL, (value) => value, { source: 'history' });
    replica.commit(event('installed-2', 2), PRINCIPAL, (value) => value, { source: 'history' });

    const viewSessions = createViewSessionStore({ storage: null });
    const args = {
      state,
      viewSessions,
      historyViewSpec: {
        scope: 'all',
        selfId: PRINCIPAL,
        actorFilter: new Set(),
        editingTargetId: '',
        editingReplacementId: '',
        showNarration: false,
      },
      messageListKey: VIEW_KEY,
      timelineLocalEchoes: [],
      identityPending: false,
      surfaceVisible: true,
      onTailCaughtUp: vi.fn(),
    };
    const rendered = renderHook(
      ({ history }) => useConversationProjection({ ...args, history }),
      { initialProps: { history: historyFor(2) } },
    );
    const { result, rerender } = rendered;

    act(() => result.current.viewport.onReadingRootActivation({
      rootNode: ROOT_NODE,
      rootIdentity: 1,
    }));
    replica.commit(event('incoming', 3), PRINCIPAL, (value) => value, { source: 'live' });
    rerender({ history: historyFor(3) });
    expect(result.current.viewport.session.mode).toBe('following');
    expect(result.current.viewport.unseenNotice).toBe(0);
    expect(state.arrivalReceipts.timeline().events).toEqual([
      expect.objectContaining({ key: 'incoming', seq: 3 }),
    ]);

    // Browsing is a native takeover, not proof that the user saw the tail.
    act(() => result.current.viewport.beginNavigation({
      direction: 'older',
      gestureID: 'sz218-browse',
    }));
    expect(result.current.viewport.session.mode).toBe('browsing');
    expect(result.current.viewport.tailCaughtUp.caughtUp).toBe(false);
    expect(state.arrivalReceipts.timeline().events).toHaveLength(1);

    act(() => result.current.viewport.jumpToLatest());
    expect(result.current.viewport.session.mode).toBe('following');

    // A mounted root with a hidden Surface is not user presence.
    act(() => result.current.viewport.onSurfaceVisibilityChange(false));
    expect(result.current.viewport.tailCaughtUp.caughtUp).toBe(false);
    expect(state.arrivalReceipts.timeline().events).toHaveLength(1);

    act(() => result.current.viewport.onSurfaceVisibilityChange(true));
    const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    try {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      expect(result.current.viewport.tailCaughtUp.caughtUp).toBe(false);
      act(() => {
        expect(result.current.viewport.onReadingObservation(
          observationFor(result.current.viewport, result.current.projection),
        )).toBe(true);
      });
      expect(result.current.viewport.tailCaughtUp.caughtUp).toBe(false);
      expect(state.arrivalReceipts.timeline().events).toHaveLength(1);

      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      act(() => document.dispatchEvent(new Event('visibilitychange')));
      act(() => {
        expect(result.current.viewport.onReadingObservation(
          observationFor(result.current.viewport, result.current.projection),
        )).toBe(true);
      });
      expect(result.current.viewport.tailCaughtUp.caughtUp).toBe(true);
      await waitFor(() => expect(state.arrivalReceipts.timeline().events).toEqual([]));
    } finally {
      if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
      else delete document.visibilityState;
    }
  });
});
