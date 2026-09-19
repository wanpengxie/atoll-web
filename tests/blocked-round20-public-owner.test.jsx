// @vitest-environment jsdom
// Round 20 evidence packet.  These are the next twenty previously-uncovered
// blocked rows (AD-027, AD-037, AD-156..AD-182, excluding rows already closed
// by earlier packets).  Every case stays at a current public owner boundary.
// Expected failures are deliberate evidence of an unresolved owner/fixture or
// product gap; they are not a migration completion signal.
import React from 'react';
import {
  act, cleanup, render, renderHook, waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChannelFeedRuntime } from '../src/model/channel-feed-runtime.js';
import { WaitingLayer, useWaitingEditingController } from '../src/ui/timeline/useWaitingEditingController.jsx';

vi.mock('../src/ui/timeline/LegendMessageList.jsx', async () => ({
  MessageList: (await import('./helpers/PresentationMessageList.jsx')).PresentationMessageList,
}));

afterEach(cleanup);

const HUMAN = { id: 'me', kind: 'human', name: '我' };
const AGENT = { id: 'agent', kind: 'agent', name: 'Agent' };
const CAPABILITIES = new Map([['agent', {
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
  const turn = waitingTurn(requestId, text);
  return { channelId: 'c0', timeline: [{ kind: 'turn', turn }] };
}

function feedOptions(overrides = {}) {
  return {
    wireRef: { current: null },
    rosterRef: { current: {
      self: () => 'human:root:1',
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

let principalSerial = 0;
async function attachedRuntime({
  entries = [{ channel_id: 'c0', head_seq: 0, has_rows: false }],
  generation = 1,
  boot = `round20-boot-${++principalSerial}`,
  focus = 'c0',
  principal = `round20-principal-${principalSerial}`,
  options = feedOptions(),
} = {}) {
  const runtime = createChannelFeedRuntime(options);
  runtime.mount();
  const snapshot = runtime.getSnapshot();
  await snapshot.setHistoryGrants(entries, { generation, boot, focus });
  await snapshot.prepareLocalReplica(principal, { focus });
  return { runtime, snapshot: () => runtime.getSnapshot(), options, principal, boot, generation };
}

function liveRow(channelId, seq, envelope, generation = 1, source = 'live') {
  return { channel_id: channelId, seq, generation, source, envelope };
}

describe('A-D round 20 public-owner blocked evidence', () => {
  it.fails('[AD-027] keeps the same Reading adapter while processing edit owns Composer content', async () => {
    // 用户能力：编辑 processing turn 时，阅读位置和 Composer 编辑内容同时可用。
    // 不变量：Waiting/编辑不能替换 committed Reading owner；公开 owner：WaitingLayer/useWaitingEditingController。
    const processing = {
      requestId: 'work',
      request: request('work', 'edit without navigation'),
      requestSeq: 1,
      status: 'processing',
      latestStatus: 'processing',
      terminal: null,
      provisional: [{
        seq: 2,
        envelope: response('work-p', 'work', { status: 'processing', turn_id: 'turn-edit', controls: [{ word: 'agent.replace' }] }),
      }],
    };
    const state = { channelId: 'c0', timeline: [{ kind: 'turn', turn: processing }] };
    const onTaskControl = vi.fn(async ({ type }) => type === 'agent.hold' ? 'hold-edit' : `${type}-id`);
    const onComposerEditChange = vi.fn();
    const { result } = renderHook(() => useWaitingEditingController({
      state,
      pending: [],
      capabilityIndex: CAPABILITIES,
      onRequestCapability: vi.fn(),
      onTaskControl,
      onComposerEditChange,
    }));
    await act(async () => { await result.current.startEditing(processing, AGENT.id); });
    await waitFor(() => expect(onComposerEditChange).toHaveBeenLastCalledWith(expect.objectContaining({
      session: expect.objectContaining({ targetId: 'work', text: 'edit without navigation' }),
    })));
    render(<WaitingLayer
      turns={[processing]}
      state={state}
      names={new Map([[AGENT.id, AGENT.name]])}
      selfId={HUMAN.id}
      access="member_active"
      targetAuthority={{ current: true, actorIDs: new Set([AGENT.id]) }}
      capabilityIndex={CAPABILITIES}
      editing={result.current.presentationEditing}
      onCancel={vi.fn()}
      onControl={vi.fn()}
      onEdit={vi.fn()}
    />);
    // The current public Waiting owner exposes no committed Reading adapter or
    // following-tail identity at this boundary, so the baseline invariant is
    // intentionally left blocked rather than asserted through a private hook.
    expect(document.querySelector('[data-reading-container="following-tail"]')).not.toBeNull();
  });

  it.fails('[AD-037] uses the hold owner on reconnect while reading the latest committed target', async () => {
    // 用户能力：断线重连后的编辑仍能保存到原 hold owner 的最新目标。
    // 不变量：释放/上下文使用 hold owner，不能被候选 callback 或旧 target 抢走；公开 owner：Timeline/Waiting。
    const state = waitingState('queued', 'reconnect edit');
    const onTaskControlA = vi.fn(async ({ type }) => type === 'agent.hold' ? 'hold-a' : `${type}-a`);
    const onTaskControlB = vi.fn(async ({ type }) => `${type}-b`);
    const onTaskControlC = vi.fn(async ({ type }) => `${type}-c`);
    const onComposerEditChange = vi.fn();
    const common = {
      state,
      pending: [],
      capabilityIndex: CAPABILITIES,
      onComposerEditChange,
      onRequestCapability: vi.fn(),
    };
    const { result, rerender } = renderHook((props) => useWaitingEditingController(props), {
      initialProps: { ...common, onTaskControl: onTaskControlA },
    });
    await act(async () => { await result.current.startEditing(state.timeline[0].turn, AGENT.id); });
    await waitFor(() => expect(onTaskControlA).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent.hold' })));
    state.timeline.push({ kind: 'turn', turn: {
      requestId: 'hold-a', request: { ...request('hold-a', ''), type: 'agent.hold', payload: { body: { target: 'queued' } } },
      requestSeq: 3, terminal: response('hold-a-d', 'hold-a', { status: 'completed' }), terminalSeq: 4,
      provisional: [],
    } });
    rerender({ ...common, onTaskControl: onTaskControlB });
    await waitFor(() => expect(onComposerEditChange).toHaveBeenLastCalledWith(expect.objectContaining({
      session: expect.objectContaining({ phase: 'editing' }),
    })));
    rerender({ ...common, onTaskControl: onTaskControlB, state: { ...state, channelId: 'c0' } });
    const latestState = waitingState('queued', 'reconnect edit');
    latestState.timeline.push({ kind: 'turn', turn: {
      requestId: 'hold-a', request: { ...request('hold-a', ''), type: 'agent.hold', payload: { body: { target: 'queued' } } },
      requestSeq: 3, terminal: response('hold-a-d', 'hold-a', { status: 'completed' }), terminalSeq: 4,
      provisional: [],
    } });
    rerender({ ...common, state: latestState, onTaskControl: onTaskControlC });
    await waitFor(() => expect(onTaskControlA).toHaveBeenCalledWith(expect.objectContaining({
      type: 'agent.context',
      turn: latestState.timeline[0].turn,
    })));
    expect(onTaskControlB.mock.calls.some(([value]) => value.type === 'agent.context')).toBe(false);
    expect(onTaskControlC).not.toHaveBeenCalled();
  });

  it.fails('[AD-156] keeps an inactive rail unknown until cached unread context and its parent are folded', async () => {
    // 用户能力：非当前频道的未读在缓存上下文和 parent 完整前保持 unknown。
    // 不变量：notification 只能由 current Replica/cache owner 证明；公开 owner：ChannelFeedRuntime + ChannelReplica。
    const { runtime, snapshot } = await attachedRuntime({
      entries: [
        { channel_id: 'c0', head_seq: 0, has_rows: false },
        { channel_id: 'c1', head_seq: 0, has_rows: false },
      ],
    });
    const before = snapshot().unreadFor('c1', 'human:root:1');
    expect(before).toMatchObject({ unknown: true });
    snapshot().enqueue(liveRow('c1', 1, {
      id: 'cached-request', kind: 'request', type: 'human.ask', visibility: 'public',
      sender: { id: 'human:other:1', kind: 'human' }, audience: ['human:root:1'], payload: { text: 'question' },
    }, 1, 'cache'));
    snapshot().enqueue(liveRow('c1', 3, {
      id: 'cached-final', parent_id: 'cached-request', kind: 'response', type: 'human.ask', visibility: 'public',
      sender: { id: 'agent:worker:1', kind: 'agent' }, audience: ['human:root:1'], payload: { body: { status: 'completed', text: 'answer' } },
    }, 1, 'cache'));
    expect(snapshot().unreadFor('c1', 'human:root:1')).toEqual({ related: 1, total: 1 });
    runtime.destroy();
  });

  it.fails('[AD-157] rejects cached notification completion after boot replacement revokes its Replica epoch', async () => {
    // 用户能力：旧 boot 的缓存完成不能在新世界重现成通知。
    // 不变量：boot/Replica epoch 是缓存 hydration 的 admission fence；公开 owner：ChannelFeedRuntime + ChannelReplica。
    const { runtime, snapshot } = await attachedRuntime({ boot: 'round20-old-boot' });
    await snapshot().setHistoryGrants([
      { channel_id: 'c0', head_seq: 0, has_rows: false },
    ], { generation: 1, boot: 'round20-new-boot', focus: 'c0' });
    snapshot().enqueue(liveRow('c1', 3, {
      id: 'stale-final', kind: 'event', type: 'human.note', visibility: 'public',
      sender: { id: 'human:other:1', kind: 'human' }, audience: ['human:root:1'], payload: { body: { text: 'stale' } },
    }, 1, 'cache'));
    expect(snapshot().stateFor('c1')?.rows.has(3)).not.toBe(true);
    runtime.destroy();
  });

  it.fails('[AD-158] rejects in-flight notification hydration when attach grants revoke its channel', async () => {
    // 用户能力：撤销 c1 后，已经在途的通知 hydration 不能落入用户账本。
    // 不变量：attach grant 集合是跨频道 cache admission 边界；公开 owner：ChannelFeedRuntime + ChannelReplica。
    const { runtime, snapshot } = await attachedRuntime({
      entries: [
        { channel_id: 'c0', head_seq: 0, has_rows: false },
        { channel_id: 'c1', head_seq: 0, has_rows: false },
      ],
    });
    await snapshot().setHistoryGrants([
      { channel_id: 'c0', head_seq: 0, has_rows: false },
    ], { generation: 1, boot: 'round20-boot-revoke', focus: 'c0' });
    snapshot().enqueue(liveRow('c1', 3, {
      id: 'revoked-before-attach', kind: 'event', type: 'human.note', visibility: 'public',
      sender: { id: 'human:other:1', kind: 'human' }, audience: ['human:root:1'], payload: { body: { text: 'revoked' } },
    }, 1, 'cache'));
    expect(snapshot().stateFor('c1')?.rows.has(3)).not.toBe(true);
    runtime.destroy();
  });

  it.fails('[AD-159] keeps incomplete notification context unknown when only physical reading advances', async () => {
    // 用户能力：物理阅读前进但 parent 缺失时，rail 不得伪造已知未读数。
    // 不变量：notification context 完整性独立于 physical read cursor；公开 owner：ChannelFeedRuntime。
    const { runtime, snapshot } = await attachedRuntime({
      entries: [
        { channel_id: 'c0', head_seq: 0, has_rows: false },
        { channel_id: 'c1', head_seq: 3, has_rows: true },
      ],
    });
    const history = snapshot().historyFor('c1');
    expect(snapshot().markRead('c1', {
      physicalSeq: 3,
      authority: history.authority,
      generation: history.generation,
      authorityRevision: history.notificationAuthorityRevision,
    })).toBe(3);
    expect(snapshot().unreadFor('c1', 'human:root:1')).toMatchObject({ unknown: true });
    runtime.destroy();
  });

  it.fails('[AD-160] keeps an inactive granted notification unknown when local Meta never settles', async () => {
    // 用户能力：inactive channel 的本地 Meta 未收敛时显示 unknown，而非零值假装已知。
    // 不变量：Meta readiness 不能从空 Replica 推导；公开 owner：ChannelFeedRuntime + ChannelReplica。
    const { runtime, snapshot } = await attachedRuntime({
      entries: [
        { channel_id: 'c0', head_seq: 0, has_rows: false },
        { channel_id: 'c1', head_seq: 3, has_rows: true },
      ],
      focus: 'c0',
    });
    expect(snapshot().historyFor('c1').localReplicaReady).toBe(true);
    expect(snapshot().unreadFor('c1', 'human:root:1')).toMatchObject({ unknown: true });
    runtime.destroy();
  });

  it.fails('[AD-161] journals a related reconnect tail fact when history materializes it for the mounted viewport', async () => {
    // 用户能力：重连后历史尾部 materialize 的相关消息仍进入当前阅读 arrival journal。
    // 不变量：history ingress 与 live presentation 共享同一 Replica arrival owner；公开 owner：ChannelFeedRuntime + ChannelReplica。
    const calls = [];
    const options = feedOptions();
    options.rosterRef.current.self = () => 'human:root:1';
    options.wireRef.current = {
      historyBefore: vi.fn((channelId, beforeSeq, _limit, detail) => {
        const ref = `round20-reconnect-${calls.length + 1}`;
        calls.push({ channelId, beforeSeq, ref, ...detail });
        const receipt = Promise.resolve({ accepted: true, channel_id: channelId, generation: detail.generation });
        receipt.ref = ref;
        return receipt;
      }),
      cancelHistory: vi.fn(async () => {}),
    };
    const { runtime, snapshot } = await attachedRuntime({
      options,
      entries: [{ channel_id: 'c0', head_seq: 101, has_rows: true }],
      boot: 'round20-reconnect-boot',
    });
    const state = snapshot().stateFor('c0');
    const release = state.arrivalReceipts.attachTimelineConsumer(Symbol('round20'));
    const pending = snapshot().loadHistory('c0');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toHaveLength(1);
    const call = calls[0];
    snapshot().enqueue({
      source: 'history', ref: call.ref, generation: 1, channel_id: 'c0', seq: 101,
      envelope: {
        id: 'reconnect-related', kind: 'event', type: 'human.note', visibility: 'public',
        sender: { id: 'human:other:1', kind: 'human' }, audience: ['human:root:1'], payload: { body: { text: 'after reconnect' } },
      },
    });
    snapshot().pageEnd({
      source: 'history', ref: call.ref, generation: 1, channel_id: 'c0', purpose: call.purpose,
      head_seq: 101, oldest_seq: 101, scan_low_seq: 101, scan_high_seq: 101,
      next_before_seq: 101, rows: 1, bytes: 100, has_older: false,
    });
    await pending;
    expect(state.arrivalReceipts.timeline().events).toEqual([
      expect.objectContaining({ rowID: 'reconnect-related', seq: 101 }),
    ]);
    release();
    runtime.destroy();
  });

  it('[AD-163] classifies exact local submission ids before first self discovery without hiding another device', async () => {
    // 用户能力：首个本地回显建立 self 后，同 principal 的另一设备消息仍留在账本但不发通知。
    // 不变量：submission correlation 是精确 message identity，不能用模糊设备 ID；公开 owner：ChannelFeedRuntime + Replica。
    let selfID = '';
    const options = feedOptions();
    const stateRoster = options.rosterRef.current;
    stateRoster.self = () => selfID;
    stateRoster.handleEnvelope = (_channelId, envelope) => {
      if (!selfID && envelope?.sender?.id) selfID = envelope.sender.id;
    };
    const { runtime, snapshot } = await attachedRuntime({
      options,
      entries: [
        { channel_id: 'c0', head_seq: 0, has_rows: false },
        { channel_id: 'c1', head_seq: 0, has_rows: false },
      ],
      boot: 'round20-submission-boot',
    });
    const c0 = snapshot().stateFor('c0');
    const release = c0.arrivalReceipts.attachTimelineConsumer(Symbol('round20-submission'));
    snapshot().enqueue(liveRow('c0', 1, {
      id: 'own-first', kind: 'request', type: 'human.note', visibility: 'public',
      sender: { id: 'human:self:c0', kind: 'human' }, audience: [], payload: { body: { text: 'own-first' } },
    }));
    snapshot().enqueue(liveRow('c0', 2, {
      id: 'other-device', kind: 'request', type: 'human.note', visibility: 'public',
      sender: { id: 'human:self:other-device', kind: 'human' }, audience: [], payload: { body: { text: 'other-device' } },
    }));
    expect(c0.arrivalReceipts.timeline().events).toEqual([]);
    expect(c0.rows.has(2)).toBe(true);
    release();
    runtime.destroy();
  });

  it.fails('[AD-165] leaves initial freshness to explicit channel-entry interest instead of probing twice from attach', async () => {
    // 用户能力：进入频道才发起一次 freshness probe，attach 本身不能暗中重复探测。
    // 不变量：history demand 由显式 interest owner 授权；公开 owner：ChannelFeedRuntime。
    const options = feedOptions();
    options.wireRef.current = { historyBefore: vi.fn(() => Promise.resolve({ accepted: true })) };
    const { runtime, snapshot } = await attachedRuntime({ options, boot: 'round20-entry-boot' });
    expect(options.wireRef.current.historyBefore).not.toHaveBeenCalled();
    const lease = snapshot().requestBackgroundInterest('c0', { intent: 'channel-entry' });
    expect(lease.accepted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(options.wireRef.current.historyBefore).toHaveBeenCalledTimes(1);
    lease.release();
    runtime.destroy();
  });

  it.fails('[AD-166] resumes an empty-channel entry obligation with one fresh probe per reconnect or foreground return', async () => {
    // 用户能力：空频道在 reconnect/foreground return 后各自补一次 freshness。
    // 不变量：每个生命周期 obligation 只拥有一个可取消 probe；公开 owner：ChannelFeedRuntime。
    const options = feedOptions();
    options.wireRef.current = { historyBefore: vi.fn(() => Promise.resolve({ accepted: true })) };
    const { runtime, snapshot } = await attachedRuntime({ options, boot: 'round20-empty-boot' });
    const leases = ['channel-entry', 'reconnect', 'foreground-return'].map((intent) => (
      snapshot().requestBackgroundInterest('c0', { intent })
    ));
    expect(leases.every((lease) => lease.accepted)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(options.wireRef.current.historyBefore).toHaveBeenCalledTimes(3);
    leases.forEach((lease) => lease.release());
    runtime.destroy();
  });

  it.fails('[AD-167] does not probe a revoked active channel and resumes its pending interest after a later grant', async () => {
    // 用户能力：撤销中的频道不再探测，重新授权后恢复一次待处理 interest。
    // 不变量：grant epoch 是 probe admission owner；公开 owner：ChannelFeedRuntime + access/history port。
    const options = feedOptions();
    options.wireRef.current = { channelMeta: vi.fn(async () => ({ channel_id: 'c0', head_seq: 0, has_rows: false })) };
    const { runtime, snapshot } = await attachedRuntime({ options, boot: 'round20-revoke-boot' });
    await snapshot().setHistoryGrants([], { generation: 1, boot: 'round20-revoke-boot', focus: 'c0' });
    await snapshot().refreshChannel('c0');
    expect(options.wireRef.current.channelMeta).not.toHaveBeenCalled();
    await snapshot().setHistoryGrants([
      { channel_id: 'c0', head_seq: 0, has_rows: false },
    ], { generation: 2, boot: 'round20-regrant-boot', focus: 'c0' });
    await snapshot().refreshChannel('c0');
    expect(options.wireRef.current.channelMeta).toHaveBeenCalledTimes(1);
    runtime.destroy();
  });

  it('[AD-168] turns only a current channel_meta forbidden into authoritative revoke and resumes on a later grant', async () => {
    // 用户能力：当前 generation 的 forbidden 立即撤销，下一次 grant 后可恢复。
    // 不变量：旧 generation 的错误不能污染新授权；公开 owner：ChannelFeedRuntime。
    const options = feedOptions();
    const forbidden = Object.assign(new Error('forbidden'), { code: 'forbidden' });
    options.wireRef.current = {
      channelMeta: vi.fn()
        .mockRejectedValueOnce(forbidden)
        .mockResolvedValueOnce({ channel_id: 'c0', head_seq: 0, has_rows: false }),
    };
    const { runtime, snapshot } = await attachedRuntime({ options, boot: 'round20-forbidden-boot' });
    expect(await snapshot().refreshChannel('c0')).toBe(false);
    expect(snapshot().historyFor('c0')).toMatchObject({ attached: false, messageCurrent: false });
    await snapshot().setHistoryGrants([
      { channel_id: 'c0', head_seq: 0, has_rows: false },
    ], { generation: 2, boot: 'round20-forbidden-next', focus: 'c0' });
    expect(await snapshot().refreshChannel('c0')).toBe(true);
    runtime.destroy();
  });

  it('[AD-169] keeps transient channel_meta failures admitted and retryable', async () => {
    // 用户能力：临时 channel_meta 失败不把频道判成永久 revoked，重试可恢复。
    // 不变量：只有明确 forbidden 才能撤销 access；公开 owner：ChannelFeedRuntime。
    const options = feedOptions();
    options.wireRef.current = {
      channelMeta: vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'timeout' }))
        .mockResolvedValueOnce({ channel_id: 'c0', head_seq: 0, has_rows: false }),
    };
    const { runtime, snapshot } = await attachedRuntime({ options, boot: 'round20-transient-boot' });
    await expect(snapshot().refreshChannel('c0')).rejects.toMatchObject({ code: 'timeout' });
    expect(snapshot().historyFor('c0')).toMatchObject({ attached: true, messageCurrent: true });
    expect(await snapshot().refreshChannel('c0')).toBe(true);
    runtime.destroy();
  });

  it.fails('[AD-170] does not leave cached access visible when scheduler resets during a current forbidden probe', async () => {
    // 用户能力：forbidden probe 收敛时旧缓存访问事实必须撤下。
    // 不变量：scheduler/access revoke 同步清理当前 projection；公开 owner：ChannelFeedRuntime + Replica。
    const options = feedOptions();
    const forbidden = Object.assign(new Error('forbidden'), { code: 'forbidden' });
    options.wireRef.current = { channelMeta: vi.fn().mockRejectedValue(forbidden) };
    const { runtime, snapshot } = await attachedRuntime({ options, boot: 'round20-cache-revoke-boot' });
    snapshot().enqueue(liveRow('c0', 1, {
      id: 'cached-visible', kind: 'event', type: 'human.note', visibility: 'public',
      sender: { id: 'human:other:1', kind: 'human' }, audience: ['human:root:1'], payload: { body: { text: 'cached' } },
    }));
    await snapshot().refreshChannel('c0');
    expect(snapshot().stateFor('c0')?.rows.size || 0).toBe(0);
    runtime.destroy();
  });

  it('[AD-171] commits live before owner/boot persistence is ready and fences the disk write', async () => {
    // 用户能力：连接 live 行先可见，旧 owner/boot 的迟到持久化不能覆盖新世界。
    // 不变量：live Replica commit 与 cache persistence 分离并受 owner epoch fence；公开 owner：ChannelFeedRuntime + Replica cache。
    const options = feedOptions();
    const { runtime, snapshot, principal } = await attachedRuntime({ boot: 'round20-live-first-boot' });
    const preparation = snapshot().prepareLocalReplica(principal, { focus: 'c0' });
    expect(snapshot().enqueue(liveRow('c0', 1, {
      id: 'live-before-cache', kind: 'event', type: 'human.note', visibility: 'public',
      sender: { id: 'human:other:1', kind: 'human' }, audience: ['human:root:1'], payload: { body: { text: 'live first' } },
    }))).toBe(true);
    expect(snapshot().stateFor('c0')?.rows.has(1)).toBe(true);
    await preparation;
    await snapshot().setHistoryGrants([
      { channel_id: 'c0', head_seq: 0, has_rows: false },
    ], { generation: 2, boot: 'round20-live-first-next', focus: 'c0' });
    expect(snapshot().stateFor('c0')?.rows.has(1)).not.toBe(true);
    runtime.destroy();
  });

  it('[AD-172] does not install late cache Meta for a channel omitted from the attach grant set', async () => {
    // 用户能力：未获 grant 的频道不能因迟到 cache Meta 出现在当前 Replica。
    // 不变量：attach grant 集合限制 Meta/row 安装；公开 owner：ChannelFeedRuntime + ChannelReplica cache。
    const principal = `round20-meta-principal-${++principalSerial}`;
    const seed = await attachedRuntime({
      principal,
      boot: 'round20-meta-boot',
      entries: [{ channel_id: 'c1', head_seq: 1, has_rows: true }],
      focus: 'c1',
    });
    seed.snapshot().enqueue(liveRow('c1', 1, {
      id: 'late-meta-row', kind: 'event', type: 'human.note', visibility: 'public',
      sender: { id: 'human:other:1', kind: 'human' }, audience: ['human:root:1'], payload: { body: { text: 'late meta' } },
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    seed.runtime.destroy();
    const next = await attachedRuntime({
      principal,
      boot: 'round20-meta-boot',
      entries: [{ channel_id: 'c0', head_seq: 0, has_rows: false }],
      focus: 'c0',
    });
    expect(next.snapshot().stateFor('c1')?.rows.has(1)).not.toBe(true);
    next.runtime.destroy();
  });

  it('[AD-173] does not retain rejected pre-Meta receipts across a revoked channel or successor generation', async () => {
    // 用户能力：撤销频道后，旧 history receipt 不能把 rows 带回 successor generation。
    // 不变量：receipt ref + attach epoch + generation 三重 fence；公开 owner：ChannelFeedRuntime history owner。
    let resolvePage;
    const options = feedOptions();
    const calls = [];
    options.wireRef.current = {
      historyBefore: vi.fn((channelId, beforeSeq, _limit, detail) => {
        const ref = `round20-receipt-${calls.length + 1}`;
        calls.push({ channelId, beforeSeq, ref, ...detail });
        const pending = new Promise((resolve) => { resolvePage = resolve; });
        pending.ref = ref;
        return pending;
      }),
      cancelHistory: vi.fn(async () => {}),
    };
    const { runtime, snapshot } = await attachedRuntime({
      options,
      entries: [{ channel_id: 'c1', head_seq: 3, has_rows: true }],
      boot: 'round20-receipt-boot',
      focus: 'c1',
    });
    const pending = snapshot().loadHistory('c1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toHaveLength(1);
    await snapshot().setHistoryGrants([], { generation: 1, boot: 'round20-receipt-boot', focus: 'c1' });
    resolvePage({
      accepted: true, channel_id: 'c1', generation: 1, rows: 1,
      scan_low_seq: 3, scan_high_seq: 3, next_before_seq: 3, has_older: false,
    });
    await pending;
    expect(snapshot().stateFor('c1')?.rows.has(3)).not.toBe(true);
    await snapshot().setHistoryGrants([
      { channel_id: 'c1', head_seq: 3, has_rows: true },
    ], { generation: 2, boot: 'round20-receipt-successor', focus: 'c1' });
    expect(snapshot().stateFor('c1')?.rows.has(3)).not.toBe(true);
    runtime.destroy();
  });

  it.fails('[AD-178] returns after Meta creates queues without waiting for the selected cache body', async () => {
    // 用户能力：attach 后 live queue 可立即接收，不能被选中频道的慢 cache body 阻塞。
    // 不变量：Meta/readiness 与 body hydration 是两个可并行 owner；公开 owner：ChannelFeedRuntime + Replica cache。
    const principal = `round20-body-principal-${++principalSerial}`;
    const seed = await attachedRuntime({
      principal,
      boot: 'round20-body-boot',
      entries: [{ channel_id: 'c0', head_seq: 100, has_rows: true }],
      focus: 'c0',
    });
    seed.snapshot().enqueue(liveRow('c0', 100, {
      id: 'cached-body', kind: 'event', type: 'human.note', visibility: 'public',
      sender: { id: 'human:other:1', kind: 'human' }, audience: ['human:root:1'], payload: { body: { text: 'cached body' } },
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    seed.runtime.destroy();
    const next = await attachedRuntime({
      principal,
      boot: 'round20-body-boot',
      entries: [{ channel_id: 'c0', head_seq: 100, has_rows: true }],
      focus: 'c0',
    });
    const prepared = next.snapshot().resumeLocalReplica();
    expect(prepared).toMatchObject({ c0: 100 });
    expect(next.snapshot().stateFor('c0')?.rows.has(100)).toBe(false);
    next.runtime.destroy();
  });

  it.fails('[AD-182] keeps a terminal-first Gateway suffix closed across mobile trim and the older request page', async () => {
    // 用户能力：terminal-first 历史经过窗口裁剪后，旧 request 回页仍显示已完成且不进入 Waiting。
    // 不变量：trim 只丢完整 body，保留 compact terminal closure；公开 owner：ChannelFeedRuntime + ChannelReplica.
    const calls = [];
    const options = feedOptions();
    options.wireRef.current = {
      historyBefore: vi.fn((channelId, beforeSeq, _limit, detail) => {
        const ref = `round20-trim-${calls.length + 1}`;
        calls.push({ channelId, beforeSeq, ref, ...detail });
        const receipt = Promise.resolve({ accepted: true, channel_id: channelId, generation: detail.generation });
        receipt.ref = ref;
        return receipt;
      }),
      cancelHistory: vi.fn(async () => {}),
    };
    const { runtime, snapshot } = await attachedRuntime({
      options,
      entries: [{ channel_id: 'c0', head_seq: 960, has_rows: true }],
      boot: 'round20-trim-boot',
    });
    const pending = snapshot().loadHistory('c0');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const first = calls[0];
    for (let seq = 429; seq < 460; seq += 1) {
      snapshot().enqueue({
        source: 'history', ref: first.ref, generation: 1, channel_id: 'c0', seq,
        envelope: { id: `suffix-noise-${seq}`, kind: 'event', type: 'human.note', visibility: 'public', sender: HUMAN, audience: [], payload: { body: { text: 'noise' } } },
      });
    }
    snapshot().enqueue({
      source: 'history', ref: first.ref, generation: 1, channel_id: 'c0', seq: 460,
      envelope: response('old-terminal', 'old-request', { status: 'completed', text: 'old answer' }),
    });
    snapshot().pageEnd({
      source: 'history', ref: first.ref, generation: 1, channel_id: 'c0', purpose: first.purpose,
      head_seq: 960, oldest_seq: 429, scan_low_seq: 429, scan_high_seq: 960,
      next_before_seq: 429, rows: 32, bytes: 4096, has_older: true,
    });
    await pending;
    for (let seq = 461; seq <= 970; seq += 1) {
      snapshot().enqueue(liveRow('c0', seq, {
        id: `live-noise-${seq}`, kind: 'event', type: 'human.note', visibility: 'public', sender: HUMAN, audience: [], payload: { body: { text: 'noise' } },
      }));
    }
    const state = snapshot().stateFor('c0');
    expect(state.rows.has(460)).toBe(false);
    const older = snapshot().loadHistory('c0');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const olderCall = calls[1];
    snapshot().enqueue({
      source: 'history', ref: olderCall.ref, generation: 1, channel_id: 'c0', seq: 100,
      envelope: request('old-request', 'old queued work'),
    });
    snapshot().enqueue({
      source: 'history', ref: olderCall.ref, generation: 1, channel_id: 'c0', seq: 101,
      envelope: response('old-queued', 'old-request', { status: 'queued', controls: [{ word: 'agent.interrupt' }] }),
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
});
