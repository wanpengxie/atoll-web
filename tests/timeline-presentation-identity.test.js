import { describe, expect, it } from 'vitest';
import { presentationEntryId } from '../src/model/timeline-projection.js';
import { createPresentationProjector, presentationRow } from '../src/model/conversation-presentation.js';

describe('timeline presentation identity', () => {
  it('does not depend on array position, filtering, or prepend', () => {
    const turn = { kind: 'turn', seq: 20, turn: { requestId: 'request-20', request: { id: 'wire-20' } } };
    const message = { kind: 'standalone', seq: 21, envelope: { id: 'message-21' } };
    const before = [turn, message].map(presentationEntryId);
    const after = [{ kind: 'standalone', seq: 1, envelope: { id: 'older-1' } }, turn, message]
      .filter((entry) => entry.seq !== 1)
      .map(presentationEntryId);
    expect(after).toEqual(before);
  });

  it('exposes revision, stability, range, actor, and height class as an explicit contract', () => {
    const entry = {
      kind: 'turn',
      seq: 20,
      turn: {
        requestId: 'request-20',
        requestSeq: 20,
        lastSeq: 24,
        request: { id: 'wire-20', audience: ['agent-a'], body: { text: 'hello' } },
        terminal: null,
      },
      thread: [],
    };
    const row = presentationRow(entry);
    expect(row).toMatchObject({ id: 'request-20', seqLow: 20, seqHigh: 24, actorID: 'agent-a', contentRevision: 24, layoutClass: 'reserved', settled: false });
    entry.turn.lastSeq = 25;
    entry.turn.terminalSeq = 25;
    entry.turn.terminal = { sender: { id: 'agent-a' } };
    expect(row).toMatchObject({ seqHigh: 25, contentRevision: 25, layoutClass: 'normal', settled: true });
  });

  it('reuses unchanged semantic rows across append and replaces only changed revisions', () => {
    const projector = createPresentationProjector();
    const first = {
      kind: 'turn', seq: 1, thread: [],
      turn: { requestId: 'turn-1', requestSeq: 1, lastSeq: 2, request: { id: 'turn-1', audience: ['agent-a'] }, terminalSeq: 2, terminal: { id: 'done-1' } },
    };
    const second = { kind: 'standalone', seq: 3, envelope: { id: 'message-3', sender: { id: 'agent-a' } } };
    const initial = projector.project([first]);
    const appended = projector.project([first, second]);
    expect(appended[0]).toBe(initial[0]);

    first.turn.lastSeq = 4;
    first.turn.terminalSeq = 4;
    first.turn.terminal = { id: 'done-1-revised' };
    const revised = projector.project([first, second]);
    expect(revised[0]).not.toBe(appended[0]);
    expect(revised[1]).toBe(appended[1]);
    expect(revised[0].contentRevision).toBe(4);
  });
});
