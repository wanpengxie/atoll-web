import { describe, expect, it } from 'vitest';
import { fold } from './fold.js';
import { projectTimeline } from './timeline-projection.js';
import { TIMELINE_SCOPE } from './timeline-scope.js';

const CHANNEL_ID = 'channel-1';
const HUMAN_ID = 'human:root:1';
const AGENT_ID = 'agent:codex:1';

function request({ id, type, sender, audience, parentId = '', correlationId = id }) {
  return {
    id,
    channel_id: CHANNEL_ID,
    kind: 'request',
    type,
    sender,
    audience,
    parent_id: parentId,
    correlation_id: correlationId,
    visibility: 'public',
    payload: { body: {} },
  };
}

function response({ id, type, parentId, sender, audience, correlationId = parentId }) {
  return {
    id,
    channel_id: CHANNEL_ID,
    kind: 'response',
    type,
    sender,
    audience,
    parent_id: parentId,
    correlation_id: correlationId,
    visibility: 'public',
    payload: { status: 'completed' },
  };
}

function stateFrom(envelopes) {
  return fold(envelopes.map((envelope, index) => ({
    channel_id: CHANNEL_ID,
    seq: index + 1,
    envelope,
  })), HUMAN_ID);
}

describe('projectTimeline 的 @我 对话投影', () => {
  it('隐藏根级 ui.* 操作，但在全部账本中保留', () => {
    const uiRequest = request({
      id: 'ui-request',
      type: 'ui.state',
      sender: { id: AGENT_ID, kind: 'agent' },
      audience: [HUMAN_ID],
    });
    const state = stateFrom([
      uiRequest,
      response({
        id: 'ui-response',
        type: 'ui.state',
        parentId: uiRequest.id,
        sender: { id: HUMAN_ID, kind: 'human' },
        audience: [AGENT_ID],
      }),
    ]);

    expect(projectTimeline(state, { scope: TIMELINE_SCOPE.mine, selfId: HUMAN_ID }).items).toEqual([]);
    expect(projectTimeline(state, { scope: TIMELINE_SCOPE.all, selfId: HUMAN_ID }).items).toHaveLength(1);
  });

  it('只移除对话下的 ui.* 调用，不隐藏所属对话', () => {
    const conversation = request({
      id: 'conversation',
      type: 'agent.ask',
      sender: { id: HUMAN_ID, kind: 'human' },
      audience: [AGENT_ID],
    });
    const uiRequest = request({
      id: 'nested-ui-request',
      type: 'ui.navigate',
      sender: { id: AGENT_ID, kind: 'agent' },
      audience: [HUMAN_ID],
      parentId: conversation.id,
      correlationId: conversation.id,
    });
    const state = stateFrom([
      conversation,
      uiRequest,
      response({
        id: 'conversation-response',
        type: 'agent.ask',
        parentId: conversation.id,
        sender: { id: AGENT_ID, kind: 'agent' },
        audience: [HUMAN_ID],
      }),
    ]);

    const mine = projectTimeline(state, { scope: TIMELINE_SCOPE.mine, selfId: HUMAN_ID });
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0].turn.requestId).toBe(conversation.id);
    expect(mine.items[0].thread).toEqual([]);

    const all = projectTimeline(state, { scope: TIMELINE_SCOPE.all, selfId: HUMAN_ID });
    expect(all.items[0].thread).toHaveLength(1);
    expect(all.items[0].thread[0].turn.requestId).toBe(uiRequest.id);
  });
});
