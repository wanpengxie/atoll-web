// @vitest-environment jsdom
// Round 30 recovers the two cursor rows whose old fold implementation oracle
// can be expressed through the current public ChannelFeedRuntime owner.
// Product-gap rows in the same fixture bucket stay in their existing public
// red packets and are reported separately; this file contains no duplicate red.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';

const SELF = 'human:round30:me';
const OTHER = { id: 'agent:round30:worker', kind: 'agent' };
const runtimes = new Set();

function runtimeOptions() {
  return {
    wireRef: { current: null },
    rosterRef: { current: {
      self: () => SELF,
      observeFeed: () => {},
      handleEnvelope: () => {},
    } },
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

async function readyRuntime(headSeq) {
  const runtime = createChannelFeedRuntime(runtimeOptions());
  runtimes.add(runtime);
  runtime.mount();
  const snapshot = runtime.getSnapshot();
  await snapshot.prepareLocalReplica(SELF, { focus: 'c0' });
  await snapshot.setHistoryGrants([
    { channel_id: 'c0', head_seq: headSeq, has_rows: true },
  ], { generation: 1, boot: 'round30-cursor-boot', focus: 'c0' });
  return { runtime, snapshot: () => runtime.getSnapshot() };
}

function request(id, text = id) {
  return {
    id,
    kind: 'request',
    type: 'human.approve',
    sender: OTHER,
    audience: [SELF],
    visibility: 'public',
    payload: { body: { text } },
  };
}

function terminal(id, parentId, text, status = 'completed') {
  return {
    id,
    parent_id: parentId,
    kind: 'response',
    type: 'agent.ask',
    sender: OTHER,
    audience: [SELF],
    visibility: 'public',
    payload: { body: { status, text } },
  };
}

function enqueue(snapshot, seq, envelope, source = 'live') {
  expect(snapshot.enqueue({
    channel_id: 'c0', seq, generation: 1, source, envelope,
  })).toBe(true);
}

function notificationConfirmation(snapshot, boundary) {
  const status = snapshot.historyFor('c0');
  return {
    authority: status.authority,
    owner: {
      channelId: 'c0',
      viewKey: 'round30:c0:cursor',
      activationID: 'round30-activation-c0',
      generation: status.generation,
      authorityRevision: status.notificationAuthorityRevision,
    },
    captured: {
      presentationRevision: status.presentationRevision,
      sourceRevision: status.presentationRevision,
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
  };
}

afterEach(() => {
  for (const runtime of runtimes) runtime.destroy();
  runtimes.clear();
  globalThis.localStorage?.clear();
});

describe('A-D round 30 public cursor fixture recovery', () => {
  it('[AD-306] keeps duplicate terminal frames on one unread root through the public Feed owner', async () => {
    // 用户能力：同一回合的多个 terminal frame 只产生一条 unread 通知。
    // 不变量：公开 unread projection 以稳定 root identity 去重，不重建第二份通知账。
    // 公开 owner：ChannelFeedRuntime.unreadFor → ChannelReplica canonical rows。
    // Start with an empty attach head so the public cursor owner has no
    // implicit baseline acknowledgement; these rows are the observed tail.
    const { snapshot } = await readyRuntime(0);
    enqueue(snapshot(), 1, request('round30-root', '需要处理'));
    enqueue(snapshot(), 2, terminal('round30-done', 'round30-root', '完成'));
    enqueue(snapshot(), 3, terminal('round30-conflict', 'round30-root', '晚到冲突', 'failed'));

    expect(snapshot().unreadFor('c0', SELF)).toEqual({ related: 1, total: 1 });
  });

  it('[AD-307] keeps a late older history page behind the acknowledged cursor tail', async () => {
    // 用户能力：已读到 seq 100 后，旧 history 页后到不会重新制造 unread。
    // 不变量：cursor boundary 与物理到达顺序分离，投影只保留 boundary 之后的新 root。
    // 公开 owner：ChannelFeedRuntime.acknowledgeNotifications/unreadFor。
    const { snapshot } = await readyRuntime(0);

    // The live tail arrives first; the older page is installed afterwards.
    enqueue(snapshot(), 100, request('round30-tail-100'));
    enqueue(snapshot(), 101, request('round30-tail-101'));
    for (let seq = 1; seq < 100; seq += 1) {
      enqueue(snapshot(), seq, {
        ...request(`round30-history-${seq}`),
        type: 'human.note',
        kind: 'event',
      }, 'history');
    }
    enqueue(snapshot(), 102, request('round30-tail-102'));

    expect(snapshot().acknowledgeNotifications(
      notificationConfirmation(snapshot(), 100),
    )).toBe(100);
    expect(snapshot().unreadFor('c0', SELF)).toEqual({ related: 2, total: 2 });
  });
});
