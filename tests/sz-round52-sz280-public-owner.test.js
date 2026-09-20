import { describe, expect, it } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { selectFeatureWaitingFacts } from '../src/model/feature-tasks.js';

const CHANNEL = 'c0';
const SELF = 'human:root:1';
const AGENT = 'agent:worker:1';

function row(seq, envelope) {
  return { channel_id: CHANNEL, seq, envelope };
}

function request(seq = 1) {
  return row(seq, {
    id: 'work',
    kind: 'request',
    type: 'agent.ask',
    sender: { id: SELF, kind: 'human' },
    audience: [AGENT],
    visibility: 'public',
    payload: { body: { text: 'work' } },
  });
}

function queued(seq = 2) {
  return row(seq, {
    id: 'work-queued',
    parent_id: 'work',
    kind: 'response',
    type: 'agent.ask',
    sender: { id: AGENT, kind: 'agent' },
    audience: [SELF],
    visibility: 'public',
    payload: { body: { status: 'queued' } },
  });
}

function terminal(seq = 3) {
  return row(seq, {
    id: 'work-final',
    parent_id: 'work',
    kind: 'response',
    type: 'agent.ask',
    sender: { id: AGENT, kind: 'agent' },
    audience: [SELF],
    visibility: 'public',
    payload: { body: { status: 'completed', text: 'done' } },
  });
}

function note(seq) {
  return row(seq, {
    id: `note-${seq}`,
    kind: 'event',
    type: 'human.note',
    sender: { id: SELF, kind: 'human' },
    visibility: 'public',
    payload: { body: { text: String(seq) } },
  });
}

function publicTurn(replica) {
  return replica.state(CHANNEL).timeline
    .find((entry) => entry.turn?.requestId === 'work')?.turn;
}

function waiting(replica) {
  return selectFeatureWaitingFacts({
    state: replica.state(CHANNEL),
    channelId: CHANNEL,
    targetAuthority: { current: true, actorIDs: new Set([AGENT]) },
  });
}

describe('SZ-280 current Replica/Waiting public owner', () => {
  it('keeps a matched live terminal closed after trim and older history release', () => {
    const replica = createChannelReplicaStore();

    // The live lane has the complete turn before the bounded window is
    // pressured. This is the matched-live interleaving from SZ-280, not the
    // terminal-first replay interleaving already covered by SZ-281.
    expect(replica.commit(request(1), SELF, undefined, { source: 'live' }).accepted).toBe(true);
    expect(replica.commit(queued(2), SELF, undefined, { source: 'live' }).accepted).toBe(true);
    expect(replica.commit(terminal(3), SELF, undefined, { source: 'live' }).accepted).toBe(true);
    for (let seq = 4; seq <= 10; seq += 1) {
      expect(replica.commit(note(seq), SELF, undefined, { source: 'live' }).accepted).toBe(true);
    }

    expect(replica.trim(CHANNEL, 4)).toBeGreaterThan(0);
    // The compact lifecycle proof is not itself a UI row. Until the older
    // request page returns, the public snapshot has no turn for this root;
    // importantly, the Waiting projection stays empty rather than inventing
    // an open action from the evicted rows.
    expect(publicTurn(replica)).toBeUndefined();
    expect(waiting(replica)).toEqual([]);

    // The older history page is admitted after the live turn was compacted.
    // Its request/queued rows must enrich the public snapshot, not resurrect
    // a Waiting action after the terminal has already closed the turn.
    expect(replica.commit(request(1), SELF, undefined, { source: 'history' }).accepted).toBe(true);
    expect(replica.commit(queued(2), SELF, undefined, { source: 'history' }).accepted).toBe(true);
    expect(publicTurn(replica)).toMatchObject({
      requestId: 'work',
      status: 'completed',
      terminalClosureOnly: true,
    });
    expect(waiting(replica)).toEqual([]);
  });
});
