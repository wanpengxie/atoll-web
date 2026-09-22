// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const VIEW_SPEC = Object.freeze({
  scope: 'all',
  selfId: 'human:sz190:1',
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function stateFor() {
  const replica = createChannelReplicaStore();
  const base = replica.ensure('c0').state;
  return {
    ...base,
    channelId: 'c0',
    timeline: [{
      kind: 'standalone',
      seq: 901,
      envelope: {
        id: 'only-match',
        seq: 901,
        ts: 901_000,
        type: 'project.task',
        sender: { id: 'agent:claude:7', kind: 'agent' },
        payload: { body: { text: 'visible history row' } },
      },
    }],
    lastSeq: 901,
    _timelineRevision: 211,
    _timelineProjectionVersion: 211,
  };
}

function admission() {
  return {
    evaluate: (_channelID, items) => ({ items, receipt: null }),
    sourceFence: () => 211,
  };
}

function historyFor(request) {
  return {
    request,
    refreshLatest: vi.fn(),
    status: {
      channelId: 'c0',
      attached: true,
      generation: 7,
      messageCurrent: true,
      headSeq: 1_101,
      oldestSeq: 100,
      coverage: [{ lowSeq: 100, highSeq: 1_101 }],
      loaded: true,
      completedPages: 1,
      hasOlder: true,
      buffered: 0,
      loading: false,
      localReplicaReady: true,
      revealVersion: 0,
      presentationRevision: 211,
      notificationAuthorityRevision: 0,
      sourceLease: '1:2:9',
      historyDemand: { revision: 1, phase: 'idle', error: '' },
      sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: 1_101, error: '' },
      presentationAdmission: admission(),
    },
  };
}

function renderProjection({ state = stateFor(), history }) {
  const viewSessions = {
    readView: () => ({ mode: 'browsing', revision: 0 }),
    activate: vi.fn(),
    save: vi.fn(() => true),
    deactivate: vi.fn(),
  };
  const args = {
    state,
    history,
    viewSessions,
    historyViewSpec: VIEW_SPEC,
    messageListKey: 'c0:all',
    timelineLocalEchoes: [],
    identityPending: false,
    surfaceVisible: true,
    onTailCaughtUp: vi.fn(),
  };
  return renderHook(
    ({ nextHistory }) => useConversationProjection({ ...args, history: nextHistory }),
    { initialProps: { nextHistory: history } },
  );
}

describe('SZ-190 history demand upgrade contract', () => {
  it.skip('upgrades one anticipatory history operation at the physical top without duplicating it', async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const operation = {
      promote: vi.fn(() => true),
    };
    const request = vi.fn((options) => {
      options.onOperation?.(operation);
      return pending;
    });
    const { result, unmount } = renderProjection({ history: historyFor(request) });

    let anticipatory;
    await act(async () => {
      anticipatory = result.current.viewport.onUnderfill();
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toMatchObject({
      intent: 'scroll-history',
      reason: 'underfill',
      urgency: 'anticipatory',
    });

    let interactive;
    await act(async () => {
      interactive = result.current.viewport.onAtTop();
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(operation.promote).toHaveBeenCalledTimes(1);
    expect(operation.promote).toHaveBeenCalledWith({
      intent: 'scroll-history',
      urgency: 'interactive',
    });

    await act(async () => {
      result.current.viewport.onAtTop();
      release({ kind: 'exhausted' });
      await Promise.all([anticipatory, interactive]);
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(operation.promote).toHaveBeenCalledTimes(1);
    unmount();
  });
});
