// @vitest-environment jsdom

import React, { useLayoutEffect } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

afterEach(cleanup);

const VIEW_SPEC = Object.freeze({
  scope: 'all',
  selfId: 'human:sz198:1',
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function stateFor() {
  const replica = createChannelReplicaStore();
  const base = replica.ensure('sz198-admission').state;
  return {
    ...base,
    channelId: 'sz198-admission',
    timeline: [],
    lastSeq: 0,
    _timelineRevision: 211,
    _timelineProjectionVersion: 211,
  };
}

function historyFor({ request, presentationAdmission }) {
  return {
    request,
    refreshLatest: vi.fn(),
    status: {
      channelId: 'sz198-admission',
      attached: true,
      generation: 7,
      messageCurrent: true,
      headSeq: 90,
      oldestSeq: 0,
      coverage: [],
      loaded: true,
      completedPages: 1,
      revealVersion: 0,
      buffered: 0,
      hasOlder: true,
      loading: false,
      localReplicaReady: true,
      presentationRevision: 211,
      sourceLease: 'sz198-stable-lease',
      historyDemand: { revision: 1, phase: 'idle', error: '' },
      sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: 90, error: '' },
      presentationAdmission,
    },
  };
}

function ProjectionHarness({ history, activationRef, onCommit }) {
  const projection = useConversationProjection({
    state: stateFor(),
    history,
    viewSessions: {
      readView: () => ({ mode: 'following', revision: 0 }),
      activate: vi.fn(),
      save: vi.fn(() => true),
      deactivate: vi.fn(),
    },
    historyViewSpec: VIEW_SPEC,
    messageListKey: 'sz198-admission:all',
    timelineLocalEchoes: [],
    identityPending: false,
    surfaceVisible: true,
    onTailCaughtUp: vi.fn(),
  });

  useLayoutEffect(() => {
    activationRef.current = projection.viewport.activationID;
    onCommit(projection.viewport);
  }, [activationRef, onCommit, projection.viewport]);

  return null;
}

describe('SZ-198 live admission cannot block current history', () => {
  it.skip.each([
    ['retired activation', { activationID: 'retired-activation', epoch: 'sz198-admission:7' }],
    ['retired generation', { activationID: 'current', epoch: 'sz198-admission:6' }],
  ])('%s admission is ignored by the current public Reading owner', async (_label, staleTuple) => {
    const activationRef = { current: '' };
    const request = vi.fn(() => new Promise(() => {}));
    const presentationAdmission = {
      snapshot: vi.fn(() => ({
        phase: 'pending-baseline-commit',
        token: {
          activationID: staleTuple.activationID === 'current'
            ? (activationRef.current || 'unbound-current')
            : staleTuple.activationID,
          viewID: 'sz198-admission:all',
          epoch: staleTuple.epoch,
          operationID: 'history:retired-live-admission:9',
        },
      })),
      evaluate: (_channelID, items) => ({ items, receipt: null }),
      sourceFence: () => 211,
    };
    const history = historyFor({ request, presentationAdmission });
    let viewport;

    const view = render(
      <ProjectionHarness
        history={history}
        activationRef={activationRef}
        onCommit={(next) => { viewport = next; }}
      />,
    );

    await waitFor(() => expect(viewport?.activationID).toBeTruthy());
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));

    // Public contract: a stale live-admission lease cannot suppress the
    // current generation's one acquisition request.  The assertion only
    // observes the typed request port and current viewport status.
    expect(request.mock.calls[0][0]).toMatchObject({
      reason: 'projection-underfill',
      urgency: 'anticipatory',
    });
    expect(viewport.status).toMatchObject({
      generation: 7,
      messageCurrent: true,
      hasOlder: true,
    });
    expect(presentationAdmission.snapshot).toHaveBeenCalled();

    view.unmount();
  });
});
