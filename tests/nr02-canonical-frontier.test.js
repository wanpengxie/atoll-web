// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';

const CHANNEL = 'nr02.channel';
const SELF = 'human:nr02:1';
const OTHER = 'human:other:1';
const AGENT = 'agent:nr02:1';

let serial = 0;

function options() {
  return {
    wireRef: { current: null },
    rosterRef: {
      current: {
        self: () => SELF,
        observeFeed: () => {},
        handleEnvelope: () => {},
      },
    },
    accessRef: { current: { live: () => false } },
    activeChannelRef: { current: CHANNEL },
    onRoster: vi.fn(),
    onError: vi.fn(),
    onChannelsDiscovered: vi.fn(),
    onDirectoryInvalidated: vi.fn(),
    onSubmissionFeed: vi.fn(),
    onAccessChanged: vi.fn(),
  };
}

async function ready() {
  const runtime = createChannelFeedRuntime(options());
  runtime.mount();
  const feed = runtime.getSnapshot();
  await feed.prepareLocalReplica(SELF, { focus: CHANNEL });
  await feed.setHistoryGrants(
    [{ channel_id: CHANNEL, head_seq: 0 }],
    { generation: 1, boot: 'nr02-' + (++serial), focus: CHANNEL },
  );
  return { runtime, feed: runtime.getSnapshot() };
}

function request(id, audience = [SELF]) {
  return {
    channel_id: CHANNEL,
    source: 'live',
    envelope: {
      id,
      channel_id: CHANNEL,
      kind: 'request',
      type: 'human.approve',
      sender: { kind: 'agent', id: AGENT },
      audience,
      visibility: 'public',
      payload: { body: { text: id } },
    },
  };
}

function receipt(feed, overrides = {}) {
  const status = feed.historyFor(CHANNEL);
  const boundary = Number(overrides.boundary ?? 2);
  return {
    authority: status.authority,
    owner: {
      channelId: CHANNEL,
      viewKey: CHANNEL + ':conversation',
      activationID: 'nr02-activation',
      generation: status.generation,
    },
    captured: {
      presentationRevision: Number(status.presentationRevision || 0),
      sourceRevision: Number(status.presentationRevision || 0),
      installedHighSeq: boundary,
    },
    generation: status.generation,
    authorityRevision: status.notificationAuthorityRevision,
    caughtUp: true,
    scope: 'all',
    actorFiltered: false,
    atTail: true,
    following: true,
    surfaceVisible: true,
    cause: 'presented-follow',
    boundary,
    ...overrides,
  };
}

function seedPair(feed, prefix = 'pair') {
  expect(feed.enqueue({ ...request(prefix + '-related', [SELF]), seq: 1 })).toBe(true);
  expect(feed.enqueue({ ...request(prefix + '-other', [OTHER]), seq: 2 })).toBe(true);
}

afterEach(() => globalThis.localStorage?.clear());

