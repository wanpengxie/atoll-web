import { describe, expect, it } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { selectFeatureTaskFacts } from '../src/model/feature-tasks.js';

const CHANNEL = 'c1';
const SELF = 'me';
const AGENT = 'agent';

function row(seq, envelope) {
  return { channel_id: CHANNEL, seq, envelope };
}

function request(id, type, body, extra = {}) {
  return {
    id,
    channel_id: CHANNEL,
    kind: 'request',
    type,
    ts: extra.ts || 100,
    sender: extra.sender || { kind: 'human', id: SELF },
    audience: extra.audience || [AGENT],
    visibility: 'public',
    payload: { body },
    ...extra,
  };
}

function response(id, parentId, type, body, extra = {}) {
  return {
    id,
    channel_id: CHANNEL,
    kind: 'response',
    type,
    parent_id: parentId,
    ts: extra.ts || 200,
    sender: extra.sender || { kind: 'agent', id: AGENT },
    audience: extra.audience || [SELF],
    visibility: 'public',
    payload: { body },
    ...extra,
  };
}

describe('TC-1495 feature task facts public owner', () => {
  it('[TC-1495] 任务中心汇总审批、回合、正式任务、恢复和本设备自动动作', () => {
    // 用户能力：用户进入任务中心时，可以在同一列表中看到待审批请求、Agent
    // 回合、已创建的正式任务、待确认提交和本设备自动动作。
    // 不变量：账本事实与本地恢复/自动动作事实分别保留其原生 identity 和
    // provenance；正式任务以 provider 返回的 task_id 作为公开稳定身份。
    // 公共 owner：selectFeatureTaskFacts（src/model/feature-tasks.js），其输入
    // 是当前 ChannelReplica snapshot 与公开的 pending/automation records。
    const replica = createChannelReplicaStore();
    expect(replica.commit(row(1, request(
      'approval-1',
      'human.approve',
      { title: '发布生产', impact: '线上流量' },
      { audience: [SELF], sender: { kind: 'agent', id: AGENT }, expires_at: 9_999 },
    ))).accepted).toBe(true);
    expect(replica.commit(row(2, request(
      'run-1',
      'agent.ask',
      { text: '整理报告' },
    ))).accepted).toBe(true);
    expect(replica.commit(row(3, request(
      'task-request',
      'task.create',
      {
        title: '跟进报告',
        source: { channelId: CHANNEL, view: 'dynamic', objectType: 'turn', objectId: 'run-1', seq: 2 },
      },
    ))).accepted).toBe(true);
    expect(replica.commit(row(4, response(
      'task-response',
      'task-request',
      'task.create',
      { status: 'completed', value: { task_id: 'task-7', status: 'active', title: '跟进报告' } },
    ))).accepted).toBe(true);

    const facts = selectFeatureTaskFacts({
      state: replica.state(CHANNEL),
      selfId: SELF,
      now: 100,
      pending: [{
        key: 'retry-1',
        messageId: 'retry-1',
        channelId: CHANNEL,
        text: '重要提交',
        state: 'uncertain',
        createdAt: 1,
        updatedAt: 2,
      }],
      automationRecords: [{
        timerId: 'timer-1',
        channelId: CHANNEL,
        durationMs: 1000,
        msgType: 'agent.ask',
        payload: { text: '周报提醒' },
        createdAt: 1,
        dueAt: 1001,
        state: 'scheduled',
      }],
    });

    expect(facts.map((item) => item.kind).sort()).toEqual([
      'agent_run',
      'approval',
      'automation',
      'recovery',
      'task',
    ].sort());
    expect(facts.find((item) => item.key === 'task:c1:task-7')).toMatchObject({
      nativeId: 'task-7',
      provenance: 'ledger',
      title: '跟进报告',
    });
    expect(facts.find((item) => item.key === 'automation:c1:timer-1')).toMatchObject({
      localScope: 'this_device',
      provenance: 'local_durable',
      state: 'waiting',
    });
    expect(facts.find((item) => item.key === 'recovery:c1:retry-1')).toMatchObject({
      state: 'uncertain',
      actionableBySelf: true,
    });
  });
});
