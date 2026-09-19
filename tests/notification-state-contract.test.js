// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { selectTimelineItems } from '../src/model/conversation-presentation.js';
import { notificationDisposition } from '../src/model/notification-policy.js';

afterEach(() => globalThis.localStorage?.clear());

let runtimeID = 0;

function runtimeOptions(selfId) {
  return {
    wireRef: { current: null },
    rosterRef: {
      current: {
        self: () => selfId,
        observeFeed: () => {},
        handleEnvelope: () => {},
      },
    },
    accessRef: { current: { live: () => false } },
    activeChannelRef: { current: 'c0.project' },
    onRoster: vi.fn(),
    onError: vi.fn(),
    onChannelsDiscovered: vi.fn(),
    onDirectoryInvalidated: vi.fn(),
    onSubmissionFeed: vi.fn(),
    onAccessChanged: vi.fn(),
  };
}

async function readyRuntime() {
  runtimeID += 1;
  const selfId = `human:notification-test:${runtimeID}`;
  const channelId = 'c0.project';
  const boot = `notification-boot-${runtimeID}`;
  const runtime = createChannelFeedRuntime(runtimeOptions(selfId));
  runtime.mount();
  await runtime.getSnapshot().prepareLocalReplica(selfId, { focus: channelId });
  await runtime.getSnapshot().setHistoryGrants(
    [{ channel_id: channelId, head_seq: 0 }],
    { generation: 1, boot },
  );
  return { runtime, channelId, selfId, boot };
}

function relatedRequest(channelId, id, selfId) {
  return {
    channel_id: channelId,
    source: 'live',
    envelope: {
      id,
      channel_id: channelId,
      kind: 'request',
      type: 'human.approve',
      sender: { kind: 'agent', id: 'agent:reviewer:1' },
      audience: [selfId],
      payload: { body: { text: 'approval required' } },
    },
  };
}

