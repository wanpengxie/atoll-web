// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from '../src/ui/Composer.jsx';
import { Timeline } from '../src/ui/Timeline.jsx';
import { TurnContext } from '../src/ui/context/TurnContext.jsx';

afterEach(cleanup);

function runningTurn() {
  const request = { id: 'req-1', type: 'agent.ask', kind: 'request', ts: 100, sender: { id: 'me', kind: 'human' }, audience: ['agent-1'], payload: { text: '整理研究报告', token: 'secret' } };
  return {
    requestId: request.id, request, requestSeq: 1, status: 'processing', latestStatus: 'processing', terminal: null,
    provisional: [{ seq: 2, status: 'processing', core: true, envelope: { id: 'p-1', type: 'agent.ask', ts: 110, sender: { id: 'agent-1' }, payload: { status: 'processing', detail: '正在整理资料' } } }],
    activity: [{ seq: 3, envelope: { id: 'a-1', type: 'agent.tool.started', ts: 120, sender: { id: 'agent-1' }, payload: { tool: 'search', status: 'started' } } }],
    anomalies: [{ code: 'sample', seq: 4 }],
  };
}

it('main Dynamic exposes message actions but keeps tool activity in Turn Context', async () => {
  const user = userEvent.setup();
  const turn = runningTurn();
  const onOpenTurn = vi.fn();
  const state = { channelId: 'c0', rows: new Map([[1, turn.request]]), turns: new Map([[turn.requestId, turn]]), standalone: [], orphans: [], narration: [], lastSeq: 3 };
  render(<Timeline state={state} roster={[{ id: 'me', name: '我' }, { id: 'agent-1', name: '研究员' }]} selfId="me" pending={[]} approvalStates={{}} access="member_active" onOpenTurn={onOpenTurn} onCreateTask={() => {}} />);
  expect(screen.getByText('正在整理资料')).toBeTruthy();
  expect(screen.queryByText(/工具 · search/)).toBeNull();
  await user.tab();
  await user.tab();
  await user.click(screen.getByRole('button', { name: '查看详情' }));
  expect(onOpenTurn).toHaveBeenCalledWith(turn);
  expect(screen.getByRole('button', { name: '创建任务' })).toBeTruthy();
});

it('expanded turn detail stays between its request and terminal response', () => {
  const turn = runningTurn();
  turn.status = 'completed';
  turn.terminal = { id: 'terminal-1', type: 'agent.ask', ts: 130, sender: { id: 'agent-1', kind: 'agent' }, payload: { status: 'completed', text: '最终答复' } };
  const state = { channelId: 'c0', rows: new Map([[1, turn.request]]), turns: new Map([[turn.requestId, turn]]), standalone: [], orphans: [], narration: [], lastSeq: 4 };
  const view = render(<Timeline state={state} roster={[{ id: 'me', name: '我' }, { id: 'agent-1', name: '研究员' }]} selfId="me" pending={[]} approvalStates={{}} access="member_active" turnDetail={{ selected: turn, onClose: () => {} }} />);
  const card = view.container.querySelector('.turn-card');
  const children = [...card.children];
  expect(children.indexOf(card.querySelector('.request-message'))).toBeLessThan(children.indexOf(card.querySelector('.turn-inline-detail').closest('.information-flow-row')));
  expect(children.indexOf(card.querySelector('.turn-inline-detail').closest('.information-flow-row'))).toBeLessThan(children.indexOf(card.querySelector('.turn-response')));
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

// agent 为了答一句话调用别的 actor，那些调用过去和人问的那句平铺在同一层。这里钉的是
// 它们聚在这一问底下、默认收起，展开才看得到细节——人先读到主线，需要时才读过程。
it('agent 回合中调用的其它 actor 聚在这一问底下，默认收起', async () => {
  const user = userEvent.setup();
  const ask = { id: 'ask', type: 'agent.ask', kind: 'request', ts: 100, sender: { id: 'me', kind: 'human' }, audience: ['agent-1'], payload: { body: { text: '把 root 拉进来' } } };
  const askTurn = {
    requestId: 'ask', request: ask, requestSeq: 1, status: 'completed', provisional: [], activity: [], anomalies: [],
    terminal: { id: 'ask-r', type: 'agent.ask', ts: 130, sender: { id: 'agent-1', kind: 'agent' }, payload: { status: 'completed', text: '已加入' } },
  };
  const admit = { id: 'admit', type: 'system.member.admit', kind: 'request', ts: 110, parent_id: 'ask', sender: { id: 'agent-1', kind: 'agent' }, audience: ['system'], payload: { body: { principal: 'root' } } };
  const admitTurn = {
    requestId: 'admit', request: admit, requestSeq: 2, status: 'completed', provisional: [], activity: [], anomalies: [],
    terminal: { id: 'admit-r', type: 'system.member.admit', ts: 115, sender: { id: 'system', kind: 'system' }, payload: { status: 'completed', member: 'human:root:1' } },
  };
  const state = {
    channelId: 'c0', rows: new Map([[1, ask], [2, admit]]),
    turns: new Map([['ask', askTurn], ['admit', admitTurn]]),
    standalone: [], orphans: [], narration: [], lastSeq: 3,
  };
  render(<Timeline state={state} roster={[{ id: 'me', name: '我' }, { id: 'agent-1', name: '研究员' }]} selfId="me" pending={[]} approvalStates={{}} />);

  // 人问的那句读得出正文（载荷带 body 包装），被叫出来的调用不占一张卡。
  expect(screen.getByText('把 root 拉进来')).toBeTruthy();
  expect(document.querySelectorAll('.turn-card')).toHaveLength(1);
  expect(screen.queryByText('邀请成员加入')).toBeNull();

  await user.click(screen.getByRole('button', { name: /1 次关联调用/ }));
  expect(screen.getByText('邀请成员加入')).toBeTruthy();
  expect(screen.getByText('root')).toBeTruthy();
});

describe('F3 Composer', () => {
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
    const onChooseAttachment = vi.fn();
    function Harness() {
      const [draft, setDraft] = useState('');
      return <Composer channelId="c0" roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'agent-1', kind: 'agent', name: '研究员' }]} selfId="me" draft={draft} onDraftChange={setDraft} onSend={onSend} onChooseAttachment={onChooseAttachment} />;
    }
    render(<Harness />);
    expect(screen.getByRole('textbox', { name: '消息' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '＋ 附件' }));
    expect(onChooseAttachment).toHaveBeenCalledOnce();
    const input = screen.getByLabelText('消息');
    await user.type(input, '第一行{Shift>}{Enter}{/Shift}第二行');
    expect(onSend).not.toHaveBeenCalled();
    await user.type(input, '{Enter}');
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('发送反馈在请求从 pending 消失后收敛为已入账', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [draft, setDraft] = useState('写入真实账本');
      return <Composer channelId="c0" roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'agent-1', kind: 'agent', name: '研究员' }]} selfId="me" pending={[]} draft={draft} onDraftChange={setDraft} onSend={() => Promise.resolve('message-1')} />;
    }
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /发送/ }));
    expect(await screen.findByText('已写入频道账本')).toBeTruthy();
  });
});
