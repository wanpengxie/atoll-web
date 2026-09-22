import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createChannelReplicaStore,
  replicaFoldSignature,
  replicaRefold,
  setReplicaFoldAudit,
} from '../src/model/channel-replica.js';

const CHANNEL = 'c0';

function request(id, { parent = '', correlation = '', system = false } = {}) {
  return {
    id, kind: 'request', type: 'agent.ask',
    ...(parent ? { parent_id: parent } : {}),
    ...(correlation ? { correlation_id: correlation } : {}),
    ...(system ? { visibility: 'system' } : {}),
    sender: { id: 'human:root:1' },
    payload: { body: { text: id } },
  };
}

function response(id, parent, status) {
  return {
    id, kind: 'response', parent_id: parent, type: 'agent.ask',
    sender: { id: 'agent:claude:1' },
    payload: { body: { status } },
  };
}

function event(id) {
  return { id, kind: 'event', type: 'human.message', sender: { id: 'human:root:1' }, payload: { text: id } };
}

function narration(id) {
  return { id, kind: 'event', type: 'channel.member.created', visibility: 'system', payload: { actor_id: id } };
}

// A row set that deliberately contains every shape the incremental fold has a
// separate branch for, including the ones that only appear out of order:
// response-before-request, a parent admitted after its child, a chain three
// deep so adoption has to cascade, and a correlation that points at a request
// which is itself not a root.
function rowSet() {
  const envelopes = [
    request('root-a'),
    response('a-progress', 'root-a', 'working'),
    response('a-final', 'root-a', 'completed'),
    request('child-a1', { parent: 'root-a' }),
    response('a1-final', 'child-a1', 'completed'),
    request('grandchild-a', { parent: 'child-a1' }),
    response('grandchild-final', 'grandchild-a', 'completed'),
    request('corr-to-child', { correlation: 'child-a1' }),
    response('corr-progress', 'corr-to-child', 'working'),
    request('root-b'),
    request('child-b1', { parent: 'root-b' }),
    request('child-b2', { parent: 'root-b' }),
    response('b2-final', 'child-b2', 'failed'),
    request('orphan-parent-late', { parent: 'root-c' }),
    request('root-c'),
    response('orphan-first', 'root-d', 'completed'),
    request('root-d'),
    request('sys-request', { system: true }),
    narration('member-1'),
    narration('member-2'),
    event('standalone-1'),
    event('standalone-2'),
    response('unparented', '', 'completed'),
  ];
  return envelopes.map((envelope, index) => ({ channel_id: CHANNEL, seq: index + 1, envelope }));
}

function foldOf(rows) {
  const replica = createChannelReplicaStore();
  for (const row of rows) replica.commit(row, 'human:root:1', (value) => value, { source: 'live' });
  return replicaFoldSignature(replica.state(CHANNEL));
}

describe('incremental fold equals the authoritative fold', () => {
  it('agrees with a full rebuild under every arrival order', () => {
    const rows = rowSet();
    const ledgerOrder = foldOf(rows);
    fc.assert(fc.property(fc.shuffledSubarray(rows, { minLength: rows.length }), (shuffled) => {
      // The audit throws inside commit the moment the two folds disagree, so
      // this also asserts every intermediate state, not only the final one.
      expect(foldOf(shuffled)).toBe(ledgerOrder);
    }), { numRuns: 400 });
  });

  it('agrees on arbitrary prefixes, so a partially delivered channel folds the same either way', () => {
    const rows = rowSet();
    fc.assert(fc.property(
      fc.shuffledSubarray(rows, { minLength: 1 }),
      (subset) => {
        const byLedgerOrder = [...subset].sort((left, right) => left.seq - right.seq);
        expect(foldOf(subset)).toBe(foldOf(byLedgerOrder));
      },
    ), { numRuns: 400 });
  });

  it('keeps turn identity stable across a response that reopens an existing entry', () => {
    const replica = createChannelReplicaStore();
    replica.commit({ channel_id: CHANNEL, seq: 1, envelope: request('r') });
    const before = replica.state(CHANNEL).timeline[0];
    replica.commit({ channel_id: CHANNEL, seq: 2, envelope: response('p', 'r', 'working') });
    expect(replica.state(CHANNEL).timeline[0]).toBe(before);
    expect(before.turn.provisional).toHaveLength(1);
  });

  it('keeps the timeline array identity so Presentation never re-keys its rows', () => {
    const replica = createChannelReplicaStore();
    replica.commit({ channel_id: CHANNEL, seq: 1, envelope: request('r') });
    const timeline = replica.state(CHANNEL).timeline;
    for (const row of rowSet()) {
      replica.commit({ ...row, seq: row.seq + 100 }, '', (value) => value, { source: 'live' });
    }
    expect(replica.state(CHANNEL).timeline).toBe(timeline);
  });

  it('falls back to the authoritative fold after a trim retains closures', () => {
    const replica = createChannelReplicaStore();
    for (const row of rowSet()) replica.commit(row);
    const trimmed = replica.trim(CHANNEL, 6);
    expect(trimmed).toBeGreaterThan(0);
    const state = replica.state(CHANNEL);
    const afterTrim = replicaFoldSignature(state);
    replica.commit({ channel_id: CHANNEL, seq: 500, envelope: request('post-trim') });
    expect(replicaFoldSignature(state)).not.toBe(afterTrim);
    expect(state.timeline.some((entry) => entry.turn?.requestId === 'post-trim')).toBe(true);
  });
});