describe('notification confirmation contract', () => {
  it('commits a frozen backlog boundary after the mutable head advances', async () => {
    const { runtime, channelId, selfId, boot } = await readyRuntime();
    const feed = runtime.getSnapshot();
    feed.enqueue({ ...relatedRequest(channelId, 'approval-1', selfId), seq: 1 });
    const firstStatus = feed.historyFor(channelId);

    // A later arrival must not make the already-issued boundary invalid or
    // cause it to float to the later head.
    feed.enqueue({ ...relatedRequest(channelId, 'approval-2', selfId), seq: 2 });
    const confirmation = {
      authority: { principalId: selfId, serverBoot: boot, channelId },
      owner: {
        viewKey: `${channelId}:conversation`,
        activationID: 'activation-1',
        generation: firstStatus.generation,
      },
      captured: { presentationRevision: 1, sourceRevision: 1 },
      cause: 'tail-backlog',
      boundary: 1,
    };
    expect(feed.acknowledgeNotifications(confirmation)).toBe(1);
    expect(feed.unreadFor(channelId, selfId)).toMatchObject({ related: 1, total: 1 });
    expect(feed.acknowledgeNotifications(confirmation)).toBe(1);
  });

  it('restores channel high-water without allowing cache/grant hydration to resurrect it', async () => {
    const channelId = 'c0.project';
    const selfId = 'human:notification-persist:1';
    const first = createChannelFeedRuntime(runtimeOptions(selfId));
    first.mount();
    await first.getSnapshot().prepareLocalReplica(selfId, { focus: channelId });
    await first.getSnapshot().setHistoryGrants(
      [{ channel_id: channelId, head_seq: 0 }],
      { generation: 1, boot: 'notification-persist-boot' },
    );
    const firstFeed = first.getSnapshot();
    firstFeed.enqueue({ ...relatedRequest(channelId, 'approval-1', selfId), seq: 1 });
    const status = firstFeed.historyFor(channelId);
    expect(firstFeed.acknowledgeNotifications(channelId, {
      channelId,
      generation: status.generation,
      authorityRevision: status.notificationAuthorityRevision,
      cause: 'presented-follow',
      boundary: 1,
    })).toBe(1);

    const second = createChannelFeedRuntime(runtimeOptions(selfId));
    second.mount();
    await second.getSnapshot().prepareLocalReplica(selfId, { focus: channelId });
    await second.getSnapshot().setHistoryGrants(
      [{ channel_id: channelId, head_seq: 1 }],
      { generation: 1, boot: 'notification-persist-boot' },
    );
    const secondFeed = second.getSnapshot();
    secondFeed.enqueue({ ...relatedRequest(channelId, 'approval-1', selfId), seq: 1 });
    expect(secondFeed.unreadFor(channelId, selfId)).toMatchObject({ related: 0, total: 0 });
  });

  it('clears the old world cursor prefix through the sole notification reset port', async () => {
    const { runtime, channelId, selfId, boot } = await readyRuntime();
    const feed = runtime.getSnapshot();
    feed.enqueue({ ...relatedRequest(channelId, 'approval-world-1', selfId), seq: 1 });
    const status = feed.historyFor(channelId);
    expect(feed.acknowledgeNotifications(channelId, {
      channelId,
      generation: status.generation,
      authorityRevision: status.notificationAuthorityRevision,
      cause: 'presented-follow',
      boundary: 1,
    })).toBe(1);
    const authorityKey = (value) => `atoll.feed-cursors.v1.${selfId}\u0000${value}`;
    expect(localStorage.getItem(authorityKey(boot))).not.toBeNull();

    await feed.setHistoryGrants(
      [{ channel_id: channelId, head_seq: 0 }],
      { generation: 1, boot: `${boot}-replacement` },
    );
    expect(localStorage.getItem(authorityKey(boot))).toBeNull();
    expect(localStorage.getItem(authorityKey(`${boot}-replacement`))).not.toBeNull();

    expect(runtime.getSnapshot().notificationAuthorityPort.reset()).toBe(true);
    expect(Object.keys(localStorage).filter((key) => key.startsWith('atoll.feed-cursors.v1.'))).toEqual([]);
  });
});

describe('notification presentation facts', () => {
  it('keeps a readable live event in the replica and presentation row path', () => {
    const replica = createChannelReplicaStore();
    const channelId = 'c0.project';
    const selfId = 'human:notification-event:1';
    const state = replica.ensure(channelId).state;
    const release = state.arrivalReceipts.attachPresentationConsumer(Symbol('timeline'));
    const envelope = {
      id: 'c0.project-readable-event',
      channel_id: channelId,
      kind: 'event',
      type: 'human.note',
      sender: { kind: 'agent', id: 'agent:reviewer:1' },
      audience: [selfId],
      payload: { body: { text: 'independent public note' } },
    };
    replica.commit({ channel_id: channelId, seq: 1, envelope }, selfId, (row) => row, { source: 'live' });
    const projection = selectTimelineItems(replica.state(channelId), { scope: 'mine', selfId });
    expect(projection.items).toHaveLength(1);
    expect(projection.items[0].kind).toBe('standalone');
    expect(projection.items[0].envelope.id).toBe(envelope.id);
    expect(replica.state(channelId).arrivalReceipts.presentation().events[0]).toMatchObject({
      rowIDs: [envelope.id],
      seq: 1,
    });
    release();
  });

  it('does not classify a tool terminal before its parent context as a final notification', () => {
    const channelState = { timeline: [] };
    const terminal = {
      id: 'tool-terminal',
      parent_id: 'tool-request',
      kind: 'response',
      type: 'tool.run',
      sender: { kind: 'tool', id: 'tool:runner:1' },
      audience: ['human:notification-event:1'],
      payload: { body: { status: 'completed', text: 'internal result' } },
    };
    expect(notificationDisposition(channelState, terminal, 'human:notification-event:1'))
      .toBe('notification_context_unknown');
  });
});
