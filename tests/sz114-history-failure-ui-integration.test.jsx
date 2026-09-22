// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { ConversationSurface } from '../src/ui/conversation/ConversationSurface.jsx';

vi.mock('../src/ui/timeline/useTimelinePreferences.js', () => ({
  CONVERSATION_SCOPE: { mine: 'mine', all: 'all' },
  useTimelinePreferences: () => ({
    scope: 'all', actorFilter: new Set(), foldOverrides: new Map(), messageLayoutStore: {},
    toggleScope: vi.fn(), toggleActorFilter: vi.fn(), removeActorFilter: vi.fn(), toggleFold: vi.fn(),
  }),
}));

vi.mock('../src/ui/timeline/useWaitingEditingController.jsx', () => ({
  WaitingLayer: () => null,
  useWaitingEditingController: () => ({
    editingTargetId: '', editingReplacementId: '', presentationEditing: null,
    timelineLocalEchoes: [], queuedTurns: [], editNotice: '', startEditing: vi.fn(),
  }),
  useWaitingHandoff: () => ({ enteringRequestIDs: new Set(), exiting: [] }),
}));

vi.mock('../src/ui/timeline/useTimelineRowRenderer.jsx', () => ({
  useTimelineRowRenderer: () => ({ rowRenderRevision: 0, renderRow: () => null }),
}));

// The integration under test is the history owner and Surface.  The physical
// renderer is kept out of this jsdom contract so it cannot become a second
// source of history state or DOM geometry assertions.
vi.mock('../src/ui/timeline/ReadingContainerHandoff.jsx', () => ({
  ReadingContainerHandoff: () => <div data-testid="reading">reading</div>,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function message(id = 'history-20', seq = 20) {
  return {
    kind: 'standalone', seq,
    envelope: {
      id, seq, ts: seq * 1_000, type: 'human.note',
      sender: { id: 'human:root:1', kind: 'human' },
      payload: { body: { text: 'visible history' } },
    },
  };
}

function stateFor() {
  const replica = createChannelReplicaStore();
  const base = replica.ensure('c0').state;
  return {
    ...base,
    channelId: 'c0',
    timeline: [message()],
    lastSeq: 20,
    _timelineRevision: 20,
    _timelineProjectionVersion: 20,
  };
}

function admission() {
  return {
    evaluate: (_channelID, items) => ({ items, receipt: null }),
    sourceFence: () => 20,
  };
}

function historyFor({ phase = 'error', revision = 7, error = 'temporary offline', request = vi.fn() } = {}) {
  return {
    request,
    refreshLatest: vi.fn(),
    status: {
      channelId: 'c0',
      attached: true,
      generation: 1,
      sourceLease: 'lease-sz114',
      messageCurrent: true,
      headSeq: 20,
      oldestSeq: 1,
      coverage: [{ lowSeq: 1, highSeq: 20 }],
      loaded: true,
      completedPages: 1,
      hasOlder: true,
      buffered: 0,
      loading: false,
      foregroundLoading: false,
      backgroundLoading: false,
      localReplicaReady: true,
      presentationRevision: 20,
      notificationAuthorityRevision: 0,
      historyDemand: { revision, phase, error },
      sync: { interestRevision: 0, fulfilledRevision: 0, targetHead: 20, error: '' },
      presentationAdmission: admission(),
    },
  };
}

function Surface({ state, history, viewSessions }) {
  return <ConversationSurface
    state={state}
    history={history}
    viewSessions={viewSessions}
    surfaceVisible
    selfId="human:root:1"
    composer={<div data-testid="composer">composer</div>}
    onComposerEditChange={vi.fn()}
    onTaskControl={vi.fn()}
    onRequestCapability={vi.fn()}
    onCancel={vi.fn()}
  />;
}

describe('SZ-114 real history consumer → Surface retry contract', () => {
  it.skip('carries the actual history failure into UI and retries the same obligation port', async () => {
    const state = stateFor();
    const viewSessions = {
      readView: () => ({}), save: vi.fn(), activate: vi.fn(), deactivate: vi.fn(),
    };
    const request = vi.fn(() => Promise.resolve({ kind: 'satisfied' }));
    const initialPendingHistory = historyFor({ request, phase: 'pending', error: '' });
    const view = render(<Surface state={state} history={initialPendingHistory} viewSessions={viewSessions} />);
    expect(view.getByRole('status').textContent).toContain('正在读取更早动态…');
    expect(request).not.toHaveBeenCalled();

    const failedHistory = historyFor({ request });
    view.rerender(<Surface state={state} history={failedHistory} viewSessions={viewSessions} />);

    const alert = view.getByRole('alert');
    expect(alert.textContent).toContain('temporary offline');
    expect(alert.getAttribute('data-phase')).toBe('error');
    expect(view.getAllByRole('button', { name: '重试' })).toHaveLength(1);

    await userEvent.click(view.getByRole('button', { name: '重试' }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toMatchObject({
      reason: 'retry',
      intent: 'scroll-history',
      anchorSeq: 20,
      explicitRetry: true,
      viewSpec: { scope: 'all' },
    });

    const retryPendingHistory = historyFor({ request, phase: 'pending', revision: 8, error: '' });
    view.rerender(<Surface state={state} history={retryPendingHistory} viewSessions={viewSessions} />);
    expect(view.getByRole('status').textContent).toContain('正在读取更早动态…');
    expect(view.queryByRole('alert')).toBeNull();

    const settledHistory = historyFor({ request, phase: 'idle', revision: 8, error: '' });
    view.rerender(<Surface state={state} history={settledHistory} viewSessions={viewSessions} />);
    expect(view.queryByRole('alert')).toBeNull();
    expect(view.queryByText('正在读取更早动态…')).toBeNull();
  });
});
