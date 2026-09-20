// @vitest-environment jsdom
// SZ-245 successor: the deleted turn-presentation helper had no current
// export.  The user-visible contract is now owned by the public
// useTimelineRowRenderer().renderRow surface: business progress stays in the
// answer area while tool/stage facts remain in the separate process trail.
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useTimelineRowRenderer } from '../src/ui/timeline/TimelineRowRenderer.jsx';

afterEach(cleanup);

function processRow(seq, process) {
  return {
    seq,
    envelope: {
      id: `progress-${seq}`,
      sender: { id: 'agent:worker:1', kind: 'agent' },
      ts: 100 + seq,
      payload: { body: { status: 'processing', process } },
    },
  };
}

function turn(overrides = {}) {
  return {
    requestId: 'request-1',
    request: {
      id: 'request-1',
      kind: 'request',
      type: 'agent.ask',
      ts: 100,
      sender: { id: 'human:root:1', kind: 'human' },
      audience: ['agent:worker:1'],
      payload: { body: { text: '整理报告' } },
    },
    status: 'processing',
    terminal: null,
    provisional: [
      processRow(1, { kind: 'turn', phase: 'started' }),
      processRow(2, { kind: 'tool', phase: 'started', tool_call_id: 'call-1', tool: 'search' }),
      processRow(3, { kind: 'stage', stage: 'thinking', text: '正在分析资料' }),
      processRow(4, { kind: 'tool', phase: 'ended', tool_call_id: 'call-1', tool: 'search', outcome: 'completed' }),
      processRow(5, { kind: 'stage', stage: 'text', text: '正在整理报告' }),
    ],
    thread: [],
    ...overrides,
  };
}

function Renderer({ value }) {
  const { renderRow } = useTimelineRowRenderer({
    state: { channelId: 'c0', narration: [] },
    names: new Map([['agent:worker:1', 'Worker']]),
    selfId: 'human:root:1',
    browsingExpandedSlots: new Set(),
    effectiveFoldOverrides: new Map(),
    approvalStates: {},
  });
  return renderRow({
    id: value.requestId,
    contentRevision: '1',
    body: { kind: 'turn', turn: value, thread: value.thread },
  });
}

describe('SZ-245 turn presentation public owner', () => {
  it('keeps human progress in the answer and technical evidence in a separate trail', () => {
    const view = render(<Renderer value={turn()} />);

    // 用户能力：看到面向人的当前进度；不变量：tool/stage 不能被压平成主回答。
    expect([...view.container.querySelectorAll('.agent-progress-text')].map((node) => node.textContent.trim()))
      .toEqual(['正在整理报告']);
    const trail = view.container.querySelector('.progress-trail.running');
    expect(trail).toBeTruthy();
    expect(trail.textContent).toContain('处理中: 整理报告');
    expect(trail.textContent).not.toContain('正在整理报告');
    expect(view.container.querySelector('.response-content').textContent).not.toContain('tool:');

    // 过程入口是同一 renderer 的公开 UI：展开后技术事实可查看，而不是丢失。
    fireEvent.click(trail.querySelector('.progress-running-header'));
    expect([...trail.querySelectorAll('.progress-row-line')].map((node) => node.textContent))
      .toEqual(['正在分析资料', 'tool: search 完成']);
  });
});
