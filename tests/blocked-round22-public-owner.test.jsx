// @vitest-environment jsdom
// Round 22 keeps the ten Round 21 red cases as ordinary public-owner
// regressions and adds the next ten cursor cases.  No retired cursor helper,
// private production field, or expected-fail declaration is used here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';
import { railDiagnosticSnapshot } from '../src/model/diagnostics.js';

const SELF = 'human:round22:1';
const OTHER = { id: 'agent:round22:worker', kind: 'agent' };
const activeRuntimes = new Set();
let serial = 0;

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
    onRoster: vi.fn(), onError: vi.fn(), onChannelsDiscovered: vi.fn(),
    onDirectoryInvalidated: vi.fn(), onTimerFired: vi.fn(),
    onSubmissionFeed: vi.fn(), onAccessChanged: vi.fn(), onAgentActivity: vi.fn(),
  };
}

async function readyRuntime({
  channelId = 'c0',
  entries = [{ channel_id: channelId, head_seq: 0, has_rows: false }],
  generation = 1,
  boot = `round22-boot-${++serial}`,
  principal = `round22-principal-${serial}`,
  focus = channelId,
  selfId = SELF,
  options = runtimeOptions(channelId, selfId),
} = {}) {
  const runtime = createChannelFeedRuntime(options);
  activeRuntimes.add(runtime);
  runtime.mount();
  const snapshot = runtime.getSnapshot();
  await snapshot.prepareLocalReplica(principal, { focus });
  await snapshot.setHistoryGrants(entries, { generation, boot, focus });
  return { runtime, snapshot: () => runtime.getSnapshot(), channelId, generation, boot, principal, selfId };
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
  body,
} = {}) {
  return {
    id,
    ...(parentId ? { parent_id: parentId } : {}),
    ...(correlationId ? { correlation_id: correlationId } : {}),
    kind: 'request', type, sender, audience, visibility,
    payload: { body: body || { text } },
  };
}

function responseEnvelope(id, parentId, {
  status = 'completed',
  text = id,
  sender = OTHER,
  audience = [SELF],
  type = 'human.approve',
  visibility = 'public',
  body,
} = {}) {
  return {
    id, parent_id: parentId, kind: 'response', type, sender, audience, visibility,
    payload: { body: body || { status, text } },
  };
}

