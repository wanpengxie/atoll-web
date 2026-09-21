import { describe, expect, it } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';

function row(channelId, seq) {
  return {
    channel_id: channelId,
    seq,
    envelope: { id: `${channelId}-${seq}`, kind: 'event', type: 'human.note', payload: { text: String(seq) } },
  };
}

describe('channel replica store', () => {
  it('[TC-0509][AD-215] is the single materialized owner for cache, history and live commits', () => {
    const store = createChannelReplicaStore();
    expect(store.commit(row('c0', 10), '').accepted).toBe(true);
    expect(store.commit(row('c0', 10), '').accepted).toBe(false);
    expect(store.commit(row('c0', 12), '').accepted).toBe(true);
    expect(store.state('c0').rows.size).toBe(2);
    expect(store.record('c0')).toMatchObject({
      revision: 2,
      materializedCoverage: [{ lowSeq: 10, highSeq: 10 }, { lowSeq: 12, highSeq: 12 }],
    });
  });

  it('keeps durable and materialized coverage as different facts', () => {
    const store = createChannelReplicaStore();
    store.installMeta('c0', { headSeq: 100, coverage: [{ lowSeq: 1, highSeq: 100 }] });
    store.commit(row('c0', 100));
    expect(store.record('c0')).toMatchObject({
      headSeq: 100,
      durableCoverage: [{ lowSeq: 1, highSeq: 100 }],
      materializedCoverage: [{ lowSeq: 100, highSeq: 100 }],
    });
  });
});
