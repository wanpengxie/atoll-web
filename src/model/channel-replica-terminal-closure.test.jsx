// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from './channel-replica.js';
import { useWaitingEditingController } from '../ui/timeline/useWaitingEditingController.jsx';

// Successor coverage for the deleted tests/waiting-terminal-finality.test.js.
// Replica retains one exact parent-id compact closure when trim evicts the
// rows that prove a turn reached a terminal state. Full envelopes remain in
// `state.rows`; the closure is lifecycle provenance only. These tests keep the
// contract strict across stale local echoes, terminal/request trim asymmetry,
// response-first history, and high-cardinality closure retention.
const CHANNEL = 'c0';
const SELF = 'human:root:1';
const AGENT = { id: 'agent:worker:1', kind: 'agent' };

function request(seq, id) {
  return { channel_id: CHANNEL, seq, envelope: {
    id, kind: 'request', type: 'agent.ask', sender: { id: SELF, kind: 'human' },
    audience: [AGENT.id], visibility: 'public', payload: { body: { text: id } },
  } };
}
function queued(seq, id) {
  return { channel_id: CHANNEL, seq, envelope: {
    id: `${id}-queued`, parent_id: id, kind: 'response', type: 'agent.ask', sender: AGENT,
    audience: [SELF], visibility: 'public', payload: { body: { status: 'queued' } },
  } };
}
function terminal(seq, id, status = 'completed') {
  return { channel_id: CHANNEL, seq, envelope: {
    id: `${id}-final`, parent_id: id, kind: 'response', type: 'agent.ask', sender: AGENT,
    audience: [SELF], visibility: 'public', payload: { body: { status, text: 'done' } },
  } };
}
function note(seq) {
  return { channel_id: CHANNEL, seq, envelope: {
    id: `note-${seq}`, kind: 'event', type: 'human.note', sender: { id: SELF, kind: 'human' },
    visibility: 'public', payload: { body: { text: String(seq) } },
  } };
}

function completedThenTrimmed(replica, { maxRows = 40 } = {}) {
  replica.commit(request(1, 'work'));
  replica.commit(queued(2, 'work'));
  replica.commit(terminal(3, 'work'));
  for (let seq = 4; seq <= maxRows + 10; seq += 1) replica.commit(note(seq));
  const removed = replica.trim(CHANNEL, maxRows);
  return { state: replica.state(CHANNEL), removed };
}

