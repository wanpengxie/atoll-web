// @vitest-environment jsdom
// Round 25 re-verifies the current public Feed/cursor owner and records the
// next ordinary product-gap cases.  Every red assertion is an ordinary `it`:
// a failure is evidence for the named owner, never an expected-fail shortcut.
import React from 'react';
import {
  cleanup, fireEvent, render, screen, within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { selectFeatureSearchIndex, searchFeatureIndex } from '../src/model/feature-search.js';
import { WorkspaceLayout } from '../src/app/WorkspaceLayout.jsx';
import { WorkspaceFeatures } from '../src/ui/features/WorkspaceFeatures.jsx';
import { ChannelAdministrationPanel } from '../src/ui/features/governance/GovernanceFeature.jsx';

const SELF = 'human:round25:1';
const OTHER = { id: 'agent:round25:worker', kind: 'agent' };
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
  boot = `round25-boot-${++serial}`,
  principal = `round25-principal-${serial}`,
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
  return { runtime, snapshot: () => runtime.getSnapshot(), channelId, generation, boot, principal };
}

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
      viewKey: `${channelId}:round25-cursor`,
      activationID: `round25-activation-${channelId}`,
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

function activityRow(channelId, seq, envelope) {
  return {
    channel_id: channelId,
    seq,
    envelope: {
      ts: 1_700_000_000_000 + seq,
      visibility: 'public',
      audience: ['human:root:1'],
      sender: { kind: 'human', id: 'human:root:1' },
      ...envelope,
    },
  };
}

function approvalState() {
  const store = createChannelReplicaStore();
  store.commit(activityRow('c1', 4, {
    id: 'approval-1',
    kind: 'request',
    type: 'human.approve',
    sender: { kind: 'agent', id: 'agent:worker:1' },
    audience: ['human:root:1'],
    payload: { body: { title: '批准上线' } },
  }));
  store.commit(activityRow('c1', 5, {
    id: 'approval-result',
    kind: 'response',
    type: 'human.approve',
    parent_id: 'approval-1',
    sender: { kind: 'human', id: 'human:root:1' },
    payload: { body: { status: 'failed', detail: '审批失败' } },
  }));
  return store.state('c1');
}

const channels = [{ id: 'c1', name: '频道 c1', access: 'member_active' }];
const tasks = [{
  key: 'approval:c1:approval-1',
  channelId: 'c1',
  kind: 'approval',
  title: '批准上线',
  state: 'failed',
  updatedAt: 6,
  source: {
    channelId: 'c1', view: 'tasks', objectType: 'work_item', objectId: 'approval:c1:approval-1',
  },
}];

function session() {
  return {
    wireState: 'open',
    me: { id: 'human:root:1', display_name: 'Root' },
    onLogout: vi.fn(),
  };
}

function navigation(activeChannelId = 'c0', {
  access = 'member_active',
  terminalVisible = false,
  terminalChannels = new Set(),
} = {}) {
  if (terminalVisible) terminalChannels.add(activeChannelId);
  const channelRows = [
    { id: 'c0', name: 'c0', access: 'member_active' },
    { id: 'c1', name: 'c1', access: 'member_active' },
    { id: 'c2', name: 'c2', access: 'member_active' },
  ];
  const active = channelRows.find((channel) => channel.id === activeChannelId)
    || { id: activeChannelId, name: activeChannelId, access };
  return {
    channels: channelRows,
    channel: { ...active, access },
    activeChannelId,
    activeView: 'conversation',
    unread: {},
    agentActivity: { byChannel: {} },
    select: vi.fn(),
    setActiveView: vi.fn(),
    openSearch: vi.fn(),
    openSpaceAdministration: vi.fn(),
    openRoster: vi.fn(),
    get terminalVisible() { return terminalChannels.has(activeChannelId); },
    openTerminal: vi.fn(() => {
      if (terminalChannels.has(activeChannelId)) terminalChannels.delete(activeChannelId);
      else terminalChannels.add(activeChannelId);
    }),
  };
}

