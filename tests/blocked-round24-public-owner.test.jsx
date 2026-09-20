// @vitest-environment jsdom
// Round 24: independent evidence for twenty remaining A-D blocked rows.
// These are ordinary tests on purpose: a failing assertion is a reproducible
// product/owner gap, not an expected-failure completion signal.  The only
// row promoted by this packet is AD-167, whose public refresh admission fix
// landed before this verification.
import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';
import { ChannelAdministrationPanel, SpaceAdministrationPanel } from '../src/ui/features/governance/GovernanceFeature.jsx';
import { WorkspaceRightPanel } from '../src/ui/features/WorkspaceFeatures.jsx';
import { WorkspaceLayout } from '../src/app/WorkspaceLayout.jsx';
import { useComposerSubmissionRuntime } from '../src/ui/composer/index.js';
import { buildComposerModel, createComposerCommandRequest } from '../src/ui/composer/composer-model.js';
import { useTimelineRowRenderer } from '../src/ui/timeline/TimelineRowRenderer.jsx';
import { WaitingLayer, useWaitingEditingController } from '../src/ui/timeline/useWaitingEditingController.jsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const HUMAN = { id: 'human:round24:me', kind: 'human', name: '我' };
const AGENT = { id: 'agent:round24:worker', kind: 'agent', name: 'Agent' };
const OTHER = { id: 'agent:round24:other', kind: 'agent', name: 'Other' };
const CAPABILITIES = new Map([['agent:round24:worker', {
  describe: {
    types: new Map([
      ['agent.ask', {}],
      ['agent.hold', {}],
      ['agent.context', {}],
      ['agent.replace', { inputSchema: { properties: { expected_hold_id: { type: 'string' } } } }],
      ['agent.unhold', { inputSchema: { properties: { expected_hold_id: { type: 'string' } } } }],
    ]),
  },
}]]);

function request(id, text = '工作') {
  return {
    id, kind: 'request', type: 'agent.ask', ts: 100,
    sender: HUMAN, audience: [AGENT.id], visibility: 'public',
    payload: { body: { text } },
  };
}

function response(id, parentId, body = {}) {
  return {
    id, parent_id: parentId, kind: 'response', type: 'agent.ask', ts: 101,
    sender: AGENT, audience: [HUMAN.id], visibility: 'public',
    payload: { body },
  };
}

function waitingTurn(requestId = 'queued', text = '等待中的消息') {
  return {
    requestId,
    request: request(requestId, text),
    requestSeq: 1,
    status: 'queued',
    latestStatus: 'queued',
    terminal: null,
    provisional: [{
      seq: 2,
      envelope: response(`${requestId}-queued`, requestId, {
        status: 'queued', controls: [{ word: 'agent.replace' }, { word: 'agent.unhold' }],
      }),
    }],
  };
}

function waitingState(requestId = 'queued', text = '等待中的消息') {
  return { channelId: 'c0', timeline: [{ kind: 'turn', turn: waitingTurn(requestId, text) }] };
}

