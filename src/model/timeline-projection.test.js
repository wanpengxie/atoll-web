import { describe, expect, it } from 'vitest';
import { createChannelReplicaStore } from './channel-replica.js';
import {
  CONVERSATION_SCOPE,
  createConversationPresentation,
  selectTimelineItems,
} from './conversation-presentation.js';

const CHANNEL_ID = 'channel-1';
const HUMAN_ID = 'human:root:1';
const AGENT_ID = 'agent:codex:1';

function request({ id, type = 'agent.ask', sender = HUMAN_ID, audience = [AGENT_ID], parentId = '', correlationId = id }) {
  return {
    id,
    channel_id: CHANNEL_ID,
    kind: 'request',
    type,
    sender: { id: sender, kind: sender.startsWith('human:') ? 'human' : 'agent' },
    audience,
    parent_id: parentId,
    correlation_id: correlationId,
    visibility: 'public',
    payload: { body: { text: id } },
  };
}

function response({ id, parentId, type = 'agent.ask', sender = AGENT_ID, audience = [HUMAN_ID], correlationId = parentId, body = { status: 'completed' } }) {
  return {
    id,
    channel_id: CHANNEL_ID,
    kind: 'response',
    type,
    sender: { id: sender, kind: sender.startsWith('human:') ? 'human' : 'agent' },
    audience,
    parent_id: parentId,
    correlation_id: correlationId,
    visibility: 'public',
    payload: { body },
  };
}

function commit(replica, seq, envelope) {
  expect(replica.commit({ channel_id: CHANNEL_ID, seq, envelope }).accepted).toBe(true);
}

function present(presentation, state, options = {}) {
  const selection = selectTimelineItems(state, options);
  const candidate = presentation.evaluate(selection.items, {
    epoch: 'generation:1',
    nextViewID: `${CHANNEL_ID}:${options.scope || CONVERSATION_SCOPE.mine}`,
    sourceRevision: state._timelineRevision,
    sourceChangeBase: state._timelineChangeBase,
    sourceChanges: state._timelineChangeLog,
  });
  expect(presentation.commitCandidate(candidate)).toBe(true);
  return candidate.snapshot;
}

