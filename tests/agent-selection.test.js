import { describe, expect, it } from 'vitest';
import { latestAgentUsage, latestInteractedAgentId, resolveParameterAgent } from '../src/model/agent-selection.js';

const STEWARD = { id: 'steward', kind: 'agent', name: 'Steward' };
const CLAUDE = { id: 'claude', kind: 'agent', name: 'Claude' };
const ME = { id: 'me', kind: 'human', name: '我' };
const PEER = { id: 'peer', kind: 'human', name: '同事' };
const ROSTER = [ME, PEER, STEWARD, CLAUDE];

function stateOf(rows) {
  return { rows: new Map(rows.map((row, index) => [row.id || `row-${index}`, row])) };
}

const ask = (id, sender, audience) => ({ id, kind: 'request', type: 'agent.ask', sender: { id: sender }, audience });

describe('参数面板目标判据链（§2.1）', () => {
  it('@ 恰一个 agent 优先于一切', () => {
    const out = resolveParameterAgent({ mentions: [CLAUDE], manualAgentId: 'steward', roster: ROSTER, state: stateOf([ask('a', 'me', ['steward'])]), selfId: 'me' });
    expect(out).toMatchObject({ kind: 'single', agent: CLAUDE, source: 'mention' });
  });

  it('@ 多个 agent 是多目标态', () => {
    expect(resolveParameterAgent({ mentions: [STEWARD, CLAUDE], roster: ROSTER, selfId: 'me' })).toEqual({ kind: 'multi', count: 2 });
  });

  it('只 @ 人类时收起（不显示最近 agent 误导）', () => {
    const out = resolveParameterAgent({ mentions: [PEER], roster: ROSTER, state: stateOf([ask('a', 'me', ['steward'])]), selfId: 'me' });
    expect(out.kind).toBe('none');
  });

  it('无 @ 时手选压最近交互', () => {
    const out = resolveParameterAgent({ mentions: [], manualAgentId: 'claude', roster: ROSTER, state: stateOf([ask('a', 'me', ['steward'])]), selfId: 'me' });
    expect(out).toMatchObject({ kind: 'single', agent: CLAUDE, source: 'manual' });
  });

  it('最近交互取我发的最后一条 agent.ask', () => {
    const state = stateOf([ask('a', 'me', ['steward']), ask('b', 'me', ['claude'])]);
    const out = resolveParameterAgent({ mentions: [], roster: ROSTER, state, selfId: 'me' });
    expect(out).toMatchObject({ kind: 'single', agent: CLAUDE, source: 'recent' });
  });

  it('多 agent 且无任何判据时为 none（前端拦截手选）', () => {
    expect(resolveParameterAgent({ mentions: [], roster: ROSTER, state: stateOf([]), selfId: 'me' }).kind).toBe('none');
  });

  it('唯一 agent 频道恒有目标', () => {
    const roster = [ME, STEWARD];
    const out = resolveParameterAgent({ mentions: [], roster, state: stateOf([]), selfId: 'me' });
    expect(out).toMatchObject({ kind: 'single', agent: STEWARD, source: 'only' });
  });
});

describe('最近交互判据的抗污染（§2.1.3）', () => {
  const agents = new Set(['steward', 'claude']);

  it('describe / context / select 这类自省控制词恒不改默认目标', () => {
    const state = stateOf([
      ask('a', 'me', ['steward']),
      { id: 'b', kind: 'request', type: 'actor.describe', sender: { id: 'me' }, audience: ['claude'] },
      { id: 'c', kind: 'request', type: 'agent.context', sender: { id: 'me' }, audience: ['claude'] },
      { id: 'd', kind: 'request', type: 'agent.select', sender: { id: 'me' }, audience: ['claude'] },
    ]);
    expect(latestInteractedAgentId(state, 'me', agents)).toBe('steward');
  });

  it('其他用户的交互恒不改我的默认目标', () => {
    const state = stateOf([ask('a', 'me', ['steward']), ask('b', 'peer', ['claude'])]);
    expect(latestInteractedAgentId(state, 'me', agents)).toBe('steward');
  });

  it('已不在 roster 的 agent 不再作为默认目标', () => {
    const state = stateOf([ask('a', 'me', ['gone'])]);
    expect(latestInteractedAgentId(state, 'me', agents)).toBe('');
  });
});

describe('当前值保鲜（§4.1）', () => {
  const turnEnded = (id, sender, usage) => ({ id, kind: 'event', type: 'agent.turn.ended', sender: { id: sender }, payload: { status: 'ok', usage } });

  it('取最后一个带非空 model/effort 的 turn.ended usage', () => {
    const state = stateOf([
      turnEnded('a', 'steward', { model: 'm1', effort: 'low', context_tokens: 10 }),
      turnEnded('b', 'steward', { model: 'm2', effort: 'high', context_tokens: 20 }),
    ]);
    expect(latestAgentUsage(state, 'steward')).toMatchObject({ model: 'm2', effort: 'high', contextTokens: 20 });
  });

  it('缺 usage 或缺字段的 turn.ended 跳过，不清空显示（provider lost 形）', () => {
    const state = stateOf([
      turnEnded('a', 'steward', { model: 'm1', effort: 'low' }),
      { id: 'b', kind: 'event', type: 'agent.turn.ended', sender: { id: 'steward' }, payload: { status: 'failed' } },
      turnEnded('c', 'steward', { model: '', effort: '' }),
    ]);
    expect(latestAgentUsage(state, 'steward')).toMatchObject({ model: 'm1', effort: 'low' });
  });

  it('agent.context 终态同样是可信来源', () => {
    const state = stateOf([
      { id: 'a', kind: 'response', type: 'agent.context', sender: { id: 'steward' }, payload: { status: 'completed', model: 'm3', effort: 'medium', context_tokens: 5, context_window: 100 } },
    ]);
    expect(latestAgentUsage(state, 'steward')).toMatchObject({ model: 'm3', effort: 'medium', contextWindow: 100 });
  });

  it('别的 agent 的 usage 恒不串值', () => {
    const state = stateOf([turnEnded('a', 'claude', { model: 'mx', effort: 'high' })]);
    expect(latestAgentUsage(state, 'steward')).toBeNull();
  });
});
