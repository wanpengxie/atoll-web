import { describe, expect, it } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { searchFeatureIndex, selectFeatureSearchIndex } from '../src/model/feature-search.js';

// Round-15 evidence stays on the current public search owner. The operation
// snapshot is supplied at the same public call boundary as Replica/tasks/files
// and roster facts; the cases assert the resulting public projection.
function row(channelId, seq, envelope) {
  return {
    channel_id: channelId,
    seq,
    envelope: {
      ts: 1_700_000_000_000 + seq,
      visibility: 'public',
      audience: ['human:root:1'],
      sender: { kind: 'human', id: 'human:root:1' },
      ...envelope,
    },
  };
}

function approvalState() {
  const store = createChannelReplicaStore();
  store.commit(row('c1', 4, {
    id: 'approval-1',
    kind: 'request',
    type: 'human.approve',
    sender: { kind: 'agent', id: 'agent:worker:1' },
    audience: ['human:root:1'],
    payload: { body: { title: '批准上线' } },
  }));
  store.commit(row('c1', 5, {
    id: 'approval-result',
    kind: 'response',
    type: 'human.approve',
    parent_id: 'approval-1',
    sender: { kind: 'human', id: 'human:root:1' },
    payload: { body: { status: 'failed', detail: '审批失败' } },
  }));
  return store.state('c1');
}

const channels = [{ id: 'c1', name: '频道 c1', access: 'member_active' }];
const tasks = [{
  key: 'approval:c1:approval-1',
  channelId: 'c1',
  kind: 'approval',
  title: '批准上线',
  state: 'failed',
  requestId: 'approval-1',
  updatedAt: 6,
  source: { channelId: 'c1', view: 'tasks', objectType: 'work_item', objectId: 'approval:c1:approval-1' },
}];

describe('A-D round 15 Activity / Operation blocked evidence', () => {
  it('[AD-002] exposes terminal, WorkItem, and Operation as one locatable business fact', () => {
    // 用户能力：活动中心把同一 request 的终态、任务和操作合成一条可返回来源的事实。
    // 不变量：公开 owner 仍必须按频道/request 去重，不能泄露 ticket/private payload。
    const operations = [{
      operationId: 'approval-submit', channelId: 'c1', requestId: 'approval-1',
      kind: 'message_submit', title: '提交审批', state: 'failed', updatedAt: 7,
      source: { channelId: 'c1', view: 'artifacts', objectType: 'operation', objectId: 'approval-submit' },
    }];
    const index = selectFeatureSearchIndex({
      states: [['c1', approvalState()]], channels, tasks, operations,
    });
    // Current public owner: selectFeatureSearchIndex. The WorkItem remains
    // the canonical same-request row; Operation is still projected only when
    // no higher-priority WorkItem owns that request.
    expect(index.filter((entry) => entry.kind === 'operation')).toHaveLength(0);
    expect(index.filter((entry) => entry.kind === 'work_item')).toEqual([
      expect.objectContaining({
        id: 'approval:c1:approval-1',
        requestId: 'approval-1',
        source: expect.objectContaining({ view: 'tasks' }),
      }),
    ]);
  });

  it('[AD-003] deduplicates Operation by channel/native id and retains the latest unsettled state', () => {
    // 用户能力：重复上传操作只显示最新未收敛状态；完成项和 denied 频道不出现。
    // 不变量：频道身份/native operation id 是去重边界，source 只含公开定位事实。
    const operations = [
      { operationId: 'upload-1', channelId: 'c1', title: '旧上传', state: 'transferring', updatedAt: 10 },
      { operationId: 'upload-1', channelId: 'c1', title: '新上传', state: 'waiting_ledger', updatedAt: 20 },
      { operationId: 'done-1', channelId: 'c1', title: '已完成', state: 'completed', updatedAt: 30 },
    ];
    const index = selectFeatureSearchIndex({
      states: [], channels, operations,
    });
    expect(index.filter((entry) => entry.kind === 'operation')).toEqual([
      expect.objectContaining({ id: 'upload-1', state: 'waiting_ledger' }),
    ]);
  });

  it('[AD-004] searches visible channels across operations with a public SourceRef', () => {
    // 用户能力：全局搜索按词命中进行中的操作，并能回到其 artifacts 来源。
    // 不变量：搜索只消费可见频道的公开 Operation projection，不读私有 ticket。
    const operations = [{
      operationId: 'export-1', channelId: 'c1', title: '上传预算附件', state: 'waiting_ledger', updatedAt: 20,
      source: { channelId: 'c1', view: 'artifacts', objectType: 'operation', objectId: 'export-1' },
    }];
    const index = selectFeatureSearchIndex({ states: [], channels, operations });
    expect(searchFeatureIndex(index, '预算附件', { kinds: ['operation'] })).toEqual([
      expect.objectContaining({ kind: 'operation', source: expect.objectContaining({ objectId: 'export-1' }) }),
    ]);
  });
});
