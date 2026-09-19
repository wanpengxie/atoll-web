// @vitest-environment jsdom
// Successor coverage for the deleted turn-process helpers.  The old
// finalEchoObservation/withoutFinalEcho exports were folded into the current
// TimelineRowRenderer owner; exercise that public render path instead of
// restoring a second process model or a compatibility export.
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useTimelineRowRenderer } from '../src/ui/timeline/TimelineRowRenderer.jsx';

afterEach(cleanup);

function processRow(text, seq = 2) {
  return {
    seq,
    envelope: {
      id: `process-${seq}`,
      kind: 'response',
      parent_id: 'request-1',
      sender: { id: 'agent-1', kind: 'agent' },
      payload: {
        body: {
          status: 'processing',
          process: { kind: 'stage', stage: 'text', text },
        },
      },
    },
    process: { kind: 'stage', stage: 'text', text },
  };
}

function row({ observations = [], terminalText = '', terminal = true } = {}) {
  const request = {
    id: 'request-1',
    type: 'agent.ask',
    ts: 1,
    sender: { id: 'human-1', kind: 'human' },
    audience: ['agent-1'],
    payload: { body: { text: '执行任务' } },
  };
  const terminalEnvelope = terminal ? {
    id: 'terminal-1',
    kind: 'response',
    parent_id: request.id,
    sender: { id: 'agent-1', kind: 'agent' },
    payload: { body: { status: 'completed', text: terminalText } },
  } : null;
  const turn = {
    requestId: request.id,
    request,
    requestSeq: 1,
    lastSeq: terminal ? 3 : 2,
    provisional: observations,
    terminal: terminalEnvelope,
    terminalSeq: terminal ? 3 : 0,
    status: terminal ? 'completed' : 'pending',
    thread: [],
  };
  return {
    id: request.id,
    contentRevision: 1,
    visualSlotID: request.id,
    body: { kind: 'turn', turn, thread: [] },
  };
}

function Harness({ value }) {
  const { renderRow } = useTimelineRowRenderer({
    state: { channelId: 'c0', narration: [] },
    names: new Map([
      ['human-1', { name: '人类' }],
      ['agent-1', { name: 'Agent' }],
    ]),
    selfId: 'human-1',
    presentationEditing: null,
    browsingExpandedSlots: new Set(),
    effectiveFoldOverrides: new Map(),
    approvalStates: {},
  });
  return renderRow(value);
}

describe('current Agent answer rendering', () => {
  it('renders a terminal answer once when the final process observation is an exact echo', () => {
    const view = render(React.createElement(Harness, { value: row({
      observations: [processRow('先检查文件', 2), processRow('结论是 A', 3)],
      terminalText: '结论是 A',
    }) }));

    expect(view.container.querySelectorAll('.agent-progress-text')).toHaveLength(1);
    expect(view.container.querySelectorAll('.agent-final-text')).toHaveLength(1);
    expect(view.container.querySelector('.agent-final-text').textContent).toContain('结论是 A');
  });

  it('treats a truncated final observation as an answer prefix', () => {
    const prefix = '结论是这份报告已经完成';
    const view = render(React.createElement(Harness, { value: row({
      observations: [processRow('读取过程', 2), processRow(`${prefix}…[truncated]`, 3)],
      terminalText: `${prefix}，请查看附件。`,
    }) }));

    expect(view.container.querySelectorAll('.agent-progress-text')).toHaveLength(1);
    expect(view.container.querySelector('.agent-final-text').textContent).toContain(`${prefix}，请查看附件。`);
  });

  it('keeps a genuine final process observation when it is not an answer prefix', () => {
    const view = render(React.createElement(Harness, { value: row({
      observations: [processRow('先读取数据', 2), processRow('准备写入结果', 3)],
      terminalText: '最终答案在这里',
    }) }));

    expect(view.container.querySelectorAll('.agent-progress-text')).toHaveLength(2);
    expect(view.container.querySelectorAll('.agent-final-text')).toHaveLength(1);
  });

  it('does not manufacture a terminal answer while the turn is still processing', () => {
    const view = render(React.createElement(Harness, { value: row({
      observations: [processRow('正在处理')],
      terminalText: '',
      terminal: false,
    }) }));

    expect(view.container.querySelectorAll('.agent-progress-text')).toHaveLength(1);
    expect(view.container.querySelectorAll('.agent-final-text')).toHaveLength(0);
  });

  it('keeps an empty terminal result as one terminal slot when no process text exists', () => {
    const view = render(React.createElement(Harness, { value: row({
      observations: [],
      terminalText: '',
    }) }));

    expect(view.container.querySelectorAll('.agent-progress-text')).toHaveLength(0);
    expect(view.container.querySelectorAll('.agent-final-text')).toHaveLength(1);
    expect(view.container.querySelector('.agent-final-text').textContent).toContain('返回了空文本');
  });
});
