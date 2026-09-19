import { describe, expect, it } from 'vitest';
import { controlPayload, extraControls, taskControlContext } from './task-controls.js';

describe('work-addressed task controls', () => {
  it('uses the actor-authored work target instead of degrading interrupt to Agent-wide', () => {
    const turn = {
      request: { id: 'request-1', sender: { id: 'human:root:1' }, audience: ['agent:native:1'] },
      provisional: [{ envelope: { payload: { body: { status: 'processing', work_id: 'w-1', controls: [{ word: 'agent.interrupt', payload: { work_id: 'w-1' } }] } } } }],
    };
    const context = taskControlContext(turn, {
      selfId: 'human:root:1',
      access: 'member_active',
      targetAuthority: { current: true, actorIDs: new Set(['agent:native:1']) },
    });
    expect(context.canStop).toBe(true);
    expect(context.workId).toBe('w-1');
    expect(context.workState).toBe('');
    expect(controlPayload(context, 'agent.interrupt', {})).toEqual({ work_id: 'w-1' });
  });

  it('uses the schema-specific caller fallback for compact production controls', () => {
    const context = {
      requestId: 'request-1',
      turnId: 'turn-7',
      controls: [{ word: 'agent.steer' }, { word: 'agent.interrupt' }],
    };
    expect(controlPayload(context, 'agent.steer', { target: 'request-1' })).toEqual({ target: 'request-1' });
    expect(controlPayload(context, 'agent.interrupt', {})).toEqual({});
  });

  it('lets actor payload refine the caller-owned fallback', () => {
    const context = {
      requestId: 'request-1',
      turnId: 'turn-7',
      controls: [{ word: 'agent.interrupt', payload: { work_id: 'w-1', expected_turn_id: 'turn-9' } }],
    };
    expect(controlPayload(context, 'agent.interrupt', {})).toEqual({
      expected_turn_id: 'turn-9',
      work_id: 'w-1',
    });
  });

  it('does not expose a payload-less unknown control or guess its schema', () => {
    const context = {
      actionable: true,
      controls: [{ word: 'agent.interrupt' }, { word: 'agent.future' }],
    };
    expect(controlPayload(context, 'agent.future')).toEqual({});
    expect(extraControls(context)).toEqual([]);
  });

  it('keeps terminal work identity visible after controls disappear', () => {
    const context = taskControlContext({
      request: { id: 'request-1', sender: { id: 'human:root:1' }, audience: ['agent:native:1'] },
      terminal: { payload: { body: { status: 'completed', work_id: 'w-1', state: 'closed', outcome: 'completed' } } },
      provisional: [],
    }, { selfId: 'human:root:1', access: 'member_active' });
    expect(context.workId).toBe('w-1');
    expect(context.workState).toBe('closed');
    expect(context.canStop).toBe(false);
  });
});