describe('ChannelReplica → ConversationPresentation', () => {
  it('我的对话隐藏根级 ui.*，全部账本仍保留该 turn', () => {
    const replica = createChannelReplicaStore();
    commit(replica, 1, request({
      id: 'ui-request', type: 'ui.state', sender: AGENT_ID, audience: [HUMAN_ID],
    }));
    commit(replica, 2, response({
      id: 'ui-response', parentId: 'ui-request', type: 'ui.state', sender: HUMAN_ID, audience: [AGENT_ID],
    }));
    const state = replica.state(CHANNEL_ID);

    expect(selectTimelineItems(state, {
      scope: CONVERSATION_SCOPE.mine, selfId: HUMAN_ID,
    }).items).toEqual([]);
    expect(selectTimelineItems(state, {
      scope: CONVERSATION_SCOPE.all, selfId: HUMAN_ID,
    }).items.map((entry) => entry.turn.requestId)).toEqual(['ui-request']);
  });

  it('嵌套 child 的连续 progress 修订同一 root，已发布快照保持脱离与冻结', () => {
    const replica = createChannelReplicaStore();
    const root = request({ id: 'conversation', type: 'project.task' });
    const child = request({
      id: 'tool-call', type: 'tool.exec', sender: AGENT_ID, audience: [HUMAN_ID],
      parentId: root.id, correlationId: root.id,
    });
    commit(replica, 1, root);
    commit(replica, 2, child);

    const presentation = createConversationPresentation();
    const options = { scope: CONVERSATION_SCOPE.all, selfId: HUMAN_ID };
    const initial = present(presentation, replica.state(CHANNEL_ID), options);
    const initialRow = initial.entities.get(root.id);
    expect(initialRow.body.thread[0].turn.provisional).toEqual([]);
    expect(Object.isFrozen(initialRow.body)).toBe(true);

    commit(replica, 3, response({
      id: 'progress-1', type: child.type, parentId: child.id, correlationId: root.id,
      body: { status: 'processing', process: { kind: 'stage', text: 'first' } },
    }));
    const first = present(presentation, replica.state(CHANNEL_ID), options);
    const firstRow = first.entities.get(root.id);
    expect(firstRow).not.toBe(initialRow);
    expect(first.changes.updated).toEqual([root.id]);
    expect(firstRow.seqHigh).toBe(3);
    expect(firstRow.body.thread[0].turn.provisional.at(-1).envelope.payload.body.process.text).toBe('first');
    expect(initialRow.body.thread[0].turn.provisional).toEqual([]);

    commit(replica, 4, response({
      id: 'progress-2', type: child.type, parentId: child.id, correlationId: root.id,
      body: { status: 'processing', process: { kind: 'stage', text: 'second' } },
    }));
    const second = present(presentation, replica.state(CHANNEL_ID), options);
    expect(second.entities.get(root.id)).not.toBe(firstRow);
    expect(second.changes.updated).toEqual([root.id]);
    expect(second.entities.get(root.id).body.thread[0].turn.provisional.at(-1).envelope.payload.body.process.text)
      .toBe('second');
  });

  it('mine 只移除 ui child，不隐藏所属对话；all 仍显示完整 thread', () => {
    const replica = createChannelReplicaStore();
    const root = request({ id: 'conversation', type: 'project.task' });
    commit(replica, 1, root);
    commit(replica, 2, request({
      id: 'nested-ui-request', type: 'ui.navigate', sender: AGENT_ID, audience: [HUMAN_ID],
      parentId: root.id, correlationId: root.id,
    }));

    const state = replica.state(CHANNEL_ID);
    const mine = selectTimelineItems(state, { scope: CONVERSATION_SCOPE.mine, selfId: HUMAN_ID });
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0].turn.requestId).toBe(root.id);
    expect(mine.items[0].thread).toEqual([]);

    const all = selectTimelineItems(state, { scope: CONVERSATION_SCOPE.all, selfId: HUMAN_ID });
    expect(all.items[0].thread.map((entry) => entry.turn.requestId)).toEqual(['nested-ui-request']);
  });

  it('a person replying to an answer is its own turn, not a call nested under the old one', () => {
    // cvmax 2026-09-23 #42195: a reply shares the answered turn's correlation
    // and its parent_id names the answer (a response). It was filed as a
    // "关联调用" child of the old turn and vanished from the timeline.
    const replica = createChannelReplicaStore();
    const first = request({ id: 'first-ask' });
    commit(replica, 1, first);
    commit(replica, 2, response({ id: 'first-answer', parentId: first.id, body: { status: 'completed', text: 'answer' } }));
    commit(replica, 3, request({ id: 'reply', parentId: 'first-answer', correlationId: first.id }));
    commit(replica, 4, response({ id: 'reply-queued', parentId: 'reply', correlationId: first.id, body: { status: 'queued' } }));
    commit(replica, 6, request({ id: 'later-ask' }));
    commit(replica, 7, response({
      id: 'reply-merged', parentId: 'reply', correlationId: first.id,
      body: { status: 'completed', merged_into: 'later-ask' },
    }));
    commit(replica, 5, request({ id: 'agent-call', sender: AGENT_ID, audience: ['tool:x:1'], parentId: first.id, correlationId: first.id }));

    const state = replica.state(CHANNEL_ID);
    const all = selectTimelineItems(state, { scope: CONVERSATION_SCOPE.all, selfId: HUMAN_ID });
    const roots = all.items.filter((item) => item.turn).map((item) => item.turn.requestId);
    expect(roots).toContain('reply');
    const firstTurn = all.items.find((item) => item.turn?.requestId === first.id);
    // An agent's own call made while serving the turn is still its child.
    expect(firstTurn.thread.map((entry) => entry.turn.requestId)).toEqual(['agent-call']);
  });
});
