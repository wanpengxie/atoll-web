import { describe, expect, it } from 'vitest';
import { fold } from '../src/model/fold.js';

const base = { ts: 1, channel_id: 'c0', visibility: 'public', audience: ['agent'], sender: { kind: 'human', id: 'me' }, payload: {} };
const env = (id, kind, type, extra = {}) => ({ ...base, id, kind, type, ...extra });
const rows = (envelopes) => envelopes.map((envelope, index) => ({ channel_id: 'c0', seq: index + 1, envelope }));

describe('Phase B request fold', () => {
  it('uses request id as the key and allows multiple requests in one correlation', () => {
    const state = fold(rows([
      env('req-1', 'request', 'human.text', { correlation_id: 'work' }),
      env('req-2', 'request', 'agent.steer', { correlation_id: 'work' }),
      env('done-1', 'response', 'human.text', { parent_id: 'req-1', correlation_id: 'work', payload: { status: 'completed', text: 'one' } }),
      env('done-2', 'response', 'agent.steer', { parent_id: 'req-2', correlation_id: 'work', payload: { status: 'completed', merged: true } }),
    ]));
    expect([...state.turns.keys()]).toEqual(['req-1', 'req-2']);
    expect(state.correlations.get('work')).toEqual(['req-1', 'req-2']);
    expect(state.turns.get('req-1').text).toBe('one');
    expect(state.turns.get('req-2').terminal.payload.merged).toBe(true);
  });

  it('reconciles response and activity that arrive before their request', () => {
    const state = fold(rows([
      env('progress', 'response', 'human.text', { parent_id: 'req', payload: { status: 'queued' }, sender: { kind: 'agent', id: 'agent' } }),
      env('tool', 'event', 'activity.tool.ended', { parent_id: 'req', payload: { tool_call_id: 'tool-1', status: 'completed' }, sender: { kind: 'agent', id: 'agent' } }),
      env('req', 'request', 'human.text'),
      env('done', 'response', 'human.text', { parent_id: 'req', payload: { status: 'completed' }, sender: { kind: 'agent', id: 'agent' } }),
    ]));
    const turn = state.turns.get('req');
    expect(turn.provisional.map((item) => item.status)).toEqual(['queued']);
    expect(turn.activity.map((item) => item.envelope.id)).toEqual(['tool']);
    expect(turn.phase).toBe('completed');
    expect(turn.anomalies.map((item) => item.code)).toContain('tool_start_missing');
  });

  it('preserves core and namespaced provisional and never reopens after the first terminal', () => {
    const state = fold(rows([
      env('req', 'request', 'human.text'),
      env('received', 'response', 'human.text', { parent_id: 'req', payload: { status: 'received' } }),
      env('queued', 'response', 'human.text', { parent_id: 'req', payload: { status: 'queued', position: 2 } }),
      env('processing', 'response', 'human.text', { parent_id: 'req', payload: { status: 'processing', step: 1 } }),
      env('deferred', 'response', 'human.text', { parent_id: 'req', payload: { status: 'deferred', retry_after_ms: 500 } }),
      env('unavailable', 'response', 'human.text', { parent_id: 'req', payload: { status: 'unavailable', reason: 'capacity' } }),
      env('business', 'response', 'human.text', { parent_id: 'req', payload: { status: 'provider.waiting', queue: 2 } }),
      env('done', 'response', 'human.text', { parent_id: 'req', payload: { status: 'completed', value: { ok: true } } }),
      env('late', 'response', 'human.text', { parent_id: 'req', payload: { status: 'processing', late: true } }),
      env('conflict', 'response', 'human.text', { parent_id: 'req', payload: { status: 'failed', reason: 'receiver_internal_error' } }),
    ]));
    const turn = state.turns.get('req');
    expect(turn.provisional.map((item) => [item.status, item.core])).toEqual([
      ['received', true], ['queued', true], ['processing', true], ['deferred', true], ['unavailable', true],
      ['provider.waiting', false], ['processing', true],
    ]);
    expect(turn.provisional.find((item) => item.status === 'deferred').envelope.payload.retry_after_ms).toBe(500);
    expect(turn.phase).toBe('completed');
    expect(turn.terminal.id).toBe('done');
    expect(turn.anomalies.map((item) => item.code)).toEqual(expect.arrayContaining(['provisional_after_terminal', 'terminal_conflict']));
  });
});
