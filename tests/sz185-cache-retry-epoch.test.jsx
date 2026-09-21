// @vitest-environment jsdom

const cacheControl = vi.hoisted(() => ({ holdEnsureOwner: true, pending: [] }));

import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/model/channel-replica.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createChannelReplicaCache: (...args) => {
      const cache = actual.createChannelReplicaCache(...args);
      const ensureOwner = cache.ensureOwner.bind(cache);
      return Object.freeze({
        ...cache,
        ensureOwner: (...ensureArgs) => cacheControl.holdEnsureOwner
          ? new Promise((resolve, reject) => cacheControl.pending.push({ resolve, reject, ensureArgs }))
          : ensureOwner(...ensureArgs),
      });
    },
  };
});

const { createChannelFeedRuntime } = await import('../src/model/channel-feed-runtime.js');

function options() {
  return {
    wireRef: { current: null },
    rosterRef: { current: { self: () => '' } },
    accessRef: { current: { live: () => false } },
    activeChannelRef: { current: 'c0' },
    onError: vi.fn(),
    onChannelsDiscovered: vi.fn(),
    onDirectoryInvalidated: vi.fn(),
    onSubmissionFeed: vi.fn(),
    onAccessChanged: vi.fn(),
  };
}

describe('SZ-185 Feed retry principal epoch fence', () => {
  it('does not let a late pre-retry cache failure overwrite the successor', async () => {
    cacheControl.holdEnsureOwner = true;
    cacheControl.pending.splice(0);
    const feedOptions = options();
    const runtime = createChannelFeedRuntime(feedOptions);
    runtime.mount();
    try {
      const first = runtime.getSnapshot().prepareLocalReplica('sz185-principal', { focus: '' });
      await Promise.resolve();
      expect(cacheControl.pending).toHaveLength(1);

      cacheControl.holdEnsureOwner = false;
      const retry = runtime.getSnapshot().retryLocalReplica({ focus: '' });
      await expect(retry).resolves.toMatchObject({ resume: {} });
      expect(runtime.getSnapshot()).toMatchObject({
        localReplicaReady: true,
        localReplicaError: '',
        localReplicaErrorCode: '',
      });

      cacheControl.pending.shift().reject(Object.assign(new Error('late cache failure'), {
        code: 'cache_selection_timeout',
      }));
      await expect(first).resolves.toEqual({ resume: {} });
      expect(runtime.getSnapshot()).toMatchObject({
        localReplicaReady: true,
        localReplicaError: '',
        localReplicaErrorCode: '',
      });
      expect(feedOptions.onError).not.toHaveBeenCalled();
    } finally {
      for (const pending of cacheControl.pending.splice(0)) pending.reject(new Error('test cleanup'));
      runtime.destroy();
      cacheControl.holdEnsureOwner = true;
    }
  });
});
