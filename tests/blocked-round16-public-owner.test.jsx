// @vitest-environment jsdom
// Round 16 evidence recovery.  Every case below names the user capability,
// the invariant, and the current public owner in the case body.  The tests do
// not import the retired Timeline/feature stores or any private production
// helper.
import React, { Suspense } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAgentProbes } from '../src/app/hooks/useAgentProbes.js';
import { createChannelReplicaStore } from '../src/model/channel-replica.js';
import { CONVERSATION_SCOPE, selectTimelineItems } from '../src/model/conversation-presentation.js';
import { buildComposerModel, createMessageRequest } from '../src/ui/composer/composer-model.js';
import { Composer } from '../src/ui/composer/Composer.jsx';
import { MarkdownFileReferenceProvider } from '../src/ui/MarkdownContent.jsx';
import { useTimelineRowRenderer } from '../src/ui/timeline/TimelineRowRenderer.jsx';
import { useWaitingEditingController } from '../src/ui/timeline/useWaitingEditingController.jsx';

afterEach(cleanup);

const HUMAN = { id: 'me', kind: 'human', name: '我' };
const AGENT = { id: 'agent', kind: 'agent', name: 'Agent' };
const AGENT_B = { id: 'agent-b', kind: 'agent', name: 'Agent B' };
const AGENT_D = { id: 'agent-d', kind: 'agent', name: 'Agent D' };

function envelope({ id, type = 'agent.ask', kind = 'response', sender = AGENT, audience = ['me'], ts = 100, body = {}, parent_id, ...rest }) {
  return {
    id, type, kind, sender, audience, ts,
    ...(parent_id ? { parent_id } : {}),
    payload: { body },
    ...rest,
  };
}

function processFrame(id, seq, process, status = 'processing') {
  return { seq, status, envelope: envelope({ id, body: { status, process } }) };
}

function turnOf({
  requestId = 'work', requestType = 'agent.ask', requestText = '整理报告', actorId = AGENT.id,
  status = 'processing', terminal = null, provisional = [], thread = [], requestExtra = {},
  terminalClosureOnly = false,
} = {}) {
  const request = envelope({
    id: requestId,
    type: requestType,
    kind: 'request',
    sender: HUMAN,
    audience: [actorId],
    body: { text: requestText, ...requestExtra },
  });
  return {
    requestId,
    request,
    requestSeq: 1,
    status,
    latestStatus: status,
    terminal,
    terminalClosureOnly,
    provisional,
    thread,
  };
}

function waitingTurn(requestId = 'queued', actorId = AGENT.id) {
  return turnOf({
    requestId,
    actorId,
    requestText: '等待中的消息',
    provisional: [{
      seq: 2,
      envelope: envelope({ id: `${requestId}-queued`, body: {
        status: 'queued',
        controls: [{ word: 'agent.replace' }, { word: 'agent.unhold' }],
      } }),
    }],
  });
}

const EDIT_CAPABILITY = new Map([['agent', {
  describe: { types: new Map([
    ['agent.replace', { inputSchema: { properties: { expected_hold_id: { type: 'string' } } } }],
    ['agent.unhold', { inputSchema: { properties: { expected_hold_id: { type: 'string' } } } }],
  ]) },
}]]);

function waitingState(turns, channelId = 'c0') {
  return { channelId, timeline: turns.map((turn) => ({ kind: 'turn', turn })) };
}

function WaitingHarness({ state, onTaskControl, suspend = false, controllerRef, onComposerEditChange }) {
  const controller = useWaitingEditingController({
    state,
    pending: [],
    capabilityIndex: EDIT_CAPABILITY,
    onRequestCapability: vi.fn(),
    onTaskControl,
    onComposerEditChange,
  });
  controllerRef.current = controller;
  if (suspend) throw new Promise(() => {});
  return null;
}

