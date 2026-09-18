import { describe, expect, it } from 'vitest';
import {
  apply,
  createChannelState,
} from '../src/model/fold.js';
import {
  acknowledgeLivePresentationArrivals,
  livePresentationArrivals,
  recordLivePresentationArrival,
  registerLivePresentationArrivalConsumer,
} from '../src/model/live-arrivals.js';

function request(id, sender = 'agent') {
  return {
    id,
    kind: 'request',
    type: 'agent.ask',
    sender: { id: sender },
    audience: ['me'],
    payload: { body: { text: id } },
  };
}

describe('ephemeral live Presentation arrival provenance', () => {
  it('records only while a visual consumer exists and drops the backlog on release', () => {
    const state = createChannelState('c0');
    const beforeMount = request('before-mount');
    apply(state, { channel_id: 'c0', seq: 1, envelope: beforeMount }, 'me');
    expect(recordLivePresentationArrival(state, beforeMount, 1)).toBeNull();

    const release = registerLivePresentationArrivalConsumer(state, Symbol('timeline'));
    const live = request('live');
    apply(state, { channel_id: 'c0', seq: 2, envelope: live }, 'me');
    expect(recordLivePresentationArrival(state, live, 2)).toMatchObject({
      revision: 1,
      rowIDs: ['live'],
      sourceRevision: state._timelineRevision,
    });
    expect(livePresentationArrivals(state, state._timelineRevision).events).toHaveLength(1);

    release();
    expect(livePresentationArrivals(state, state._timelineRevision).events).toHaveLength(0);
    const afterRelease = request('after-release');
    apply(state, { channel_id: 'c0', seq: 3, envelope: afterRelease }, 'me');
    expect(recordLivePresentationArrival(state, afterRelease, 3)).toBeNull();
  });

  it('exposes and acknowledges only the prefix represented by a Presentation source revision', () => {
    const state = createChannelState('c0');
    registerLivePresentationArrivalConsumer(state, Symbol('timeline'));

    const first = request('first');
    apply(state, { channel_id: 'c0', seq: 1, envelope: first }, 'me');
    const firstEvent = recordLivePresentationArrival(state, first, 1);
    const firstSourceRevision = firstEvent.sourceRevision;

    const second = request('second');
    apply(state, { channel_id: 'c0', seq: 2, envelope: second }, 'me');
    const secondEvent = recordLivePresentationArrival(state, second, 2);
    expect(secondEvent.sourceRevision).toBeGreaterThan(firstSourceRevision);

    const firstCommit = livePresentationArrivals(state, firstSourceRevision);
    expect(firstCommit).toMatchObject({ revision: 1, headRevision: 2 });
    expect(firstCommit.events.map((event) => event.rowIDs[0])).toEqual(['first']);
    acknowledgeLivePresentationArrivals(state, firstCommit.revision);

    const secondCommit = livePresentationArrivals(state, secondEvent.sourceRevision);
    expect(secondCommit.events.map((event) => event.rowIDs[0])).toEqual(['second']);
    acknowledgeLivePresentationArrivals(state, secondCommit.revision);
    expect(livePresentationArrivals(state, secondEvent.sourceRevision).events).toEqual([]);
  });

  it('maps response candidates to both their stable root and exact envelope identity', () => {
    const state = createChannelState('c0');
    registerLivePresentationArrivalConsumer(state, Symbol('timeline'));
    const root = request('root', 'me');
    apply(state, { channel_id: 'c0', seq: 1, envelope: root }, 'me');
    const progress = {
      id: 'progress', kind: 'response', parent_id: 'root', sender: { id: 'agent' },
      payload: { body: { status: 'processing', text: 'still the same row' } },
    };
    apply(state, { channel_id: 'c0', seq: 2, envelope: progress }, 'me');
    expect(recordLivePresentationArrival(state, progress, 2)).toMatchObject({
      rowIDs: ['root', 'progress'],
    });
    // The journal is provenance only. Timeline's exact backInsertedIDs
    // intersection is what rejects this ordinary content update.
  });
});
