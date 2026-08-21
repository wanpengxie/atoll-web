// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apply, createChannelState } from '../src/model/fold.js';
import { normalizeDescribe } from '../src/model/capabilities.js';
import { Timeline } from '../src/ui/Timeline.jsx';

afterEach(cleanup);

const request = (id, text) => ({
  id, kind: 'request', type: 'agent.ask', ts: 100, sender: { kind: 'human', id: 'me' },
  audience: ['agent'], visibility: 'public', payload: { text },
});

const response = (id, parentId, payload) => ({
  id, parent_id: parentId, kind: 'response', type: 'agent.ask', ts: 110,
  sender: { kind: 'agent', id: 'agent' }, audience: ['me'], visibility: 'public', payload,
});

function add(state, seq, envelope) {
  apply(state, { channel_id: 'c0', seq, envelope });
}

function capabilities() {
  return new Map([['agent', { describe: normalizeDescribe({
    class: 'agent', capabilities: { steer: true, interrupt: true },
    words: { 'agent.ask': {}, 'agent.steer': {}, 'agent.hold': {}, 'agent.interrupt': {} },
  }) }]]);
}

const roster = [{ id: 'me', kind: 'human', name: '我' }, { id: 'agent', kind: 'agent', name: 'Agent' }];

describe('agent control v7 information architecture', () => {
  it('38 keeps queued only in the wait layer and promotes only explicit acceptance facts', () => {
    const state = createChannelState('c0');
    add(state, 1, request('queued', '还在等待'));
    add(state, 2, response('queued-q', 'queued', { status: 'queued' }));
    add(state, 3, request('owner', '已经处理'));
    add(state, 4, response('owner-p', 'owner', { status: 'processing', turn_id: 'turn-1' }));
    add(state, 5, request('merged', '随批接受'));
    add(state, 6, response('merged-d', 'merged', { status: 'completed', merged_into: 'owner' }));
    const onTaskControl = vi.fn();
    const view = render(<Timeline state={state} roster={roster} selfId="me" pending={[]} approvalStates={{}} access="member_active" capabilityIndex={capabilities()} onTaskControl={onTaskControl} />);

    const timeline = document.querySelector('.timeline');
    const waiting = screen.getByRole('region', { name: '等待区' });
    expect(within(waiting).getByText('还在等待')).toBeTruthy();
    expect(within(timeline).queryByText('还在等待')).toBeNull();
    expect(within(timeline).getByText('已经处理')).toBeTruthy();
    expect(within(timeline).getByText('随批接受')).toBeTruthy();

    fireEvent.click(within(waiting).getByRole('button', { name: '插入' }));
    expect(onTaskControl).toHaveBeenCalledWith(expect.objectContaining({ type: 'agent.steer', payload: { target: 'queued' } }));

    add(state, 7, response('queued-p', 'queued', { status: 'processing', turn_id: 'turn-1' }));
    view.rerender(<Timeline state={state} roster={roster} selfId="me" pending={[]} approvalStates={{}} access="member_active" capabilityIndex={capabilities()} onTaskControl={onTaskControl} />);
    expect(screen.queryByRole('region', { name: '等待区' })).toBeNull();
    expect(within(document.querySelector('.timeline')).getByText('还在等待')).toBeTruthy();
  });

  it('39 creates one button-free agent bubble at processing and settles it in place', () => {
    const state = createChannelState('c0');
    add(state, 1, request('work', '重构 loop.go'));
    add(state, 2, response('work-p', 'work', { status: 'processing', turn_id: 'turn-42' }));
    add(state, 3, { id: 'tool', parent_id: 'work', kind: 'event', type: 'agent.tool.started', ts: 120, sender: { kind: 'agent', id: 'agent' }, visibility: 'public', payload: { tool: 'read_file' } });
    const onTaskControl = vi.fn();
    const view = render(<Timeline state={state} roster={roster} selfId="me" pending={[]} approvalStates={{}} access="member_active" capabilityIndex={capabilities()} onTaskControl={onTaskControl} />);

    const card = document.querySelector('.agent-conversation-turn');
    const bubble = card.querySelector('.agent-turn-bubble');
    expect(within(bubble).getByText('● 处理中: 重构 loop.go')).toBeTruthy();
    expect(within(bubble).getByText('⋯ tool: read_file …')).toBeTruthy();
    expect(within(card).getByRole('button', { name: '编辑' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: '停止' })).toBeTruthy();
    expect(bubble.querySelectorAll('button')).toHaveLength(0);
    expect(bubble.textContent).not.toContain('turn-42');

    add(state, 4, response('work-d', 'work', { status: 'completed', turn_index: 7, text: '重构完成' }));
    view.rerender(<Timeline state={state} roster={roster} selfId="me" pending={[]} approvalStates={{}} access="member_active" capabilityIndex={capabilities()} onTaskControl={onTaskControl} />);
    const settled = document.querySelector('.agent-turn-bubble');
    expect(settled).toBe(bubble);
    expect(within(settled).getByText('重构完成')).toBeTruthy();
    expect(within(settled).getByLabelText('已完成')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: '编辑' })).toBeNull();
    expect(within(card).queryByRole('button', { name: '停止' })).toBeNull();
    expect(settled.querySelectorAll('button')).toHaveLength(0);
    expect(settled.textContent).not.toContain('7');
  });
});
