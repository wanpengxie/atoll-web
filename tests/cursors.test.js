import { describe, expect, it } from 'vitest';
import {
  createCursors,
  unreadCount as unreadCountCanonical,
  unreadCountDiagnostics as unreadCountDiagnosticsCanonical,
  unreadCounts as unreadCountsCanonical,
} from '../src/model/cursors.js';
import {
  acknowledgeLiveTimelineArrivals,
  apply as applyCanonical,
  createChannelState,
  liveTimelineArrivals,
  recordLiveTimelineArrival as recordLiveTimelineArrivalCanonical,
  registerLiveTimelineArrivalConsumer,
} from '../src/model/fold.js';

function canonicalEnvelope(envelope) {
  if (!envelope) return envelope;
  if (Object.prototype.hasOwnProperty.call(envelope.payload || {}, 'body')) return envelope;
  envelope.payload = { body: envelope.payload || {} };
  return envelope;
}

function canonicalState(state) {
  if (!(state?.rows instanceof Map)) return state;
  for (const [seq, envelope] of state.rows) state.rows.set(seq, canonicalEnvelope(envelope));
  if (state._envelopesById instanceof Map) {
    for (const [id, envelope] of state._envelopesById) state._envelopesById.set(id, canonicalEnvelope(envelope));
  }
  return state;
}

function apply(state, row, selfID) {
  return applyCanonical(state, { ...row, envelope: canonicalEnvelope(row.envelope) }, selfID);
}

function recordLiveTimelineArrival(state, envelope, seq, selfID) {
  return recordLiveTimelineArrivalCanonical(state, canonicalEnvelope(envelope), seq, selfID);
}

function unreadCount(state, ...args) {
  return unreadCountCanonical(canonicalState(state), ...args);
}

function unreadCounts(state, ...args) {
  return unreadCountsCanonical(canonicalState(state), ...args);
}

function unreadCountDiagnostics(state, ...args) {
  return unreadCountDiagnosticsCanonical(canonicalState(state), ...args);
}

class MemoryStorage {
  data = new Map();
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}

