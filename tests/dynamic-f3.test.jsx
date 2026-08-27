// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from '../src/ui/Composer.jsx';
import { fold } from '../src/model/fold.js';
import { Timeline } from '../src/ui/Timeline.jsx';
import { TurnContext } from '../src/ui/context/TurnContext.jsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function runningTurn() {
  const request = { id: 'req-1', type: 'agent.ask', kind: 'request', ts: 100, sender: { id: 'me', kind: 'human' }, audience: ['agent-1'], payload: { text: '整理研究报告', token: 'secret' } };
  return {
    requestId: request.id, request, requestSeq: 1, status: 'processing', latestStatus: 'processing', terminal: null,
    provisional: [
      { seq: 2, status: 'processing', core: true, envelope: { id: 'p-1', type: 'agent.ask', ts: 110, sender: { id: 'agent-1' }, payload: { status: 'processing', detail: '正在整理资料' } } },
      { seq: 3, status: 'processing', core: true, envelope: { id: 'p-tool', type: 'agent.ask', ts: 120, sender: { id: 'agent-1' }, payload: { status: 'processing', process: { kind: 'tool', phase: 'started', tool_call_id: 'call-1', tool: 'search' } } } },
    ],
    anomalies: [{ code: 'sample', seq: 4 }],
  };
}

it('main Dynamic keeps one rolling activity line inside the processing agent bubble', () => {
  const turn = runningTurn();
  const state = { channelId: 'c0', rows: new Map([[1, turn.request]]), turns: new Map([[turn.requestId, turn]]), standalone: [], orphans: [], narration: [], lastSeq: 3 };
  render(<Timeline state={state} roster={[{ id: 'me', name: '我' }, { id: 'agent-1', name: '研究员' }]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
  const scopeToggle = screen.getByRole('button', { name: '@我' });
  expect(scopeToggle.getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByRole('button', { name: '全部' })).toBeNull();
  fireEvent.click(scopeToggle);
  expect(screen.getByRole('button', { name: '全部' }).getAttribute('aria-pressed')).toBe('false');
  expect(screen.queryByRole('button', { name: '@我' })).toBeNull();
  expect(document.querySelector('.agent-processing-status').textContent).toContain('tool: search …');
  expect(document.querySelectorAll('.agent-turn-bubble')).toHaveLength(1);
  // 气泡里只有过程轨迹这类纯查看交互，编辑/停止这些控制恒在卡片上。
  expect(screen.queryAllByRole('button', { name: /编辑|停止|重试/ }).every((button) => !button.closest('.agent-turn-bubble'))).toBe(true);
});

it('completed answer stays in the agent bubble immediately after its user message', () => {
  const turn = runningTurn();
  turn.status = 'completed';
  turn.terminal = { id: 'terminal-1', type: 'agent.ask', ts: 130, sender: { id: 'agent-1', kind: 'agent' }, payload: { status: 'completed', text: '最终答复' } };
  const state = { channelId: 'c0', rows: new Map([[1, turn.request]]), turns: new Map([[turn.requestId, turn]]), standalone: [], orphans: [], narration: [], lastSeq: 4 };
  const view = render(<Timeline state={state} roster={[{ id: 'me', name: '我' }, { id: 'agent-1', name: '研究员' }]} selfId="me" pending={[]} approvalStates={{}} access="member_active" turnDetail={{ selected: turn, onClose: () => {} }} />);
  const card = view.container.querySelector('.turn-card');
  const children = [...card.children];
  expect(children.indexOf(card.querySelector('.request-message'))).toBeLessThan(children.indexOf(card.querySelector('.agent-turn-bubble')));
  expect(screen.getByText('最终答复')).toBeTruthy();
  expect(card.querySelector('.turn-inline-detail')).toBeNull();
});

it('Agent 最终答复可以建立临时回复目标，处理中气泡不提供回复', async () => {
  const onReply = vi.fn();
  const turn = runningTurn();
  const state = { channelId: 'c0', rows: new Map([[1, turn.request]]), turns: new Map([[turn.requestId, turn]]), standalone: [], orphans: [], narration: [], lastSeq: 3 };
  const view = render(<Timeline state={state} roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'agent-1', kind: 'agent', name: '研究员' }]} selfId="me" pending={[]} approvalStates={{}} access="member_active" onReply={onReply} />);
  expect(screen.queryByRole('button', { name: /回复/ })).toBeNull();

  turn.status = 'completed';
  turn.terminal = { id: 'terminal-reply', type: 'agent.ask', ts: 130, sender: { id: 'agent-1', kind: 'agent' }, payload: { status: 'completed', text: '可以回复我' } };
  state.lastSeq = 4;
  view.rerender(<Timeline state={state} roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'agent-1', kind: 'agent', name: '研究员' }]} selfId="me" pending={[]} approvalStates={{}} access="member_active" onReply={onReply} />);
  fireEvent.click(screen.getByRole('button', { name: /回复/ }));
  expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'terminal-reply', senderId: 'agent-1', senderName: '研究员' }));
});

