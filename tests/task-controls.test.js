import { describe, expect, it } from 'vitest';
import { normalizeDescribe } from '../src/model/capabilities.js';
import { taskControlContext } from '../src/model/task-controls.js';

describe('task control eligibility', () => {
  const capability = { describe: normalizeDescribe({ class: 'codex', capabilities: { steer: true, interrupt: true }, words: { 'agent.steer': {}, 'agent.interrupt': {}, 'agent.hold': {}, 'agent.ask': {} } }) };
  const turn = {
    request: { id: 'r1', type: 'agent.ask', sender: { id: 'me' }, audience: ['agent'], expires_at: 2000 },
    provisional: [{ envelope: { payload: { status: 'processing', turn_id: 'turn-7' } } }], terminal: null,
  };

  it('requires ownership, a writable channel and an advertised control', () => {
    expect(taskControlContext(turn, { selfId: 'me', access: 'member_active', capability, now: 1000 })).toMatchObject({ canCancel: false, canInsert: false, canEdit: true, canStop: true, location: 'processing', turnId: 'turn-7', expired: false });
    expect(taskControlContext(turn, { selfId: 'other', access: 'member_active', capability }).canCancel).toBe(false);
    expect(taskControlContext(turn, { selfId: 'me', access: 'member_stale', capability }).canInsert).toBe(false);
    expect(taskControlContext({ ...turn, terminal: { payload: { status: 'completed' } } }, { selfId: 'me', access: 'member_active', capability }).canCancel).toBe(false);
  });

  it('30 reads the steer capability bit even when the fixed word exists', () => {
    const fixedWordOnly = { describe: normalizeDescribe({ class: 'codex', capabilities: { steer: false }, words: { 'agent.steer': {}, 'agent.hold': {} } }) };
    const queued = { ...turn, provisional: [{ envelope: { payload: { status: 'queued' } } }] };
    expect(taskControlContext(queued, { selfId: 'me', access: 'member_active', capability: fixedWordOnly }).canInsert).toBe(false);
  });
});