function terminalFeatures(navigationState) {
  return <div data-testid="terminal-features">
    <WorkspaceFeatures
      activeView="conversation"
      channel={{ id: navigationState.activeChannelId, name: navigationState.activeChannelId }}
      contentVisible
      terminal={{
        mounted: true,
        visible: navigationState.terminalVisible,
        channelId: navigationState.activeChannelId,
        devices: [],
        deviceId: '',
        canWrite: false,
        transportOpen: true,
        available: true,
        commands: { close: navigationState.openTerminal },
      }}
    />
  </div>;
}

function renderWorkspace(navigationState) {
  return render(<WorkspaceLayout
    session={session()}
    navigation={navigationState}
    conversation={{ element: <div data-testid="message-surface">消息</div> }}
    features={terminalFeatures(navigationState)}
  />);
}

function governance({ commands = {}, ...rest } = {}) {
  return render(<ChannelAdministrationPanel
    channel={{ id: 'c0', qualified_name: 'c0' }}
    port={{ commands, children: [], ...rest }}
    onClose={vi.fn()}
  />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const runtime of activeRuntimes) runtime.destroy();
  activeRuntimes.clear();
  globalThis.localStorage?.clear();
});

describe('A-D round 25 public-owner evidence', () => {
  it('[AD-157] fences cache ingress at a replacement boot epoch', async () => {
    // 用户能力：旧 boot 的缓存完成不能重新出现在新频道世界。
    // 不变量：boot/Replica epoch 是 cache admission fence；公开 owner：ChannelFeedRuntime.enqueue。
    const { runtime, snapshot } = await readyRuntime({ boot: 'round25-old-boot' });
    await snapshot().setHistoryGrants([{ channel_id: 'c0', head_seq: 0 }], {
      generation: 1, boot: 'round25-new-boot', focus: 'c0',
    });
    expect(snapshot().enqueue(liveRow('c1', 3, requestEnvelope('stale-cache'), 1, 'cache'))).toBe(true);
    expect(snapshot().stateFor('c1')?.rows.has(3)).not.toBe(true);
    expect(snapshot().historyFor('c1').attached).toBe(false);
    runtime.destroy();
  });

  it('[AD-158] fences cache ingress at the current attach grant set', async () => {
    // 用户能力：频道撤销后，在途 hydration 不能落入 c1 账本。
    // 不变量：attach grant 是跨频道 cache admission 的唯一边界；公开 owner：setHistoryGrants/enqueue。
    const { runtime, snapshot } = await readyRuntime({
      entries: [{ channel_id: 'c0', head_seq: 0 }, { channel_id: 'c1', head_seq: 0 }],
      boot: 'round25-grant-old-boot',
    });
    await snapshot().setHistoryGrants([{ channel_id: 'c0', head_seq: 0 }], {
      generation: 1, boot: 'round25-grant-new-boot', focus: 'c0',
    });
    expect(snapshot().enqueue(liveRow('c1', 3, requestEnvelope('revoked-cache'), 1, 'cache'))).toBe(true);
    expect(snapshot().stateFor('c1')?.rows.has(3)).not.toBe(true);
    expect(snapshot().historyFor('c1').attached).toBe(false);
    runtime.destroy();
  });

  it('[AD-167] blocks refreshChannel while revoked and resumes only after regrant', async () => {
    // 用户能力：撤销期间不发 freshness probe，重新授权后恢复一次 probe。
    // 不变量：refreshChannel 只能使用当前 grant generation；公开 owner：refreshChannel/channelMeta。
    const options = runtimeOptions('c0');
    options.wireRef.current = {
      channelMeta: vi.fn(async () => ({ channel_id: 'c0', head_seq: 0, has_rows: false })),
    };
    const { runtime, snapshot } = await readyRuntime({ options, boot: 'round25-refresh-boot' });
    await snapshot().setHistoryGrants([], { generation: 1, boot: 'round25-refresh-boot', focus: 'c0' });
    expect(snapshot().historyFor('c0').attached).toBe(false);
    await snapshot().refreshChannel('c0');
    expect(options.wireRef.current.channelMeta).not.toHaveBeenCalled();
    await snapshot().setHistoryGrants([{ channel_id: 'c0', head_seq: 0 }], {
      generation: 2, boot: 'round25-refresh-next-boot', focus: 'c0',
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
      generation: 2, boot: 'round25-refresh-next-boot', focus: 'c0',
    });
    releaseProbe({ channel_id: 'c0', head_seq: 0, has_rows: false });
    await expect(pendingRefresh).resolves.toBe(false);
    runtime.destroy();
  });

  it('[AD-288] validates persisted cursor facts against the active authority tuple', async () => {
    // 用户能力：旧 principal/world 的持久化事实不能污染当前世界。
    // 不变量：cursor restore 由当前 authority tuple 校验；公开 owner：prepareLocalReplica/historyFor。
    const principal = 'round25-authority-principal';
    const boot = 'round25-authority-boot';
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
    // 不变量：恢复 high-water 不得超过当前 ledger head；公开 owner：ChannelFeedRuntime.historyFor。
    const principal = 'round25-clamp-principal';
    const boot = 'round25-clamp-boot';
    localStorage.setItem(`atoll.feed-cursors.v1.${principal}\u0000${boot}`, JSON.stringify({
      reads: { c0: 999 }, notifications: { c0: 999 },
    }));
    const { runtime, snapshot } = await readyRuntime({
      principal, boot, entries: [{ channel_id: 'c0', head_seq: 40, has_rows: true }],
    });
    expect(snapshot().historyFor('c0').notificationHighWater).toBeLessThanOrEqual(40);
    runtime.destroy();
  });

  it('[AD-170] removes a cached row when a current-channel probe is forbidden', async () => {
    // 用户能力：forbidden 收敛后用户不可再看到旧缓存行。
    // 不变量：access revoke 与 Replica projection 必须同一 owner 清理；公开 owner：refreshChannel + Replica。
    const options = runtimeOptions('c0');
    options.wireRef.current = {
      channelMeta: vi.fn().mockRejectedValue(Object.assign(new Error('forbidden'), { code: 'forbidden' })),
    };
    const { runtime, snapshot } = await readyRuntime({ options, boot: 'round25-forbidden-boot' });
    snapshot().enqueue(liveRow('c0', 1, {
      id: 'cached-row', kind: 'event', type: 'human.note', visibility: 'public',
      sender: OTHER, audience: [SELF], payload: { body: { text: 'cached' } },
    }));
    await snapshot().refreshChannel('c0');
    expect(snapshot().historyFor('c0')).toMatchObject({ attached: false, messageCurrent: false });
    expect(snapshot().stateFor('c0')?.rows.size || 0).toBe(0);
    runtime.destroy();
  });

  it('[AD-182] carries terminal closure across bounded suffix pressure and older refill', async () => {
    // 用户能力：terminal-first 回页后仍显示已完成，而不是重新进入 Waiting。
    // 不变量：Replica trim 保留 compact terminal closure；公开 owner：loadHistory/pageEnd + Replica。
    const calls = [];
    const options = runtimeOptions('c0');
    options.wireRef.current = {
      historyBefore: vi.fn((channelId, beforeSeq, _limit, detail) => {
        const ref = `round25-trim-${calls.length + 1}`;
        calls.push({ channelId, beforeSeq, ref, ...detail });
        const receipt = Promise.resolve({ accepted: true, channel_id: channelId, generation: detail.generation });
        receipt.ref = ref;
        return receipt;
      }),
      cancelHistory: vi.fn(async () => {}),
    };
    const { runtime, snapshot } = await readyRuntime({
      options, entries: [{ channel_id: 'c0', head_seq: 960, has_rows: true }], boot: 'round25-trim-boot',
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
    // 不变量：sparse identity acknowledgement 不能退化成 boundary-only ack；公开 owner：acknowledgeNotifications/unreadFor。
    const { runtime, snapshot } = await readyRuntime({ boot: 'round25-sparse-boot' });
    snapshot().enqueue(liveRow('c0', 1, requestEnvelope('visible-a')));
    snapshot().enqueue(liveRow('c0', 2, requestEnvelope('unvisited')));
    snapshot().enqueue(liveRow('c0', 3, requestEnvelope('visible-b')));
    const feed = snapshot();
    expect(feed.acknowledgeNotifications(notificationConfirmation(feed, 'c0', 3))).toBe(3);
    expect(feed.unreadFor('c0', SELF).related).toBe(1);
    runtime.destroy();
  });

  it('[AD-291] preserves a weak all-message count beside the narrower @me count', async () => {
    // 用户能力：与我相关 unread 和频道内任意新内容分别可见。
    // 不变量：related 与 total 不能由同一 root set 代替；公开 owner：ChannelFeedRuntime.unreadFor。
    const { runtime, snapshot } = await readyRuntime({ boot: 'round25-count-boot' });
    snapshot().enqueue(liveRow('c0', 1, requestEnvelope('other-only', { audience: ['human:other:1'] })));
    expect(snapshot().unreadFor('c0', SELF).related).toBe(0);
    expect(snapshot().unreadFor('c0', SELF).total).toBeGreaterThan(0);
    runtime.destroy();
  });

  it('[AD-292] surfaces readable terminal content from an agent self-audience task', async () => {
    // 用户能力：agent 自身任务的 terminal user content 仍应唤醒用户。
    // 不变量：queued/processing/progress 非通知，terminal content 不得丢失；公开 owner：unreadFor + Replica。
    const agent = { id: 'agent:round25:self-task', kind: 'agent' };
    const { runtime, snapshot } = await readyRuntime({ boot: 'round25-self-task-boot' });
    snapshot().enqueue(liveRow('c0', 1, requestEnvelope('self-task', {
      sender: agent, audience: [agent.id], type: 'agent.ask', text: 'work',
    })));
    snapshot().enqueue(liveRow('c0', 2, responseEnvelope('self-queued', 'self-task', {
      sender: agent, audience: [agent.id], type: 'agent.ask', status: 'queued', text: '',
    })));
    snapshot().enqueue(liveRow('c0', 3, responseEnvelope('self-processing', 'self-task', {
      sender: agent, audience: [agent.id], type: 'agent.ask', status: 'processing', text: '',
    })));
    expect(snapshot().unreadFor('c0', SELF)).toEqual({ related: 0, total: 0 });
    snapshot().enqueue(liveRow('c0', 4, responseEnvelope('self-done', 'self-task', {
      sender: agent, audience: [agent.id], type: 'agent.ask', text: 'finished work',
    })));
    expect(snapshot().unreadFor('c0', SELF)).toEqual({ related: 0, total: 1 });
    runtime.destroy();
  });

  it('[AD-002] exposes terminal, WorkItem, and Operation as one locatable business fact', () => {
    // 用户能力：活动中心合并同一 request 的终态、任务与操作，并返回公开来源。
    // 不变量：频道/request 去重边界不能泄露私有 ticket；公开 owner：selectFeatureSearchIndex。
    const operations = [{
      operationId: 'approval-submit', channelId: 'c1', requestId: 'approval-1',
      kind: 'message_submit', title: '提交审批', state: 'failed', updatedAt: 7,
      source: { channelId: 'c1', view: 'artifacts', objectType: 'operation', objectId: 'approval-submit' },
    }];
    const index = selectFeatureSearchIndex({
      states: [['c1', approvalState()]], channels, tasks, operations,
    });
    expect(index.filter((entry) => entry.kind === 'operation')).toHaveLength(1);
  });

  it('[AD-003] deduplicates Operation by channel/native id and retains latest unsettled state', () => {
    // 用户能力：重复上传只显示最新未收敛状态，完成项不出现。
    // 不变量：channel/native operation id 是去重边界；公开 owner：selectFeatureSearchIndex。
    const operations = [
      { operationId: 'upload-1', channelId: 'c1', title: '旧上传', state: 'transferring', updatedAt: 10 },
      { operationId: 'upload-1', channelId: 'c1', title: '新上传', state: 'waiting_ledger', updatedAt: 20 },
      { operationId: 'done-1', channelId: 'c1', title: '已完成', state: 'completed', updatedAt: 30 },
    ];
    const index = selectFeatureSearchIndex({ states: [], channels, operations });
    expect(index.filter((entry) => entry.kind === 'operation')).toEqual([
      expect.objectContaining({ id: 'upload-1', state: 'waiting_ledger' }),
    ]);
  });

  it('[AD-004] searches visible channels across operations with a public SourceRef', () => {
    // 用户能力：全局搜索命中进行中的操作并可回到 artifacts 来源。
    // 不变量：搜索只消费可见频道的公开 Operation projection；公开 owner：searchFeatureIndex。
    const operations = [{
      operationId: 'export-1', channelId: 'c1', title: '上传预算附件', state: 'waiting_ledger', updatedAt: 20,
      source: { channelId: 'c1', view: 'artifacts', objectType: 'operation', objectId: 'export-1' },
    }];
    const index = selectFeatureSearchIndex({ states: [], channels, operations });
    expect(searchFeatureIndex(index, '预算附件', { kinds: ['operation'] })).toEqual([
      expect.objectContaining({ kind: 'operation', source: expect.objectContaining({ objectId: 'export-1' }) }),
    ]);
  });

  it('[AD-093] provides a recent-reading drawer at the right edge', () => {
    // 用户能力：从终端/频道边缘打开最近阅读；不变量：Reading owner 提供入口与返回焦点。
    // 公开 owner contract：WorkspaceApp panel state → WorkspaceLayout edge
    // entry → WorkspaceRightPanel reading-history route；本fixture落在首个
    // WorkspaceLayout边界，确认该公开入口未被当前组合提供。
    // Shell handoff contract (proposed public port): the edge control invokes
    // navigation.openReadingHistory once; the current shell does not expose
    // this port yet, so the first assertion remains the product-gap evidence.
    const nav = navigation();
    nav.openReadingHistory = vi.fn();
    renderWorkspace(nav);
    const opener = screen.queryByRole('button', { name: '打开最近阅读' });
    expect(opener).toBeTruthy();
    if (opener) {
      opener.focus();
      fireEvent.click(opener);
      expect(nav.openReadingHistory).toHaveBeenCalledTimes(1);
    }
  });

  it('[AD-097] lets a fast reselect of the committed channel cancel the pending target', () => {
    // 用户能力：A→B 未 commit 时可立即反选 A；不变量：最新选择是唯一 pending owner；公开 owner：WorkspaceLayout。
    const nav = navigation();
    renderWorkspace(nav);
    fireEvent.click(screen.getByText('c1'));
    fireEvent.click(within(screen.getByRole('navigation', { name: '频道' })).getByRole('button', { name: /c0/ }));
    // c0 is already the committed identity: reselecting it cancels the
    // presentation handoff without replaying c0's canonical navigation side
    // effect.  The public terminal gate is the observable cancellation fact.
    expect(nav.select.mock.calls.map(([id]) => id)).toEqual(['c1']);
    expect(document.getElementById('workspace-terminal-toggle')?.disabled).toBe(false);
  });

  it('[AD-099] returns from an invalid target to the original channel and ends old pending handoff', () => {
    // 用户能力：失效目标经目录拒绝后回原频道；不变量：rollback 与 committed identity 同一 owner；公开 owner：useChannelNavigation directory projection + WorkspaceLayout presentation gate。
    const nav = navigation();
    const view = renderWorkspace(nav);
    fireEvent.click(screen.getByText('c1'));
    expect(nav.select).toHaveBeenCalledWith('c1');
    expect(screen.getByRole('button', { name: /终端/ }).disabled).toBe(true);

    // The directory may first publish the requested identity without a
    // readable channel row. That intermediate fact is not the rollback: the
    // shell must keep the old terminal command gated until the authority
    // owner publishes the fallback commit.
    const invalid = navigation('c1');
    invalid.channel = null;
    view.rerender(<WorkspaceLayout
      session={session()}
      navigation={invalid}
      conversation={{ element: <div data-testid="message-surface">消息</div> }}
      features={terminalFeatures(invalid)}
    />);
    expect(screen.getByRole('button', { name: /终端/ }).disabled).toBe(true);

    // The navigation owner completes rejection by publishing the last
    // committed identity. WorkspaceLayout consumes that public projection;
    // it must not synthesize a second select(c0) side effect.
    const fallback = navigation('c0');
    view.rerender(<WorkspaceLayout
      session={session()}
      navigation={fallback}
      conversation={{ element: <div data-testid="message-surface">消息</div> }}
      features={terminalFeatures(fallback)}
    />);
    expect(screen.getByRole('heading', { name: 'c0' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /终端/ }).disabled).toBe(false);
    expect(nav.select.mock.calls.map(([id]) => id)).toEqual(['c1']);
  });

  it('[AD-105] hands focus only to the latest target in a rapid A-to-B-to-A selection', () => {
    // 用户能力：快速反选最终只交接最新目标；不变量：旧 pending 不能重放焦点；公开 owner：WorkspaceLayout。
    const nav = navigation();
    renderWorkspace(nav);
    fireEvent.click(screen.getByText('c1'));
    fireEvent.click(within(screen.getByRole('navigation', { name: '频道' })).getByRole('button', { name: /c0/ }));
    // c0 is already committed: the public handoff owner cancels the stale
    // presentation gate without replaying c0's canonical navigation effect.
    // The enabled terminal entry is the observable no-stale-pending result.
    expect(nav.select.mock.calls.map(([id]) => id)).toEqual(['c1']);
    expect(document.getElementById('workspace-terminal-toggle')?.disabled).toBe(false);
  });

  it('[AD-106] retains a channel terminal split when leaving and returning', () => {
    // 用户能力：切走再回来保留该频道 terminal split；不变量：terminal/session/layout 按 channel 隔离；公开 owner：WorkspaceLayout + WorkspaceFeatures。
    const terminalChannels = new Set();
    const first = navigation('c0', { terminalVisible: true, terminalChannels });
    const view = renderWorkspace(first);
    const second = navigation('c1', { terminalVisible: false, terminalChannels });
    view.rerender(<WorkspaceLayout
      session={session()} navigation={second}
      conversation={{ element: <div>消息</div> }} features={terminalFeatures(second)}
    />);
    const returned = navigation('c0', { terminalVisible: false, terminalChannels });
    view.rerender(<WorkspaceLayout
      session={session()} navigation={returned}
      conversation={{ element: <div>消息</div> }} features={terminalFeatures(returned)}
    />);
    expect(document.getElementById('workspace-panel-terminal').hidden).toBe(false);
  });

  it('[AD-108] closing one channel split does not close another channel split', () => {
    // 用户能力：收起 c0 不影响 c1；不变量：terminal visibility 按 channel 隔离；公开 owner：WorkspaceLayout + WorkspaceFeatures。
    const terminalChannels = new Set();
    const first = navigation('c0', { terminalVisible: true, terminalChannels });
    const view = renderWorkspace(first);
    const second = navigation('c1', { terminalVisible: true, terminalChannels });
    view.rerender(<WorkspaceLayout
      session={session()} navigation={second}
      conversation={{ element: <div>消息</div> }} features={terminalFeatures(second)}
    />);
    second.openTerminal();
    const returned = navigation('c0', { terminalVisible: false, terminalChannels });
    view.rerender(<WorkspaceLayout
      session={session()} navigation={returned}
      conversation={{ element: <div>消息</div> }} features={terminalFeatures(returned)}
    />);
    expect(document.getElementById('workspace-panel-terminal').hidden).toBe(false);
  });

  it('[AD-149] opens an independent create dialog and focuses its name field', () => {
    // 用户能力：新建频道打开独立 dialog 并首先聚焦名称；不变量：dialog owner 负责 focus/submit；公开 owner：GovernanceFeature。
    governance({ commands: { submit: vi.fn() } });
    expect(screen.getByRole('dialog', { name: '新建频道' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('新频道名称'));
  });
});