it('PC 可复制回复正文；移动端短按回复、长按复制且不误触回复', async () => {
  vi.useFakeTimers();
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText }, vibrate: vi.fn() });
  const onReply = vi.fn();
  const turn = runningTurn();
  turn.status = 'completed';
  turn.terminal = { id: 'terminal-copy', type: 'agent.ask', ts: 130, sender: { id: 'agent-1', kind: 'agent' }, payload: { status: 'completed', text: '只复制这一段正文' } };
  const state = { channelId: 'c0', rows: new Map([[1, turn.request]]), turns: new Map([[turn.requestId, turn]]), standalone: [], orphans: [], narration: [], lastSeq: 4 };
  const view = render(<Timeline state={state} roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'agent-1', kind: 'agent', name: '研究员' }]} selfId="me" pending={[]} approvalStates={{}} access="member_active" onReply={onReply} />);

  fireEvent.click(screen.getByRole('button', { name: '复制' }));
  await act(async () => Promise.resolve());
  expect(writeText).toHaveBeenLastCalledWith('只复制这一段正文');

  const message = view.container.querySelector('.agent-turn-bubble');
  fireEvent.pointerDown(message, { pointerType: 'touch', clientX: 20, clientY: 20 });
  fireEvent.pointerUp(message, { pointerType: 'touch', clientX: 20, clientY: 20 });
  expect(onReply).toHaveBeenCalledOnce();

  onReply.mockClear();
  writeText.mockClear();
  fireEvent.pointerDown(message, { pointerType: 'touch', clientX: 20, clientY: 20 });
  await act(async () => {
    vi.advanceTimersByTime(480);
    await Promise.resolve();
  });
  fireEvent.pointerUp(message, { pointerType: 'touch', clientX: 20, clientY: 20 });
  expect(writeText).toHaveBeenCalledWith('只复制这一段正文');
  expect(onReply).not.toHaveBeenCalled();

  writeText.mockClear();
  fireEvent.pointerDown(message, { pointerType: 'touch', clientX: 20, clientY: 20 });
  fireEvent.pointerMove(message, { pointerType: 'touch', clientX: 20, clientY: 48 });
  fireEvent.pointerUp(message, { pointerType: 'touch', clientX: 20, clientY: 48 });
  vi.advanceTimersByTime(500);
  expect(writeText).not.toHaveBeenCalled();
  expect(onReply).not.toHaveBeenCalled();
});

it('agent.new 成功后只显示一条轻量确认，不伪装成用户聊天消息', () => {
  const request = { id: 'new-1', type: 'agent.new', kind: 'request', ts: 100, sender: { id: 'me', kind: 'human' }, audience: ['agent-1'], payload: {} };
  const turn = { requestId: request.id, request, requestSeq: 1, status: 'completed', provisional: [], anomalies: [], terminal: { id: 'new-1-terminal', type: 'agent.new', ts: 110, sender: { id: 'agent-1', kind: 'agent' }, payload: { status: 'completed' } } };
  const state = { channelId: 'c0', rows: new Map([[1, request], [2, turn.terminal]]), turns: new Map([[turn.requestId, turn]]), standalone: [], orphans: [], narration: [], lastSeq: 2 };
  render(<Timeline state={state} roster={[{ id: 'me', name: '我' }, { id: 'agent-1', name: '研究员' }]} selfId="me" pending={[]} approvalStates={{}} />);
  expect(screen.getByRole('status').textContent).toBe('研究员 已开始新对话');
  expect(document.querySelector('.request-message')).toBeNull();
});

it('Turn detail exposes audit identifiers without serializing payload JSON', () => {
  render(<TurnContext turn={runningTurn()} roster={[{ id: 'me', name: '我' }, { id: 'agent-1', name: '研究员' }]} selfId="me" access="member_active" capability={null} controlState={{}} onCancel={() => {}} onControl={() => {}} onDownload={() => {}} onSource={() => {}} onClose={() => {}} />);
  expect(screen.getByRole('complementary', { name: '回合详情' })).toBeTruthy();
  expect(screen.getByText('工具 · search')).toBeTruthy();
  expect(document.querySelectorAll('.turn-context-process-scroll')).toHaveLength(2);
  expect(screen.getByText(/^技术审计/)).toBeTruthy();
  expect(document.querySelector('.turn-context-diagnostics pre')).toBeNull();
  expect(screen.getAllByText('req-1').length).toBeGreaterThan(0);
  expect(document.body.textContent).not.toContain('secret');
});

