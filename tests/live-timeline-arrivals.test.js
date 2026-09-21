import { describe, expect, it } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import {
  acknowledgeLiveTimelineArrivals,
  LIVE_ARRIVAL_RECEIPT,
} from '../src/model/live-arrivals.js';

// Successor coverage for the deleted tests/timeline-agent-activity.test.jsx case
// "balances consumers without treating A→B→A replacement as visible-arrival
// acknowledgement". The old test drove this through <Timeline> mount/unmount on
// fold.js's raw `_liveArrivalConsumers` counter; the canonical owner of this fact
// is now channel-replica.js's `arrivalReceipts` port (attachTimelineConsumer /
// timeline() / dispatch), consumed by useTimelineArrivalReceipt in
// src/ui/timeline/useLiveArrivalReceipts.js. This file exercises that port
// directly, mirroring the sibling tests/live-presentation-arrivals.test.js style.

// human.approve (unlike agent.ask/agent.queue) is a person-presented request
// disposition, not a queued task ask, so it exercises notificationDisposition's
// 'request' branch and is viewport-notifiable.
function request(id, sender = 'agent', audience = ['me']) {
  return {
    id, kind: 'request', type: 'human.approve', sender: { id: sender }, audience,
    payload: { body: { text: id } },
  };
}

function liveRow(channelId, seq, envelope) {
  return { source: 'live', generation: 1, channel_id: channelId, seq, envelope };
}

