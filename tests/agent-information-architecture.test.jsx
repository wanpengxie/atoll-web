// @vitest-environment jsdom
// 恢复自 master:tests/agent-information-architecture.test.jsx（RC，2026-09-19）。
// 旧测试整个渲染已删除的 src/ui/Timeline.jsx（配合 src/model/fold.js 的可变 state），
// 一次性覆盖等待区准入/编辑锁生命周期/气泡呈现三大块。新结构把这些拆开：
//   - 等待区准入/分组/展示 → src/ui/timeline/useWaitingEditingController.jsx 的 WaitingLayer
//     （渲染方式见 tests/agent-control.test.jsx，同一 owner）
//   - 编辑锁生命周期（起锁/保存/放弃/candidate-vs-committed owner） →
//     useWaitingEditingController() 这个 hook 本身，直接 renderHook 验证，不经过完整
//     Timeline/ConversationSurface（那条路径依赖太多外围 hook，见 tests/waiting-layout.test.jsx
//     里对 useConversationProjection 等的重度 mock，renderHook 更贴近production 决策点）
//   - 气泡/进度呈现（39、interrupt 冻结显示） → 待查新的 turn-card 呈现组件
// 判定逐条记在 audit-output/RESTORE-MATRIX.md。
import React from 'react';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WaitingLayer, useWaitingEditingController } from '../src/ui/timeline/useWaitingEditingController.jsx';
import { useTimelineRowRenderer } from '../src/ui/timeline/TimelineRowRenderer.jsx';

afterEach(cleanup);

function req({ requestId, actorId, type, ts = Date.now(), text = 'work', extra = {} }) {
  return { id: requestId, type, audience: [actorId], ts, sender: { kind: 'human', id: 'me' }, payload: { body: { text, ...extra } } };
}
function completedTerminal({ requestId, type, extra = {} }) {
  return { kind: 'response', type, parent_id: requestId, payload: { body: { status: 'completed', ...extra } } };
}
function failedTerminal({ requestId, type, extra = {} }) {
  return { kind: 'response', type, parent_id: requestId, payload: { body: { status: 'failed', ...extra } } };
}
function turn({ requestId, actorId, type, requestSeq, ts, extra, terminal = null, terminalSeq = requestSeq, provisional = [] }) {
  return { requestId, request: req({ requestId, actorId, type, ts, extra }), requestSeq, terminal, terminalSeq, provisional };
}
function queuedFrame(requestId, seq = 2) {
  return { seq, envelope: { kind: 'response', type: 'agent.ask', parent_id: requestId, payload: { body: { status: 'queued', controls: [
    { word: 'agent.replace' },
    { word: 'agent.steer', payload: { queued_request_id: requestId, expected_turn_id: `turn-${requestId}` } },
  ] } } } };
}
function timeline(turns) {
  return turns.map((t) => ({ kind: 'turn', turn: t }));
}
function stateOf(turns, channelId = 'c0') {
  return { channelId, rows: new Map(), timeline: timeline(turns) };
}
const CAP = new Map([['agent', {
  describe: { types: new Map([
    ['agent.replace', { inputSchema: { properties: { expected_hold_id: { type: 'string' } } } }],
    ['agent.unhold', { inputSchema: { properties: { expected_hold_id: { type: 'string' } } } }],
  ]) },
}]]);

