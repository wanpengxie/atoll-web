// @vitest-environment jsdom

import React, { Suspense, startTransition, useLayoutEffect, useState } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { useConversationProjection } from '../src/ui/timeline/useConversationProjection.js';

const NEVER = new Promise(() => {});
const STATE = stateFor();
const VIEW_SESSIONS = {
  readView: () => ({ mode: 'following', revision: 0 }),
  activate: vi.fn(),
  save: vi.fn(() => true),
  deactivate: vi.fn(),
};

const VIEW_SPEC = Object.freeze({
  scope: 'all',
  selfId: '',
  actorFilter: new Set(),
  editingTargetId: '',
  editingReplacementId: '',
  showNarration: false,
});

function message(id = 'history-row', seq = 1) {
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

function admission() {
  return {
    evaluate: (_channelID, items) => ({ items, receipt: null }),
    sourceFence: () => 1,
  };
}

function historyFor({ request, hasOlder = true } = {}) {
  return {
    request,
    refreshLatest: vi.fn(),
    status: {
      channelId: 'c0',
      attached: true,
      generation: 1,
      sourceLease: 'sz159-lease',
      messageCurrent: true,
      headSeq: 1,
      oldestSeq: 1,
      coverage: [{ lowSeq: 1, highSeq: 1 }],
      loaded: true,
      completedPages: 1,
      hasOlder,
      buffered: 0,
      loading: false,
      localReplicaReady: true,
      presentationRevision: 1,
      notificationAuthorityRevision: 0,
      historyDemand: { revision: 0, phase: 'idle', error: '' },
      sync: { interestRevision: 1, fulfilledRevision: 1, targetHead: 1 },
      presentationAdmission: admission(),
    },
  };
}

function ProjectionHarness({ history, suspend = false, onCommit, onSuspendAttempt }) {
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

  if (suspend) {
    onSuspendAttempt?.();
    throw NEVER;
  }
  return null;
}

function CandidateFrame({ historyA, historyB, historyReplacement, onCommit, onSuspendAttempt, control }) {
  const [phase, setPhase] = useState('a');
  useLayoutEffect(() => {
    control.current = {
      startCandidate() {
        startTransition(() => setPhase('candidate'));
      },
      commitReplacement() {
        setPhase('replacement');
      },
    };
    return () => { control.current = null; };
  }, [control]);
  const candidate = phase === 'candidate';
  const history = phase === 'a' ? historyA : candidate ? historyB : historyReplacement;
  return (
    <Suspense fallback={<p>history candidate fallback</p>}>
      <ProjectionHarness history={history} onCommit={onCommit} suspend={candidate} onSuspendAttempt={onSuspendAttempt} />
    </Suspense>
  );
}

describe('SZ-159 committed history owner across a suspended candidate', () => {
  it('does not let an aborted candidate status settle a committed request promise', async () => {
    // 能力：历史请求完成后，用户仍只能按当前已提交 owner 继续读取。
    // 不变量：Suspense 候选不能借用 committed promise 的 status/EOF 事实。
    // 公开 owner：useConversationProjection → useHistoryConsumer viewport port。
    let settle;
    let committedPort;
    const first = new Promise((resolve) => { settle = resolve; });
    const requestA = vi.fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValue({ kind: 'loaded' });
    const requestAReplacement = vi.fn().mockResolvedValue({ kind: 'loaded' });
    const requestB = vi.fn();
    const onCommit = (port) => { committedPort = port; };
    const candidateAttempted = { current: false };
    const control = { current: null };
    const view = render(
      <CandidateFrame
        historyA={historyFor({ request: requestA })}
        historyB={historyFor({ request: requestB, hasOlder: false })}
        historyReplacement={historyFor({ request: requestAReplacement })}
        onCommit={onCommit}
        onSuspendAttempt={() => { candidateAttempted.current = true; }}
        control={control}
      />,
    );

    await waitFor(() => expect(committedPort?.activationID).toBeTruthy());
    const ownerA = committedPort;
    let pending;
    await act(async () => {
      pending = ownerA.onNearTop();
    });
    expect(requestA).toHaveBeenCalledOnce();

    // This render evaluates a different history status but never commits.
    // The following committed frame is the same public view with a fresh
    // request port, matching a Scheduler status publication after fallback.
    act(() => { control.current.startCandidate(); });
    await waitFor(() => expect(candidateAttempted.current).toBe(true));
    // Observe the still-committed public owner while B is suspended. Its
    // generation/status and semantic EOF boundary must remain A's facts;
    // candidate B's `hasOlder: false` is not a public state transition.
    expect(committedPort.status).toMatchObject({ generation: 1, hasOlder: true });
    expect(committedPort.historyBoundary).toBeNull();
    expect(committedPort.availability).toBe('readable');

    act(() => { control.current.commitReplacement(); });
    await waitFor(() => expect(committedPort).not.toBe(ownerA));
    expect(committedPort.status.hasOlder).toBe(true);

    await act(async () => {
      settle({ kind: 'exhausted' });
      await pending;
    });
    await act(async () => {
      await committedPort.onNearTop();
    });

    // The old promise may settle the current generation's public obligation,
    // but it must not inherit the suspended candidate's `hasOlder: false`
    // status or call either candidate request port.
    expect(requestA).toHaveBeenCalledOnce();
    expect(requestAReplacement).not.toHaveBeenCalled();
    expect(requestB).not.toHaveBeenCalled();
    view.unmount();
  });
});
