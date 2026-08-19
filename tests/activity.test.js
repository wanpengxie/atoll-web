import { describe, expect, it } from 'vitest';
import {
  activeOperations,
  buildActivityIndex,
  buildGlobalSearchIndex,
  buildOperationIndex,
  isActivityChannelVisible,
  searchGlobalIndex,
} from '../src/model/activity.js';
import { fold } from '../src/model/fold.js';
import { buildWorkspaceHash } from '../src/model/workspace-route.js';

function envelope(id, kind, type, payload, extra = {}) {
  return {
    id,
    kind,
    type,
    payload,
    ts: extra.ts || 100,
    sender: extra.sender || { kind: 'human', id: 'alice' },
    audience: extra.audience || ['agent'],
    ...extra,
  };
}

function state(channelId, entries) {
  return fold(entries.map(([seq, value]) => ({ channel_id: channelId, seq, envelope: value })));
}

function channel(id, access, extra = {}) {
  return { id, name: `频道 ${id}`, access, state: extra.state, ...extra };
}

describe('F5 Activity 与跨频道索引', () => {
  it('只读取当前可见频道，denied、discoverable、retired 与 loading 缓存不会泄漏', () => {
    const visibleState = state('visible', [
      [1, envelope('visible-turn', 'request', 'agent.ask', { text: '公开项目灯塔' })],
      [2, envelope('visible-done', 'response', 'agent.ask', { status: 'completed', text: '完成' }, { parent_id: 'visible-turn', sender: { kind: 'agent', id: 'agent' } })],
    ]);
    const secretState = state('denied', [
      [1, envelope('secret-turn', 'request', 'agent.ask', { text: '绝密海鸥计划' })],
      [2, envelope('secret-failed', 'response', 'agent.ask', { status: 'failed', detail: '绝密错误' }, { parent_id: 'secret-turn' })],
    ]);
    const channels = [
      channel('visible', 'member_active', { state: visibleState }),
      channel('observer', 'observer_stale', { state: state('observer', [[1, envelope('observer-turn', 'request', 'agent.ask', { text: '观察记录' })]]) }),
      channel('denied', 'access_denied', { name: '绝密频道', state: secretState, participants: [{ id: 'secret-person', name: '绝密成员' }] }),
      channel('discoverable', 'discoverable', { state: secretState }),
      channel('retired', 'retired', { state: secretState }),
      channel('loading', 'loading', { state: secretState }),
    ];
    const operations = [
      { operationId: 'visible-op', channelId: 'visible', state: 'uncertain', title: '公开上传', updatedAt: 20 },
      { operationId: 'secret-op', channelId: 'denied', state: 'failed', title: '绝密操作', updatedAt: 30 },
    ];

    expect(isActivityChannelVisible(channels[0])).toBe(true);
    expect(isActivityChannelVisible(channels[1])).toBe(true);
    expect(channels.slice(2).every((row) => !isActivityChannelVisible(row))).toBe(true);

    const activity = buildActivityIndex({ channels, operations });
    const search = buildGlobalSearchIndex({ channels, operations });
    const serialized = JSON.stringify({ activity: [...activity.values()], search: [...search.values()] });
    expect(serialized).toContain('公开项目灯塔');
    expect(serialized).toContain('观察记录');
    expect(serialized).not.toContain('绝密');
    expect(serialized).not.toContain('secret-person');
    expect([...activity.values()].every((item) => ['visible', 'observer'].includes(item.channelId))).toBe(true);
    expect(searchGlobalIndex(search, '绝密')).toEqual([]);
  });

  it('以业务事实去重 terminal、WorkItem 和 Operation，并保留可返回的 SourceRef', () => {
    const ledger = state('c1', [
      [4, envelope('approval-1', 'request', 'human.approve', { title: '批准上线' }, { sender: { kind: 'agent', id: 'agent' }, audience: ['me'] })],
      [5, envelope('approval-result', 'response', 'human.approve', { status: 'failed', detail: '审批失败' }, { parent_id: 'approval-1', sender: { kind: 'human', id: 'me' } })],
    ]);
    const source = { channelId: 'c1', view: 'dynamic', objectType: 'turn', objectId: 'approval-1', seq: 4, requestId: 'approval-1' };
    const channels = [channel('c1', 'member_active', {
      state: ledger,
      workItems: [{
        key: 'approval:c1:approval-1', nativeId: 'approval-1', kind: 'approval', title: '批准上线', state: 'failed',
        actionableBySelf: true, updatedAt: 6, source,
      }],
    })];
    const operations = [{
      operationId: 'approval-submit', channelId: 'c1', requestId: 'approval-1', kind: 'message_submit', title: '提交审批',
      state: 'failed', updatedAt: 7, source: { ...source, copiedTitle: '不应进入 SourceRef' },
    }];

    const rows = [...buildActivityIndex({ channels, operations }).values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'work_item', title: '批准上线', factKey: 'c1:request:approval-1',
      source: { channelId: 'c1', view: 'tasks', objectType: 'work_item', objectId: 'approval:c1:approval-1' },
    });
    expect(rows[0].source).not.toHaveProperty('copiedTitle');
  });

  it('Operation 按频道和原生 ID 去重，采用最新状态并只列出未收敛项', () => {
    const channels = [channel('c1', 'member_stale'), channel('denied', 'access_denied')];
    const operations = [
      { operationId: 'upload-1', channelId: 'c1', title: '旧上传', state: 'transferring', updatedAt: 10, source: { channelId: 'c1', view: 'artifacts', objectType: 'operation', objectId: 'upload-1' } },
      { operationId: 'upload-1', channelId: 'c1', title: '新上传', state: 'waiting_ledger', updatedAt: 20, ticket: 'drop-ticket', payload: { token: 'drop-token' }, source: { channelId: 'c1', view: 'artifacts', objectType: 'operation', objectId: 'upload-1', privatePayload: 'drop-me' } },
      { operationId: 'done-1', channelId: 'c1', title: '已完成', state: 'completed', updatedAt: 30 },
      { operationId: 'denied-1', channelId: 'denied', title: '不可见', state: 'uncertain', updatedAt: 99 },
    ];

    const index = buildOperationIndex({ channels, operations });
    expect([...index.keys()]).toEqual(['operation:c1:upload-1', 'operation:c1:done-1']);
    expect(index.get('operation:c1:upload-1')).toMatchObject({ title: '新上传', state: 'waiting_ledger' });
    expect(index.get('operation:c1:upload-1').source).not.toHaveProperty('privatePayload');
    expect(index.get('operation:c1:upload-1')).not.toHaveProperty('ticket');
    expect(index.get('operation:c1:upload-1')).not.toHaveProperty('payload');
    expect(activeOperations(index).map((item) => item.operationId)).toEqual(['upload-1']);
  });

  it('全局搜索覆盖频道、回合、产物、任务、成员和操作，支持分词、过滤、排序与 SourceRef', () => {
    const ledger = state('c1', [
      [1, envelope('turn-1', 'request', 'agent.ask', { text: '整理 夏季 预算' }, { ts: 10 })],
      [2, envelope('turn-result', 'response', 'agent.ask', { status: 'completed', text: '预算已整理' }, { parent_id: 'turn-1', ts: 11 })],
      [3, envelope('event-1', 'event', 'project.notice', { text: '预算复核提醒' }, { ts: 12 })],
    ]);
    const channels = [channel('c1', 'member_unavailable', {
      name: '夏季规划',
      state: ledger,
      artifacts: [{ key: 'artifact:c1:budget', resourceId: 'budget', name: '夏季预算.xlsx', kind: 'table', mediaType: 'application/vnd.ms-excel', lastSeq: 4, source: { channelId: 'c1', view: 'artifacts', objectType: 'artifact', objectId: 'artifact:c1:budget', seq: 4 } }],
      workItems: [{ key: 'task:c1:review', nativeId: 'review', kind: 'task', title: '复核夏季预算', state: 'active', updatedAt: 15, assigneeActorIds: ['bob'], source: { channelId: 'c1', view: 'tasks', objectType: 'work_item', objectId: 'task:c1:review' } }],
      participants: [
        { id: 'bob', name: 'Bob 财务', description: '预算负责人' },
        { id: 'system', name: '系统' },
        { id: 'registrar', name: '注册器', decl_id: 'atoll-internal:registrar-seat' },
        { id: 'svcactor', name: '服务 Actor', decl_id: 'atoll-internal:svcactor' },
        { id: 'generated-core', name: '核心 Actor', decl_id: 'coreactor' },
      ],
    })];
    const operations = [{ operationId: 'export-1', channelId: 'c1', kind: 'file_upload', title: '上传预算附件', state: 'waiting_ledger', updatedAt: 20 }];
    const index = buildGlobalSearchIndex({ channels, operations });

    expect(new Set([...index.values()].map((item) => item.kind))).toEqual(new Set(['channel', 'turn', 'entry', 'artifact', 'work_item', 'participant', 'operation']));
    expect(searchGlobalIndex(index, '夏季 预算').map((item) => item.kind)).toEqual(['artifact', 'work_item', 'turn']);
    expect(searchGlobalIndex(index, 'BOB', { kinds: ['participant'] })).toEqual([
      expect.objectContaining({ kind: 'participant', title: 'Bob 财务', source: { channelId: 'c1', view: 'dynamic', objectType: 'participant', objectId: 'bob' } }),
    ]);
    expect(searchGlobalIndex(index, '预算', { kinds: ['artifact'], channelId: 'c1', limit: 1 })).toEqual([
      expect.objectContaining({
        kind: 'artifact',
        source: { channelId: 'c1', view: 'artifacts', objectType: 'artifact', objectId: 'artifact:c1:budget' },
      }),
    ]);
    expect(searchGlobalIndex(index, '复核夏季预算', { kinds: ['work_item'] })).toEqual([
      expect.objectContaining({
        kind: 'work_item',
        source: { channelId: 'c1', view: 'tasks', objectType: 'work_item', objectId: 'task:c1:review' },
      }),
    ]);
    expect(searchGlobalIndex(index, '系统')).toEqual([]);
    expect(searchGlobalIndex(index, '注册器')).toEqual([]);
    expect(searchGlobalIndex(index, '服务 Actor')).toEqual([]);
    expect(searchGlobalIndex(index, '核心 Actor')).toEqual([]);
    expect(searchGlobalIndex(index, '预算', { limit: 0 })).toEqual([]);
    expect(searchGlobalIndex(index, '   ')).toEqual([]);
  });

  it('同频道同 request 的搜索事实优先保留 WorkItem，不与其他频道的同名 request 合并', () => {
    const firstState = state('c1', [[1, envelope('history-1', 'request', 'agent.ask', { text: '重名历史任务' })]]);
    const secondState = state('c2', [[1, envelope('history-1', 'request', 'agent.ask', { text: '重名历史任务' })]]);
    const channels = [
      channel('c1', 'member_active', {
        state: firstState,
        workItems: [{
          key: 'agent_run:c1:history-1', nativeId: 'history-1', kind: 'agent_run', title: '重名历史任务', state: 'active', updatedAt: 500,
          source: { channelId: 'c1', view: 'dynamic', objectType: 'turn', objectId: 'history-1', seq: 1 },
        }],
      }),
      channel('c2', 'member_active', { state: secondState, workItems: [] }),
    ];

    const results = searchGlobalIndex(buildGlobalSearchIndex({ channels }), '重名历史任务');
    expect(results).toHaveLength(2);
    expect(results.map((item) => [item.channelId, item.kind])).toEqual([['c1', 'work_item'], ['c2', 'turn']]);
    expect(results.filter((item) => item.channelId === 'c1')).toEqual([
      expect.objectContaining({
        source: { channelId: 'c1', view: 'tasks', objectType: 'work_item', objectId: 'agent_run:c1:history-1' },
      }),
    ]);
    const source = results[0].source;
    expect(buildWorkspaceHash({
      channelId: source.channelId,
      view: source.view,
      focus: { type: source.objectType, key: source.objectId },
    })).toBe('#/channels/c1/tasks?focus=work_item%3Aagent_run%3Ac1%3Ahistory-1');
  });
});