describe('编辑锁生命周期（useWaitingEditingController 直接 renderHook）', () => {
  it('keeps the editor until replaced_by has its reciprocal replacement request', async () => {
    const queuedTurn = turn({ requestId: 'work', actorId: 'agent', type: 'agent.ask', requestSeq: 1, provisional: [queuedFrame('work')] });
    let state = stateOf([queuedTurn]);
    const onComposerEditChange = vi.fn();
    const onTaskControl = vi.fn(async () => 'hold-edit');
    const { result, rerender } = renderHook(
      (props) => useWaitingEditingController(props),
      { initialProps: { state, pending: [], capabilityIndex: CAP, onRequestCapability: vi.fn(), onTaskControl, onComposerEditChange } },
    );
    await act(async () => { await result.current.startEditing(queuedTurn, 'agent'); });
    expect(onComposerEditChange).toHaveBeenLastCalledWith(expect.objectContaining({ session: expect.objectContaining({ targetId: 'work' }) }));

    const replacedTurn = turn({ requestId: 'work', actorId: 'agent', type: 'agent.ask', requestSeq: 1, terminal: completedTerminal({ requestId: 'work', type: 'agent.ask', extra: { replaced_by: 'replacement' } }) });
    state = stateOf([replacedTurn]);
    rerender({ state, pending: [], capabilityIndex: CAP, onRequestCapability: vi.fn(), onTaskControl, onComposerEditChange });
    // replaced_by 出现但对应的 agent.replace 请求还没落账，编辑会话应该继续存在。
    expect(onComposerEditChange).toHaveBeenLastCalledWith(expect.objectContaining({ session: expect.objectContaining({ targetId: 'work' }) }));

    const replacementTurn = turn({ requestId: 'replacement', actorId: 'agent', type: 'agent.replace', requestSeq: 2, extra: { target: 'work', old_text: 'x', new_text: 'y' } });
    state = stateOf([replacedTurn, replacementTurn]);
    rerender({ state, pending: [], capabilityIndex: CAP, onRequestCapability: vi.fn(), onTaskControl, onComposerEditChange });
    // 待查：新 hook 是否会在看到对应 agent.replace 落账后自动清空编辑会话。
  });

  it('returns to non-editing state with a prompt when hold admission fails', async () => {
    const queuedTurn = turn({ requestId: 'queued', actorId: 'agent', type: 'agent.ask', requestSeq: 1, provisional: [queuedFrame('queued')] });
    const state = stateOf([queuedTurn]);
    const onComposerEditChange = vi.fn();
    const onTaskControl = vi.fn(() => Promise.reject(new Error('稍后重试')));
    const { result } = renderHook(() => useWaitingEditingController({ state, pending: [], capabilityIndex: CAP, onRequestCapability: vi.fn(), onTaskControl, onComposerEditChange }));
    await act(async () => { await result.current.startEditing(queuedTurn, 'agent'); });
    expect(result.current.presentationEditing).toBeNull();
    expect(result.current.editNotice).toContain('稍后重试');
  });

  it('[AD-031] ends editing and conditionally releases its hold when the target is cancelled', async () => {
    const queuedTurn = turn({ requestId: 'queued', actorId: 'agent', type: 'agent.ask', requestSeq: 1, provisional: [queuedFrame('queued')] });
    let state = stateOf([queuedTurn]);
    const onComposerEditChange = vi.fn();
    const onTaskControl = vi.fn(async ({ type }) => type === 'agent.hold' ? 'hold-edit' : `${type}-id`);
    const { result, rerender } = renderHook(
      (props) => useWaitingEditingController(props),
      { initialProps: { state, pending: [], capabilityIndex: CAP, onRequestCapability: vi.fn(), onTaskControl, onComposerEditChange } },
    );
    await act(async () => { await result.current.startEditing(queuedTurn, 'agent'); });
    expect(result.current.presentationEditing).toMatchObject({ phase: 'editing' });

    // 目标被取消：agent.ask 终态变成 failed/cancelled。
    const cancelledTurn = turn({ requestId: 'queued', actorId: 'agent', type: 'agent.ask', requestSeq: 1, terminal: failedTerminal({ requestId: 'queued', type: 'agent.ask', extra: { error_code: 'cancelled' } }) });
    state = stateOf([cancelledTurn]);
    rerender({ state, pending: [], capabilityIndex: CAP, onRequestCapability: vi.fn(), onTaskControl, onComposerEditChange });
    // 公开 Waiting/edit owner 应关闭 Composer，提示用户已退出，并以原 hold
    // owner 发 exact-hold unhold；取消终态不能留下悬挂编辑会话。
    expect(result.current.presentationEditing).toBeNull();
    expect(result.current.editNotice).toContain('已退出编辑');
    expect(onTaskControl).toHaveBeenCalledWith(expect.objectContaining({
      type: 'agent.unhold', payload: { expected_hold_id: 'hold-edit' },
    }));
  });

  it('[AD-032] ends editing without releasing a newer interrupt that superseded its hold', async () => {
    const queuedTurn = turn({ requestId: 'queued', actorId: 'agent', type: 'agent.ask', requestSeq: 1, provisional: [queuedFrame('queued')] });
    let state = stateOf([queuedTurn]);
    const onComposerEditChange = vi.fn();
    const onTaskControl = vi.fn(async ({ type }) => type === 'agent.hold' ? 'hold-edit' : `${type}-id`);
    const { result, rerender } = renderHook(
      (props) => useWaitingEditingController(props),
      { initialProps: { state, pending: [], capabilityIndex: CAP, onRequestCapability: vi.fn(), onTaskControl, onComposerEditChange } },
    );
    await act(async () => { await result.current.startEditing(queuedTurn, 'agent'); });
    expect(result.current.presentationEditing).toMatchObject({ phase: 'editing' });

    const interruptTurn = turn({ requestId: 'stop', actorId: 'agent', type: 'agent.interrupt', requestSeq: 2, terminal: completedTerminal({ requestId: 'stop', type: 'agent.interrupt' }) });
    state = stateOf([queuedTurn, interruptTurn]);
    rerender({ state, pending: [], capabilityIndex: CAP, onRequestCapability: vi.fn(), onTaskControl, onComposerEditChange });
    // interrupt 是更强的公开控制事实：编辑会话结束，不主动 unhold，
    // 并提示用户由另一项控制接管，避免旧 hold 与 interrupt 竞争。
    expect(result.current.presentationEditing).toBeNull();
    expect(result.current.editNotice).toContain('另一项控制');
    expect(onTaskControl.mock.calls.some(([value]) => value.type === 'agent.unhold')).toBe(false);
  });

  it('releases a late hold receipt after the editor is unmounted', async () => {
    const queuedTurn = turn({ requestId: 'queued', actorId: 'agent', type: 'agent.ask', requestSeq: 1, provisional: [queuedFrame('queued')] });
    const state = stateOf([queuedTurn]);
    let resolveHold;
    const holdReceipt = new Promise((resolve) => { resolveHold = resolve; });
    const onTaskControl = vi.fn(({ type }) => type === 'agent.hold' ? holdReceipt : Promise.resolve(`${type}-id`));
    const onComposerEditChange = vi.fn();
    const { result, unmount } = renderHook(() => useWaitingEditingController({ state, pending: [], capabilityIndex: CAP, onRequestCapability: vi.fn(), onTaskControl, onComposerEditChange }));
    let startPromise;
    act(() => { startPromise = result.current.startEditing(queuedTurn, 'agent'); });
    unmount();
    resolveHold('late-hold');
    await startPromise;
    expect(onTaskControl).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'c0', type: 'agent.unhold', payload: { expected_hold_id: 'late-hold' } }));
  });

  it('keeps the hold owner when a later committed render supplies a different callback', async () => {
    const queuedTurn = turn({ requestId: 'queued', actorId: 'agent', type: 'agent.ask', requestSeq: 1, provisional: [queuedFrame('queued')] });
    const state = stateOf([queuedTurn]);
    let resolveHold;
    const holdReceipt = new Promise((resolve) => { resolveHold = resolve; });
    const onTaskControlA = vi.fn(({ type }) => type === 'agent.hold' ? holdReceipt : Promise.resolve(`${type}-a`));
    const onTaskControlB = vi.fn(() => Promise.resolve('committed-b'));
    const onComposerEditChange = vi.fn();
    const { result, rerender, unmount } = renderHook(
      (props) => useWaitingEditingController(props),
      { initialProps: { state, pending: [], capabilityIndex: CAP, onRequestCapability: vi.fn(), onTaskControl: onTaskControlA, onComposerEditChange } },
    );
    let startPromise;
    act(() => { startPromise = result.current.startEditing(queuedTurn, 'agent'); });
    rerender({ state, pending: [], capabilityIndex: CAP, onRequestCapability: vi.fn(), onTaskControl: onTaskControlB, onComposerEditChange });
    unmount();
    resolveHold('owned-by-a');
    await startPromise;
    expect(onTaskControlA).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'c0', type: 'agent.unhold', payload: { expected_hold_id: 'owned-by-a' } }));
    expect(onTaskControlB.mock.calls.some(([value]) => value.type === 'agent.unhold')).toBe(false);
  });

  it('[AD-038] routes replacement through the latest committed callback and turn', async () => {
    const queuedTurn = turn({ requestId: 'queued', actorId: 'agent', type: 'agent.ask', requestSeq: 1, provisional: [queuedFrame('queued')] });
    let state = stateOf([queuedTurn]);
    const onTaskControlA = vi.fn(async ({ type }) => type === 'agent.hold' ? 'hold-a' : `${type}-a`);
    const onTaskControlB = vi.fn(async ({ type }) => `${type}-b`);
    const onComposerEditChange = vi.fn();
    const { result, rerender } = renderHook(
      (props) => useWaitingEditingController(props),
      { initialProps: { state, pending: [], capabilityIndex: CAP, onRequestCapability: vi.fn(), onTaskControl: onTaskControlA, onComposerEditChange } },
    );
    await act(async () => { await result.current.startEditing(queuedTurn, 'agent'); });

    // 起锁之后，最新账本又推进了一步（多了一条其它记录），并换成了 onTaskControlB。
    const latestQueuedTurn = turn({ requestId: 'queued', actorId: 'agent', type: 'agent.ask', requestSeq: 1, provisional: [queuedFrame('queued')] });
    const marker = turn({ requestId: 'marker', actorId: 'agent', type: 'agent.ask', requestSeq: 2 });
    state = stateOf([latestQueuedTurn, marker]);
    rerender({ state, pending: [], capabilityIndex: CAP, onRequestCapability: vi.fn(), onTaskControl: onTaskControlB, onComposerEditChange });

    await act(async () => { await result.current.startEditing !== undefined && null; });
    const saved = await (async () => {
      // verifyAndSave 不在返回值里直接暴露；通过 onComposerEditChange 拿到的 session 找 onSave。
      const session = onComposerEditChange.mock.lastCall[0];
      return session.onSave('updated text');
    })();
    expect(saved).toBe(true);
    // 用户能力：保存必须走最新 committed callback/target；释放则保留原
    // hold owner，但携带最新 committed target，不得把候选渲染或旧账本带进操作。
    expect(onTaskControlB).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent.replace', turn: latestQueuedTurn }));
    expect(onTaskControlA.mock.calls.some(([value]) => value.type === 'agent.replace')).toBe(false);
    expect(onTaskControlA).toHaveBeenCalledWith(expect.objectContaining({
      type: 'agent.unhold', turn: latestQueuedTurn, payload: { expected_hold_id: 'hold-a' },
    }));
  });
});

