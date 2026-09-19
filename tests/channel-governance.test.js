import { describe, expect, it } from 'vitest';
import { actorCommand, actorConvergence, createChannelCommand, creationConvergence, isProtectedActor, usableDeclarations, usablePrincipals, validateChannelName } from '../src/model/channel-governance.js';
const terminalTurn = (body, extra = {}) => ({ ...extra, terminal: { payload: { body } } });

const roster = [
  { id: 'system', kind: 'system', name: 'system' },
  { id: 'svcactor', kind: 'peer', decl_id: 'svcactor' },
	{ id: 'human:root:1', kind: 'human', principal: 'root', name: 'root' },
];

describe('阶段 D 频道治理模型', () => {
  it('按真实后端规则校验频道名，并把创建请求发给本频道的 system actor', () => {
    expect(validateChannelName('good-name')).toBe('');
    expect(validateChannelName('Bad')).not.toBe('');
		expect(createChannelCommand({ parentId: 'c0', name: 'child', initialActorIds: [], roster }).audience).toEqual(['system']);
		expect(createChannelCommand({ parentId: 'c0.project', name: 'child', initialActorIds: [], roster }).audience).toEqual(['system']);
		expect(createChannelCommand({ parentId: 'c0', name: 'child', initialActorIds: [], roster }).msgType).toBe('system.channel.create');
		expect(createChannelCommand({ parentId: 'c0', name: 'child', purpose: '用于设计', initialActorIds: ['human:root:1'], roster }).payload)
			.toEqual({ name: 'child', recipe: { declarations: [], profile: { default_storage_device_id: 'local-device', description: '用于设计' } }, initial_actor_ids: ['human:root:1'] });
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

  it('用户选择器只接收注册表中真实的 human principal', () => {
    expect(usablePrincipals([
      { id: 'root', kind: 'human', status: 'present' },
      { id: 'steward', kind: 'agent', status: 'present' },
      { id: 'retired', kind: 'human', status: 'retired' },
    ], [])).toEqual([{ id: 'root', kind: 'human', status: 'present' }]);
  });

  it('创建成功必须分别收敛账本、OBS、membership 和 serving', () => {
    const turn = terminalTurn({ status: 'completed', value: { channel_id: 'new-id' } });
    const waiting = creationConvergence({ turn, expectedQualifiedName: 'c0.new', channels: [{ id: 'new-id', qualified_name: 'c0.new', open: false }], membership: () => true });
    expect(waiting).toMatchObject({ ledger: true, observable: true, membership: true, serving: false, ready: false });
    expect(creationConvergence({ turn, expectedQualifiedName: 'c0.new', channels: [{ id: 'new-id', qualified_name: 'c0.new', open: true }], membership: () => true }).ready).toBe(true);
  });

  it('成员操作把账本终态和 roster 收敛分开判断', () => {
    const turn = terminalTurn({ status: 'completed', member: 'agent-1' });
    expect(actorConvergence({ turn, type: 'system.member.create', roster: [] })).toMatchObject({ ledger: true, rosterConverged: false, ready: false });
    expect(actorConvergence({ turn, type: 'system.member.create', roster: [{ id: 'agent-1', bound: true }] }).ready).toBe(true);
    expect(actorConvergence({ turn: terminalTurn({ status: 'completed', removed: ['agent-1'] }), type: 'system.member.delete', actorId: 'agent-1', roster: [] }).ready).toBe(true);
  });

  it('compact closure 保留 ledger lifecycle，但不以缺失业务结果宣告 ready', () => {
    const createTurn = terminalTurn({ status: 'completed' }, { terminalClosureOnly: true });
    expect(creationConvergence({
      turn: createTurn,
      expectedQualifiedName: 'c0.new',
      channels: [{ id: 'new-id', qualified_name: 'c0.new', open: true }],
      membership: () => true,
    })).toMatchObject({ ledger: true, resultCurrent: false, observable: true, ready: false });
    expect(actorConvergence({
      turn: createTurn,
      type: 'system.member.create',
      actorId: 'agent-1',
      roster: [{ id: 'agent-1', bound: true }],
    })).toMatchObject({ ledger: true, resultCurrent: false, rosterConverged: true, ready: false });
  });

  it('failed compact closure 保留失败生命周期，但不猜失败原因', () => {
    const failedClosure = terminalTurn({ status: 'failed' }, { terminalClosureOnly: true });
    expect(creationConvergence({ turn: failedClosure, expectedQualifiedName: 'c0.new' }))
      .toMatchObject({ failed: true, resultCurrent: false, error: '终态详情不可用，请刷新或重新进入频道' });
    expect(actorConvergence({ turn: failedClosure, type: 'system.member.create' }))
      .toMatchObject({ failed: true, resultCurrent: false, error: '终态详情不可用，请刷新或重新进入频道' });
  });

  it('compact result 缺失是稳定可观测的不可用终态', () => {
    const turn = terminalTurn({ status: 'completed' }, { terminalClosureOnly: true });
    expect(creationConvergence({ turn, expectedQualifiedName: 'c0.new' })).toMatchObject({
      ledger: true,
      resultCurrent: false,
      resultPhase: 'unavailable',
      resultError: '终态详情不可用，请刷新或重新进入频道',
      ready: false,
    });
  });
});
