// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTimelineRowRenderer } from '../src/ui/timeline/TimelineRowRenderer.jsx';

afterEach(cleanup);

function approvalRow() {
  const request = {
    id: 'approval-1',
    kind: 'request',
    type: 'human.approve',
    sender: { id: 'agent:worker:1', kind: 'agent' },
    audience: ['human:root:1'],
    ts: 100,
    payload: { body: { title: '发布生产' } },
  };
  return {
    id: 'approval-1',
    seqLow: 1,
    seqHigh: 1,
    contentRevision: 1,
    visualSlotID: 'approval-1',
    body: {
      kind: 'turn',
      turn: {
        requestId: 'approval-1',
        request,
        terminal: null,
        terminalClosureOnly: false,
        provisional: [],
        thread: [],
        status: 'pending',
      },
      thread: [],
    },
  };
}

function Harness({ onResolve }) {
  const { renderRow } = useTimelineRowRenderer({
    state: { channelId: 'c0', narration: [] },
    names: new Map([['agent:worker:1', 'Worker']]),
    selfId: 'human:root:1',
    presentationEditing: null,
    browsingExpandedSlots: new Set(),
    effectiveFoldOverrides: new Map(),
    approvalStates: {},
    onResolve,
  });
  return renderRow(approvalRow());
}

describe('ApprovalCard Promise boundary', () => {
  it('consumes a rejected resolve Promise at the Timeline owner', async () => {
    let rejectAction;
    const action = new Promise((resolve, reject) => {
      rejectAction = reject;
    });
    const catchSpy = vi.spyOn(action, 'catch');
    const onResolve = vi.fn(() => action);
    render(<Harness onResolve={onResolve} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '批准' }));
    });
    expect(onResolve).toHaveBeenCalledWith('c0', 'approval-1', 'approve', {});
    expect(catchSpy).toHaveBeenCalledOnce();

    rejectAction(Object.assign(new Error('wire rejected'), {
      code: 'resolve_denied',
      detail: '服务端拒绝审批结果',
    }));
    await act(async () => { await Promise.resolve(); });
  });
});