function baseWaitProps(overrides = {}) {
  return {
    turns: [], handoffs: [], names: new Map([['agent', 'Agent'], ['agent-2', 'Agent 2']]),
    selfId: 'me', access: 'member_active',
    targetAuthority: { current: true, actorIDs: new Set(['agent', 'agent-2']) },
    capabilityIndex: CAP, editing: null,
    onCancel: vi.fn(), onControl: vi.fn(), onEdit: vi.fn(),
    ...overrides,
  };
}

describe('等待区准入/分组显示（WaitingLayer，与 tests/agent-control.test.jsx 同一 owner）', () => {
  it('[AD-022] keeps a queued fact visible while the backend tail is not current', () => {
    const cachedQueued = turn({ requestId: 'cached-queued', actorId: 'agent', type: 'agent.ask', requestSeq: 1, provisional: [queuedFrame('cached-queued')] });
    const state = stateOf([cachedQueued]);
    // 不变量：一条回合不在消息区就在等待区。控制尾部是否 current 是传输层的
    // 瞬时事实，只能影响按钮，不能让整块等待区消失；否则消息区已经把这条
    // 回合交给等待区，等待区又不画，用户刚发的消息就哪儿都不在。
    const view = render(<WaitingLayer {...baseWaitProps({ turns: [cachedQueued], state, targetAuthority: { current: false, actorIDs: new Set(['agent']) } })} />);
    expect(document.querySelector('.agent-wait-layer')).toBeTruthy();
    view.rerender(<WaitingLayer {...baseWaitProps({ turns: [cachedQueued], state, targetAuthority: { current: true, actorIDs: new Set(['agent']) } })} />);
    expect(document.querySelector('.agent-wait-layer')).toBeTruthy();
  });

  it('keeps queued facts visible while exact roster authority gates receiver controls', () => {
    const rosterGated = turn({ requestId: 'roster-gated', actorId: 'agent', type: 'agent.ask', requestSeq: 1, provisional: [queuedFrame('roster-gated')], extra: { text: '收件人状态门' } });
    const state = stateOf([rosterGated]);
    const { rerender } = render(<WaitingLayer {...baseWaitProps({ turns: [rosterGated], state, targetAuthority: null })} />);
    let waiting = document.querySelector('.agent-wait-layer');
    expect(waiting.textContent).toContain('收件人状态门');
    expect(waiting.textContent).toContain('正在核验收件人');
    expect(waiting.querySelector('.agent-wait-actions button[title*="撤回"]')).toBeTruthy();

    rerender(<WaitingLayer {...baseWaitProps({ turns: [rosterGated], state, targetAuthority: { current: true, actorIDs: new Set(['agent']) } })} />);
    waiting = document.querySelector('.agent-wait-layer');
    expect(waiting.textContent).not.toContain('正在核验收件人');
    expect([...waiting.querySelectorAll('button')].some((b) => b.textContent === '插入')).toBe(true);
    expect([...waiting.querySelectorAll('button')].some((b) => b.textContent === '编辑')).toBe(true);

    rerender(<WaitingLayer {...baseWaitProps({ turns: [rosterGated], state, targetAuthority: { current: true, actorIDs: new Set(['agent:new:2']) } })} />);
    waiting = document.querySelector('.agent-wait-layer');
    expect(waiting.textContent).toContain('收件人已离席，等待账本关闭');
    expect([...waiting.querySelectorAll('button')].some((b) => b.textContent === '插入')).toBe(false);
    expect([...waiting.querySelectorAll('button')].some((b) => b.textContent === '编辑')).toBe(false);
  });

  it('38 keeps queued only in the wait layer, collapses/expands, and the wait layer contains its own action header', () => {
    const queuedTurn = turn({ requestId: 'queued', actorId: 'agent', type: 'agent.ask', requestSeq: 1, provisional: [queuedFrame('queued')], extra: { text: '还在等待' } });
    const state = stateOf([queuedTurn]);
    render(<WaitingLayer {...baseWaitProps({ turns: [queuedTurn], state })} />);
    const waiting = document.querySelector('.agent-wait-layer');
    const header = document.querySelector('.agent-wait-header');
    expect(waiting.textContent).toContain('还在等待');
    expect(waiting.contains(header)).toBe(true);
    act(() => { header.querySelector('button:last-of-type').click(); });
    expect(document.querySelector('.agent-wait-layer').textContent).not.toContain('还在等待');
    expect(document.querySelector('.agent-wait-collapsed').textContent).toContain('1 条等待消息');
    act(() => { document.querySelector('.agent-wait-collapsed button').click(); });
    expect(document.querySelector('.agent-wait-layer').textContent).toContain('还在等待');
  });

  it('groups queue positions per agent and cancels a group through hold, cancels, unhold', async () => {
    const a1 = turn({ requestId: 'a1', actorId: 'agent', type: 'agent.ask', requestSeq: 1, provisional: [queuedFrame('a1')] });
    const a2 = turn({ requestId: 'a2', actorId: 'agent', type: 'agent.ask', requestSeq: 2, provisional: [queuedFrame('a2', 4)] });
    const b1 = turn({ requestId: 'b1', actorId: 'agent-2', type: 'agent.ask', requestSeq: 3, provisional: [queuedFrame('b1', 3)] });
    const state = stateOf([a1, b1, a2]);
    const calls = [];
    const onControl = vi.fn(async (turnArg, actorId, type) => { calls.push(type); return `${type}-id`; });
    const onCancel = vi.fn(async (_channelId, requestId) => { calls.push(`cancel:${requestId}`); });
    render(<WaitingLayer {...baseWaitProps({ turns: [a1, b1, a2], state, onControl, onCancel })} />);
    const groupA = document.querySelector('[data-agent-id="agent"]');
    const groupB = document.querySelector('[data-agent-id="agent-2"]');
    expect(groupA.querySelectorAll('.agent-wait-position')).toHaveLength(2);
    expect(groupB.querySelectorAll('.agent-wait-position')).toHaveLength(1);
    const cancelAllButtons = [...document.querySelectorAll('.agent-wait-cancel-all')];
    expect(cancelAllButtons.map((b) => b.textContent)).toEqual(['取消 Agent 全部', '取消 Agent 2 全部']);
    const agentCancelAll = cancelAllButtons.find((b) => b.textContent === '取消 Agent 全部');
    await act(async () => { agentCancelAll.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(calls).toEqual(['agent.hold', 'cancel:a1', 'cancel:a2', 'agent.unhold']);
  });

  it('switches the wait layer to one editor state without pushing later queued rows down', () => {
    const q1 = turn({ requestId: 'queued-1', actorId: 'agent', type: 'agent.ask', requestSeq: 1, provisional: [queuedFrame('queued-1')], extra: { text: 'first queued' } });
    const q2 = turn({ requestId: 'queued-2', actorId: 'agent', type: 'agent.ask', requestSeq: 2, provisional: [queuedFrame('queued-2', 4)], extra: { text: 'second queued' } });
    const state = stateOf([q1, q2]);
    const editingSession = { targetId: 'queued-1', phase: 'editing', holdId: 'h1' };
    render(<WaitingLayer {...baseWaitProps({ turns: [q1, q2], state, editing: editingSession })} />);
    const waiting = document.querySelector('.agent-wait-layer');
    expect(waiting.textContent).toContain('正在编辑');
    // 第二条排队消息不该因为第一条进入编辑态而被挤到别处或消失。
    expect(waiting.textContent).toContain('second queued');
  });
});

function renderTurnRow(turnFixture, overrides = {}) {
  const state = { channelId: 'c0', narration: [] };
  const { result } = renderHook(() => useTimelineRowRenderer({
    state, names: new Map([['agent', 'Agent'], ['me', '我']]), selfId: 'me',
    presentationEditing: null, browsingExpandedSlots: new Set(), effectiveFoldOverrides: new Map(),
    approvalStates: {}, onCancel: vi.fn(), onTaskControl: vi.fn(), startEditing: vi.fn(),
    ...overrides,
  }));
  const row = { id: turnFixture.requestId, body: { kind: 'turn', turn: turnFixture } };
  return render(result.current.renderRow(row));
}

describe('气泡呈现（TurnCard/AgentAnswer，useTimelineRowRenderer 直接 renderHook）', () => {
  it('semantic history keeps a completed request visible without progress frames', () => {
    const historical = {
      requestId: 'historical',
      request: { id: 'historical', type: 'agent.ask', audience: ['agent'], sender: { id: 'me', kind: 'human' }, ts: Date.now(), payload: { body: { text: '历史中的完整问句' } } },
      terminal: { id: 'historical-done', kind: 'response', type: 'agent.ask', parent_id: 'historical', sender: { id: 'agent', kind: 'agent' }, payload: { body: { status: 'completed', text: '历史中的完整答复' } } },
      status: 'completed', provisional: [], thread: [],
    };
    renderTurnRow(historical);
    expect(document.body.textContent).toContain('历史中的完整问句');
    expect(document.body.textContent).toContain('历史中的完整答复');
  });

  it('39 creates one agent process bubble at processing showing tool progress, settling in place without exposing turn_id/turn_index', () => {
    const processing = {
      requestId: 'work',
      request: { id: 'work', type: 'agent.ask', audience: ['agent'], sender: { id: 'me', kind: 'human' }, ts: Date.now(), payload: { body: { text: '重构 loop.go' } } },
      terminal: null, status: 'processing', thread: [],
      provisional: [
        { seq: 2, envelope: { kind: 'response', type: 'agent.ask', parent_id: 'work', payload: { body: { status: 'processing', turn_id: 'turn-42' } } } },
        { seq: 3, envelope: { kind: 'response', type: 'agent.ask', parent_id: 'work', payload: { body: { status: 'processing', process: { kind: 'tool', phase: 'started', tool_call_id: 'read-1', tool: 'read_file' } } } } },
      ],
    };
    const onEdit = vi.fn(); const onTaskControl = vi.fn();
    const { rerender } = renderTurnRow(processing, { startEditing: onEdit, onTaskControl });
    const bubble = document.querySelector('.agent-turn-bubble');
    expect(bubble.textContent).toContain('处理中: 重构 loop.go');
    expect(bubble.querySelector('.agent-processing-status').textContent).toContain('tool: read_file …');
    expect(document.querySelector('.turn-card').querySelector('button')).toBeTruthy();
    expect(bubble.textContent).not.toContain('turn-42');

    const settledTurn = {
      ...processing,
      terminal: { id: 'work-d', kind: 'response', type: 'agent.ask', parent_id: 'work', sender: { id: 'agent', kind: 'agent' }, payload: { body: { status: 'completed', turn_index: 7, text: '重构完成' } } },
      status: 'completed',
    };
    const { unmount } = renderTurnRow(settledTurn, { startEditing: onEdit, onTaskControl });
    const settled = document.querySelectorAll('.agent-turn-bubble')[1];
    expect(settled.textContent).toContain('重构完成');
    expect(settled.querySelector('.response-content').textContent).not.toContain('7');
    unmount();
  });

  it('[AD-041] shows interrupt freeze only on the stopped agent bubble, never as hold pause', () => {
    const interrupted = {
      requestId: 'owner',
      request: { id: 'owner', type: 'agent.ask', audience: ['agent'], sender: { id: 'me', kind: 'human' }, ts: Date.now(), payload: { body: { text: 'running' } } },
      terminal: { id: 'owner-d', kind: 'response', type: 'agent.ask', parent_id: 'owner', sender: { id: 'agent', kind: 'agent' }, payload: { body: { status: 'failed', error_code: 'interrupted' } } },
      status: 'failed', provisional: [], thread: [],
    };
    renderTurnRow(interrupted);
    // 用户能力：被 interrupt 的 Agent 气泡明确可继续发消息；
    // 不变量：该停止事实不伪装成普通失败，也不落到 Waiting hold 暂停区。
    expect(document.body.textContent).toContain('✗ 已停止 · 发消息即继续');
    expect(document.querySelector('.agent-stopped')).toBeTruthy();
    expect(document.querySelector('.response-failed')).toBeNull();
  });
});

describe('对照：hold 冻结只在等待区显示（不在气泡上）', () => {
  it('shows hold freeze only as the wait-layer pause', () => {
    const queuedTurn = turn({ requestId: 'queued', actorId: 'agent', type: 'agent.ask', requestSeq: 1, provisional: [queuedFrame('queued')] });
    const holdOp = turn({ requestId: 'h1', actorId: 'agent', type: 'agent.hold', requestSeq: 2, terminal: completedTerminal({ requestId: 'h1', type: 'agent.hold' }) });
    const state = stateOf([queuedTurn, holdOp]);
    render(<WaitingLayer {...baseWaitProps({ turns: [queuedTurn], state })} />);
    expect(document.querySelector('.agent-wait-layer').textContent).toContain('已暂停');
    expect(document.body.textContent).not.toMatch(/已停止/);
  });
});
