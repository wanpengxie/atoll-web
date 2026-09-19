// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useTimelineRowRenderer } from '../src/ui/timeline/TimelineRowRenderer.jsx';

afterEach(cleanup);

function Harness({ row }) {
  const { renderRow } = useTimelineRowRenderer({
    state: { channelId: 'c0', narration: [] },
    names: new Map([['human:root:1', 'Root'], ['agent:worker:1', 'Worker']]),
    selfId: 'human:root:1',
    presentationEditing: null,
    browsingExpandedSlots: new Set(),
    effectiveFoldOverrides: new Map(),
    approvalStates: {},
  });
  return renderRow(row);
}

function standalone(id, body, type = 'agent.ask') {
  const envelope = {
    id,
    kind: 'request',
    type,
    sender: { id: 'human:root:1', kind: 'human' },
    audience: ['agent:worker:1'],
    ts: 100,
    payload: { body },
  };
  return {
    id,
    seqLow: 1,
    seqHigh: 1,
    contentRevision: 1,
    visualSlotID: id,
    body: { kind: 'standalone', envelope },
  };
}

function turnRow(id, terminalBody) {
  const request = {
    id,
    kind: 'request',
    type: 'agent.ask',
    sender: { id: 'human:root:1', kind: 'human' },
    audience: ['agent:worker:1'],
    ts: 100,
    payload: { body: { text: '执行任务' } },
  };
  const terminal = {
    id: `${id}:terminal`,
    kind: 'response',
    type: 'agent.ask',
    parent_id: id,
    sender: { id: 'agent:worker:1', kind: 'agent' },
    audience: ['human:root:1'],
    ts: 200,
    payload: { body: terminalBody },
  };
  return {
    id,
    seqLow: 1,
    seqHigh: 2,
    contentRevision: 1,
    visualSlotID: id,
    body: {
      kind: 'turn',
      turn: { requestId: id, request, terminal, terminalClosureOnly: false, provisional: [], thread: [], status: terminalBody.status === 'failed' ? 'failed' : 'completed' },
      thread: [],
    },
  };
}

describe('current timeline message presentation', () => {
  it('reads the canonical request body through the presentation renderer', () => {
    render(React.createElement(Harness, { row: standalone('message-1', { text: '来自真实正文' }) }));
    expect(screen.getByText('来自真实正文')).toBeTruthy();
  });

  it('does not stringify unsupported payload objects or expose their fields', () => {
    render(React.createElement(Harness, { row: standalone('message-2', { nested: { value: 1 }, token: 'secret' }) }));
    expect(screen.queryByText('secret')).toBeNull();
    expect(document.querySelector('.message-body')?.textContent).not.toContain('nested');
  });

  it('renders a canonical terminal text result and recursively redacts sensitive fields', () => {
    render(React.createElement(Harness, { row: turnRow('turn-1', { status: 'completed', text: 'PONG' }) }));
    expect(screen.getByText('PONG')).toBeTruthy();
    cleanup();

    render(React.createElement(Harness, { row: turnRow('turn-2', { status: 'completed', value: { token: 'secret', nested: { password: 'hidden' }, visible: 'ok' } }) }));
    expect(screen.getByText('结构化结果')).toBeTruthy();
    expect(screen.queryByText('secret')).toBeNull();
    expect(screen.queryByText('hidden')).toBeNull();
    expect(screen.getAllByText('已隐藏').length).toBeGreaterThan(0);
  });

  it('renders the protocol label and declaration for system.member.create', () => {
    // Current-owner contract: the canonical body shape is rendered through
    // the public timeline presentation path, including its operation label.
    render(React.createElement(Harness, {
      row: standalone('message-member-create', { decl_id: 'demo:agent' }, 'system.member.create'),
    }));
    expect(screen.getByText('添加参与者：demo:agent')).toBeTruthy();
  });
});
