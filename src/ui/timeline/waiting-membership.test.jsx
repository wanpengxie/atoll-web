// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useWaitingEditingController } from './useWaitingEditingController.jsx';

const AGENT = 'agent:claude:1';
const frame = (seq, status) => ({ seq, envelope: { payload: { body: { status } } } });
const turn = (seq, provisional) => ({ kind: 'turn', turn: {
  requestId: `r${seq}`, requestSeq: seq, terminal: null, terminalSeq: 0, provisional,
  request: { id: `r${seq}`, type: 'agent.ask', audience: [AGENT], sender: { id: 'human:root:1' }, ts: seq },
} });
const send = (id) => ({
  messageId: id, channelId: 'c0', state: 'transmitting', createdAt: 1,
  frame: { msg_type: 'agent.ask', audience: [AGENT], payload: { text: id } },
});
const setup = (state, pending) => renderHook(() => useWaitingEditingController({
  state, pending, awaiting: [], capabilityIndex: new Map(),
  onRequestCapability: vi.fn(), onTaskControl: vi.fn(), onComposerEditChange: vi.fn(),
}));

describe('waiting membership', () => {
  it('puts a new send behind a busy receiver in Waiting', () => {
    const state = { channelId: 'c0', timeline: [turn(10, [frame(11, 'processing')])] };
    const { result } = setup(state, [send('mine')]);
    expect(result.current.queuedTurns.map((row) => row.requestId)).toEqual(['mine']);
    expect(result.current.timelinePlaced.has('mine')).toBe(false);
  });

  it('puts a new send to an idle receiver straight into the timeline', () => {
    const state = { channelId: 'c0', timeline: [] };
    const { result } = setup(state, [send('mine')]);
    expect(result.current.queuedTurns).toEqual([]);
    expect(result.current.timelinePlaced.has('mine')).toBe(true);
    expect(result.current.timelineLocalEchoes.map((row) => row.messageId)).toEqual(['mine']);
  });

  it('never shows a queued request whose receiver restarted after it', () => {
    const restart = { kind: 'turn', turn: {
      requestId: 'restart', requestSeq: 20, terminalSeq: 21, provisional: [],
      request: { id: 'restart', type: 'system.member.restart', payload: { body: { member: AGENT } } },
      terminal: { payload: { body: { status: 'completed', member: AGENT } } },
    } };
    const state = { channelId: 'c0', timeline: [turn(10, [frame(11, 'queued')]), restart] };
    const { result } = setup(state, []);
    expect(result.current.queuedTurns).toEqual([]);
  });

  it('shows a queued request from history in ledger order', () => {
    const state = { channelId: 'c0', timeline: [turn(12, [frame(13, 'queued')]), turn(10, [frame(11, 'queued')])] };
    const { result } = setup(state, []);
    expect(result.current.queuedTurns.map((row) => row.requestId)).toEqual(['r10', 'r12']);
  });
});
