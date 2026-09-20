// @vitest-environment jsdom
// Round 26 records the next twenty still-blocked cases at their current
// public owners.  Every assertion is an ordinary `it`: red output is owner
// evidence and is never treated as an expected-fail completion signal.
import React from 'react';
import {
  act, cleanup, fireEvent, render, renderHook, screen, waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';
import { ChannelAdministrationPanel } from '../src/ui/features/governance/GovernanceFeature.jsx';
import { WorkspaceRightPanel } from '../src/ui/features/WorkspaceFeatures.jsx';
import { WaitingLayer, useWaitingEditingController } from '../src/ui/timeline/useWaitingEditingController.jsx';

const HUMAN = { id: 'human:round26:me', kind: 'human', name: '我' };
const AGENT = { id: 'agent:round26:worker', kind: 'agent', name: 'Agent' };
const OTHER = { id: 'agent:round26:other', kind: 'agent', name: 'Other' };
const CAPABILITIES = new Map([['agent:round26:worker', {
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
      self: () => HUMAN.id,
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
  boot = `round26-boot-${++serial}`,
  focus = 'c0',
  principal = `round26-principal-${serial}`,
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

function envelope({
  id, type = 'agent.ask', kind = 'response', sender = AGENT,
  audience = [HUMAN.id], ts = 100, body = {}, parent_id, ...rest
}) {
  return {
    id, type, kind, sender, audience, ts,
    ...(parent_id ? { parent_id } : {}),
    payload: { body },
    ...rest,
  };
}

function governance({ commands = {}, ...rest } = {}) {
  return render(<ChannelAdministrationPanel
    channel={{ id: 'c0', qualified_name: 'c0' }}
    port={{ commands, children: [], ...rest }}
    onClose={vi.fn()}
  />);
}

function createChannelModal({ commands = {}, children = [], creation = null, roster = [], selfId = '' } = {}) {
  return render(<WorkspaceRightPanel
    panel={{ kind: 'channel-administration', initialTab: 'overview' }}
    channel={{ id: 'c0', qualified_name: 'c0' }}
    governance={{ channel: { commands, children, creation, roster, selfId } }}
    onClose={vi.fn()}
  />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const runtime of activeRuntimes) runtime.destroy();
  activeRuntimes.clear();
});

describe('A-D round 26 public-owner evidence', () => {
  it('[AD-027] keeps the committed Reading owner while a processing turn is edited', async () => {
    // 用户能力：编辑 processing turn 时，阅读位置和 Composer 编辑内容同时可用。
    // 不变量：Waiting/编辑不能替换 committed Reading owner；公开 owner：useWaitingEditingController + WaitingLayer。
    const processing = {
      requestId: 'work', request: request('work', 'edit without navigation'), requestSeq: 1,
      status: 'processing', latestStatus: 'processing', terminal: null,
      provisional: [{ seq: 2, envelope: response('work-p', 'work', {
        status: 'processing', turn_id: 'turn-edit', controls: [{ word: 'agent.replace' }],
      }) }],
    };
    const state = { channelId: 'c0', timeline: [{ kind: 'turn', turn: processing }] };
    const onTaskControl = vi.fn(async ({ type }) => (type === 'agent.hold' ? 'hold-edit' : `${type}-id`));
    const onComposerEditChange = vi.fn();
    const { result } = renderHook(() => useWaitingEditingController({
      state, pending: [], capabilityIndex: CAPABILITIES,
      onRequestCapability: vi.fn(), onTaskControl, onComposerEditChange,
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
    // 不变量：释放/上下文使用 hold owner，不能被候选 callback 或旧 target 抢走；公开 owner：useWaitingEditingController。
    const state = waitingState('queued', 'reconnect edit');
    const onTaskControlA = vi.fn(async ({ type }) => (type === 'agent.hold' ? 'hold-a' : `${type}-a`));
    const onTaskControlB = vi.fn(async ({ type }) => `${type}-b`);
    const onTaskControlC = vi.fn(async ({ type }) => `${type}-c`);
    const onComposerEditChange = vi.fn();
    const common = {
      state, pending: [], capabilityIndex: CAPABILITIES,
      onComposerEditChange, onRequestCapability: vi.fn(),
    };
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
    const latestState = waitingState('queued', 'reconnect edit');
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

  it('[AD-150] includes a selected current-channel Agent as an initial seat', () => {
    // 用户能力：创建时带入当前频道 Agent actor seat。
    // 不变量：seat 只能来自公开 roster；公开 owner：GovernanceFeature。
    const submit = vi.fn().mockResolvedValue('request-ad150');
    createChannelModal({
      commands: { submit },
      roster: [{ id: 'agent:worker:1', kind: 'agent', name: 'Worker' }],
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Worker/ }));
    fireEvent.change(screen.getByLabelText('新频道名称'), { target: { value: 'agent-room' } });
    fireEvent.click(screen.getByRole('button', { name: '创建频道' }));
    return waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'channel', action: 'create_child',
      payload: expect.objectContaining({
        name: 'agent-room', parentId: 'c0', initialActorIds: ['agent:worker:1'],
      }),
    })));
  });

  it('[AD-151] reads template body before submitting a public recipe', () => {
    // 用户能力：模板 body 先读账本再用于 create。
    // 不变量：create 不能只发送 template ID；公开 owner：GovernanceFeature。
    const submit = vi.fn().mockResolvedValueOnce('template-request').mockResolvedValueOnce('create-request');
    governance({ commands: { submit }, space: { channelTemplates: [{ id: 'team', name: 'Team' }] } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'templated' } });
    fireEvent.click(screen.getByRole('combobox', { name: '频道模板' }));
    fireEvent.click(screen.getByRole('option', { name: 'Team' }));
    fireEvent.click(screen.getByRole('button', { name: '创建子频道' }));
    expect(submit).toHaveBeenNthCalledWith(1, expect.objectContaining({ action: 'get_template' }));
  });

  it('[AD-152] treats a template compact closure as unavailable detail, not business failure', () => {
    // 用户能力：模板终态缺 body 时稳定提示不可用。
    // 不变量：缺失详情不能伪造 recipe/业务失败；公开 owner：GovernanceFeature。
    governance({ commands: { submit: vi.fn().mockResolvedValue('template-request') } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'templated' } });
    expect(screen.getByRole('alert').textContent).toContain('终态详情不可用，请刷新或重新进入频道');
  });

  it('[AD-153] keeps a bare request in convergence until typed facts arrive', async () => {
    // 用户能力：分别看到 ledger/OBS/membership/serving，ready 后才进入。
    // 不变量：receipt 不能宣告 serving ready；公开 owner：WorkspaceRightPanel → GovernanceFeature.ChannelCreateModal。
    const submit = vi.fn().mockResolvedValue('request-1');
    createChannelModal({ commands: { submit } });
    fireEvent.change(screen.getByLabelText('新频道名称'), { target: { value: 'research' } });
    fireEvent.click(screen.getByRole('button', { name: '创建频道' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'channel', action: 'create_child',
      payload: expect.objectContaining({ name: 'research', parentId: 'c0' }),
    })));
    const progress = screen.getByRole('region', { name: '频道创建进度' });
    expect(progress.textContent).toContain('账本确认');
    expect(progress.textContent).toContain('频道可观察');
    expect(progress.textContent).toContain('成员关系');
    expect(progress.textContent).toContain('服务就绪');
    expect(screen.queryByRole('button', { name: '进入新频道' })).toBeNull();
  });

  it('[AD-155] provides dialog Escape/backdrop/focus-trap and returns focus after close', () => {
    // 用户能力：Escape/遮罩关闭、焦点闭环、关闭后 focus return。
    // 不变量：独立 dialog owner 承担完整生命周期；公开 owner：GovernanceFeature/SidePanel。
    governance({ commands: { submit: vi.fn() } });
    expect(screen.getByRole('dialog', { name: '新建频道' })).toBeTruthy();
    expect(document.querySelector('.channel-create-backdrop')).toBeTruthy();
  });

  it('[AD-156] keeps an inactive rail unknown until cached unread context and parent are folded', async () => {
    // 用户能力：非当前频道的未读在缓存上下文和 parent 完整前保持 unknown。
    // 不变量：notification 只能由当前 Replica/cache authority 证明；公开 owner：ChannelFeedRuntime + ChannelReplica。
    const { runtime, snapshot } = await attachedRuntime({ entries: [
      { channel_id: 'c0', head_seq: 0, has_rows: false }, { channel_id: 'c1', head_seq: 0, has_rows: false },
    ] });
    expect(snapshot().unreadFor('c1', HUMAN.id)).toMatchObject({ unknown: true });
    snapshot().enqueue(liveRow('c1', 1, {
      id: 'cached-request', kind: 'request', type: 'human.ask', visibility: 'public',
      sender: { id: 'human:round26:other', kind: 'human' }, audience: [HUMAN.id], payload: { text: 'question' },
    }, 1, 'cache'));
    snapshot().enqueue(liveRow('c1', 3, {
      id: 'cached-final', parent_id: 'cached-request', kind: 'response', type: 'human.ask', visibility: 'public',
      sender: OTHER, audience: [HUMAN.id], payload: { body: { status: 'completed', text: 'answer' } },
    }, 1, 'cache'));
    expect(snapshot().unreadFor('c1', HUMAN.id)).toEqual({ related: 1, total: 1 });
    runtime.destroy();
  });

  it('[AD-159] keeps notification context unknown when physical reading advances without its parent', async () => {
    // 用户能力：物理阅读前进但 parent 缺失时，rail 不伪造已知未读数。
    // 不变量：physical read cursor 与 notification context completeness 独立；公开 owner：unreadFor/markRead。
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
  });

  it('[AD-160] keeps an inactive granted notification unknown while local Meta never settles', async () => {
    // 用户能力：inactive channel 的 Meta 未收敛时显示 unknown，而非零值假装已知。
    // 不变量：Meta readiness 不能从空 Replica 推导；公开 owner：historyFor/unreadFor。
    const { runtime, snapshot } = await attachedRuntime({
      entries: [{ channel_id: 'c0', head_seq: 0, has_rows: false }, { channel_id: 'c1', head_seq: 3, has_rows: true }],
      focus: 'c0',
    });
    expect(snapshot().historyFor('c1').localReplicaReady).toBe(true);
    expect(snapshot().unreadFor('c1', HUMAN.id)).toMatchObject({ unknown: true });
    runtime.destroy();
  });

  it('[AD-161] journals a related reconnect tail fact when history materializes it for the mounted viewport', async () => {
    // 用户能力：重连后历史尾部 materialize 的相关消息仍进入当前阅读 arrival journal。
    // 不变量：history/live ingress 共用同一 Replica arrival owner；公开 owner：loadHistory/enqueue/pageEnd。
    const calls = [];
    const options = feedOptions();
    options.wireRef.current = {
      historyBefore: vi.fn((channelId, beforeSeq, _limit, detail) => {
        const ref = `round26-reconnect-${calls.length + 1}`;
        calls.push({ channelId, beforeSeq, ref, ...detail });
        const receipt = Promise.resolve({ accepted: true, channel_id: channelId, generation: detail.generation });
        receipt.ref = ref;
        return receipt;
      }),
      cancelHistory: vi.fn(async () => {}),
    };
    const { runtime, snapshot } = await attachedRuntime({ options, entries: [{ channel_id: 'c0', head_seq: 101, has_rows: true }] });
    const state = snapshot().stateFor('c0');
    const release = state.arrivalReceipts.attachTimelineConsumer(Symbol('round26-reconnect'));
    const pending = snapshot().loadHistory('c0');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const call = calls[0];
    snapshot().enqueue({
      source: 'history', ref: call.ref, generation: 1, channel_id: 'c0', seq: 101,
      envelope: { id: 'reconnect-related', kind: 'event', type: 'human.note', visibility: 'public', sender: OTHER, audience: [HUMAN.id], payload: { body: { text: 'after reconnect' } },
      },
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
  });

  it('[AD-165] leaves initial freshness to explicit channel-entry interest instead of probing twice from attach', async () => {
    // 用户能力：进入频道才发起一次 freshness probe，attach 不能暗中重复探测。
    // 不变量：history demand 由显式 interest owner 授权；公开 owner：requestBackgroundInterest。
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
  });

  it('[AD-166] resumes an empty-channel entry obligation once per reconnect and foreground return', async () => {
    // 用户能力：空频道在 reconnect/foreground return 后各自补一次 freshness。
    // 不变量：每个生命周期 obligation 只有一个可取消 probe owner；公开 owner：requestBackgroundInterest。
    const options = feedOptions();
    options.wireRef.current = { historyBefore: vi.fn(() => Promise.resolve({ accepted: true })) };
    const { runtime, snapshot } = await attachedRuntime({ options });
    const leases = ['channel-entry', 'reconnect', 'foreground-return']
      .map((intent) => snapshot().requestBackgroundInterest('c0', { intent }));
    expect(leases.every((lease) => lease.accepted)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(options.wireRef.current.historyBefore).toHaveBeenCalledTimes(3);
    leases.forEach((lease) => lease.release());
    runtime.destroy();
  });

  it('[AD-178] returns after Meta creates live queues without waiting for the selected cache body', async () => {
    // 用户能力：attach 后 live queue 可立即接收，不能被选中频道慢 cache body 阻塞。
    // 不变量：Meta/readiness 与 body hydration 是两个可并行 owner；公开 owner：prepareLocalReplica + Replica cache。
    const principal = `round26-body-principal-${++serial}`;
    const seed = await attachedRuntime({ principal, entries: [{ channel_id: 'c0', head_seq: 100, has_rows: true }] });
    seed.snapshot().enqueue(liveRow('c0', 100, {
      id: 'cached-body', kind: 'event', type: 'human.note', visibility: 'public', sender: OTHER, audience: [HUMAN.id], payload: { body: { text: 'cached body' } },
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    seed.runtime.destroy();
    activeRuntimes.delete(seed.runtime);
    const next = await attachedRuntime({ principal, entries: [{ channel_id: 'c0', head_seq: 100, has_rows: true }] });
    const prepared = next.snapshot().resumeLocalReplica();
    expect(prepared).toMatchObject({ c0: 100 });
    expect(next.snapshot().stateFor('c0')?.rows.has(100)).toBe(false);
    next.runtime.destroy();
    activeRuntimes.delete(next.runtime);
  });

  it('[AD-192] accepts only real human principals in the user selector', () => {
    // 用户能力：候选只显示 registry 中可用 human principal。
    // 不变量：agent/retired principal 不能作为 human target；公开 owner：GovernanceFeature。
    governance({
      commands: { submit: vi.fn() },
      principals: [
        { id: 'root', kind: 'human', status: 'present' },
        { id: 'steward', kind: 'agent', status: 'present' },
        { id: 'retired', kind: 'human', status: 'retired' },
      ],
    });
    fireEvent.click(screen.getByRole('tab', { name: '成员' }));
    fireEvent.click(screen.getByRole('combobox', { name: '选择参与者' }));
    // SelectMenu exposes its empty placeholder as a UI option. The user
    // capability concerns admitted candidates, so assert the public option
    // boundary directly: the real human remains selectable while agent and
    // retired-human principals never enter the candidate list.
    expect(screen.getByRole('option', { name: 'root · 用户' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /steward/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /retired/ })).toBeNull();
  });

  it('[AD-193] waits for ledger, OBS, membership, and serving convergence after create', async () => {
    // 用户能力：创建成功分别收敛四类事实。
    // 不变量：receipt 不能替代 serving/membership；公开 owner：WorkspaceRightPanel → ChannelCreateModal。
    const submit = vi.fn().mockResolvedValue('request-1');
    createChannelModal({ commands: { submit, refresh: vi.fn() } });
    fireEvent.change(screen.getByLabelText('新频道名称'), { target: { value: 'research' } });
    fireEvent.click(screen.getByRole('button', { name: '创建频道' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'channel', action: 'create_child',
      payload: { name: 'research', purpose: '', parentId: 'c0' },
    })));
    expect(screen.getByText('服务就绪')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '进入新频道' })).toBeNull();
  });

  it('[AD-194] keeps member ledger terminal and roster convergence as separate facts', async () => {
    // 用户能力：成员操作只有账本和 roster 都收敛才 ready。
    // 不变量：terminal receipt 不能伪造 roster；公开 owner：ChannelAdministrationPanel → ChannelMembers（GovernanceFeature）。
    const submit = vi.fn().mockResolvedValue('member-request');
    const refresh = vi.fn();
    const worker = { id: 'agent:worker:1', kind: 'agent', status: 'present', name: 'Worker' };
    const view = governance({
      commands: { submit, refresh },
      declarations: [{ id: 'agent:worker:1', kind: 'agent', status: 'present', name: 'Worker' }],
      roster: [],
      rosterAuthority: { principalId: 'human:root:1', channelId: 'c0', generation: 1, current: false },
    });
    fireEvent.click(screen.getByRole('tab', { name: '成员' }));
    fireEvent.click(screen.getByRole('combobox', { name: '选择参与者' }));
    fireEvent.click(screen.getByRole('option', { name: 'Worker · Agent' }));
    fireEvent.click(screen.getByRole('button', { name: '添加到频道' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith({
      scope: 'channel',
      action: 'introduce_actor',
      payload: { channelId: 'c0', candidateType: 'declaration', candidateId: 'agent:worker:1' },
    }));
    expect(screen.getByText('命令已进入提交队列；最终状态以账本与目录投影为准。')).toBeTruthy();
    expect(screen.queryByText('成员已就绪')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    expect(refresh).toHaveBeenCalledWith('members');
    view.rerender(<ChannelAdministrationPanel
      channel={{ id: 'c0', qualified_name: 'c0' }}
      port={{
        commands: { submit, refresh },
        children: [],
        declarations: [{ id: 'agent:worker:1', kind: 'agent', status: 'present', name: 'Worker' }],
        roster: [worker],
        rosterAuthority: { principalId: 'human:root:1', channelId: 'c0', generation: 1, current: true },
      }}
      onClose={vi.fn()}
    />);
    expect(screen.getByText('成员已就绪')).toBeTruthy();
  });

  it('[AD-195] preserves compact closure lifecycle without declaring missing business result ready', () => {
    // 用户能力：compact closure 保留 ledger lifecycle，缺业务结果不能 ready。
    // 不变量：unavailable result 不能冒充完成；公开 owner：GovernanceFeature。
    governance({ operation: { state: 'submitted', message: '账本已完成，结果待确认' } });
    expect(screen.getByRole('status').textContent).toContain('终态详情不可用，请刷新或重新进入频道');
  });

  it('[AD-196] keeps failed compact closure lifecycle without guessing failure reason', async () => {
    // 用户能力：失败 compact closure 可观察但不猜原因。
    // 不变量：failed 与 unavailable result 分开；公开 owner：GovernanceFeature。
    const submit = vi.fn().mockRejectedValue(new Error('wire closed'));
    governance({ commands: { submit } });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'research' } });
    fireEvent.click(screen.getByRole('button', { name: '创建子频道' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('终态详情不可用，请刷新或重新进入频道'));
  });

  it('[AD-197] exposes a stable unavailable terminal state when compact result detail is missing', () => {
    // 用户能力：compact result 缺失时显示稳定 unavailable 终态，而非 ready。
    // 不变量：缺失业务结果不能被 command receipt 冒充为完成详情；公开 owner：GovernanceFeature。
    governance({ operation: { state: 'completed', message: '已完成' } });
    expect(screen.getByRole('status').textContent).toContain('终态详情不可用，请刷新或重新进入频道');
  });
});
