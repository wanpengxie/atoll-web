import { describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { selectFeatureWaitingFacts } from '../src/model/feature-tasks.js';

const CHANNEL = 'c0';
const SELF = 'human:root:1';
const AGENT = 'agent:worker:1';

function runtimeOptions(wireRef) {
  return {
    wireRef,
    rosterRef: { current: { self: () => SELF, observeFeed: () => {}, handleEnvelope: () => {} } },
    accessRef: { current: { live: () => false } },
    activeChannelRef: { current: CHANNEL },
    onError: vi.fn(),
    onChannelsDiscovered: vi.fn(),
    onDirectoryInvalidated: vi.fn(),
    onAccessChanged: vi.fn(),
    onSubmissionFeed: vi.fn(),
  };
}

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

function terminal(seq = 21) {
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

function publicTurn(state) {
  return state.timeline.find((entry) => entry.turn?.requestId === 'work')?.turn;
}

function waiting(state) {
  return selectFeatureWaitingFacts({
    state,
    channelId: CHANNEL,
    targetAuthority: { current: true, actorIDs: new Set([AGENT]) },
  });
}

describe('SZ-283/SZ-284/SZ-285 current public terminal outcomes', () => {
  it('keeps a live terminal authoritative when the buffered history page is released', async () => {
    const requests = [];
    const wireRef = { current: {
      historyBefore: vi.fn((channelId, beforeSeq, limit, detail) => {
        const ref = `sz283-history-${requests.length + 1}`;
        requests.push({ channelId, beforeSeq, limit, ref, ...detail });
        const receipt = Promise.resolve({ accepted: true, generation: detail.generation, channel_id: channelId });
        receipt.ref = ref;
        return receipt;
      }),
      cancelHistory: vi.fn(async () => undefined),
    } };
    const runtime = createChannelFeedRuntime(runtimeOptions(wireRef));
    runtime.mount();
    const snapshot = runtime.getSnapshot();
    await snapshot.setHistoryGrants([
      { channel_id: CHANNEL, head_seq: 21, has_rows: true },
    ], { generation: 1, boot: 'sz283-public-boot', focus: CHANNEL });

    const page = snapshot.loadHistory(CHANNEL, { beforeSeq: 22, limit: 32, urgency: 'blocking' });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    const call = requests[0];

    // Feed buffers the replay page until pageEnd. The live terminal arrives
    // through the separate live ingress before that page is published.
    expect(snapshot.enqueue({ ...request(), ref: call.ref, generation: 1 })).toBe(true);
    expect(snapshot.enqueue({ ...queued(), ref: call.ref, generation: 1 })).toBe(true);
    expect(snapshot.enqueue({ ...terminal(), source: 'live', generation: 1 })).toBe(true);
    expect(snapshot.pageEnd({
      ref: call.ref,
      channel_id: CHANNEL,
      generation: 1,
      rows: 2,
      scan_low_seq: 1,
      scan_high_seq: 21,
      next_before_seq: 1,
      has_older: false,
    })).toBe(true);
    await expect(page).resolves.toMatchObject({ kind: 'satisfied', released: 2 });

    const state = snapshot.stateFor(CHANNEL);
    expect(publicTurn(state)).toMatchObject({ requestId: 'work', status: 'completed' });
    expect(waiting(state)).toEqual([]);
    runtime.destroy();
  });

  it('merges a cached terminal into one materialized request without reopening Waiting', () => {
    const replica = createChannelReplicaStore();
    expect(replica.commit(request(), SELF, undefined, { source: 'live' }).accepted).toBe(true);
    expect(replica.commit(note(3), SELF, undefined, { source: 'live' }).accepted).toBe(true);
    expect(replica.commit(terminal(2), SELF, undefined, { source: 'cache' }).accepted).toBe(true);

    const state = replica.state(CHANNEL);
    expect(publicTurn(state)).toMatchObject({
      requestId: 'work',
      status: 'completed',
      terminalSeq: 2,
    });
    expect(waiting(state)).toEqual([]);
  });

  it('keeps a terminal-first cache replay closed when its request page arrives later', () => {
    const replica = createChannelReplicaStore();
    expect(replica.commit(terminal(2), SELF, undefined, { source: 'cache' }).accepted).toBe(true);
    expect(replica.commit(request(1), SELF, undefined, { source: 'cache' }).accepted).toBe(true);
    expect(replica.commit(queued(3), SELF, undefined, { source: 'cache' }).accepted).toBe(true);

    const state = replica.state(CHANNEL);
    expect(publicTurn(state)).toMatchObject({
      requestId: 'work',
      status: 'completed',
      terminalSeq: 2,
    });
    expect(waiting(state)).toEqual([]);
  });
});
