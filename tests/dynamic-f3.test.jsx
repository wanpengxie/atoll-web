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
  const request = { id: 'req-1', type: 'agent.text', kind: 'request', ts: 100, sender: { id: 'me', kind: 'human' }, audience: ['agent-1'], payload: { text: '整理研究报告', token: 'secret' } };
  return {
    requestId: request.id, request, requestSeq: 1, status: 'processing', latestStatus: 'processing', terminal: null,
    provisional: [{ seq: 2, status: 'processing', core: true, envelope: { id: 'p-1', type: 'agent.text', ts: 110, sender: { id: 'agent-1' }, payload: { status: 'processing', detail: '正在整理资料' } } }],
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
  await user.click(screen.getByRole('button', { name: '打开详情' }));
  expect(onOpenTurn).toHaveBeenCalledWith(turn);
  expect(screen.getByRole('button', { name: '创建任务' })).toBeTruthy();
});

it('Turn detail exposes audit identifiers without serializing payload JSON', () => {
  render(<TurnContext turn={runningTurn()} roster={[{ id: 'me', name: '我' }, { id: 'agent-1', name: '研究员' }]} selfId="me" access="member_active" capability={null} controlState={{}} onCancel={() => {}} onControl={() => {}} onDownload={() => {}} onSource={() => {}} onClose={() => {}} />);
  expect(screen.getByRole('complementary', { name: '回合详情' })).toBeTruthy();
  expect(screen.getByText('工具 · search')).toBeTruthy();
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

describe('F3 Composer', () => {
  it('supports multiline, visible target, attachment entry and accepted state', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn().mockResolvedValue(undefined);
    const onChooseAttachment = vi.fn();
    function Harness() {
      const [draft, setDraft] = useState('');
      return <Composer channelId="c0" roster={[{ id: 'me', kind: 'human', name: '我' }, { id: 'agent-1', kind: 'agent', name: '研究员' }]} selfId="me" draft={draft} onDraftChange={setDraft} onSend={onSend} onChooseAttachment={onChooseAttachment} />;
    }
    render(<Harness />);
    expect(screen.getByText('使用 @ 选择频道成员')).toBeTruthy();
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
