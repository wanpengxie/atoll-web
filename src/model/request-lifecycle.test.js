import { describe, expect, it } from 'vitest';
import { LIFECYCLE, lostReason, memberRestarts, requestLifecycle } from './request-lifecycle.js';

const AGENT = 'agent:claude:1';
const frame = (seq, status) => ({ seq, envelope: { payload: { body: { status } } } });
const ask = (seq, provisional = [], extra = {}) => ({
  requestId: `r${seq}`, requestSeq: seq, terminal: null, terminalSeq: 0, provisional,
  request: { id: `r${seq}`, type: 'agent.ask', audience: [AGENT] }, ...extra,
});
const restart = (seq, member = AGENT) => ({ kind: 'turn', turn: {
  requestId: `restart${seq}`, requestSeq: seq, terminalSeq: seq + 1, provisional: [],
  request: { id: `restart${seq}`, type: 'system.member.restart', payload: { body: { member } } },
  terminal: { payload: { body: { status: 'completed', member } } },
} });
const restartAll = (seq, restarted) => ({ kind: 'turn', turn: {
  requestId: `all${seq}`, requestSeq: seq, terminalSeq: seq + 1, provisional: [],
  request: { id: `all${seq}`, type: 'system.member.restart_all', payload: { body: {} } },
  terminal: { payload: { body: { status: 'completed', restarted } } },
} });

describe('request lifecycle from ledger rows', () => {
  it('reads waiting and processing from the latest core status', () => {
    expect(requestLifecycle(ask(10, [frame(11, 'queued')]))).toBe(LIFECYCLE.waiting);
    expect(requestLifecycle(ask(10, [frame(11, 'queued'), frame(12, 'processing')]))).toBe(LIFECYCLE.processing);
    expect(requestLifecycle(ask(10))).toBe(LIFECYCLE.pending);
    expect(requestLifecycle({ ...ask(10), terminal: { payload: { body: { status: 'completed' } } } })).toBe(LIFECYCLE.closed);
  });

  it('marks a queued or running request lost when its receiver restarted after its last frame', () => {
    const queued = ask(10, [frame(11, 'queued')]);
    const running = ask(12, [frame(13, 'processing')]);
    const state = { timeline: [{ kind: 'turn', turn: queued }, { kind: 'turn', turn: running }, restart(20)] };
    const restarts = memberRestarts(state);
    expect(requestLifecycle(queued, restarts)).toBe(LIFECYCLE.lost);
    expect(requestLifecycle(running, restarts)).toBe(LIFECYCLE.lost);
    expect(lostReason(running, restarts)).toBe('restart');
  });

  it('keeps a request that carries a frame after the restart', () => {
    const resumed = ask(10, [frame(11, 'queued'), frame(30, 'queued')]);
    const state = { timeline: [{ kind: 'turn', turn: resumed }, restart(20)] };
    expect(requestLifecycle(resumed, memberRestarts(state))).toBe(LIFECYCLE.waiting);
  });

  it('ignores a restart of a different member and a request sent after the restart', () => {
    const other = ask(10, [frame(11, 'queued')]);
    const later = ask(40, [frame(41, 'queued')]);
    const state = { timeline: [restart(20, 'agent:codex:1'), restart(30)] };
    const restarts = memberRestarts(state);
    expect(requestLifecycle(later, restarts)).toBe(LIFECYCLE.waiting);
    expect(requestLifecycle(other, new Map([['agent:codex:1', 21]]))).toBe(LIFECYCLE.waiting);
  });

  it('reads the restarted members of a channel-wide restart', () => {
    const queued = ask(10, [frame(11, 'queued')]);
    const state = { timeline: [restartAll(20, [AGENT, 'tool:x:1'])] };
    expect(requestLifecycle(queued, memberRestarts(state))).toBe(LIFECYCLE.lost);
  });

  it('treats an expired open request as lost', () => {
    const expired = ask(10, [frame(11, 'queued')]);
    expired.request.expires_at = 1_000;
    expect(requestLifecycle(expired, new Map(), 2_000)).toBe(LIFECYCLE.lost);
    expect(lostReason(expired, new Map(), 2_000)).toBe('expired');
  });
});
