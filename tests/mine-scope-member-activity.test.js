import { describe, expect, it } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { CONVERSATION_SCOPE, selectTimelineItems } from '../src/model/conversation-presentation.js';
import { argsOf } from '../src/protocol/envelope.js';

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

  it('leaves an agent working the machinery or calling a tool on its own out: that is process', () => {
    expect(mine([
      row(1, {
        id: 'log-read', kind: 'request', type: 'system.log.recent', sender: CODEX, audience: ['system'],
        body: { limit: 20 },
      }),
      row(2, {
        id: 'log-read-done', kind: 'response', type: 'system.log.recent', sender: 'system:c0:1',
        audience: [CODEX], parentId: 'log-read', body: { status: 'completed' },
      }),
      row(3, {
        id: 'describe', kind: 'request', type: 'actor.describe', sender: CLAUDE, audience: [CODEX], body: {},
      }),
      row(4, {
        id: 'tool-call', kind: 'request', type: 'xhs.publish', sender: CLAUDE, audience: ['tool:xhs:1'], body: { text: 'post' },
      }),
    ])).toEqual([]);
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

  it('shows the steps of a task with no request on screen as one row that stays put', () => {
    const orphan = (seq, id, phase) => row(seq, {
      id, type: 'agent.task', sender: CLAUDE, body: { call_id: 'toolu_lost', phase, kind: 'agent', text: phase },
    });
    const result = items([orphan(1, 'o1', 'progress'), ask, orphan(3, 'o2', 'progress'), orphan(4, 'o3', 'completed')]);
    const rows = result.filter((entry) => entry.kind === 'standalone');
    expect(rows).toHaveLength(1);
    // Anchored at the first step: later steps update it, never move it down.
    expect(rows[0].envelope.id).toBe('o1');
    expect(rows[0].subTasks.map((envelope) => envelope.id)).toEqual(['o1', 'o2', 'o3']);
  });

  it('folds every task of one off-screen request into a single row', () => {
    const task = (seq, id, call, phase) => row(seq, {
      id, type: 'agent.task', sender: CODEX, parentId: 'old-request', correlationId: 'ask',
      body: { call_id: call, phase, kind: 'agent', title: call },
    });
    // The request that started them is part of the reader's conversation but
    // no longer loaded on the page.
    const result = items([ask, task(11, 'a1', 'luna_00', 'started'), task(12, 'b1', 'luna_01', 'started'),
      task(13, 'a2', 'luna_00', 'completed'), task(14, 'c1', 'luna_02', 'started'), task(15, 'b2', 'luna_01', 'failed')]);
    const rows = result.filter((entry) => entry.kind === 'standalone');
    expect(rows).toHaveLength(1);
    expect(rows[0].subTasks).toHaveLength(5);
  });

  it('folds requestless tasks one agent started back to back into a single row', () => {
    const lost = (seq, call, sender = CLAUDE) => row(seq, {
      id: `lost-${seq}`, type: 'agent.task', sender, body: { call_id: call, phase: 'completed', kind: 'agent', title: call },
    });
    const between = row(5, { id: 'note', kind: 'request', type: 'agent.ask', sender: SELF, audience: [CLAUDE], body: { text: 'next' } });
    const answered = row(7, { id: 'note-done', kind: 'response', type: 'agent.ask', sender: CLAUDE, audience: [SELF], parentId: 'note', body: { status: 'completed', text: 'ok' } });
    const result = items([lost(1, 'b00'), lost(2, 'b01'), lost(3, 'b02'), lost(4, 'x', CODEX), between, lost(6, 'b08'), answered]);
    const rows = result.filter((entry) => entry.kind === 'standalone');
    // claude's b00–b02 are one burst; codex's task is its own; b08 comes after
    // a message and starts a new row.
    expect(rows.map((entry) => entry.subTasks.map((envelope) => argsOf(envelope).call_id))).toEqual([['b00', 'b01', 'b02'], ['x'], ['b08']]);
  });

  it('redraws a row for progress at most every 15 seconds, at once for anything else', () => {
    const step = (seq, id, phase, ts) => {
      const value = row(seq, { id, type: 'agent.task', sender: CLAUDE, parentId: 'ask', correlationId: 'ask', body: { call_id: 't', phase } });
      value.envelope.ts = ts;
      return value;
    };
    const revision = (rows) => items([ask, done, ...rows])[0].subTaskRevision;
    const base = [step(3, 's', 'started', 1_000)];
    const first = revision([...base, step(4, 'p1', 'progress', 2_000)]);
    expect(revision([...base, step(4, 'p1', 'progress', 2_000), step(5, 'p2', 'progress', 9_000)])).toBe(first);
    expect(revision([...base, step(4, 'p1', 'progress', 2_000), step(5, 'p2', 'progress', 16_000)])).not.toBe(first);
    expect(revision([...base, step(4, 'p1', 'progress', 2_000), step(5, 'm', 'message', 3_000)])).not.toBe(first);
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
