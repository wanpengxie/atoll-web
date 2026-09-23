// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';

const ME = 'human:root:1';
const OTHER = 'human:other:1';
const AGENT = 'agent:claude:1';
let serial = 0;

function runtimeFor() {
  const runtime = createChannelFeedRuntime({
    wireRef: { current: null },
    rosterRef: { current: { self: () => ME, observeFeed: () => '', handleEnvelope: () => {} } },
    accessRef: { current: { live: () => false } },
    activeChannelRef: { current: 'c0' },
    onRoster: vi.fn(), onError: vi.fn(), onChannelsDiscovered: vi.fn(), onDirectoryInvalidated: vi.fn(),
    onTimerFired: vi.fn(), onSubmissionFeed: vi.fn(), onAccessChanged: vi.fn(), onAgentActivity: vi.fn(),
  });
  runtime.mount();
  return runtime;
}

const ask = (seq, sender, audience, source = 'live') => ({
  channel_id: 'c0', seq, generation: 1, source,
  envelope: { id: `ask-${seq}`, kind: 'request', type: 'agent.ask', sender: { id: sender, kind: sender.split(':')[0] }, audience, payload: { body: { text: `ask ${seq}` } } },
});
const note = (seq, sender, audience) => ({
  channel_id: 'c0', seq, generation: 1, source: 'live',
  envelope: { id: `note-${seq}`, kind: 'request', type: 'human.message', sender: { id: sender, kind: 'human' }, audience, payload: { body: { text: `note ${seq}` } } },
});
const answer = (seq, parentSeq, audience = [ME]) => ({
  channel_id: 'c0', seq, generation: 1, source: 'live',
  envelope: { id: `answer-${seq}`, kind: 'response', type: 'agent.ask', parent_id: `ask-${parentSeq}`, sender: { id: AGENT, kind: 'agent' }, audience, payload: { body: { status: 'completed', text: 'done' } } },
});

async function attached(head = 10) {
  const runtime = runtimeFor();
  const principal = `read-position-${++serial}-${Date.now()}`;
  const boot = `boot-${serial}`;
  await runtime.getSnapshot().setHistoryGrants([{ channel_id: 'c0', head_seq: head, has_rows: true }], { generation: 1, boot, focus: 'c0' });
  await runtime.getSnapshot().prepareLocalReplica(principal, { focus: 'c0' });
  return { runtime, principal, boot, feed: () => runtime.getSnapshot() };
}

afterEach(() => localStorage.clear());

