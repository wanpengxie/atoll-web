import { describe, expect, it } from 'vitest';
import { actorCommand, actorConvergence, createChannelCommand, creationConvergence, isProtectedActor, usableDeclarations, validateChannelName } from '../src/model/channel-governance.js';

const roster = [
  { id: 'system', kind: 'system' },
  { id: 'registrar-1', decl_id: 'atoll-internal:registrar-seat' },
  { id: 'core-1', decl_id: 'coreactor' },
];

describe('阶段 D 频道治理模型', () => {
  it('按真实后端规则校验频道名并选择治理 actor', () => {
    expect(validateChannelName('good-name')).toBe('');
    expect(validateChannelName('Bad')).not.toBe('');
    expect(createChannelCommand({ parentId: 'c0', name: 'child', roster }).audience).toEqual(['registrar-1']);
    expect(createChannelCommand({ parentId: 'c0.project', name: 'child', roster }).audience).toEqual(['core-1']);
    expect(createChannelCommand({ parentId: 'c0', name: 'child', purpose: '用于设计', template: 'tpl:team', roster }).payload).toEqual({ name: 'child', template: 'tpl:team', overrides: { profile: { description: '用于设计' } } });
  });

  it('Actor 维护使用 system 和 instance_id', () => {
    expect(actorCommand({ channelId: 'c0', type: 'channel.remove_actor', payload: { instance_id: 'a1' }, roster })).toMatchObject({ audience: ['system'], payload: { instance_id: 'a1' } });
  });

  it('保护标准/foundation actor 并过滤内部声明', () => {
    expect(isProtectedActor({ id: 'system', kind: 'system' })).toBe(true);
    expect(isProtectedActor({ id: 'peer', decl_id: 'peer:c0.child' })).toBe(true);
    expect(isProtectedActor({ id: 'agent', decl_id: 'demo:agent' })).toBe(false);
    expect(usableDeclarations([{ id: 'coreactor', status: 'present' }, { id: 'demo', name: 'Demo', default_class: 'codex', status: 'present' }], 'agent')).toHaveLength(1);
  });

  it('创建成功必须分别收敛账本、OBS、membership 和 serving', () => {
    const turn = { terminal: { payload: { status: 'completed', value: { id: 'new-id' } } } };
    const waiting = creationConvergence({ turn, expectedQualifiedName: 'c0.new', channels: [{ id: 'new-id', qualified_name: 'c0.new', open: false }], membership: () => true });
    expect(waiting).toMatchObject({ ledger: true, observable: true, membership: true, serving: false, ready: false });
    expect(creationConvergence({ turn, expectedQualifiedName: 'c0.new', channels: [{ id: 'new-id', qualified_name: 'c0.new', open: true }], membership: () => true }).ready).toBe(true);
  });

  it('Actor 操作把账本终态和 roster 收敛分开判断', () => {
    const turn = { terminal: { payload: { status: 'completed', value: { instance_id: 'agent-1' } } } };
    expect(actorConvergence({ turn, type: 'channel.introduce_actor', roster: [] })).toMatchObject({ ledger: true, rosterConverged: false, ready: false });
    expect(actorConvergence({ turn, type: 'channel.introduce_actor', roster: [{ id: 'agent-1', bound: true }] }).ready).toBe(true);
    expect(actorConvergence({ turn: { terminal: { payload: { status: 'completed', value: { removed: true } } } }, type: 'channel.remove_actor', actorId: 'agent-1', roster: [] }).ready).toBe(true);
  });
});
