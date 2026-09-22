import { describe, expect, it } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import {
  acknowledgeLivePresentationArrivals,
  LIVE_ARRIVAL_RECEIPT,
} from '../src/model/live-arrivals.js';

function request(id, sender = 'agent') {
  return {
    id, kind: 'request', type: 'agent.ask', sender: { id: sender }, audience: ['me'],
    payload: { body: { text: id } },
  };
}

function liveRow(seq, envelope) {
  return { source: 'live', generation: 1, channel_id: 'c0', seq, envelope };
}

describe('live presentation arrival receipts', () => {
  it('records only while a presentation consumer exists and drops the backlog on release', () => {
    const replica = createChannelReplicaStore();
    replica.commit(liveRow(1, request('before-mount')), 'me', (value) => value, { source: 'live' });
    const state = replica.state('c0');
    expect(state.arrivalReceipts.presentation().events).toEqual([]);

    const release = state.arrivalReceipts.attachPresentationConsumer(Symbol('timeline'));
    replica.commit(liveRow(2, request('live')), 'me', (value) => value, { source: 'live' });
    expect(state.arrivalReceipts.presentation()).toMatchObject({
      revision: 1,
      headRevision: 1,
      events: [{ revision: 1, rowIDs: ['live'], sourceRevision: 2 }],
    });

    release();
    expect(state.arrivalReceipts.presentation().events).toEqual([]);
    replica.commit(liveRow(3, request('after-release')), 'me', (value) => value, { source: 'live' });
    expect(state.arrivalReceipts.presentation().events).toEqual([]);
  });

  it('exposes and acknowledges only the prefix represented by a source revision', () => {
    const replica = createChannelReplicaStore();
    const state = replica.ensure('c0').state;
    state.arrivalReceipts.attachPresentationConsumer(Symbol('timeline'));

    replica.commit(liveRow(1, request('first')), 'me', (value) => value, { source: 'live' });
    replica.commit(liveRow(2, request('second')), 'me', (value) => value, { source: 'live' });

    const firstCommit = state.arrivalReceipts.presentation(1);
    expect(firstCommit).toMatchObject({ revision: 1, headRevision: 2 });
    expect(firstCommit.events.map((event) => event.rowIDs[0])).toEqual(['first']);
    const command = acknowledgeLivePresentationArrivals(firstCommit.revision);
    expect(command).toEqual({
      type: LIVE_ARRIVAL_RECEIPT.acknowledgePresentation,
      throughRevision: 1,
    });
    expect(state.arrivalReceipts.dispatch(command)).toBe(1);

    const secondCommit = state.arrivalReceipts.presentation(2);
    expect(secondCommit.events.map((event) => event.rowIDs[0])).toEqual(['second']);
    expect(state.arrivalReceipts.dispatch(
      acknowledgeLivePresentationArrivals(secondCommit.revision),
    )).toBe(2);
    expect(state.arrivalReceipts.presentation(2).events).toEqual([]);
  });

  it('maps responses to both their stable root and exact envelope identity', () => {
    const replica = createChannelReplicaStore();
    const state = replica.ensure('c0').state;
    state.arrivalReceipts.attachPresentationConsumer(Symbol('timeline'));
    replica.commit(liveRow(1, request('root', 'me')), 'me', (value) => value, { source: 'live' });
    state.arrivalReceipts.dispatch(acknowledgeLivePresentationArrivals(1));

    const progress = {
      id: 'progress', kind: 'response', parent_id: 'root', sender: { id: 'agent' },
      payload: { body: { status: 'processing', text: 'still the same row' } },
    };
    replica.commit(liveRow(2, progress), 'me', (value) => value, { source: 'live' });
    expect(state.arrivalReceipts.presentation(2).events).toEqual([
      expect.objectContaining({ rowIDs: ['root', 'progress'], sourceRevision: 2 }),
    ]);
  });
});