describe('live timeline arrival receipts', () => {
  it('preserves an unacknowledged arrival across a consumer detach and does not treat remount as acknowledgement', () => {
    const replica = createChannelReplicaStore();
    const tokenA1 = Symbol('timeline-a-1');
    const stateA = replica.ensure('c0').state;
    const detachA1 = stateA.arrivalReceipts.attachTimelineConsumer(tokenA1);

    replica.commit(liveRow('c0', 1, request('a-live')), 'me', (value) => value, { source: 'live' });
    expect(stateA.arrivalReceipts.timeline()).toMatchObject({
      revision: 1,
      acknowledgedRevision: 0,
      events: [{ revision: 1, rowID: 'a-live' }],
    });

    // Leaving the channel (component unmount / channel switch) is lifecycle
    // bookkeeping, not evidence the row was seen. Detach must not clear the log.
    detachA1();
    expect(stateA.arrivalReceipts.timeline()).toMatchObject({
      revision: 1,
      acknowledgedRevision: 0,
      events: [{ revision: 1, rowID: 'a-live' }],
    });

    // Switching to a second channel attaches an independent consumer; it must
    // not disturb the still-pending backlog left behind on the first channel.
    const stateB = replica.ensure('c1').state;
    const tokenB = Symbol('timeline-b');
    const detachB = stateB.arrivalReceipts.attachTimelineConsumer(tokenB);
    replica.commit(liveRow('c1', 1, request('b-live')), 'me', (value) => value, { source: 'live' });
    expect(stateB.arrivalReceipts.timeline().events).toEqual([{ revision: 1, rowID: 'b-live', key: 'b-live', seq: 1 }]);
    expect(stateA.arrivalReceipts.timeline().events).toEqual([{ revision: 1, rowID: 'a-live', key: 'a-live', seq: 1 }]);
    detachB();

    // Returning to A (re-attaching a fresh consumer token, as a remounted
    // component would) must not itself acknowledge anything either.
    const tokenA2 = Symbol('timeline-a-2');
    const detachA2 = stateA.arrivalReceipts.attachTimelineConsumer(tokenA2);
    expect(stateA.arrivalReceipts.timeline()).toMatchObject({
      revision: 1,
      acknowledgedRevision: 0,
      events: [{ revision: 1, rowID: 'a-live' }],
    });

    // Only an explicit receipt (the reading adapter reporting the exact
    // installed/visible identity) may dispose the backlog.
    const command = acknowledgeLiveTimelineArrivals(1);
    expect(command).toEqual({ type: LIVE_ARRIVAL_RECEIPT.acknowledgeTimeline, throughRevision: 1 });
    expect(stateA.arrivalReceipts.dispatch(command)).toBe(1);
    expect(stateA.arrivalReceipts.timeline()).toMatchObject({ revision: 1, acknowledgedRevision: 1, events: [] });
    detachA2();
  });

  it('auto-clears a fresh notifiable arrival that nobody was ever watching, but never invents acknowledgement for an existing backlog', () => {
    const replica = createChannelReplicaStore();
    const state = replica.ensure('c0').state;

    // No consumer has ever attached and there is no pending backlog: a new
    // notifiable arrival is recorded and then immediately self-disposed so it
    // cannot accumulate unread state while nothing observes the channel.
    replica.commit(liveRow('c0', 1, request('unwatched')), 'me', (value) => value, { source: 'live' });
    expect(state.arrivalReceipts.timeline()).toMatchObject({ revision: 1, acknowledgedRevision: 1, events: [] });

    // A background/system envelope that is not viewport-notifiable for this
    // self id must not perturb the revision counters at all.
    replica.commit(liveRow('c0', 2, request('background', 'other', [])), 'me', (value) => value, { source: 'live' });
    expect(state.arrivalReceipts.timeline()).toMatchObject({ revision: 1, acknowledgedRevision: 1, events: [] });

    // Now attach a consumer and create a real backlog, then detach without an
    // explicit receipt: because a backlog already exists and is undisposed,
    // a later arrival while unwatched must NOT be auto-cleared out from under it.
    const token = Symbol('timeline');
    const detach = state.arrivalReceipts.attachTimelineConsumer(token);
    replica.commit(liveRow('c0', 3, request('pending')), 'me', (value) => value, { source: 'live' });
    expect(state.arrivalReceipts.timeline().events).toEqual([{ revision: 2, rowID: 'pending', key: 'pending', seq: 3 }]);
    detach();
    replica.commit(liveRow('c0', 4, request('while-unwatched')), 'me', (value) => value, { source: 'live' });
    expect(state.arrivalReceipts.timeline()).toMatchObject({
      revision: 3,
      acknowledgedRevision: 1,
      events: [
        { revision: 2, rowID: 'pending' },
        { revision: 3, rowID: 'while-unwatched' },
      ],
    });
  });

  it('keeps current Replica publication order and rejects a duplicate without a second arrival', () => {
    const replica = createChannelReplicaStore();
    const state = replica.ensure('c0').state;
    state.arrivalReceipts.attachTimelineConsumer(Symbol('timeline'));

    expect(replica.commit(liveRow('c0', 1, request('first')), 'me', (value) => value, { source: 'live' }).accepted).toBe(true);
    expect(replica.commit(liveRow('c0', 2, request('second')), 'me', (value) => value, { source: 'live' }).accepted).toBe(true);
    expect(replica.commit(liveRow('c0', 2, request('second-duplicate')), 'me', (value) => value, { source: 'live' }).accepted).toBe(false);

    expect(state.arrivalReceipts.timeline().events.map((event) => event.rowID)).toEqual(['first', 'second']);
    expect(state.arrivalReceipts.dispatch(acknowledgeLiveTimelineArrivals(1))).toBe(1);
    expect(state.arrivalReceipts.timeline().events.map((event) => event.rowID)).toEqual(['second']);
  });

  it('acknowledges only the observed sequence prefix when a later arrival shares the receipt revision', () => {
    const replica = createChannelReplicaStore();
    const state = replica.ensure('c0').state;
    state.arrivalReceipts.attachTimelineConsumer(Symbol('timeline'));

    replica.commit(liveRow('c0', 3, request('installed')), 'me', (value) => value, { source: 'live' });
    replica.commit(liveRow('c0', 5, request('later')), 'me', (value) => value, { source: 'live' });
    expect(state.arrivalReceipts.timeline().events.map((event) => event.rowID)).toEqual([
      'installed', 'later',
    ]);

    const installedReceipt = acknowledgeLiveTimelineArrivals(2, 3);
    expect(installedReceipt).toEqual({
      type: LIVE_ARRIVAL_RECEIPT.acknowledgeTimeline,
      throughRevision: 2,
      throughSeq: 3,
    });
    state.arrivalReceipts.dispatch(installedReceipt);
    expect(state.arrivalReceipts.timeline()).toMatchObject({
      acknowledgedRevision: 1,
      events: [{ revision: 2, rowID: 'later', seq: 5 }],
    });

    state.arrivalReceipts.dispatch(acknowledgeLiveTimelineArrivals(2, 5));
    expect(state.arrivalReceipts.timeline()).toMatchObject({
      acknowledgedRevision: 2,
      events: [],
    });
  });
});
