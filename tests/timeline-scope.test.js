import { describe, expect, it } from 'vitest';
import { fold, orderedTimeline } from '../src/model/fold.js';
import { relatedEnvelopeIds, scopeEntries, TIMELINE_SCOPE } from '../src/model/timeline-scope.js';

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

// One channel, two conversations that share nothing: mine with the agent, and
// another person's with the same agent.
function channel() {
  const rows = [
    // Mine: I ask, the agent works, the agent answers.
    env('req-mine', 'request', 'agent.ask', { payload: { text: 'ping' }, correlation_id: 'turn-mine' }),
    env('prov-mine', 'response', 'agent.ask', { parent_id: 'req-mine', payload: { status: 'processing' }, sender: { kind: 'agent', id: 'agent' } }),
    env('act-mine', 'event', 'agent.tool.started', { correlation_id: 'turn-mine', payload: { tool: 'shell', status: 'started' }, sender: { kind: 'agent', id: 'agent' } }),
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
    // …and what it did while working, which hangs off the correlation rather than
    // the request. Without that half, the scope would keep the question and drop
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
});
