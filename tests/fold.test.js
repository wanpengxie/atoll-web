import { describe, expect, it } from 'vitest';
import { fold, orderedTimeline } from '../src/model/fold.js';

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
      env('req-1', 'request', 'agent.ask', { payload: { text: 'ping' }, correlation_id: 'turn-1' }),
      env('p-1', 'response', 'agent.ask', { parent_id: 'req-1', payload: { status: 'queued' }, sender: { kind: 'agent', id: 'agent' } }),
      env('p-2', 'response', 'agent.ask', { parent_id: 'req-1', payload: { status: 'processing' }, sender: { kind: 'agent', id: 'agent' } }),
      env('a-1', 'event', 'agent.tool.started', { correlation_id: 'turn-1', payload: { tool: 'shell', status: 'started' } }),
      env('a-2', 'event', 'agent.tool.ended', { correlation_id: 'turn-1', payload: { tool: 'shell', status: 'completed' } }),
      env('f-1', 'response', 'agent.ask', { parent_id: 'req-1', payload: { status: 'completed', text: 'PONG' }, sender: { kind: 'agent', id: 'agent' } }),
      env('req-2', 'request', 'agent.ask', { payload: { text: 'fail' } }),
      env('f-2', 'response', 'agent.ask', { parent_id: 'req-2', payload: { status: 'failed', reason: 'tool_error', detail: 'boom' }, sender: { kind: 'agent', id: 'agent' } }),
      env('approve-1', 'request', 'human.approve', { audience: ['me'], sender: { kind: 'agent', id: 'agent' }, payload: { action: 'deploy' } }),
      env('sys-1', 'event', 'system.member.created', { visibility: 'system', sender: { kind: 'system', id: 'system' } }),
      env('sys-2', 'event', 'system.member.deleted', { visibility: 'system', sender: { kind: 'system', id: 'system' } }),
      env('sys-2', 'event', 'system.member.deleted', { visibility: 'system', sender: { kind: 'system', id: 'system' } }),
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

  // 一个 agent 在回合里调用别的 actor，发出的是它自己的 request，parent_id 指着
  // 把它叫起来的那条。形状取自真实账本（c0.development-team 的一次 agent.ask：
  // 人问一句，agent 顺手 actor.describe + member.admit，再作答）。摊平的话，人问的
  // 那句和 agent 的六次查询在同一层，读的人分不出哪句是主线。
  it('hangs the calls a turn made under that turn instead of beside it', () => {
    const rows = [
      { channel_id: 'c0', seq: 1, envelope: env('ask', 'request', 'agent.ask', { correlation_id: 'ask', payload: { body: { text: '把 root 拉进来' } } }) },
      { channel_id: 'c0', seq: 2, envelope: env('describe', 'request', 'actor.describe', { parent_id: 'ask', correlation_id: 'ask', sender: { kind: 'agent', id: 'agent' }, payload: { body: {} } }) },
      { channel_id: 'c0', seq: 3, envelope: env('describe-r', 'response', 'actor.describe', { parent_id: 'describe', correlation_id: 'ask', sender: { kind: 'system', id: 'system' }, payload: { status: 'completed' } }) },
      { channel_id: 'c0', seq: 4, envelope: env('admit', 'request', 'system.member.admit', { parent_id: 'ask', correlation_id: 'ask', sender: { kind: 'agent', id: 'agent' }, payload: { body: { principal: 'root' } } }) },
      // 孙代：被 admit 叫出来的再一跳，也归到同一条 thread 上。
      { channel_id: 'c0', seq: 5, envelope: env('nested', 'request', 'system.member.list', { parent_id: 'admit', correlation_id: 'ask', sender: { kind: 'agent', id: 'agent' }, payload: { body: {} } }) },
      { channel_id: 'c0', seq: 6, envelope: env('ask-r', 'response', 'agent.ask', { parent_id: 'ask', correlation_id: 'ask', sender: { kind: 'agent', id: 'agent' }, payload: { status: 'completed', text: '已加入' } }) },
      // 另一条主线：没有 parent 的请求仍然是根。
      { channel_id: 'c0', seq: 7, envelope: env('own', 'request', 'system.channel.list', { correlation_id: 'own', payload: { body: {} } }) },
    ];
    const state = fold(rows, 'me');
    expect(state.turns.size).toBe(5);

    const entries = orderedTimeline(state);
    expect(entries.map((entry) => entry.turn.requestId)).toEqual(['ask', 'own']);
    const [threaded, alone] = entries;
    expect(threaded.thread.map((item) => [item.turn.requestId, item.depth]))
      .toEqual([['describe', 1], ['admit', 1], ['nested', 2]]);
    expect(threaded.turn.text).toBe('已加入');
    expect(alone.thread).toEqual([]);
  });

  // 父不在本频道（跨频道来的、或还没回放到）时宁可平铺，也不能让它从时间线上消失。
  it('keeps a call whose parent this channel never saw', () => {
    const rows = [
      { channel_id: 'c0', seq: 1, envelope: env('orphaned', 'request', 'system.member.list', { parent_id: 'elsewhere', correlation_id: 'elsewhere', payload: { body: {} } }) },
    ];
    expect(orderedTimeline(fold(rows, 'me')).map((entry) => entry.turn.requestId)).toEqual(['orphaned']);
  });
});