it('同作者五分钟内的连续消息合并身份，但保留每条可聚焦事实', () => {
  const first = { seq: 1, envelope: { id: 'm-1', kind: 'event', type: 'human.note', ts: 1_000, sender: { id: 'me', kind: 'human' }, payload: { text: '第一条' } } };
  const second = { seq: 2, envelope: { id: 'm-2', kind: 'event', type: 'human.note', ts: 2_000, sender: { id: 'me', kind: 'human' }, payload: { text: '第二条' } } };
  const state = { channelId: 'c0', rows: new Map([[1, first.envelope], [2, second.envelope]]), turns: new Map(), standalone: [first, second], orphans: [], narration: [], lastSeq: 2 };
  const view = render(<Timeline state={state} roster={[{ id: 'me', name: '我' }]} selfId="me" pending={[]} approvalStates={{}} />);
  expect(view.container.querySelectorAll('.standalone-row')).toHaveLength(2);
  expect(view.container.querySelectorAll('.standalone-row.continuation')).toHaveLength(1);
  expect(screen.getAllByText('我')).toHaveLength(1);
  expect(screen.getByText('第一条')).toBeTruthy();
  expect(screen.getByText('第二条')).toBeTruthy();
});

it('sender 尚未进入 roster 时按 actor_id 中间段显示名称', () => {
  const envelope = { id: 'm-actor-id', kind: 'event', type: 'human.note', ts: 1_000, sender: { id: 'human:root:1787128257816', kind: 'human' }, payload: { text: '名称降级测试' } };
  const state = { channelId: 'c0', rows: new Map([[1, envelope]]), turns: new Map(), standalone: [{ seq: 1, envelope }], orphans: [], narration: [], lastSeq: 1 };
  render(<Timeline state={state} roster={[]} selfId="another-actor" pending={[]} approvalStates={{}} />);
  fireEvent.click(screen.getByRole('button', { name: '@我' }));
  expect(screen.getByText('root')).toBeTruthy();
  expect(document.body.textContent).not.toContain('human:root:1787128257816');
});

it('终端会话生命周期不进入动态时间线', () => {
  const envelope = { id: 'terminal-session-1', kind: 'event', type: 'terminal.session', ts: 1_000, sender: { id: 'me', kind: 'human' }, payload: { session_id: 'session-1', event: 'closed', exit_code: 0 } };
  const state = { channelId: 'c0', rows: new Map([[1, envelope]]), turns: new Map(), standalone: [{ seq: 1, envelope }], orphans: [], narration: [], lastSeq: 1 };
  render(<Timeline state={state} roster={[{ id: 'me', name: '我' }]} selfId="me" pending={[]} approvalStates={{}} />);
  expect(document.body.textContent).not.toContain('提交了一项操作');
  expect(document.body.textContent).not.toContain('session-1');
  fireEvent.click(screen.getByRole('button', { name: '@我' }));
  expect(document.body.textContent).not.toContain('提交了一项操作');
  expect(document.body.textContent).not.toContain('session-1');
});

it('只有时间线确认位于最新端后才回报已读序号', async () => {
  const envelope = { id: 'latest-1', kind: 'event', type: 'human.note', ts: 1_000, sender: { id: 'other', kind: 'human' }, audience: ['me'], payload: { text: '最新消息' } };
  const state = { channelId: 'c0', rows: new Map([[7, envelope]]), turns: new Map(), standalone: [{ seq: 7, envelope }], orphans: [], narration: [], lastSeq: 7 };
  const onReadLatest = vi.fn();
  render(<Timeline state={state} history={{ onReadLatest }} roster={[{ id: 'me', name: '我' }]} selfId="me" pending={[]} approvalStates={{}} />);
  await waitFor(() => expect(onReadLatest).toHaveBeenCalledWith(7));
});

// 平台叙事暂时不进时间线（Timeline 的 SHOW_CHANNEL_NARRATION）：它与真正的往来
// 平铺在一条流里，agent 每干一次活就刷出一串，把人要读的东西淹掉。这条钉的是
// "不出现"，而不是它长什么样——等它有了合适的落位，连同这条一起重写。
it('频道活动不铺进时间线', () => {
  const narration = [
    { seq: 1, envelope: { id: 'joined-steward', type: 'system.member.created', ts: 1_000, sender: { id: 'system', kind: 'system' }, payload: { member: 'steward', decl_id: 'mock:steward' } } },
    { seq: 2, envelope: { id: 'joined-service', type: 'system.member.created', ts: 2_000, sender: { id: 'system', kind: 'system' }, payload: { member: 'svcactor', decl_id: 'svcactor' } } },
  ];
  const state = { channelId: 'c0', rows: new Map(), turns: new Map(), standalone: [], orphans: [], narration, lastSeq: 2 };
  render(<Timeline state={state} roster={[{ id: 'steward', name: 'Steward' }]} selfId="me" pending={[]} approvalStates={{}} />);
  expect(screen.queryByRole('button', { name: /频道活动/ })).toBeNull();
  expect(document.body.textContent).not.toContain('已加入频道');
});

