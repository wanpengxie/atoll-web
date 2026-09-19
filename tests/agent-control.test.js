import { describe, expect, it } from 'vitest';
import { agentFrozenState, editAdmission, lockFromContext } from '../src/model/agent-control.js';
import { apply, createChannelState } from '../src/model/fold.js';

const envelope = (id, kind, type, payload, extra = {}) => ({
  id, ts: 1, channel_id: 'c0', sender: kind === 'request' ? { kind: 'human', id: 'me' } : { kind: 'agent', id: 'agent' },
  kind, type, payload: { body: payload }, audience: kind === 'request' ? ['agent'] : ['me'], visibility: 'public', ...extra,
});

function stateOf(envelopes) {
  const state = createChannelState('c0');
  envelopes.forEach((value, index) => apply(state, { channel_id: 'c0', seq: index + 1, envelope: value }));
  return state;
}

describe('agent control v7 presentation', () => {
  it('31 waits for the processing target own queued resumed fact before opening edit', () => {
    const before = stateOf([
      envelope('r1', 'request', 'agent.ask', { text: 'old' }),
      envelope('r1-p', 'response', 'agent.ask', { status: 'processing', turn_id: 't1' }, { parent_id: 'r1' }),
      envelope('h1', 'request', 'agent.hold', { target: 'r1' }),
      envelope('h1-d', 'response', 'agent.hold', { status: 'completed' }, { parent_id: 'h1' }),
    ]);
    const session = { holdId: 'h1', targetId: 'r1', location: 'processing' };
    expect(editAdmission(before, session)).toEqual({ ready: false, error: '' });
    apply(before, { channel_id: 'c0', seq: 5, envelope: envelope('r1-q', 'response', 'agent.ask', { status: 'queued', resumed: true, held_by: 'h1' }, { parent_id: 'r1' }) });
    expect(editAdmission(before, session)).toEqual({ ready: true, error: '' });
  });

  it('32 derives freeze from causal order, wall clock, and queue advancement', () => {
    const lateTerminal = stateOf([
      envelope('h1', 'request', 'agent.hold', { duration_ms: 1000 }),
      envelope('r1', 'request', 'agent.ask', { text: 'new work' }),
      envelope('r1-q', 'response', 'agent.ask', { status: 'queued' }, { parent_id: 'r1' }),
      envelope('h1-d', 'response', 'agent.hold', { status: 'completed' }, { parent_id: 'h1' }),
    ]);
    expect(agentFrozenState(lateTerminal, 'agent', 100)).toBeNull();

    const expiring = stateOf([
      envelope('h2', 'request', 'agent.hold', { duration_ms: 1000 }),
      envelope('h2-d', 'response', 'agent.hold', { status: 'completed' }, { parent_id: 'h2' }),
    ]);
    expect(agentFrozenState(expiring, 'agent', 1000)).toMatchObject({ held_by: 'h2', until: 1001, source: 'agent.hold' });
    expect(agentFrozenState(expiring, 'agent', 1001)).toBeNull();

    const advanced = stateOf([
      envelope('queued', 'request', 'agent.ask', { text: 'old work' }),
      envelope('queued-q', 'response', 'agent.ask', { status: 'queued' }, { parent_id: 'queued' }),
      envelope('h3', 'request', 'agent.hold', {}),
      envelope('h3-d', 'response', 'agent.hold', { status: 'completed' }, { parent_id: 'h3' }),
      envelope('queued-p', 'response', 'agent.ask', { status: 'processing' }, { parent_id: 'queued' }),
    ]);
    expect(agentFrozenState(advanced, 'agent', 100)).toBeNull();

    expect(lockFromContext({ status: 'completed' }, 'h1')).toEqual({ valid: false, error: '编辑锁已失效' });
    expect(lockFromContext({ status: 'completed', frozen: { held_by: 'h1', until: 9 } }, 'h1').valid).toBe(true);
  });

  it('33 ignores a late hold fire whose hold_id does not match held_by', () => {
    const state = stateOf([
      envelope('h2', 'request', 'agent.hold', {}),
      envelope('h2-d', 'response', 'agent.hold', { status: 'completed' }, { parent_id: 'h2' }),
      envelope('fire-old', 'event', 'agent.hold_expired', { hold_id: 'h1' }, { sender: { kind: 'agent', id: 'agent' }, audience: ['agent'] }),
    ]);
    expect(agentFrozenState(state, 'agent', 100)).toEqual({ held_by: 'h2', until: 1800001, source: 'agent.hold', target_id: '' });
    apply(state, { channel_id: 'c0', seq: 4, envelope: envelope('fire-current', 'event', 'agent.hold_expired', { hold_id: 'h2' }, { sender: { kind: 'agent', id: 'agent' }, audience: ['agent'] }) });
    expect(agentFrozenState(state, 'agent', 100)).toBeNull();
  });

  it('34 restores an interrupt after an overlaid edit hold is released or expires', () => {
    const released = stateOf([
      envelope('stop', 'request', 'agent.interrupt', {}),
      envelope('stop-d', 'response', 'agent.interrupt', { status: 'completed' }, { parent_id: 'stop' }),
      envelope('hold', 'request', 'agent.hold', { duration_ms: 1000 }),
      envelope('hold-d', 'response', 'agent.hold', { status: 'completed' }, { parent_id: 'hold' }),
      envelope('release', 'request', 'agent.unhold', { expected_hold_id: 'hold' }),
      envelope('release-d', 'response', 'agent.unhold', { status: 'completed', released: true, hold_id: 'hold' }, { parent_id: 'release' }),
    ]);
    expect(agentFrozenState(released, 'agent', 10)).toMatchObject({ held_by: 'stop', source: 'agent.interrupt' });

    const expired = stateOf([
      envelope('stop', 'request', 'agent.interrupt', {}),
      envelope('stop-d', 'response', 'agent.interrupt', { status: 'completed' }, { parent_id: 'stop' }),
      envelope('hold', 'request', 'agent.hold', { duration_ms: 1000 }),
      envelope('hold-d', 'response', 'agent.hold', { status: 'completed' }, { parent_id: 'hold' }),
    ]);
    expect(agentFrozenState(expired, 'agent', 1001)).toMatchObject({ held_by: 'stop', source: 'agent.interrupt' });
  });

  it('compact unhold closure 不把缺失 released 猜成 legacy true', () => {
    const state = stateOf([
      envelope('hold', 'request', 'agent.hold', { target: 'old' }),
      envelope('hold-d', 'response', 'agent.hold', { status: 'completed' }, { parent_id: 'hold' }),
      envelope('release', 'request', 'agent.unhold', { expected_hold_id: 'hold' }),
      envelope('release-d', 'response', 'agent.unhold', { status: 'completed', released: true }, { parent_id: 'release' }),
    ]);
    state.turns.get('release').terminalClosureOnly = true;
    expect(agentFrozenState(state, 'agent', 10)).toMatchObject({ held_by: 'hold', source: 'agent.hold' });

    state.turns.get('hold').terminalClosureOnly = true;
    expect(editAdmission(state, { holdId: 'hold', targetId: 'old', location: 'queued' }))
      .toEqual({ ready: false, error: '终态详情不可用，请刷新或重新进入频道' });
  });

  it('35 keeps replace under its edit hold and ignores stale unhold after interrupt', () => {
    const replacing = stateOf([
      envelope('hold', 'request', 'agent.hold', { target: 'old' }),
      envelope('hold-d', 'response', 'agent.hold', { status: 'completed' }, { parent_id: 'hold' }),
      envelope('replacement', 'request', 'agent.replace', { target: 'old', old_text: 'old', new_text: 'new' }),
      envelope('replacement-q', 'response', 'agent.replace', { status: 'queued', resumed: true }, { parent_id: 'replacement' }),
    ]);
    expect(agentFrozenState(replacing, 'agent', 10)).toMatchObject({ held_by: 'hold', source: 'agent.hold' });

    const interrupted = stateOf([
      envelope('hold', 'request', 'agent.hold', { target: 'old' }),
      envelope('hold-d', 'response', 'agent.hold', { status: 'completed' }, { parent_id: 'hold' }),
      envelope('stop', 'request', 'agent.interrupt', {}),
      envelope('stop-d', 'response', 'agent.interrupt', { status: 'completed' }, { parent_id: 'stop' }),
      envelope('stale-release', 'request', 'agent.unhold', { expected_hold_id: 'hold' }),
      envelope('stale-release-d', 'response', 'agent.unhold', { status: 'completed', released: false }, { parent_id: 'stale-release' }),
    ]);
    expect(agentFrozenState(interrupted, 'agent', 31 * 60 * 1000)).toMatchObject({ held_by: 'stop', source: 'agent.interrupt' });
  });

  // 账本 seq 93719–93725 的现场：hold 完成后两秒，一条**早就在跑**的 agent.ask
  // 出了一条 processing 进度行，冻结归约把它当"队列前进"清掉了编辑租约，前端
  // 随即释放 hold，用户看到"编辑被另一项控制终止"。进度行不是前进。
  it('36 keeps the editing lease while a turn already running before the hold keeps reporting progress', () => {
    const state = stateOf([
      envelope('running', 'request', 'agent.ask', { text: 'long job' }),
      envelope('running-p1', 'response', 'agent.ask', { status: 'processing', turn_id: 't1' }, { parent_id: 'running' }),
      envelope('queued', 'request', 'agent.ask', { text: 'to edit' }),
      envelope('queued-q', 'response', 'agent.ask', { status: 'queued' }, { parent_id: 'queued' }),
      envelope('h1', 'request', 'agent.hold', { target: 'queued' }, { parent_id: 'queued' }),
      envelope('h1-d', 'response', 'agent.hold', { status: 'completed' }, { parent_id: 'h1' }),
      envelope('running-p2', 'response', 'agent.ask', { status: 'processing', turn_id: 't1' }, { parent_id: 'running' }),
    ]);
    expect(agentFrozenState(state, 'agent', 100)).toMatchObject({ held_by: 'h1', source: 'agent.hold', target_id: 'queued' });
    // 业务进度行（非核心状态）夹在两条 processing 之间同样不是一次跃迁。
    apply(state, { channel_id: 'c0', seq: 8, envelope: envelope('running-b', 'response', 'agent.ask', { status: 'tool.started' }, { parent_id: 'running' }) });
    apply(state, { channel_id: 'c0', seq: 9, envelope: envelope('running-p3', 'response', 'agent.ask', { status: 'processing' }, { parent_id: 'running' }) });
    expect(agentFrozenState(state, 'agent', 100)).toMatchObject({ held_by: 'h1', source: 'agent.hold' });
    // 队列真的前进了才作废：被 hold 的那一条自己开跑。
    apply(state, { channel_id: 'c0', seq: 10, envelope: envelope('queued-p', 'response', 'agent.ask', { status: 'processing' }, { parent_id: 'queued' }) });
    expect(agentFrozenState(state, 'agent', 100)).toBeNull();
  });

  it('37 clears the lease when the held target resumes processing after a paused stretch', () => {
    const state = stateOf([
      envelope('target', 'request', 'agent.ask', { text: 'running message' }),
      envelope('target-p', 'response', 'agent.ask', { status: 'processing' }, { parent_id: 'target' }),
      envelope('h2', 'request', 'agent.hold', { target: 'target' }, { parent_id: 'target' }),
      envelope('h2-d', 'response', 'agent.hold', { status: 'completed' }, { parent_id: 'h2' }),
      envelope('target-q', 'response', 'agent.ask', { status: 'queued', resumed: true, held_by: 'h2' }, { parent_id: 'target' }),
    ]);
    expect(agentFrozenState(state, 'agent', 100)).toMatchObject({ held_by: 'h2', source: 'agent.hold', target_id: 'target' });
    apply(state, { channel_id: 'c0', seq: 6, envelope: envelope('target-p2', 'response', 'agent.ask', { status: 'processing' }, { parent_id: 'target' }) });
    expect(agentFrozenState(state, 'agent', 100)).toBeNull();
  });
});