describe('NR02 canonical notification frontier', () => {
  it('publishes explicit related/other/pending/unknown projections', async () => {
    const { runtime, feed } = await ready();
    try {
      seedPair(feed, 'projection');
      expect(feed.unreadFor(CHANNEL, SELF)).toEqual({
        related: 1, other: 1, pending: false, unknown: false,
      });
    } finally {
      runtime.destroy();
    }
  });

  it('advances unfiltered all only through visited contiguous roots', async () => {
    const { runtime, feed } = await ready();
    try {
      expect(feed.enqueue({ ...request('frontier-a', [SELF]), seq: 1 })).toBe(true);
      expect(feed.enqueue({ ...request('frontier-sibling', [OTHER]), seq: 2 })).toBe(true);
      expect(feed.enqueue({ ...request('frontier-b', [SELF]), seq: 3 })).toBe(true);
      expect(feed.acknowledgeNotifications(receipt(feed, {
        boundary: 3,
        visibleRowIDs: ['frontier-a', 'frontier-b'],
      }))).toBe(1);
      expect(feed.historyFor(CHANNEL).notificationHighWater).toBe(1);
      expect(feed.unreadFor(CHANNEL, SELF)).toEqual({
        related: 0, other: 1, pending: false, unknown: false,
      });
    } finally {
      runtime.destroy();
    }
  });

  it('keeps a duplicate durable receipt idempotent after high-water advances', async () => {
    const { runtime, feed } = await ready();
    const versions = [];
    const unsubscribe = runtime.subscribe(() => versions.push(runtime.getSnapshot().version));
    try {
      seedPair(feed, 'durable-identity');
      versions.length = 0;
      const first = receipt(feed, {
        visibleRowIDs: ['durable-identity-related', 'durable-identity-other'],
      });
      expect(feed.acknowledgeNotifications(first)).toBe(2);
      expect(versions).toHaveLength(1);
      expect(feed.acknowledgeNotifications(first)).toBe(2);
      expect(versions).toHaveLength(1);
      expect(feed.historyFor(CHANNEL).notificationHighWater).toBe(2);
    } finally {
      unsubscribe();
      runtime.destroy();
    }
  });

  it('keeps response-first terminals unknown until the exact parent closes them', async () => {
    const { runtime, feed } = await ready();
    try {
      expect(feed.enqueue({
        channel_id: CHANNEL,
        source: 'live',
        seq: 1,
        envelope: {
          id: 'frontier-terminal',
          parent_id: 'frontier-parent',
          kind: 'response',
          type: 'human.approve',
          sender: { kind: 'agent', id: AGENT },
          audience: [SELF],
          visibility: 'public',
          payload: { body: { status: 'completed', text: 'done' } },
        },
      })).toBe(true);
      expect(feed.acknowledgeNotifications(receipt(feed, {
        boundary: 1,
        visibleRowIDs: ['frontier-terminal'],
      }))).toBe(false);
      expect(feed.historyFor(CHANNEL).notificationHighWater).toBe(0);
      expect(feed.unreadFor(CHANNEL, SELF)).toMatchObject({ unknown: true });

      expect(feed.enqueue({ ...request('frontier-parent', [SELF]), seq: 2 })).toBe(true);
      const next = receipt(feed, {
        boundary: 2,
        visibleRowIDs: ['frontier-parent'],
      });
      expect(feed.acknowledgeNotifications(next)).toBe(2);
      expect(feed.historyFor(CHANNEL).notificationHighWater).toBe(2);
    } finally {
      runtime.destroy();
    }
  });

  it('does not cross a physical sequence gap even when later roots are visible', async () => {
    const { runtime, feed } = await ready();
    try {
      expect(feed.enqueue({ ...request('gap-a', [SELF]), seq: 1 })).toBe(true);
      expect(feed.enqueue({ ...request('gap-b', [SELF]), seq: 3 })).toBe(true);
      expect(feed.acknowledgeNotifications(receipt(feed, {
        boundary: 3,
        visibleRowIDs: ['gap-a', 'gap-b'],
      }))).toBe(1);
      expect(feed.historyFor(CHANNEL).notificationHighWater).toBe(1);
      expect(feed.unreadFor(CHANNEL, SELF)).toMatchObject({
        related: 0, other: 0, pending: false, unknown: true,
      });
    } finally {
      runtime.destroy();
    }
  });

  it('keeps mine and actor-filtered receipts ephemeral', async () => {
    const { runtime, feed } = await ready();
    try {
      seedPair(feed, 'ephemeral');
      expect(feed.acknowledgeNotifications(receipt(feed, {
        scope: 'mine',
        visibleRowIDs: ['ephemeral-related', 'ephemeral-other'],
      }))).toBe(false);
      expect(feed.historyFor(CHANNEL).notificationHighWater).toBe(0);
      expect(feed.unreadFor(CHANNEL, SELF)).toEqual({
        related: 0, other: 1, pending: false, unknown: false,
      });

      expect(feed.acknowledgeNotifications(receipt(feed, {
        scope: 'all',
        actorFiltered: true,
        inputEpoch: 1,
        visibleRowIDs: ['ephemeral-related'],
      }))).toBe(false);
      expect(feed.historyFor(CHANNEL).notificationHighWater).toBe(0);
      expect(feed.unreadFor(CHANNEL, SELF)).toEqual({
        related: 1, other: 1, pending: false, unknown: false,
      });
    } finally {
      runtime.destroy();
    }
  });

  it('durably closes a mine receipt only when its frozen frontier is related-only', async () => {
    const { runtime, feed } = await ready();
    try {
      expect(feed.enqueue({ ...request('related-only'), seq: 1 })).toBe(true);
      expect(feed.acknowledgeNotifications(receipt(feed, {
        scope: 'mine',
        boundary: 1,
        visibleRowIDs: ['related-only'],
      }))).toBe(1);
      expect(feed.historyFor(CHANNEL).notificationHighWater).toBe(1);
      expect(feed.unreadFor(CHANNEL, SELF)).toEqual({
        related: 0, other: 0, pending: false, unknown: false,
      });
    } finally {
      runtime.destroy();
    }
  });

  it('does not republish the same observation identity', async () => {
    const { runtime, feed } = await ready();
    const versions = [];
    const unsubscribe = runtime.subscribe(() => versions.push(runtime.getSnapshot().version));
    try {
      seedPair(feed, 'identity');
      versions.length = 0;
      const first = receipt(feed, { scope: 'mine', visibleRowIDs: ['identity-related'] });
      expect(feed.acknowledgeNotifications(first)).toBe(false);
      expect(versions).toHaveLength(1);
      expect(feed.acknowledgeNotifications(first)).toBe(false);
      expect(versions).toHaveLength(1);
      const next = receipt(feed, {
        scope: 'mine',
        inputEpoch: 1,
        visibleRowIDs: ['identity-related'],
      });
      expect(feed.acknowledgeNotifications(next)).toBe(false);
      expect(versions).toHaveLength(2);
    } finally {
      unsubscribe();
      runtime.destroy();
    }
  });
});
