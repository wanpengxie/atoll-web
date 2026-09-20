import { describe, expect, it } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { selectFeatureTaskFacts } from '../src/model/feature-tasks.js';

const CHANNEL = 'c1';
const SELF = 'me';
const AGENT = 'agent';

function row(seq, envelope) {
  return { channel_id: CHANNEL, seq, envelope };
}

function request() {
  return {
    id: 'task-request',
    channel_id: CHANNEL,
    kind: 'request',
    type: 'task.create',
    ts: 100,
    sender: { kind: 'human', id: SELF },
    audience: [AGENT],
    visibility: 'public',
    payload: { body: { title: '跟进报告' } },
  };
}

function terminal() {
  return {
    id: 'task-response',
    channel_id: CHANNEL,
    kind: 'response',
    type: 'task.create',
    parent_id: 'task-request',
    ts: 200,
    sender: { kind: 'agent', id: AGENT },
    audience: [SELF],
    visibility: 'public',
    payload: { body: {
      status: 'completed',
      value: { task_id: 'task-7', status: 'active' },
    } },
  };
}

function note(seq) {
  return {
    id: `note-${seq}`,
    channel_id: CHANNEL,
    kind: 'event',
    type: 'human.note',
    ts: seq,
    sender: { kind: 'human', id: SELF },
    visibility: 'public',
    payload: { body: { text: String(seq) } },
  };
}

describe('TC-1497 feature task compact closure public owner', () => {
  it('[TC-1497] compact task terminal remains unavailable instead of becoming a completed task', () => {
    // 用户能力：历史任务的终态正文被裁剪后，任务中心仍保留这条工作事实，
    // 并明确告诉用户刷新或重新进入频道才能取得详情。
    // 不变量：terminal closure 只证明生命周期已结束，不证明 task result 仍可读；
    // 不能根据 request 或 closure 状态猜成正式 task/completed 结果。
    // 公共 owner：selectFeatureTaskFacts（以及其 terminalResultState 边界），
    // 输入来自 ChannelReplica 的公开 timeline snapshot。
    const replica = createChannelReplicaStore();

    // 模拟终态先于旧 request 页返回；Replica trim 只保留 terminal closure，
    // 随后补回 request，形成当前真实的 compact-closure public fixture。
    expect(replica.commit(row(2, terminal())).accepted).toBe(true);
    for (let seq = 3; seq <= 10; seq += 1) {
      expect(replica.commit(row(seq, note(seq))).accepted).toBe(true);
    }
    expect(replica.trim(CHANNEL, 4)).toBeGreaterThan(0);
    expect(replica.state(CHANNEL)._unmatchedTerminalClosures.has('task-request')).toBe(true);
    expect(replica.commit(row(1, request())).accepted).toBe(true);

    const facts = selectFeatureTaskFacts({
      state: replica.state(CHANNEL),
      selfId: SELF,
    });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({
      key: 'agent_run:c1:task-request',
      kind: 'agent_run',
      state: 'uncertain',
      title: '跟进报告',
      waitingFor: '终态详情不可用，请刷新或重新进入频道',
      actionableBySelf: false,
      provenance: 'ledger',
      diagnostic: {
        resultUnavailable: true,
        resultPhase: 'unavailable',
      },
    });
    expect(facts.some((item) => item.key === 'task:c1:task-7')).toBe(false);
  });
});
