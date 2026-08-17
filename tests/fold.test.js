import { describe, expect, it } from 'vitest';
import { fold } from '../src/model/fold.js';

const base = {
  ts: 1,
  channel_id: 'c0',
  visibility: 'public',
  audience: ['agent'],
  sender: { kind: 'human', id: 'me' },
  payload: {},
};

function env(id, kind, type, extra = {}) {
  return { ...base, id, kind, type, ...extra };
}

describe('feed fold', () => {
  it('folds a 12-row mixed stream into turns, narration, and approvals', () => {
    const rows = [
      env('req-1', 'request', 'human.text', { payload: { text: 'ping' }, correlation_id: 'turn-1' }),
      env('p-1', 'response', 'human.text', { parent_id: 'req-1', payload: { status: 'queued' }, sender: { kind: 'agent', id: 'agent' } }),
      env('p-2', 'response', 'human.text', { parent_id: 'req-1', payload: { status: 'processing' }, sender: { kind: 'agent', id: 'agent' } }),
      env('a-1', 'event', 'activity.tool.started', { correlation_id: 'turn-1', payload: { tool: 'shell', status: 'started' } }),
      env('a-2', 'event', 'activity.tool.ended', { correlation_id: 'turn-1', payload: { tool: 'shell', status: 'completed' } }),
      env('f-1', 'response', 'human.text', { parent_id: 'req-1', payload: { status: 'completed', text: 'PONG' }, sender: { kind: 'agent', id: 'agent' } }),
      env('req-2', 'request', 'human.text', { payload: { text: 'fail' } }),
      env('f-2', 'response', 'human.text', { parent_id: 'req-2', payload: { status: 'failed', reason: 'tool_error', detail: 'boom' }, sender: { kind: 'agent', id: 'agent' } }),
      env('approve-1', 'request', 'human.approve', { audience: ['me'], sender: { kind: 'agent', id: 'agent' }, payload: { action: 'deploy' } }),
      env('sys-1', 'event', 'system.actor.registered', { visibility: 'system', sender: { kind: 'system', id: 'system' } }),
      env('sys-2', 'event', 'system.actor.deregistered', { visibility: 'system', sender: { kind: 'system', id: 'system' } }),
      env('sys-2', 'event', 'system.actor.deregistered', { visibility: 'system', sender: { kind: 'system', id: 'system' } }),
    ].map((envelope, index) => ({ channel_id: 'c0', seq: index + 1, envelope }));

    const state = fold(rows, 'me');
    expect(state.lastSeq).toBe(12);
    expect(state.rows.size).toBe(11);
    expect(state.turns.size).toBe(3);
    expect(state.narration).toHaveLength(2);
    expect(state.approvals.has('approve-1')).toBe(true);

    const first = state.turns.get('req-1');
    expect(first.provisional).toHaveLength(2);
    expect(first.activity).toHaveLength(2);
    expect(first.status).toBe('completed');
    expect(first.text).toBe('PONG');
    expect(first.provisional.map((item) => item.status)).toEqual(['queued', 'processing']);

    const failed = state.turns.get('req-2');
    expect(failed.status).toBe('failed');
    expect(failed.text).toBe('tool_error: boom');
  });
});