describe('channel cursors', () => {
  it('maps a live terminal to its stable root and ignores progress and self echo', () => {
    const state = createChannelState('c0');
    const release = registerLiveTimelineArrivalConsumer(state);
    const request = { id: 'root', kind: 'request', type: 'agent.ask', sender: { id: 'me' }, audience: ['agent'] };
    apply(state, { channel_id: 'c0', seq: 1, envelope: request }, 'me');
    expect(recordLiveTimelineArrival(state, request, 1, 'me')).toBeNull();

    const progress = { id: 'progress', kind: 'response', parent_id: 'root', sender: { id: 'agent' }, audience: ['me'], payload: { status: 'processing' } };
    apply(state, { channel_id: 'c0', seq: 2, envelope: progress }, 'me');
    expect(recordLiveTimelineArrival(state, progress, 2, 'me')).toBeNull();

    const terminal = { id: 'terminal', kind: 'response', parent_id: 'root', sender: { id: 'agent' }, audience: ['me'], payload: { status: 'completed', text: 'answer' } };
    apply(state, { channel_id: 'c0', seq: 3, envelope: terminal }, 'me');
    expect(recordLiveTimelineArrival(state, terminal, 3, 'me')).toMatchObject({ key: 'root', rowID: 'root', seq: 3 });
    expect(state._liveArrivalLog).toHaveLength(1);

    const conflict = { ...terminal, id: 'terminal-conflict', payload: { status: 'failed' } };
    apply(state, { channel_id: 'c0', seq: 4, envelope: conflict }, 'me');
    expect(recordLiveTimelineArrival(state, conflict, 4, 'me')).toBeNull();
    expect(state._liveArrivalLog).toHaveLength(1);

    const orphanState = createChannelState('c0');
    const orphan = { id: 'terminal-first', kind: 'response', parent_id: 'late-root', correlation_id: 'late-root', sender: { id: 'agent' }, audience: ['me'], payload: { status: 'completed', text: 'answer before request' } };
    apply(orphanState, { channel_id: 'c0', seq: 9, envelope: orphan }, 'me');
    expect(recordLiveTimelineArrival(orphanState, orphan, 9, 'me')).toMatchObject({
      key: 'late-root', rowID: 'terminal-first', seq: 9,
    });
    release();
  });

  it('keeps unrelated queued work and its terminal out of personal viewport notices', () => {
    const state = createChannelState('c0');
    registerLiveTimelineArrivalConsumer(state);
    const agent = { id: 'agent:worker:1', kind: 'agent' };
    const request = { id: 'work', kind: 'request', type: 'agent.ask', sender: agent, audience: [agent.id] };
    const queued = { id: 'queued', kind: 'response', type: 'agent.ask', parent_id: 'work', sender: agent, audience: [agent.id], payload: { status: 'queued' } };
    const processing = { id: 'processing', kind: 'response', type: 'agent.ask', parent_id: 'work', sender: agent, audience: [agent.id], payload: { status: 'processing' } };
    const progress = { ...processing, id: 'progress', payload: { status: 'processing', process: { kind: 'stage' } } };

    apply(state, { channel_id: 'c0', seq: 1, envelope: request }, 'human:root:1');
    expect(recordLiveTimelineArrival(state, request, 1, 'human:root:1')).toBeNull();
    apply(state, { channel_id: 'c0', seq: 2, envelope: queued }, 'human:root:1');
    expect(recordLiveTimelineArrival(state, queued, 2, 'human:root:1')).toBeNull();
    apply(state, { channel_id: 'c0', seq: 3, envelope: processing }, 'human:root:1');
    expect(recordLiveTimelineArrival(state, processing, 3, 'human:root:1')).toBeNull();
    apply(state, { channel_id: 'c0', seq: 4, envelope: progress }, 'human:root:1');
    expect(recordLiveTimelineArrival(state, progress, 4, 'human:root:1')).toBeNull();
    const terminal = { ...processing, id: 'terminal', payload: { status: 'completed', text: 'done' } };
    apply(state, { channel_id: 'c0', seq: 5, envelope: terminal }, 'human:root:1');
    expect(recordLiveTimelineArrival(state, terminal, 5, 'human:root:1')).toBeNull();
    expect(unreadCounts(state, 0, 'human:root:1')).toEqual({ related: 0, total: 1 });
    expect(state.turns.get('work')?.terminal?.id).toBe('terminal');
    expect(liveTimelineArrivals(state).events).toHaveLength(0);
  });

  it('creates viewport arrivals only for independently readable public events', () => {
    const state = createChannelState('c0');
    registerLiveTimelineArrivalConsumer(state);
    const uiRequest = {
      id: 'ui-op', kind: 'request', type: 'ui.state', visibility: 'public',
      sender: { id: 'agent:steward:1', kind: 'agent' }, audience: ['human:root:1'], payload: { text: 'release is ready' },
    };
    apply(state, { channel_id: 'c0', seq: 1, envelope: uiRequest }, 'human:root:1');
    expect(recordLiveTimelineArrival(state, uiRequest, 1, 'human:root:1')).toBeNull();

    const event = {
      id: 'public-event', kind: 'event', type: 'human.note', visibility: 'public',
      sender: { id: 'agent:steward:1', kind: 'agent' }, audience: ['human:root:1'], payload: { text: 'release is ready' },
    };
    apply(state, { channel_id: 'c0', seq: 2, envelope: event }, 'human:root:1');
    expect(recordLiveTimelineArrival(state, event, 2, 'human:root:1'))
      .toMatchObject({ key: 'public-event', rowID: 'public-event', seq: 2 });
    expect(unreadCounts(state, 0, 'human:root:1')).toEqual({ related: 0, total: 0 });

    const activity = {
      id: 'agent-activity', kind: 'event', type: 'agent.resume', visibility: 'public',
      sender: { id: 'agent:steward:1', kind: 'agent' }, audience: ['agent:steward:1'],
      payload: { task: 'resume work' },
    };
    apply(state, { channel_id: 'c0', seq: 3, envelope: activity }, 'human:root:1');
    expect(recordLiveTimelineArrival(state, activity, 3, 'human:root:1')).toBeNull();
  });

  it('does not wake an acknowledged root for a nested tool lifecycle', () => {
    const state = createChannelState('c0');
    registerLiveTimelineArrivalConsumer(state);
    const child = {
      id: 'child-request', kind: 'request', type: 'tool.run',
      parent_id: 'root-request', correlation_id: 'root-request',
      sender: { id: 'agent' }, audience: ['tool'],
    };
    apply(state, { channel_id: 'c0', seq: 5, envelope: child }, 'me');
    expect(recordLiveTimelineArrival(state, child, 5, 'me')).toBeNull();
    expect(unreadCounts(state, 0, 'me')).toEqual({ related: 0, total: 0 });
    expect(unreadCountDiagnostics(state, 0, 'me').rows)
      .toContainEqual(expect.objectContaining({ id: 'child-request', seq: 5, ackReason: 'nested_tool_lifecycle' }));
  });

  it('keeps a top-level readable tool turn as one legitimate notification', () => {
    const state = createChannelState('c0');
    const request = {
      id: 'tool-root', kind: 'request', type: 'tool.report', visibility: 'public',
      sender: { id: 'tool:reporter:1', kind: 'tool' }, audience: ['human:root:1'],
      payload: { text: 'Report requested' },
    };
    const terminal = {
      id: 'tool-root-done', kind: 'response', type: 'tool.report', parent_id: 'tool-root', visibility: 'public',
      sender: { id: 'tool:reporter:1', kind: 'tool' }, audience: ['human:root:1'],
      payload: { status: 'completed', text: 'Report ready' },
    };
    apply(state, { channel_id: 'c0', seq: 1, envelope: request }, 'human:root:1');
    apply(state, { channel_id: 'c0', seq: 2, envelope: terminal }, 'human:root:1');

    expect(unreadCounts(state, 0, 'human:root:1')).toEqual({ related: 1, total: 1 });
    expect(recordLiveTimelineArrival(state, terminal, 2, 'human:root:1'))
      .toMatchObject({ key: 'tool-root', rowID: 'tool-root', seq: 2 });
  });

  it('keeps more than one hot-journal window exact until consumption, then releases it', () => {
    const state = createChannelState('c0');
    const release = registerLiveTimelineArrivalConsumer(state);
    for (let index = 1; index <= 1_100; index += 1) {
      const envelope = {
        id: `live-${index}`,
        kind: 'event',
        type: 'human.note',
        visibility: 'public',
        sender: { id: 'other' },
        audience: ['me'],
        payload: { text: `message ${index}` },
      };
      apply(state, { channel_id: 'c0', seq: index, envelope }, 'me');
      recordLiveTimelineArrival(state, envelope, index, 'me');
    }
    const pending = liveTimelineArrivals(state);
    expect(pending.revision).toBe(1_100);
    expect(new Set(pending.events.map((event) => event.key)).size).toBe(1_100);
    expect(state._liveArrivalLog.length).toBeLessThanOrEqual(1_024);
    expect(state._liveArrivalOverflow.size).toBe(76);

    expect(acknowledgeLiveTimelineArrivals(state, pending.revision)).toBe(1_100);
    expect(state._liveArrivalLog).toHaveLength(0);
    expect(state._liveArrivalOverflow.size).toBe(0);
    release();
  });

  it('keeps repeated-root overflow exact across partial acknowledgement and a new tail event', () => {
    const state = createChannelState('c0');
    const release = registerLiveTimelineArrivalConsumer(state);
    for (let revision = 1; revision <= 1_100; revision += 1) {
      const envelope = {
        id: `terminal-${revision}`,
        kind: 'response',
        parent_id: 'stable-root',
        correlation_id: 'stable-root',
        sender: { id: 'agent' },
        audience: ['me'],
        payload: { status: 'completed', text: `answer ${revision}` },
      };
      // This is an arrival-journal overflow fixture: retain accepted rows with
      // one stable presentation identity without asking the turn fold to
      // accept 1,100 conflicting terminal states for a single lifecycle.
      state.rows.set(revision, envelope);
      state._rowOrder.push(revision);
      recordLiveTimelineArrival(state, envelope, revision, 'me');
    }
    expect(state._liveArrivalLog).toHaveLength(1_024);
    expect(state._liveArrivalOverflow.size).toBe(1);
    expect(state._liveArrivalOverflow.get('stable-root').rowIDs).toHaveLength(76);

    acknowledgeLiveTimelineArrivals(state, 50);
    expect(state._liveArrivalOverflow.get('stable-root').revision).toBe(76);
    acknowledgeLiveTimelineArrivals(state, 76);
    expect(state._liveArrivalOverflow.size).toBe(0);
    acknowledgeLiveTimelineArrivals(state, 1_100);
    expect(liveTimelineArrivals(state).events).toHaveLength(0);

    const uniqueTail = {
      id: 'unique-tail', kind: 'event', type: 'human.note', visibility: 'public',
      sender: { id: 'other' }, audience: ['me'], payload: { text: 'unique tail' },
    };
    apply(state, { channel_id: 'c0', seq: 1_101, envelope: uniqueTail }, 'me');
    recordLiveTimelineArrival(state, uniqueTail, 1_101, 'me');
    expect(liveTimelineArrivals(state)).toMatchObject({
      revision: 1_101,
      events: [{ revision: 1_101, key: 'unique-tail', rowID: 'unique-tail' }],
    });
    release();
    expect(liveTimelineArrivals(state).events).toHaveLength(1);
    acknowledgeLiveTimelineArrivals(state, 1_101);
    expect(liveTimelineArrivals(state).events).toHaveLength(0);
  });

  it('does not retain viewport arrivals while no Timeline consumer is mounted', () => {
    const state = createChannelState('c0');
    for (let revision = 1; revision <= 2_000; revision += 1) {
      const envelope = {
        id: `background-${revision}`,
        kind: 'event', type: 'human.note', visibility: 'public', sender: { id: 'other' },
        audience: ['me'],
        payload: { text: `background ${revision}` },
      };
      apply(state, { channel_id: 'c0', seq: revision, envelope }, 'me');
      recordLiveTimelineArrival(state, envelope, revision, 'me');
    }
    expect(state._liveArrivalRevision).toBe(2_000);
    expect(state._liveArrivalLog).toHaveLength(0);
    expect(state._liveArrivalOverflow.size).toBe(0);
  });

  it('registers one logical viewport once and releases its arrival baseline once', () => {
    const state = createChannelState('c0');
    const consumer = Symbol('timeline');
    const releaseFirst = registerLiveTimelineArrivalConsumer(state, consumer);
    const releaseDuplicate = registerLiveTimelineArrivalConsumer(state, consumer);
    expect(state._liveArrivalConsumers).toBe(1);

    const whileMounted = {
      id: 'while-mounted', kind: 'event', type: 'human.note', visibility: 'public',
      sender: { id: 'other' }, audience: ['me'], payload: { text: 'while mounted' },
    };
    apply(state, { channel_id: 'c0', seq: 1, envelope: whileMounted }, 'me');
    recordLiveTimelineArrival(state, whileMounted, 1, 'me');
    expect(liveTimelineArrivals(state).events).toHaveLength(1);

    releaseDuplicate();
    expect(state._liveArrivalConsumers).toBe(0);
    expect(state._liveArrivalAckRevision).toBe(0);
    expect(liveTimelineArrivals(state).events).toHaveLength(1);
    acknowledgeLiveTimelineArrivals(state, 1);
    expect(liveTimelineArrivals(state).events).toHaveLength(0);
    releaseFirst();
    expect(state._liveArrivalConsumers).toBe(0);
  });

  it('does not let a later background arrival acknowledge an undisposed viewport handoff', () => {
    const state = createChannelState('c0');
    const release = registerLiveTimelineArrivalConsumer(state, Symbol('timeline'));
    const pendingHandoff = {
      id: 'pending-handoff', kind: 'event', type: 'human.note', visibility: 'public',
      sender: { id: 'other' }, audience: ['me'], payload: { text: 'pending handoff' },
    };
    apply(state, { channel_id: 'c0', seq: 1, envelope: pendingHandoff }, 'me');
    recordLiveTimelineArrival(state, pendingHandoff, 1, 'me');
    release();
    const backgroundAfterSwitch = {
      id: 'background-after-switch', kind: 'event', type: 'human.note', visibility: 'public',
      sender: { id: 'other' }, audience: ['me'], payload: { text: 'background after switch' },
    };
    apply(state, { channel_id: 'c0', seq: 2, envelope: backgroundAfterSwitch }, 'me');
    recordLiveTimelineArrival(state, backgroundAfterSwitch, 2, 'me');
    expect(liveTimelineArrivals(state)).toMatchObject({
      acknowledgedRevision: 0,
      events: [
        { revision: 1, key: 'pending-handoff' },
        { revision: 2, key: 'background-after-switch' },
      ],
    });
  });

  it('only advances and snapshots feed cursors', () => {
    const cursors = createCursors(new MemoryStorage());
    expect(cursors.advance('c0', 8)).toBe(8);
    expect(cursors.advance('c0', 3)).toBe(8);
    cursors.advance('lobby', 2);
    expect(cursors.snapshot()).toEqual({ c0: 8, lobby: 2 });
  });

  it('persists a monotone notification high-water and starts a new schema epoch at attach head', () => {
    const storage = new MemoryStorage();
    const cursors = createCursors(storage, { requireReadAuthority: true });
    cursors.selectReadAuthority({ principalId: 'p1', serverBoot: 'boot-a' });
    cursors.baselineRead('c0', 40);
    expect(cursors.baselineNotifications('c0', 40)).toBe(40);
    expect(cursors.acknowledgeNotifications('c0', 57)).toBe(57);
    // Same-world stale Meta cannot move the acknowledged boundary backwards.
    expect(cursors.baselineNotifications('c0', 25)).toBe(57);

    const restored = createCursors(storage, { requireReadAuthority: true });
    restored.selectReadAuthority({ principalId: 'p1', serverBoot: 'boot-a' });
    expect(restored.notificationHighWater('c0')).toBe(57);
    expect(restored.baselineNotifications('c0', 80)).toBe(57);
    restored.resetReads();
    expect(restored.notificationHighWater('c0')).toBe(57);

    // A different ledger world gets its own explicit first-attach baseline.
    restored.selectReadAuthority({ principalId: 'p1', serverBoot: 'boot-b' });
    restored.baselineRead('c0', 12);
    expect(restored.baselineNotifications('c0', 12)).toBe(12);
  });

  it('tracks read cursors separately and counts non-system, non-self messages', () => {
    const cursors = createCursors(new MemoryStorage());
    cursors.markRead('c0', 2);
    cursors.markRead('c0', 1);
    expect(cursors.read('c0')).toBe(2);
    const state = { rows: new Map([
      [2, { id: 'already-read', kind: 'request', visibility: 'public', sender: { id: 'other' } }],
      [3, { id: 'system-row', kind: 'request', visibility: 'system', sender: { id: 'system' } }],
      [4, { id: 'mine', kind: 'request', visibility: 'public', sender: { id: 'me' } }],
      [5, { id: 'reply', kind: 'response', visibility: 'public', payload: { status: 'completed', text: 'reply' }, sender: { id: 'other' } }],
    ]) };
    expect(unreadCount(state, cursors.read('c0'), 'me')).toBe(1);
  });

  it('caps feed resume cursors without rewinding cache-independent read cursors', () => {
    const storage = new MemoryStorage();
    const cursors = createCursors(storage);
    cursors.advance('c0', 48);
    cursors.markRead('c0', 48);
    cursors.advance('missing-cache', 99);
    cursors.markRead('missing-cache', 99);

    cursors.reconcile({ c0: 33 });

    expect(cursors.snapshot()).toEqual({ c0: 33, 'missing-cache': 0 });
    expect(cursors.read('c0')).toBe(48);
    expect(cursors.read('missing-cache')).toBe(99);
  });

  it('baselines a new browser at the attach head and preserves an older read boundary', () => {
    const cursors = createCursors(new MemoryStorage());
    expect(cursors.hasRead('c0')).toBe(false);
    expect(cursors.baselineRead('c0', 100)).toBe(100);
    expect(cursors.hasRead('c0')).toBe(true);
    cursors.markRead('c0', 120);
    // A later reconnect at the same ledger head never moves a valid read cursor
    // backwards, while a replaced/truncated ledger is allowed to clamp it.
    expect(cursors.baselineRead('c0', 130)).toBe(120);
    expect(cursors.baselineRead('c0', 80)).toBe(80);
    cursors.resetReads();
    expect(cursors.hasRead('c0')).toBe(false);
  });

  it('validates persisted reads against an explicit principal and ledger world before use', () => {
    const storage = new MemoryStorage();
    storage.setItem('atoll.read.v4.c0', '999');
    storage.setItem('atoll.read-identities.v1.c0', JSON.stringify([['stale-root', 999]]));
    storage.setItem('draft.c0', 'keep-me');
    const cursors = createCursors(storage, { requireReadAuthority: true });
    expect(cursors.isReadAuthorityReady()).toBe(false);
    expect(cursors.read('c0')).toBe(0);
    expect(cursors.acknowledgedReadIdentities('c0')).toEqual(new Map());

    expect(cursors.selectReadAuthority({ principalId: 'p1', serverBoot: 'boot-a' }))
      .toEqual({ ready: true, reused: false, changed: true });
    expect(cursors.baselineRead('c0', 40)).toBe(40);
    expect(storage.getItem('draft.c0')).toBe('keep-me');
    cursors.markRead('c0', 45);
    cursors.acknowledgeReadIdentities('c0', [{ messageID: 'visible', seqHigh: 50 }]);

    const restored = createCursors(storage, { requireReadAuthority: true });
    expect(restored.selectReadAuthority({ principalId: 'p1', serverBoot: 'boot-a' }))
      .toEqual({ ready: true, reused: true, changed: true });
    expect(restored.read('c0')).toBe(45);
    expect(restored.acknowledgedReadIdentities('c0')).toEqual(new Map([['visible', 50]]));

    expect(restored.selectReadAuthority({ principalId: 'p1', serverBoot: 'boot-b' }))
      .toEqual({ ready: true, reused: false, changed: true });
    expect(restored.hasRead('c0')).toBe(false);
    expect(restored.baselineRead('c0', 12)).toBe(12);
    expect(restored.acknowledgedReadIdentities('c0')).toEqual(new Map());
    expect(storage.getItem('draft.c0')).toBe('keep-me');
  });

  it('clamps restored physical and exact read facts to the current channel head', () => {
    const storage = new MemoryStorage();
    const cursors = createCursors(storage, { requireReadAuthority: true });
    cursors.selectReadAuthority({ principalId: 'p1', serverBoot: 'boot-a' });
    cursors.baselineRead('c0', 100);
    cursors.acknowledgeReadIdentities('c0', [
      { messageID: 'within-head', seqHigh: 110 },
      { messageID: 'above-next-head', seqHigh: 140 },
    ]);
    cursors.markRead('c0', 105);
    expect(cursors.baselineRead('c0', 120)).toBe(105);
    expect(cursors.acknowledgedReadIdentities('c0')).toEqual(new Map([['within-head', 110]]));

    storage.setItem('atoll.read.v4.corrupt', 'not-a-sequence');
    expect(cursors.baselineRead('corrupt', 77)).toBe(77);
  });

  it('persists exact visible identity acknowledgements without clearing an unshown sibling', () => {
    const storage = new MemoryStorage();
    const cursors = createCursors(storage);
    const state = { rows: new Map([
      [10, { id: 'visible-root', kind: 'request', visibility: 'public', audience: ['me'], sender: { id: 'agent' } }],
      [11, { id: 'unshown-root', kind: 'request', visibility: 'public', audience: ['me'], sender: { id: 'agent' } }],
    ]) };
    expect(cursors.acknowledgeReadIdentities('c0', [
      { messageID: 'visible-root', seqHigh: 10 },
    ])).toBe(true);
    const acknowledged = cursors.acknowledgedReadIdentities('c0');
    expect(unreadCount(state, 0, 'me', { acknowledged })).toBe(1);
    expect(unreadCounts(state, 0, 'me', { acknowledged })).toEqual({ related: 1, total: 1 });

    const restored = createCursors(storage);
    expect([...restored.acknowledgedReadIdentities('c0')]).toEqual([['visible-root', 10]]);
    state.rows.set(12, {
      id: 'visible-root-answer', kind: 'response', parent_id: 'visible-root',
      visibility: 'public', audience: ['me'], payload: { status: 'completed', text: 'new answer' },
      sender: { id: 'agent' },
    });
    expect(unreadCounts(state, 0, 'me', {
      acknowledged: restored.acknowledgedReadIdentities('c0'),
    })).toEqual({ related: 2, total: 2 });
    restored.markRead('c0', 10);
    expect([...restored.acknowledgedReadIdentities('c0')]).toEqual([]);
    expect(unreadCounts(state, restored.read('c0'), 'me', {
      acknowledged: restored.acknowledgedReadIdentities('c0'),
    })).toEqual({ related: 2, total: 2 });
  });

  it('separates @me unread messages from the weak all-message count', () => {
    const state = { rows: new Map([
      [1, { id: 'old', kind: 'request', visibility: 'public', audience: ['me'], sender: { id: 'agent' } }],
      [2, { id: 'system-noise', kind: 'request', visibility: 'public', audience: [], sender: { id: 'system' } }],
      [3, { id: 'ask-me', kind: 'request', visibility: 'public', audience: ['me'], sender: { id: 'agent' } }],
      [4, { id: 'reply-to-me', kind: 'response', parent_id: 'ask-me', visibility: 'system', audience: ['me'], payload: { status: 'completed' }, sender: { id: 'system' } }],
      [5, { id: 'mine', kind: 'request', visibility: 'public', audience: ['agent'], sender: { id: 'me' } }],
    ]) };

    expect(unreadCounts(state, 1, 'me')).toEqual({ related: 1, total: 2 });
    expect(unreadCounts(state, 2, 'me')).toEqual({ related: 1, total: 1 });
  });

  it('waits for terminal user content from an agent self-audience task', () => {
    const agent = { id: 'agent:steward:1', kind: 'agent' };
    const state = createChannelState('c0');
    const request = { id: 'peer-task', kind: 'request', type: 'agent.ask', audience: [agent.id], sender: agent, correlation_id: 'peer-task' };
    const queued = { id: 'peer-task-queued', kind: 'response', type: 'agent.ask', parent_id: 'peer-task', correlation_id: 'peer-task', audience: [agent.id], sender: agent, payload: { status: 'queued' } };
    const processing = { id: 'peer-task-processing', kind: 'response', type: 'agent.ask', parent_id: 'peer-task', correlation_id: 'peer-task', audience: [agent.id], sender: agent, payload: { status: 'processing' } };
    const progress = { ...processing, id: 'peer-task-progress', payload: { status: 'processing', process: { kind: 'stage' } } };
    const completed = { id: 'peer-task-done', kind: 'response', type: 'agent.ask', parent_id: 'peer-task', correlation_id: 'peer-task', audience: [agent.id], sender: agent, payload: { status: 'completed', text: 'finished work' } };

    apply(state, { channel_id: 'c0', seq: 1, envelope: request }, 'human:root:1');
    apply(state, { channel_id: 'c0', seq: 2, envelope: queued }, 'human:root:1');
    expect(unreadCounts(state, 0, 'human:root:1')).toEqual({ related: 0, total: 0 });

    apply(state, { channel_id: 'c0', seq: 3, envelope: processing }, 'human:root:1');
    expect(unreadCounts(state, 2, 'human:root:1')).toEqual({ related: 0, total: 0 });
    expect(unreadCount(state, 0, 'human:root:1')).toBe(0);
    apply(state, { channel_id: 'c0', seq: 4, envelope: progress }, 'human:root:1');
    expect(unreadCounts(state, 3, 'human:root:1')).toEqual({ related: 0, total: 0 });

    apply(state, { channel_id: 'c0', seq: 5, envelope: completed }, 'human:root:1');
    expect(unreadCounts(state, 3, 'human:root:1')).toEqual({ related: 0, total: 1 });

    const acknowledgementOnly = createChannelState('c0');
    apply(acknowledgementOnly, { channel_id: 'c0', seq: 1, envelope: request }, 'human:root:1');
    const statusOnly = { ...completed, payload: { status: 'completed', detail: 'internal metadata' } };
    apply(acknowledgementOnly, { channel_id: 'c0', seq: 2, envelope: statusOnly }, 'human:root:1');
    expect(unreadCounts(acknowledgementOnly, 0, 'human:root:1')).toEqual({ related: 0, total: 0 });
    expect(recordLiveTimelineArrival(acknowledgementOnly, statusOnly, 2, 'human:root:1')).toBeNull();
  });

  it('never turns browser ui operation streams or system narration into rail notifications', () => {
    const state = createChannelState('c0');
    const uiRequest = {
      id: 'ui-op', kind: 'request', type: 'ui.state', visibility: 'public',
      sender: { id: 'agent:steward:1', kind: 'agent' }, audience: ['human:root:1'], payload: {},
    };
    const narration = {
      id: 'system-narration', kind: 'request', type: 'system.member.created', visibility: 'system',
      sender: { id: 'system', kind: 'system' }, audience: [], payload: {},
    };
    const uiResponse = {
      id: 'ui-op-done', kind: 'response', parent_id: 'ui-op', visibility: 'public',
      sender: { id: 'human:root:2', kind: 'human' }, audience: ['agent:steward:1'],
      payload: { status: 'completed' },
    };
    apply(state, { channel_id: 'c0', seq: 1, envelope: uiRequest }, 'human:root:1');
    apply(state, { channel_id: 'c0', seq: 2, envelope: narration }, 'human:root:1');
    apply(state, { channel_id: 'c0', seq: 3, envelope: uiResponse }, 'human:root:1');

    expect(unreadCounts(state, 0, 'human:root:1')).toEqual({ related: 0, total: 0 });
    expect(unreadCountDiagnostics(state, 0, 'human:root:1').rows).toEqual([
      expect.objectContaining({ id: 'ui-op-done', ackReason: 'self' }),
      expect.objectContaining({ id: 'system-narration', ackReason: 'system_narration' }),
      expect.objectContaining({ id: 'ui-op', ackReason: 'ui_protocol' }),
    ]);
  });

  it('does not turn this human own request entering processing into a new notification', () => {
    const state = createChannelState('c0');
    const request = {
      id: 'mine', kind: 'request', type: 'agent.ask', visibility: 'public',
      sender: { id: 'human:root:1', kind: 'human' }, audience: ['agent:steward:1'], payload: {},
    };
    const processing = {
      id: 'mine-processing', kind: 'response', type: 'agent.ask', parent_id: 'mine', visibility: 'public',
      sender: { id: 'agent:steward:1', kind: 'agent' }, audience: ['human:root:1'],
      payload: { status: 'processing' },
    };
    apply(state, { channel_id: 'c0', seq: 1, envelope: request }, 'human:root:1');
    apply(state, { channel_id: 'c0', seq: 2, envelope: processing }, 'human:root:1');

    expect(unreadCounts(state, 0, 'human:root:1')).toEqual({ related: 0, total: 0 });
    expect(recordLiveTimelineArrival(state, processing, 2, 'human:root:1')).toBeNull();
  });

  it('treats an earlier incarnation as this human for rail and viewport notices', () => {
    const state = createChannelState('c0');
    const historicalSelfRequest = {
      id: 'mine-before-restart', kind: 'request', type: 'human.note', visibility: 'public',
      sender: { id: 'human:root:1700000000000', kind: 'human' },
      audience: ['agent:steward:1'], payload: { text: 'sent from my earlier session' },
    };
    apply(state, { channel_id: 'c0', seq: 1, envelope: historicalSelfRequest }, 'human:root:1900000000000');

    expect(unreadCounts(state, 0, 'human:root:1900000000000')).toEqual({ related: 0, total: 0 });
    expect(recordLiveTimelineArrival(state, historicalSelfRequest, 1, 'human:root:1900000000000')).toBeNull();
  });

  it('does not notify for a terminal that leaves no canonical conversation row', () => {
    const state = createChannelState('c0');
    const request = {
      id: 'replaced', kind: 'request', type: 'agent.ask', visibility: 'public',
      sender: { id: 'agent:steward:1', kind: 'agent' }, audience: ['agent:worker:1'], payload: {},
    };
    const terminal = {
      id: 'replaced-done', kind: 'response', type: 'agent.ask', parent_id: 'replaced', visibility: 'public',
      sender: { id: 'agent:worker:1', kind: 'agent' }, audience: ['agent:steward:1'],
      payload: { status: 'completed', replaced_by: 'successor' },
    };
    apply(state, { channel_id: 'c0', seq: 1, envelope: request }, 'human:root:1');
    apply(state, { channel_id: 'c0', seq: 2, envelope: terminal }, 'human:root:1');

    expect(unreadCounts(state, 0, 'human:root:1')).toEqual({ related: 0, total: 0 });
    expect(recordLiveTimelineArrival(state, terminal, 2, 'human:root:1')).toBeNull();
  });

  it('keeps canonical timer activity visible without turning wake transport into unread content', () => {
    const agent = { id: 'agent:steward:1', kind: 'agent' };
    const state = { rows: new Map([
      [1, { id: 'timer:t1', kind: 'event', type: 'standup', audience: [agent.id], sender: agent, correlation_id: 'timer:t1' }],
      [2, { id: 'timer-wake', kind: 'request', type: 'agent.timer.wake', parent_id: 'timer:t1', correlation_id: 'timer:t1', audience: [agent.id], sender: agent }],
      [3, { id: 'timer-done', kind: 'response', type: 'agent.timer.wake', parent_id: 'timer-wake', correlation_id: 'timer:t1', audience: [agent.id], sender: agent, payload: { status: 'completed' } }],
    ]) };

    expect(unreadCounts(state, 0, 'human:root:1')).toEqual({ related: 0, total: 0 });

    const readableResult = { ...state.rows.get(3), id: 'timer-readable-result', payload: { status: 'completed', text: 'Scheduled work finished' } };
    const resultState = { rows: new Map([...state.rows].slice(0, 2).concat([[4, readableResult]])) };
    expect(unreadCounts(resultState, 0, 'human:root:1')).toEqual({ related: 1, total: 1 });

    const structuredResult = { ...readableResult, id: 'timer-structured-result', payload: { status: 'completed', value: { answer: 42 } } };
    const structuredState = { rows: new Map([...state.rows].slice(0, 2).concat([[4, structuredResult]])) };
    expect(unreadCounts(structuredState, 0, 'human:root:1')).toEqual({ related: 1, total: 1 });

    const failedResult = { ...readableResult, id: 'timer-failed-result', payload: { status: 'failed', error_code: 'boom', detail: 'failed visibly' } };
    const failedState = { rows: new Map([...state.rows].slice(0, 2).concat([[4, failedResult]])) };
    expect(unreadCounts(failedState, 0, 'human:root:1')).toEqual({ related: 1, total: 1 });
  });

  it('counts requests and protocol-final answers but ignores every provisional/unknown response status', () => {
    const state = { rows: new Map([
      [1, { id: 'request', kind: 'request', audience: ['me'], sender: { id: 'agent' } }],
      [2, { id: 'queued', kind: 'response', parent_id: 'request', audience: ['me'], payload: { status: 'queued' }, sender: { id: 'agent' } }],
      [3, { id: 'processing', kind: 'response', parent_id: 'request', audience: ['me'], payload: { status: 'processing', process: { kind: 'stage' } }, sender: { id: 'agent' } }],
      [4, { id: 'business-event', kind: 'event', audience: ['me'], sender: { id: 'agent' } }],
      [5, { id: 'completed', kind: 'response', parent_id: 'request', audience: ['me'], payload: { status: 'completed' }, sender: { id: 'agent' } }],
      [6, { id: 'failed', kind: 'response', parent_id: 'request', audience: ['me'], payload: { status: 'failed' }, sender: { id: 'agent' } }],
      [7, { id: 'business-progress', kind: 'response', parent_id: 'business-root', audience: ['me'], payload: { status: 'provider.waiting' }, sender: { id: 'agent' } }],
      [8, { id: 'missing-status', kind: 'response', parent_id: 'missing-root', audience: ['me'], payload: { detail: 'still working' }, sender: { id: 'agent' } }],
      [9, { id: 'unknown-status', kind: 'response', parent_id: 'unknown-root', audience: ['me'], payload: { status: 'streaming' }, sender: { id: 'agent' } }],
    ]) };

    expect(unreadCounts(state, 0, 'me')).toEqual({ related: 1, total: 1 });
  });

  it('keeps a final answer as new content after its request was already read', () => {
    const state = { rows: new Map([
      [1, { id: 'mine', kind: 'request', audience: ['agent'], sender: { id: 'me' } }],
      [2, { id: 'answer', kind: 'response', parent_id: 'mine', audience: ['me'], payload: { status: 'completed', text: 'answer' }, sender: { id: 'agent' } }],
    ]) };

    expect(unreadCounts(state, 1, 'me')).toEqual({ related: 1, total: 1 });
  });

  it('does not re-notify for a conflicting terminal after the canonical answer was acknowledged', () => {
    const state = createChannelState('c0');
    const request = { id: 'root', kind: 'request', type: 'agent.ask', audience: ['agent'], sender: { id: 'me' } };
    const completed = { id: 'answer', kind: 'response', type: 'agent.ask', parent_id: 'root', audience: ['me'], sender: { id: 'agent' }, payload: { status: 'completed', text: 'answer' } };
    const conflict = { id: 'conflict', kind: 'response', type: 'agent.ask', parent_id: 'root', audience: ['me'], sender: { id: 'agent' }, payload: { status: 'failed', reason: 'late' } };
    apply(state, { channel_id: 'c0', seq: 1, envelope: request }, 'me');
    apply(state, { channel_id: 'c0', seq: 2, envelope: completed }, 'me');
    apply(state, { channel_id: 'c0', seq: 3, envelope: conflict }, 'me');
    expect(unreadCounts(state, 0, 'me', {
      acknowledged: new Map([['root', 2]]),
    })).toEqual({ related: 0, total: 0 });
  });

  it('fails closed for business-progress, missing, and unknown response statuses in both unread APIs', () => {
    const state = { rows: new Map([
      [1, { id: 'business-progress', kind: 'response', parent_id: 'business-root', audience: ['me'], payload: { status: 'provider.waiting' }, sender: { id: 'agent' } }],
      [2, { id: 'missing-status', kind: 'response', parent_id: 'missing-root', audience: ['me'], payload: { detail: 'still working' }, sender: { id: 'agent' } }],
      [3, { id: 'unknown-status', kind: 'response', parent_id: 'unknown-root', audience: ['me'], payload: { status: 'streaming' }, sender: { id: 'agent' } }],
    ]) };

    expect(unreadCount(state, 0, 'me')).toBe(0);
    expect(unreadCounts(state, 0, 'me')).toEqual({ related: 0, total: 0 });
  });

  it('does not notify for control turns hidden from the timeline', () => {
    const state = { rows: new Map([
      [1, { id: 'context', type: 'agent.context', kind: 'request', audience: ['agent'], sender: { id: 'me' } }],
      [2, { id: 'context-done', type: 'agent.context', kind: 'response', parent_id: 'context', audience: ['me'], payload: { status: 'completed' }, sender: { id: 'agent' } }],
    ]) };
    expect(unreadCounts(state, 0, 'me')).toEqual({ related: 0, total: 0 });
  });

  it('counts one notification per root turn even when several child frames settle', () => {
    const state = { rows: new Map([
      [1, { id: 'root', kind: 'request', audience: ['agent'], sender: { id: 'me' } }],
      [2, { id: 'child', kind: 'request', parent_id: 'root', audience: ['worker'], sender: { id: 'agent' } }],
      [3, { id: 'child-done', kind: 'response', parent_id: 'child', audience: ['agent'], payload: { status: 'completed' }, sender: { id: 'worker' } }],
      [4, { id: 'root-done', kind: 'response', parent_id: 'root', audience: ['me'], payload: { status: 'completed' }, sender: { id: 'agent' } }],
    ]) };
    expect(unreadCounts(state, 1, 'me')).toEqual({ related: 1, total: 1 });
  });

  it('exports bounded rail decisions without message bodies or credentials', () => {
    const state = { rows: new Map([
      [1, { id: 'mine', type: 'agent.ask', kind: 'request', sender: { id: 'me' }, payload: { text: 'private request' } }],
      [2, { id: 'root', type: 'agent.ask', kind: 'request', sender: { id: 'agent' }, audience: ['me'], payload: { text: 'private body' } }],
      [3, { id: 'progress', type: 'agent.ask', kind: 'response', parent_id: 'root', sender: { id: 'agent' }, payload: { status: 'processing', text: 'private progress' } }],
      [4, { id: 'done', type: 'agent.ask', kind: 'response', parent_id: 'root', sender: { id: 'agent' }, audience: ['me'], payload: { status: 'completed', text: 'private answer', token: 'secret' } }],
    ]) };

    const result = unreadCountDiagnostics(state, 0, 'me', {
      acknowledged: new Map([['root', 2]]),
    });
    expect(result.counts).toEqual({ related: 1, total: 1 });
    expect(result.rows).toEqual([
      { id: 'mine', type: 'agent.ask', kind: 'request', status: '', seq: 1, ackReason: 'self' },
      { id: 'root', type: 'agent.ask', kind: 'request', status: '', seq: 2, ackReason: 'exact_visible_ack' },
      { id: 'progress', type: 'agent.ask', kind: 'response', status: 'processing', seq: 3, ackReason: 'not_final' },
      { id: 'root', type: 'agent.ask', kind: 'response', status: 'completed', seq: 4, ackReason: 'counted_related' },
    ]);
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('deduplicates live terminal frames before their historical root is hydrated', () => {
    const terminal = (id) => ({
      id,
      kind: 'response',
      type: 'agent.ask',
      parent_id: 'request-late',
      correlation_id: 'request-late',
      sender: { id: 'agent' },
      audience: ['me'],
      payload: { status: 'completed', text: 'late answer' },
    });
    const state = createChannelState('c0');
    apply(state, { channel_id: 'c0', seq: 10, envelope: terminal('terminal-1') }, 'me');
    apply(state, { channel_id: 'c0', seq: 11, envelope: terminal('terminal-2') }, 'me');
    expect(unreadCounts(state, 9, 'me')).toEqual({ related: 1, total: 1 });
  });

  it('reuses the fold id index instead of rebuilding it for every unread projection', () => {
    const root = { id: 'root', kind: 'request', audience: ['agent'], sender: { id: 'me' } };
    const reply = { id: 'reply', kind: 'response', parent_id: 'root', audience: ['me'], payload: { status: 'completed', text: 'answer' }, sender: { id: 'agent' } };
    const rows = new Map([[1, root], [2, reply]]);
    rows.values = () => { throw new Error('unread projection rebuilt the id index'); };
    const state = {
      rows,
      _rowOrder: [1, 2],
      _envelopesById: new Map([[root.id, root], [reply.id, reply]]),
    };

    expect(unreadCounts(state, 0, 'me', { incremental: true })).toEqual({ related: 1, total: 1 });
  });

  it('reads only the cursor tail even when an older history page was inserted later', () => {
    const state = createChannelState('c0');
    const row = (seq) => ({
      channel_id: 'c0', seq,
      envelope: { id: `m-${seq}`, kind: 'request', visibility: 'public', sender: { id: 'other' } },
    });
    apply(state, row(100));
    apply(state, row(101));
    apply(state, row(1)); // history arrived after the live tail
    apply(state, row(102));
    const get = state.rows.get.bind(state.rows);
    let reads = 0;
    state.rows.get = (seq) => { reads += 1; return get(seq); };

    expect(unreadCount(state, 100, 'me')).toBe(2);
    expect(reads).toBe(2);
  });
});
