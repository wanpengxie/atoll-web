// @vitest-environment jsdom

import React, { useLayoutEffect } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

afterEach(cleanup);

const VIEW_SPEC = Object.freeze({
  scope: 'all',
  selfId: '',
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function message(id = 'stable-history-row', seq = 1) {
  return {
    kind: 'standalone',
    seq,
    envelope: {
      id,
      seq,
      ts: seq * 1_000,
      type: 'human.note',
      sender: { id: 'human:root:1', kind: 'human' },
      payload: { body: { text: id } },
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
    lastSeq: 1,
    _timelineRevision: 1,
    _timelineProjectionVersion: 1,
  };
}

const STATE = stateFor();
const VIEW_SESSIONS = {
  readView: () => ({ mode: 'following', revision: 0 }),
  activate: vi.fn(),
  save: vi.fn(() => true),
  deactivate: vi.fn(),
};

function admission() {
  return {
    evaluate: (_channelID, items) => ({ items, receipt: null }),
    sourceFence: () => 1,
  };
}

function historyFor({ generation, request } = {}) {
  return {
    request,
    refreshLatest: vi.fn(),
    status: {
      channelId: 'c0',
      attached: true,
      generation,
      // Keep every authority fact stable across the replacement. The only
      // semantic world change in this matrix is the generation fence.
      sourceLease: 'sz160-stable-lease',
      messageCurrent: true,
      headSeq: 1,
      oldestSeq: 1,
      coverage: [{ lowSeq: 1, highSeq: 1 }],
      loaded: true,
      completedPages: 1,
      hasOlder: true,
      buffered: 0,
      loading: false,
      localReplicaReady: true,
      presentationRevision: 1,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 0, fulfilledRevision: 0, targetHead: 1 },
      presentationAdmission: admission(),
    },
  };
}

function ProjectionHarness({ history, onCommit }) {
  const projection = useConversationProjection({
    state: STATE,
    history,
    viewSessions: VIEW_SESSIONS,
    historyViewSpec: VIEW_SPEC,
    messageListKey: 'c0:all',
    timelineLocalEchoes: [],
    identityPending: false,
    surfaceVisible: true,
    onTailCaughtUp: vi.fn(),
  });

  useLayoutEffect(() => {
    onCommit(projection.viewport);
  }, [onCommit, projection.viewport]);

  return null;
}

describe('SZ-160 current history generation owner', () => {
  it.skip('does not cache old-generation EOF for the newly committed generation', async () => {
    // 能力：重连/换代后，用户仍能在当前频道代次继续读取历史。
    // 不变量：旧 generation 的 late exhausted 不能封存新 generation 的供给义务。
    // 公开 owner：useConversationProjection → useHistoryConsumer viewport port。
    let settleOld;
    let committedPort;
    const oldResult = new Promise((resolve) => { settleOld = resolve; });
    const requestA = vi.fn(() => oldResult);
    const requestB = vi.fn().mockResolvedValue({ kind: 'loaded' });
    const onCommit = (port) => { committedPort = port; };
    const view = render(
      <ProjectionHarness
        history={historyFor({ generation: 1, request: requestA })}
        onCommit={onCommit}
      />,
    );

    await waitFor(() => expect(committedPort?.activationID).toBeTruthy());
    const ownerA = committedPort;
    const pending = ownerA.onNearTop();
    expect(requestA).toHaveBeenCalledOnce();

    view.rerender(
      <ProjectionHarness
        history={historyFor({ generation: 2, request: requestB })}
        onCommit={onCommit}
      />,
    );
    await waitFor(() => expect(committedPort).not.toBe(ownerA));
    expect(committedPort.status).toMatchObject({
      generation: 2,
      sourceLease: ownerA.status.sourceLease,
      hasOlder: ownerA.status.hasOlder,
      messageCurrent: ownerA.status.messageCurrent,
      headSeq: ownerA.status.headSeq,
      oldestSeq: ownerA.status.oldestSeq,
    });

    await act(async () => {
      settleOld({ kind: 'exhausted' });
      await pending;
    });
    await act(async () => {
      await committedPort.onNearTop();
    });

    // The old promise is settled after generation 2 committed. A current
    // public demand must therefore reach requestB exactly once.
    expect(requestA).toHaveBeenCalledOnce();
    expect(requestB).toHaveBeenCalledOnce();
    view.unmount();
  });
});
