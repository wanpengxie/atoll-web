// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Timeline } from '../src/ui/Timeline.jsx';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const roster = [{ id: 'me', name: '我' }, { id: 'agent-1', name: '研究员' }];
const LONG = '这是一段很长的思考记录，'.repeat(12);

// 过程轨迹的三条：进行中能看、落定后仍能回看、任何一条都能拉开看全文。
// 这三件事都是纯查看——控制恒不在气泡里（见 agent-information-architecture）。
function turnWith({ terminal = null } = {}) {
  const request = { id: 'req-1', type: 'agent.ask', kind: 'request', ts: 100, sender: { id: 'me', kind: 'human' }, audience: ['agent-1'], payload: { text: '解释账本模型' } };
  return {
    requestId: request.id, request, requestSeq: 1, status: terminal ? 'completed' : 'processing',
    latestStatus: terminal ? 'completed' : 'processing', terminal,
    provisional: [
      { seq: 2, status: 'processing', core: true, envelope: { id: 'p-0', type: 'agent.ask', ts: 105, sender: { id: 'agent-1' }, payload: { status: 'processing', turn_id: 't-1' } } },
      { seq: 4, status: 'processing', envelope: { id: 'p-1', type: 'agent.ask', ts: 115, sender: { id: 'agent-1' }, payload: { status: 'processing', kind: 'thinking', text: LONG } } },
      { seq: 6, status: 'processing', envelope: { id: 'p-2', type: 'agent.ask', ts: 125, sender: { id: 'agent-1' }, payload: { status: 'processing', kind: 'text', text: '先说结论' } } },
    ],
    activity: [
      { seq: 3, envelope: { id: 'a-1', type: 'agent.tool.started', ts: 110, sender: { id: 'agent-1' }, payload: { tool_call_id: 'call-1', tool: 'search', status: 'started', input: { query: '账本模型' } } } },
      { seq: 5, envelope: { id: 'a-2', type: 'agent.tool.ended', ts: 120, sender: { id: 'agent-1' }, payload: { tool_call_id: 'call-1', tool: 'search', status: 'completed', detail: '命中 3 条', output: { hits: 3 } } } },
    ],
    anomalies: [],
  };
}

function renderTurn(turn) {
  const state = { channelId: 'c0', rows: new Map([[1, turn.request]]), turns: new Map([[turn.requestId, turn]]), standalone: [], orphans: [], narration: [], lastSeq: 6 };
  return render(<Timeline state={state} roster={roster} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
}

it('处理中：工具行与中间产物同轨滚动，每条一行且可展开全文', () => {
  renderTurn(turnWith());
  expect(document.querySelectorAll('.progress-trail.running .progress-row')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: /展开过程详情/ }));
  const rows = [...document.querySelectorAll('.progress-row')].map((row) => row.textContent);
  expect(rows.some((text) => text.startsWith('tool: search 完成'))).toBe(true);
  expect(rows.some((text) => text.startsWith('思考 · '))).toBe(true);
  expect(rows.some((text) => text.startsWith('草稿 · 先说结论'))).toBe(true);

  // 详情浮层：点一条才出来，出来后是全文，关掉就没了。
  expect(document.querySelector('.progress-drawer')).toBeNull();
  const thinkingRow = [...document.querySelectorAll('.progress-row button')].find((button) => button.textContent.startsWith('思考 · '));
  fireEvent.click(thinkingRow);
  const drawer = document.querySelector('.progress-drawer');
  expect(drawer).toBeTruthy();
  expect(drawer.textContent).toContain(LONG.slice(0, 40));
  fireEvent.click(screen.getByLabelText('关闭详情'));
  expect(document.querySelector('.progress-drawer')).toBeNull();

  const tool = [...document.querySelectorAll('.progress-row button')].find((button) => button.textContent.startsWith('tool: search'));
  fireEvent.click(tool);
  expect(document.querySelector('.progress-raw-json').textContent).toBe('{"input":{"query":"账本模型"},"output":{"hits":3}}');
  expect(screen.queryByText('调用参数')).toBeNull();
  expect(screen.queryByText('执行结果')).toBeNull();
  expect(document.querySelector('.progress-drawer .structured-result-details')).toBeNull();
  expect(document.querySelector('.progress-drawer').textContent).not.toContain('（这一步没有留下细节）');
});

