// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from './channel-replica.js';
import {
  CONVERSATION_SCOPE,
  selectTimelineItems,
} from './conversation-presentation.js';
import { useWaitingEditingController } from '../ui/timeline/useWaitingEditingController.jsx';

const CHANNEL = 'c0';
const SELF = 'human:root:1';
const AGENT = 'agent:worker:1';

function flatRow(seq, {
  id,
  kind = 'event',
  type = 'human.note',
  parentId = '',
  visibility = 'public',
  body = { text: `legacy-${seq}` },
} = {}) {
  return {
    channel_id: CHANNEL,
    seq,
    envelope: {
      id: id || `flat-${seq}`,
      kind,
      type,
      parent_id: parentId,
      visibility,
      sender: { id: AGENT, kind: 'agent' },
      audience: [SELF],
      // Deliberately historical: business fields are at payload root, not
      // under the canonical payload.body wrapper.
      payload: body,
    },
  };
}

function localSubmission(messageId = 'flat-request', type = 'agent.ask') {
  return {
    messageId,
    state: 'uncertain',
    text: 'local request',
    createdAt: 1,
    frame: {
      kind: 'request',
      msg_type: type,
      audience: [AGENT],
      payload: { text: 'local request' },
      visibility: 'public',
    },
  };
}

describe('Replica canonical boundary for historical flat payloads', () => {
  it('keeps flat rows auditable without indexing them as lifecycle facts or closures', () => {
    const replica = createChannelReplicaStore();
    const rows = [
      flatRow(1, { id: 'flat-request', kind: 'request', type: 'agent.ask' }),
      flatRow(2, {
        id: 'flat-terminal', kind: 'response', type: 'agent.ask', parentId: 'flat-request',
        body: { status: 'completed', text: 'legacy result' },
      }),
      flatRow(3, {
        id: 'flat-response-first', kind: 'response', type: 'vendor.custom', parentId: 'missing-flat',
        body: { status: 'completed', text: 'legacy orphan' },
      }),
      flatRow(4, {
        id: 'flat-system', type: 'system.member.created', visibility: 'system',
        body: { actor_id: 'legacy' },
      }),
    ];
    rows.forEach((row) => expect(replica.commit(row).accepted).toBe(true));

    const state = replica.state(CHANNEL);
    expect([...state.rows.keys()]).toEqual([1, 2, 3, 4]);
    for (const id of ['flat-request', 'flat-terminal', 'flat-response-first', 'flat-system']) {
      expect(state._envelopesById.has(id)).toBe(false);
    }
    expect(state.timeline).toEqual([]);
    expect(state.narration).toEqual([]);
    expect(state._unmatchedTerminalClosures.size).toBe(0);

    for (let seq = 5; seq <= 12; seq += 1) {
      expect(replica.commit({
        channel_id: CHANNEL,
        seq,
        envelope: {
          id: `canonical-${seq}`,
          kind: 'event',
          type: 'human.note',
          sender: { id: SELF, kind: 'human' },
          audience: [],
          payload: { body: { text: `current-${seq}` } },
        },
      }).accepted).toBe(true);
    }
    expect(replica.trim(CHANNEL, 4)).toBeGreaterThan(0);
    expect(state._unmatchedTerminalClosures.size).toBe(0);
    for (const id of ['flat-request', 'flat-terminal', 'flat-response-first', 'flat-system']) {
      expect(state._envelopesById.has(id)).toBe(false);
    }
  });

  it('does not let a flat request suppress the matching local echo or Waiting submission', () => {
    const replica = createChannelReplicaStore();
    expect(replica.commit(flatRow(1, { id: 'flat-request', kind: 'request', type: 'agent.ask' })).accepted).toBe(true);
    expect(replica.commit(flatRow(2, { id: 'flat-event', type: 'human.message' })).accepted).toBe(true);
    const state = replica.state(CHANNEL);
    const pending = [localSubmission('flat-event', 'human.message')];
    const waitingPending = [localSubmission()];

    const projection = selectTimelineItems(state, {
      scope: CONVERSATION_SCOPE.all,
      selfId: SELF,
      localEchoes: pending,
    });
    expect(projection.localEchoes.map((entry) => entry.turn?.requestId)).toEqual(['flat-event']);
    expect(projection.items.some((entry) => entry.local && entry.turn?.requestId === 'flat-event')).toBe(true);

    const { result } = renderHook(() => useWaitingEditingController({
      state,
      pending: waitingPending,
      capabilityIndex: { get: () => undefined },
      onRequestCapability: vi.fn(),
      onTaskControl: vi.fn(),
      onComposerEditChange: vi.fn(),
    }));
    expect(result.current.queuedTurns.map((turn) => turn.requestId)).toEqual(['flat-request']);
  });
});
