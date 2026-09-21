import { describe, expect, it } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { searchFeatureIndex, selectFeatureSearchIndex } from '../src/model/feature-search.js';

const channels = [{ id: 'c1', name: '研究频道', access: 'member_active' }];

describe('feature search operation projection', () => {
  it('AD-002 exposes one public operation source for an unresolved terminal fact', () => {
    const index = selectFeatureSearchIndex({
      channels,
      operations: [{
        operationId: 'approval-submit',
        channelId: 'c1',
        requestId: 'approval-1',
        kind: 'message_submit',
        title: '提交审批',
        state: 'failed',
        updatedAt: 7,
        source: {
          channelId: 'c1',
          view: 'artifacts',
          objectType: 'operation',
          objectId: 'approval-submit',
          privateTicket: 'must-not-leak',
        },
      }],
    });

    const operations = index.filter((entry) => entry.kind === 'operation');
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      id: 'approval-submit',
      objectType: 'operation',
      state: 'failed',
      source: {
        channelId: 'c1',
        objectId: 'approval-submit',
      },
    });
    expect(operations[0].source).not.toHaveProperty('privateTicket');
  });

  it('AD-003 deduplicates an operation by channel/native id and keeps its newest unsettled state', () => {
    const index = selectFeatureSearchIndex({
      channels,
      operations: [
        {
          operationId: 'upload-1',
          channelId: 'c1',
          title: '旧上传',
          state: 'transferring',
          updatedAt: 10,
        },
        {
          operationId: 'upload-1',
          channelId: 'c1',
          title: '新上传',
          state: 'waiting_ledger',
          updatedAt: 20,
        },
        {
          operationId: 'done-1',
          channelId: 'c1',
          title: '已完成',
          state: 'completed',
          updatedAt: 30,
        },
        {
          operationId: 'settled-after-upload',
          channelId: 'c1',
          title: '进行中的上传',
          state: 'transferring',
          updatedAt: 10,
        },
        {
          operationId: 'settled-after-upload',
          channelId: 'c1',
          title: '上传已完成',
          state: 'completed',
          updatedAt: 20,
        },
      ],
    });

    expect(index.filter((entry) => entry.kind === 'operation')).toEqual([
      expect.objectContaining({ id: 'upload-1', title: '新上传', state: 'waiting_ledger' }),
    ]);
  });

  it('AD-004 makes operation titles searchable and preserves the public source reference', () => {
    const index = selectFeatureSearchIndex({
      channels,
      operations: [{
        operationId: 'export-1',
        channelId: 'c1',
        title: '上传预算附件',
        state: 'waiting_ledger',
        updatedAt: 20,
        source: {
          channelId: 'c1',
          view: 'artifacts',
          objectType: 'operation',
          objectId: 'export-1',
        },
      }],
    });

    expect(searchFeatureIndex(index, '预算附件', { kinds: ['operation'] })).toEqual([
      expect.objectContaining({
        kind: 'operation',
        source: expect.objectContaining({ objectId: 'export-1', channelId: 'c1' }),
      }),
    ]);
  });

  it('keeps a same-request WorkItem ahead of its Operation projection', () => {
    const index = selectFeatureSearchIndex({
      channels,
      tasks: [{
        key: 'approval:c1:approval-1',
        channelId: 'c1',
        kind: 'approval',
        title: '批准上线',
        state: 'failed',
        requestId: 'approval-1',
        updatedAt: 6,
        source: {
          channelId: 'c1',
          view: 'tasks',
          objectType: 'work_item',
          objectId: 'approval:c1:approval-1',
          requestId: 'approval-1',
        },
      }],
      operations: [{
        operationId: 'approval-submit',
        channelId: 'c1',
        requestId: 'approval-1',
        title: '提交审批',
        state: 'failed',
        updatedAt: 7,
      }],
    });

    expect(index.filter((entry) => entry.kind === 'operation')).toHaveLength(0);
    expect(index.filter((entry) => entry.kind === 'work_item')).toEqual([
      expect.objectContaining({ id: 'approval:c1:approval-1', requestId: 'approval-1' }),
    ]);
  });

  it('TC-0005 keeps same-request facts isolated by channel and ranks WorkItem ahead of Turn', () => {
    // 用户能力：同名 request 在不同频道各自可搜索；同频道 WorkItem 覆盖其 Turn。
    // 不变量：频道/request 是去重边界，WorkItem rank 0 必须高于 Turn rank 2。
    // 公开 owner：selectFeatureSearchIndex/searchFeatureIndex；只使用公开 Replica 状态。
    const buildState = (channelId) => {
      const store = createChannelReplicaStore();
      expect(store.commit({
        channel_id: channelId,
        seq: 1,
        envelope: {
          id: 'history-1',
          kind: 'request',
          type: 'agent.ask',
          sender: { kind: 'human', id: 'human:root:1' },
          audience: ['agent:codex:1'],
          visibility: 'public',
          payload: { body: { text: '重名历史任务' } },
        },
      }).accepted).toBe(true);
      expect(store.commit({
        channel_id: channelId,
        seq: 2,
        envelope: {
          id: `${channelId}-history-1-done`,
          kind: 'response',
          type: 'agent.ask',
          parent_id: 'history-1',
          sender: { kind: 'agent', id: 'agent:codex:1' },
          audience: ['human:root:1'],
          visibility: 'public',
          payload: { body: { status: 'completed', text: '完成' } },
        },
      }).accepted).toBe(true);
      return store.state(channelId);
    };

    const index = selectFeatureSearchIndex({
      channels: [
        { id: 'c1', name: '频道 c1', access: 'member_active' },
        { id: 'c2', name: '频道 c2', access: 'member_active' },
      ],
      states: new Map([
        ['c1', buildState('c1')],
        ['c2', buildState('c2')],
      ]),
      tasks: [{
        key: 'agent_run:c1:history-1',
        channelId: 'c1',
        kind: 'agent_run',
        title: '重名历史任务',
        state: 'active',
        requestId: 'history-1',
        updatedAt: 500,
        source: { requestId: 'history-1' },
      }],
    });

    const results = searchFeatureIndex(index, '重名历史任务');
    expect(results).toHaveLength(2);
    expect(results.map((item) => [item.channelId, item.kind]).sort()).toEqual([
      ['c1', 'work_item'],
      ['c2', 'turn'],
    ]);
    expect(results.find((item) => item.channelId === 'c1')).toMatchObject({
      kind: 'work_item',
      source: { channelId: 'c1', view: 'tasks', objectType: 'work_item' },
    });
    expect(results.find((item) => item.channelId === 'c2')).toMatchObject({
      kind: 'turn',
      source: { channelId: 'c2', view: 'dynamic', objectType: 'turn' },
    });
  });
});
