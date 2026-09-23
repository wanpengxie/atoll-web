import { describe, expect, it } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { CONVERSATION_SCOPE, selectTimelineItems } from '../src/model/conversation-presentation.js';

const CHANNEL = 'c0';
const SELF = 'human:root:1';
const ALICE = 'human:alice:1';
const CLAUDE = 'agent:claude:1';
const CODEX = 'agent:codex:1';

function kindOf(id) {
  return id.split(':')[0];
}

function row(seq, {
  id, kind = 'event', type, sender, audience = [], parentId = '', correlationId = '', body = {},
}) {
  return {
    channel_id: CHANNEL,
    seq,
    envelope: {
      id,
      kind,
      type,
      sender: { id: sender, kind: kindOf(sender) },
      audience,
      ...(parentId ? { parent_id: parentId } : {}),
      correlation_id: correlationId || parentId || id,
      payload: { body },
    },
  };
}

function mine(rows) {
  const store = createChannelReplicaStore();
  for (const value of rows) store.commit(value, SELF);
  return selectTimelineItems(store.state(CHANNEL), { scope: CONVERSATION_SCOPE.mine, selfId: SELF }).items
    .map((entry) => (entry.kind === 'turn' ? entry.turn.requestId : entry.envelope.id));
}

describe('mine scope: work members start on their own is part of the conversation', () => {
  it('shows a provider run an agent wrote after its background task came back', () => {
    expect(mine([
      row(1, {
        id: 'run-1', type: 'agent.provider.run', sender: CLAUDE,
        body: { task_summary: 'Background command "tests" completed', text: 'All tests passed.' },
      }),
    ])).toEqual(['run-1']);
  });

  it('shows an agent scheduling itself through the system door, with its answer', () => {
    expect(mine([
      row(1, {
        id: 'timer-set', kind: 'request', type: 'system.timer.set', sender: CODEX, audience: ['system'],
        body: { after: '10m' },
      }),
      row(2, {
        id: 'timer-set-done', kind: 'response', type: 'system.timer.set', sender: 'system:c0:1',
        audience: [CODEX], parentId: 'timer-set', body: { status: 'completed' },
      }),
    ])).toEqual(['timer-set']);
  });

  it('shows one agent asking another on its own, progress and answer included', () => {
    const store = createChannelReplicaStore();
    for (const value of [
      row(1, {
        id: 'ask', kind: 'request', type: 'agent.ask', sender: CLAUDE, audience: [CODEX],
        body: { text: 'count the lines' },
      }),
      row(2, {
        id: 'ask-progress', kind: 'response', type: 'agent.ask', sender: CODEX, audience: [CLAUDE],
        parentId: 'ask', body: { status: 'processing', text: 'spawning a sub agent' },
      }),
      row(3, {
        id: 'ask-done', kind: 'response', type: 'agent.ask', sender: CODEX, audience: [CLAUDE],
        parentId: 'ask', body: { status: 'completed', text: '856 lines.' },
      }),
    ]) store.commit(value, SELF);
    const [entry, ...rest] = selectTimelineItems(store.state(CHANNEL), {
      scope: CONVERSATION_SCOPE.mine, selfId: SELF,
    }).items;
    expect(rest).toEqual([]);
    expect(entry.turn.requestId).toBe('ask');
    expect(entry.turn.terminal?.id).toBe('ask-done');
  });

  it('still leaves another person\'s conversation, and the agent work under it, out', () => {
    expect(mine([
      row(1, {
        id: 'alice-ask', kind: 'request', type: 'agent.ask', sender: ALICE, audience: [CLAUDE],
        body: { text: 'hi' },
      }),
      row(2, {
        id: 'alice-sub', kind: 'request', type: 'agent.ask', sender: CLAUDE, audience: [CODEX],
        parentId: 'alice-ask', body: { text: 'help alice' },
      }),
      row(3, {
        id: 'alice-note', type: 'agent.provider.run', sender: CLAUDE, parentId: 'alice-ask',
        body: { text: 'done for alice' },
      }),
      row(4, {
        id: 'alice-done', kind: 'response', type: 'agent.ask', sender: CLAUDE, audience: [ALICE],
        parentId: 'alice-ask', body: { status: 'completed', text: 'hello' },
      }),
    ])).toEqual([]);
  });
});

describe('sub tasks: background work sits in the card of the request that set it off', () => {
  function items(rows) {
    const store = createChannelReplicaStore();
    for (const value of rows) store.commit(value, SELF);
    return selectTimelineItems(store.state(CHANNEL), { scope: CONVERSATION_SCOPE.mine, selfId: SELF }).items;
  }
  const ask = row(1, {
    id: 'ask', kind: 'request', type: 'agent.ask', sender: SELF, audience: [CLAUDE], body: { text: 'research' },
  });
  const done = row(2, {
    id: 'ask-done', kind: 'response', type: 'agent.ask', sender: CLAUDE, audience: [SELF],
    parentId: 'ask', body: { status: 'completed', text: 'sent two sub agents' },
  });
  const step = (seq, id, parentId, phase, text = '') => row(seq, {
    id, type: 'agent.task', sender: CLAUDE, parentId, correlationId: 'ask',
    body: { call_id: 'toolu_1', phase, kind: 'agent', title: 'Read the ledger', text },
  });

  it('collects every step of a task under its request, and none on the timeline', () => {
    const result = items([ask, done, step(3, 't1', 'ask', 'started'), step(4, 't2', 'ask', 'progress', 'Running wc'),
      step(5, 't3', 'ask', 'completed', '856 lines.')]);
    expect(result).toHaveLength(1);
    expect(result[0].turn.requestId).toBe('ask');
    expect(result[0].subTasks.map((envelope) => envelope.id)).toEqual(['t1', 't2', 't3']);
  });

  it('puts a nested call\'s tasks in the card that holds it', () => {
    const nested = row(3, {
      id: 'nested', kind: 'request', type: 'agent.ask', sender: CLAUDE, audience: [CODEX],
      parentId: 'ask', correlationId: 'ask', body: { text: 'spawn and count' },
    });
    const result = items([ask, done, nested, step(4, 'c1', 'nested', 'started')]);
    expect(result).toHaveLength(1);
    expect(result[0].subTasks.map((envelope) => envelope.id)).toEqual(['c1']);
  });

  it('keeps a step whose request is not on screen as its own row', () => {
    const orphan = row(1, {
      id: 'orphan', type: 'agent.task', sender: CLAUDE, parentId: 'gone', correlationId: 'gone',
      body: { call_id: 'toolu_9', phase: 'completed', text: 'late' },
    });
    const own = row(2, { id: 'own', kind: 'request', type: 'agent.ask', sender: SELF, audience: [CLAUDE], parentId: 'gone', correlationId: 'gone', body: { text: 'x' } });
    const result = items([orphan, own]);
    expect(result.some((entry) => entry.kind === 'standalone' && entry.envelope.id === 'orphan')).toBe(true);
  });
});
