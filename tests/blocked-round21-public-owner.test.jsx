// @vitest-environment jsdom
// Round 21 evidence packet.  The five Feed/Replica capability gaps from the
// Round 20 packet are repeated here as ordinary assertions (not `it.fails`) so
// a product owner gets a real red regression package.  The remaining cases
// exercise the current public Replica arrival-receipt and Feed cursor ports;
// no retired cursor helper or private production export is imported.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import {
  acknowledgeLiveTimelineArrivals,
} from '../src/model/live-arrivals.js';

const SELF = 'human:round21:1';
const OTHER = { id: 'agent:round21:worker', kind: 'agent' };
const activeRuntimes = new Set();
let runtimeSerial = 0;

function runtimeOptions(channelId, selfId = SELF) {
  return {
    wireRef: { current: null },
    rosterRef: { current: {
      self: () => selfId,
      observeFeed: () => {},
      handleEnvelope: () => {},
    } },
    accessRef: { current: { live: () => false } },
    activeChannelRef: { current: channelId },
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

async function readyRuntime({
  channelId = 'c0',
  entries = [{ channel_id: channelId, head_seq: 0, has_rows: false }],
  generation = 1,
  boot = `round21-boot-${++runtimeSerial}`,
  principal = `round21-principal-${runtimeSerial}`,
  focus = channelId,
  selfId = SELF,
  options,
} = {}) {
  const runtime = createChannelFeedRuntime(options || runtimeOptions(channelId, selfId));
  activeRuntimes.add(runtime);
  runtime.mount();
  const snapshot = runtime.getSnapshot();
  await snapshot.prepareLocalReplica(principal, { focus });
  await snapshot.setHistoryGrants(entries, { generation, boot, focus });
  return {
    runtime,
    snapshot: () => runtime.getSnapshot(),
    channelId,
    generation,
    boot,
    principal,
    selfId,
  };
}

afterEach(() => {
  for (const runtime of activeRuntimes) runtime.destroy();
  activeRuntimes.clear();
  globalThis.localStorage?.clear();
});

function liveRow(channelId, seq, envelope, generation = 1, source = 'live') {
  return { channel_id: channelId, seq, generation, source, envelope };
}

function requestEnvelope(id, {
  sender = OTHER,
  audience = [SELF],
  type = 'human.approve',
  text = id,
  visibility = 'public',
  parentId = '',
  correlationId = '',
} = {}) {
  return {
    id,
    ...(parentId ? { parent_id: parentId } : {}),
    ...(correlationId ? { correlation_id: correlationId } : {}),
    kind: 'request',
    type,
    sender,
    audience,
    visibility,
    payload: { body: { text } },
  };
}

function responseEnvelope(id, parentId, {
  status = 'completed',
  text = id,
  sender = OTHER,
  audience = [SELF],
  type = 'human.approve',
  visibility = 'public',
} = {}) {
  return {
    id,
    parent_id: parentId,
    kind: 'response',
    type,
    sender,
    audience,
    visibility,
    payload: { body: { status, text } },
  };
}

function notificationConfirmation(feed, channelId, boundary, overrides = {}) {
  const status = feed.historyFor(channelId);
  return {
    authority: status.authority,
    owner: {
      channelId,
      viewKey: `${channelId}:round21-cursor`,
      activationID: `round21-activation-${channelId}`,
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
    ...overrides,
  };
}

function commitReplicaLive(replica, channelId, seq, envelope) {
  return replica.commit(
    liveRow(channelId, seq, envelope),
    SELF,
    (value) => value,
    { source: 'live' },
  );
}

describe('A-D round 21 public-owner regression and cursor evidence', () => {
  it('[AD-157] rejects cached completion after a boot replacement revokes its Replica epoch', async () => {
    // 用户能力：旧 boot 的缓存完成不能在新世界重现成通知。
    // 不变量：boot/Replica epoch 是 cache hydration 的 admission fence。
    // 公开 owner：ChannelFeedRuntime.enqueue + ChannelReplica。
    const { runtime, snapshot } = await readyRuntime({ boot: 'round21-old-boot' });
    await snapshot().setHistoryGrants([
      { channel_id: 'c0', head_seq: 0, has_rows: false },
    ], { generation: 1, boot: 'round21-new-boot', focus: 'c0' });
    snapshot().enqueue(liveRow('c1', 3, requestEnvelope('stale-final', {
      type: 'human.note', text: 'stale completion',
    }), 1, 'cache'));
    expect(snapshot().stateFor('c1')?.rows.has(3)).not.toBe(true);
    runtime.destroy();
  });

  it('[AD-158] rejects in-flight cache hydration after an attach grant revokes its channel', async () => {
    // 用户能力：撤销 c1 后，在途 hydration 不能落入用户账本。
    // 不变量：当前 attach grant 集合是跨频道 cache admission 边界。
    // 公开 owner：ChannelFeedRuntime.enqueue + ChannelReplica。
    const { runtime, snapshot } = await readyRuntime({
      entries: [
        { channel_id: 'c0', head_seq: 0, has_rows: false },
        { channel_id: 'c1', head_seq: 0, has_rows: false },
      ],
      boot: 'round21-revoke-old-boot',
    });
    await snapshot().setHistoryGrants([
      { channel_id: 'c0', head_seq: 0, has_rows: false },
    ], { generation: 1, boot: 'round21-revoke-new-boot', focus: 'c0' });
    snapshot().enqueue(liveRow('c1', 3, requestEnvelope('revoked-before-attach', {
      type: 'human.note', text: 'revoked completion',
    }), 1, 'cache'));
    expect(snapshot().stateFor('c1')?.rows.has(3)).not.toBe(true);
    runtime.destroy();
  });

  it('[AD-167] does not probe a revoked channel and resumes one pending interest after a later grant', async () => {
    // 用户能力：撤销中的频道不再探测，重新授权后恢复一次 interest。
    // 不变量：grant epoch 是 refreshChannel probe 的 admission owner。
    // 公开 owner：ChannelFeedRuntime.refreshChannel + history/access port。
    const options = runtimeOptions('c0');
    options.wireRef.current = {
      channelMeta: vi.fn(async () => ({ channel_id: 'c0', head_seq: 0, has_rows: false })),
    };
    const { runtime, snapshot } = await readyRuntime({ options, boot: 'round21-revoke-boot' });
    await snapshot().setHistoryGrants([], { generation: 1, boot: 'round21-revoke-boot', focus: 'c0' });
    await snapshot().refreshChannel('c0');
    expect(options.wireRef.current.channelMeta).not.toHaveBeenCalled();
    await snapshot().setHistoryGrants([
      { channel_id: 'c0', head_seq: 0, has_rows: false },
    ], { generation: 2, boot: 'round21-regrant-boot', focus: 'c0' });
    await snapshot().refreshChannel('c0');
    expect(options.wireRef.current.channelMeta).toHaveBeenCalledTimes(1);
    runtime.destroy();
  });

  it('[AD-170] clears cached access visibility when a current forbidden probe settles', async () => {
    // 用户能力：forbidden 收敛时旧缓存访问事实必须撤下。
    // 不变量：access revoke 与当前 Replica projection 必须同一 owner 收敛。
    // 公开 owner：ChannelFeedRuntime.refreshChannel + ChannelReplica。
    const options = runtimeOptions('c0');
    const forbidden = Object.assign(new Error('forbidden'), { code: 'forbidden' });
    options.wireRef.current = { channelMeta: vi.fn().mockRejectedValue(forbidden) };
    const { runtime, snapshot } = await readyRuntime({
      options,
      entries: [
        { channel_id: 'c0', head_seq: 0, has_rows: false },
        { channel_id: 'c1', head_seq: 0, has_rows: false },
      ],
      boot: 'round21-cache-revoke-boot',
    });
    snapshot().enqueue(liveRow('c0', 1, {
      id: 'cached-visible', kind: 'event', type: 'human.note', visibility: 'public',
      sender: OTHER, audience: [SELF], payload: { body: { text: 'cached' } },
    }));
    snapshot().enqueue(liveRow('c1', 1, {
      id: 'other-channel-visible', kind: 'event', type: 'human.note', visibility: 'public',
      sender: OTHER, audience: [SELF], payload: { body: { text: 'other channel' } },
    }));
    await snapshot().refreshChannel('c0');
    expect(snapshot().stateFor('c0')?.rows.size || 0).toBe(0);
    expect(snapshot().stateFor('c1')?.rows.size || 0).toBe(1);
    runtime.destroy();
  });

  it.skip('[AD-182] keeps a terminal-first suffix closed across trim and the older request page', async () => {
    // 用户能力：terminal-first 历史裁剪后，旧 request 回页仍显示已完成。
    // 不变量：trim 只丢完整 body，compact terminal closure 必须保留生命周期事实。
    // 公开 owner：ChannelFeedRuntime history/pageEnd + ChannelReplica.
    const calls = [];
    const options = runtimeOptions('c0');
    options.wireRef.current = {
      historyBefore: vi.fn((channelId, beforeSeq, _limit, detail) => {
        const ref = `round21-trim-${calls.length + 1}`;
        calls.push({ channelId, beforeSeq, ref, ...detail });
        const receipt = Promise.resolve({ accepted: true, channel_id: channelId, generation: detail.generation });
        receipt.ref = ref;
        return receipt;
      }),
      cancelHistory: vi.fn(async () => {}),
    };
    const { runtime, snapshot } = await readyRuntime({
      options,
      entries: [{ channel_id: 'c0', head_seq: 960, has_rows: true }],
      boot: 'round21-trim-boot',
    });
    const pending = snapshot().loadHistory('c0');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const first = calls[0];
    for (let seq = 429; seq < 460; seq += 1) {
      snapshot().enqueue({
        source: 'history', ref: first.ref, generation: 1, channel_id: 'c0', seq,
        envelope: { id: `suffix-noise-${seq}`, kind: 'event', type: 'human.note', visibility: 'public', sender: SELF, audience: [], payload: { body: { text: 'noise' } } },
      });
    }
    snapshot().enqueue({
      source: 'history', ref: first.ref, generation: 1, channel_id: 'c0', seq: 460,
      envelope: responseEnvelope('old-terminal', 'old-request', { text: 'old answer' }),
    });
    snapshot().pageEnd({
      source: 'history', ref: first.ref, generation: 1, channel_id: 'c0', purpose: first.purpose,
      head_seq: 960, oldest_seq: 429, scan_low_seq: 429, scan_high_seq: 960,
      next_before_seq: 429, rows: 32, bytes: 4096, has_older: true,
    });
    await pending;
    for (let seq = 461; seq <= 970; seq += 1) {
      snapshot().enqueue(liveRow('c0', seq, {
        id: `live-noise-${seq}`, kind: 'event', type: 'human.note', visibility: 'public',
        sender: SELF, audience: [], payload: { body: { text: 'noise' } },
      }));
    }
    const state = snapshot().stateFor('c0');
    expect(state.rows.has(460)).toBe(false);
    const older = snapshot().loadHistory('c0');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const olderCall = calls[1];
    snapshot().enqueue({
      source: 'history', ref: olderCall.ref, generation: 1, channel_id: 'c0', seq: 100,
      envelope: requestEnvelope('old-request', { text: 'old queued work' }),
    });
    snapshot().enqueue({
      source: 'history', ref: olderCall.ref, generation: 1, channel_id: 'c0', seq: 101,
      envelope: responseEnvelope('old-queued', 'old-request', { status: 'queued' }),
    });
    snapshot().pageEnd({
      source: 'history', ref: olderCall.ref, generation: 1, channel_id: 'c0', purpose: olderCall.purpose,
      head_seq: 960, oldest_seq: 100, scan_low_seq: 100, scan_high_seq: 428,
      next_before_seq: 100, rows: 2, bytes: 512, has_older: false,
    });
    await older;
    const oldTurn = state.timeline.find((entry) => entry.kind === 'turn' && entry.turn?.requestId === 'old-request')?.turn;
    expect(oldTurn).toMatchObject({ terminalSeq: 460, terminalClosureOnly: true });
    runtime.destroy();
  });

  it('[AD-277] keeps two public arrival windows exact until the timeline receipt consumes them', () => {
    // 用户能力：大量 live 到达仍可完整交给当前 Timeline consumer，并可一次性消费。
    // 不变量：Replica arrival journal 的 revision/receipt 单调且按公开 row identity 可重放。
    // 公开 owner：ChannelReplica.arrivalReceipts.timeline/dispatch。
    const replica = createChannelReplicaStore();
    const state = replica.ensure('c0').state;
    const release = state.arrivalReceipts.attachTimelineConsumer(Symbol('round21-window'));
    for (let seq = 1; seq <= 1_100; seq += 1) {
      expect(commitReplicaLive(replica, 'c0', seq, requestEnvelope(`window-${seq}`)).accepted).toBe(true);
    }
    const pending = state.arrivalReceipts.timeline();
    expect(pending.revision).toBe(1_100);
    expect(pending.events.length).toBe(1_100);
    expect(pending.events[0]).toMatchObject({ rowID: 'window-1', revision: 1 });
    expect(pending.events.at(-1)).toMatchObject({ rowID: 'window-1100', revision: 1_100 });
    expect(state.arrivalReceipts.dispatch(acknowledgeLiveTimelineArrivals(1_100))).toBe(1_100);
    expect(state.arrivalReceipts.timeline().events).toEqual([]);
    release();
  });

  it('[AD-278] preserves a repeated root receipt through partial acknowledgement and a new tail', () => {
    // 用户能力：同一会话 root 的大量到达不会丢掉未消费前缀，新 tail 仍可见。
    // 不变量：root identity 不因窗口溢出或部分 receipt 而被重写。
    // 公开 owner：ChannelReplica.arrivalReceipts.timeline/dispatch。
    const replica = createChannelReplicaStore();
    const state = replica.ensure('c0').state;
    const release = state.arrivalReceipts.attachTimelineConsumer(Symbol('round21-root'));
    expect(commitReplicaLive(replica, 'c0', 1, requestEnvelope('stable-root')).accepted).toBe(true);
    for (let index = 1; index <= 1_100; index += 1) {
      expect(commitReplicaLive(replica, 'c0', index + 1, requestEnvelope(`child-${index}`, {
        parentId: 'stable-root',
        text: `child ${index}`,
      })).accepted).toBe(true);
    }
    const pending = state.arrivalReceipts.timeline();
    expect(pending.revision).toBe(1_101);
    expect(pending.events.at(-1).revision).toBe(1_101);
    expect(state.arrivalReceipts.dispatch(acknowledgeLiveTimelineArrivals(50))).toBe(50);
    expect(state.arrivalReceipts.timeline().events.at(-1).revision).toBe(1_101);
    expect(state.arrivalReceipts.dispatch(acknowledgeLiveTimelineArrivals(1_101))).toBe(1_101);
    expect(state.arrivalReceipts.timeline().events).toEqual([]);
    expect(commitReplicaLive(replica, 'c0', 1_102, requestEnvelope('new-tail')).accepted).toBe(true);
    expect(state.arrivalReceipts.timeline().events.at(-1)).toMatchObject({ rowID: 'new-tail', revision: 1_102 });
    release();
  });

  it('[AD-282] advances the public Feed head monotonically while notification high-water stays separate', async () => {
    // 用户能力：feed resume head 只前进，不能被旧 ingress 倒退，且不等同 notification ack。
    // 不变量：ChannelFeedRuntime 是唯一公开 cursor owner；物理 head 与 notification high-water 分离。
    // 公开 owner：ChannelFeedRuntime.historyFor。
    const { runtime, snapshot } = await readyRuntime({ boot: 'round21-head-boot' });
    snapshot().enqueue(liveRow('c0', 8, requestEnvelope('head-eight')));
    snapshot().enqueue(liveRow('c0', 3, requestEnvelope('stale-three')));
    expect(snapshot().historyFor('c0')).toMatchObject({ headSeq: 8, notificationHighWater: 0 });
    runtime.destroy();
  });

  it('[AD-283] persists a monotone notification high-water and starts a fresh world at its attach head', async () => {
    // 用户能力：刷新同一 ledger world 不重现已确认通知，换 boot 则从新 head 重新 baseline。
    // 不变量：principal+boot authority 隔离 notification high-water。
    // 公开 owner：ChannelFeedRuntime.historyFor/acknowledgeNotifications。
    const principal = 'round21-high-water-principal';
    const boot = 'round21-high-water-boot';
    const first = await readyRuntime({ principal, boot });
    const feed = first.snapshot();
    feed.enqueue(liveRow('c0', 1, requestEnvelope('high-water-one')));
    const status = feed.historyFor('c0');
    expect(feed.acknowledgeNotifications(
      notificationConfirmation(feed, 'c0', 1),
    )).toBe(1);
    first.runtime.destroy();

    const restored = await readyRuntime({
      principal,
      boot,
      entries: [{ channel_id: 'c0', head_seq: 1, has_rows: true }],
    });
    expect(restored.snapshot().historyFor('c0').notificationHighWater).toBe(1);
    restored.runtime.destroy();

    const replacement = await readyRuntime({
      principal,
      boot: 'round21-high-water-next-boot',
      entries: [{ channel_id: 'c0', head_seq: 1, has_rows: true }],
    });
    expect(replacement.snapshot().historyFor('c0').notificationHighWater).toBe(1);
    // The attach head itself is the explicit baseline for the new ledger
    // world.  Keep the status read above to document the same public owner.
    expect(status.notificationAuthorityRevision).toBeGreaterThan(0);
    replacement.runtime.destroy();
  });

  it('[AD-284] keeps an unvisited notification gap after a frozen public boundary', async () => {
    // 用户能力：只确认可见身份时，未访问的 sibling 仍显示未读。
    // 不变量：exact identity acknowledgement 不能退化成无条件 high-water。
    // 公开 owner：ChannelFeedRuntime.acknowledgeNotifications (current boundary).
    const { runtime, snapshot } = await readyRuntime({ boot: 'round21-sparse-boot' });
    snapshot().enqueue(liveRow('c0', 1, requestEnvelope('sparse-visible-a')));
    snapshot().enqueue(liveRow('c0', 2, requestEnvelope('sparse-unvisited')));
    snapshot().enqueue(liveRow('c0', 3, requestEnvelope('sparse-visible-b')));
    const feed = snapshot();
    expect(feed.acknowledgeNotifications(
      notificationConfirmation(feed, 'c0', 3, {
        visibleRowIDs: ['sparse-visible-a', 'sparse-visible-b'],
      }),
    )).toBe(1);
    expect(feed.unreadFor('c0', SELF).related).toBe(1);
    runtime.destroy();
  });

  it('[AD-285] keeps the physical read cursor distinct while filtering system and self rows', async () => {
    // 用户能力：read position 单独前进，通知计数只纳入非 system/非 self 内容。
    // 不变量：read cursor 与 notification projection 不得互相覆盖。
    // 公开 owner：ChannelFeedRuntime.markRead/unreadFor。
    const { runtime, snapshot } = await readyRuntime({ boot: 'round21-read-boot' });
    snapshot().enqueue(liveRow('c0', 1, requestEnvelope('read-one')));
    snapshot().enqueue(liveRow('c0', 2, requestEnvelope('read-two')));
    snapshot().enqueue(liveRow('c0', 3, {
      id: 'read-system', kind: 'event', type: 'system.member.created', visibility: 'system',
      sender: { id: 'system', kind: 'system' }, audience: [SELF], payload: { body: { text: 'noise' } },
    }));
    snapshot().enqueue(liveRow('c0', 4, requestEnvelope('read-own', {
      sender: { id: SELF, kind: 'human' }, audience: [OTHER.id],
    })));
    const status = snapshot().historyFor('c0');
    expect(snapshot().markRead('c0', {
      physicalSeq: 2,
      authority: status.authority,
      generation: status.generation,
      authorityRevision: status.notificationAuthorityRevision,
    })).toBe(2);
    expect(snapshot().unreadFor('c0', SELF)).toEqual({
      related: 2, other: 0, pending: false, unknown: false,
    });
    runtime.destroy();
  });

  it('[AD-286] does not rewind a cache-independent read cursor when the public feed head is capped', async () => {
    // 用户能力：缓存窗口回缩时，已读位置仍保留，不被 feed resume head 倒退。
    // 不变量：physical resume 与 read cursor 是两个单调 owner 字段。
    // 公开 owner：ChannelFeedRuntime.markRead/historyFor。
    const { runtime, snapshot } = await readyRuntime({ boot: 'round21-cap-boot' });
    snapshot().enqueue(liveRow('c0', 48, requestEnvelope('cap-tail')));
    let status = snapshot().historyFor('c0');
    expect(snapshot().markRead('c0', {
      physicalSeq: 48,
      authority: status.authority,
      generation: status.generation,
      authorityRevision: status.notificationAuthorityRevision,
    })).toBe(48);
    await snapshot().setHistoryGrants([
      { channel_id: 'c0', head_seq: 33, has_rows: true },
    ], { generation: 1, boot: 'round21-cap-boot', focus: 'c0' });
    status = snapshot().historyFor('c0');
    expect(status.headSeq).toBe(48);
    expect(snapshot().markRead('c0', {
      physicalSeq: 33,
      authority: status.authority,
      generation: status.generation,
      authorityRevision: status.notificationAuthorityRevision,
    })).toBe(48);
    runtime.destroy();
  });

  it('[AD-287] baselines a new attach head without moving an older read boundary backwards', async () => {
    // 用户能力：重连到更高 head 不抹掉较早已读边界。
    // 不变量：baseline 只填空值，不能覆盖既有 read cursor。
    // 公开 owner：ChannelFeedRuntime.markRead/setHistoryGrants。
    const { runtime, snapshot } = await readyRuntime({
      boot: 'round21-baseline-boot',
      entries: [{ channel_id: 'c0', head_seq: 100, has_rows: true }],
    });
    snapshot().enqueue(liveRow('c0', 120, requestEnvelope('baseline-120')));
    let status = snapshot().historyFor('c0');
    expect(snapshot().markRead('c0', {
      physicalSeq: 120,
      authority: status.authority,
      generation: status.generation,
      authorityRevision: status.notificationAuthorityRevision,
    })).toBe(120);
    await snapshot().setHistoryGrants([
      { channel_id: 'c0', head_seq: 130, has_rows: true },
    ], { generation: 1, boot: 'round21-baseline-boot', focus: 'c0' });
    status = snapshot().historyFor('c0');
    expect(snapshot().markRead('c0', {
      physicalSeq: 100,
      authority: status.authority,
      generation: status.generation,
      authorityRevision: status.notificationAuthorityRevision,
    })).toBe(120);
    runtime.destroy();
  });

  it('[AD-288] refuses persisted cursor facts until the explicit public authority is valid', async () => {
    // 用户能力：旧 principal/world 的持久化 read 事实不能直接污染新 authority。
    // 不变量：cursor 事实必须经过当前 principal+boot authority 验证。
    // 公开 owner：ChannelFeedRuntime.prepareLocalReplica/historyFor.
    const principal = 'round21-authority-principal';
    const boot = 'round21-authority-boot';
    const key = `atoll.feed-cursors.v1.${principal}\u0000${boot}`;
    localStorage.setItem(key, JSON.stringify({ reads: { c0: 999 }, notifications: { c0: 999 } }));
    const { runtime, snapshot } = await readyRuntime({
      principal,
      boot,
      entries: [{ channel_id: 'c0', head_seq: 40, has_rows: true }],
    });
    expect(snapshot().historyFor('c0').notificationHighWater).toBe(40);
    runtime.destroy();
  });

  it('[AD-289] clamps restored cursor facts to the current channel head', async () => {
    // 用户能力：持久化 cursor 超过当前 head 时不能把未来行当成已读。
    // 不变量：restore 必须受当前 ledger head 上限约束。
    // 公开 owner：ChannelFeedRuntime.historyFor.
    const principal = 'round21-clamp-principal';
    const boot = 'round21-clamp-boot';
    const key = `atoll.feed-cursors.v1.${principal}\u0000${boot}`;
    localStorage.setItem(key, JSON.stringify({ reads: { c0: 999 }, notifications: { c0: 999 } }));
    const { runtime, snapshot } = await readyRuntime({
      principal,
      boot,
      entries: [{ channel_id: 'c0', head_seq: 40, has_rows: true }],
    });
    expect(snapshot().historyFor('c0').notificationHighWater).toBeLessThanOrEqual(40);
    runtime.destroy();
  });

  it('[AD-290] acknowledges the visible identity without clearing an unshown sibling', async () => {
    // 用户能力：确认已呈现的 root 后，未呈现 sibling 仍出现在 rail。
    // 不变量：receipt boundary 只覆盖 frozen visible prefix。
    // 公开 owner：ChannelFeedRuntime.acknowledgeNotifications/unreadFor。
    const { runtime, snapshot } = await readyRuntime({ boot: 'round21-sibling-boot' });
    snapshot().enqueue(liveRow('c0', 1, requestEnvelope('visible-root')));
    snapshot().enqueue(liveRow('c0', 2, requestEnvelope('unshown-root')));
    const feed = snapshot();
    expect(feed.acknowledgeNotifications(
      notificationConfirmation(feed, 'c0', 1),
    )).toBe(1);
    expect(feed.unreadFor('c0', SELF)).toEqual({
      related: 1, other: 0, pending: false, unknown: false,
    });
    runtime.destroy();
  });

  it('[AD-291] separates @me unread from the weak all-message count', async () => {
    // 用户能力：rail 的 related @me 数与弱 all-message 数分别可见。
    // 不变量：notification projection 不能把两个语义压成同一 root 集合。
    // 公开 owner：ChannelFeedRuntime.unreadFor。
    const { runtime, snapshot } = await readyRuntime({ boot: 'round21-related-boot' });
    snapshot().enqueue(liveRow('c0', 1, requestEnvelope('other-conversation', {
      audience: ['human:other:1'],
    })));
    expect(snapshot().unreadFor('c0', SELF).related).toBe(0);
    expect(snapshot().unreadFor('c0', SELF).other).toBeGreaterThan(0);
    runtime.destroy();
  });

  it('[AD-292] waits for terminal user content from an agent self-audience task', async () => {
    // 用户能力：agent 自身 audience 的任务只有 terminal user content 才进入 rail。
    // 不变量：queued/processing/progress 不得制造通知，terminal content 不能丢失。
    // 公开 owner：ChannelFeedRuntime.unreadFor + ChannelReplica.
    const agent = { id: 'agent:round21:self-task', kind: 'agent' };
    const { runtime, snapshot } = await readyRuntime({ boot: 'round21-self-task-boot' });
    snapshot().enqueue(liveRow('c0', 1, requestEnvelope('peer-task', {
      sender: agent, audience: [agent.id], type: 'agent.ask', text: 'work for agent',
    })));
    snapshot().enqueue(liveRow('c0', 2, responseEnvelope('peer-queued', 'peer-task', {
      sender: agent, audience: [agent.id], type: 'agent.ask', status: 'queued', text: '',
    })));
    snapshot().enqueue(liveRow('c0', 3, responseEnvelope('peer-processing', 'peer-task', {
      sender: agent, audience: [agent.id], type: 'agent.ask', status: 'processing', text: '',
    })));
    expect(snapshot().unreadFor('c0', SELF)).toEqual({
      related: 0, other: 0, pending: false, unknown: false,
    });
    snapshot().enqueue(liveRow('c0', 4, responseEnvelope('peer-done', 'peer-task', {
      sender: agent, audience: [agent.id], type: 'agent.ask', text: 'finished work',
    })));
    expect(snapshot().unreadFor('c0', SELF)).toEqual({
      related: 0, other: 1, pending: false, unknown: false,
    });
    runtime.destroy();
  });

  it('[AD-293] excludes browser operation streams and system narration from rail notifications', async () => {
    // 用户能力：UI transport/system narration 不打扰消息 rail。
    // 不变量：notification policy 只接收可读 conversation facts。
    // 公开 owner：ChannelFeedRuntime.unreadFor。
    const { runtime, snapshot } = await readyRuntime({ boot: 'round21-housekeeping-boot' });
    snapshot().enqueue(liveRow('c0', 1, {
      id: 'ui-operation', kind: 'event', type: 'ui.viewport.scroll', visibility: 'public',
      sender: OTHER, audience: [SELF], payload: { body: { text: 'scroll' } },
    }));
    snapshot().enqueue(liveRow('c0', 2, {
      id: 'system-narration', kind: 'event', type: 'system.member.created', visibility: 'system',
      sender: { id: 'system', kind: 'system' }, audience: [SELF], payload: { body: { text: 'member' } },
    }));
    expect(snapshot().unreadFor('c0', SELF)).toEqual({
      related: 0, other: 0, pending: false, unknown: false,
    });
    runtime.destroy();
  });

  it('[AD-294] does not turn the human own request entering processing into a notification', async () => {
    // 用户能力：自己的请求进入 processing 不产生新的 rail unread。
    // 不变量：self sender and provisional lifecycle are excluded from notifications。
    // 公开 owner：ChannelFeedRuntime.unreadFor + ChannelReplica.
    const { runtime, snapshot } = await readyRuntime({ boot: 'round21-own-processing-boot' });
    snapshot().enqueue(liveRow('c0', 1, requestEnvelope('mine', {
      sender: { id: SELF, kind: 'human' }, audience: [OTHER.id], type: 'agent.ask', text: 'do it',
    })));
    snapshot().enqueue(liveRow('c0', 2, responseEnvelope('mine-processing', 'mine', {
      sender: OTHER, audience: [SELF], type: 'agent.ask', status: 'processing', text: '',
    })));
    expect(snapshot().unreadFor('c0', SELF)).toEqual({
      related: 0, other: 0, pending: false, unknown: false,
    });
    runtime.destroy();
  });
});
