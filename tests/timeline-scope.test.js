import { describe, expect, it } from 'vitest';
import { apply, createChannelState, fold, orderedTimeline } from '../src/model/fold.js';
import { relatedEnvelopeIds, relatedEnvelopeIdsIncremental, scopeEntries, TIMELINE_SCOPE } from '../src/model/timeline-scope.js';
import { projectTimeline } from '../src/model/timeline-projection.js';

const base = {
  ts: 1,
  channel_id: 'c0',
  visibility: 'public',
  audience: ['agent'],
  sender: { kind: 'human', id: 'me' },
  payload: {},
};

function env(id, kind, type, extra = {}) {
  const envelope = { ...base, id, kind, type, ...extra };
  return { ...envelope, payload: { body: envelope.payload || {} } };
}

// One channel, two conversations that share nothing: mine with the agent, and
// another person's with the same agent.
function channel() {
  const rows = [
    // Mine: I ask, the agent works, the agent answers.
    env('req-mine', 'request', 'agent.ask', { payload: { text: 'ping' }, correlation_id: 'turn-mine' }),
    env('prov-mine', 'response', 'agent.ask', { parent_id: 'req-mine', payload: { status: 'processing' }, sender: { kind: 'agent', id: 'agent' } }),
    env('act-mine', 'response', 'agent.ask', { parent_id: 'req-mine', correlation_id: 'turn-mine', payload: { status: 'processing', process: { kind: 'tool', phase: 'started', tool_call_id: 'shell-1', tool: 'shell' } }, sender: { kind: 'agent', id: 'agent' } }),
    env('done-mine', 'response', 'agent.ask', { parent_id: 'req-mine', payload: { status: 'completed', text: 'PONG' }, sender: { kind: 'agent', id: 'agent' } }),

    // Somebody else's, in the same channel: I am neither sender nor audience anywhere.
    env('req-other', 'request', 'agent.ask', { payload: { text: 'theirs' }, correlation_id: 'turn-other', sender: { kind: 'human', id: 'someone' } }),
    env('prov-other', 'response', 'agent.ask', { parent_id: 'req-other', payload: { status: 'processing' }, sender: { kind: 'agent', id: 'agent' }, audience: ['someone'] }),
    env('done-other', 'response', 'agent.ask', { parent_id: 'req-other', payload: { status: 'completed', text: 'THEIRS' }, sender: { kind: 'agent', id: 'agent' }, audience: ['someone'] }),

    // Addressed to me by somebody else. Being the audience counts as much as being
    // the sender — a question I was asked is mine to see.
    env('ask-me', 'request', 'human.ask', { audience: ['me'], sender: { kind: 'agent', id: 'agent' }, payload: { text: 'confirm?' } }),
  ].map((envelope, index) => ({ channel_id: 'c0', seq: index + 1, envelope }));
  return fold(rows, 'me');
}

