import { describe, expect, it } from 'vitest';
import { agentSelectionView, latestAgentUsage, latestInteractedAgentId, resolveParameterAgent } from '../src/model/agent-selection.js';

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

describe('当前值恒只认本连接证据（§4.1）', () => {
  const terminal = (id, sender, usage) => ({ id, kind: 'response', type: 'agent.ask', parent_id: `${id}-request`, sender: { id: sender }, payload: { status: 'completed', usage } });
  const contextDone = (id, parentId, flat = {}) => ({ id, kind: 'response', type: 'agent.context', parent_id: parentId, sender: { id: 'steward' }, payload: { status: 'completed', ...flat } });

  it('账本历史 usage 是旧生命期读数，无本连接探测恒返回 null', () => {
    const state = stateOf([
      terminal('a', 'steward', { model: 'm1', effort: 'low', context_tokens: 10 }),
      terminal('b', 'steward', { model: 'm2', effort: 'high', context_tokens: 20 }),
    ]);
    expect(latestAgentUsage(state, 'steward')).toBeNull();
    expect(latestAgentUsage(state, 'steward', 'probe-never-sent')).toBeNull();
  });

  it('本连接 context 探测响应是当前值的起点', () => {
    const state = stateOf([
      terminal('old', 'steward', { model: 'stale', effort: 'stale' }),
      contextDone('a', 'probe-1', { model: 'm3', effort: 'medium', context_tokens: 5, context_window: 100 }),
    ]);
    expect(latestAgentUsage(state, 'steward', 'probe-1')).toMatchObject({ model: 'm3', effort: 'medium', contextWindow: 100 });
  });

  it('探测之后新完成的 terminal 逐步覆盖；缺字段的帧跳过不清空显示', () => {
    const state = stateOf([
      terminal('old', 'steward', { model: 'stale', effort: 'stale' }),
      contextDone('a', 'probe-1', { model: 'm3', effort: 'medium' }),
      terminal('b', 'steward', { model: 'm4', effort: 'high', context_tokens: 20 }),
      { id: 'c', kind: 'response', type: 'agent.ask', sender: { id: 'steward' }, payload: { status: 'failed' } },
      terminal('d', 'steward', { model: '', effort: '' }),
    ]);
    expect(latestAgentUsage(state, 'steward', 'probe-1')).toMatchObject({ model: 'm4', effort: 'high', contextTokens: 20 });
  });

  it('探测响应值为空（未配 config）时探测仍算起点，其后 turn usage 可信', () => {
    const state = stateOf([
      contextDone('a', 'probe-1', { model: '', effort: '' }),
      terminal('b', 'steward', { model: 'm5', effort: 'low' }),
    ]);
    expect(latestAgentUsage(state, 'steward', 'probe-1')).toMatchObject({ model: 'm5', effort: 'low' });
  });

  it('provider 只报告 model、没有 effort 时仍保留当前配置', () => {
    const state = stateOf([
      contextDone('a', 'probe-1', { model: 'claude-opus-5', effort: '' }),
    ]);
    const usage = latestAgentUsage(state, 'claude', 'probe-1');
    expect(usage).toMatchObject({ model: 'claude-opus-5', effort: '' });
    expect(agentSelectionView({ actorId: 'claude', describe: { words: { 'agent.select': { description: 'standard' } } }, usage }))
      .toMatchObject({ actorId: 'claude', current: { model: 'claude-opus-5', effort: '' }, configurable: false });
  });

  it('别的 agent 的 usage 恒不串值', () => {
    const state = stateOf([
      contextDone('a', 'probe-1', { model: 'm3', effort: 'medium' }),
      terminal('b', 'claude', { model: 'mx', effort: 'high' }),
    ]);
    expect(latestAgentUsage(state, 'steward', 'probe-1')).toMatchObject({ model: 'm3', effort: 'medium' });
  });
});