describe('channel-replica compact terminal closure (successor of waiting-terminal-finality.test.js)', () => {
  it('R1: a trimmed-out completed turn must never be resurrected into Waiting by a local echo', () => {
    const replica = createChannelReplicaStore();
    const { state, removed } = completedThenTrimmed(replica);
    expect(removed).toBeGreaterThan(0);
    expect(state.timeline.some((entry) => entry.turn?.requestId === 'work')).toBe(false);

    // A stale local submission tracking entry for the same id (e.g. left over
    // from before this device learned the request had already completed).
    const pending = [{
      messageId: 'work', state: 'uncertain', text: 'work', createdAt: 1,
      frame: { kind: 'request', msg_type: 'agent.ask', audience: [AGENT.id], payload: { text: 'work' }, visibility: 'public' },
    }];
    const { result } = renderHook(() => useWaitingEditingController({
      state, pending, capabilityIndex: { get: () => undefined }, onRequestCapability: vi.fn(),
      onTaskControl: vi.fn(), onComposerEditChange: vi.fn(),
    }));
    // The compact closure repopulates the Replica dedup index without
    // manufacturing a second timeline row, so the stale echo is suppressed.
    expect(result.current.queuedTurns.map((turn) => turn.requestId)).toEqual([]);
  });

  it('R3 (first half): a terminal that survives trim while its request does not must still prove the turn is terminal', () => {
    const replica = createChannelReplicaStore();
    replica.commit(request(1, 'work'));
    replica.commit(queued(2, 'work'));
    for (let seq = 3; seq <= 99; seq += 1) replica.commit(note(seq));
    replica.commit(terminal(100, 'work'));
    const removed = replica.trim(CHANNEL, 40);
    expect(removed).toBeGreaterThan(0);
    expect(replica.state(CHANNEL).rows.has(1)).toBe(false);

    // Old fold.js: the turn survives with its terminal known, purely from the
    // still-windowed terminal row, even though the request row is gone.
    const turn = replica.state(CHANNEL).timeline.find((entry) => entry.turn?.requestId === 'work')?.turn;
    expect(turn?.terminal).toBeTruthy();
  });

  it('response-first terminal closure crosses trim and upgrades when the exact full row returns', () => {
    const replica = createChannelReplicaStore();
    // The terminal arrives in a history suffix before its request. Trimming
    // removes the full response, so only the exact parent closure may bridge
    // the gap; a guessed request must never be synthesized from the seq range.
    replica.commit(terminal(2, 'response-first-terminal'));
    for (let seq = 3; seq <= 10; seq += 1) replica.commit(note(seq));
    expect(replica.trim(CHANNEL, 4)).toBeGreaterThan(0);
    expect(replica.state(CHANNEL).rows.has(2)).toBe(false);
    expect(replica.state(CHANNEL)._unmatchedTerminalClosures.has('response-first-terminal')).toBe(true);
    expect(replica.state(CHANNEL)._envelopesById.has('response-first-terminal')).toBe(true);
    expect(replica.state(CHANNEL).timeline.some((entry) => entry.turn?.requestId === 'response-first-terminal'))
      .toBe(false);

    replica.commit(request(1, 'response-first-terminal'));
    let turn = replica.state(CHANNEL).timeline
      .find((entry) => entry.turn?.requestId === 'response-first-terminal')?.turn;
    expect(turn).toMatchObject({ terminalClosureOnly: true, status: 'completed' });

    // A later conflicting full terminal cannot override the earlier compact
    // fact, even before the original row is reread.
    const conflict = terminal(11, 'response-first-terminal', 'failed');
    conflict.envelope.id = 'response-first-terminal-conflict';
    replica.commit(conflict);
    turn = replica.state(CHANNEL).timeline
      .find((entry) => entry.turn?.requestId === 'response-first-terminal')?.turn;
    expect(turn).toMatchObject({ terminalClosureOnly: true, status: 'completed' });

    // Re-reading the exact terminal row upgrades lifecycle provenance to the
    // full immutable result and consumes the closure without a second store.
    replica.commit(terminal(2, 'response-first-terminal'));
    turn = replica.state(CHANNEL).timeline
      .find((entry) => entry.turn?.requestId === 'response-first-terminal')?.turn;
    expect(turn).toMatchObject({ terminalClosureOnly: false, status: 'completed' });
    expect(turn.terminal.payload.body.text).toBe('done');
    expect(replica.state(CHANNEL)._unmatchedTerminalClosures.has('response-first-terminal')).toBe(false);
  });

  it('超过 512 条时仍保留每个 request id 的精确终态证明（重装 request+queued 后仍闭合）', () => {
    // The compact closure is per exact request id. Re-admitting only the old
    // request and queued row must not reopen Waiting when the full terminal
    // row was evicted long ago.
    const replica = createChannelReplicaStore();
    let seq = 1;
    const ids = [];
    for (let index = 0; index < 700; index += 1) {
      const id = `work-${index}`;
      ids.push({ id, requestSeq: seq });
      replica.commit(request(seq++, id));
      replica.commit(queued(seq++, id));
      replica.commit(terminal(seq++, id));
      replica.trim(CHANNEL, 30);
    }
    const state = replica.state(CHANNEL);
    const evicted = ids.filter((item) => !state.timeline.some((entry) => entry.turn?.requestId === item.id));
    expect(evicted.length).toBeGreaterThan(512);
    const oldest = evicted[0];
    replica.commit(request(oldest.requestSeq, oldest.id));
    replica.commit(queued(oldest.requestSeq + 1, oldest.id));
    // The terminal body was evicted long ago and never comes back; lifecycle
    // closure still remains available, explicitly marked closure-only.
    const turn = replica.state(CHANNEL).timeline.find((entry) => entry.turn?.requestId === oldest.id)?.turn;
    expect(turn?.terminal).toBeTruthy();
    expect(turn?.terminalClosureOnly).toBe(true);
  });

  it('an open (non-terminal, still-running) turn must never be evicted by trim pressure', () => {
    // The open floor pins the request and all its response ancestry even when
    // enough unrelated tail traffic would otherwise cross the row limit.
    const replica = createChannelReplicaStore();
    replica.commit(request(1, 'open-work'));
    replica.commit(queued(2, 'open-work'));
    for (let seq = 3; seq <= 60; seq += 1) replica.commit(note(seq));
    replica.trim(CHANNEL, 40);
    const state = replica.state(CHANNEL);
    expect(state.timeline.some((entry) => entry.turn?.requestId === 'open-work')).toBe(true);
  });
});
