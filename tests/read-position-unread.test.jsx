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

describe('unread is defined by the read position', () => {
  it('never counts history at or below the head a channel was first seen at', async () => {
    const { runtime, feed } = await attached(10);
    for (let seq = 5; seq <= 10; seq += 1) feed().enqueue(ask(seq, OTHER, [ME], 'history'));
    expect(feed().unreadFor('c0', ME)).toMatchObject({ related: 0, other: 0 });
    runtime.destroy();
  });

  it('counts a message from someone else after the read position, never the reader\'s own', async () => {
    const { runtime, feed } = await attached(10);
    feed().enqueue(ask(11, ME, [AGENT]));
    expect(feed().unreadFor('c0', ME)).toMatchObject({ related: 0, other: 0 });
    feed().enqueue(answer(12, 11));
    expect(feed().unreadFor('c0', ME)).toMatchObject({ related: 1, other: 0 });
    expect([...feed().unreadRootsFor('c0', ME).related]).toEqual(['ask-11']);
    runtime.destroy();
  });

  it('clears related rows from any view and unrelated rows only from the all view', async () => {
    const { runtime, feed } = await attached(10);
    feed().enqueue(note(11, OTHER, [ME]));
    feed().enqueue(note(12, OTHER, ['human:third:1']));
    expect(feed().unreadFor('c0', ME)).toMatchObject({ related: 1, other: 1 });
    expect(feed().markSeen('c0', 12, { all: false })).toBe(true);
    expect(feed().unreadFor('c0', ME)).toMatchObject({ related: 0, other: 1 });
    expect(feed().markSeen('c0', 12, { all: true })).toBe(true);
    expect(feed().unreadFor('c0', ME)).toMatchObject({ related: 0, other: 0 });
    runtime.destroy();
  });

  it('only moves forward and never past the head', async () => {
    const { runtime, feed } = await attached(10);
    feed().enqueue(note(11, OTHER, [ME]));
    expect(feed().markSeen('c0', 99, { all: true })).toBe(true);
    expect(feed().historyFor('c0')).toMatchObject({ readMine: 11, readAll: 11 });
    expect(feed().markSeen('c0', 5, { all: true })).toBe(false);
    feed().enqueue(note(12, OTHER, [ME]));
    expect(feed().unreadFor('c0', ME)).toMatchObject({ related: 1 });
    runtime.destroy();
  });

  it('keeps the read position across a reload of the same world', async () => {
    const first = await attached(10);
    first.feed().enqueue(ask(11, OTHER, [ME]));
    first.feed().enqueue(ask(12, OTHER, [ME]));
    first.feed().markSeen('c0', 11, { all: true });
    first.runtime.destroy();

    const runtime = runtimeFor();
    await runtime.getSnapshot().setHistoryGrants([{ channel_id: 'c0', head_seq: 12, has_rows: true }], { generation: 1, boot: first.boot, focus: 'c0' });
    await runtime.getSnapshot().prepareLocalReplica(first.principal, { focus: 'c0' });
    expect(runtime.getSnapshot().historyFor('c0')).toMatchObject({ readMine: 11, readAll: 11 });
    runtime.destroy();
  });
});
