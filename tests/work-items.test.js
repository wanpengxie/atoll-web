import { describe, expect, it } from 'vitest';
import { fold } from '../src/model/fold.js';
import { buildWorkItemIndex, filterWorkItems, taskProviders, workItemGroup } from '../src/model/work-items.js';

function env(id, kind, type, payload, extra = {}) {
  return { id, kind, type, payload, ts: extra.ts || 100, sender: extra.sender || { kind: 'human', id: 'me' }, audience: extra.audience || ['agent'], ...extra };
}

function row(seq, envelope) { return { channel_id: 'c1', seq, envelope }; }

describe('F4 WorkItem 索引', () => {
  it('统一审批、回合、正式任务、恢复和本设备自动动作，且按原生编号去重', () => {
    const state = fold([
      row(1, env('approval-1', 'request', 'human.approve', { title: '发布生产', impact: '线上流量' }, { audience: ['me'], sender: { kind: 'agent', id: 'agent' }, expires_at: 9_999 })),
      row(2, env('run-1', 'request', 'human.text', { text: '整理报告' })),
      row(3, env('task-request', 'request', 'task.create', { title: '跟进报告', source: { channelId: 'c1', view: 'dynamic', objectType: 'turn', objectId: 'run-1', seq: 2 } })),
      row(4, env('task-response', 'response', 'task.create', { status: 'completed', value: { task_id: 'task-7', status: 'active', title: '跟进报告' } }, { parent_id: 'task-request', correlation_id: 'task-request', sender: { kind: 'agent', id: 'agent' }, audience: ['me'] })),
    ], 'me');
    const index = buildWorkItemIndex({
      state, selfId: 'me', access: 'member_active', now: 100,
      pending: [{ key: 'retry-1', messageId: 'retry-1', channelId: 'c1', text: '重要提交', state: 'uncertain', createdAt: 1, updatedAt: 2 }],
      timers: [{ timerId: 'timer-1', channelId: 'c1', durationMs: 1000, msgType: 'human.text', payload: { text: '周报提醒' }, createdAt: 1, dueAt: 1001, state: 'scheduled' }],
    });
    expect([...index.values()].map((item) => item.kind).sort()).toEqual(['agent_run', 'approval', 'automation', 'recovery', 'task'].sort());
    expect(index.get('task:c1:task-7')).toMatchObject({ nativeId: 'task-7', provenance: 'ledger' });
    expect(index.get('automation:c1:timer-1')).toMatchObject({ localScope: 'this_device', provenance: 'local_durable', state: 'waiting' });
    expect(index.get('recovery:c1:retry-1')).toMatchObject({ state: 'uncertain', actionableBySelf: true });
  });

  it('只接受 describe 明确声明 task.create 的 provider', () => {
    const providers = taskProviders(new Map([
      ['agent', { actorId: 'agent', describe: { types: new Map([['task.create', { allowedKinds: ['request'] }]]) } }],
      ['viewer', { actorId: 'viewer', describe: { types: new Map([['human.text', { allowedKinds: ['request'] }]]) } }],
    ]), [{ id: 'agent', name: '执行者' }, { id: 'viewer', name: '观察者' }]);
    expect(providers).toEqual([expect.objectContaining({ actorId: 'agent', name: '执行者' })]);
  });

  it('过滤责任、状态和类型并保持自动动作独立分组', () => {
    const items = [
      { key: 'a', kind: 'approval', state: 'waiting', assigneeActorIds: ['me'], actionableBySelf: true, priority: 'high', updatedAt: 1 },
      { key: 'b', kind: 'automation', state: 'waiting', assigneeActorIds: [], actionableBySelf: true, priority: 'normal', updatedAt: 2 },
      { key: 'c', kind: 'agent_run', state: 'completed', assigneeActorIds: ['agent'], actionableBySelf: false, priority: 'normal', updatedAt: 3 },
    ];
    expect(filterWorkItems(items, { selfId: 'me' }).map((item) => item.key)).toEqual(['a', 'b']);
    expect(filterWorkItems(items, { scope: 'all', status: 'completed', selfId: 'me' }).map((item) => item.key)).toEqual(['c']);
    expect(workItemGroup(items[1])).toBe('automation');
  });
});
