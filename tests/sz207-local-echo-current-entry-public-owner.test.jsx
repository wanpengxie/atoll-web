// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const CHANNEL = 'sz207-local-echo';
const ECHO_ID = 'local-echo';

function durableMessage(id, seq) {
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

function localEcho() {
  return {
    messageId: ECHO_ID,
    createdAt: 9_000,
    state: 'queued',
    text: 'pending local request',
    frame: {
      kind: 'request',
      msg_type: 'human.message',
      payload: { body: { text: 'pending local request' } },
    },
  };
}

function historyFor(coverage) {
  const presentationAdmission = {
    evaluate: (_channelID, items) => ({ items, receipt: null }),
    sourceFence: () => 9,
  };
  return {
    request: vi.fn(() => Promise.resolve({ kind: 'exhausted', localOnly: true })),
    refreshLatest: vi.fn(),
    status: {
      attached: true,
      generation: 2,
      messageCurrent: true,
      headSeq: 9,
      coverage,
      loaded: true,
      completedPages: 1,
      hasOlder: false,
      buffered: 0,
      loading: false,
      localReplicaReady: true,
      presentationRevision: 9,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 0, fulfilledRevision: 0, targetHead: 9 },
      presentationAdmission,
    },
  };
}

function renderProjection(history) {
  const replica = createChannelReplicaStore();
  const replicaState = replica.ensure(CHANNEL).state;
  const args = {
    state: {
      ...replicaState,
      channelId: CHANNEL,
      timeline: [durableMessage('durable-8', 8)],
      lastSeq: 8,
      _timelineRevision: 9,
      _timelineProjectionVersion: 9,
    },
    history,
    viewSessions: {
      readView: () => ({}),
      save: vi.fn(),
      activate: vi.fn(),
      deactivate: vi.fn(),
    },
    historyViewSpec: {
      scope: 'all',
      selfId: 'human',
      actorFilter: new Set(),
      editingTargetId: '',
      editingReplacementId: '',
      showNarration: false,
    },
    messageListKey: `${CHANNEL}:all`,
    timelineLocalEchoes: [localEcho()],
    identityPending: false,
    surfaceVisible: true,
    onTailCaughtUp: vi.fn(),
  };
  return { ...renderHook(() => useConversationProjection(args)), args };
}

describe('SZ-207 local echo current-entry authority', () => {
  it.skip('keeps a local echo out of current-entry authority until the durable tail covers head', () => {
    const partial = historyFor([{ lowSeq: 1, highSeq: 8 }]);
    const { result, rerender, args } = renderProjection(partial);

    expect(result.current.projection.presentation.rows.at(-1)?.id).toBe(ECHO_ID);
    expect(result.current.viewport.status.headSeq).toBe(9);
    expect(result.current.viewport.presentationAuthority).toBeNull();

    args.history = historyFor([{ lowSeq: 1, highSeq: 9 }]);
    rerender();

    expect(result.current.viewport.presentationAuthority).toEqual({
      epoch: `${CHANNEL}:2`,
      viewID: `${CHANNEL}:all`,
      sourceRevision: 9,
      candidateID: ECHO_ID,
    });
  });
});