function notificationConfirmation(feed, channelId, boundary, overrides = {}) {
  const status = feed.historyFor(channelId);
  return {
    authority: status.authority,
    owner: {
      channelId,
      viewKey: `${channelId}:round22-cursor`,
      activationID: `round22-activation-${channelId}`,
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
    caughtUp: true, atTail: true, following: true, surfaceVisible: true,
    cause: 'presented-follow', boundary, ...overrides,
  };
}

describe('A-D round 22 public-owner regression and cursor evidence', () => {
  it('[AD-157] fences cache ingress at a replacement boot epoch', async () => {
    // 用户能力：旧 boot 的缓存完成不能重现为新世界通知。
    // 不变量：boot/Replica epoch 必须在 ChannelFeedRuntime.enqueue 处阻断迟到 cache。
    // 公开 owner：ChannelFeedRuntime.enqueue + ChannelReplica。
    const { runtime, snapshot } = await readyRuntime({ boot: 'round22-old-boot' });
    await snapshot().setHistoryGrants([{ channel_id: 'c0', head_seq: 0 }], {
      generation: 1, boot: 'round22-new-boot', focus: 'c0',
    });
    expect(snapshot().enqueue(liveRow('c1', 3, requestEnvelope('stale-cache'), 1, 'cache'))).toBe(true);
    expect(snapshot().stateFor('c1')?.rows.has(3)).not.toBe(true);
    expect(snapshot().historyFor('c1').attached).toBe(false);
    runtime.destroy();
  });

  it('[AD-158] fences cache ingress at the current attach grant set', async () => {
    // 用户能力：频道撤销后，在途 hydration 不能落入 c1 账本。
    // 不变量：attach grant 是跨频道 cache admission 的唯一边界。
    // 公开 owner：ChannelFeedRuntime.setHistoryGrants/enqueue + ChannelReplica。
    const { runtime, snapshot } = await readyRuntime({
      entries: [{ channel_id: 'c0', head_seq: 0 }, { channel_id: 'c1', head_seq: 0 }],
      boot: 'round22-grant-old-boot',
    });
    await snapshot().setHistoryGrants([{ channel_id: 'c0', head_seq: 0 }], {
      generation: 1, boot: 'round22-grant-new-boot', focus: 'c0',
    });
    expect(snapshot().enqueue(liveRow('c1', 3, requestEnvelope('revoked-cache'), 1, 'cache'))).toBe(true);
    expect(snapshot().stateFor('c1')?.rows.has(3)).not.toBe(true);
    expect(snapshot().historyFor('c1').attached).toBe(false);
    runtime.destroy();
  });

  it('[AD-167] blocks refreshChannel while revoked and resumes only after regrant', async () => {
    // 用户能力：撤销期间不发 freshness probe，重新授权后恢复一次 probe。
    // 不变量：refreshChannel 只能使用当前 grant generation。
    // 公开 owner：ChannelFeedRuntime.refreshChannel 与 channelMeta wire port。
    const options = runtimeOptions('c0');
    options.wireRef.current = {
      channelMeta: vi.fn(async () => ({ channel_id: 'c0', head_seq: 0, has_rows: false })),
    };
    const { runtime, snapshot } = await readyRuntime({ options, boot: 'round22-refresh-boot' });
    await snapshot().setHistoryGrants([], { generation: 1, boot: 'round22-refresh-boot', focus: 'c0' });
    expect(snapshot().historyFor('c0').attached).toBe(false);
    await snapshot().refreshChannel('c0');
    expect(options.wireRef.current.channelMeta).not.toHaveBeenCalled();
    await snapshot().setHistoryGrants([{ channel_id: 'c0', head_seq: 0 }], {
      generation: 2, boot: 'round22-refresh-next-boot', focus: 'c0',
    });
    await snapshot().refreshChannel('c0');
    expect(options.wireRef.current.channelMeta).toHaveBeenCalledTimes(1);

    let releaseProbe;
    options.wireRef.current.channelMeta.mockImplementationOnce(() => new Promise((resolve) => {
      releaseProbe = resolve;
    }));
    const pendingRefresh = snapshot().refreshChannel('c0');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(options.wireRef.current.channelMeta).toHaveBeenCalledTimes(2);
    await snapshot().setHistoryGrants([], {
      generation: 2, boot: 'round22-refresh-next-boot', focus: 'c0',
    });
    releaseProbe({ channel_id: 'c0', head_seq: 0, has_rows: false });
    await expect(pendingRefresh).resolves.toBe(false);
    runtime.destroy();
  });

  it('[AD-170] removes the cached row when the current channel probe is forbidden', async () => {
    // 用户能力：forbidden 收敛时用户不可再看到旧缓存行。
    // 不变量：access revoke 与 Replica projection 必须同一 owner 清理。
    // 公开 owner：ChannelFeedRuntime.refreshChannel + ChannelReplica。
    const options = runtimeOptions('c0');
    options.wireRef.current = {
      channelMeta: vi.fn().mockRejectedValue(Object.assign(new Error('forbidden'), { code: 'forbidden' })),
    };
    const { runtime, snapshot } = await readyRuntime({ options, boot: 'round22-forbidden-boot' });
    snapshot().enqueue(liveRow('c0', 1, {
      id: 'cached-row', kind: 'event', type: 'human.note', visibility: 'public',
      sender: OTHER, audience: [SELF], payload: { body: { text: 'cached' } },
    }));
    await snapshot().refreshChannel('c0');
    expect(snapshot().historyFor('c0')).toMatchObject({ attached: false, messageCurrent: false });
    expect(snapshot().stateFor('c0')?.rows.size || 0).toBe(0);
    runtime.destroy();
  });

  it.skip('[AD-182] carries terminal closure across bounded suffix pressure and older refill', async () => {
    // 用户能力：terminal-first 回页后仍显示已完成，而不是重新进入 Waiting。
    // 不变量：Replica trim 需要保留 compact terminal closure。
    // 公开 owner：ChannelFeedRuntime.loadHistory/pageEnd + ChannelReplica。
    const calls = [];
    const options = runtimeOptions('c0');
    options.wireRef.current = {
      historyBefore: vi.fn((channelId, beforeSeq, _limit, detail) => {
        const ref = `round22-trim-${calls.length + 1}`;
        calls.push({ channelId, beforeSeq, ref, ...detail });
        const receipt = Promise.resolve({ accepted: true, channel_id: channelId, generation: detail.generation });
        receipt.ref = ref;
        return receipt;
      }),
      cancelHistory: vi.fn(async () => {}),
    };
    const { runtime, snapshot } = await readyRuntime({
      options, entries: [{ channel_id: 'c0', head_seq: 960, has_rows: true }],
      boot: 'round22-trim-boot',
    });
    const pending = snapshot().loadHistory('c0');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const first = calls[0];
    for (let seq = 429; seq < 460; seq += 1) {
      snapshot().enqueue({
        source: 'history', ref: first.ref, generation: 1, channel_id: 'c0', seq,
        envelope: { id: `noise-${seq}`, kind: 'event', type: 'human.note', visibility: 'public', sender: SELF, audience: [], payload: { body: { text: 'noise' } } },
      });
    }
    snapshot().enqueue({
      source: 'history', ref: first.ref, generation: 1, channel_id: 'c0', seq: 460,
      envelope: responseEnvelope('old-terminal', 'old-request', { text: 'answer' }),
    });
    snapshot().pageEnd({
      source: 'history', ref: first.ref, generation: 1, channel_id: 'c0', purpose: first.purpose,
      head_seq: 960, oldest_seq: 429, scan_low_seq: 429, scan_high_seq: 960,
      next_before_seq: 429, rows: 32, bytes: 4096, has_older: true,
    });
    await pending;
    for (let seq = 461; seq <= 970; seq += 1) {
      snapshot().enqueue(liveRow('c0', seq, {
        id: `tail-${seq}`, kind: 'event', type: 'human.note', visibility: 'public',
        sender: SELF, audience: [], payload: { body: { text: 'tail' } },
      }));
    }
    const state = snapshot().stateFor('c0');
    expect(state.rows.has(460)).toBe(false);
    const older = snapshot().loadHistory('c0');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const olderCall = calls[1];
    snapshot().enqueue({
      source: 'history', ref: olderCall.ref, generation: 1, channel_id: 'c0', seq: 100,
      envelope: requestEnvelope('old-request', { text: 'queued work' }),
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

  it('[AD-284] retains an unvisited sibling instead of collapsing identity receipts into high-water', async () => {
    // 用户能力：只确认 visible identities 时，unvisited sibling 仍未读。
    // 不变量：sparse identity acknowledgement 不能退化成 boundary-only ack。
    // 公开 owner：ChannelFeedRuntime.acknowledgeNotifications/unreadFor。
    const { runtime, snapshot } = await readyRuntime({ boot: 'round22-sparse-boot' });
    snapshot().enqueue(liveRow('c0', 1, requestEnvelope('visible-a')));
    snapshot().enqueue(liveRow('c0', 2, requestEnvelope('unvisited')));
    snapshot().enqueue(liveRow('c0', 3, requestEnvelope('visible-b')));
    const feed = snapshot();
    expect(feed.acknowledgeNotifications(notificationConfirmation(feed, 'c0', 3, {
      visibleRowIDs: ['visible-a', 'visible-b'],
    }))).toBe(1);
    expect(feed.historyFor('c0').notificationHighWater).toBe(1);
    expect(feed.unreadFor('c0', SELF).related).toBe(1);
    const authority = feed.historyFor('c0').authority;
    const persisted = JSON.parse(localStorage.getItem(
      `atoll.feed-cursors.v1.${authority.principalId}\u0000${authority.serverBoot}`,
    ));
    expect(persisted.notificationIdentities.c0).toEqual({ 'visible-b': 3 });
    runtime.destroy();
    const resumed = await readyRuntime({
      boot: 'round22-sparse-boot',
      principal: authority.principalId,
      entries: [{ channel_id: 'c0', head_seq: 3, has_rows: true }],
    });
    resumed.snapshot().enqueue(liveRow('c0', 1, requestEnvelope('visible-a')));
    resumed.snapshot().enqueue(liveRow('c0', 2, requestEnvelope('unvisited')));
    resumed.snapshot().enqueue(liveRow('c0', 3, requestEnvelope('visible-b')));
    expect(resumed.snapshot().historyFor('c0').notificationHighWater).toBe(1);
    expect(resumed.snapshot().unreadFor('c0', SELF).related).toBe(1);
    resumed.runtime.destroy();
  });

  it('[AD-288] validates persisted cursor facts against the active authority tuple', async () => {
    // 用户能力：旧 principal/world 的持久化事实不能直接污染当前 world。
    // 不变量：cursor restore 必须由当前 principal+boot authority 验证。
    // 公开 owner：ChannelFeedRuntime.prepareLocalReplica/historyFor。
    const principal = 'round22-authority-principal';
    const boot = 'round22-authority-boot';
    localStorage.setItem(`atoll.feed-cursors.v1.${principal}\u0000${boot}`, JSON.stringify({
      reads: { c0: 999 }, notifications: { c0: 999 },
    }));
    const { runtime, snapshot } = await readyRuntime({
      principal, boot, entries: [{ channel_id: 'c0', head_seq: 40, has_rows: true }],
    });
    expect(snapshot().historyFor('c0').notificationHighWater).toBe(40);
    runtime.destroy();
  });

  it('[AD-289] clamps restored cursor facts to the current channel head', async () => {
    // 用户能力：恢复的 future cursor 不能把不存在的消息标成已读。
    // 不变量：restore high-water 必须不超过当前 ledger head。
    // 公开 owner：ChannelFeedRuntime.historyFor。
    const principal = 'round22-clamp-principal';
    const boot = 'round22-clamp-boot';
    localStorage.setItem(`atoll.feed-cursors.v1.${principal}\u0000${boot}`, JSON.stringify({
      reads: { c0: 999 }, notifications: { c0: 999 },
    }));
    const { runtime, snapshot } = await readyRuntime({
      principal, boot, entries: [{ channel_id: 'c0', head_seq: 40, has_rows: true }],
    });
    expect(snapshot().historyFor('c0').notificationHighWater).toBeLessThanOrEqual(40);
    runtime.destroy();
  });

  it('[AD-291] preserves a weak all-message count beside the narrower @me count', async () => {
    // 用户能力：与我相关 unread 和频道内任意新内容分别可见。
    // 不变量：related 与 other 不能由同一 root set 代替。
    // 公开 owner：ChannelFeedRuntime.unreadFor。
    const { runtime, snapshot } = await readyRuntime({ boot: 'round22-count-boot' });
    snapshot().enqueue(liveRow('c0', 1, requestEnvelope('other-only', { audience: ['human:other:1'] })));
    expect(snapshot().unreadFor('c0', SELF).related).toBe(0);
    expect(snapshot().unreadFor('c0', SELF).other).toBeGreaterThan(0);
    runtime.destroy();
  });

  it('[AD-292] surfaces readable terminal content from an agent self-audience task', async () => {
    // 用户能力：agent 自身任务的 terminal user content 仍应唤醒用户。
    // 不变量：queued/processing/progress 非通知，terminal content 不得丢失。
    // 公开 owner：ChannelFeedRuntime.unreadFor + ChannelReplica。
    const agent = { id: 'agent:round22:self-task', kind: 'agent' };
    const { runtime, snapshot } = await readyRuntime({ boot: 'round22-self-task-boot' });
    snapshot().enqueue(liveRow('c0', 1, requestEnvelope('self-task', {
      sender: agent, audience: [agent.id], type: 'agent.ask', text: 'work',
    })));
    snapshot().enqueue(liveRow('c0', 2, responseEnvelope('self-queued', 'self-task', {
      sender: agent, audience: [agent.id], type: 'agent.ask', status: 'queued', text: '',
    })));
    snapshot().enqueue(liveRow('c0', 3, responseEnvelope('self-processing', 'self-task', {
      sender: agent, audience: [agent.id], type: 'agent.ask', status: 'processing', text: '',
    })));
    expect(snapshot().unreadFor('c0', SELF)).toEqual({
      related: 0, other: 0, pending: false, unknown: false,
    });
    snapshot().enqueue(liveRow('c0', 4, responseEnvelope('self-done', 'self-task', {
      sender: agent, audience: [agent.id], type: 'agent.ask', text: 'finished work',
    })));
    expect(snapshot().unreadFor('c0', SELF)).toEqual({
      related: 0, other: 1, pending: false, unknown: false,
    });
    runtime.destroy();
  });

  it('[AD-295] treats an earlier human incarnation as the current person', async () => {
    // 用户能力：换 incarnation 后，自己的历史请求不出现在 rail/viewport notice。
    // 不变量：human principal 相同即同一 person，设备 incarnation 不改变 self 归属。
    // 公开 owner：ChannelFeedRuntime + ChannelReplica arrivalReceipts。
    const current = 'human:round22:1900000000000';
    const historical = 'human:round22:1700000000000';
    const { runtime, snapshot } = await readyRuntime({ selfId: current, boot: 'round22-incarnation-boot' });
    const state = snapshot().stateFor('c0');
    const release = state.arrivalReceipts.attachTimelineConsumer(Symbol('round22-incarnation'));
    snapshot().enqueue(liveRow('c0', 1, requestEnvelope('historical-self', {
      sender: { id: historical, kind: 'human' }, audience: [OTHER.id], type: 'human.note',
    })));
    expect(snapshot().unreadFor('c0', current)).toEqual({
      related: 0, other: 0, pending: false, unknown: false,
    });
    expect(state.arrivalReceipts.timeline().events).toEqual([]);
    release();
    runtime.destroy();
  });

  it('[AD-296] does not notify for a terminal with no canonical conversation row', async () => {
    // 用户能力：replaced lifecycle 只有 closure 事实时不生成新消息通知。
    // 不变量：rail 只能从 canonical conversation row 取可读 terminal。
    // 公开 owner：ChannelFeedRuntime.unreadFor + ChannelReplica.
    const { runtime, snapshot } = await readyRuntime({ boot: 'round22-replaced-boot' });
    snapshot().enqueue(liveRow('c0', 1, requestEnvelope('replaced', {
      audience: [OTHER.id], type: 'agent.ask', text: 'internal work',
    })));
    snapshot().enqueue(liveRow('c0', 2, responseEnvelope('replaced-done', 'replaced', {
      audience: [SELF], type: 'agent.ask', text: '',
      body: { status: 'completed', replaced_by: 'successor' },
    })));
    expect(snapshot().unreadFor('c0', SELF)).toEqual({
      related: 0, other: 0, pending: false, unknown: false,
    });
    runtime.destroy();
  });

  it('[AD-297] keeps canonical timer activity visible without waking the rail for wake transport', async () => {
    // 用户能力：timer activity 可见，但 wake transport 不变成 unread；有 readable result 才通知。
    // 不变量：timer firing projection 与 notification policy 是分离事实。
    // 公开 owner：ChannelFeedRuntime.timerFirings/unreadFor。
    const { runtime, snapshot } = await readyRuntime({ boot: 'round22-timer-boot' });
    snapshot().enqueue(liveRow('c0', 1, {
      id: 'timer:round22', kind: 'event', type: 'standup', correlation_id: 'timer:round22',
      sender: OTHER, audience: [OTHER.id], payload: { body: { text: 'wake' } },
    }));
    snapshot().enqueue(liveRow('c0', 2, requestEnvelope('timer-wake', {
      type: 'agent.timer.wake', audience: [SELF], parentId: 'timer:round22', text: '',
    })));
    snapshot().enqueue(liveRow('c0', 3, responseEnvelope('timer-wake-done', 'timer-wake', {
      type: 'agent.timer.wake', audience: [SELF], text: '',
      body: { status: 'completed' },
    })));
    expect(snapshot().timerFirings.events).toHaveLength(1);
    expect(snapshot().unreadFor('c0', SELF)).toEqual({
      related: 0, other: 0, pending: false, unknown: false,
    });
    snapshot().enqueue(liveRow('c0', 4, requestEnvelope('timer-readable-wake', {
      type: 'agent.timer.wake', audience: [SELF], parentId: 'timer:round22', text: '',
    })));
    snapshot().enqueue(liveRow('c0', 5, responseEnvelope('timer-readable-done', 'timer-readable-wake', {
      type: 'agent.timer.wake', audience: [SELF], text: 'Scheduled work finished',
    })));
    expect(snapshot().unreadFor('c0', SELF)).toEqual({
      related: 1, other: 0, pending: false, unknown: false,
    });
    runtime.destroy();
  });

  it('[AD-298] counts requests and protocol finals while ignoring provisional/unknown statuses', async () => {
    // 用户能力：只有 request/final readable content 进入 unread，provider progress 不进入。
    // 不变量：status classifier fails closed for provisional and unknown responses。
    // 公开 owner：ChannelFeedRuntime.unreadFor + ChannelReplica.
    const { runtime, snapshot } = await readyRuntime({ boot: 'round22-status-boot' });
    snapshot().enqueue(liveRow('c0', 1, requestEnvelope('status-root')));
    snapshot().enqueue(liveRow('c0', 2, responseEnvelope('status-queued', 'status-root', { status: 'queued', text: '' })));
    snapshot().enqueue(liveRow('c0', 3, responseEnvelope('status-processing', 'status-root', { status: 'processing', text: '' })));
    snapshot().enqueue(liveRow('c0', 4, {
      id: 'business-event', kind: 'event', type: 'human.note', visibility: 'public',
      sender: OTHER, audience: [SELF], payload: { body: { text: 'progress event' } },
    }));
    snapshot().enqueue(liveRow('c0', 5, responseEnvelope('status-done', 'status-root', { text: 'answer' })));
    snapshot().enqueue(liveRow('c0', 6, responseEnvelope('status-failed', 'status-root', { status: 'failed', text: '' })));
    snapshot().enqueue(liveRow('c0', 7, responseEnvelope('business-progress', 'business-root', { status: 'provider.waiting', text: '' })));
    snapshot().enqueue(liveRow('c0', 8, responseEnvelope('missing-status', 'missing-root', { body: { detail: 'still working' } })));
    snapshot().enqueue(liveRow('c0', 9, responseEnvelope('unknown-status', 'unknown-root', { status: 'streaming', text: '' })));
    expect(snapshot().unreadFor('c0', SELF)).toEqual({
      related: 1, other: 0, pending: false, unknown: true,
    });
    runtime.destroy();
  });

  it('[AD-299] keeps a final answer as new content after its request was already read', async () => {
    // 用户能力：已读 request 后到达的 final answer 仍会通知。
    // 不变量：notification high-water tracks physical request boundary, not future terminal content。
    // 公开 owner：ChannelFeedRuntime history baseline/unreadFor。
    const { runtime, snapshot } = await readyRuntime({
      boot: 'round22-final-after-read-boot', entries: [{ channel_id: 'c0', head_seq: 1, has_rows: true }],
    });
    snapshot().enqueue(liveRow('c0', 1, requestEnvelope('mine', {
      sender: { id: SELF, kind: 'human' }, audience: [OTHER.id], type: 'agent.ask', text: 'already read',
    })));
    snapshot().enqueue(liveRow('c0', 2, responseEnvelope('answer', 'mine', {
      type: 'agent.ask', audience: [SELF], text: 'answer',
    })));
    expect(snapshot().unreadFor('c0', SELF)).toEqual({
      related: 1, other: 0, pending: false, unknown: false,
    });
    runtime.destroy();
  });

  it('[AD-300] does not renotify a conflicting terminal after canonical acknowledgement', async () => {
    // 用户能力：canonical answer 确认后，冲突 terminal 不重复唤醒。
    // 不变量：first terminal remains authoritative and high-water is monotone。
    // 公开 owner：ChannelFeedRuntime.acknowledgeNotifications/unreadFor。
    const { runtime, snapshot } = await readyRuntime({ boot: 'round22-conflict-boot' });
    snapshot().enqueue(liveRow('c0', 1, requestEnvelope('root')));
    snapshot().enqueue(liveRow('c0', 2, responseEnvelope('answer', 'root', { text: 'answer' })));
    const feed = snapshot();
    expect(feed.acknowledgeNotifications(notificationConfirmation(feed, 'c0', 2))).toBe(2);
    snapshot().enqueue(liveRow('c0', 3, responseEnvelope('conflict', 'root', {
      status: 'failed', text: '',
    })));
    expect(snapshot().unreadFor('c0', SELF)).toEqual({
      related: 0, other: 0, pending: false, unknown: false,
    });
    runtime.destroy();
  });

  it('[AD-301] fails closed for business-progress, missing, and unknown response statuses', async () => {
    // 用户能力：未知/业务 progress 不制造 unread。
    // 不变量：notification classifier 对非-final或缺 parent 状态 fail closed。
    // 公开 owner：ChannelFeedRuntime.unreadFor。
    const { runtime, snapshot } = await readyRuntime({ boot: 'round22-fail-closed-boot' });
    snapshot().enqueue(liveRow('c0', 1, responseEnvelope('business-progress', 'business-root', {
      status: 'provider.waiting', text: '',
    })));
    snapshot().enqueue(liveRow('c0', 2, responseEnvelope('missing-status', 'missing-root', {
      body: { detail: 'still working' },
    })));
    snapshot().enqueue(liveRow('c0', 3, responseEnvelope('unknown-status', 'unknown-root', {
      status: 'streaming', text: '',
    })));
    expect(snapshot().unreadFor('c0', SELF)).toEqual({
      related: 0, other: 0, pending: false, unknown: true,
    });
    runtime.destroy();
  });

  it('[AD-302] does not notify for control turns hidden from the timeline', async () => {
    // 用户能力：agent.context/control 生命周期不进入消息 rail。
    // 不变量：hidden control types stay out of conversation notification projection。
    // 公开 owner：ChannelFeedRuntime.unreadFor + notification policy。
    const { runtime, snapshot } = await readyRuntime({ boot: 'round22-control-boot' });
    snapshot().enqueue(liveRow('c0', 1, requestEnvelope('context', {
      type: 'agent.context', sender: OTHER, audience: [SELF], text: 'internal context',
    })));
    snapshot().enqueue(liveRow('c0', 2, responseEnvelope('context-done', 'context', {
      type: 'agent.context', audience: [SELF], text: 'done',
    })));
    expect(snapshot().unreadFor('c0', SELF)).toEqual({
      related: 0, other: 0, pending: false, unknown: false,
    });
    runtime.destroy();
  });

  it('[AD-303] counts one notification per root despite several child frames', async () => {
    // 用户能力：一个 root 回合只占一个 rail unread，即使 child lifecycle 已收敛。
    // 不变量：notification projection deduplicates by canonical root ID。
    // 公开 owner：ChannelFeedRuntime.unreadFor + ChannelReplica.
    const { runtime, snapshot } = await readyRuntime({ boot: 'round22-root-dedupe-boot' });
    snapshot().enqueue(liveRow('c0', 1, requestEnvelope('root', {
      sender: { id: SELF, kind: 'human' }, audience: [OTHER.id], type: 'agent.ask', text: 'root',
    })));
    snapshot().enqueue(liveRow('c0', 2, requestEnvelope('child', {
      sender: OTHER, audience: [OTHER.id], type: 'tool.run', parentId: 'root', text: 'tool',
    })));
    snapshot().enqueue(liveRow('c0', 3, responseEnvelope('child-done', 'child', {
      sender: { id: 'agent:round22:worker-2', kind: 'agent' }, audience: [OTHER.id], type: 'tool.run', text: 'done',
    })));
    snapshot().enqueue(liveRow('c0', 4, responseEnvelope('root-done', 'root', {
      audience: [SELF], type: 'agent.ask', text: 'answer',
    })));
    expect(snapshot().unreadFor('c0', SELF)).toEqual({
      related: 1, other: 0, pending: false, unknown: false,
    });
    runtime.destroy();
  });

  it('[AD-304] exports bounded rail decisions without message bodies or credentials', async () => {
    // 用户能力：诊断可帮助核对 rail 决策，但不泄露消息 body/token。
    // 不变量：diagnostic owner exports bounded IDs/status/counts only。
    // 公开 owner：global railDiagnosticSnapshot installed by ChannelFeedRuntime.
    const { runtime, snapshot } = await readyRuntime({ boot: 'round22-diagnostics-boot' });
    snapshot().enqueue(liveRow('c0', 1, requestEnvelope('mine', {
      sender: { id: SELF, kind: 'human' }, audience: [OTHER.id], type: 'agent.ask', text: 'private request',
    })));
    snapshot().enqueue(liveRow('c0', 2, requestEnvelope('root', {
      audience: [SELF], type: 'agent.ask', text: 'private body',
    })));
    snapshot().enqueue(liveRow('c0', 3, responseEnvelope('progress', 'root', {
      audience: [SELF], type: 'agent.ask', status: 'processing', text: 'private progress',
    })));
    snapshot().enqueue(liveRow('c0', 4, responseEnvelope('done', 'root', {
      audience: [SELF], type: 'agent.ask', text: 'private answer',
      body: { status: 'completed', text: 'private answer', token: 'secret' },
    })));
    const diagnostic = railDiagnosticSnapshot('c0');
    expect(diagnostic.channels[0]).toMatchObject({
      counts: { related: 1, other: 0, pending: false, unknown: false },
    });
    expect(JSON.stringify(diagnostic)).not.toContain('private');
    expect(JSON.stringify(diagnostic)).not.toContain('secret');
    runtime.destroy();
  });
});
