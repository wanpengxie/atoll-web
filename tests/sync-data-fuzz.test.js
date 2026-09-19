import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { cacheWorldMismatch, createPersistenceEpochFence, createSyncObligationCoordinator } from '../src/model/sync-session.js';

describe('sync data model properties', () => {
  it('does not publish when the observable obligation state is unchanged', async () => {
    const onChange = vi.fn();
    const coordinator = createSyncObligationCoordinator({
      probe: vi.fn(async (channelID) => ({ channel_id: channelID, head_seq: 0, local_head_seq: 0 })),
      catchup: vi.fn(async () => {}),
      onChange,
    });

    await coordinator.interest('c0');
    expect(onChange).toHaveBeenCalledTimes(1);

    coordinator.connection(false);
    coordinator.connection(false);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

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

  it('does not fulfill interest when only the head probe succeeded', async () => {
    let catchupAttempts = 0;
    const coordinator = createSyncObligationCoordinator({
      probe: async (channelID) => ({ channel_id: channelID, head_seq: 20, local_head_seq: 12 }),
      catchup: async () => {
        catchupAttempts += 1;
        if (catchupAttempts === 1) throw new Error('page failed');
      },
      setTimeoutImpl: () => 1,
      clearTimeoutImpl: () => {},
    });
    coordinator.connection(true);
    await coordinator.interest('c0');
    expect(coordinator.snapshot('c0')).toMatchObject({
      interestRevision: 1,
      probedRevision: 1,
      fulfilledRevision: 0,
      requiredRanges: [{ lowSeq: 13, highSeq: 20, purpose: 'focused-tail' }],
    });
    coordinator.connection(false);
    coordinator.connection(true);
    await vi.waitFor(() => expect(coordinator.snapshot('c0').fulfilledRevision).toBe(1));
    coordinator.destroy();
  });

  it('fulfills an authoritative empty head without waiting for a push', async () => {
    const catchup = vi.fn(async () => {});
    const coordinator = createSyncObligationCoordinator({
      probe: async (channelID) => ({ channel_id: channelID, head_seq: 0, local_head_seq: 0 }),
      catchup,
    });
    coordinator.connection(true);
    await coordinator.interest('empty');
    expect(catchup).toHaveBeenCalledWith('empty', expect.objectContaining({ head_seq: 0 }), {
      revision: 1,
      targetHead: 0,
      requiredRanges: [],
      signal: expect.any(AbortSignal),
    });
    expect(coordinator.snapshot('empty')).toMatchObject({
      interestRevision: 1,
      probedRevision: 1,
      fulfilledRevision: 1,
      targetHead: 0,
      requiredRanges: [],
    });
    coordinator.destroy();
  });

  it('re-probes a pending obligation when an old connection resolves after reconnect', async () => {
    let resolveOldProbe;
    let resolveFulfilled;
    const oldProbe = new Promise((resolve) => { resolveOldProbe = resolve; });
    const fulfilled = new Promise((resolve) => { resolveFulfilled = resolve; });
    const probe = vi.fn((channelID) => (
      probe.mock.calls.length === 1
        ? oldProbe
        : Promise.resolve({ channel_id: channelID, head_seq: 0, local_head_seq: 0 })
    ));
    const catchup = vi.fn(async () => {});
    const coordinator = createSyncObligationCoordinator({
      probe,
      catchup,
      onChange: (_channelID, state) => {
        if (state.fulfilledRevision === 1) resolveFulfilled();
      },
    });
    coordinator.connection(true);
    const firstAttempt = coordinator.interest('c0');
    await Promise.resolve();
    expect(probe).toHaveBeenCalledOnce();

    coordinator.connection(false);
    coordinator.connection(true);
    resolveOldProbe({ channel_id: 'c0', head_seq: 99, local_head_seq: 0 });
    await firstAttempt;
    await fulfilled;

    expect(probe).toHaveBeenCalledTimes(2);
    expect(catchup).toHaveBeenCalledOnce();
    expect(catchup.mock.calls[0][1]).toMatchObject({ head_seq: 0 });
    expect(coordinator.snapshot('c0')).toMatchObject({
      interestRevision: 1,
      probedRevision: 1,
      fulfilledRevision: 1,
      targetHead: 0,
    });
    coordinator.destroy();
  });

  it('disconnect aborts a non-settling probe so reconnect can own the obligation', async () => {
    let resolveFulfilled;
    const fulfilled = new Promise((resolve) => { resolveFulfilled = resolve; });
    const probe = vi.fn((channelID) => (
      probe.mock.calls.length === 1
        ? new Promise(() => {})
        : Promise.resolve({ channel_id: channelID, head_seq: 0, local_head_seq: 0 })
    ));
    const coordinator = createSyncObligationCoordinator({
      probe,
      catchup: vi.fn(async () => {}),
      onChange: (_channelID, state) => {
        if (state.fulfilledRevision === 1) resolveFulfilled();
      },
    });
    coordinator.connection(true);
    const retiredAttempt = coordinator.interest('c0');
    await vi.waitFor(() => expect(probe).toHaveBeenCalledOnce());

    coordinator.connection(false);
    coordinator.connection(true);

    await retiredAttempt;
    await fulfilled;
    expect(probe).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(coordinator.snapshot('c0')).toMatchObject({
      interestRevision: 1,
      fulfilledRevision: 1,
      running: false,
      error: '',
    }));
    coordinator.destroy();
  });

  it('does not let an old connection late catchup fulfill the replacement connection', async () => {
    let resolveOldCatchup;
    let resolveCatchupStarted;
    let resolveFulfilled;
    const oldCatchup = new Promise((resolve) => { resolveOldCatchup = resolve; });
    const catchupStarted = new Promise((resolve) => { resolveCatchupStarted = resolve; });
    const fulfilled = new Promise((resolve) => { resolveFulfilled = resolve; });
    const probe = vi.fn(async (channelID) => ({
      channel_id: channelID,
      head_seq: probe.mock.calls.length === 1 ? 9 : 0,
      local_head_seq: 0,
    }));
    const catchup = vi.fn(() => {
      if (catchup.mock.calls.length === 1) {
        resolveCatchupStarted();
        return oldCatchup;
      }
      return Promise.resolve();
    });
    const coordinator = createSyncObligationCoordinator({
      probe,
      catchup,
      onChange: (_channelID, state) => {
        if (state.fulfilledRevision === 1) resolveFulfilled();
      },
    });
    coordinator.connection(true);
    const firstAttempt = coordinator.interest('c0');
    await catchupStarted;

    coordinator.connection(false);
    coordinator.connection(true);
    resolveOldCatchup();
    await firstAttempt;
    await fulfilled;

    expect(probe).toHaveBeenCalledTimes(2);
    expect(catchup).toHaveBeenCalledTimes(2);
    expect(coordinator.snapshot('c0')).toMatchObject({
      interestRevision: 1,
      fulfilledRevision: 1,
      targetHead: 0,
      requiredRanges: [],
    });
    coordinator.destroy();
  });

  it('fences revoked admission, ignores its late probe, and resumes the pending interest after grant', async () => {
    let resolveRevokedProbe;
    let resolveFulfilled;
    const revokedProbe = new Promise((resolve) => { resolveRevokedProbe = resolve; });
    const fulfilled = new Promise((resolve) => { resolveFulfilled = resolve; });
    const probe = vi.fn((channelID) => (
      probe.mock.calls.length === 1
        ? revokedProbe
        : Promise.resolve({ channel_id: channelID, head_seq: 0, local_head_seq: 0 })
    ));
    const catchup = vi.fn(async () => {});
    const coordinator = createSyncObligationCoordinator({
      probe,
      catchup,
      onChange: (_channelID, state) => {
        if (state.fulfilledRevision === 1) resolveFulfilled();
      },
    });
    coordinator.admission(['c0'], { generation: 1 });
    coordinator.connection(true);
    const pending = coordinator.interest('c0');
    await Promise.resolve();
    expect(probe).toHaveBeenCalledOnce();

    coordinator.admission([], { generation: 2 });
    expect(coordinator.snapshot('c0')).toMatchObject({
      admitted: false, interestRevision: 1, fulfilledRevision: 0,
    });
    await pending;
    expect(probe).toHaveBeenCalledOnce();
    expect(catchup).not.toHaveBeenCalled();

    coordinator.admission(['c0'], { generation: 3 });
    await fulfilled;
    expect(probe).toHaveBeenCalledTimes(2);
    expect(catchup).toHaveBeenCalledOnce();
    resolveRevokedProbe({ channel_id: 'c0', head_seq: 99, local_head_seq: 0 });
    await Promise.resolve();
    expect(coordinator.snapshot('c0')).toMatchObject({
      admitted: true, interestRevision: 1, fulfilledRevision: 1, targetHead: 0,
    });
    coordinator.destroy();
  });

  it('blocks a current definitive denial without retry and fences an older denial from a restored grant', async () => {
    let rejectOldProbe;
    let resolveRestored;
    const oldProbe = new Promise((_resolve, reject) => { rejectOldProbe = reject; });
    const restored = new Promise((resolve) => { resolveRestored = resolve; });
    const probe = vi.fn((channelID) => (
      probe.mock.calls.length === 1
        ? oldProbe
        : Promise.resolve({ channel_id: channelID, head_seq: 0, local_head_seq: 0 })
    ));
    const onDefinitiveError = vi.fn();
    const coordinator = createSyncObligationCoordinator({
      probe,
      catchup: vi.fn(async () => {}),
      isDefinitiveError: (error) => error?.code === 'forbidden',
      onDefinitiveError,
      onChange: (_channelID, state) => {
        if (state.fulfilledRevision === 1) resolveRestored();
      },
    });
    coordinator.admission(['c0'], { generation: 1 });
    coordinator.connection(true);
    const oldAttempt = coordinator.interest('c0');
    await Promise.resolve();
    expect(probe).toHaveBeenCalledOnce();

    coordinator.admission([], { generation: 2 });
    coordinator.admission(['c0'], { generation: 3 });
    await restored;
    rejectOldProbe(Object.assign(new Error('forbidden'), { code: 'forbidden' }));
    await oldAttempt;
    await Promise.resolve();

    expect(onDefinitiveError).not.toHaveBeenCalled();
    expect(coordinator.snapshot('c0')).toMatchObject({
      admitted: true, fulfilledRevision: 1,
    });

    // The next current attempt is a definitive denial.
    probe.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { code: 'forbidden' }));
    const denied = coordinator.interest('c0');
    await denied;
    expect(onDefinitiveError).toHaveBeenCalledOnce();
    expect(coordinator.snapshot('c0')).toMatchObject({
      admitted: false, interestRevision: 2, fulfilledRevision: 1,
      retryAt: 0,
    });
    coordinator.destroy();
  });
});
