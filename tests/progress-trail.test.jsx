// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Timeline } from '../src/ui/Timeline.jsx';

// This suite asserts progress semantics, not virtual-list geometry.
vi.mock('../src/ui/timeline/LegendMessageList.jsx', async () => ({
  MessageList: (await import('./helpers/PresentationMessageList.jsx')).PresentationMessageList,
}));

afterEach(() => { cleanup(); vi.useRealTimers(); });

const roster = [{ id: 'me', name: '我' }, { id: 'agent-1', name: '研究员' }];
const LONG = '这是一段很长的思考记录，'.repeat(12);

// 工具与思考留在过程轨迹；stage:text 是已经发出的对话正文。
function turnWith({ terminal = null } = {}) {
  const request = { id: 'req-1', type: 'agent.ask', kind: 'request', ts: 100, sender: { id: 'me', kind: 'human' }, audience: ['agent-1'], payload: { text: '解释账本模型' } };
  return {
    requestId: request.id, request, requestSeq: 1, status: terminal ? 'completed' : 'processing',
    latestStatus: terminal ? 'completed' : 'processing', terminal,
    provisional: [
      { seq: 2, status: 'processing', core: true, envelope: { id: 'p-0', type: 'agent.ask', ts: 105, sender: { id: 'agent-1' }, payload: { status: 'processing', turn_id: 't-1', process: { kind: 'turn', phase: 'started' } } } },
      { seq: 3, status: 'processing', envelope: { id: 'p-tool-start', type: 'agent.ask', ts: 110, sender: { id: 'agent-1' }, payload: { status: 'processing', process: { kind: 'tool', phase: 'started', tool_call_id: 'call-1', tool: 'search', input: { query: '账本模型', filters: { scope: 'channel' } } } } } },
      { seq: 4, status: 'processing', envelope: { id: 'p-1', type: 'agent.ask', ts: 115, sender: { id: 'agent-1' }, payload: { status: 'processing', process: { kind: 'stage', stage: 'thinking', text: LONG } } } },
      { seq: 5, status: 'processing', envelope: { id: 'p-tool-end', type: 'agent.ask', ts: 120, sender: { id: 'agent-1' }, payload: { status: 'processing', process: { kind: 'tool', phase: 'ended', tool_call_id: 'call-1', tool: 'search', outcome: 'completed', detail: '命中 3 条', output: { hits: 3 } } } } },
      { seq: 6, status: 'processing', envelope: { id: 'p-2', type: 'agent.ask', ts: 125, sender: { id: 'agent-1' }, payload: { status: 'processing', process: { kind: 'stage', stage: 'text', text: '先说结论' } } } },
    ],
    anomalies: [],
  };
}

function renderTurn(turn) {
  const state = { channelId: 'c0', rows: new Map([[1, turn.request]]), turns: new Map([[turn.requestId, turn]]), standalone: [], orphans: [], narration: [], lastSeq: 6 };
  return render(<Timeline state={state} roster={roster} selfId="me" pending={[]} approvalStates={{}} access="member_active" />);
}

it('处理中：stage:text 显示为正文，工具与思考留在可展开的过程轨迹', () => {
  renderTurn(turnWith());
  expect(document.querySelector('.agent-progress-text').textContent).toBe('先说结论');
  expect(document.querySelectorAll('.progress-trail.running .progress-row')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: /展开过程详情/ }));
  const rows = [...document.querySelectorAll('.progress-row')].map((row) => row.textContent);
  expect(rows.some((text) => text.startsWith('tool: search 完成'))).toBe(true);
  expect(rows.some((text) => text.startsWith('思考 · '))).toBe(true);
  expect(rows.some((text) => text.includes('先说结论'))).toBe(false);

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
  const jsonTree = document.querySelector('.progress-json-tree');
  expect(jsonTree.textContent).toContain('"input"');
  expect(jsonTree.textContent).toContain('"query"');
  expect(jsonTree.textContent).toContain('账本模型');
  expect(jsonTree.textContent).toContain('"output"');
  expect(jsonTree.textContent).toContain('3');
  expect(jsonTree.textContent).not.toContain('"scope"');
  fireEvent.click(jsonTree.querySelector('.progress-json-toggle:not(.is-open)'));
  expect(jsonTree.textContent).toContain('"scope"');
  expect(jsonTree.textContent).toContain('channel');
  expect(screen.queryByText('调用参数')).toBeNull();
  expect(screen.queryByText('执行结果')).toBeNull();
  expect(document.querySelector('.progress-drawer .structured-result-details')).toBeNull();
  expect(document.querySelector('.progress-drawer').textContent).not.toContain('（这一步没有留下细节）');
});

it('落定后过程仍在：收成入口，展开是同一条轨迹', () => {
  const terminal = { id: 'terminal-1', type: 'agent.ask', ts: 130, sender: { id: 'agent-1', kind: 'agent' }, payload: { status: 'completed', text: '最终答复' } };
  renderTurn(turnWith({ terminal }));
  expect(document.querySelector('.agent-progress-text').textContent).toBe('先说结论');
  expect(screen.getByText('最终答复')).toBeTruthy();
  const toggle = document.querySelector('.progress-trail.settled .progress-trail-toggle');
  expect(toggle.textContent).toContain('2 条过程记录');
  expect(document.querySelectorAll('.progress-row')).toHaveLength(0);
  fireEvent.click(toggle);
  expect(document.querySelectorAll('.progress-row').length).toBe(2);
});

it('没有文本的思考区间是状态不是记录：显示但点不开', () => {
  const turn = turnWith();
  turn.provisional = [turn.provisional[0], { seq: 4, status: 'processing', envelope: { id: 'p-1', type: 'agent.ask', ts: 115, sender: { id: 'agent-1' }, payload: { status: 'processing', process: { kind: 'stage', stage: 'thinking', text: '' } } } }];
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
  turn.provisional[1].envelope.ts = now.getTime() - 8_000;
  turn.provisional[2].envelope.ts = now.getTime() - 4_000;
  turn.provisional[3].envelope.ts = now.getTime() - 2_000;
  turn.provisional[4].envelope.ts = now.getTime() - 2_000;
  renderTurn(turn);

  const bubble = document.querySelector('.progress-trail.running');
  expect(bubble.querySelectorAll('.progress-row')).toHaveLength(2);
  expect(bubble.querySelectorAll('.progress-row time')).toHaveLength(2);
  expect(bubble.querySelector('.progress-row-duration').textContent).toBe('00:02');
  act(() => vi.advanceTimersByTime(2_000));
  expect(bubble.querySelector('.progress-row-duration').textContent).toBe('00:04');

  fireEvent.click(screen.getByRole('button', { name: /展开过程详情/ }));
  expect(bubble.querySelectorAll('.progress-row')).toHaveLength(2);
  expect(bubble.querySelectorAll('.progress-row time')).toHaveLength(2);
  expect(screen.getByRole('button', { name: /收起过程详情/ })).toBeTruthy();
});

it('运行气泡没有过程时只显示 header，一条过程时只占一行；完成记录不带时间', () => {
  const empty = turnWith();
  empty.provisional = [empty.provisional[0]];
  const view = renderTurn(empty);
  expect(document.querySelector('.progress-running-header')).toBeTruthy();
  expect(document.querySelector('.progress-trail.running .progress-trail-list')).toBeNull();

  const one = turnWith();
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
