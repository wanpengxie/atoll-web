// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { ReadingContainerHandoff } from '../src/ui/timeline/ReadingContainerHandoff.jsx';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const VENDOR_ROOT = {};
const vendorHarness = vi.hoisted(() => ({ report: null }));

// This oracle exercises the public Reading handoff without introducing a
// second DOM writer. The real Vendor is covered by reading-observation-settle;
// here it is only a paint boundary so the test can drive the same public
// authority tuple through a hidden/visible Surface transition.
vi.mock('../src/ui/timeline/VendorListExecutor.jsx', async () => {
  const ReactModule = await import('react');
  const { useBrowsingReadingController } = await import('../src/ui/timeline/useBrowsingReadingController.js');
  return {
    VendorListExecutor: ({ reading, snapshot }) => {
      const adapter = useBrowsingReadingController({
        reading,
        snapshot,
        rootNode: VENDOR_ROOT,
        rootIdentity: 1,
      });
      vendorHarness.report = adapter.reportDomEvidence;
      return <div data-testid="vendor-root" data-activation={reading.activationID} />;
    },
  };
});

function row(id, seq) {
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

function stateFor(rows = [row('old', 1), row('latest', 2)]) {
  const replica = createChannelReplicaStore();
  const replicaState = replica.ensure('c0').state;
  return {
    ...replicaState,
    channelId: 'c0',
    timeline: rows,
    lastSeq: rows.at(-1)?.seq || 0,
    _timelineRevision: rows.at(-1)?.seq || 0,
    _timelineProjectionVersion: rows.at(-1)?.seq || 0,
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

function authorityFor(projection) {
  const { viewport, projection: presentation } = projection;
  const session = viewport.getSession();
  const status = viewport.status;
  const tailID = String(presentation.presentation.rows.at(-1)?.id || '');
  const revision = Number(presentation.presentation.revision || 0);
  const inputEpoch = Number(session.inputEpoch || 0);
  return {
    type: 'reading-authority',
    activationID: viewport.activationID,
    inputEpoch,
    source: 'layout',
    atTail: true,
    settled: true,
    surfaceVisible: true,
    installedHighSeq: Number(status.headSeq || 0),
    presentationRevision: revision,
    domPresentationRevision: revision,
    rootIdentity: 1,
    rootNode: VENDOR_ROOT,
    tailID,
    visibleRows: [{ messageID: tailID }],
    visibleRowIDs: [tailID],
    observationIdentity: {
      activationID: viewport.activationID,
      inputEpoch,
      intentRevision: Number(session.intentRevision || 0),
      presentationRevision: revision,
      tailID,
      generation: Number(status.generation || 0),
      authorityRevision: Number(status.notificationAuthorityRevision || 0),
      rootIdentity: 1,
    },
  };
}

function Harness({ state, history, surfaceVisible, receiptSink, expose }) {
  const projection = useConversationProjection({
    state,
    history,
    viewSessions,
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
    surfaceVisible,
    onTailCaughtUp: receiptSink,
  });
  expose.current = projection;
  return <ReadingContainerHandoff
    snapshot={projection.projection.presentation}
    reading={projection.viewport}
    surfaceVisible={surfaceVisible}
    bottomIntentPresentation={null}
    rowRevision={0}
    rowPresentationState={() => ''}
    livePresentationArrivals={[]}
    historyStartBoundary={null}
    renderRow={() => null}
  />;
}

afterEach(() => cleanup());

describe('SZ-163 Surface hidden Reading authority', () => {
  it('revokes a committed tail on hide and requires a fresh paint after return', () => {
    const history = historyFor();
    const receiptSink = vi.fn();
    const expose = { current: null };
    const state = stateFor();
    const view = render(<Harness
      state={state}
      history={history}
      surfaceVisible
      receiptSink={receiptSink}
      expose={expose}
    />);

    let oldAuthority;
    act(() => {
      oldAuthority = authorityFor(expose.current);
      expect(vendorHarness.report(oldAuthority)).toBe(true);
    });
    expect(expose.current.viewport.tailCaughtUp).toEqual(expect.objectContaining({
      caughtUp: true,
      inputEpoch: 0,
      surfaceVisible: true,
    }));
    expect(receiptSink).toHaveBeenCalledWith(expect.objectContaining({
      caughtUp: true,
      inputEpoch: 0,
    }));

    act(() => {
      view.rerender(<Harness
        state={state}
        history={history}
        surfaceVisible={false}
        receiptSink={receiptSink}
        expose={expose}
      />);
    });
    expect(expose.current.viewport.tailCaughtUp.caughtUp).toBe(false);
    expect(receiptSink).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'notification-lease-revoke',
      reason: 'surface-hidden',
      caughtUp: false,
      inputEpoch: 1,
      surfaceVisible: false,
    }));

    const callsAfterHide = receiptSink.mock.calls.length;
    act(() => {
      expect(vendorHarness.report(oldAuthority)).toBe(false);
    });
    expect(receiptSink).toHaveBeenCalledTimes(callsAfterHide);
    expect(expose.current.viewport.tailCaughtUp.caughtUp).toBe(false);

    act(() => {
      view.rerender(<Harness
        state={state}
        history={history}
        surfaceVisible
        receiptSink={receiptSink}
        expose={expose}
      />);
    });
    expect(expose.current.viewport.getSession().inputEpoch).toBe(2);
    expect(expose.current.viewport.tailCaughtUp.caughtUp).toBe(false);

    act(() => {
      expect(vendorHarness.report(authorityFor(expose.current))).toBe(true);
    });
    expect(expose.current.viewport.tailCaughtUp).toEqual(expect.objectContaining({
      caughtUp: true,
      inputEpoch: 2,
      surfaceVisible: true,
    }));
    expect(receiptSink).toHaveBeenLastCalledWith(expect.objectContaining({
      caughtUp: true,
      inputEpoch: 2,
    }));
  });
});
