import { describe, expect, it } from 'vitest';
import {
  createChannelReplicaCache,
  createChannelReplicaStore,
  mergeReplicaCoverage,
} from '../src/model/channel-replica.js';
import {
  CONVERSATION_SCOPE,
  createConversationPresentation,
  selectTimelineItems,
} from '../src/model/conversation-presentation.js';

const CHANNEL = 'c0';
const SELF = 'human:root:1';
const AGENT = 'agent:steward:1';

function row(seq, {
  id = `event-${seq}`,
  kind = 'event',
  type = 'human.note',
  sender = SELF,
  audience = [],
  parentId = '',
  text = String(seq),
} = {}) {
  return {
    channel_id: CHANNEL,
    seq,
    envelope: {
      id,
      kind,
      type,
      sender: { id: sender, kind: sender.startsWith('human:') ? 'human' : 'agent' },
      audience,
      ...(parentId ? { parent_id: parentId, correlation_id: parentId } : {}),
      payload: { body: { text } },
    },
  };
}

function request(seq, id, text = id) {
  return row(seq, {
    id,
    kind: 'request',
    type: 'agent.ask',
    sender: SELF,
    audience: [AGENT],
    text,
  });
}

function response(seq, id, parentId, text = id) {
  const value = row(seq, {
    id,
    kind: 'response',
    type: 'agent.ask',
    sender: AGENT,
    audience: [SELF],
    parentId,
    text,
  });
  value.envelope.payload.body.status = 'completed';
  return value;
}

function commit(store, value) {
  return store.commit(value, SELF);
}