describe('timeline scope', () => {
  it('reaches the whole exchange from the one message I sent', () => {
    const visible = relatedEnvelopeIds(channel(), 'me');
    // Layer one: the request I sent, and the question addressed to me.
    expect(visible.has('req-mine')).toBe(true);
    expect(visible.has('ask-me')).toBe(true);
    // Layer two: what the agent said back, by parent…
    expect(visible.has('prov-mine')).toBe(true);
    expect(visible.has('done-mine')).toBe(true);
    // …and what it did while working, which belongs to the same request turn.
    // Without that half, the scope would keep the question and drop
    // the work, which reads as an agent that never started.
    expect(visible.has('act-mine')).toBe(true);
  });

  it('leaves an exchange that is not mine out', () => {
    const visible = relatedEnvelopeIds(channel(), 'me');
    for (const id of ['req-other', 'prov-other', 'done-other']) {
      expect(visible.has(id)).toBe(false);
    }
  });

  it('keeps a whole conversation when any part of it is mine, and drops the ones that are not', () => {
    const state = channel();
    const entries = orderedTimeline(state);
    const mine = scopeEntries(entries, { scope: TIMELINE_SCOPE.mine, state, selfId: 'me' });
    const ids = mine.map((entry) => entry.turn?.requestId || entry.envelope?.id);
    expect(ids).toContain('req-mine');
    expect(ids).toContain('ask-me');
    expect(ids).not.toContain('req-other');
    // Half a conversation is harder to read than none: the answer must come with
    // the question it answers.
    const turn = mine.find((entry) => entry.turn?.requestId === 'req-mine');
    expect(turn.turn.terminal?.id).toBe('done-mine');
  });

  it('changes nothing under the全部 scope, and nothing when there is no self to scope by', () => {
    const state = channel();
    const entries = orderedTimeline(state);
    expect(scopeEntries(entries, { scope: TIMELINE_SCOPE.all, state, selfId: 'me' })).toBe(entries);
    // An unknown self must not silently empty the channel — showing everything is
    // the honest answer to "related to whom?".
    expect(scopeEntries(entries, { scope: TIMELINE_SCOPE.mine, state, selfId: '' })).toBe(entries);
  });

  it('增量索引在基线后只消费新行，不再每帧遍历 rows Map', () => {
    const state = createChannelState('c0');
    apply(state, { channel_id: 'c0', seq: 1, envelope: env('first', 'event', 'human.note') }, 'me');
    expect(relatedEnvelopeIdsIncremental(state, 'me').has('first')).toBe(true);
    const iterate = state.rows[Symbol.iterator].bind(state.rows);
    state.rows[Symbol.iterator] = () => { throw new Error('rows Map should not be rescanned'); };
    apply(state, { channel_id: 'c0', seq: 2, envelope: env('second', 'event', 'human.note') }, 'me');
    expect(relatedEnvelopeIdsIncremental(state, 'me').has('second')).toBe(true);
    state.rows[Symbol.iterator] = iterate;
  });

  it('keeps the exact edit replacement candidate out until reciprocal handoff', () => {
    const state = createChannelState('c0');
    apply(state, { channel_id: 'c0', seq: 1, envelope: env('old', 'request', 'agent.ask', { payload: { text: 'old' } }) });
    apply(state, { channel_id: 'c0', seq: 2, envelope: env('old-p', 'response', 'agent.ask', {
      parent_id: 'old', sender: { kind: 'agent', id: 'agent' }, payload: { status: 'processing' },
    }) });
    apply(state, { channel_id: 'c0', seq: 3, envelope: env('replacement', 'request', 'agent.replace', {
      payload: { target: 'old', old_text: 'old', new_text: 'new' },
    }) });
    apply(state, { channel_id: 'c0', seq: 4, envelope: env('replacement-p', 'response', 'agent.replace', {
      parent_id: 'replacement', sender: { kind: 'agent', id: 'agent' }, payload: { status: 'processing' },
    }) });

    const unrestricted = projectTimeline(state, { scope: TIMELINE_SCOPE.all, editingTargetId: 'old' });
    const pending = projectTimeline(state, {
      scope: TIMELINE_SCOPE.all,
      editingTargetId: 'old',
      editingReplacementId: 'replacement',
    });
    expect(unrestricted.items.map((entry) => entry.turn?.requestId)).toEqual(['old', 'replacement']);
    expect(pending.items.map((entry) => entry.turn?.requestId)).toEqual(['old']);
  });
});

describe('自己动手的操作恒不进「@我」', () => {
  const selfId = 'human:root:1';
  const cmd = (id) => ({ id, type: 'terminal.command', kind: 'event', sender: { id: selfId, kind: 'human' }, payload: { cmd: 'make test', exit_code: 0 } });
  const session = (id, event = 'opened') => ({ id, type: 'terminal.session', kind: 'event', sender: { id: selfId, kind: 'human' }, payload: { session_id: 'session-1', event, exit_code: 0 } });

  it('终端命令在「@我」下不出现——我在终端里已经全程看着了', () => {
    const state = { rows: new Map([['t1', cmd('t1')]]) };
    const entries = [{ kind: 'message', envelope: cmd('t1') }];
    const got = scopeEntries(entries, { scope: TIMELINE_SCOPE.mine, state, selfId });
    expect(got).toEqual([]);
  });

  it('终端会话开关在「@我」下同样不出现', () => {
    const opened = session('s1');
    const closed = session('s2', 'closed');
    const state = { rows: new Map([['s1', opened], ['s2', closed]]) };
    const entries = [
      { kind: 'message', envelope: opened },
      { kind: 'message', envelope: closed },
    ];
    expect(scopeEntries(entries, { scope: TIMELINE_SCOPE.mine, state, selfId })).toEqual([]);
  });

  it('但在「全部」下照常可见——账本恒是完整的', () => {
    const state = { rows: new Map([['t1', cmd('t1')]]) };
    const entries = [{ kind: 'message', envelope: cmd('t1') }];
    const got = scopeEntries(entries, { scope: TIMELINE_SCOPE.all, state, selfId });
    expect(got.length).toBe(1);
  });

  it('恒不因为它而把整段对话捞进来', () => {
    // 一条终端记录若被当作「我的」种子，它的 correlation 会把无关的往来拖进来。
    const other = { id: 'x1', type: 'agent.ask', kind: 'request', sender: { id: 'agent:a:1' }, audience: ['agent:b:1'], correlation_id: 'corr-1' };
    const mine = { ...cmd('t1'), correlation_id: 'corr-1' };
    const state = { rows: new Map([['t1', mine], ['x1', other]]) };
    const entries = [{ kind: 'message', envelope: other }];
    const got = scopeEntries(entries, { scope: TIMELINE_SCOPE.mine, state, selfId });
    expect(got).toEqual([]);
  });
});