// A generated row set, so coverage is not limited to the shapes one author
// thought to write down. Each envelope points at an id drawn from the ids that
// precede it in the generator — which, once the ledger order is shuffled, means
// the pointer target can be admitted before, after, or never relative to the
// row that points at it.
const generatedRows = fc.array(
  fc.record({
    kind: fc.constantFrom('request', 'request', 'request', 'response', 'response', 'event', 'narration', 'system-request'),
    link: fc.nat({ max: 11 }),
    linkKind: fc.constantFrom('parent', 'correlation'),
    status: fc.constantFrom('working', 'completed', 'failed', 'progress'),
    dangling: fc.boolean(),
  }),
  { minLength: 1, maxLength: 24 },
).map((specs) => specs.map((spec, index) => {
  const id = `n${index}`;
  const target = spec.dangling ? `absent-${spec.link}` : `n${spec.link}`;
  const linked = target === id ? '' : target;
  let envelope;
  if (spec.kind === 'response') envelope = response(id, linked, spec.status);
  else if (spec.kind === 'event') envelope = event(id);
  else if (spec.kind === 'narration') envelope = narration(id);
  else if (spec.kind === 'system-request') envelope = request(id, { system: true, parent: linked });
  else envelope = request(id, spec.linkKind === 'parent' ? { parent: linked } : { correlation: linked });
  return { channel_id: CHANNEL, seq: index + 1, envelope };
}));

describe('incremental fold equals the authoritative fold on generated graphs', () => {
  it('agrees for arbitrary request/response graphs in arbitrary arrival order', () => {
    fc.assert(fc.property(
      generatedRows.chain((rows) => fc.tuple(
        fc.constant(rows),
        fc.shuffledSubarray(rows, { minLength: rows.length }),
      )),
      ([rows, shuffled]) => {
        expect(foldOf(shuffled)).toBe(foldOf(rows));
      },
    ), { numRuns: 1_500 });
  });

  it('agrees for arbitrary partial deliveries of those graphs', () => {
    fc.assert(fc.property(
      generatedRows.chain((rows) => fc.shuffledSubarray(rows, { minLength: 1 })),
      (subset) => {
        const byLedgerOrder = [...subset].sort((left, right) => left.seq - right.seq);
        expect(foldOf(subset)).toBe(foldOf(byLedgerOrder));
      },
    ), { numRuns: 1_500 });
  });
});

// Trimming is the only way a channel acquires retained terminal closures, and
// merging those back is the one part of the fold with no local form. The audit
// cannot cover it — the incremental path declines to run at all once closures
// exist — so this asserts the decline directly: whatever the replica reached
// through trim-then-commit must still equal a fold derived from `rows` alone.
describe('a trimmed replica keeps agreeing with the authoritative fold', () => {
  it('agrees after arbitrary trim points and continued arrivals', () => {
    fc.assert(fc.property(
      fc.record({
        rows: generatedRows,
        trimTo: fc.integer({ min: 1, max: 12 }),
        trimAt: fc.integer({ min: 1, max: 24 }),
      }),
      ({ rows, trimTo, trimAt }) => {
        const replica = createChannelReplicaStore();
        rows.forEach((row, index) => {
          replica.commit(row, '', (value) => value, { source: 'history' });
          if (index + 1 === trimAt) replica.trim(CHANNEL, trimTo);
        });
        // A history page re-delivering a request whose terminal was trimmed is
        // exactly the shape the retained closures exist for.
        for (const row of rows) {
          replica.commit({ ...row, seq: row.seq + 1_000 }, '', (value) => value, { source: 'history' });
        }
        const state = replica.state(CHANNEL);
        if (!state) return;
        const reached = replicaFoldSignature(state);
        expect(replicaRefold(state)).toBe(reached);
      },
    ), { numRuns: 1_500 });
  });
});

describe('incremental fold cost does not grow with channel length', () => {
  it('stays sub-quadratic from 1k to 20k rows', () => {
    const restore = setReplicaFoldAudit(false);
    try {
      const measure = (rows) => {
        const replica = createChannelReplicaStore();
        const started = performance.now();
        for (let index = 1; index <= rows; index += 1) {
          const half = index % 2 === 0;
          replica.commit({
            channel_id: CHANNEL,
            seq: index,
            envelope: half
              ? response(`resp-${index}`, `req-${index - 1}`, 'completed')
              : request(`req-${index}`),
          }, '', (value) => value, { source: 'live' });
        }
        expect(replica.state(CHANNEL).rows.size).toBe(rows);
        return performance.now() - started;
      };
      measure(1_000);
      const small = Math.max(measure(5_000), 1);
      const large = measure(20_000);
      // A full rebuild per row would make 4x the rows cost ~16x the time and
      // would not finish 20k inside this budget at all.
      expect(large).toBeLessThan(4_000);
      expect(large / small).toBeLessThan(10);
    } finally {
      setReplicaFoldAudit(restore);
    }
  }, 60_000);
});