function rendererOptions(state, overrides = {}) {
  return {
    state,
    names: new Map([[HUMAN.id, HUMAN.name], [AGENT.id, AGENT.name], [AGENT_B.id, AGENT_B.name], [AGENT_D.id, AGENT_D.name]]),
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

function renderStandaloneRows(rows, overrides = {}) {
  const state = { channelId: 'c0', narration: [] };
  const { result } = renderHook(() => useTimelineRowRenderer(rendererOptions(state, overrides)));
  const view = render(<>{rows.map((row) => <React.Fragment key={row.id}>{result.current.renderRow(row)}</React.Fragment>)}</>);
  return { result, view, state };
}

describe('Round 16 public-owner evidence: Waiting and probe', () => {
  it('[AD-034] late edit release stays with the committed Waiting owner through a suspended candidate', async () => {
    // 能力：编辑锁的迟到回执仍可安全释放；不变量：候选渲染不能抢走已提交 owner；公开 owner：useWaitingEditingController。
    const stateA = waitingState([waitingTurn('queued')]);
    const stateB = waitingState([waitingTurn('candidate')]);
    const onTaskControlA = vi.fn(({ type }) => type === 'agent.hold' ? holdReceipt : Promise.resolve(`${type}-a`));
    const onTaskControlB = vi.fn(() => Promise.resolve('candidate-b'));
    let resolveHold;
    const holdReceipt = new Promise((resolve) => { resolveHold = resolve; });
    const onComposerEditChange = vi.fn();
    const controllerRef = { current: null };
    function Frame({ state, onTaskControl, suspend }) {
      return <Suspense fallback={<p>candidate fallback</p>}>
        <WaitingHarness state={state} onTaskControl={onTaskControl} suspend={suspend} controllerRef={controllerRef} onComposerEditChange={onComposerEditChange} />
      </Suspense>;
    }
    // Keep a real Suspense candidate in the tree; the thrown promise is
    // deliberately never resolved because this branch must never commit.
    const view = render(<Frame state={stateA} onTaskControl={onTaskControlA} suspend={false} />);
    let startPromise;
    act(() => { startPromise = controllerRef.current.startEditing(stateA.timeline[0].turn, AGENT.id); });
    await waitFor(() => expect(onTaskControlA).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent.hold' })));
    view.rerender(<Frame state={stateB} onTaskControl={onTaskControlB} suspend />);
    expect(screen.getByText('candidate fallback')).toBeTruthy();
    view.unmount();
    resolveHold('late-hold-a');
    await startPromise;
    await waitFor(() => expect(onTaskControlA).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'c0', type: 'agent.unhold', payload: { expected_hold_id: 'late-hold-a' },
    })));
    expect(onTaskControlB.mock.calls.some(([value]) => value.type === 'agent.unhold')).toBe(false);
  });

  it('[AD-039] a newer committed interrupt supersedes an edit without a stale late unhold', async () => {
    // 能力：用户停止后编辑不会再解除锁；不变量：更强 interrupt 事实接管冻结 owner；公开 owner：useWaitingEditingController。
    const initial = waitingTurn('queued');
    let state = waitingState([initial]);
    const onTaskControl = vi.fn(async ({ type }) => type === 'agent.hold' ? 'hold-a' : `${type}-a`);
    const onComposerEditChange = vi.fn();
    const { result, rerender } = renderHook((props) => useWaitingEditingController(props), {
      initialProps: {
        state, pending: [], capabilityIndex: EDIT_CAPABILITY, onRequestCapability: vi.fn(), onTaskControl, onComposerEditChange,
      },
    });
    await act(async () => { await result.current.startEditing(initial, AGENT.id); });
    const interrupt = turnOf({ requestId: 'stop', requestType: 'agent.interrupt', actorId: AGENT.id, requestText: '', status: 'completed', terminal: envelope({ id: 'stop-d', type: 'agent.interrupt', body: { status: 'completed' } }) });
    interrupt.requestSeq = 3;
    state = waitingState([initial, interrupt]);
    rerender({ state, pending: [], capabilityIndex: EDIT_CAPABILITY, onRequestCapability: vi.fn(), onTaskControl, onComposerEditChange });
    await waitFor(() => expect(result.current.presentationEditing).toBeNull());
    expect(result.current.editNotice).toContain('另一项控制');
    expect(onTaskControl.mock.calls.some(([value]) => value.type === 'agent.unhold')).toBe(false);
  });

  it('[AD-074] every explicit capability refresh sends again after the user opens the selector', async () => {
    // 能力：用户每次显式打开 Agent 选择器都能重新读取能力；不变量：手动动作不被自动探测限流；公开 owner：useAgentProbes。
    const handleSend = vi.fn().mockResolvedValueOnce('describe-1').mockResolvedValueOnce('describe-2');
    const props = {
      activeChannelId: 'c0',
      activeChannelRef: { current: 'c0' },
      accessRef: { current: { state: () => ({ relationship: 'member', unavailable: false }) } },
      stateFor: () => ({ rows: new Map(), timeline: [] }),
      feedVersion: 0,
      handleSend,
      pending: [],
      rosterRef: { current: { self: () => 'me' } },
      rosters: new Map([['c0', [AGENT]]]),
      wireState: 'open',
    };
    const { result } = renderHook((value) => useAgentProbes(value), { initialProps: props });
    await waitFor(() => expect(result.current.composerAgent).toEqual({ channelId: 'c0', actorId: 'agent' }));
    let first;
    await act(async () => { first = await result.current.requestCapability('agent', 'c0'); });
    expect(first).toMatchObject({ requested: true, requestId: 'describe-1' });
    // Opening the selector is itself the second explicit action.  The hook's
    // public owner schedules that refresh; the caller must not submit a raw
    // duplicate request while it is in flight.
    act(() => { result.current.selectorOpened(); });
    await waitFor(() => expect(handleSend).toHaveBeenCalledTimes(2));
  });
});

