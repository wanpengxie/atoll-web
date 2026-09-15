import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { cacheWorldMismatch, createPersistenceEpochFence } from '../src/model/sync-session.js';

describe('sync data model properties', () => {
  it('fuzzes arbitrary live/history arrival order without duplicating Replica facts', () => {
    fc.assert(fc.property(
      fc.array(fc.integer({ min: 1, max: 500 }), { maxLength: 300 }),
      (sequence) => {
        const replica = createChannelReplicaStore();
        let accepted = 0;
        for (const seq of sequence) {
          const result = replica.commit({
            channel_id: 'c0',
            seq,
            envelope: {
              id: `m-${seq}`, kind: 'event', type: 'human.note',
              payload: { text: String(seq) },
            },
          });
          if (result.accepted) accepted += 1;
        }
        const expected = [...new Set(sequence)].sort((left, right) => left - right);
        const actual = [...(replica.state('c0')?.rows.keys() || [])].sort((left, right) => left - right);
        expect(actual).toEqual(expected);
        expect(replica.revision('c0')).toBe(expected.length);
        expect(accepted).toBe(expected.length);
      },
    ), { numRuns: 300 });
  });

  it('fuzzes persistence epochs so no write crosses the selected world fence', async () => {
    await fc.assert(fc.asyncProperty(
      fc.array(fc.array(fc.string({ maxLength: 12 }), { maxLength: 12 }), { minLength: 1, maxLength: 20 }),
      async (epochs) => {
        const fence = createPersistenceEpochFence();
        const observed = [];
        for (let index = 0; index < epochs.length; index += 1) {
          let release;
          const selected = new Promise((resolve) => { release = resolve; });
          fence.select(() => selected);
          const writes = epochs[index].map((value) => fence.run(({ version }) => {
            observed.push({ version, value });
          }));
          await Promise.resolve();
          expect(observed.filter((entry) => entry.version === index + 1)).toHaveLength(0);
          release();
          await Promise.all(writes);
        }
        expect(observed).toEqual(epochs.flatMap((values, index) => (
          values.map((value) => ({ version: index + 1, value }))
        )));
      },
    ), { numRuns: 150 });
  });

  it('fuzzes cache-world classification conservatively', () => {
    fc.assert(fc.property(
      fc.string(), fc.string(), fc.nat({ max: 100 }),
      (remoteBoot, cacheBoot, size) => {
        const meta = new Map(Array.from({ length: size }, (_, index) => [`c${index}`, {}]));
        expect(cacheWorldMismatch(remoteBoot, cacheBoot, meta)).toBe(Boolean(
          remoteBoot && size > 0 && cacheBoot !== remoteBoot,
        ));
      },
    ), { numRuns: 500 });
  });
});