it('消息附件只显示产品摘要，点击整卡进入统一预览', async () => {
  const user = userEvent.setup();
  const turn = runningTurn();
  turn.request.payload.attachments = [{ resource_id: 'file:report', name: '研究报告.pdf', media_type: 'application/pdf', size: 4096 }];
  const onPreviewResource = vi.fn();
  const state = { channelId: 'c0', rows: new Map([[1, turn.request]]), turns: new Map([[turn.requestId, turn]]), standalone: [], orphans: [], narration: [], lastSeq: 3 };
  render(<Timeline state={state} roster={[{ id: 'me', name: '我' }]} selfId="me" pending={[]} approvalStates={{}} onPreviewResource={onPreviewResource} />);
  expect(screen.getByText('PDF · 4.0 KB')).toBeTruthy();
  expect(screen.queryByText('file:report')).toBeNull();
  expect(screen.queryByText('application/pdf')).toBeNull();
  await user.click(screen.getByRole('button', { name: '预览 研究报告.pdf' }));
  expect(onPreviewResource).toHaveBeenCalledWith('c0', turn.request.payload.attachments[0]);
});

it('Agent 答复中的显式绝对路径在当前频道打开受控预览', async () => {
  const user = userEvent.setup();
  const turn = runningTurn();
  turn.status = 'completed';
  turn.terminal = { id: 'terminal-file-ref', type: 'agent.ask', ts: 130, sender: { id: 'agent-1', kind: 'agent' }, payload: { status: 'completed', text: '[main.go](/srv/atoll/channels/c0/main.go:42)' } };
  const onPreviewResource = vi.fn();
  const state = { channelId: 'c0', rows: new Map([[1, turn.request]]), turns: new Map([[turn.requestId, turn]]), standalone: [], orphans: [], narration: [], lastSeq: 4 };
  render(<Timeline state={state} roster={[{ id: 'me', name: '我' }, { id: 'agent-1', name: '研究员' }]} selfId="me" pending={[]} approvalStates={{}} onPreviewResource={onPreviewResource} />);
  await user.click(screen.getByRole('link', { name: 'main.go' }));
  expect(onPreviewResource).toHaveBeenCalledWith('c0', {
    resource_id: '/srv/atoll/channels/c0/main.go',
    name: 'main.go',
    media_type: 'text/plain',
    file_reference: true,
    line: 42,
  });
});

// agent 为了答一句话调用别的 actor，那些调用过去和人问的那句平铺在同一层。这里钉的是
// 它们聚在这一问底下、默认收起，展开才看得到细节——人先读到主线，需要时才读过程。
it('agent 回合中调用的其它 actor 不铺进对话时间线', () => {
  const ask = { id: 'ask', type: 'agent.ask', kind: 'request', ts: 100, sender: { id: 'me', kind: 'human' }, audience: ['agent-1'], payload: { body: { text: '把 root 拉进来' } } };
  const askTurn = {
    requestId: 'ask', request: ask, requestSeq: 1, status: 'completed', provisional: [{ seq: 3, status: 'processing', envelope: { payload: { status: 'processing' } } }], anomalies: [],
    terminal: { id: 'ask-r', type: 'agent.ask', ts: 130, sender: { id: 'agent-1', kind: 'agent' }, payload: { status: 'completed', text: '已加入' } },
  };
  const admit = { id: 'admit', type: 'system.member.admit', kind: 'request', ts: 110, parent_id: 'ask', sender: { id: 'agent-1', kind: 'agent' }, audience: ['system'], payload: { body: { principal: 'root' } } };
  const admitTurn = {
    requestId: 'admit', request: admit, requestSeq: 2, status: 'completed', provisional: [], anomalies: [],
    terminal: { id: 'admit-r', type: 'system.member.admit', ts: 115, sender: { id: 'system', kind: 'system' }, payload: { status: 'completed', member: 'human:root:1' } },
  };
  const state = {
    channelId: 'c0', rows: new Map([[1, ask], [2, admit]]),
    turns: new Map([['ask', askTurn], ['admit', admitTurn]]),
    standalone: [], orphans: [], narration: [], lastSeq: 3,
  };
  render(<Timeline state={state} roster={[{ id: 'me', name: '我' }, { id: 'agent-1', name: '研究员' }]} selfId="me" pending={[]} approvalStates={{}} />);

  expect(screen.getByText('把 root 拉进来')).toBeTruthy();
  expect(document.querySelectorAll('.turn-card')).toHaveLength(1);
  expect(screen.queryByText('邀请成员加入')).toBeNull();
  expect(screen.queryByRole('button', { name: /关联调用/ })).toBeNull();
});

