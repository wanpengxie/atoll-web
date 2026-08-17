import { describe, expect, it } from 'vitest';
import { normalizeDescribe } from '../src/model/capabilities.js';
import { taskControlContext } from '../src/model/task-controls.js';

describe('task control eligibility', () => {
  const capability = { describe: normalizeDescribe({ actor_id: 'agent', types: { 'agent.steer': {}, 'agent.interrupt': {}, 'human.text': { max_pending_ms: 9000 } } }) };
  const turn = {
    request: { id: 'r1', type: 'human.text', sender: { id: 'me' }, audience: ['agent'], expires_at: 2000 },
    provisional: [{ envelope: { payload: { status: 'processing', turn_id: 'turn-7' } } }], terminal: null,
  };

  it('requires ownership, a writable channel and an advertised control', () => {
    expect(taskControlContext(turn, { selfId: 'me', access: 'member_active', capability, now: 1000 })).toMatchObject({ canCancel: true, canSteer: true, canInterrupt: true, turnId: 'turn-7', expired: false, maxPendingMs: 9000 });
    expect(taskControlContext(turn, { selfId: 'other', access: 'member_active', capability }).canCancel).toBe(false);
    expect(taskControlContext(turn, { selfId: 'me', access: 'member_stale', capability }).canSteer).toBe(false);
    expect(taskControlContext({ ...turn, terminal: { payload: { status: 'completed' } } }, { selfId: 'me', access: 'member_active', capability }).canCancel).toBe(false);
  });
});
