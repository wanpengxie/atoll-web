import { describe, expect, it } from 'vitest';
import { createChannelReplicaStore } from './channel-replica.js';
import {
  createFeatureWaitingControlSubmission,
  FEATURE_WAITING_CONTROL,
  selectFeatureWaitingFacts,
} from './feature-tasks.js';

const CHANNEL_ID = 'dev';
const HUMAN_ID = 'human:root:1';
const AGENT_ID = 'agent:codex:1';

function row(seq, envelope) {
  return { channel_id: CHANNEL_ID, seq, envelope };
}

function request(id = 'request-1') {
  return {
    id,
    channel_id: CHANNEL_ID,
    kind: 'request',
    type: 'agent.ask',
    sender: { id: HUMAN_ID, kind: 'human' },
    audience: [AGENT_ID],
    visibility: 'public',
    payload: { body: { text: 'do work' } },
  };
}

function response(id, parentId, body) {
  return {
    id,
    channel_id: CHANNEL_ID,
    kind: 'response',
    type: 'agent.ask',
    parent_id: parentId,
    sender: { id: AGENT_ID, kind: 'agent' },
    audience: [HUMAN_ID],
    visibility: 'public',
    payload: { body },
  };
}

describe('任务区从 ChannelReplica 投影等待控制', () => {
  it('只暴露账本明确声明的控制词，并生成各自的 typed payload', () => {
    const replica = createChannelReplicaStore();
    replica.commit(row(1, request()));
    replica.commit(row(2, response('progress-1', 'request-1', {
      status: 'processing',
      controls: [{ word: FEATURE_WAITING_CONTROL.steer }, { word: FEATURE_WAITING_CONTROL.interrupt }],
    })));

    const [item] = selectFeatureWaitingFacts({ state: replica.state(CHANNEL_ID) });
    expect(item).toMatchObject({
      requestId: 'request-1',
      channelId: CHANNEL_ID,
      actorId: AGENT_ID,
      state: 'processing',
      actions: [FEATURE_WAITING_CONTROL.steer, FEATURE_WAITING_CONTROL.interrupt],
    });
    expect(createFeatureWaitingControlSubmission({ item, type: FEATURE_WAITING_CONTROL.steer })).toEqual({
      channelId: CHANNEL_ID,
      text: '',
      msgType: FEATURE_WAITING_CONTROL.steer,
      audience: [AGENT_ID],
      targetLabel: AGENT_ID,
      payload: { target: 'request-1' },
    });
    expect(createFeatureWaitingControlSubmission({ item, type: FEATURE_WAITING_CONTROL.interrupt })).toEqual({
      channelId: CHANNEL_ID,
      text: '',
      msgType: FEATURE_WAITING_CONTROL.interrupt,
      audience: [AGENT_ID],
      targetLabel: AGENT_ID,
      payload: {},
      controlContext: {
        source: 'feature',
        targetAuthority: null,
        turn: {
          requestId: 'request-1',
          requestType: 'agent.ask',
          audience: [AGENT_ID],
          terminal: false,
          local: false,
          status: 'processing',
          controls: ['agent.steer', 'agent.interrupt'],
          actorId: AGENT_ID,
        },
      },
    });
  });

  it('未知控制词不猜 schema，terminal 到账后等待项消失', () => {
    const replica = createChannelReplicaStore();
    replica.commit(row(1, request()));
    replica.commit(row(2, response('progress-1', 'request-1', {
      status: 'queued', controls: [{ word: 'agent.future' }],
    })));
    const [item] = selectFeatureWaitingFacts({ state: replica.state(CHANNEL_ID) });

    expect(item.actions).toEqual(['agent.future']);
    expect(() => createFeatureWaitingControlSubmission({ item, type: 'agent.future' }))
      .toThrowError('该控制词尚无可靠的请求构造器');

    replica.commit(row(3, response('terminal-1', 'request-1', { status: 'completed' })));
    expect(selectFeatureWaitingFacts({ state: replica.state(CHANNEL_ID) })).toEqual([]);
  });
});
