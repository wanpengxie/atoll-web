// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apply, createChannelState } from '../src/model/fold.js';
import { normalizeDescribe } from '../src/model/capabilities.js';
import { Timeline } from '../src/ui/Timeline.jsx';

afterEach(cleanup);

const request = (id, text, actorId = 'agent') => ({
  id, kind: 'request', type: 'agent.ask', ts: Date.now(), sender: { kind: 'human', id: 'me' },
  audience: [actorId], visibility: 'public', payload: { text },
});

const response = (id, parentId, payload) => ({
  id, parent_id: parentId, kind: 'response', type: 'agent.ask', ts: Date.now(),
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

function capabilitiesFor(...actorIds) {
  const capability = capabilities().get('agent');
  return new Map(actorIds.map((id) => [id, capability]));
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

  it('groups queue positions per agent and cancels a group through hold, cancels, unhold', async () => {
    const state = createChannelState('c0');
    add(state, 1, request('a1', 'A first', 'agent'));
    add(state, 2, response('a1-q', 'a1', { status: 'queued' }));
    add(state, 3, request('b1', 'B first', 'agent-2'));
    add(state, 4, { ...response('b1-q', 'b1', { status: 'queued' }), sender: { kind: 'agent', id: 'agent-2' } });
    add(state, 5, request('a2', 'A second', 'agent'));
    add(state, 6, response('a2-q', 'a2', { status: 'queued' }));
    const calls = [];
    const onTaskControl = vi.fn(async ({ type }) => { calls.push(type); return `${type}-id`; });
    const onCancel = vi.fn(async (_channelId, requestId) => { calls.push(`cancel:${requestId}`); });
    render(<Timeline state={state} roster={[...roster, { id: 'agent-2', kind: 'agent', name: 'Agent 2' }]} selfId="me" pending={[]} approvalStates={{}} access="member_active" capabilityIndex={capabilitiesFor('agent', 'agent-2')} onTaskControl={onTaskControl} onCancel={onCancel} />);

    const groupA = document.querySelector('[data-agent-id="agent"]');
    const groupB = document.querySelector('[data-agent-id="agent-2"]');
    expect([...groupA.querySelectorAll('.agent-wait-position')].map((node) => node.textContent)).toEqual(['1', '2']);
    expect([...groupB.querySelectorAll('.agent-wait-position')].map((node) => node.textContent)).toEqual(['1']);
    fireEvent.click(within(groupA).getByRole('button', { name: '全部取消' }));
    await waitFor(() => expect(calls).toEqual(['agent.hold', 'cancel:a1', 'cancel:a2', 'agent.unhold']));
  });

  it('returns to non-editing state with a prompt when hold admission fails', async () => {
    const state = createChannelState('c0');
    add(state, 1, request('queued', 'edit me'));
    add(state, 2, response('queued-q', 'queued', { status: 'queued' }));
    const onTaskControl = vi.fn(async () => 'h1');
    const props = { state, roster, selfId: 'me', pending: [], approvalStates: {}, access: 'member_active', capabilityIndex: capabilities(), onTaskControl };
    const view = render(<Timeline {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    await waitFor(() => expect(onTaskControl).toHaveBeenCalled());
    add(state, 3, { id: 'h1', kind: 'request', type: 'agent.hold', ts: Date.now(), sender: { kind: 'human', id: 'me' }, audience: ['agent'], visibility: 'public', payload: { target: 'queued' } });
    add(state, 4, { id: 'h1-d', parent_id: 'h1', kind: 'response', type: 'agent.hold', ts: Date.now(), sender: { kind: 'agent', id: 'agent' }, audience: ['me'], visibility: 'public', payload: { status: 'failed', error_code: 'busy', detail: '稍后重试' } });
    view.rerender(<Timeline {...props} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('稍后重试'));
    expect(screen.queryByLabelText('修改后的任务内容')).toBeNull();
    expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy();
  });

  it('shows interrupt freeze only on the stopped agent bubble, never as hold pause', () => {
    const state = createChannelState('c0');
    add(state, 1, request('owner', 'running'));
    add(state, 2, response('owner-p', 'owner', { status: 'processing', turn_id: 'turn' }));
    add(state, 3, request('queued', 'waiting'));
    add(state, 4, response('queued-q', 'queued', { status: 'queued' }));
    add(state, 5, { id: 'i1', parent_id: 'owner', kind: 'request', type: 'agent.interrupt', ts: Date.now(), sender: { kind: 'human', id: 'me' }, audience: ['agent'], visibility: 'public', payload: {} });
    add(state, 6, { id: 'i1-d', parent_id: 'i1', kind: 'response', type: 'agent.interrupt', ts: Date.now(), sender: { kind: 'agent', id: 'agent' }, audience: ['me'], visibility: 'public', payload: { status: 'completed' } });
    add(state, 7, response('owner-d', 'owner', { status: 'failed', error_code: 'interrupted' }));
    render(<Timeline state={state} roster={roster} selfId="me" pending={[]} approvalStates={{}} access="member_active" capabilityIndex={capabilities()} />);
    expect(screen.getByText('✗ 已停止 · 发消息即继续')).toBeTruthy();
    expect(screen.getByRole('region', { name: '等待区' }).textContent).not.toContain('已暂停');
  });

  it('shows hold freeze only as the wait-layer pause', () => {
    const state = createChannelState('c0');
    add(state, 1, request('queued', 'waiting'));
    add(state, 2, response('queued-q', 'queued', { status: 'queued' }));
    add(state, 3, { id: 'h1', kind: 'request', type: 'agent.hold', ts: Date.now(), sender: { kind: 'human', id: 'me' }, audience: ['agent'], visibility: 'public', payload: { target: 'queued' } });
    add(state, 4, { id: 'h1-d', parent_id: 'h1', kind: 'response', type: 'agent.hold', ts: Date.now(), sender: { kind: 'agent', id: 'agent' }, audience: ['me'], visibility: 'public', payload: { status: 'completed' } });
    render(<Timeline state={state} roster={roster} selfId="me" pending={[]} approvalStates={{}} access="member_active" capabilityIndex={capabilities()} />);
    expect(screen.getByRole('region', { name: '等待区' }).textContent).toContain('已暂停');
    expect(screen.queryByText(/已停止/)).toBeNull();
  });
});
