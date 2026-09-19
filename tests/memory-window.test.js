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
    expect(store.trim(CHANNEL, 1)).toBe(1);
    expect(store.state(CHANNEL).timeline).toEqual([]);
    // A bounded Replica deliberately fails closed after its request is evicted;
    // history/cache must re-admit the request before Presentation can show it.
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