describe('current bounded Replica ownership (baseline memory-window UX)', () => {
  it('trims only the oldest materialized rows and rebuilds every public index', () => {
    const store = createChannelReplicaStore();
    for (let seq = 1; seq <= 8; seq += 1) expect(commit(store, row(seq)).accepted).toBe(true);

    expect(store.trim(CHANNEL, 4)).toBe(4);
    const state = store.state(CHANNEL);
    expect([...state.rows.keys()]).toEqual([5, 6, 7, 8]);
    expect(state.timeline.map((entry) => entry.envelope.id)).toEqual(['event-5', 'event-6', 'event-7', 'event-8']);
    expect([...state._envelopesById.keys()]).toEqual(['event-5', 'event-6', 'event-7', 'event-8']);
    expect(store.record(CHANNEL).materializedCoverage).toEqual([{ lowSeq: 5, highSeq: 8 }]);
  });

  it('does not mutate a window at or below its configured row limit', () => {
    const store = createChannelReplicaStore();
    for (let seq = 1; seq <= 4; seq += 1) commit(store, row(seq));
    expect(store.trim(CHANNEL, 8)).toBe(0);
    expect(store.trim(CHANNEL, 4)).toBe(0);
    expect([...store.state(CHANNEL).rows.keys()]).toEqual([1, 2, 3, 4]);
  });

  it('keeps an incomplete turn coherent when its canonical rows are retained', () => {
    const store = createChannelReplicaStore();
    commit(store, request(1, 'open-request'));
    commit(store, row(2, { id: 'progress', kind: 'response', type: 'agent.ask', sender: AGENT, audience: [SELF], parentId: 'open-request' }));
    const turn = store.state(CHANNEL).timeline[0]?.turn;
    expect(turn).toMatchObject({ requestId: 'open-request', terminal: null, status: 'pending' });
    expect(store.trim(CHANNEL, 1)).toBe(0);
    expect([...store.state(CHANNEL).rows.keys()]).toEqual([1, 2]);
    expect(store.state(CHANNEL).timeline[0]?.turn).toMatchObject({
      requestId: 'open-request', terminal: null, status: 'pending',
    });
    // An open turn may temporarily exceed the configured row limit: deleting
    // either canonical row would make its visible lifecycle incoherent.
  });

  it('retains an older incomplete turn across trim pressure', () => {
    const store = createChannelReplicaStore();
    commit(store, request(1, 'old-open-request'));
    commit(store, row(2, {
      id: 'old-open-progress',
      kind: 'response',
      type: 'agent.ask',
      sender: AGENT,
      audience: [SELF],
      parentId: 'old-open-request',
      text: 'still working',
    }));
    for (let seq = 3; seq <= 12; seq += 1) commit(store, row(seq, { id: `new-event-${seq}` }));

    expect(store.trim(CHANNEL, 4)).toBe(0);
    const state = store.state(CHANNEL);
    const open = state.timeline.find((entry) => entry.turn?.requestId === 'old-open-request')?.turn;
    // An incomplete turn is user-visible work in progress. Trimming may evict
    // unrelated closed rows, but it must keep the request and its provisional
    // evidence coherent even when that turn is older than the trim frontier.
    expect(state.rows.has(1)).toBe(true);
    expect(state.rows.has(2)).toBe(true);
    expect(state.rows.size).toBe(12);
    expect(open).toMatchObject({ requestId: 'old-open-request', terminal: null, status: 'pending' });
  });

  it('evicts rows before the open floor while retaining the complete open tail', () => {
    const store = createChannelReplicaStore();
    for (let seq = 1; seq <= 4; seq += 1) commit(store, row(seq));
    commit(store, request(5, 'floor-open-request'));
    commit(store, row(6, {
      id: 'floor-open-progress', kind: 'response', type: 'agent.ask', sender: AGENT,
      audience: [SELF], parentId: 'floor-open-request', text: 'still working',
    }));
    for (let seq = 7; seq <= 12; seq += 1) commit(store, row(seq, { id: `tail-${seq}` }));

    expect(store.trim(CHANNEL, 4)).toBe(4);
    const state = store.state(CHANNEL);
    expect([...state.rows.keys()]).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    expect(state.timeline.find((entry) => entry.turn?.requestId === 'floor-open-request')?.turn)
      .toMatchObject({ requestId: 'floor-open-request', terminal: null, status: 'pending' });

    commit(store, response(13, 'floor-open-final', 'floor-open-request', 'done'));
    expect(state.timeline.find((entry) => entry.turn?.requestId === 'floor-open-request')?.turn)
      .toMatchObject({ requestId: 'floor-open-request', status: 'completed' });
  });

  it('pins an open child together with its terminal ancestor', () => {
    const store = createChannelReplicaStore();
    commit(store, request(1, 'root-request'));
    commit(store, row(2, {
      id: 'child-request', kind: 'request', type: 'tool.exec', sender: AGENT,
      audience: [SELF], parentId: 'root-request', text: 'tool call',
    }));
    commit(store, response(3, 'root-final', 'root-request', 'root done'));
    commit(store, row(4, {
      id: 'child-progress', kind: 'response', type: 'tool.exec', sender: AGENT,
      audience: [SELF], parentId: 'child-request', text: 'still working',
    }));
    for (let seq = 5; seq <= 8; seq += 1) commit(store, row(seq, { id: `tail-${seq}` }));

    expect(store.trim(CHANNEL, 4)).toBe(0);
    const state = store.state(CHANNEL);
    const root = state.timeline.find((entry) => entry.turn?.requestId === 'root-request');
    expect([...state.rows.keys()]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(root?.turn).toMatchObject({ requestId: 'root-request', status: 'completed' });
    expect(root?.thread.find((entry) => entry.turn?.requestId === 'child-request')?.turn)
      .toMatchObject({ requestId: 'child-request', terminal: null, status: 'pending' });
  });

  it('retains a response-first row across trim until its exact request arrives', () => {
    const store = createChannelReplicaStore();
    for (let seq = 1; seq <= 4; seq += 1) commit(store, row(seq));
    commit(store, row(5, {
      id: 'response-first-progress', kind: 'response', type: 'agent.ask', sender: AGENT,
      audience: [SELF], parentId: 'future-request', text: 'arrived before request',
    }));
    for (let seq = 6; seq <= 8; seq += 1) commit(store, row(seq, { id: `tail-${seq}` }));

    expect(store.trim(CHANNEL, 4)).toBe(4);
    const state = store.state(CHANNEL);
    expect([...state.rows.keys()]).toEqual([5, 6, 7, 8]);
    expect(state.rows.has(5)).toBe(true);
    expect(state.timeline.some((entry) => entry.turn?.requestId === 'future-request')).toBe(false);

    // The parent can arrive in a later ingress batch, with an older sequence;
    // the raw response in the canonical rows map must then merge normally.
    commit(store, request(2, 'future-request'));
    const turn = state.timeline.find((entry) => entry.turn?.requestId === 'future-request')?.turn;
    expect(turn).toMatchObject({ requestId: 'future-request', terminal: null, status: 'pending' });
    expect(turn.provisional.map((item) => item.envelope.id)).toEqual(['response-first-progress']);
  });

  it('does not publish or acknowledge a live arrival while trimming rows', () => {
    const store = createChannelReplicaStore();
    const state = store.ensure(CHANNEL).state;
    state.arrivalReceipts.attachTimelineConsumer(Symbol('trim-test'));
    const liveRequest = row(1, {
      id: 'live-approval', kind: 'request', type: 'human.approve', sender: AGENT, audience: [SELF],
    });
    commit(store, { ...liveRequest, source: 'live' });
    commit(store, { ...response(2, 'live-final', 'live-approval', 'approved'), source: 'live' });
    for (let seq = 3; seq <= 8; seq += 1) commit(store, row(seq, { id: `tail-${seq}` }));
    const before = state.arrivalReceipts.timeline();

    expect(store.trim(CHANNEL, 4)).toBeGreaterThan(0);
    expect(state.arrivalReceipts.timeline()).toEqual(before);
    expect(state._liveArrivalRevision).toBe(before.revision);
    expect(state._liveArrivalAckRevision).toBe(before.acknowledgedRevision);
  });

  it('rejects duplicate sequence and duplicate envelope writes without corrupting the ledger', () => {
    const store = createChannelReplicaStore();
    const first = row(1, { id: 'same' });
    expect(commit(store, first)).toMatchObject({ accepted: true });
    expect(commit(store, row(1, { id: 'other' }))).toMatchObject({ accepted: false, reason: 'duplicate-seq' });
    expect(commit(store, row(2, { id: 'same' }))).toMatchObject({ accepted: false, reason: 'duplicate-envelope' });
    expect(store.state(CHANNEL).rows.size).toBe(1);
  });

  it('rebuilds nested requests into one root timeline entry after out-of-order delivery', () => {
    const store = createChannelReplicaStore();
    commit(store, response(3, 'child-response', 'child-request', 'done'));
    commit(store, request(1, 'root-request'));
    commit(store, row(2, {
      id: 'child-request', kind: 'request', type: 'tool.exec', sender: AGENT,
      audience: [SELF], parentId: 'root-request', text: 'tool call',
    }));
    const root = store.state(CHANNEL).timeline[0];
    expect(root.turn.requestId).toBe('root-request');
    expect(root.thread.map((entry) => entry.turn.requestId)).toEqual(['child-request']);
    expect(root.thread[0].turn.terminal.payload.body.text).toBe('done');
  });

  it('keeps the same request id isolated across channel Replica records', () => {
    const store = createChannelReplicaStore();
    expect(store.commit({ ...request(1, 'same-request'), channel_id: 'closed' }, SELF).accepted).toBe(true);
    expect(store.commit({ ...request(1, 'same-request'), channel_id: 'open' }, SELF).accepted).toBe(true);
    expect(store.state('closed').rows.size).toBe(1);
    expect(store.state('open').rows.size).toBe(1);
    expect(store.state('closed').timeline[0].turn.requestId).toBe('same-request');
    expect(store.state('open').timeline[0].turn.requestId).toBe('same-request');
  });

  it('merges durable coverage without treating gaps as materialized rows', () => {
    expect(mergeReplicaCoverage([{ lowSeq: 1, highSeq: 2 }], { lowSeq: 4, highSeq: 5 }))
      .toEqual([{ lowSeq: 1, highSeq: 2 }, { lowSeq: 4, highSeq: 5 }]);
    expect(mergeReplicaCoverage([{ lowSeq: 1, highSeq: 2 }], { lowSeq: 3, highSeq: 5 }))
      .toEqual([{ lowSeq: 1, highSeq: 5 }]);
  });

  it('removes evicted rows from the conversation scope rather than leaving index ghosts', () => {
    const store = createChannelReplicaStore();
    commit(store, request(1, 'old-request'));
    commit(store, response(2, 'old-response', 'old-request'));
    commit(store, request(3, 'new-request'));
    commit(store, response(4, 'new-response', 'new-request'));
    store.trim(CHANNEL, 2);
    const selection = selectTimelineItems(store.state(CHANNEL), {
      scope: CONVERSATION_SCOPE.mine, selfId: SELF,
    });
    expect(selection.items.map((entry) => entry.turn.requestId)).toEqual(['new-request']);
    expect(selection.items.some((entry) => entry.turn.requestId === 'old-request')).toBe(false);
  });

  it('reads bounded cache pages by row count and byte budget through the current cache owner', async () => {
    const cache = createChannelReplicaCache({ indexedDB: null });
    await cache.ensureOwner('root', { world: 'window-test' });
    await cache.clear();
    const rows = [
      row(1, { text: 'a'.repeat(40) }),
      row(2, { text: 'b'.repeat(40) }),
      row(3, { text: 'c'.repeat(40) }),
    ];
    expect(await cache.saveRows(rows)).toBe(3);
    expect((await cache.readBefore(CHANNEL, 99, 2, 1_000)).rows).toHaveLength(2);
    const byteLimited = await cache.readBefore(CHANNEL, 99, 9, 300);
    expect(byteLimited.rows.length).toBeGreaterThan(0);
    expect(byteLimited.rows.length).toBeLessThan(3);
    expect(byteLimited.bytes).toBeLessThanOrEqual(300);
    await cache.clear();
  });

  it('reconciles cache coverage to physical rows without materializing a gap on restart', async () => {
    const cache = createChannelReplicaCache({ indexedDB: null });
    await cache.ensureOwner('root', { world: 'coverage-reconcile' });
    await cache.clear();
    await cache.saveRows([row(1), row(3)], {
      coverage: { channelId: CHANNEL, lowSeq: 1, highSeq: 3 },
    });
    expect((await cache.readBefore(CHANNEL, 99, 10, 10_000)).rows.map((item) => item.seq)).toEqual([1, 3]);

    // Re-selecting the same owner exercises the public startup/reload path;
    // physical rows remain the only source of materialized coverage.
    await cache.ensureOwner('root', { world: 'coverage-reconcile' });
    expect(cache.metaSnapshot().get(CHANNEL)).toMatchObject({
      rowCount: 2, oldestSeq: 1, newestSeq: 3,
      coverage: [{ lowSeq: 1, highSeq: 1 }, { lowSeq: 3, highSeq: 3 }],
    });
    expect((await cache.readBefore(CHANNEL, 99, 10, 10_000)).rows.map((item) => item.seq)).toEqual([1, 3]);
    await cache.clear();
  });

  it('does not let a different principal/world read the prior cache owner', async () => {
    const cache = createChannelReplicaCache({ indexedDB: null });
    await cache.ensureOwner('root', { world: 'owner-a' });
    await cache.clear();
    await cache.saveRows([row(1, { id: 'private-row' })]);
    await cache.ensureOwner('other', { world: 'owner-a' });
    expect((await cache.readBefore(CHANNEL, 99, 10, 10_000)).rows).toEqual([]);
    await cache.ensureOwner('root', { world: 'owner-a' });
    expect((await cache.readBefore(CHANNEL, 99, 10, 10_000)).rows.map((item) => item.envelope.id))
      .toEqual(['private-row']);
    await cache.clear();
  });

  it('publishes detached Presentation rows so a later Replica update cannot rewrite the visible snapshot', () => {
    const store = createChannelReplicaStore();
    commit(store, request(1, 'stable-request', 'before'));
    const presentation = createConversationPresentation();
    const candidate = presentation.evaluate(store.state(CHANNEL).timeline, {
      nextViewID: 'c0:mine', epoch: 'window-test', sourceRevision: 1,
    });
    expect(presentation.commitCandidate(candidate)).toBe(true);
    const visible = candidate.snapshot.rows[0];
    commit(store, response(2, 'stable-response', 'stable-request', 'after'));
    expect(visible.body.turn.terminal).toBeNull();
    expect(store.state(CHANNEL).timeline[0].turn.terminal.payload.body.text).toBe('after');
  });
});