function feedOptions(overrides = {}) {
  return {
    wireRef: { current: null },
    rosterRef: { current: {
      self: () => 'human:round24:me',
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
    ...overrides,
  };
}

let serial = 0;
const activeRuntimes = new Set();
async function attachedRuntime({
  entries = [{ channel_id: 'c0', head_seq: 0, has_rows: false }],
  generation = 1,
  boot = `round24-boot-${++serial}`,
  focus = 'c0',
  principal = `round24-principal-${serial}`,
  options = feedOptions(),
} = {}) {
  const runtime = createChannelFeedRuntime(options);
  activeRuntimes.add(runtime);
  runtime.mount();
  const snapshot = runtime.getSnapshot();
  await snapshot.setHistoryGrants(entries, { generation, boot, focus });
  await snapshot.prepareLocalReplica(principal, { focus });
  return { runtime, snapshot: () => runtime.getSnapshot(), options, principal, boot, generation };
}

function liveRow(channelId, seq, envelope, generation = 1, source = 'live') {
  return { channel_id: channelId, seq, generation, source, envelope };
}

function envelope({ id, type = 'agent.ask', kind = 'response', sender = AGENT, audience = [HUMAN.id], ts = 100, body = {}, parent_id, ...rest }) {
  return {
    id, type, kind, sender, audience, ts,
    ...(parent_id ? { parent_id } : {}),
    payload: { body },
    ...rest,
  };
}

function turnOf({
  requestId = 'work', requestType = 'agent.ask', requestText = '整理报告', actorId = AGENT.id,
  status = 'processing', terminal = null, provisional = [], thread = [], requestExtra = {},
  terminalClosureOnly = false,
} = {}) {
  const req = envelope({
    id: requestId,
    type: requestType,
    kind: 'request',
    sender: HUMAN,
    audience: [actorId],
    body: { text: requestText, ...requestExtra },
  });
  return {
    requestId,
    request: req,
    requestSeq: 1,
    status,
    latestStatus: status,
    terminal,
    terminalClosureOnly,
    provisional,
    thread,
  };
}

function processFrame(id, seq, process, status = 'processing') {
  return { seq, status, envelope: envelope({ id, body: { status, process } }) };
}

function rendererOptions(state, overrides = {}) {
  return {
    state,
    names: new Map([[HUMAN.id, HUMAN.name], [AGENT.id, AGENT.name], [OTHER.id, OTHER.name]]),
    selfId: HUMAN.id,
    presentationEditing: null,
    browsingExpandedSlots: new Set(),
    effectiveFoldOverrides: new Map(),
    approvalStates: {},
    onCancel: vi.fn(),
    onTaskControl: vi.fn(),
    startEditing: vi.fn(),
    ...overrides,
  };
}

function renderTurnRow(turn, overrides = {}) {
  const state = { channelId: 'c0', narration: [] };
  const { result } = renderHook(() => useTimelineRowRenderer(rendererOptions(state, overrides)));
  const row = { id: turn.requestId, body: { kind: 'turn', turn, thread: turn.thread || [] } };
  const view = render(result.current.renderRow(row));
  return { result, view, state };
}

function session() {
  return { wireState: 'open', me: { id: HUMAN.id, display_name: 'Root' }, onLogout: vi.fn() };
}

function navigation() {
  return {
    channels: [{ id: 'c0', name: 'c0', access: 'member_active' }],
    channel: { id: 'c0', name: 'c0' },
    activeChannelId: 'c0', activeView: 'conversation', unread: {}, agentActivity: { byChannel: {} },
    select: vi.fn(), setActiveView: vi.fn(), openSearch: vi.fn(), openSpaceAdministration: vi.fn(),
  };
}

function governance({ commands = {}, ...rest } = {}) {
  return render(<ChannelAdministrationPanel
    channel={{ id: 'c0', qualified_name: 'c0' }}
    port={{ commands, children: [], ...rest }}
    onClose={vi.fn()}
  />);
}

function controlHarness({ principalId = HUMAN.id, cancel = vi.fn().mockResolvedValue({ ok: true }) } = {}) {
  const controls = new Map();
  const store = {
    restore: vi.fn().mockImplementation(async (principalId) => [...controls.values()]
      .filter((row) => row.principalId === principalId)),
    restoreDrafts: vi.fn().mockResolvedValue([]),
    putMany: vi.fn(async (owner, rows) => {
      for (const row of rows) controls.set(row.messageId, { ...row, principalId: owner });
      return rows.map((row) => ({ ...row, principalId: owner }));
    }),
    remove: vi.fn(async (_owner, messageId) => controls.delete(messageId)),
    close: vi.fn(),
  };
  return {
    activeChannelId: 'c0',
    principalId,
    producerOwnerToken: `owner:${principalId}`,
    serverWorld: 'world-a',
    wireState: 'open',
    wireRef: { current: { cancel } },
    accessRef: { current: { state: () => ({ relationship: 'member', existence: 'present', runtime: 'open', authorityEpoch: 1 }) } },
    generationFor: () => 1,
    outboxFactory: () => store,
    onError: vi.fn(),
    onNotice: vi.fn(),
    onFeedChanged: vi.fn(),
    onAccessChanged: vi.fn(),
    store,
  };
}

describe('A-D round 24 public-owner evidence', () => {
  it('[AD-167] fences refresh probes after revocation and admits the pending probe only after regrant', async () => {
    // 用户能力：撤销期间不发 freshness probe，重新授权后恢复一次 probe。
    // 不变量：refreshChannel 只能在当前 grant generation/attached epoch 内调用 wire。
    // 公开 owner：ChannelFeedRuntime.refreshChannel + channelMeta wire port。
    const options = feedOptions();
    options.wireRef.current = {
      channelMeta: vi.fn(async () => ({ channel_id: 'c0', head_seq: 0, has_rows: false })),
    };
    const { runtime, snapshot } = await attachedRuntime({ options, boot: 'round24-refresh-boot' });
    await snapshot().setHistoryGrants([], { generation: 1, boot: 'round24-refresh-boot', focus: 'c0' });
    expect(snapshot().historyFor('c0').attached).toBe(false);
    await snapshot().refreshChannel('c0');
    expect(options.wireRef.current.channelMeta).not.toHaveBeenCalled();

    await snapshot().setHistoryGrants([{ channel_id: 'c0', head_seq: 0 }], {
      generation: 2, boot: 'round24-refresh-regrant-boot', focus: 'c0',
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
      generation: 2, boot: 'round24-refresh-regrant-boot', focus: 'c0',
    });
    releaseProbe({ channel_id: 'c0', head_seq: 0, has_rows: false });
    await expect(pendingRefresh).resolves.toBe(false);
    runtime.destroy();
    activeRuntimes.delete(runtime);
  });

  it('[AD-027] keeps the committed Reading owner while a processing turn is edited', async () => {
    // 用户能力：编辑 processing turn 时，阅读位置和 Composer 编辑内容同时可用。
    // 不变量：Waiting/编辑不能替换 committed Reading owner。
    // 公开 owner：useWaitingEditingController + WaitingLayer。
    const processing = {
      requestId: 'work', request: request('work', 'edit without navigation'), requestSeq: 1,
      status: 'processing', latestStatus: 'processing', terminal: null,
      provisional: [{ seq: 2, envelope: response('work-p', 'work', { status: 'processing', turn_id: 'turn-edit', controls: [{ word: 'agent.replace' }] }) }],
    };
    const state = { channelId: 'c0', timeline: [{ kind: 'turn', turn: processing }] };
    const onTaskControl = vi.fn(async ({ type }) => (type === 'agent.hold' ? 'hold-edit' : `${type}-id`));
    const onComposerEditChange = vi.fn();
    const { result } = renderHook(() => useWaitingEditingController({
      state, pending: [], capabilityIndex: CAPABILITIES, onRequestCapability: vi.fn(), onTaskControl, onComposerEditChange,
    }));
    await act(async () => { await result.current.startEditing(processing, AGENT.id); });
    await waitFor(() => expect(onComposerEditChange).toHaveBeenLastCalledWith(expect.objectContaining({
      session: expect.objectContaining({ targetId: 'work', text: 'edit without navigation' }),
    })));
    render(<WaitingLayer
      turns={[processing]} state={state} names={new Map([[AGENT.id, AGENT.name]])} selfId={HUMAN.id}
      access="member_active" targetAuthority={{ current: true, actorIDs: new Set([AGENT.id]) }}
      capabilityIndex={CAPABILITIES} editing={result.current.presentationEditing}
      onCancel={vi.fn()} onControl={vi.fn()} onEdit={vi.fn()}
    />);
    expect(document.querySelector('[data-reading-container="following-tail"]')).not.toBeNull();
  });

  it('[AD-037] uses the committed hold owner after reconnect while editing the latest target', async () => {
    // 用户能力：断线重连后的编辑仍能保存到原 hold owner 的最新目标。
    // 不变量：释放/上下文使用 hold owner，不能被候选 callback 或旧 target 抢走。
    // 公开 owner：useWaitingEditingController。
    const state = waitingState('queued', 'reconnect edit');
    const onTaskControlA = vi.fn(async ({ type }) => (type === 'agent.hold' ? 'hold-a' : `${type}-a`));
    const onTaskControlB = vi.fn(async ({ type }) => `${type}-b`);
    const onTaskControlC = vi.fn(async ({ type }) => `${type}-c`);
    const onComposerEditChange = vi.fn();
    const common = { state, pending: [], capabilityIndex: CAPABILITIES, onComposerEditChange, onRequestCapability: vi.fn() };
    const { result, rerender } = renderHook((props) => useWaitingEditingController(props), {
      initialProps: { ...common, onTaskControl: onTaskControlA },
    });
    await act(async () => { await result.current.startEditing(state.timeline[0].turn, AGENT.id); });
    await waitFor(() => expect(onTaskControlA).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent.hold' })));
    state.timeline.push({ kind: 'turn', turn: {
      requestId: 'hold-a', request: { ...request('hold-a', ''), type: 'agent.hold', payload: { body: { target: 'queued' } } },
      requestSeq: 3, terminal: response('hold-a-d', 'hold-a', { status: 'completed' }), terminalSeq: 4, provisional: [],
    } });
    rerender({ ...common, onTaskControl: onTaskControlB });
    await waitFor(() => expect(onComposerEditChange).toHaveBeenLastCalledWith(expect.objectContaining({
      session: expect.objectContaining({ phase: 'editing' }),
    })));
    const latestState = waitingState('queued', 'latest committed reconnect target');
    latestState.timeline.push({ kind: 'turn', turn: {
      requestId: 'hold-a', request: { ...request('hold-a', ''), type: 'agent.hold', payload: { body: { target: 'queued' } } },
      requestSeq: 3, terminal: response('hold-a-d', 'hold-a', { status: 'completed' }), terminalSeq: 4, provisional: [],
    } });
    rerender({ ...common, state: latestState, onTaskControl: onTaskControlC });
    await waitFor(() => expect(onTaskControlA).toHaveBeenCalledWith(expect.objectContaining({
      type: 'agent.context', turn: latestState.timeline[0].turn,
    })));
    expect(onTaskControlB.mock.calls.some(([value]) => value.type === 'agent.context')).toBe(false);
    expect(onTaskControlC).not.toHaveBeenCalled();
  });

  it('[AD-156] keeps an inactive rail unknown until cached unread context and parent are folded', async () => {
    // 用户能力：非当前频道的未读在缓存上下文和 parent 完整前保持 unknown。
    // 不变量：notification 只能由当前 Replica/cache authority 证明。
    // 公开 owner：ChannelFeedRuntime + ChannelReplica。
    const { runtime, snapshot } = await attachedRuntime({ entries: [
      { channel_id: 'c0', head_seq: 0, has_rows: false }, { channel_id: 'c1', head_seq: 0, has_rows: false },
    ] });
    expect(snapshot().unreadFor('c1', HUMAN.id)).toMatchObject({ unknown: true });
    snapshot().enqueue(liveRow('c1', 1, {
      id: 'cached-request', kind: 'request', type: 'human.ask', visibility: 'public',
      sender: { id: 'human:round24:other', kind: 'human' }, audience: [HUMAN.id], payload: { body: { text: 'question' } },
    }, 1, 'cache'));
    snapshot().enqueue(liveRow('c1', 3, {
      id: 'cached-final', parent_id: 'cached-request', kind: 'response', type: 'human.ask', visibility: 'public',
      sender: OTHER, audience: [HUMAN.id], payload: { body: { status: 'completed', text: 'answer' } },
    }, 1, 'cache'));
    expect(snapshot().unreadFor('c1', HUMAN.id)).toEqual({ related: 1, total: 1 });
    runtime.destroy();
    activeRuntimes.delete(runtime);
  });

  it('[AD-159] keeps notification context unknown when physical reading advances without its parent', async () => {
    // 用户能力：物理阅读前进但 parent 缺失时，rail 不伪造已知未读数。
    // 不变量：physical read cursor 与 notification context completeness 独立。
    // 公开 owner：ChannelFeedRuntime.unreadFor/markRead。
    const { runtime, snapshot } = await attachedRuntime({ entries: [
      { channel_id: 'c0', head_seq: 0, has_rows: false }, { channel_id: 'c1', head_seq: 3, has_rows: true },
    ] });
    const history = snapshot().historyFor('c1');
    expect(snapshot().markRead('c1', {
      physicalSeq: 3, authority: history.authority, generation: history.generation,
      authorityRevision: history.notificationAuthorityRevision,
    })).toBe(3);
    expect(snapshot().unreadFor('c1', HUMAN.id)).toMatchObject({ unknown: true });
    runtime.destroy();
    activeRuntimes.delete(runtime);
  });

  it('[AD-160] keeps an inactive granted notification unknown while local Meta never settles', async () => {
    // 用户能力：inactive channel 的 Meta 未收敛时显示 unknown，而非零值假装已知。
    // 不变量：Meta readiness 不能从空 Replica 推导。
    // 公开 owner：ChannelFeedRuntime.historyFor/unreadFor。
    const { runtime, snapshot } = await attachedRuntime({
      entries: [{ channel_id: 'c0', head_seq: 0, has_rows: false }, { channel_id: 'c1', head_seq: 3, has_rows: true }],
      focus: 'c0',
    });
    expect(snapshot().historyFor('c1').localReplicaReady).toBe(true);
    expect(snapshot().unreadFor('c1', HUMAN.id)).toMatchObject({ unknown: true });
    runtime.destroy();
    activeRuntimes.delete(runtime);
  });

  it('[AD-161] journals a related reconnect tail fact when history materializes it for the mounted viewport', async () => {
    // 用户能力：重连后历史尾部 materialize 的相关消息仍进入当前阅读 arrival journal。
    // 不变量：history/live ingress 共用同一 Replica arrival owner。
    // 公开 owner：ChannelFeedRuntime.loadHistory/enqueue/pageEnd + arrivalReceipts。
    const calls = [];
    const options = feedOptions();
    options.wireRef.current = {
      historyBefore: vi.fn((channelId, beforeSeq, _limit, detail) => {
        const ref = `round24-reconnect-${calls.length + 1}`;
        calls.push({ channelId, beforeSeq, ref, ...detail });
        const receipt = Promise.resolve({ accepted: true, channel_id: channelId, generation: detail.generation });
        receipt.ref = ref;
        return receipt;
      }),
      cancelHistory: vi.fn(async () => {}),
    };
    const { runtime, snapshot } = await attachedRuntime({ options, entries: [{ channel_id: 'c0', head_seq: 101, has_rows: true }] });
    const state = snapshot().stateFor('c0');
    const release = state.arrivalReceipts.attachTimelineConsumer(Symbol('round24-reconnect'));
    const pending = snapshot().loadHistory('c0');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const call = calls[0];
    snapshot().enqueue({
      source: 'history', ref: call.ref, generation: 1, channel_id: 'c0', seq: 101,
      envelope: { id: 'reconnect-related', kind: 'event', type: 'human.note', visibility: 'public', sender: OTHER, audience: [HUMAN.id], payload: { body: { text: 'after reconnect' } } },
    });
    snapshot().pageEnd({
      source: 'history', ref: call.ref, generation: 1, channel_id: 'c0', purpose: call.purpose,
      head_seq: 101, oldest_seq: 101, scan_low_seq: 101, scan_high_seq: 101,
      next_before_seq: 101, rows: 1, bytes: 100, has_older: false,
    });
    await pending;
    expect(state.arrivalReceipts.timeline().events).toEqual([expect.objectContaining({ rowID: 'reconnect-related', seq: 101 })]);
    release();
    runtime.destroy();
    activeRuntimes.delete(runtime);
  });

  it('[AD-165] leaves initial freshness to explicit channel-entry interest instead of probing twice from attach', async () => {
    // 用户能力：进入频道才发起一次 freshness probe，attach 不能暗中重复探测。
    // 不变量：history demand 由显式 interest owner 授权。
    // 公开 owner：ChannelFeedRuntime.requestBackgroundInterest。
    const options = feedOptions();
    options.wireRef.current = { historyBefore: vi.fn(() => Promise.resolve({ accepted: true })) };
    const { runtime, snapshot } = await attachedRuntime({ options });
    expect(options.wireRef.current.historyBefore).not.toHaveBeenCalled();
    const lease = snapshot().requestBackgroundInterest('c0', { intent: 'channel-entry' });
    expect(lease.accepted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(options.wireRef.current.historyBefore).toHaveBeenCalledTimes(1);
    lease.release();
    runtime.destroy();
    activeRuntimes.delete(runtime);
  });

  it('[AD-166] resumes an empty-channel entry obligation once per reconnect and foreground return', async () => {
    // 用户能力：空频道在 reconnect/foreground return 后各自补一次 freshness。
    // 不变量：每个生命周期 obligation 只有一个可取消 probe owner。
    // 公开 owner：ChannelFeedRuntime.requestBackgroundInterest。
    const options = feedOptions();
    options.wireRef.current = { historyBefore: vi.fn(() => Promise.resolve({ accepted: true })) };
    const { runtime, snapshot } = await attachedRuntime({ options });
    const leases = ['channel-entry', 'reconnect', 'foreground-return'].map((intent) => snapshot().requestBackgroundInterest('c0', { intent }));
    expect(leases.every((lease) => lease.accepted)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(options.wireRef.current.historyBefore).toHaveBeenCalledTimes(3);
    leases.forEach((lease) => lease.release());
    runtime.destroy();
    activeRuntimes.delete(runtime);
  });

  it('[AD-178] returns after Meta creates live queues without waiting for the selected cache body', async () => {
    // 用户能力：attach 后 live queue 可立即接收，不能被选中频道慢 cache body 阻塞。
    // 不变量：Meta/readiness 与 body hydration 是两个可并行 owner。
    // 公开 owner：ChannelFeedRuntime.prepareLocalReplica + ChannelReplica cache.
    const principal = `round24-body-principal-${++serial}`;
    // A changed server boot is an intentional cache-owner replacement, not a
    // selected-body latency case. Keep the current authority stable here;
    // the Feed unit owns the delayed-body proof.
    const boot = `round24-body-boot-${serial}`;
    const seed = await attachedRuntime({ principal, boot, entries: [{ channel_id: 'c0', head_seq: 100, has_rows: true }] });
    seed.snapshot().enqueue(liveRow('c0', 100, {
      id: 'cached-body', kind: 'event', type: 'human.note', visibility: 'public', sender: OTHER, audience: [HUMAN.id], payload: { body: { text: 'cached body' } },
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    seed.runtime.destroy();
    activeRuntimes.delete(seed.runtime);
    const next = await attachedRuntime({ principal, boot, entries: [{ channel_id: 'c0', head_seq: 100, has_rows: true }] });
    const prepared = next.snapshot().resumeLocalReplica();
    expect(prepared).toMatchObject({ c0: 100 });
    expect(next.snapshot().historyFor('c0')).toMatchObject({
      attached: true, messageCurrent: true, headSeq: 100,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(next.snapshot().stateFor('c0')?.rows.has(100)).toBe(true);
    next.runtime.destroy();
    activeRuntimes.delete(next.runtime);
  });

  it('[AD-197] exposes a stable unavailable terminal state when compact result detail is missing', () => {
    // 用户能力：compact result 缺失时显示稳定 unavailable 终态，而非 ready。
    // 不变量：缺失业务结果不能被 command receipt 冒充为完成详情。
    // 公开 owner：ChannelAdministrationPanel/GovernanceFeature。
    governance({ operation: { state: 'completed', message: '已完成' } });
    expect(screen.getByRole('status').textContent).toContain('终态详情不可用，请刷新或重新进入频道');
  });

  it('[AD-202] exposes the unavailable node-update contract without a command owner', () => {
    // 用户能力：当前版本不支持安全升级时，Shell 给出稳定、有界失败态。
    // 不变量：没有真实 session command port 时不显示确认或升级入口。
    const nav = navigation();
    render(<WorkspaceLayout
      session={session()}
      navigation={{ ...nav, update: { status: 'unsupported', currentVersion: null, detail: '当前版本不支持安全升级，请刷新或联系管理员/手动升级' } }}
    />);
    expect(screen.getByRole('button', { name: '当前版本不支持安全升级，请刷新或联系管理员/手动升级' }).disabled).toBe(true);
  });

  it('[AD-203] preserves a read-only current version in the unavailable state', () => {
    // 用户能力：版本信息可读，但升级能力明确不可用。
    // 不变量：unsupported 终态不产生成功版本或轮询状态。
    const nav = navigation();
    render(<WorkspaceLayout
      session={session()}
      navigation={{ ...nav, update: { status: 'unsupported', currentVersion: 'v0.06', detail: '当前版本不支持安全升级，请刷新或联系管理员/手动升级' } }}
    />);
    expect(screen.getByLabelText('当前版本（只读）').textContent).toContain('当前版本：v0.06（只读）');
    expect(screen.getByRole('button', { name: '当前版本不支持安全升级，请刷新或联系管理员/手动升级' }).disabled).toBe(true);
  });

  it('[AD-256] restores principal-scoped control state and converts sending to uncertain', async () => {
    // 用户能力：刷新后只恢复本 principal 的控制状态，sending 变 uncertain。
    // 不变量：控制恢复必须按 principal 隔离且 durable。
    // 公开 owner：useComposerSubmissionRuntime。
    let releaseCancel;
    const cancel = vi.fn(() => new Promise((resolve) => { releaseCancel = resolve; }));
    const harness = controlHarness({ cancel });
    const first = renderHook(() => useComposerSubmissionRuntime(harness));
    await waitFor(() => expect(first.result.current.controlStates).toEqual({}));
    let cancelPromise;
    act(() => { cancelPromise = first.result.current.cancel('c0', 'request-1'); });
    await waitFor(() => expect(first.result.current.controlStates['c0:request-1:cancel']).toMatchObject({ state: 'sending' }));
    first.unmount();
    releaseCancel({ ok: true });
    await expect(cancelPromise).rejects.toThrow();
    const restored = renderHook(() => useComposerSubmissionRuntime(harness));
    await waitFor(() => expect(restored.result.current.controlStates['c0:request-1:cancel']).toMatchObject({ state: 'uncertain' }));
    restored.unmount();

    const otherPrincipal = renderHook(() => useComposerSubmissionRuntime({
      ...harness,
      principalId: 'human:round24:other',
      producerOwnerToken: 'owner:human:round24:other',
    }));
    await waitFor(() => expect(otherPrincipal.result.current.controlStates).toEqual({}));
    otherPrincipal.unmount();
    harness.store.close();
  });

  it('[AD-257] persists only explainable active control state with serializable errors', async () => {
    // 用户能力：Error 控制结果刷新后仍可解释，其他状态不被持久化。
    // 不变量：持久化边界只接受 active state 与可序列化 error。
    // 公开 owner：useComposerSubmissionRuntime。
    const failure = Object.assign(new Error('连接关闭'), { code: 'closed' });
    const harness = controlHarness({ cancel: vi.fn().mockRejectedValue(failure) });
    const first = renderHook(() => useComposerSubmissionRuntime(harness));
    await waitFor(() => expect(first.result.current.controlStates).toEqual({}));
    await act(async () => { await expect(first.result.current.cancel('c0', 'request-2')).rejects.toThrow('连接关闭'); });
    expect(first.result.current.controlStates['c0:request-2:cancel'].error).toEqual({ code: 'closed', detail: '连接关闭' });
    const persistedFailure = harness.store.putMany.mock.calls
      .flatMap(([, rows]) => rows)
      .find((row) => row.controlKey === 'c0:request-2:cancel' && row.state === 'uncertain');
    expect(persistedFailure).toMatchObject({
      kind: 'control',
      state: 'uncertain',
      error: { code: 'closed', detail: '连接关闭' },
    });
    expect(persistedFailure.error).not.toBeInstanceOf(Error);
    expect(JSON.parse(JSON.stringify(persistedFailure)).error).toEqual({
      code: 'closed', detail: '连接关闭',
    });
    first.unmount();
    const restored = renderHook(() => useComposerSubmissionRuntime(harness));
    await waitFor(() => expect(restored.result.current.controlStates['c0:request-2:cancel']).toMatchObject({
      state: 'uncertain',
      error: { code: 'closed', detail: '连接关闭' },
    }));
    await harness.store.putMany(HUMAN.id, [{
      key: 'control:c0:terminal:cancel',
      messageId: 'control:c0:terminal:cancel',
      kind: 'control',
      controlKey: 'c0:terminal:cancel',
      channelId: 'c0',
      requestId: 'terminal',
      action: 'cancel',
      state: 'resolved',
      error: null,
    }]);
    restored.unmount();
    const terminalFiltered = renderHook(() => useComposerSubmissionRuntime(harness));
    await waitFor(() => expect(terminalFiltered.result.current.controlStates['c0:request-2:cancel']).toBeTruthy());
    expect(terminalFiltered.result.current.controlStates['c0:terminal:cancel']).toBeUndefined();
    terminalFiltered.unmount();
    harness.store.close();
  });

  it('[AD-316] refreshes the authoritative device projection after create_device reaches terminal', async () => {
    // 用户能力：创建设备完成后，列表重新读取权威 projection，而非停留在旧清单。
    // 不变量：terminal 事实是命令完成边界；submit 回执不能冒充设备已落地。
    // 公开 owner：SpaceAdministrationPanel → SpaceDevices 的 space.commands port。
    const submit = vi.fn().mockResolvedValue('request-1');
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<SpaceAdministrationPanel
      channel={{ id: 'channel-a', qualified_name: 'c0.channel-a' }}
      port={{ disabled: false, devices: [], commands: { submit, refresh } }}
      onClose={vi.fn()}
    />);
    fireEvent.click(screen.getByRole('tab', { name: '设备' }));
    fireEvent.change(screen.getByLabelText('设备名称'), { target: { value: 'laptop' } });
    fireEvent.click(screen.getByRole('button', { name: '创建设备' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'space', action: 'create_device', payload: { name: 'laptop' },
    })));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('[AD-331] supports desktop copy and mobile short-reply/long-copy gestures without accidental cross-action', async () => {
    // 用户能力：PC 可复制回复正文；移动端短按回复、长按复制且不误触回复。
    // 不变量：reply/copy 是同一正文事实上的互斥交互，不因设备输入方式丢失。
    // 公开 owner：useTimelineRowRenderer / ConversationPresentation message actions。
    const onReply = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', { configurable: true, value: { writeText } });
    const terminal = envelope({ id: 'answer', body: { status: 'completed', text: '最终答复' } });
    const { view } = renderTurnRow(turnOf({ status: 'completed', terminal }), { onReply });
    const answer = view.container.querySelector('.agent-turn-bubble');
    const surface = within(answer).getByText('最终答复').closest('.message-body');
    const copy = within(answer).getByRole('button', { name: '复制' });
    const reply = within(answer).getByRole('button', { name: '↩ 回复' });
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('最终答复'));
    fireEvent.pointerDown(surface, { pointerType: 'touch', button: 0 });
    fireEvent.pointerUp(surface, { pointerType: 'touch', button: 0 });
    expect(onReply).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledTimes(1);
    fireEvent.click(reply, { detail: 0 });
    expect(onReply).toHaveBeenCalledTimes(2);
    fireEvent.pointerDown(surface, { pointerType: 'touch', button: 0 });
    await new Promise((resolve) => setTimeout(resolve, 600));
    fireEvent.pointerUp(surface, { pointerType: 'touch', button: 0 });
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(onReply).toHaveBeenCalledTimes(2);
    fireEvent.click(copy, { detail: 0 });
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(3));
    expect(onReply).toHaveBeenCalledTimes(2);
    fireEvent.pointerDown(reply, { pointerType: 'touch', button: 0 });
    fireEvent.pointerUp(reply, { pointerType: 'touch', button: 0 });
    fireEvent.click(reply, { pointerType: 'touch', detail: 1 });
    expect(onReply).toHaveBeenCalledTimes(3);
  });

  it('[AD-334] exposes audit identifiers in turn detail without serializing the payload JSON', () => {
    // 用户能力：打开 Turn detail 时可看审计标识，但不把 payload JSON 原样倾倒给用户。
    // 不变量：detail 必须由当前 process projection owner 提供可审计字段，不能靠隐藏 JSON 猜测。
    // 公开 owner：useTimelineRowRenderer/onOpenTurn → WorkspaceRightPanel TurnDetailPanel。
    let openedTurn = null;
    const onOpenTurn = vi.fn((value) => { openedTurn = value; });
    const process = processFrame('audit-process', 2, {
      kind: 'tool', phase: 'started', tool_call_id: 'audit-call-1', tool: 'lookup',
      audit_id: 'audit-202', payload: { secret: 'must-not-render' },
    });
    const { view } = renderTurnRow(turnOf({ provisional: [process] }), { onOpenTurn });
    const answer = view.container.querySelector('.agent-turn-bubble');
    fireEvent.click(within(answer).getByRole('button', { name: '查看过程' }));
    expect(onOpenTurn).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'work' }));
    expect(openedTurn).toBeTruthy();
    view.unmount();
    render(<WorkspaceRightPanel
      panel="turn"
      channel={{ id: 'c0' }}
      turn={openedTurn}
      onClose={vi.fn()}
    />);
    const detail = screen.getByRole('region', { name: '回合详情' });
    expect(detail.textContent).toContain('audit-202');
    expect(detail.textContent).toContain('audit-call-1');
    expect(detail.textContent).not.toContain('must-not-render');
    expect(detail.textContent).not.toContain('"payload"');
    expect(detail.querySelector('pre')).toBeNull();
  });

  it('[AD-363] builds and validates declared JSON-Schema fields with typed values', () => {
    // 用户能力：Agent 声明的 JSON Schema 字段可在 Composer 中形成可校验 typed payload。
    // 不变量：声明字段必须由公开 command owner 承载，不能静默丢弃或硬编码旧词表。
    // 公开 owner：buildComposerModel/createComposerCommandRequest。
    const customType = 'agent.custom-control';
    const model = buildComposerModel({
      activeChannelId: 'c0',
      draft: { text: '' },
      roster: [HUMAN, AGENT],
      agentSelection: { selectedAgentId: AGENT.id },
      access: 'member_active',
      capabilityIndex: new Map([[AGENT.id, { describe: { types: new Map([[customType, {
        inputSchema: { type: 'object', properties: { count: { type: 'integer' }, enabled: { type: 'boolean' } }, required: ['count'] },
      }]]) } }]]),
    });
    expect(() => createComposerCommandRequest(model, {
      kind: 'command', command: 'custom-control', type: customType, scope: 'agent',
      payload: { count: 3, enabled: true },
    })).not.toThrow();
  });

  it('[AD-364] sends standard control payloads for an Agent word advertised by describe', () => {
    // 用户能力：base advertise 的标准控制词仍能携带其声明 payload。
    // 不变量：控制 payload 的字段闭集来自 describe，而不是固定 slash-command 表。
    // 公开 owner：buildComposerModel/createComposerCommandRequest。
    const type = 'agent.replace';
    const model = buildComposerModel({
      activeChannelId: 'c0',
      draft: { text: '' },
      roster: [HUMAN, AGENT],
      agentSelection: { selectedAgentId: AGENT.id },
      access: 'member_active',
      capabilityIndex: new Map([[AGENT.id, { describe: { types: new Map([[type, {
        inputSchema: { type: 'object', properties: { expected_hold_id: { type: 'string' } }, required: ['expected_hold_id'] },
      }]]) } }]]),
    });
    expect(() => createComposerCommandRequest(model, {
      kind: 'command', command: 'replace', type, scope: 'agent', payload: { expected_hold_id: 'hold-1' },
    })).not.toThrow();
  });
});

afterEach(() => {
  for (const runtime of activeRuntimes) runtime.destroy();
  activeRuntimes.clear();
});
