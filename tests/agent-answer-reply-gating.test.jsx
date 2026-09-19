// @vitest-environment jsdom
// 恢复对应：tests/dynamic-f3.test.jsx（master，已删除）里的
// 'Agent 最终答复可以建立临时回复目标，处理中气泡不提供回复'。
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTimelineRowRenderer } from '../src/ui/timeline/TimelineRowRenderer.jsx';

afterEach(cleanup);

function Harness({ row, onReply }) {
  const { renderRow } = useTimelineRowRenderer({
    state: { channelId: 'c0', narration: [] },
    names: new Map(),
    selfId: 'human:root:1',
    presentationEditing: null,
    browsingExpandedSlots: new Set(),
    effectiveFoldOverrides: new Map(),
    approvalStates: {},
    onReply,
  });
  return renderRow(row);
}

function request(id) {
  return {
    id, kind: 'request', type: 'agent.ask',
    sender: { id: 'human:root:1', kind: 'human' }, audience: ['agent:worker:1'],
    ts: 100, payload: { body: { text: '执行任务' } },
  };
}

function turnRow({ terminal, provisional = [] }) {
  return {
    id: 'request-1', seqLow: 1, seqHigh: 2, contentRevision: 1, visualSlotID: 'request-1',
    body: {
      kind: 'turn',
      turn: { requestId: 'request-1', request: request('request-1'), terminal, terminalClosureOnly: false, provisional, thread: [], status: terminal ? 'completed' : 'pending' },
      thread: [],
    },
  };
}

describe('Agent 答复的回复入口只在终态后出现（恢复自 dynamic-f3.test.jsx）', () => {
  it('处理中气泡不提供回复按钮，终态答复可以建立回复目标', () => {
    const onReply = vi.fn();
    const processingRow = turnRow({
      terminal: null,
      provisional: [{
        seq: 1,
        envelope: {
          id: 'stage-1', kind: 'response', type: 'agent.ask', parent_id: 'request-1',
          sender: { id: 'agent:worker:1', kind: 'agent' }, audience: ['human:root:1'], ts: 150,
          payload: { body: { status: 'processing', process: { kind: 'stage', stage: 'text', text: '正在处理…' } } },
        },
      }],
    });
    const view = render(<Harness row={processingRow} onReply={onReply} />);
    expect(document.querySelector('.agent-progress-text')).toBeTruthy();
    // 自己发出的 request 没有可回复对象；Agent 的处理中气泡也还没有可回复的答案。
    // 两条都不应展示一个点击后只产生错误 notice 的回复入口。
    expect(screen.queryAllByRole('button', { name: /回复/ })).toHaveLength(0);

    const terminal = {
      id: 'request-1:terminal', kind: 'response', type: 'agent.ask', parent_id: 'request-1',
      sender: { id: 'agent:worker:1', kind: 'agent' }, audience: ['human:root:1'], ts: 500,
      payload: { body: { status: 'completed', text: '已完成' } },
    };
    view.rerender(<Harness row={turnRow({ terminal })} onReply={onReply} />);
    // 终态：只有 Agent 答案可以建立回复目标。
    const replyButtons = screen.getAllByRole('button', { name: /回复/ });
    expect(replyButtons).toHaveLength(1);
    replyButtons[0].click();
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ sender: { id: 'agent:worker:1', kind: 'agent' } }));
  });
});