describe('new activity: one definition, one read position', () => {
  it('never counts history at or below the head a channel was first seen at', async () => {
    const { runtime, feed } = await attached(10);
    for (let seq = 5; seq <= 10; seq += 1) feed().enqueue(ask(seq, OTHER, [ME], 'history'));
    expect(feed().unreadFor('c0', ME)).toMatchObject({ count: 0 });
    runtime.destroy();
  });

  it('counts a message from someone else after the read position, never the reader\'s own', async () => {
    const { runtime, feed } = await attached(10);
    feed().enqueue(ask(11, ME, [AGENT]));
    expect(feed().unreadFor('c0', ME)).toMatchObject({ count: 0 });
    feed().enqueue(answer(12, 11));
    expect(feed().unreadFor('c0', ME)).toMatchObject({ count: 1 });
    expect([...feed().unreadRootsFor('c0', ME)]).toEqual(['ask-11']);
    runtime.destroy();
  });

  it('never counts another person\'s conversation, and clears the reader\'s from any view', async () => {
    const { runtime, feed } = await attached(10);
    feed().enqueue(note(11, OTHER, [ME]));
    feed().enqueue(note(12, OTHER, ['human:third:1']));
    expect(feed().unreadFor('c0', ME)).toMatchObject({ count: 1 });
    expect([...feed().unreadRootsFor('c0', ME)]).toEqual(['note-11']);
    expect(feed().markSeen('c0', 12)).toBe(true);
    expect(feed().unreadFor('c0', ME)).toMatchObject({ count: 0 });
    runtime.destroy();
  });

  // Work an agent starts on its own is part of the reader's conversation: it
  // is shown in the mine view, it is new activity, and reading clears it.
  // Two definitions let a row be shown yet never clear, so scrolling back up
  // brought it back as new (2026-09-24, c0.dev).
  it('counts what the mine view shows and clears it once read', async () => {
    const { runtime, feed } = await attached(10);
    const row = (seq, envelope) => ({ channel_id: 'c0', seq, generation: 1, source: 'live', envelope });
    feed().enqueue(row(11, { id: 'self-call', kind: 'request', type: 'system.log.recent', sender: { id: AGENT, kind: 'agent' }, audience: ['system'], payload: { body: { limit: 20 } } }));
    feed().enqueue(row(12, { id: 'self-call-done', kind: 'response', type: 'system.log.recent', parent_id: 'self-call', sender: { id: 'system:c0:1', kind: 'system' }, audience: [AGENT], payload: { body: { status: 'completed', text: 'twenty rows' } } }));
    feed().enqueue(row(13, { id: 'agent-ask', kind: 'request', type: 'agent.ask', sender: { id: AGENT, kind: 'agent' }, audience: ['agent:codex:1'], payload: { body: { text: 'count lines' } } }));
    feed().enqueue(row(14, { id: 'agent-ask-done', kind: 'response', type: 'agent.ask', parent_id: 'agent-ask', sender: { id: 'agent:codex:1', kind: 'agent' }, audience: [AGENT], payload: { body: { status: 'completed', text: '856 lines.' } } }));
    feed().enqueue(note(15, OTHER, ['human:third:1']));
    expect([...feed().unreadRootsFor('c0', ME)].sort()).toEqual(['agent-ask', 'self-call']);
    expect(feed().markSeen('c0', 15)).toBe(true);
    expect([...feed().unreadRootsFor('c0', ME)]).toEqual([]);
    expect(feed().unreadFor('c0', ME)).toMatchObject({ count: 0 });
    runtime.destroy();
  });

  it('only moves forward and never past the head', async () => {
    const { runtime, feed } = await attached(10);
    feed().enqueue(note(11, OTHER, [ME]));
    expect(feed().markSeen('c0', 99)).toBe(true);
    expect(feed().historyFor('c0')).toMatchObject({ readPosition: 11 });
    expect(feed().markSeen('c0', 5)).toBe(false);
    feed().enqueue(note(12, OTHER, [ME]));
    expect(feed().unreadFor('c0', ME)).toMatchObject({ count: 1 });
    runtime.destroy();
  });

  it('keeps the read position across a reload of the same world', async () => {
    const first = await attached(10);
    first.feed().enqueue(ask(11, OTHER, [ME]));
    first.feed().enqueue(ask(12, OTHER, [ME]));
    first.feed().markSeen('c0', 11);
    first.runtime.destroy();

    const runtime = runtimeFor();
    await runtime.getSnapshot().setHistoryGrants([{ channel_id: 'c0', head_seq: 12, has_rows: true }], { generation: 1, boot: first.boot, focus: 'c0' });
    await runtime.getSnapshot().prepareLocalReplica(first.principal, { focus: 'c0' });
    expect(runtime.getSnapshot().historyFor('c0')).toMatchObject({ readPosition: 11 });
    runtime.destroy();
  });

  it('reads a position stored before there was one from its mine half', async () => {
    const first = await attached(10);
    first.runtime.destroy();
    const key = Object.keys(localStorage).find((name) => name.includes(first.principal));
    localStorage.setItem(key, JSON.stringify({ c0: { mine: 11, all: 7 } }));
    const runtime = runtimeFor();
    await runtime.getSnapshot().setHistoryGrants([{ channel_id: 'c0', head_seq: 12, has_rows: true }], { generation: 1, boot: first.boot, focus: 'c0' });
    await runtime.getSnapshot().prepareLocalReplica(first.principal, { focus: 'c0' });
    expect(runtime.getSnapshot().historyFor('c0')).toMatchObject({ readPosition: 11 });
    runtime.destroy();
  });
});
