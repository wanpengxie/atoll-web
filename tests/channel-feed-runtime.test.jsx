// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';

function runtimeOptions() {
  return {
    wireRef: { current: null },
    rosterRef: { current: { self: () => '', observeFeed: () => '', handleEnvelope: () => {} } },
    accessRef: { current: { live: () => false } },
    activeChannelRef: { current: 'c0' },
    onRoster: vi.fn(),
    onError: vi.fn(),
    onChannelsDiscovered: vi.fn(),
    onDirectoryInvalidated: vi.fn(),
    onTimerFired: vi.fn(),
    onSubmissionFeed: vi.fn(),
    onAccessChanged: vi.fn(),
    onAgentActivity: vi.fn(),
  };
}

describe('ChannelFeedRuntime ownership', () => {
  it('keeps owner-scoped command identities stable across store publications', () => {
    const options = runtimeOptions();
    const ownerToken = Object.freeze({ principalId: 'root' });
    const runtime = createChannelFeedRuntime(options);
    runtime.bind({ ...options, ownerToken });

    const first = runtime.getOwnerSnapshot(ownerToken);
    first.bump();
    const second = runtime.getOwnerSnapshot(ownerToken);

    expect(second).not.toBe(first);
    expect(second.version).toBeGreaterThan(first.version);
    expect(second.enqueue).toBe(first.enqueue);
    expect(second.liveCheckpoint).toBe(first.liveCheckpoint);
  });

  it('survives a StrictMode effect probe and terminally releases its owned data plane', async () => {
    const runtime = createChannelFeedRuntime(runtimeOptions());
    const cursors = runtime.getSnapshot().cursorsRef.current;
    cursors.selectReadAuthority({ principalId: 'root', serverBoot: 'boot-a' });
    expect(cursors.isReadAuthorityReady()).toBe(true);

    const releaseProbe = runtime.mount();
    releaseProbe();
    const releaseCommitted = runtime.mount();
    await Promise.resolve();
    expect(() => runtime.getSnapshot().clear()).not.toThrow();

    releaseCommitted();
    await Promise.resolve();
    expect(cursors.isReadAuthorityReady()).toBe(false);
    expect(runtime.getSnapshot().statesRef.current.size).toBe(0);
    expect(() => runtime.mount()).toThrow('ChannelFeedRuntime has been destroyed');
  });
});