it('Agent 调用按 parent_id 渲染消息树，每个子节点独立折叠且子过程只留在自己的节点', async () => {
  const user = userEvent.setup();
  const root = { id: 'root-ask', kind: 'request', type: 'agent.ask', ts: 100, sender: { kind: 'human', id: 'me' }, audience: ['agent-a'], visibility: 'public', correlation_id: 'root-ask', payload: { text: '请协作回答' } };
  const child = { id: 'child-b', kind: 'request', type: 'agent.ask', ts: 120, sender: { kind: 'agent', id: 'agent-a' }, audience: ['agent-b'], visibility: 'public', parent_id: 'root-ask', correlation_id: 'root-ask', payload: { text: 'B 负责查资料' } };
  const grandchild = { id: 'child-d', kind: 'request', type: 'agent.ask', ts: 140, sender: { kind: 'agent', id: 'agent-b' }, audience: ['agent-d'], visibility: 'public', parent_id: 'child-b', correlation_id: 'root-ask', payload: { text: 'D 负责核验' } };
  const response = (id, parentId, sender, process, ts) => ({ id, kind: 'response', type: 'agent.ask', ts, sender: { kind: 'agent', id: sender }, audience: ['me'], visibility: 'public', parent_id: parentId, correlation_id: 'root-ask', payload: { status: 'processing', process } });
  const terminal = (id, parentId, sender, text, ts) => ({ id, kind: 'response', type: 'agent.ask', ts, sender: { kind: 'agent', id: sender }, audience: ['me'], visibility: 'public', parent_id: parentId, correlation_id: 'root-ask', payload: { status: 'completed', text } });
  const envelopes = [
    root,
    response('a-call-b-start', 'root-ask', 'agent-a', { kind: 'tool', phase: 'started', tool_call_id: 'call-b', tool: 'call_actor', input: { actor_id: 'agent-b', type: 'agent.ask', payload: { text: 'B 负责查资料' } } }, 110),
    child,
    response('b-stage', 'child-b', 'agent-b', { kind: 'stage', stage: 'thinking', text: 'B 正在查资料' }, 130),
    response('b-call-d-start', 'child-b', 'agent-b', { kind: 'tool', phase: 'started', tool_call_id: 'call-d', tool: 'call_actor', input: { actor_id: 'agent-d', type: 'agent.ask' } }, 135),
    grandchild,
    response('d-stage', 'child-d', 'agent-d', { kind: 'stage', stage: 'thinking', text: 'D 正在核验' }, 150),
    terminal('d-final', 'child-d', 'agent-d', 'D 核验完成', 160),
    response('b-call-d-end', 'child-b', 'agent-b', { kind: 'tool', phase: 'ended', tool_call_id: 'call-d', tool: 'call_actor', outcome: 'completed', output: { status: 'completed', text: 'D 核验完成' } }, 170),
    terminal('b-final', 'child-b', 'agent-b', 'B 汇总完成', 180),
    response('a-call-b-end', 'root-ask', 'agent-a', { kind: 'tool', phase: 'ended', tool_call_id: 'call-b', tool: 'call_actor', outcome: 'completed', output: { status: 'completed', text: 'B 汇总完成' } }, 190),
    terminal('a-final', 'root-ask', 'agent-a', 'A 最终回答', 200),
  ];
  const state = fold(envelopes.map((envelope, index) => ({ channel_id: 'c0', seq: index + 1, envelope })), 'me');
  render(<Timeline state={state} roster={[
    { id: 'me', name: '我' }, { id: 'agent-a', name: 'A' }, { id: 'agent-b', name: 'B' }, { id: 'agent-d', name: 'D' },
  ]} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);

  const nodes = [...document.querySelectorAll('.agent-thread-node')];
  expect(nodes).toHaveLength(2);
  expect(nodes.map((node) => node.getAttribute('aria-level'))).toEqual(['2', '3']);
  expect(document.querySelector('.agent-thread-request')).toBeNull();
  expect(nodes.every((node) => node.querySelector('.agent-thread-response > .agent-turn-bubble.compact'))).toBe(true);
  const collapseToggles = nodes.map((node) => node.querySelector('.agent-thread-collapse-toggle'));
  expect(collapseToggles.every(Boolean)).toBe(true);
  expect(collapseToggles.map((node) => node.getAttribute('aria-expanded'))).toEqual(['false', 'false']);
  expect(nodes.every((node) => node.querySelector('.agent-thread-message.is-collapsed'))).toBe(true);
  await user.click(collapseToggles[0]);
  expect(collapseToggles[0].getAttribute('aria-expanded')).toBe('true');
  expect(collapseToggles[1].getAttribute('aria-expanded')).toBe('false');
  expect(nodes[0].querySelector('.agent-thread-message.is-expanded')).toBeTruthy();
  expect(nodes[1].querySelector('.agent-thread-message.is-collapsed')).toBeTruthy();
  expect(nodes.every((node) => node.querySelector('.agent-thread-identity-row > .actor-icon'))).toBe(true);
  expect(nodes.every((node) => node.querySelector('.agent-thread-identity-row > header'))).toBe(true);
  expect(nodes.every((node) => node.querySelector('.agent-thread-identity-row + .agent-thread-content'))).toBe(true);
  expect(nodes.every((node) => !node.querySelector('.agent-thread-response > .message-row'))).toBe(true);
  expect(nodes.every((node) => node.querySelector('.agent-request-quote'))).toBe(true);
  expect(nodes[0].querySelector('.agent-request-quote').textContent).toContain('回复 A');
  expect(nodes[1].querySelector('.agent-request-quote').textContent).toContain('回复 B');
  expect(nodes[0].querySelector('.agent-thread-child-stem')).toBeTruthy();
  expect(nodes[0].querySelectorAll('.agent-thread-rail')).toHaveLength(1);
  expect(nodes[0].querySelector('.agent-thread-rail.ends').style.getPropertyValue('--thread-rail-level')).toBe('1');
  expect(nodes[1].querySelectorAll('.agent-thread-rail')).toHaveLength(1);
  expect(nodes[1].querySelector('.agent-thread-rail.ends').style.getPropertyValue('--thread-rail-level')).toBe('2');
  expect(nodes[1].querySelector('.agent-thread-rail.continues')).toBeNull();
  expect(screen.getByText('B 负责查资料')).toBeTruthy();
  expect(screen.getByText('D 负责核验')).toBeTruthy();
  expect(screen.getByText('A 最终回答')).toBeTruthy();
  expect(screen.getByText('B 汇总完成')).toBeTruthy();
  expect(screen.getByText('D 核验完成')).toBeTruthy();
  const processToggles = [...document.querySelectorAll('.progress-trail-toggle')].map((node) => node.textContent);
  expect(processToggles.some((text) => text.includes('1 条过程记录'))).toBe(true);
  expect(processToggles.some((text) => text.includes('2 条过程记录'))).toBe(true);
  expect(document.body.textContent).not.toContain('progress_events');
});

