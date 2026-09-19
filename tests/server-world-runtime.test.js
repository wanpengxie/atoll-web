// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';

function options() {
  return {
    wireRef: { current: null },
    rosterRef: { current: { self: () => '', observeFeed: () => {}, handleEnvelope: () => {} } },
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

async function attach(runtime, generation, boot, entries = [{ channel_id: 'c0', head_seq: 1 }]) {
  return runtime.getSnapshot().setHistoryGrants(entries, { generation, boot });
}

function row(seq = 1) {
  return {
    channel_id: 'c0', seq, source: 'live',
    envelope: {
      id: `row-${seq}`, kind: 'event', type: 'human.note',
      sender: { id: 'human:root:1', kind: 'human' }, audience: [],
      payload: { text: 'world-bound row' },
    },
  };
}

describe('current server-world owner: ChannelFeedRuntime', () => {
  it('drops the prior replica when an established attach moves to a new server world', async () => {
    const runtime = createChannelFeedRuntime(options());
    runtime.mount();
    await runtime.getSnapshot().prepareLocalReplica(`root-world-${Date.now()}-${Math.random()}`);
    await attach(runtime, 1, 'boot-a');
    expect(runtime.getSnapshot().enqueue(row())).toBe(true);
    expect(runtime.getSnapshot().stateEntries()).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await attach(runtime, 2, 'boot-b');
    expect(runtime.getSnapshot().stateFor('c0')?.rows.size).toBe(0);
    expect(runtime.getSnapshot().stateFor('c0')?.timeline).toEqual([]);
    expect(runtime.getSnapshot().agentActivity.boot).toBe('boot-b');
    runtime.destroy();
  });

  it('publishes a new world epoch even when no channel projection was installed', async () => {
    const runtime = createChannelFeedRuntime(options());
    runtime.mount();
    expect((await attach(runtime, 1, 'boot-a', [])).changed).toBe(true);
    expect((await attach(runtime, 2, 'boot-b', [])).changed).toBe(true);
    expect(runtime.getSnapshot().stateEntries()).toEqual([]);
    expect(runtime.getSnapshot().agentActivity.boot).toBe('boot-b');
    runtime.destroy();
  });
});
