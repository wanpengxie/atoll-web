// @vitest-environment jsdom
//
// A frame with an absolute deadline states when it stops being worth asking.
// The outbox is built to retry under the original id until it succeeds, so
// once that instant passes the two contracts fight: the server refuses every
// retry for `expires_at <= ts` and the row is re-queued, forever.
import 'fake-indexeddb/auto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useComposerSubmissionRuntime } from '../src/ui/composer/useComposerSubmissionRuntime.js';
import { createOutboxStore } from '../src/model/outbox-store.js';

let serial = 0;

function harness({ submit = vi.fn().mockResolvedValue({ ok: true }) } = {}) {
  serial += 1;
  const principalId = `probe-root-${serial}`;
  const store = createOutboxStore({ databaseName: `probe-${serial}-${Date.now()}` });
  return {
    activeChannelId: 'c0',
    principalId,
    producerOwnerToken: `owner-${principalId}`,
    wireState: 'open',
    wireRef: { current: { submit } },
    accessRef: { current: { state: () => ({ relationship: 'member', existence: 'present', runtime: 'open', unavailable: false }) } },
    rosterRef: { current: { recordSubmission: vi.fn(), forgetSubmission: vi.fn() } },
    onError: vi.fn(),
    onNotice: vi.fn(),
    onFeedChanged: vi.fn(),
    onAccessChanged: vi.fn(),
    outboxFactory: () => store,
    store,
    submit,
  };
}

const probe = (messageId, expiresAtMs) => ({
  channelId: 'c0',
  messageId,
  text: '读取能力',
  msgType: 'actor.describe',
  audience: ['agent:worker:1'],
  expiresAtMs,
});

afterEach(() => { vi.restoreAllMocks(); });

describe('a submission carrying an absolute deadline', () => {
  it('is dropped at hydration, not left for a retry pass that skips its state', async () => {
    serial += 1;
    const principalId = `probe-root-restore-${serial}`;
    const store = createOutboxStore({ databaseName: `probe-restore-${serial}-${Date.now()}` });
    await store.putMany(principalId, [{
      key: 'restored-stale', messageId: 'restored-stale', channelId: 'c0',
      // A state the reconnect retry pass never visits.
      state: 'delayed', createdAt: 1, updatedAt: 1, error: null,
      frame: {
        id: 'restored-stale', channel_id: 'c0', msg_type: 'actor.describe', kind: 'request',
        payload: { text: '读取能力' }, audience: ['agent:worker:1'], visibility: 'public',
        expires_at_ms: Date.now() - 1,
      },
    }]);
    const submit = vi.fn().mockResolvedValue({ ok: true });
    const config = { ...harness({ submit }), principalId, outboxFactory: () => store };
    const { result } = renderHook(() => useComposerSubmissionRuntime(config));

    await waitFor(() => expect(result.current.pending).toEqual([]));
    expect(submit).not.toHaveBeenCalled();
    await waitFor(async () => expect(await store.restore(principalId)).toEqual([]));
    store.close();
  });

  it('is dropped rather than retried once its deadline has passed', async () => {
    const config = harness();
    const { result } = renderHook(() => useComposerSubmissionRuntime(config));
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await act(async () => {
      await result.current.send(probe('stale-probe', Date.now() - 1)).catch(() => {});
    });

    await waitFor(() => expect(result.current.pending).toEqual([]));
    expect(config.submit).not.toHaveBeenCalled();
    await waitFor(async () => expect(await config.store.restore(config.principalId)).toEqual([]));
    config.store.close();
  });

  it('is transmitted normally while its deadline is still ahead', async () => {
    const config = harness();
    const { result } = renderHook(() => useComposerSubmissionRuntime(config));
    await waitFor(() => expect(result.current.pending).toEqual([]));

    await act(async () => {
      await result.current.send(probe('live-probe', Date.now() + 60_000)).catch(() => {});
    });

    await waitFor(() => expect(config.submit).toHaveBeenCalled());
    config.store.close();
  });
});