describe('F3 Composer', () => {
  it('回复目标独立于正文 mention，并按 sender kind 自动选择消息词', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue('reply-message');
    const onReplySent = vi.fn();
    const onCancelReply = vi.fn();
    render(<Composer
      channelId="c0"
      roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'peer', kind: 'human', name: '同事' }]}
      selfId="me"
      replyTarget={{ sourceId: 'source-1', senderId: 'peer', senderKind: 'human', senderName: '同事', excerpt: '请帮我确认一下' }}
      onCancelReply={onCancelReply}
      onReplySent={onReplySent}
      onSend={onSend}
    />);

    expect(screen.getByText('回复 @同事')).toBeTruthy();
    expect(document.querySelector('[data-type="mention"]')).toBeNull();
    await user.type(screen.getByRole('textbox', { name: '消息' }), '收到，我来处理{Enter}');
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ msgType: 'human.message', audience: ['peer'] }));
    expect(onReplySent).toHaveBeenCalledOnce();
  });

  it('回复模式阻止向其他 mention 拆发，取消回复不清空正文', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onCancelReply = vi.fn();
    render(<Composer
      channelId="c0"
      roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'agent-1', kind: 'agent', name: '研究员' }, { id: 'agent-2', kind: 'agent', name: '执行员' }]}
      selfId="me"
      replyTarget={{ sourceId: 'source-2', senderId: 'agent-1', senderKind: 'agent', senderName: '研究员', excerpt: '原始答复' }}
      onCancelReply={onCancelReply}
      onSend={onSend}
    />);
    const input = screen.getByRole('textbox', { name: '消息' });
    await user.type(input, '@执行');
    await user.click(screen.getByRole('option', { name: /执行员/ }));
    await user.type(input, '改由他处理{Enter}');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('回复只能发送给 @研究员');
    await user.click(screen.getByRole('button', { name: '取消回复' }));
    expect(onCancelReply).toHaveBeenCalledOnce();
    expect(input.textContent).toContain('改由他处理');
  });

  it('用 / 选择后端声明的 new 命令，第一次 Enter 只选中、第二次才发送', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue('message-new');
    render(<Composer
      channelId="c0"
      roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'steward', kind: 'agent', name: 'Steward' }]}
      selfId="me"
      onSend={onSend}
      agentSelection={{ fallbackAgentId: 'steward', supportedTypes: ['agent.compact', 'agent.new'] }}
    />);

    const input = screen.getByRole('textbox', { name: '消息' });
    await user.type(input, '/n{Enter}');
    expect(onSend).not.toHaveBeenCalled();
    expect(input.textContent).toBe('/new ');

    await user.type(input, '{Enter}');
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ msgType: 'agent.new', payload: {}, audience: ['steward'] }));
  });

  it('命令候选只展示目标 Agent 通过 describe 声明的控制词', async () => {
    const user = userEvent.setup();
    render(<Composer
      channelId="c0"
      roster={[{ id: 'steward', kind: 'agent', name: 'Steward' }]}
      onSend={() => {}}
      agentSelection={{ fallbackAgentId: 'steward', supportedTypes: ['agent.compact'] }}
    />);
    await user.type(screen.getByRole('textbox', { name: '消息' }), '/');
    expect(screen.getByRole('option', { name: /compact/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /new/ })).toBeNull();
  });

  it('把候选成员写成 Mention Node，并只按节点路由', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue('message-mention');
    const onDraftChange = vi.fn();
    render(<Composer channelId="c0" roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'agent-1', kind: 'agent', name: '研究员' }]} selfId="me" onDraftChange={onDraftChange} onSend={onSend} />);

    const input = screen.getByRole('textbox', { name: '消息' });
    await user.type(input, '@研');
    await user.click(screen.getByRole('option', { name: /研究员/ }));

    const mention = document.querySelector('[data-type="mention"][data-id="agent-1"]');
    expect(mention).toBeTruthy();
    const snapshot = onDraftChange.mock.calls.at(-1)[0];
    expect(snapshot.doc.content[0].content.some((node) => node.type === 'mention' && node.attrs.id === 'agent-1')).toBe(true);

    await user.type(input, '请处理{Enter}');
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ audience: ['agent-1'] }));
  });

  it('多 @ 拆发：N 个收件人拆成 N 条单 audience 消息，各按 kind 定词', async () => {
    // request 帧在写入 gate 恒强制收件人恰一个（协议 §3.1），多 audience 是非法
    // 帧——拆发是把一次输入翻译成 N 条合法帧的唯一方式；混合 @ 各按其 kind。
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValueOnce('m-1').mockResolvedValueOnce('m-2');
    render(<Composer channelId="c0" roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'steward', kind: 'agent', name: 'Steward' }, { id: 'peer', kind: 'human', name: '同事' }]} selfId="me" onSend={onSend} />);

    const input = screen.getByRole('textbox', { name: '消息' });
    await user.type(input, '@St');
    await user.click(screen.getByRole('option', { name: /Steward/ }));
    await user.type(input, '@同');
    await user.click(screen.getByRole('option', { name: /同事/ }));
    await user.type(input, '一起看下{Enter}');

    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend.mock.calls[0][0]).toMatchObject({ msgType: 'agent.ask', audience: ['steward'] });
    expect(onSend.mock.calls[1][0]).toMatchObject({ msgType: 'human.message', audience: ['peer'] });
    expect(onSend.mock.calls[0][0].text).toBe(onSend.mock.calls[1][0].text);
  });

  it('用 Enter 选中 @候选时不会把选择动作继续当成发送', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Composer channelId="c0" roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'steward', kind: 'agent', name: 'Steward' }, { id: 'claude', kind: 'agent', name: 'Claude' }]} selfId="me" onSend={onSend} />);

    const input = screen.getByRole('textbox', { name: '消息' });
    await user.type(input, '@Cl{Enter}');

    expect(onSend).not.toHaveBeenCalled();
    expect(document.querySelector('[data-type="mention"][data-id="claude"]')).toBeTruthy();
  });

  it('不会把普通文本里的 @ 名称猜成收件人', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<Composer channelId="c0" roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'agent-1', kind: 'agent', name: '研究员' }, { id: 'agent-2', kind: 'agent', name: '执行员' }]} selfId="me" onSend={onSend} />);
    await user.type(screen.getByRole('textbox', { name: '消息' }), '正文里的 @研究员 不是节点{Enter}');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('请从候选列表选择成员');
  });

  it('supports multiline, attachment entry and accepted state', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    const onUploadAttachments = vi.fn().mockResolvedValue([]);
    const onOpenChannelFiles = vi.fn();
    function Harness() {
      const [draft, setDraft] = useState('');
      return <Composer channelId="c0" roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'agent-1', kind: 'agent', name: '研究员' }]} selfId="me" draft={draft} onDraftChange={setDraft} onSend={onSend} onUploadAttachments={onUploadAttachments} onOpenChannelFiles={onOpenChannelFiles} />;
    }
    render(<Harness />);
    expect(screen.getByRole('textbox', { name: '消息' })).toBeTruthy();
    await user.upload(screen.getByLabelText('上传本机文件到频道'), new File(['test'], '本机文件.txt', { type: 'text/plain' }));
    expect(onUploadAttachments).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: '从频道文件选择' }));
    expect(onOpenChannelFiles).toHaveBeenCalledOnce();
    const input = screen.getByLabelText('消息');
    await user.type(input, '第一行{Shift>}{Enter}{/Shift}第二行');
    expect(onSend).not.toHaveBeenCalled();
    await user.type(input, '{Enter}');
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('待发送附件的主体打开预览，删除是独立操作', async () => {
    const user = userEvent.setup();
    const attachment = { resource_id: 'file:draft', name: '草稿报告.pdf', media_type: 'application/pdf', size: 4096 };
    const onPreviewAttachment = vi.fn();
    const onRemoveAttachment = vi.fn();
    render(<Composer channelId="c0" roster={[{ id: 'agent-1', kind: 'agent', name: '研究员' }]} attachments={[attachment]} onSend={() => {}} onPreviewAttachment={onPreviewAttachment} onRemoveAttachment={onRemoveAttachment} />);
    await user.click(screen.getByRole('button', { name: '预览文件 草稿报告.pdf' }));
    expect(onPreviewAttachment).toHaveBeenCalledWith(attachment);
    expect(onRemoveAttachment).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '移除附件 草稿报告.pdf' }));
    expect(onRemoveAttachment).toHaveBeenCalledWith('file:draft');
    expect(onPreviewAttachment).toHaveBeenCalledTimes(1);
  });

  it('粘贴与拖入文件复用频道上传链路，普通文本粘贴不被接管', async () => {
    const onUploadAttachments = vi.fn().mockResolvedValue([]);
    render(<Composer channelId="c0" roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'agent-1', kind: 'agent', name: '研究员' }]} selfId="me" onSend={() => {}} onUploadAttachments={onUploadAttachments} />);
    const input = screen.getByRole('textbox', { name: '消息' });
    const pasted = new File(['image'], '剪贴板截图.png', { type: 'image/png' });
    const pasteResult = fireEvent.paste(input, { clipboardData: { files: [pasted], getData: () => '' } });
    expect(pasteResult).toBe(false);
    expect(onUploadAttachments).toHaveBeenLastCalledWith([pasted]);
    await waitFor(() => expect(screen.getByLabelText('上传本机文件到频道')).toBeTruthy());

    const dragged = new File(['report'], '拖入报告.pdf', { type: 'application/pdf' });
    const surface = document.querySelector('.composer-surface');
    fireEvent.dragEnter(surface, { dataTransfer: { types: ['Files'], files: [dragged] } });
    expect(screen.getByText('松开以上传到当前频道')).toBeTruthy();
    fireEvent.drop(surface, { dataTransfer: { types: ['Files'], files: [dragged], dropEffect: 'none' } });
    expect(onUploadAttachments).toHaveBeenLastCalledWith([dragged]);
    expect(screen.queryByText('松开以上传到当前频道')).toBeNull();

    const textPasteResult = fireEvent.paste(input, { clipboardData: { files: [], getData: () => '' } });
    expect(textPasteResult).toBe(true);
    expect(onUploadAttachments).toHaveBeenCalledTimes(2);
  });

  it('中文确认先绘制文字，空闲阶段才序列化草稿和同步外围高度', async () => {
    const originalResizeObserver = globalThis.ResizeObserver;
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
    let notifyResize = () => {};
    let nextFrameId = 1;
    const frames = [];
    class TestResizeObserver {
      constructor(callback) { notifyResize = callback; }
      observe() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = TestResizeObserver;
    globalThis.requestAnimationFrame = (callback) => {
      const id = nextFrameId++;
      frames.push({ id, callback });
      return id;
    };
    globalThis.cancelAnimationFrame = (id) => {
      const frame = frames.find((row) => row.id === id);
      if (frame) frame.cancelled = true;
    };
    const runFrame = () => {
      const frame = frames.shift();
      if (frame && !frame.cancelled) frame.callback(performance.now());
    };
    let height = 116;
    const onDraftChange = vi.fn();
    const { container, unmount } = render(<main className="workspace"><section className="timeline" /><Composer channelId="c0" roster={[{ id: 'agent-1', kind: 'agent', name: '研究员' }]} onDraftChange={onDraftChange} onSend={() => {}} /></main>);
    const wrap = container.querySelector('.composer-wrap');
    wrap.getBoundingClientRect = () => ({ width: 800, height, top: 0, right: 800, bottom: height, left: 0, x: 0, y: 0, toJSON: () => ({}) });
    act(() => notifyResize([]));
    expect(container.querySelector('.workspace').style.getPropertyValue('--composer-overlay-height')).toBe('116px');

    frames.length = 0;
    const input = screen.getByRole('textbox', { name: '消息' });
    fireEvent.compositionStart(input, { data: '中' });
    await userEvent.setup().type(input, '中');
    height = 138;
    act(() => notifyResize([]));
    expect(container.querySelector('.workspace').style.getPropertyValue('--composer-overlay-height')).toBe('116px');
    expect(onDraftChange).not.toHaveBeenCalled();

    fireEvent.compositionEnd(input, { data: '中' });
    // 第一帧只允许浏览器绘制 ProseMirror 已确认的文字，不提交外围布局。
    act(runFrame);
    expect(container.querySelector('.workspace').style.getPropertyValue('--composer-overlay-height')).toBe('116px');
    expect(onDraftChange).not.toHaveBeenCalled();
    // 第二帧只更新发送按钮等轻量状态；序列化与强制布局仍不能进入该帧。
    act(runFrame);
    expect(container.querySelector('.workspace').style.getPropertyValue('--composer-overlay-height')).toBe('116px');
    expect(onDraftChange).not.toHaveBeenCalled();
    // 浏览器获得一次绘制机会后，fallback macrotask 才做草稿 JSON 与高度同步。
    await waitFor(() => expect(container.querySelector('.workspace').style.getPropertyValue('--composer-overlay-height')).toBe('138px'));
    expect(onDraftChange).toHaveBeenLastCalledWith(expect.objectContaining({ text: '中' }));

    unmount();
    globalThis.ResizeObserver = originalResizeObserver;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('发送反馈在请求从 pending 消失后收敛为已入账', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [draft, setDraft] = useState('写入真实账本');
      return <Composer channelId="c0" roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'agent-1', kind: 'agent', name: '研究员' }]} selfId="me" pending={[]} draft={draft} onDraftChange={setDraft} onSend={() => Promise.resolve('message-1')} />;
    }
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /发送/ }));
    await waitFor(() => expect(screen.queryByText('已写入频道账本')).toBeNull());
  });
});