describe('Round 16 public-owner evidence: Dynamic presentation', () => {
  it.each([true, false])('[AD-327] an ordinary request exposes its process summary and text progress: %s', (hasTextProgress) => {
    // 能力：用户能看见普通请求的过程摘要/文字进展；不变量：过程留在同一回合 owner，不泄漏内部 turn id；公开 owner：useTimelineRowRenderer。
    const provisional = [
      ...(hasTextProgress ? [processFrame('stage', 2, { kind: 'stage', stage: 'text', text: '正在整理资料' })] : []),
      processFrame('tool', 3, { kind: 'tool', phase: 'started', tool_call_id: 'call-1', tool: 'search' }),
    ];
    const { view } = renderTurnRow(turnOf({ requestType: 'report.generate', provisional }));
    expect(view.container.querySelector('.progress-running-header')?.textContent).toContain('处理中: 整理报告');
    expect(view.container.querySelector('.progress-running-header')?.getAttribute('aria-expanded')).toBe('false');
    expect(view.container.querySelector('.agent-processing-status')?.textContent).toContain('tool: search …');
    if (hasTextProgress) expect(view.container.textContent).toContain('正在整理资料');
    else expect(view.container.textContent).toContain('处理中: 整理报告');
  });

  it('[AD-328] processing keeps one rolling activity line inside the agent bubble', () => {
    // 能力：用户在主回答气泡内看到一条可展开的实时活动线；不变量：控制按钮不移入气泡；公开 owner：useTimelineRowRenderer。
    const { view } = renderTurnRow(turnOf({ provisional: [processFrame('tool', 2, { kind: 'tool', phase: 'started', tool_call_id: 'call-1', tool: 'search' })] }));
    expect(view.container.querySelectorAll('.agent-turn-bubble')).toHaveLength(1);
    expect(view.container.querySelector('.agent-turn-bubble .agent-processing-status')?.textContent).toContain('tool: search …');
    expect([...view.container.querySelectorAll('button')].filter((button) => /编辑|停止|重试/.test(button.textContent || '')).every((button) => !button.closest('.agent-turn-bubble'))).toBe(true);
  });

  it('[AD-329] a completed answer remains in the agent bubble after its request', () => {
    // 能力：用户按请求→回答顺序阅读已完成答案；不变量：回答不被提升为独立顶层消息；公开 owner：useTimelineRowRenderer。
    const terminal = envelope({ id: 'done', body: { status: 'completed', text: '最终答复' } });
    const { view } = renderTurnRow(turnOf({ status: 'completed', terminal }));
    const card = view.container.querySelector('.turn-card');
    const children = [...card.children];
    expect(children.indexOf(card.querySelector('.request-message'))).toBeLessThan(children.indexOf(card.querySelector('.agent-turn-bubble')));
    expect(view.container.textContent).toContain('最终答复');
    expect(card.querySelector('.turn-inline-detail')).toBeNull();
  });

  it('[AD-333] compact closure shows unavailable terminal detail instead of inventing usage', () => {
    // 能力：用户知道详情被裁剪且可刷新；不变量：缺失业务结果不得伪装成功；公开 owner：useTimelineRowRenderer + terminal-result。
    const terminal = envelope({ id: 'select-done', type: 'agent.select', body: { status: 'completed', usage: { model: 'new' } } });
    const { view } = renderTurnRow(turnOf({ requestId: 'select', requestType: 'agent.select', requestText: '', status: 'completed', terminal, terminalClosureOnly: true }));
    expect(view.container.textContent).toContain('终态详情不可用，请刷新或重新进入频道');
    expect(view.container.textContent).not.toContain('new');
  });

  it('[AD-335] same-author continuation keeps each message focusable while sharing identity', () => {
    // 能力：用户可分别聚焦连续消息；不变量：身份只合并相邻同作者，不合并事实；公开 owner：useTimelineRowRenderer。
    const first = envelope({ id: 'm-1', kind: 'event', type: 'human.note', sender: HUMAN, ts: 1000, body: { text: '第一条' } });
    const second = envelope({ id: 'm-2', kind: 'event', type: 'human.note', sender: HUMAN, ts: 2000, body: { text: '第二条' } });
    const { view } = renderStandaloneRows([
      { id: 'm-1', body: { kind: 'standalone', envelope: first }, continuation: false },
      { id: 'm-2', body: { kind: 'standalone', envelope: second }, continuation: true },
    ]);
    expect(view.container.querySelectorAll('.standalone-row')).toHaveLength(2);
    expect(view.container.querySelectorAll('.standalone-row.continuation')).toHaveLength(1);
    expect(view.container.textContent).toContain('第一条');
    expect(view.container.textContent).toContain('第二条');
    expect(view.container.querySelectorAll('[tabindex="0"]')).toHaveLength(2);
  });

  it('[AD-336] an unknown sender displays the actor id middle segment without leaking the full id', () => {
    // 能力：用户仍能识别未知发送者；不变量：完整 actor id 不进入可见文案；公开 owner：useTimelineRowRenderer/actor-display。
    const sender = { id: 'human:root:1787128257816', kind: 'human' };
    const note = envelope({ id: 'unknown-sender', kind: 'event', type: 'human.note', sender, body: { text: '名称降级测试' } });
    const { view } = renderStandaloneRows([{ id: note.id, body: { kind: 'standalone', envelope: note }, continuation: false }]);
    expect(view.container.textContent).toContain('root');
    expect(view.container.textContent).not.toContain(sender.id);
  });

  it('[AD-337] terminal session lifecycle events stay out of both public conversation scopes', () => {
    // 能力：用户的动态时间线只显示可读往来；不变量：terminal session housekeeping 不进入 ConversationPresentation；公开 owner：ChannelReplica + selectTimelineItems。
    const store = createChannelReplicaStore();
    expect(store.commit({ channel_id: 'c0', seq: 1, envelope: envelope({ id: 'message', kind: 'event', type: 'message', sender: HUMAN, audience: [], body: { text: '真实消息' } }) }).accepted).toBe(true);
    expect(store.commit({ channel_id: 'c0', seq: 2, envelope: envelope({ id: 'session', kind: 'event', type: 'terminal.session', sender: HUMAN, audience: [], body: { event: 'closed' } }) }).accepted).toBe(true);
    const state = store.state('c0');
    for (const selection of [
      selectTimelineItems(state, { scope: CONVERSATION_SCOPE.all }),
      selectTimelineItems(state, { scope: CONVERSATION_SCOPE.mine, selfId: HUMAN.id }),
    ]) expect(selection.items.some((item) => item.envelope?.type === 'terminal.session')).toBe(false);
    expect(selectTimelineItems(state, { scope: CONVERSATION_SCOPE.all }).items.some((item) => item.envelope?.type === 'message')).toBe(true);
  });

  it('[AD-338] channel activity is folded into narration and omitted from conversation rows', () => {
    // 能力：用户阅读往来时不被平台成员活动淹没；不变量：system visibility facts belong to narration, not message rows；公开 owner：ChannelReplica + ConversationPresentation。
    const store = createChannelReplicaStore();
    const member = envelope({ id: 'member-added', kind: 'event', type: 'member.added', sender: { id: 'system', kind: 'system' }, audience: [], body: { actor_id: 'human:bob:1' }, visibility: 'system' });
    expect(store.commit({ channel_id: 'c0', seq: 1, envelope: member }).accepted).toBe(true);
    const state = store.state('c0');
    expect(state.timeline).toHaveLength(0);
    expect(state.narration.some((entry) => entry.envelope.type === 'member.added')).toBe(true);
    expect(selectTimelineItems(state, { scope: CONVERSATION_SCOPE.all }).items.some((item) => item.envelope?.type === 'member.added')).toBe(false);
  });

  it('[AD-340] an absolute file reference opens through the current channel preview callback', () => {
    // 能力：用户可从 Agent 答复打开当前频道文件预览；不变量：路径只转为受控 SourceRef；公开 owner：ConversationSurface MarkdownFileReferenceProvider + TimelineRowRenderer。
    const onPreview = vi.fn();
    const terminal = envelope({ id: 'file-answer', body: { status: 'completed', text: '[main.go](/srv/atoll/channels/c0/main.go:42)' } });
    const state = { channelId: 'c0', narration: [] };
    const { result } = renderHook(() => useTimelineRowRenderer(rendererOptions(state, { onPreviewResource: onPreview })));
    const row = { id: 'work', body: { kind: 'turn', turn: turnOf({ status: 'completed', terminal }) } };
    render(<MarkdownFileReferenceProvider onOpen={(reference) => onPreview('c0', reference)}>{result.current.renderRow(row)}</MarkdownFileReferenceProvider>);
    fireEvent.click(screen.getByRole('link', { name: 'main.go' }));
    expect(onPreview).toHaveBeenCalledWith('c0', { path: '/srv/atoll/channels/c0/main.go', line: 42 });
  });

  it('[AD-341] nested actor work remains under its parent turn instead of becoming a top-level card', () => {
    // 能力：用户先读主线、按需展开子调用；不变量：parent turn owns nested actor facts；公开 owner：TimelineRowRenderer ThreadCalls。
    const child = turnOf({ requestId: 'admit', requestType: 'system.member.admit', requestText: '', actorId: 'agent-b', status: 'completed', terminal: envelope({ id: 'admit-done', type: 'system.member.admit', sender: { id: 'system', kind: 'system' }, body: { status: 'completed', member: 'human:root:1' } }) });
    const root = turnOf({ requestId: 'root', requestText: '把 root 拉进来', status: 'completed', terminal: envelope({ id: 'root-done', body: { status: 'completed', text: '已加入' } }), thread: [{ turn: child }] });
    const { view } = renderTurnRow(root);
    expect(view.container.querySelectorAll('.turn-card')).toHaveLength(1);
    expect(view.container.querySelector('.turn-thread-toggle')).toBeTruthy();
    expect(view.container.textContent).not.toContain('邀请成员加入');
  });

  it('[AD-342] a nested compact closure exposes only its unavailable detail state', () => {
    // 能力：用户能区分“调用已关闭”与“结果可读”；不变量：裁剪结果不能伪造正文；公开 owner：TimelineRowRenderer ThreadCalls + terminal-result。
    const childTerminal = envelope({ id: 'child-final', type: 'tool.lookup', body: { status: 'completed', text: '不应显示的结果' } });
    const child = turnOf({ requestId: 'child', requestType: 'tool.lookup', requestText: '查找资料', actorId: 'agent-b', status: 'completed', terminal: childTerminal, terminalClosureOnly: true });
    const root = turnOf({ requestId: 'root', status: 'completed', terminal: envelope({ id: 'root-done', body: { status: 'completed', text: '完成' } }), thread: [{ turn: child }] });
    const { view } = renderTurnRow(root);
    fireEvent.click(view.container.querySelector('.turn-thread-toggle'));
    fireEvent.click(view.container.querySelector('.turn-thread-row'));
    expect(view.container.textContent).toContain('终态详情不可用，请刷新或重新进入频道');
    expect(view.container.textContent).not.toContain('不应显示的结果');
  });

  it('[AD-343] parent_id gives each nested call its own collapsed control and depth', () => {
    // 能力：用户可独立展开每个 Agent 子调用；不变量：parent_id 形成稳定树深度且过程不串节点；公开 owner：TimelineRowRenderer ThreadCalls。
    const child = turnOf({ requestId: 'child', requestType: 'agent.ask', requestText: 'B 负责查资料', actorId: AGENT_B.id, status: 'completed', terminal: envelope({ id: 'child-done', body: { status: 'completed', text: 'B 完成' } }) });
    child.request.parent_id = 'root';
    const grandchild = turnOf({ requestId: 'grandchild', requestType: 'agent.ask', requestText: 'D 负责核验', actorId: AGENT_D.id, status: 'completed', terminal: envelope({ id: 'grandchild-done', body: { status: 'completed', text: 'D 完成' } }) });
    grandchild.request.parent_id = 'child';
    const root = turnOf({ requestId: 'root', requestText: '请协作回答', status: 'completed', terminal: envelope({ id: 'root-done', body: { status: 'completed', text: 'A 完成' } }), thread: [{ turn: child }, { turn: grandchild }] });
    const { view } = renderTurnRow(root);
    fireEvent.click(view.container.querySelector('.turn-thread-toggle'));
    const rows = [...view.container.querySelectorAll('.turn-thread-row')];
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
    expect([...view.container.querySelectorAll('.turn-thread-item')].map((row) => row.style.getPropertyValue('--thread-depth'))).toEqual(['1', '2']);
    fireEvent.click(rows[0]);
    expect(rows[0].getAttribute('aria-expanded')).toBe('true');
    expect(rows[1].getAttribute('aria-expanded')).toBe('false');
    expect(view.container.textContent).toContain('B 完成');
    expect(view.container.textContent).not.toContain('D 完成');
  });
});

