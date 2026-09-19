// @vitest-environment jsdom
// 恢复自 master:tests/structured-result.test.js + tests/structured-result-ui.test.jsx（RT 域）。
// 旧结构 src/ui/StructuredResult.jsx（导出 redactSensitive / terminalPresentation / StructuredResult）
// 已删除。当前唯一展示 owner 是 TimelineRowRenderer.jsx 内部的
// StructuredResult/StructuredData/redactSensitive；通过 public
// useTimelineRowRenderer → TurnCard → AgentAnswer → StructuredResult 渲染路径断言用户可见文案。
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTimelineRowRenderer } from '../src/ui/timeline/TimelineRowRenderer.jsx';

afterEach(cleanup);

function turnRow(terminalBody, { requestType = 'agent.ask', requestId = 'r1' } = {}) {
  const request = { id: requestId, type: requestType, sender: { id: 'agent-1', kind: 'agent' }, audience: ['me'], ts: 100, payload: { body: { text: 'do it' } } };
  const terminal = { id: `${requestId}:t`, sender: { id: 'agent-1', kind: 'agent' }, ts: 200, payload: { body: terminalBody } };
  const turn = { requestId, request, terminal, terminalClosureOnly: false, provisional: [], thread: [], status: terminalBody.status === 'failed' ? 'failed' : 'completed' };
  return { id: requestId, contentRevision: 0, visualSlotID: requestId, body: { kind: 'turn', turn, thread: [] } };
}

function Harness({ row, channelId = 'c0' }) {
  const { renderRow } = useTimelineRowRenderer({
    state: { channelId, narration: [] },
    names: new Map(), selfId: 'me',
    presentationEditing: null, browsingExpandedSlots: new Set(), effectiveFoldOverrides: new Map(),
    approvalStates: {},
  });
  return renderRow(row);
}

describe('结构化终态呈现（新结构：TimelineRowRenderer 内的 StructuredResult）', () => {
  it('以 cancelled 事实优先解释取消终态', () => {
    render(<Harness row={turnRow({ status: 'failed', reason: 'unanswered_timeout', cancelled: true, detail: 'cancelled by caller' })} />);
    expect(screen.getByText('任务已取消')).toBeTruthy();
  });

  it('never renders successful non-text results as an empty answer：ack 分支保留', () => {
    render(<Harness row={turnRow({ status: 'completed' })} />);
    expect(screen.getByText('✓ 已完成')).toBeTruthy();
  });

  it('never renders successful non-text results as an empty answer：空文本分支保留', () => {
    render(<Harness row={turnRow({ status: 'completed', text: '' })} />);
    expect(screen.getByText('返回了空文本')).toBeTruthy();
  });

  it('registrar 结果以 requestType 命名标题（如 system.channel.list）', () => {
    render(<Harness row={turnRow({ status: 'completed', value: [{ id: 'c0' }] }, { requestType: 'system.channel.list' })} />);
    expect(screen.getByText('system.channel.list')).toBeTruthy();
  });

  it('actor.describe 结果使用专属标题"codex 的能力"', () => {
    render(<Harness row={turnRow({
      status: 'completed', class: 'codex', interfaces: ['actor'], capabilities: {}, words: { 'agent.ask': { description: 'ask' } },
    }, { requestType: 'actor.describe' })} />);
    expect(screen.getByText('codex 的能力')).toBeTruthy();
  });

  it('keeps failure facts and redacts sensitive fields recursively', async () => {
    const user = userEvent.setup();
    render(<Harness row={turnRow({
      status: 'failed', reason: 'receiver_internal_error', error_code: 'type_unsupported', detail: 'nope',
      diagnostic: { attempt: 1, nested: { token: 'failure-token', safe: 'shown' }, records: [{ password: 'failure-password', note: 'kept' }] },
    })} />);
    expect(screen.getByText('接收方不支持这个操作')).toBeTruthy();
    expect(screen.getByText('nope')).toBeTruthy();
    await user.click(screen.getByText('错误数据'));
    expect(screen.getByText('attempt')).toBeTruthy();
    expect(screen.queryByText('failure-token')).toBeNull();
    expect(screen.queryByText('failure-password')).toBeNull();
    expect(screen.getAllByText('已隐藏').length).toBeGreaterThanOrEqual(2);
  });

  it('redacts registrar value secrets before rendering', async () => {
    const user = userEvent.setup();
    render(<Harness row={turnRow({
      status: 'completed',
      value: { device_id: 'd1', key: 'secret-value', nested: { password: 'nested-secret' }, records: [{ token: 'array-secret', label: 'ok' }] },
    }, { requestType: 'system.device.create' })} />);
    const details = document.querySelector('.structured-result-details');
    await user.click(details.querySelector('summary'));
    expect(screen.getByText('device_id')).toBeTruthy();
    expect(screen.queryByText('secret-value')).toBeNull();
    expect(screen.queryByText('nested-secret')).toBeNull();
    expect(screen.queryByText('array-secret')).toBeNull();
    expect(screen.getAllByText('已隐藏').length).toBeGreaterThanOrEqual(3);
  });
});

describe('结构化结果默认折叠（新结构，等价 structured-result-ui.test.jsx）', () => {
  it('纯 JSON 文本结果默认收起，用户点击后才展开', async () => {
    const user = userEvent.setup();
    render(<Harness row={turnRow({ status: 'completed', text: '{"items":[1,2,3],"ok":true}' })} />);
    const details = document.querySelector('.structured-result-details');
    expect(details.open).toBe(false);
    expect(screen.getByText('JSON 结果')).toBeTruthy();
    expect(screen.getByText('2 个字段')).toBeTruthy();
    await user.click(screen.getByText('JSON 结果'));
    expect(details.open).toBe(true);
  });

  it('结构化协议结果默认收起并限制在独立滚动区', () => {
    render(<Harness row={turnRow({ status: 'completed', id: 'c0', profile: { serving: 1 } }, { requestType: 'system.channel.get' })} />);
    const details = document.querySelector('.structured-result-details');
    expect(details.open).toBe(false);
    expect(document.querySelector('.structured-result-scroll')).toBeTruthy();
    expect(screen.getByText('结构化结果')).toBeTruthy();
  });
});
