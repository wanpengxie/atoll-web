import { describe, expect, it } from 'vitest';
import { actorCommand, actorConvergence, createChannelCommand, creationConvergence, isProtectedActor, usableDeclarations, validateChannelName } from '../src/model/channel-governance.js';

const roster = [
  { id: 'system', kind: 'system', name: 'system' },
  { id: 'svcactor', kind: 'peer', decl_id: 'svcactor' },
];

describe('阶段 D 频道治理模型', () => {
  it('按真实后端规则校验频道名，并把创建请求发给本频道的 system actor', () => {
    expect(validateChannelName('good-name')).toBe('');
    expect(validateChannelName('Bad')).not.toBe('');
    expect(createChannelCommand({ parentId: 'c0', name: 'child', roster }).audience).toEqual(['system']);
    expect(createChannelCommand({ parentId: 'c0.project', name: 'child', roster }).audience).toEqual(['system']);
    expect(createChannelCommand({ parentId: 'c0', name: 'child', roster }).msgType).toBe('system.channel.create');
    expect(createChannelCommand({ parentId: 'c0', name: 'child', purpose: '用于设计', roster }).payload)
      .toEqual({ name: 'child', recipe: { declarations: [], profile: { description: '用于设计' } } });
  });

  it('成员维护使用 system 和 member 字段', () => {
    expect(actorCommand({ channelId: 'c0', type: 'system.member.delete', payload: { member: 'a1' }, roster }))
      .toMatchObject({ audience: ['system'], payload: { member: 'a1' } });
  });

  it('保护标准/foundation actor 并过滤内部声明', () => {
    expect(isProtectedActor({ id: 'system', kind: 'system' })).toBe(true);
    expect(isProtectedActor({ id: 'peer', decl_id: 'peer:c0.child' })).toBe(true);
    expect(isProtectedActor({ id: 'agent', decl_id: 'demo:agent' })).toBe(false);
    expect(usableDeclarations([{ id: 'svcactor', status: 'present' }, { id: 'demo', name: 'Demo', default_class: 'codex', status: 'present' }], 'agent')).toHaveLength(1);
  });

  it('创建成功必须分别收敛账本、OBS、membership 和 serving', () => {
    const turn = { terminal: { payload: { status: 'completed', value: { channel_id: 'new-id' } } } };
    const waiting = creationConvergence({ turn, expectedQualifiedName: 'c0.new', channels: [{ id: 'new-id', qualified_name: 'c0.new', open: false }], membership: () => true });
    expect(waiting).toMatchObject({ ledger: true, observable: true, membership: true, serving: false, ready: false });
    expect(creationConvergence({ turn, expectedQualifiedName: 'c0.new', channels: [{ id: 'new-id', qualified_name: 'c0.new', open: true }], membership: () => true }).ready).toBe(true);
  });

  it('成员操作把账本终态和 roster 收敛分开判断', () => {
    const turn = { terminal: { payload: { status: 'completed', member: 'agent-1' } } };
    expect(actorConvergence({ turn, type: 'system.member.create', roster: [] })).toMatchObject({ ledger: true, rosterConverged: false, ready: false });
    expect(actorConvergence({ turn, type: 'system.member.create', roster: [{ id: 'agent-1', bound: true }] }).ready).toBe(true);
    expect(actorConvergence({ turn: { terminal: { payload: { status: 'completed', removed: ['agent-1'] } } }, type: 'system.member.delete', actorId: 'agent-1', roster: [] }).ready).toBe(true);
  });
});