describe('Round 16 public-owner evidence: Composer target guards', () => {
  it('[AD-350] selected recipient chips can be removed one by one and from an empty editor with Backspace', async () => {
    // 能力：用户可精确移除多个收件人；不变量：每个 chip 是独立 recipient fact；公开 owner：Composer + buildComposerModel。
    const user = userEvent.setup();
    const first = { id: 'agent-1', kind: 'agent', name: '研究员' };
    const second = { id: 'agent-2', kind: 'agent', name: '执行员' };
    const commands = { removeMention: vi.fn(), changeDraft: vi.fn() };
    const makeModel = (recipients) => buildComposerModel({
      activeChannelId: 'c0', draft: { text: '', recipients }, roster: [HUMAN, first, second], access: 'member_active',
    });
    const view = render(<Composer model={makeModel([first, second])} commands={commands} />);
    expect(view.container.querySelectorAll('.composer-target-pill.is-picked')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: '移除收件人 @研究员' }));
    expect(commands.removeMention).toHaveBeenCalledWith('agent-1');
    view.rerender(<Composer model={makeModel([second])} commands={commands} />);
    await user.click(screen.getByRole('textbox', { name: '消息' }));
    await user.keyboard('{Backspace}');
    expect(commands.removeMention).toHaveBeenLastCalledWith('agent-2');
  });

  it('[AD-351] a missing recipient remains visible and blocks message construction instead of falling back', () => {
    // 能力：用户明确看到收件人已离席且不会误发；不变量：missing recipient never silently becomes the default Agent；公开 owner：buildComposerModel/createMessageRequest。
    const missing = { id: 'agent:gone:1', kind: 'agent', label: '研究员' };
    const model = buildComposerModel({
      activeChannelId: 'c0', draft: { text: '继续', recipients: [missing] },
      roster: [HUMAN, AGENT], agentSelection: { selectedAgentId: AGENT.id }, access: 'member_active',
    });
    expect(model.delivery.kind).toBe('lost');
    expect(model.delivery.label).toContain('@研究员');
    expect(() => createMessageRequest(model)).toThrow('@研究员');
  });
});
