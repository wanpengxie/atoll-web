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
