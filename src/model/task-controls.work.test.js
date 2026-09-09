import { describe, expect, it } from 'vitest';
import { controlPayload, taskControlContext } from './task-controls.js';

describe('work-addressed task controls', () => {
  it('uses the actor-authored work target instead of degrading interrupt to Agent-wide', () => {
    const turn = {
      request: { id: 'request-1', sender: { id: 'human:root:1' }, audience: ['agent:native:1'] },
      provisional: [{ envelope: { payload: { status: 'processing', work_id: 'w-1', controls: [{ word: 'agent.interrupt', payload: { work_id: 'w-1' } }] } } }],
    };
    const context = taskControlContext(turn, { selfId: 'human:root:1', access: 'member_active' });
    expect(context.canStop).toBe(true);
    expect(context.workId).toBe('w-1');
    expect(context.workState).toBe('');
    expect(controlPayload(context, 'agent.interrupt', {})).toEqual({ work_id: 'w-1' });
  });

  it('retains legacy caller fallback when the control entry has no payload', () => {
    const context = { controls: [{ word: 'agent.dismiss' }] };
    expect(controlPayload(context, 'agent.dismiss', { target: 'request-1' })).toEqual({ target: 'request-1' });
  });

  it('keeps terminal work identity visible after controls disappear', () => {
    const context = taskControlContext({
      request: { id: 'request-1', sender: { id: 'human:root:1' }, audience: ['agent:native:1'] },
      terminal: { payload: { status: 'completed', work_id: 'w-1', state: 'closed', outcome: 'completed' } },
      provisional: [],
    }, { selfId: 'human:root:1', access: 'member_active' });
    expect(context.workId).toBe('w-1');
    expect(context.workState).toBe('closed');
    expect(context.canStop).toBe(false);
  });
});
