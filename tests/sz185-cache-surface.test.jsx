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

vi.mock('../src/ui/timeline/ReadingContainerHandoff.jsx', () => ({
  ReadingContainerHandoff: () => <div data-testid="reading">reading</div>,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function stateFor() {
  const replica = createChannelReplicaStore();
  const base = replica.ensure('c0').state;
  return {
    ...base,
    channelId: 'c0',
    timeline: [{
      kind: 'standalone',
      seq: 20,
      envelope: {
        id: 'cached-row',
        seq: 20,
        ts: 20_000,
        type: 'human.note',
        sender: { id: 'human:root:1', kind: 'human' },
        payload: { body: { text: 'cached readable row' } },
      },
    }],
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

function historyFor({ retryLocalReplica, localReplicaReady = true, localReplicaError = '' }) {
  return {
    request: vi.fn(),
    refreshLatest: vi.fn(),
    retryLocalReplica,
    status: {
      channelId: 'c0',
      attached: false,
      generation: 0,
      messageCurrent: false,
      headSeq: 0,
      oldestSeq: 1,
      coverage: [{ lowSeq: 1, highSeq: 20 }],
      loaded: true,
      completedPages: 1,
      hasOlder: false,
      buffered: 0,
      loading: false,
      localReplicaReady,
      localReplicaError,
      localReplicaErrorCode: localReplicaError ? 'cache_selection_timeout' : '',
      sourceLease: '1:2:9',
      presentationRevision: 20,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 0, fulfilledRevision: 0, targetHead: 0, error: '' },
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

describe('SZ-185 cache notice surface contract', () => {
  it.skip('keeps the readable surface mounted and retries the independent cache owner', async () => {
    const state = stateFor();
    const viewSessions = {
      readView: () => ({}), save: vi.fn(), activate: vi.fn(), deactivate: vi.fn(),
    };
    const retryLocalReplica = vi.fn(() => Promise.resolve(true));
    const view = render(<Surface
      state={state}
      history={historyFor({ retryLocalReplica, localReplicaError: '本地缓存初始化超时，请重试' })}
      viewSessions={viewSessions}
    />);

    expect(view.getByTestId('reading')).toBeTruthy();
    expect(view.getByRole('alert').getAttribute('data-cache-phase')).toBe('error');
    expect(view.getByRole('alert').textContent).toContain('本地缓存初始化超时，请重试');
    await userEvent.click(view.getByRole('button', { name: '重试' }));
    expect(retryLocalReplica).toHaveBeenCalledOnce();

    view.rerender(<Surface
      state={state}
      history={historyFor({ retryLocalReplica, localReplicaReady: false })}
      viewSessions={viewSessions}
    />);
    expect(view.getByRole('status').getAttribute('data-cache-phase')).toBe('pending');
    expect(view.getByTestId('reading')).toBeTruthy();
  });
});