describe('canonical timer 进入「@我」，普通 agent self-audience 不进入', () => {
  const selfId = 'human:root:1';
  const agent = { id: 'agent:codex:1', kind: 'agent' };
  // 闹钟到点：触发事件 → 自己给自己的 agent.timer.wake → 进展 → 它由此发出的子请求。
  // 每一条的 sender 和 audience 都是同一个 agent，没有一条跟人有关。
  const fire = { id: 'timer:t1', kind: 'event', type: 'agent.resume', sender: agent, audience: [agent.id], correlation_id: 'timer:t1', payload: { task: 'resume deployment' } };
  const wake = { id: 'wake-1', kind: 'request', type: 'agent.timer.wake', parent_id: 'timer:t1', correlation_id: 'timer:t1', sender: agent, audience: [agent.id], payload: { body: { text: '闹钟到点了' } } };
  const progress = { id: 'wake-1-p', kind: 'response', type: 'agent.timer.wake', parent_id: 'wake-1', correlation_id: 'timer:t1', sender: agent, audience: [agent.id], payload: { status: 'processing' } };
  const child = { id: 'child-1', kind: 'request', type: 'agent.ask', correlation_id: 'timer:t1', sender: agent, audience: ['peer:other:1'], payload: { body: { text: 'ping' } } };
  const rows = new Map([['timer:t1', fire], ['wake-1', wake], ['wake-1-p', progress], ['child-1', child]]);

  it('真实 timer fire、唤醒请求、进展和子请求都在', () => {
    const visible = relatedEnvelopeIds({ rows }, selfId);
    for (const id of ['timer:t1', 'wake-1', 'wake-1-p', 'child-1']) expect(visible.has(id)).toBe(true);
  });

  it('peer 分页里的普通 self-audience 请求仍不算 timer', () => {
    const query = { id: 'peer-query', kind: 'request', type: 'agent.ask', sender: agent, audience: [agent.id], correlation_id: 'peer-query', payload: {} };
    const visible = relatedEnvelopeIds({ rows: new Map([['peer-query', query]]) }, selfId);
    expect(visible.has('peer-query')).toBe(false);
  });

  it('只有 timer 前缀不够，普通 self event 不获得归属', () => {
    const lookalike = { id: 'timer:lookalike', kind: 'event', type: 'agent.resume', sender: agent, audience: [agent.id], correlation_id: 'different-root', payload: {} };
    const visible = relatedEnvelopeIds({ rows: new Map([['timer:lookalike', lookalike]]) }, selfId);
    expect(visible.has('timer:lookalike')).toBe(false);
  });

  it('一旦同 correlation 有 human 边，自委托仍由二层闭包保留', () => {
    const humanRoot = { id: 'human-root', kind: 'request', type: 'agent.ask', sender: { id: selfId, kind: 'human' }, audience: [agent.id], correlation_id: 'human-root', payload: {} };
    const delegated = { id: 'delegated', kind: 'request', type: 'agent.ask', sender: agent, audience: [agent.id], parent_id: 'human-root', correlation_id: 'human-root', payload: {} };
    const visible = relatedEnvelopeIds({ rows: new Map([['human-root', humanRoot], ['delegated', delegated]]) }, selfId);
    expect([...visible].sort()).toEqual(['delegated', 'human-root']);
  });

  it('普通 self-audience 请求仍在「全部」账本可见', () => {
    const query = { id: 'peer-query', kind: 'request', type: 'agent.ask', sender: agent, audience: [agent.id], correlation_id: 'peer-query', payload: {} };
    const entries = [{ kind: 'message', envelope: query }];
    expect(scopeEntries(entries, { scope: TIMELINE_SCOPE.all, state: { rows }, selfId })).toEqual(entries);
  });

  it('人给自己发的不算委托——那条线走的是"我发/我收"，不受这条规则影响', () => {
    const note = { id: 'n1', kind: 'event', type: 'note', sender: { id: 'human:other:1', kind: 'human' }, audience: ['human:other:1'], payload: {} };
    const visible = relatedEnvelopeIds({ rows: new Map([['n1', note]]) }, selfId);
    expect(visible.has('n1')).toBe(false);
  });
});
