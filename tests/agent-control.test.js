import { describe, expect, it } from 'vitest';
import { agentFrozenState, editAdmission, lockFromContext } from '../src/model/agent-control.js';
import { apply, createChannelState } from '../src/model/fold.js';

const envelope = (id, kind, type, payload, extra = {}) => ({
  id, ts: 1, channel_id: 'c0', sender: kind === 'request' ? { kind: 'human', id: 'me' } : { kind: 'agent', id: 'agent' },
  kind, type, payload, audience: kind === 'request' ? ['agent'] : ['me'], visibility: 'public', ...extra,
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
});
