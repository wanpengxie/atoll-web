import { describe, expect, it } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { selectFeatureWaitingFacts } from '../src/model/feature-tasks.js';

const CHANNEL = 'c0';
const SELF = 'human:root:1';
const AGENT = 'agent:worker:1';

function row(seq, envelope) {
  return { channel_id: CHANNEL, seq, envelope };
}

function terminal(seq = 3) {
  return row(seq, {
    id: 'work-final',
    kind: 'response',
    type: 'agent.ask',
    parent_id: 'work',
    sender: { id: AGENT, kind: 'agent' },
    audience: [SELF],
    visibility: 'public',
    payload: { body: { status: 'completed', text: 'done' } },
  });
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
    kind: 'response',
    type: 'agent.ask',
    parent_id: 'work',
    sender: { id: AGENT, kind: 'agent' },
    audience: [SELF],
    visibility: 'public',
    payload: { body: { status: 'queued' } },
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

describe('Waiting public owner replays a terminal-before-request page', () => {
  it('keeps a newer terminal closed when the older request page is released later', () => {
    const replica = createChannelReplicaStore();

    // The newer visible-gap page arrives first.  Additional rows then evict
    // the full terminal body while retaining its exact lifecycle closure.
    expect(replica.commit(terminal(3)).accepted).toBe(true);
    for (let seq = 4; seq <= 10; seq += 1) expect(replica.commit(note(seq)).accepted).toBe(true);
    expect(replica.trim(CHANNEL, 4)).toBeGreaterThan(0);
    expect(replica.state(CHANNEL)._unmatchedTerminalClosures.has('work')).toBe(true);

    // The older replay page arrives afterwards.  The current Replica owner
    // joins it with the exact closure; the Tasks/Waiting projection must not
    // resurrect a queued action from that older page.
    expect(replica.commit(request(1)).accepted).toBe(true);
    expect(replica.commit(queued(2)).accepted).toBe(true);
    const state = replica.state(CHANNEL);
    const turn = state.timeline.find((entry) => entry.turn?.requestId === 'work')?.turn;
    expect(turn).toMatchObject({ status: 'completed', terminalClosureOnly: true });
    expect(selectFeatureWaitingFacts({
      state,
      channelId: CHANNEL,
      targetAuthority: { current: true, actorIDs: new Set([AGENT]) },
    })).toEqual([]);
  });
});
