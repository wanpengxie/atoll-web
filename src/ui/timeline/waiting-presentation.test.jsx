// @vitest-environment jsdom
//
// Successor coverage for the deleted tests/waiting-presentation.test.js.
// src/model/waiting-presentation.js (selectLocalWaitingTurns/selectWaitingPresentation)
// is gone; the canonical/local waiting-turn merge now lives inline in
// src/ui/timeline/useWaitingEditingController.jsx (private helpers
// queuedTurnsOf/pendingWaitingTurns/latestStage, combined and sorted inside
// the exported `useWaitingEditingController` hook as `queuedTurns`).
//
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../../model/channel-replica.js';
import { useWaitingEditingController } from './useWaitingEditingController.jsx';

const SELF = 'human:me:1';
const AGENT = 'agent:worker:1';

function commitRequest(replica, seq, id, overrides = {}) {
  replica.commit({
    channel_id: 'c0', seq, envelope: {
      id, kind: 'request', type: 'agent.ask', sender: { id: SELF, kind: 'human' }, audience: [AGENT],
      payload: { body: { text: `text-${id}` } }, ...overrides,
    },
  });
}

function commitStatus(replica, seq, id, parentId, status, extra = {}) {
  replica.commit({
    channel_id: 'c0', seq, envelope: {
      id, parent_id: parentId, kind: 'response', type: 'agent.ask',
      sender: { id: AGENT, kind: 'agent' }, audience: [SELF],
      payload: { body: { status, ...extra } },
    },
  });
}

function localSubmission(id, { type = 'agent.ask', state = 'accepted' } = {}) {
  return {
    messageId: id, state, text: `text-${id}`, createdAt: Date.now(),
    frame: { id, kind: 'request', msg_type: type, audience: [AGENT], payload: { text: `text-${id}` }, visibility: 'public' },
  };
}

function setup({ state, pending = [] }) {
  const onRequestCapability = vi.fn();
  const capabilityIndex = { get: () => undefined };
  const { result } = renderHook(() => useWaitingEditingController({
    state, pending, capabilityIndex, onRequestCapability,
    onTaskControl: vi.fn(), onComposerEditChange: vi.fn(),
  }));
  return result;
}

describe('waiting turn presentation (successor of waiting-presentation.test.js)', () => {
  it('assigns a durable local agent request to Waiting before ledger position arrives', () => {
    const replica = createChannelReplicaStore();
    const state = replica.ensure('c0').state;
    const pending = [
      localSubmission('agent-local'),
      localSubmission('human-local', { type: 'human.message' }),
      localSubmission('rejected-agent', { state: 'rejected' }),
    ];
    const result = setup({ state, pending });
    expect(result.current.queuedTurns.map((turn) => turn.requestId)).toEqual(['agent-local']);
    expect(result.current.queuedTurns[0]).toMatchObject({ local: true, waitingPresentation: 'confirming' });
  });

  it('keeps newly accepted local requests after canonical queued positions', () => {
    const replica = createChannelReplicaStore();
    commitRequest(replica, 20, 'canonical-first');
    commitStatus(replica, 21, 'canonical-first-p', 'canonical-first', 'queued');
    const state = replica.state('c0');
    const result = setup({ state, pending: [localSubmission('local-last')] });
    expect(result.current.queuedTurns.map((turn) => turn.requestId)).toEqual(['canonical-first', 'local-last']);
  });

  it('keeps a canonical queued fact visible regardless of target authority elsewhere', () => {
    const replica = createChannelReplicaStore();
    commitRequest(replica, 20, 'departed-target');
    commitStatus(replica, 21, 'departed-target-p', 'departed-target', 'queued');
    const state = replica.state('c0');
    const result = setup({ state });
    expect(result.current.queuedTurns.map((turn) => turn.requestId)).toEqual(['departed-target']);
  });

  it('keeps one stable id through local and then canonical queued commits', () => {
    const pending = [localSubmission('same-id')];
    const replica = createChannelReplicaStore();
    let state = replica.ensure('c0').state;
    let result = setup({ state, pending });
    expect(result.current.queuedTurns.map((turn) => turn.requestId)).toEqual(['same-id']);
    expect(result.current.queuedTurns[0].local).toBe(true);

    commitRequest(replica, 20, 'same-id');
    commitStatus(replica, 21, 'same-id-p', 'same-id', 'queued');
    state = replica.state('c0');
    result = setup({ state, pending });
    // Once the canonical row lands under the same id, the local echo must
    // drop out (isWaitingSubmission excludes ids already in _envelopesById) —
    // only the canonical turn remains, never both.
    expect(result.current.queuedTurns.map((turn) => turn.requestId)).toEqual(['same-id']);
    expect(result.current.queuedTurns[0].local).toBeUndefined();
  });

  it('releases local continuity when the canonical request starts running', () => {
    const replica = createChannelReplicaStore();
    commitRequest(replica, 20, 'running-id');
    commitStatus(replica, 21, 'running-id-p', 'running-id', 'processing');
    const state = replica.state('c0');
    const result = setup({ state, pending: [localSubmission('running-id')] });
    expect(result.current.queuedTurns).toEqual([]);
  });

  it('does not guess that a canonical agent.ask with no provisional is queued', () => {
    const replica = createChannelReplicaStore();
    commitRequest(replica, 20, 'remote-open');
    const state = replica.state('c0');
    const result = setup({ state });
    // A request type alone is not a lifecycle position. Waiting starts only
    // after Replica has folded an explicit received/queued/deferred fact.
    expect(result.current.queuedTurns).toEqual([]);
  });

  it('does not resurrect a terminal turn even when its queued provisional remains', () => {
    const replica = createChannelReplicaStore();
    commitRequest(replica, 20, 'closed-id');
    commitStatus(replica, 21, 'closed-id-q', 'closed-id', 'queued');
    commitStatus(replica, 22, 'closed-id-done', 'closed-id', 'completed');
    const state = replica.state('c0');
    const result = setup({ state });
    expect(result.current.queuedTurns).toEqual([]);
  });
});
