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

function confirmationFor(channelId, status, boundary, overrides = {}) {
  return {
    authority: status.authority,
    owner: {
      channelId,
      viewKey: `${channelId}:conversation`,
      activationID: 'activation-1',
      generation: status.generation,
      authorityRevision: status.notificationAuthorityRevision,
    },
    captured: {
      presentationRevision: Number(status.presentationRevision || 0),
      sourceRevision: Number(status.presentationRevision || 0),
      installedHighSeq: boundary,
    },
    generation: status.generation,
    authorityRevision: status.notificationAuthorityRevision,
    caughtUp: true,
    atTail: true,
    following: true,
    surfaceVisible: true,
    cause: 'presented-follow',
    boundary,
    ...overrides,
  };
}

describe('notification confirmation contract', () => {
  it('rejects the retired flat receipt and any mutable-boundary substitution', async () => {
    const { runtime, channelId, selfId } = await readyRuntime();
    const feed = runtime.getSnapshot();
    feed.enqueue({ ...relatedRequest(channelId, 'approval-1', selfId), seq: 1 });
    const status = feed.historyFor(channelId);
    expect(feed.acknowledgeNotifications(channelId, {
      channelId,
      generation: status.generation,
      authorityRevision: status.notificationAuthorityRevision,
      cause: 'presented-follow',
      boundary: 1,
    })).toBe(false);
    const receipt = confirmationFor(channelId, status, 1);
    expect(feed.acknowledgeNotifications({
      ...receipt,
      captured: { ...receipt.captured, installedHighSeq: 1 },
      boundary: 2,
    })).toBe(false);
    expect(feed.acknowledgeNotifications({
      ...receipt,
      authorityRevision: receipt.authorityRevision + 1,
    })).toBe(false);
  });

  it('commits a frozen backlog boundary after the mutable head advances', async () => {
    const { runtime, channelId, selfId } = await readyRuntime();
    const feed = runtime.getSnapshot();
    feed.enqueue({ ...relatedRequest(channelId, 'approval-1', selfId), seq: 1 });
    const firstStatus = feed.historyFor(channelId);

    // A later arrival must not make the already-issued boundary invalid or
    // cause it to float to the later head.
    feed.enqueue({ ...relatedRequest(channelId, 'approval-2', selfId), seq: 2 });
    const confirmation = confirmationFor(channelId, firstStatus, 1, { cause: 'tail-backlog' });
    expect(feed.acknowledgeNotifications(confirmation)).toBe(1);
    expect(feed.historyFor(channelId).notificationHighWater).toBe(1);
    expect(feed.markRead(channelId, { ...confirmation, physicalSeq: 1 })).toBe(1);
    expect(feed.unreadFor(channelId, selfId)).toMatchObject({ related: 1, total: 1 });
    expect(feed.acknowledgeNotifications(confirmation)).toBe(1);
  });

  it('holds a following observation lease without persisting an unpresented live row', async () => {
    const { runtime, channelId, selfId } = await readyRuntime();
    const feed = runtime.getSnapshot();
    feed.enqueue({ ...relatedRequest(channelId, 'approval-1', selfId), seq: 1 });
    const first = feed.historyFor(channelId);
    const receipt = confirmationFor(channelId, first, 1);
    expect(feed.acknowledgeNotifications(receipt)).toBe(1);
    feed.enqueue({ ...relatedRequest(channelId, 'approval-2', selfId), seq: 2 });
    expect(feed.unreadFor(channelId, selfId)).toMatchObject({ related: 0, total: 0 });
    expect(feed.acknowledgeNotifications({
      ...receipt,
      caughtUp: false,
      atTail: false,
      surfaceVisible: false,
      boundary: 0,
      captured: { ...receipt.captured, installedHighSeq: 1 },
      cause: '',
    })).toBe(false);
    expect(feed.unreadFor(channelId, selfId)).toMatchObject({ related: 1, total: 1 });
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
    expect(firstFeed.acknowledgeNotifications(channelId, confirmationFor(channelId, status, 1))).toBe(1);

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
    expect(feed.acknowledgeNotifications(channelId, confirmationFor(channelId, status, 1))).toBe(1);
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

  it('does not let a response-first terminal acknowledgment swallow its late parent', async () => {
    const { runtime, channelId, selfId } = await readyRuntime();
    const feed = runtime.getSnapshot();
    const terminal = {
      id: 'ack-fence-final',
      parent_id: 'ack-fence-request',
      kind: 'response',
      type: 'agent.ask',
      sender: { kind: 'agent', id: 'agent:reviewer:1' },
      audience: [selfId],
      payload: { body: { status: 'completed', text: 'arrived before request' } },
    };
    expect(feed.enqueue({ channel_id: channelId, seq: 1, source: 'live', envelope: terminal })).toBe(true);
    const status = feed.historyFor(channelId);

    // The user is already at the rendered tail, but the only candidate row
    // is still unresolved lifecycle provenance. Acknowledgment must not hide
    // the row before the exact parent can close that obligation.
    expect(feed.acknowledgeNotifications(confirmationFor(channelId, status, 1))).toBe(false);
    expect(feed.historyFor(channelId).notificationHighWater).toBe(0);

    expect(feed.enqueue({
      channel_id: channelId,
      seq: 2,
      source: 'live',
      envelope: {
        id: 'ack-fence-request',
        kind: 'request',
        type: 'agent.ask',
        sender: { kind: 'human', id: selfId },
        audience: ['agent:reviewer:1'],
        payload: { body: { text: 'late request' } },
      },
    })).toBe(true);
    expect(feed.unreadFor(channelId, selfId)).toEqual({ related: 1, total: 1 });

    // Once the parent is installed, the same canonical boundary is now
    // closed and may be acknowledged explicitly.
    const closedStatus = feed.historyFor(channelId);
    expect(feed.acknowledgeNotifications(confirmationFor(channelId, closedStatus, 2))).toBe(2);
    expect(feed.unreadFor(channelId, selfId)).toEqual({ related: 0, total: 0 });
  });

  it('keeps an A/B following lease behind an unresolved B terminal across live interleaving and reload', async () => {
    const { runtime, channelId, selfId, boot } = await readyRuntime();
    const feed = runtime.getSnapshot();
    const aRequest = relatedRequest(channelId, 'lease-a-request', selfId);
    const aTerminal = {
      channel_id: channelId,
      source: 'live',
      envelope: {
        id: 'lease-a-final', parent_id: aRequest.envelope.id, kind: 'response', type: 'human.approve',
        sender: { kind: 'agent', id: 'agent:reviewer:1' }, audience: [selfId],
        payload: { body: { status: 'completed', text: 'A closed' } },
      },
    };
    expect(feed.enqueue({ ...aRequest, seq: 1 })).toBe(true);
    expect(feed.enqueue({ ...aTerminal, seq: 2 })).toBe(true);
    const aStatus = feed.historyFor(channelId);
    expect(feed.acknowledgeNotifications(confirmationFor(channelId, aStatus, 2))).toBe(2);

    // An unrelated event may be absorbed by the short following lease. It
    // must not move that lease across the later unresolved B obligation.
    expect(feed.enqueue({
      channel_id: channelId,
      seq: 3,
      source: 'live',
      envelope: {
        id: 'lease-unrelated-event', kind: 'event', type: 'human.note', visibility: 'public',
        sender: { kind: 'agent', id: 'agent:other:1' }, audience: [selfId],
        payload: { body: { text: 'unrelated event' } },
      },
    })).toBe(true);
    expect(feed.enqueue({
      channel_id: channelId,
      seq: 4,
      source: 'live',
      envelope: {
        id: 'lease-b-final', parent_id: 'lease-b-request', kind: 'response', type: 'human.approve',
        sender: { kind: 'agent', id: 'agent:reviewer:1' }, audience: [selfId],
        payload: { body: { status: 'completed', text: 'B arrived before parent' } },
      },
    })).toBe(true);
    expect(feed.enqueue({
      channel_id: channelId,
      seq: 5,
      source: 'live',
      envelope: {
        id: 'lease-c-final', parent_id: 'lease-c-request', kind: 'response', type: 'human.approve',
        sender: { kind: 'agent', id: 'agent:reviewer:1' }, audience: [selfId],
        payload: { body: { status: 'completed', text: 'C arrived before parent' } },
      },
    })).toBe(true);
    expect(feed.historyFor(channelId).notificationHighWater).toBe(2);
    expect(feed.unreadFor(channelId, selfId)).toEqual({ related: 0, total: 0 });

    expect(feed.enqueue({
      channel_id: channelId,
      seq: 6,
      source: 'live',
      envelope: {
        id: 'lease-b-request', kind: 'request', type: 'human.approve',
        sender: { kind: 'agent', id: 'agent:reviewer:1' }, audience: [selfId],
        payload: { body: { text: 'B parent arrived later' } },
      },
    })).toBe(true);
    expect(feed.historyFor(channelId).notificationHighWater).toBe(2);
    expect(feed.unreadFor(channelId, selfId)).toEqual({ related: 1, total: 1 });

    expect(feed.enqueue({
      channel_id: channelId,
      seq: 7,
      source: 'live',
      envelope: {
        id: 'lease-c-request', kind: 'request', type: 'human.approve',
        sender: { kind: 'agent', id: 'agent:reviewer:1' }, audience: [selfId],
        payload: { body: { text: 'C parent arrived later' } },
      },
    })).toBe(true);
    // The earliest blocked B obligation remains the lease fence while the
    // independent C obligation closes; neither parent may retroactively
    // expand the old following observation.
    expect(feed.historyFor(channelId).notificationHighWater).toBe(2);
    expect(feed.unreadFor(channelId, selfId)).toEqual({ related: 2, total: 2 });

    // Reload removes only the ephemeral following lease; durable high-water
    // remains at A and the now-closed B obligation is still visible.
    await new Promise((resolve) => setTimeout(resolve, 0));
    runtime.destroy();
    const restored = createChannelFeedRuntime(runtimeOptions(selfId));
    restored.mount();
    await restored.getSnapshot().prepareLocalReplica(selfId, { focus: channelId });
    await restored.getSnapshot().setHistoryGrants(
      [{ channel_id: channelId, head_seq: 7 }], { generation: 1, boot },
    );
    const restoredFeed = restored.getSnapshot();
    expect(restoredFeed.historyFor(channelId).notificationHighWater).toBe(2);
    expect(restoredFeed.unreadFor(channelId, selfId)).toEqual({ related: 2, total: 2 });
    restored.destroy();
  });
});

describe('notification presentation facts', () => {
  it('holds a response-first terminal out of the rail until its exact parent arrives', async () => {
    const { runtime, channelId, selfId } = await readyRuntime();
    const feed = runtime.getSnapshot();
    const terminal = {
      id: 'response-first-final',
      parent_id: 'response-first-request',
      kind: 'response',
      type: 'agent.ask',
      sender: { kind: 'agent', id: 'agent:reviewer:1' },
      audience: [selfId],
      payload: { body: { status: 'completed', text: 'late parent result' } },
    };
    expect(feed.enqueue({ channel_id: channelId, seq: 1, source: 'live', envelope: terminal })).toBe(true);
    // Until Replica materializes the exact parent context, a terminal-first
    // response is unresolved lifecycle provenance, not a user notification.
    expect(feed.unreadFor(channelId, selfId)).toEqual({ related: 0, total: 0 });

    expect(feed.enqueue({
      channel_id: channelId,
      seq: 2,
      source: 'live',
      envelope: {
        id: 'response-first-request',
        kind: 'request',
        type: 'agent.ask',
        sender: { kind: 'human', id: selfId },
        audience: ['agent:reviewer:1'],
        payload: { body: { text: 'late parent request' } },
      },
    })).toBe(true);
    expect(feed.unreadFor(channelId, selfId)).toEqual({ related: 1, total: 1 });
  });

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
