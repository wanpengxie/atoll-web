import { describe, expect, it } from 'vitest';
import { apply, createChannelState, fold } from './fold.js';
import { createConversationPresentation } from './conversation-presentation.js';
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

  it('把已嵌套 child 的连续 progress 发布为可见 root 行修订', () => {
    const root = request({
      id: 'conversation',
      type: 'project.task',
      sender: { id: HUMAN_ID, kind: 'human' },
      audience: [AGENT_ID],
    });
    const child = request({
      id: 'tool-call',
      type: 'tool.exec',
      sender: { id: AGENT_ID, kind: 'agent' },
      audience: [HUMAN_ID],
      parentId: root.id,
      correlationId: root.id,
    });
    const state = createChannelState(CHANNEL_ID);
    apply(state, { channel_id: CHANNEL_ID, seq: 1, envelope: root }, HUMAN_ID);
    apply(state, { channel_id: CHANNEL_ID, seq: 2, envelope: child }, HUMAN_ID);

    const presentation = createConversationPresentation();
    const options = {
      scope: TIMELINE_SCOPE.all,
      selfId: HUMAN_ID,
      presentation,
      presentationKey: `${CHANNEL_ID}:all`,
      dataEpoch: 'generation:1',
    };
    const initial = projectTimeline(state, options).presentation;
    const initialRow = initial.entities.get(root.id);
    expect(initialRow.body.thread[0].turn.provisional).toEqual([]);

    apply(state, {
      channel_id: CHANNEL_ID,
      seq: 3,
      envelope: {
        ...response({
          id: 'progress-1', type: child.type, parentId: child.id,
          sender: { id: AGENT_ID, kind: 'agent' }, audience: [HUMAN_ID],
          correlationId: root.id,
        }),
        payload: { status: 'processing', process: { kind: 'stage', text: 'first' } },
      },
    }, HUMAN_ID);
    const first = projectTimeline(state, options).presentation;
    const firstRow = first.entities.get(root.id);
    expect(firstRow).not.toBe(initialRow);
    expect(first.changes.updated).toEqual([root.id]);
    expect(firstRow.seqHigh).toBe(3);
    expect(firstRow.body.thread[0].turn.provisional.at(-1).envelope.payload.process.text).toBe('first');

    apply(state, {
      channel_id: CHANNEL_ID,
      seq: 4,
      envelope: {
        ...response({
          id: 'progress-2', type: child.type, parentId: child.id,
          sender: { id: AGENT_ID, kind: 'agent' }, audience: [HUMAN_ID],
          correlationId: root.id,
        }),
        payload: { status: 'processing', process: { kind: 'stage', text: 'second' } },
      },
    }, HUMAN_ID);
    const second = projectTimeline(state, options).presentation;
    const secondRow = second.entities.get(root.id);
    expect(secondRow).not.toBe(firstRow);
    expect(second.changes.updated).toEqual([root.id]);
    expect(secondRow.seqHigh).toBe(4);
    expect(secondRow.body.thread[0].turn.provisional.at(-1).envelope.payload.process.text).toBe('second');

    apply(state, {
      channel_id: CHANNEL_ID,
      seq: 5,
      envelope: response({
        id: 'tool-final', type: child.type, parentId: child.id,
        sender: { id: AGENT_ID, kind: 'agent' }, audience: [HUMAN_ID],
        correlationId: root.id,
      }),
    }, HUMAN_ID);
    const terminal = projectTimeline(state, options).presentation;
    const terminalRow = terminal.entities.get(root.id);
    expect(terminalRow).not.toBe(secondRow);
    expect(terminal.changes.updated).toEqual([root.id]);
    expect(terminalRow.seqHigh).toBe(5);
    expect(terminalRow.body.thread[0].turn.terminal.id).toBe('tool-final');
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

  it('过滤掉的 child progress 只推进 source clock，不伪造 root 内容修订', () => {
    const conversation = request({
      id: 'conversation-filtered-child',
      type: 'project.task',
      sender: { id: HUMAN_ID, kind: 'human' },
      audience: [AGENT_ID],
    });
    const uiRequest = request({
      id: 'nested-ui-progress',
      type: 'ui.navigate',
      sender: { id: AGENT_ID, kind: 'agent' },
      audience: [HUMAN_ID],
      parentId: conversation.id,
      correlationId: conversation.id,
    });
    const state = createChannelState(CHANNEL_ID);
    apply(state, { channel_id: CHANNEL_ID, seq: 1, envelope: conversation }, HUMAN_ID);
    apply(state, { channel_id: CHANNEL_ID, seq: 2, envelope: uiRequest }, HUMAN_ID);
    const presentation = createConversationPresentation();
    const options = {
      scope: TIMELINE_SCOPE.mine,
      selfId: HUMAN_ID,
      presentation,
      presentationKey: `${CHANNEL_ID}:mine`,
      dataEpoch: 'generation:1',
    };
    const initial = projectTimeline(state, options).presentation;
    const initialRow = initial.entities.get(conversation.id);
    expect(initialRow.body.thread).toEqual([]);

    apply(state, {
      channel_id: CHANNEL_ID,
      seq: 3,
      envelope: {
        ...response({
          id: 'ui-progress', type: uiRequest.type, parentId: uiRequest.id,
          sender: { id: HUMAN_ID, kind: 'human' }, audience: [AGENT_ID],
          correlationId: conversation.id,
        }),
        payload: { status: 'processing', message: 'hidden operation progress' },
      },
    }, HUMAN_ID);
    const advanced = projectTimeline(state, options).presentation;
    expect(advanced.sourceRevision).toBeGreaterThan(initial.sourceRevision);
    expect(advanced.entities.get(conversation.id)).toBe(initialRow);
    expect(advanced.entities.get(conversation.id).body.thread).toEqual([]);
  });
});
