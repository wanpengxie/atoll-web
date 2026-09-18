import { describe, expect, it } from 'vitest';
import { selectLocalWaitingTurns, selectWaitingPresentation } from '../src/model/waiting-presentation.js';

const SELF = 'human:me:1';
const AGENT = 'agent:worker:1';

function submission(id, { type = 'agent.ask', state = 'accepted' } = {}) {
  return {
    messageId: id,
    state,
    text: `text-${id}`,
    createdAt: 10,
    frame: {
      id,
      kind: 'request',
      msg_type: type,
      audience: [AGENT],
      payload: { text: `text-${id}` },
      visibility: 'public',
    },
  };
}

function canonicalTurn(id, status = '') {
  return {
    requestId: id,
    requestSeq: 20,
    lastSeq: status ? 21 : 20,
    request: {
      id,
      kind: 'request',
      type: 'agent.ask',
      sender: { id: SELF, kind: 'human' },
      audience: [AGENT],
      payload: { text: `text-${id}` },
    },
    provisional: status ? [{ seq: 21, envelope: { payload: { status, controls: [] } } }] : [],
    terminal: null,
  };
}

function stateWith(...turns) {
  return { turns: new Map(turns.map((turn) => [turn.requestId, turn])) };
}

describe('waiting presentation continuity', () => {
  it('assigns a durable local agent request to Waiting before ledger position arrives', () => {
    const turns = selectLocalWaitingTurns([
      submission('agent-local'),
      submission('human-local', { type: 'human.message' }),
      submission('rejected-agent', { state: 'rejected' }),
    ], SELF);

    expect(turns.map((turn) => turn.requestId)).toEqual(['agent-local']);
    expect(turns[0]).toMatchObject({
      local: true,
      waitingPresentation: 'confirming',
      request: { id: 'agent-local', type: 'agent.ask', sender: { id: SELF }, audience: [AGENT] },
    });
    expect(selectWaitingPresentation(stateWith(), { controlCurrent: false, localTurns: turns }))
      .toEqual(turns);
  });

  it('keeps newly accepted local requests after canonical queued positions', () => {
    const queued = canonicalTurn('canonical-first', 'queued');
    const local = selectLocalWaitingTurns([submission('local-last')], SELF);
    expect(selectWaitingPresentation(stateWith(queued), {
      controlCurrent: true,
      localTurns: local,
    }).map((turn) => turn.requestId)).toEqual(['canonical-first', 'local-last']);
  });

  it('keeps a canonical queued fact visible while target authority is resolved elsewhere', () => {
    const queued = canonicalTurn('departed-target', 'queued');
    expect(selectWaitingPresentation(stateWith(queued), { controlCurrent: true }))
      .toEqual([queued]);
  });

  it('keeps one stable id through local, landed-open, and canonical queued commits', () => {
    const local = selectLocalWaitingTurns([submission('same-id')], SELF);
    const open = canonicalTurn('same-id');
    const openState = stateWith(open);

    const landed = selectWaitingPresentation(openState, {
      controlCurrent: true,
      localTurns: local,
      continuityIDs: new Set(['same-id']),
    });
    expect(landed).toEqual([{ ...open, waitingPresentation: 'confirming' }]);

    const queued = canonicalTurn('same-id', 'queued');
    const canonical = selectWaitingPresentation(stateWith(queued), {
      controlCurrent: true,
      localTurns: local,
      continuityIDs: new Set(['same-id']),
    });
    expect(canonical).toEqual([queued]);
    expect(canonical.map((turn) => turn.requestId)).toEqual(['same-id']);
  });

  it('never guesses that an unrelated open request is queued', () => {
    const unrelated = canonicalTurn('remote-open');
    const state = stateWith(unrelated);
    expect(selectWaitingPresentation(state, { controlCurrent: true })).toEqual([]);
    expect(selectWaitingPresentation(state, {
      controlCurrent: true,
      continuityIDs: new Set(['different-id']),
    })).toEqual([]);
  });

  it('releases local continuity when the canonical request starts running', () => {
    const local = selectLocalWaitingTurns([submission('running-id')], SELF);
    const running = canonicalTurn('running-id', 'processing');
    expect(selectWaitingPresentation(stateWith(running), {
      controlCurrent: true,
      localTurns: local,
      continuityIDs: new Set(['running-id']),
    })).toEqual([]);
  });
});