it('落定后过程仍在：收成入口，展开是同一条轨迹', () => {
  const terminal = { id: 'terminal-1', type: 'agent.ask', ts: 130, sender: { id: 'agent-1', kind: 'agent' }, payload: { status: 'completed', text: '最终答复' } };
  renderTurn(turnWith({ terminal }));
  expect(screen.getByText('最终答复')).toBeTruthy();
  const toggle = document.querySelector('.progress-trail.settled .progress-trail-toggle');
  expect(toggle.textContent).toContain('3 条过程记录');
  expect(document.querySelectorAll('.progress-row')).toHaveLength(0);
  fireEvent.click(toggle);
  expect(document.querySelectorAll('.progress-row').length).toBe(3);
});

it('没有文本的思考区间是状态不是记录：显示但点不开', () => {
  const turn = turnWith();
  turn.provisional = [turn.provisional[0], { seq: 4, status: 'processing', envelope: { id: 'p-1', type: 'agent.ask', ts: 115, sender: { id: 'agent-1' }, payload: { status: 'processing', kind: 'thinking', text: '' } } }];
  turn.activity = [];
  renderTurn(turn);
  const row = document.querySelector('.progress-row');
  expect(row.textContent).toContain('思考中…');
  expect(row.querySelector('button')).toBeNull();
});

it('运行气泡默认两行、整块展开，每行有时间且最后一行持续计时', () => {
  vi.useFakeTimers();
  const now = new Date('2026-08-23T12:00:10Z');
  vi.setSystemTime(now);
  const turn = turnWith();
  turn.activity[0].envelope.ts = now.getTime() - 8_000;
  turn.activity[1].envelope.ts = now.getTime() - 6_000;
  turn.provisional[1].envelope.ts = now.getTime() - 4_000;
  turn.provisional[2].envelope.ts = now.getTime() - 2_000;
  renderTurn(turn);

  const bubble = document.querySelector('.progress-trail.running');
  expect(bubble.querySelectorAll('.progress-row')).toHaveLength(2);
  expect(bubble.querySelectorAll('.progress-row time')).toHaveLength(2);
  expect(bubble.querySelector('.progress-row-duration').textContent).toBe('00:02');
  act(() => vi.advanceTimersByTime(2_000));
  expect(bubble.querySelector('.progress-row-duration').textContent).toBe('00:04');

  fireEvent.click(screen.getByRole('button', { name: /展开过程详情/ }));
  expect(bubble.querySelectorAll('.progress-row')).toHaveLength(3);
  expect(bubble.querySelectorAll('.progress-row time')).toHaveLength(3);
  expect(screen.getByRole('button', { name: /收起过程详情/ })).toBeTruthy();
});

it('运行气泡没有过程时只显示 header，一条过程时只占一行；完成记录不带时间', () => {
  const empty = turnWith();
  empty.activity = [];
  empty.provisional = [empty.provisional[0]];
  const view = renderTurn(empty);
  expect(document.querySelector('.progress-running-header')).toBeTruthy();
  expect(document.querySelector('.progress-trail.running .progress-trail-list')).toBeNull();

  const one = turnWith();
  one.activity = [];
  one.provisional = [one.provisional[0], one.provisional[2]];
  view.unmount();
  renderTurn(one);
  expect(document.querySelectorAll('.progress-trail.running .progress-row')).toHaveLength(1);
  cleanup();

  const terminal = { id: 'terminal-1', type: 'agent.ask', ts: 130, sender: { id: 'agent-1', kind: 'agent' }, payload: { status: 'completed', text: '完成' } };
  renderTurn(turnWith({ terminal }));
  fireEvent.click(document.querySelector('.progress-trail.settled .progress-trail-toggle'));
  expect(document.querySelectorAll('.progress-trail.settled .progress-row time')).toHaveLength(0);
});
